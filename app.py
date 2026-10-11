import base64
import io
import os
import sqlite3
from datetime import datetime
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from flask import Flask, jsonify, render_template, request
from groq import Groq
from werkzeug.utils import secure_filename

from nltk_processing import preprocess_text


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "sentiment.db"

model = joblib.load(BASE_DIR / "sentiment_model.pkl")
tfidf = joblib.load(BASE_DIR / "tfidf_vectorizer.pkl")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024


def get_reviews():
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        return pd.read_sql_query("SELECT * FROM reviews ORDER BY id DESC", connection)
    finally:
        connection.close()


def initialize_database():
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS datasets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                row_count INTEGER NOT NULL,
                date_time TEXT NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review TEXT,
                sentiment TEXT,
                date_time TEXT,
                dataset_id INTEGER
            )
        """)
        review_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(reviews)")
        }
        if "dataset_id" not in review_columns:
            connection.execute("ALTER TABLE reviews ADD COLUMN dataset_id INTEGER")
        connection.commit()
    finally:
        connection.close()


initialize_database()


@app.errorhandler(413)
def request_entity_too_large(_error):
    _ = _error
    return jsonify({"error": "CSV files must be 32 MB or smaller."}), 413


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/dashboard")
def dashboard():
    reviews = get_reviews()
    counts = reviews["sentiment"].value_counts() if not reviews.empty else {}
    recent_reviews = reviews.head(6).fillna("").to_dict(orient="records")
    return jsonify({
        "total": len(reviews),
        "manual_total": int(reviews["dataset_id"].isna().sum()),
        "counts": {
            "positive": int(counts.get("positive", 0)),
            "negative": int(counts.get("negative", 0)),
            "neutral": int(counts.get("neutral", 0)),
        },
        "recent": recent_reviews,
    })


@app.post("/api/analyze")
def analyze_review():
    payload = request.get_json(silent=True) or {}
    review = str(payload.get("review", "")).strip()
    if not review:
        return jsonify({"error": "Enter a customer review first."}), 400

    cleaned_review = preprocess_text(review)
    review_tfidf = tfidf.transform([cleaned_review])
    prediction = str(model.predict(review_tfidf)[0])
    probabilities = model.predict_proba(review_tfidf)[0]
    confidence = float(max(probabilities) * 100)

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute(
            "INSERT INTO reviews (review, sentiment, date_time) VALUES (?, ?, ?)",
            (review, prediction, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        connection.commit()
    finally:
        connection.close()

    return jsonify({"sentiment": prediction, "confidence": confidence})


@app.delete("/api/reviews/<int:review_id>")
def delete_review(review_id):
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        review = connection.execute(
            "SELECT dataset_id FROM reviews WHERE id = ?", (review_id,)
        ).fetchone()
        if review is None:
            return jsonify({"error": "Review not found."}), 404

        connection.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
        if review[0] is not None:
            connection.execute(
                """
                UPDATE datasets
                SET row_count = MAX(row_count - 1, 0)
                WHERE id = ?
                """,
                (review[0],),
            )
        connection.commit()
    finally:
        connection.close()

    return jsonify({"message": "Review deleted."})


@app.delete("/api/reviews")
def delete_manual_reviews():
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        cursor = connection.execute(
            "DELETE FROM reviews WHERE dataset_id IS NULL"
        )
        deleted_count = cursor.rowcount
        connection.commit()
    finally:
        connection.close()

    return jsonify({
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} individually analyzed reviews.",
    })


@app.get("/api/datasets")
def list_datasets():
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        datasets = connection.execute(
            "SELECT id, filename, row_count, date_time FROM datasets ORDER BY id DESC"
        ).fetchall()
    finally:
        connection.close()

    return jsonify({
        "datasets": [
            {
                "id": dataset[0],
                "filename": dataset[1],
                "row_count": dataset[2],
                "date_time": dataset[3],
            }
            for dataset in datasets
        ]
    })


@app.post("/api/datasets")
def upload_dataset():
    uploaded_file = request.files.get("dataset")
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Choose a CSV file to upload."}), 400
    if Path(uploaded_file.filename).suffix.lower() != ".csv":
        return jsonify({"error": "Upload a .csv file."}), 400

    try:
        dataset = pd.read_csv(uploaded_file, encoding="utf-8-sig")
    except (pd.errors.EmptyDataError, pd.errors.ParserError, UnicodeDecodeError):
        return jsonify({"error": "The CSV file is empty, invalid, or not UTF-8 encoded."}), 400

    columns = {str(column).strip().lower(): column for column in dataset.columns}
    review_column = next(
        (columns[name] for name in ("review_text", "review", "text") if name in columns),
        None,
    )
    if review_column is None:
        return jsonify({
            "error": "The CSV must include a review_text, review, or text column."
        }), 400

    review_texts = (
        dataset[review_column]
        .dropna()
        .astype(str)
        .str.strip()
    )
    reviews = review_texts[review_texts != ""].tolist()
    if not reviews:
        return jsonify({"error": "The CSV does not contain any non-empty reviews."}), 400

    cleaned_reviews = [preprocess_text(review) for review in reviews]
    predictions = [str(prediction) for prediction in model.predict(tfidf.transform(cleaned_reviews))]
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    filename = secure_filename(Path(uploaded_file.filename).name) or "dataset.csv"

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        cursor = connection.execute(
            "INSERT INTO datasets (filename, row_count, date_time) VALUES (?, ?, ?)",
            (filename, len(reviews), timestamp),
        )
        dataset_id = cursor.lastrowid
        connection.executemany(
            """
            INSERT INTO reviews (review, sentiment, date_time, dataset_id)
            VALUES (?, ?, ?, ?)
            """,
            [
                (review, prediction, timestamp, dataset_id)
                for review, prediction in zip(reviews, predictions)
            ],
        )
        connection.commit()
    finally:
        connection.close()

    return jsonify({
        "dataset": {
            "id": dataset_id,
            "filename": filename,
            "row_count": len(reviews),
            "date_time": timestamp,
        }
    }), 201


@app.delete("/api/datasets/<int:dataset_id>")
def delete_dataset(dataset_id):
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        dataset = connection.execute(
            "SELECT filename FROM datasets WHERE id = ?", (dataset_id,)
        ).fetchone()
        if dataset is None:
            return jsonify({"error": "Dataset not found."}), 404

        connection.execute("DELETE FROM reviews WHERE dataset_id = ?", (dataset_id,))
        connection.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        connection.commit()
    finally:
        connection.close()

    return jsonify({"message": f"Deleted {dataset[0]} and its analyzed reviews."})


@app.get("/api/visualizations")
def visualizations():
    reviews = get_reviews()
    if reviews.empty:
        return jsonify({"error": "Analyze some reviews before viewing trends."}), 400

    sentiments = ["positive", "negative", "neutral"]
    counts = reviews["sentiment"].value_counts()
    values = [int(counts.get(sentiment, 0)) for sentiment in sentiments]
    figure, axes = plt.subplots(2, 2, figsize=(10, 7))

    axes[0, 0].bar(sentiments, values, color=["#16846b", "#d6534d", "#d7a63e"])
    axes[0, 0].set_title("Sentiment Distribution")
    axes[0, 0].set_xlabel("Sentiment")
    axes[0, 0].set_ylabel("Number of Reviews")

    axes[0, 1].pie(values, labels=sentiments, autopct="%1.1f%%")
    axes[0, 1].set_title("Sentiment Percentage")

    cumulative = [sum(values[:index + 1]) for index in range(len(values))]
    axes[1, 0].plot(sentiments, cumulative, marker="o", color="#167f8b")
    axes[1, 0].set_title("Cumulative Sentiment Count")
    axes[1, 0].set_xlabel("Sentiment")
    axes[1, 0].set_ylabel("Count")

    review_lengths = reviews["review"].fillna("").str.len()
    sentiment_numbers = reviews["sentiment"].map({"negative": 0, "neutral": 1, "positive": 2})
    axes[1, 1].scatter(review_lengths, sentiment_numbers, color="#d6534d", alpha=0.7)
    axes[1, 1].set_title("Review Length vs Sentiment")
    axes[1, 1].set_xlabel("Review Length")
    axes[1, 1].set_ylabel("Sentiment")
    axes[1, 1].set_yticks([0, 1, 2], ["Negative", "Neutral", "Positive"])

    figure.tight_layout()
    image = io.BytesIO()
    figure.savefig(image, format="png", dpi=140)
    plt.close(figure)
    encoded_image = base64.b64encode(image.getvalue()).decode("ascii")
    return jsonify({"image": f"data:image/png;base64,{encoded_image}"})


@app.post("/api/summary")
def generate_summary():
    if client is None:
        return jsonify({"error": "Set the GROQ_API_KEY environment variable to enable summaries."}), 503

    reviews = get_reviews()
    if reviews.empty:
        return jsonify({"error": "Analyze some reviews before generating a summary."}), 400

    positive = int((reviews["sentiment"] == "positive").sum())
    negative = int((reviews["sentiment"] == "negative").sum())
    neutral = int((reviews["sentiment"] == "neutral").sum())
    review_text = "\n".join(reviews["review"].fillna("").tolist()[:50])
    prompt = f"""
You are a customer feedback analyst.

Analyze the following customer feedback.

Positive reviews: {positive}
Negative reviews: {negative}
Neutral reviews: {neutral}

Customer reviews:
{review_text}

Provide a simple professional summary containing:

1. Overall customer sentiment
2. Positive feedback
3. Negative feedback
4. Common customer problems
5. Suggestions for improvement

Keep the answer concise and easy to understand.
"""

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        return jsonify({"summary": response.choices[0].message.content})
    except Exception:
        app.logger.exception("Groq summary request failed")
        return jsonify({"error": "The summary service could not complete the request."}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
