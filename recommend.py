"""
recommend.py
The recommendation engine: loads movie data, builds embeddings, and
provides functions to recommend movies and predict user interest.

Pipeline overview:
1. Load & clean data (data/movies_test.csv while testing, movies.csv for real)
2. Build combined_text per movie (overview + genres + keywords + tagline)
3. Generate embeddings for every movie using sentence-transformers
4. Build a title -> row index dict for fast lookups
5. Use cosine similarity for:
   - "movies similar to this movie" (recommend_similar)
   - "movies similar to this user's taste" (build_user_profile + predict)
6. If a liked movie isn't in the local dataset, fetch it live from TMDB
   and cache it into df/embeddings/title_to_index so it's never re-fetched
"""

import os
import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from difflib import get_close_matches

# ---------- SETUP ----------

load_dotenv()

TMDB_TOKEN = os.getenv("TMDB_TOKEN")
if not TMDB_TOKEN:
    raise ValueError("TMDB_TOKEN not found. Check your .env file.")

BASE = "https://api.themoviedb.org/3"
HEADERS = {
    "accept": "application/json",
    "Authorization": f"Bearer {TMDB_TOKEN}"
}

DATA_PATH = "data/movies_test.csv"  # swap to "data/movies.csv" once the full fetch is done

# ---------- TMDB HELPERS (shared logic, same pattern as fetch_movies.py) ----------

def get_json(endpoint: str, params: dict = None):
    if params is None:
        params = {}
    response = requests.get(f"{BASE}{endpoint}", headers=HEADERS, params=params, timeout=20)
    response.raise_for_status()
    return response.json()

def search_tmdb_movie(title):
    """Search TMDB for a title, return the top match's movie_id (or None)."""
    result = get_json("/search/movie", {"query": title})
    results = result.get("results", [])
    return results[0]["id"] if results else None

def fetch_movie_details(movie_id, retries=3, wait=2):
    """Same pattern as fetch_movies.py — one bundled request per movie."""
    import time
    for attempt in range(retries):
        try:
            details = get_json(f"/movie/{movie_id}", {
                "append_to_response": "keywords,credits,videos,watch/providers"
            })
            details["keywords"] = [k["name"] for k in details.get("keywords", {}).get("keywords", [])]
            return details
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for movie {movie_id}: {e}")
            time.sleep(wait)
    print(f"    Giving up on movie {movie_id} after {retries} attempts")
    return None

# ---------- DATA LOADING & TEXT PREPARATION ----------

def load_and_prepare_data(path=DATA_PATH):
    """Load the CSV, fill missing text fields, build combined_text."""
    df = pd.read_csv(path)

    df["overview"] = df["overview"].fillna("")
    df["genres"] = df["genres"].fillna("")
    df["keywords"] = df["keywords"].fillna("")
    df["tagline"] = df["tagline"].fillna("")

    df["combined_text"] = (
        df["overview"] + " " +
        df["genres"].str.replace("|", " ", regex=False) + " " +
        df["keywords"].str.replace("|", " ", regex=False) + " " +
        df["tagline"]
    )

    return df

def build_movie_text(details):
    """
    Build the same combined_text format for a movie fetched live from
    TMDB (not yet in df) — must match load_and_prepare_data's format
    so the embedding space stays consistent.
    """
    overview = details.get("overview") or ""
    genres = "|".join(g["name"] for g in details.get("genres", [])).replace("|", " ")
    keywords = "|".join(details.get("keywords", [])).replace("|", " ")
    tagline = details.get("tagline") or ""
    return f"{overview} {genres} {keywords} {tagline}"

# ---------- EMBEDDINGS ----------

def load_model():
    return SentenceTransformer("all-MiniLM-L6-v2")

def generate_embeddings(df, model):
    return model.encode(df["combined_text"].tolist(), show_progress_bar=True)

def build_title_index(df):
    """title (lowercase) -> row index, for fast lookups instead of scanning df."""
    return {title.lower(): idx for title, idx in zip(df["title"], df.index)}

# ---------- CORE RECOMMENDATION FUNCTIONS ----------

def recommend_similar(movie_index, df, embeddings, top_n=5):
    """Given a movie's row index, return the top_n most similar movies."""
    target_vector = embeddings[movie_index].reshape(1, -1)
    similarities = cosine_similarity(target_vector, embeddings)[0]

    similar_indices = similarities.argsort()[::-1][1:top_n + 1]  # skip itself (index 0 after sort)

    return df.iloc[similar_indices][["title", "release_date"]].assign(
        similarity=similarities[similar_indices]
    )

