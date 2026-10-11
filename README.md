# Review Signal

A local web dashboard for customer sentiment analysis, review history, visualizations, and AI-generated feedback summaries.

## Run locally on Windows

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -c "import nltk; nltk.download('stopwords'); nltk.download('wordnet'); nltk.download('omw-1.4')"
python app.py
```

Open http://127.0.0.1:5000 in a browser. The included model and vectorizer are used for predictions. Set `GROQ_API_KEY` in the environment to enable AI summaries; do not put the key in source files.

## Review datasets

Use **Datasets** in the app's sidebar to upload a CSV for bulk sentiment analysis. The file must contain a `review_text`, `review`, or `text` column and be no larger than 32 MB. Each upload is tracked separately and its analyzed reviews are included in the dashboard, trends, and summary. **Delete dataset** removes only that upload and its analyzed reviews; reviews analyzed individually are not affected. Use **Delete** beside a saved review to remove just that review from history, or **Delete all input reviews** to remove all individually analyzed reviews while keeping uploaded dataset reviews.

`model.py` can train new model artifacts when `Customer_Sentiment.csv` is present in the project root with `review_text` and `sentiment` columns. The training dataset is intentionally excluded from Git because it contains customer review text. The app creates `sentiment.db` locally to store analyzed reviews and uploaded dataset records; that database is also excluded.