const pageCopy = {
  overview: ["Feedback, in focus.", "A clear read on what customers are saying."],
  trends: ["Patterns over time.", "Explore the shape of your saved customer feedback."],
  summary: ["The story behind the scores.", "Turn customer feedback into a concise action brief."],
  datasets: ["Datasets, in focus.", "Upload, analyze, and manage customer review datasets."],
};

const sampleReviews = [
  "Delivery was quick, the product matches its description, and customer support was helpful.",
  "The item arrived damaged and no one has responded to my request for a replacement.",
  "The product works as expected, though delivery took longer than estimated.",
];

const toast = document.querySelector("#toast");
let toastTimer;
let sampleIndex = 0;
let recentReviews = [];
let recentFilter = "all";
let recentQuery = "";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function renderSummary(markdown, container) {
  const normalized = String(markdown)
    .replace(/\r/g, "")
    .replace(/\s*\*\*([^*]+)\*\*/g, "\n## $1\n")
    .replace(/\s+-\s+/g, "\n- ")
    .replace(/\s+(?=\d+\.\s)/g, "\n")
    .trim();
  const fragment = document.createDocumentFragment();
  let list = null;

  function closeList() {
    list = null;
  }

  for (const line of normalized.split("\n").map((part) => part.trim()).filter(Boolean)) {
    const heading = line.match(/^##\s+(.+)$/);
    const orderedItem = line.match(/^\d+\.\s+(.+)$/);
    const unorderedItem = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      closeList();
      const title = document.createElement("h3");
      title.textContent = heading[1];
      fragment.append(title);
    } else if (orderedItem || unorderedItem) {
      const tagName = orderedItem ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tagName) {
        list = document.createElement(tagName);
        fragment.append(list);
      }
      const item = document.createElement("li");
      item.textContent = (orderedItem || unorderedItem)[1];
      list.append(item);
    } else {
      closeList();
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      fragment.append(paragraph);
    }
  }

  container.replaceChildren(fragment);
}

function addRecentReview(review) {
  const row = document.createElement("div");
  row.className = "recent-item";

  const text = document.createElement("span");
  text.className = "recent-review";
  text.textContent = review.review;

  const meta = document.createElement("div");
  meta.className = "recent-meta";
  const sentiment = document.createElement("span");
  sentiment.className = `sentiment-tag ${review.sentiment}`;
  sentiment.textContent = review.sentiment;
  const time = document.createElement("time");
  time.className = "recent-time";
  time.textContent = review.date_time;
  const loadButton = document.createElement("button");
  loadButton.className = "review-load";
  loadButton.type = "button";
  loadButton.textContent = "Load";
  loadButton.setAttribute("aria-label", "Load this review into the analyzer");
  loadButton.addEventListener("click", () => loadReviewInAnalyzer(review.review));
  const deleteButton = document.createElement("button");
  deleteButton.className = "review-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", "Delete this saved review");
  deleteButton.addEventListener("click", () => deleteReview(review.id, deleteButton));
  meta.append(sentiment, time, loadButton, deleteButton);
  row.append(text, meta);
  return row;
}

function renderRecentReviews() {
  const recentList = document.querySelector("#recent-list");
  const query = recentQuery.trim().toLocaleLowerCase();
  const matches = recentReviews.filter((review) => {
    const sentimentMatches = recentFilter === "all" || review.sentiment === recentFilter;
    const queryMatches = !query || review.review.toLocaleLowerCase().includes(query);
    return sentimentMatches && queryMatches;
  });

  recentList.replaceChildren();
  document.querySelector("#recent-count").textContent = `${matches.length} of ${recentReviews.length} shown`;
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = recentReviews.length ? "No recent reviews match these filters." : "Newly analyzed reviews will show up here.";
    recentList.append(empty);
    return;
  }
  matches.forEach((review) => recentList.append(addRecentReview(review)));
}

