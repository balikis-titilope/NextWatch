"""
main.py
FastAPI service wrapping recommend.py's functions behind HTTP endpoints.

Key design decision: df, embeddings, model, and title_to_index are all
loaded ONCE when the server starts (via the lifespan function) and kept
in memory as shared state — not reloaded on every request, since that
would make every single API call painfully slow.

A manual /admin/reload endpoint lets you refresh that shared state
on-demand (e.g. right after running a fresh fetch_movies.py), instead
of guessing with a timer.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from recommend import (
    load_and_prepare_data,
    load_model,
    generate_embeddings,
    build_title_index,
    build_user_profile,
    predict_user_interest,
    recommend_for_user,
    recommend_popular,
    build_mood_vector,
    combine_vectors,
    filter_by_language,
    filter_by_actor,
    filter_by_year_range,
    get_movie_embedding,
)

# ---------- SHARED STATE ----------
# A plain dict that holds everything expensive to (re)compute.
# Populated once at startup, updated only via /admin/reload.
state = {}

def load_all_data():
    print("Loading data and generating embeddings — this may take a moment...")
    df = load_and_prepare_data()
    model = load_model()
    embeddings = generate_embeddings(df, model)
    title_to_index = build_title_index(df)

    state["df"] = df
    state["model"] = model
    state["embeddings"] = embeddings
    state["title_to_index"] = title_to_index
    print(f"Loaded {len(df)} movies. Ready.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once, when the server starts
    load_all_data()
    yield
    # (code after yield would run on shutdown — nothing needed here yet)

app = FastAPI(title="Movie Discovery API", lifespan=lifespan)

# ---------- REQUEST/RESPONSE SHAPES ----------
# Pydantic models describe what a valid request body looks like.
# FastAPI uses these to validate incoming requests automatically.

class RecommendRequest(BaseModel):
    liked_titles: list[str] = []       # optional now — empty list is valid (cold start)
    mood_text: str | None = None       # e.g. "feeling grumpy, want something uplifting"
    mood_weight: float = 0.5           # 0 = ignore mood, 1 = ignore taste, 0.5 = equal blend
    top_n: int = 10
    language: str | None = None
    actor: str | None = None
    start_year: int | None = None
    end_year: int | None = None

class PredictRequest(BaseModel):
    liked_titles: list[str]
    candidate_title: str

# ---------- ENDPOINTS ----------

@app.get("/")
def root():
    return {"status": "ok", "movies_loaded": len(state["df"])}

@app.get("/movies/{title}/similar")
def similar_movies(title: str, top_n: int = 5):
    df = state["df"]
    embeddings = state["embeddings"]
    title_to_index = state["title_to_index"]
    model = state["model"]

    # Resolve locally (exact/fuzzy) or fetch+cache from TMDB if not found
    df, embeddings, title_to_index, target_vector, resolved_index = get_movie_embedding(
        title, df, embeddings, title_to_index, model
    )
    state["df"], state["embeddings"], state["title_to_index"] = df, embeddings, title_to_index

    if target_vector is None:
        raise HTTPException(status_code=404, detail=f"'{title}' could not be found on TMDB")

    # Exclude the movie itself from its own results (now using the
    # actual resolved index, not a re-derived string match)
    exclude = [resolved_index] if resolved_index is not None else None

    results = recommend_for_user(
        target_vector, df, embeddings, top_n=top_n, exclude_indices=exclude
    )
    output = results.to_dict(orient="records")
    for row in output:
        row["predicted_score"] = round(row["predicted_score"], 2)
    return output

@app.post("/recommend")
def recommend(req: RecommendRequest):
    df = state["df"]
    embeddings = state["embeddings"]
    title_to_index = state["title_to_index"]
    model = state["model"]

    has_liked = len(req.liked_titles) > 0
    has_mood = req.mood_text is not None and req.mood_text.strip() != ""

    # Cold start: nothing to personalize with at all — filters don't
    # need to account for any fetch, since nothing gets fetched here.
    if not has_liked and not has_mood:
        filtered_df = filter_by_language(df, req.language)
        filtered_df = filter_by_actor(filtered_df, req.actor)
        filtered_df = filter_by_year_range(filtered_df, req.start_year, req.end_year)
        if filtered_df.empty:
            raise HTTPException(status_code=404, detail="No movies match the given filters")
        results = recommend_popular(filtered_df, top_n=req.top_n)
        return results.to_dict(orient="records")

    user_embedding = None
    liked_indices = []

    # Resolve liked titles FIRST — this may fetch+cache new movies from
    # TMDB, growing df/embeddings. Filtering happens AFTER this, so any
    # freshly-fetched liked movie is already present when we filter.
    if has_liked:
        df, embeddings, title_to_index, user_embedding, liked_indices = build_user_profile(
            req.liked_titles, df, embeddings, title_to_index, model
        )
        state["df"], state["embeddings"], state["title_to_index"] = df, embeddings, title_to_index

    mood_embedding = build_mood_vector(req.mood_text, model) if has_mood else None

    # NOW apply filters, against the fully up-to-date df/embeddings
    filtered_df = df
    filtered_embeddings = embeddings
    if req.language or req.actor or req.start_year or req.end_year:
        filtered_df = filter_by_language(filtered_df, req.language)
        filtered_df = filter_by_actor(filtered_df, req.actor)
        filtered_df = filter_by_year_range(filtered_df, req.start_year, req.end_year)
        if filtered_df.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No movies match language='{req.language}' actor='{req.actor}' "
                    f"start_year={req.start_year} end_year={req.end_year}"
                )
            )
        filtered_embeddings = embeddings[filtered_df.index]

    query_embedding = combine_vectors(
        user_embedding=user_embedding,
        mood_embedding=mood_embedding,
        mood_weight=req.mood_weight
    )

    results = recommend_for_user(
        query_embedding, filtered_df, filtered_embeddings,
        top_n=req.top_n, exclude_indices=liked_indices
    )
    output = results.to_dict(orient="records")
    for row in output:
        row["predicted_score"] = round(row["predicted_score"], 2)
    return output

@app.post("/predict")
def predict(req: PredictRequest):
    df = state["df"]
    embeddings = state["embeddings"]
    title_to_index = state["title_to_index"]
    model = state["model"]

    # Step 1: resolve the user's taste vector from their liked titles.
    # May fetch+cache new movies, so df/embeddings/title_to_index can grow here.
    df, embeddings, title_to_index, user_embedding, liked_indices = build_user_profile(
        req.liked_titles, df, embeddings, title_to_index, model
    )

    # Step 2: resolve the candidate movie the SAME way, chaining from the
    # (possibly updated) state above — not a separate, disconnected call.
    df, embeddings, title_to_index, candidate_vector, candidate_index = get_movie_embedding(
        req.candidate_title, df, embeddings, title_to_index, model
    )

    # Step 3: persist whatever grew during steps 1-2 back into shared state
    state["df"], state["embeddings"], state["title_to_index"] = df, embeddings, title_to_index

    if candidate_vector is None:
        raise HTTPException(status_code=404, detail=f"'{req.candidate_title}' could not be found")

    score = predict_user_interest(user_embedding, candidate_vector)
    return {"candidate": req.candidate_title, "predicted_score": float(score)}

@app.get("/movies")
def browse_movies(
    language: str | None = None,
    actor: str | None = None,
    start_year: int | None = None,
    end_year: int | None = None,
    limit: int = 20
):
    df = state["df"]
    filtered = filter_by_language(df, language)
    filtered = filter_by_actor(filtered, actor)
    filtered = filter_by_year_range(filtered, start_year, end_year)
    return filtered.head(limit)[["id", "title", "original_language", "release_date", "genres"]].to_dict(orient="records")

@app.post("/admin/reload")
def reload_data():
    """Manually refresh the shared df/embeddings/model — call this after
    running a fresh fetch_movies.py to pick up new movies."""
    load_all_data()
    return {"status": "reloaded", "movies_loaded": len(state["df"])}