def resolve_title(title, title_to_index, cutoff=0.75):
    """
    Try an exact match first, then a fuzzy match against known local
    titles (catches things like 'the titanic' -> 'titanic'). Returns
    None if nothing close enough is found locally — caller should then
    fall back to TMDB search, which handles short/ambiguous queries
    like 'titan' better than local fuzzy matching would.
    """
    key = title.lower()

    if key in title_to_index:
        return key

    close = get_close_matches(key, title_to_index.keys(), n=1, cutoff=cutoff)
    return close[0] if close else None

def get_movie_embedding(title, df, embeddings, title_to_index, model):
    """
    Resolve a title to its embedding — from the local dataset (exact or
    close fuzzy match) if present, otherwise fetched live from TMDB and
    cached into df/embeddings/title_to_index so it's never re-fetched
    again this session.

    Returns (df, embeddings, title_to_index, vector, resolved_index).
    resolved_index is the actual row index matched/added — callers should
    use THIS for exclusion logic, not re-derive it from the raw title
    string, since fuzzy matching means the matched key can differ from
    what the user typed.
    """
    matched_key = resolve_title(title, title_to_index)
    if matched_key is not None:
        idx = title_to_index[matched_key]
        return df, embeddings, title_to_index, embeddings[idx], idx

    key = title.lower()
    movie_id = search_tmdb_movie(title)
    if movie_id is None:
        print(f"No TMDB match found for '{title}'")
        return df, embeddings, title_to_index, None, None

    details = fetch_movie_details(movie_id)
    if details is None:
        return df, embeddings, title_to_index, None, None

    text = build_movie_text(details)
    new_vector = model.encode([text])[0]

    new_row = pd.DataFrame([{
        "id": details["id"],
        "title": details["title"],
        "combined_text": text
    }])
    df = pd.concat([df, new_row], ignore_index=True)
    embeddings = np.vstack([embeddings, new_vector])

    new_idx = df.index[-1]
    title_to_index[key] = new_idx

    return df, embeddings, title_to_index, new_vector, new_idx

def build_user_profile(liked_titles, df, embeddings, title_to_index, model):
    """
    Average the embeddings of every liked movie into one taste vector.
    Handles titles not yet in the local dataset via get_movie_embedding.
    Also returns resolved_indices — the actual row indices matched for
    each liked title, for correct exclusion later (don't re-derive this
    from raw title strings, since fuzzy matching can shift the key used).
    """
    vectors = []
    resolved_indices = []
    for title in liked_titles:
        df, embeddings, title_to_index, vector, idx = get_movie_embedding(
            title, df, embeddings, title_to_index, model
        )
        if vector is not None:
            vectors.append(vector)
            resolved_indices.append(idx)

    if not vectors:
        raise ValueError("None of the liked titles could be resolved to an embedding.")

    user_embedding = np.mean(vectors, axis=0)
    return df, embeddings, title_to_index, user_embedding, resolved_indices

def build_user_profile_from_ratings(ratings, df, embeddings, neutral_point=3):
    """
    ratings: list of (movie_id, title, rating) tuples.
    Ratings above neutral_point pull the taste vector toward that movie's
    theme; ratings below it push away; a rating exactly at neutral_point
    contributes nothing (genuinely indifferent).
    """
    vectors = []
    signed_weights = []

    for movie_id, title, rating in ratings:
        idx = df[df["id"] == movie_id].index
        if len(idx) == 0:
            continue
        vectors.append(embeddings[idx[0]])
        signed_weights.append(rating - neutral_point)

    vectors = np.array(vectors)
    signed_weights = np.array(signed_weights)

    if np.all(signed_weights == 0):
        raise ValueError("All ratings are neutral — no clear preference signal.")

    # Weighted sum, normalized by total CONVICTION (magnitude of
    # preference, ignoring direction) — not just the count of ratings.
    weighted_sum = np.sum(vectors * signed_weights[:, np.newaxis], axis=0)
    total_conviction = np.sum(np.abs(signed_weights))

    user_embedding = weighted_sum / total_conviction
    return user_embedding

def predict_user_interest(user_embedding, movie_embedding):
    """Cosine similarity between a user's taste vector and one movie's vector."""
    score = cosine_similarity([user_embedding], [movie_embedding])[0][0]
    return score

def build_mood_vector(mood_text, model):
    """
    Encode free-text mood/sentiment ('feeling grumpy, want something uplifting')
    into a vector in the SAME space as movie embeddings and taste vectors,
    since it's the same model doing the encoding.
    """
    return model.encode([mood_text])[0]