function loadReviewInAnalyzer(review) {
  const input = document.querySelector("#review-input");
  input.value = String(review).slice(0, input.maxLength);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus({ preventScroll: true });
  document.querySelector(".analyzer-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("Review loaded. Analyze it when ready.");
}

async function deleteReview(reviewId, button) {
  if (!window.confirm("Delete this saved review?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/reviews/${reviewId}`, { method: "DELETE" });
    await Promise.all([loadDashboard(), loadDatasets()]);
    showToast("Saved review deleted.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function loadDashboard() {
  try {
    const data = await requestJson("/api/dashboard");
    document.querySelector("#count-total").textContent = data.total;
    document.querySelector("#delete-all-input-reviews").disabled = data.manual_total === 0;
    const total = data.total || 0;
    for (const sentiment of ["positive", "negative", "neutral"]) {
      const count = data.counts[sentiment];
      const share = total ? (count / total) * 100 : 0;
      document.querySelector(`#count-${sentiment}`).textContent = count;
      document.querySelector(`#bar-${sentiment}`).style.width = `${share}%`;
      document.querySelector(`#share-${sentiment}`).textContent = `${share.toFixed(0)}%`;
      document.querySelector(`#bar-${sentiment}`).parentElement.setAttribute("aria-valuenow", share.toFixed(1));
      document.querySelector(`#distribution-${sentiment}`).style.width = `${share}%`;
    }

    recentReviews = data.recent;
    renderRecentReviews();
  } catch (error) {
    showToast(error.message);
  }
}

function activateView(name) {
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  document.querySelector("#page-title").textContent = pageCopy[name][0];
  document.querySelector("#page-description").textContent = pageCopy[name][1];
  if (name === "trends") loadTrends();
  if (name === "datasets") loadDatasets();
}

function renderDatasets(datasets) {
  const datasetList = document.querySelector("#dataset-list");
  datasetList.replaceChildren();
  if (datasets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No datasets uploaded yet.";
    datasetList.append(empty);
    return;
  }

  datasets.forEach((dataset) => {
    const item = document.createElement("article");
    item.className = "dataset-item";
    const details = document.createElement("div");
    details.className = "dataset-details";
    const filename = document.createElement("strong");
    filename.textContent = dataset.filename;
    const metadata = document.createElement("span");
    metadata.textContent = `${dataset.row_count.toLocaleString()} reviews analyzed · ${dataset.date_time}`;
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-delete button-compact";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete dataset";
    deleteButton.setAttribute("aria-label", `Delete dataset ${dataset.filename}`);
    deleteButton.addEventListener("click", () => deleteDataset(dataset.id, deleteButton));
    details.append(filename, metadata);
    item.append(details, deleteButton);
    datasetList.append(item);
  });
}

async function loadDatasets() {
  try {
    const data = await requestJson("/api/datasets");
    renderDatasets(data.datasets);
  } catch (error) {
    const datasetList = document.querySelector("#dataset-list");
    datasetList.replaceChildren();
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message;
    datasetList.append(message);
  }
}

async function deleteDataset(datasetId, button) {
  if (!window.confirm("Delete this dataset and all reviews analyzed from it?")) return;
  button.disabled = true;
  try {
    await requestJson(`/api/datasets/${datasetId}`, { method: "DELETE" });
    await Promise.all([loadDatasets(), loadDashboard()]);
    showToast("Dataset and its analyzed reviews deleted.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function loadTrends() {
  const button = document.querySelector("#load-trends");
  const image = document.querySelector("#chart-image");
  const placeholder = document.querySelector("#chart-placeholder");
  button.disabled = true;
  try {
    const data = await requestJson("/api/visualizations");
    image.src = data.image;
    image.hidden = false;
    placeholder.hidden = true;
  } catch (error) {
    if (image.hidden) showToast(error.message);
    else showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});

document.querySelector("#review-input").addEventListener("input", (event) => {
  const characterCount = event.currentTarget.value.length;
  document.querySelector("#review-count").textContent = `${characterCount.toLocaleString()} / 5,000 characters`;
  document.querySelector("#clear-review").disabled = characterCount === 0;
});

document.querySelector("#load-example").addEventListener("click", () => {
  loadReviewInAnalyzer(sampleReviews[sampleIndex % sampleReviews.length]);
  sampleIndex += 1;
});

document.querySelector("#clear-review").addEventListener("click", () => {
  const input = document.querySelector("#review-input");
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
});

document.querySelector("#recent-search").addEventListener("input", (event) => {
  recentQuery = event.currentTarget.value;
  renderRecentReviews();
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    recentFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((filterButton) => {
      const active = filterButton === button;
      filterButton.classList.toggle("active", active);
      filterButton.setAttribute("aria-pressed", String(active));
    });
    renderRecentReviews();
  });
});

document.querySelector("#analysis-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#analyze-button");
  const result = document.querySelector("#analysis-result");
  const review = document.querySelector("#review-input").value.trim();
  if (!review) return;

  button.disabled = true;
  button.firstChild.textContent = "Analyzing... ";
  try {
    const data = await requestJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review }),
    });
    result.dataset.sentiment = data.sentiment;
    result.querySelector("strong").textContent = `Sentiment: ${data.sentiment.toUpperCase()}`;
    result.querySelector("div span").textContent = `Confidence: ${data.confidence.toFixed(2)}%`;
    document.querySelector("#review-input").value = "";
    document.querySelector("#review-input").dispatchEvent(new Event("input", { bubbles: true }));
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Analyze review ";
  }
});

document.querySelector("#load-trends").addEventListener("click", loadTrends);

document.querySelector("#delete-all-input-reviews").addEventListener("click", async (event) => {
  if (!window.confirm("Delete all individually analyzed reviews? Reviews from uploaded datasets will be kept.")) return;

  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await requestJson("/api/reviews", { method: "DELETE" });
    await loadDashboard();
    showToast(data.message);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
});

document.querySelector("#dataset-upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#dataset-upload-button");
  button.disabled = true;
  button.firstChild.textContent = "Analyzing dataset... ";
  try {
    const data = await requestJson("/api/datasets", {
      method: "POST",
      body: new FormData(form),
    });
    form.reset();
    await Promise.all([loadDatasets(), loadDashboard()]);
    showToast(`Analyzed ${data.dataset.row_count.toLocaleString()} reviews from ${data.dataset.filename}.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Upload and analyze ";
  }
});

document.querySelector("#refresh-datasets").addEventListener("click", loadDatasets);

document.querySelector("#generate-summary").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const content = document.querySelector("#summary-content");
  button.disabled = true;
  button.firstChild.textContent = "Generating... ";
  content.textContent = "Gathering themes from saved feedback...";
  try {
    const data = await requestJson("/api/summary", { method: "POST" });
    renderSummary(data.summary || "No summary was returned.", content);
  } catch (error) {
    content.textContent = "";
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message;
    content.append(message);
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Generate summary ";
  }
});

loadDashboard();