def combine_vectors(user_embedding=None, mood_embedding=None, mood_weight=0.5):
    """
    Blend a user's taste vector with a mood vector, rather than letting
    either one override the other. mood_weight controls the balance:
    0.5 = equal blend, closer to 1 = mood dominates, closer to 0 = taste dominates.

    Handles the case where only one of the two is available.
    """
    if user_embedding is not None and mood_embedding is not None:
        return (1 - mood_weight) * user_embedding + mood_weight * mood_embedding
    if mood_embedding is not None:
        return mood_embedding
    if user_embedding is not None:
        return user_embedding
    raise ValueError("At least one of user_embedding or mood_embedding is required.")

def recommend_popular(df, top_n=10, min_vote_count=50):
    """
    Cold-start fallback: no liked movies, no mood text — nothing to
    personalize with, so recommend by quality/popularity instead of
    guessing. min_vote_count avoids surfacing obscure titles with a
    single 10/10 vote.
    """
    reliable = df[df["vote_count"] >= min_vote_count]
    ranked = reliable.sort_values(["vote_average", "popularity"], ascending=False)
    return ranked.head(top_n)[["title", "release_date", "vote_average", "popularity"]]

def recommend_for_user(query_embedding, df, embeddings, top_n=10, exclude_indices=None):
    """
    Rank every movie in df by similarity to a query vector — this can be
    a pure taste vector, a pure mood vector, or a blend of both (see
    combine_vectors). This function doesn't care which — it just ranks
    against whatever vector it's given.
    exclude_indices: row indices to skip (e.g. movies already rated).
    """
    similarities = cosine_similarity([query_embedding], embeddings)[0]

    ranked_indices = similarities.argsort()[::-1]

    if exclude_indices:
        ranked_indices = [i for i in ranked_indices if i not in exclude_indices]

    top_indices = ranked_indices[:top_n]

    return df.iloc[top_indices][["title", "release_date"]].assign(
        predicted_score=similarities[top_indices]
    )

# ---------- COUNTRY / LANGUAGE FILTER ----------

def filter_by_language(df, language_code=None):
    """language_code e.g. 'ko', 'zh', 'en'. None = no filter, return everything."""
    if language_code is None:
        return df
    return df[df["original_language"] == language_code]

def filter_by_actor(df, actor_name=None):
    """Partial, case-insensitive match against the pipe-separated cast column."""
    if actor_name is None:
        return df
    return df[df["cast"].str.contains(actor_name, case=False, na=False)]

def filter_by_year_range(df, start_year=None, end_year=None):
    """
    Filter by release year. release_date is stored as text (e.g.
    '2026-07-15'), so it's converted to an actual date first —
    errors='coerce' turns any missing/malformed dates into NaT rather
    than crashing, and those rows naturally fail the range check.
    """
    if start_year is None and end_year is None:
        return df
    years = pd.to_datetime(df["release_date"], errors="coerce").dt.year
    mask = pd.Series(True, index=df.index)
    if start_year is not None:
        mask &= years >= start_year
    if end_year is not None:
        mask &= years <= end_year
    return df[mask]

# ---------- EXAMPLE USAGE ----------

if __name__ == "__main__":
    print("Loading data...")
    df = load_and_prepare_data()

    print("Loading model...")
    model = load_model()

    print("Generating embeddings...")
    embeddings = generate_embeddings(df, model)
    print(f"Embeddings shape: {embeddings.shape}")

    title_to_index = build_title_index(df)

    # Example 1: movies similar to a specific movie already in the dataset
    example_idx = 0
    print(f"\nMovies similar to '{df.iloc[example_idx]['title']}':")
    print(recommend_similar(example_idx, df, embeddings))

    # Example 2: build a user profile from liked titles (mix of local + TMDB fallback)
    liked_titles = ["The Odyssey", "Troy"]
    print(f"\nBuilding user profile from: {liked_titles}")
    df, embeddings, title_to_index, user_embedding, liked_indices = build_user_profile(
        liked_titles, df, embeddings, title_to_index, model
    )

    # Example 3: recommend movies for that user, excluding what they already liked
    # (liked_indices came directly from build_user_profile — the actual
    # resolved indices, not re-derived from raw title strings)
    print("\nRecommended for user:")
    print(recommend_for_user(user_embedding, df, embeddings, top_n=10, exclude_indices=liked_indices))

    # Example 4: predict interest in one specific candidate movie
    candidate_idx = 5
    score = predict_user_interest(user_embedding, embeddings[candidate_idx])
    print(f"\nPredicted interest in '{df.iloc[candidate_idx]['title']}': {score:.3f}")

    # Example 5: filter by language before recommending (e.g. Korean only)
    korean_df = filter_by_language(df, "ko")
    print(f"\nKorean-language movies in dataset: {len(korean_df)}")