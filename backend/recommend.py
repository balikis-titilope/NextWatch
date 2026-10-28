"""
recommend.py
The recommendation engine's Python side: TMDB access, the taste math, and the
live resolve of titles that are not in the catalog yet.

The catalog and every embedding live in Postgres (spec 0013); nothing is held
in memory. Ranking happens in SQL (db/engine.py). This module builds a user's
taste vector from the embeddings of their rated titles, calibrates scores, and
fetches and stores a title the catalog does not have.

Titles resolve in this order:
1. Match in the catalog (a typed title, or an exact id and media type).
2. Otherwise fetch it live from TMDB (movie or TV, whichever matches) and
   write it through the shared catalog writer.
A vector is only needed by some callers; when the model is still loading they
get ModelNotReady (the API answers 503 with Retry-After).
"""

import os
import numpy as np
import requests
from dotenv import load_dotenv
from difflib import SequenceMatcher

from db.catalog import (
    EMBEDDING_MODEL, build_combined_text, catalog_is_full, write_catalog_rows, write_details_row,
)
from db.details import (
    DEFAULT_COUNTRY, fetch_detail_row, fetch_provider_cache, is_fresh, save_provider_cache,
)
from db.embedder import ModelNotReady, get_model, peek_model
from db.engine import fetch_card, fetch_embedding, find_title_local, save_embedding
from db.pool import connection

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

# ---------- TMDB HELPERS (shared logic, same pattern as fetch_movies.py) ----------

# What one bundled TMDB detail request asks for, per media type.
APPEND_MOVIE = "keywords,credits,videos,watch/providers"
APPEND_TV = "aggregate_credits,keywords,videos,watch/providers"

def get_json(endpoint: str, params: dict = None):
    if params is None:
        params = {}
    response = requests.get(f"{BASE}{endpoint}", headers=HEADERS, params=params, timeout=20)
    response.raise_for_status()
    return response.json()

_LEADING_ARTICLES = ("the ", "a ", "an ")

def titles_match(a, b, cutoff=0.9):
    """
    True if two titles are confidently the same title -- exact
    (case-insensitive), one with a leading article dropped, or within a
    strict fuzzy cutoff for typo-level edits. The cutoff is high on
    purpose: a looser one also matches unrelated words that happen to
    share letters or a word order swap -- 'study group' vs TMDB's top
    hit 'group study' scores 0.45, nowhere near a real match.
    """
    a, b = a.lower().strip(), b.lower().strip()
    for article in _LEADING_ARTICLES:
        stripped_a = a[len(article):] if a.startswith(article) else a
        stripped_b = b[len(article):] if b.startswith(article) else b
        if stripped_a == stripped_b:
            return True
    return SequenceMatcher(None, a, b).ratio() >= cutoff

def search_tmdb_title(title):
    """
    Search both TMDB /search/movie and /search/tv, returning whichever
    catalog has a confident title match (titles_match) -- the fix for
    the bug this spec exists for (a TV-only title like "The Manipulated"
    or "Moon Lovers: Scarlet Heart Ryeo" never lived in /search/movie).
    When both catalogs return a confident match for the same typed
    title (a movie and a TV show can share a name, e.g. "Fargo"), the
    one with higher popularity wins, then higher vote_count as the
    tie-break (spec 0010's Key invariants).

    Returns (id, media_type), or (None, None) if neither catalog has a
    confident match. Used ONLY by /movies/resolve and the free-text
    resolve path (get_movie_embedding) -- /movies/search (local
    typeahead) stays local-only and never calls this.
    """
    movie_results = get_json("/search/movie", {"query": title}).get("results", [])
    tv_results = get_json("/search/tv", {"query": title}).get("results", [])

    movie_hit = movie_results[0] if movie_results and titles_match(title, movie_results[0]["title"]) else None
    tv_hit = tv_results[0] if tv_results and titles_match(title, tv_results[0]["name"]) else None

    if movie_hit and tv_hit:
        movie_key = (movie_hit.get("popularity") or 0, movie_hit.get("vote_count") or 0)
        tv_key = (tv_hit.get("popularity") or 0, tv_hit.get("vote_count") or 0)
        return (movie_hit["id"], "movie") if movie_key >= tv_key else (tv_hit["id"], "tv")
    if movie_hit:
        return movie_hit["id"], "movie"
    if tv_hit:
        return tv_hit["id"], "tv"
    return None, None

def _enrich_movie_details(details, media_type="movie"):
    """
    Extract keywords/cast/cast_photos/director/trailer_keys/watch_providers
    from a raw TMDB /movie/{id} or /tv/{id} response into the flat fields
    the rest of the pipeline expects. Shared by every TMDB detail fetch
    path (spec 0005, extended for TV by spec 0010) so they can't drift
    apart -- watch_providers is kept as the full, unflattened per-country
    dict (not reduced to one region here; that happens per-request
    against the requesting user's own country, see GET /movies/{media_type}/{id}).

    TV's /tv/{id} shape differs from /movie/{id} in three ways this
    function handles: aggregate_credits (full series cast across
    seasons) instead of credits; TV crew data has no "Director" job the
    way movie crew does, so director holds created_by's names instead;
    and the keywords response nests under "results", not "keywords" like
    the movie endpoint.
    """
    if media_type == "tv":
        details["keywords"] = [k["name"] for k in details.get("keywords", {}).get("results", [])]
        cast = details.get("aggregate_credits", {}).get("cast", [])
        details["director"] = [c["name"] for c in details.get("created_by", [])]
    else:
        details["keywords"] = [k["name"] for k in details.get("keywords", {}).get("keywords", [])]
        cast = details.get("credits", {}).get("cast", [])
        crew = details.get("credits", {}).get("crew", [])
        details["director"] = [c["name"] for c in crew if c.get("job") == "Director"]

    details["cast"] = [c["name"] for c in cast[:10]]
    details["cast_photos"] = [
        {"name": c["name"], "profile_path": c.get("profile_path")} for c in cast[:10]
    ]

    videos = details.get("videos", {}).get("results", [])
    details["trailer_keys"] = [
        v["key"] for v in videos
        if v.get("site") == "YouTube" and v.get("type") == "Trailer"
    ]

    details["watch_providers"] = details.get("watch/providers", {}).get("results", {})
    details["media_type"] = media_type

    return details

def fetch_movie_details(movie_id, media_type="movie", retries=3, wait=2):
    """
    Same pattern as fetch_movies.py — one bundled request per title, kept
    at the same field capture (spec 0005) so a live-resolved title
    behaves identically to one loaded from the bulk CSV. Used by the
    title-based resolve path (get_movie_embedding); see
    fetch_movie_details_by_id for the id-based path, which distinguishes
    a genuine 404.
    """
    import time
    endpoint = f"/tv/{movie_id}" if media_type == "tv" else f"/movie/{movie_id}"
    append = APPEND_TV if media_type == "tv" else APPEND_MOVIE
    for attempt in range(retries):
        try:
            details = get_json(endpoint, {"append_to_response": append})
            return _enrich_movie_details(details, media_type)
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for {media_type} {movie_id}: {e}")
            time.sleep(wait)
    print(f"    Giving up on {media_type} {movie_id} after {retries} attempts")
    return None

def fetch_movie_details_by_id(movie_id, media_type="movie", retries=3, wait=2):
    """
    Direct TMDB /movie/{id} or /tv/{id} fetch for the id-based endpoints
    (GET /movies/{media_type}/{id} and its /similar route), which already
    have a real id and skip title search entirely. Distinguishes a
    genuine 404 (the id doesn't exist on TMDB, no point retrying) from a
    transient failure (network error, timeout, a 5xx — retried, then
    surfaced as a clear failure), per spec 0005 AC-10.

    Returns (details, error): error is None on success, "not_found" on a
    real 404, "fetch_failed" once retries are exhausted on anything else.
    """
    import time
    endpoint = f"/tv/{movie_id}" if media_type == "tv" else f"/movie/{movie_id}"
    append = APPEND_TV if media_type == "tv" else APPEND_MOVIE
    for attempt in range(retries):
        try:
            response = requests.get(
                f"{BASE}{endpoint}",
                headers=HEADERS,
                params={"append_to_response": append},
                timeout=20,
            )
            if response.status_code == 404:
                return None, "not_found"
            response.raise_for_status()
            return _enrich_movie_details(response.json(), media_type), None
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for {media_type} {movie_id}: {e}")
            time.sleep(wait)
    return None, "fetch_failed"

# ---------- ROW BUILDING ----------

def build_movie_row(details, media_type="movie"):
    """
    Map a freshly TMDB-fetched title into the column shape the shared catalog
    writer (db.catalog.write_catalog_rows) takes, so a live-fetched title is
    stored exactly like one from the bulk load (spec 0005, extended for TV by
    spec 0010, one writer by spec 0013).

    Field renames a TV payload needs: name -> title, first_air_date ->
    release_date, episode_run_time's first value -> episode_runtime,
    origin_country -> production_countries (TV has no production_countries
    field of its own), runtime left null (TV has no single total runtime).
    combined_text comes from the one shared builder, so every writer embeds
    the same text format.
    """
    is_tv = media_type == "tv"
    episode_run_times = details.get("episode_run_time") or []

    row = {
        "id": details["id"],
        "media_type": media_type,
        "title": details.get("name") if is_tv else details.get("title"),
        "overview": details.get("overview") or "",
        "genres": "|".join(g["name"] for g in details.get("genres", [])),
        "keywords": "|".join(details.get("keywords", [])),
        "cast": "|".join(details.get("cast", [])),
        "director": "|".join(details.get("director", [])),
        "release_date": details.get("first_air_date") if is_tv else details.get("release_date"),
        "original_language": details.get("original_language"),
        "production_countries": (
            "|".join(details.get("origin_country", [])) if is_tv
            else "|".join(c.get("iso_3166_1", "") for c in details.get("production_countries", []))
        ),
        "vote_average": details.get("vote_average"),
        "vote_count": details.get("vote_count"),
        "poster_path": details.get("poster_path"),
        "backdrop_path": details.get("backdrop_path"),
        "runtime": None if is_tv else details.get("runtime"),
        "status": details.get("status"),
        "number_of_seasons": details.get("number_of_seasons") if is_tv else None,
        "number_of_episodes": details.get("number_of_episodes") if is_tv else None,
        "episode_runtime": (episode_run_times[0] if episode_run_times else None) if is_tv else None,
        "tagline": details.get("tagline") or "",
        "popularity": details.get("popularity"),
        "trailer_keys": "|".join(details.get("trailer_keys", [])),
        "cast_photos": details.get("cast_photos", []),
    }
    row["combined_text"] = build_combined_text(row)
    return row

# ---------- TASTE MATH (on rows of (rating, embedding) read from Postgres) ----------
# Ranking itself happens in SQL (db/engine.py), so no matrix is held here.

def cosine(a, b):
    """Cosine similarity of two vectors; 0.0 when either has no length."""
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / norm) if norm > 0 else 0.0

def predict_user_interest(user_embedding, movie_embedding):
    """Cosine similarity between a user's taste vector and one title's vector."""
    return cosine(user_embedding, movie_embedding)

def taste_vector_from_rows(rows, neutral_point=3):
    """
    rows: (rating, embedding) pairs for the titles a user rated. Ratings above
    neutral_point pull the taste vector toward that title, below push away,
    and exactly neutral contribute nothing. Divided by total conviction (the
    sum of the distances from neutral), not by the count of ratings.
    None when there is no usable signal (no rows, every rating neutral) or the
    result has no length, so a zero vector never reaches the database.
    """
    if not rows:
        return None
    weights = np.array([rating - neutral_point for rating, _ in rows], dtype=np.float64)
    if np.all(weights == 0):
        return None
    vectors = np.array([embedding for _, embedding in rows], dtype=np.float64)
    taste = (vectors * weights[:, np.newaxis]).sum(axis=0) / np.abs(weights).sum()
    return taste if np.linalg.norm(taste) > 0 else None

def personal_ceiling_from_rows(rows, taste_vector):
    """
    The average cosine similarity of the user's own 4 and 5 star titles to
    their taste vector (spec 0005 AC-2). None when there is nothing to
    calibrate against.
    """
    liked = [cosine(taste_vector, embedding) for rating, embedding in rows if rating >= 4]
    return float(np.mean(liked)) if liked else None

def calibrated_score(raw_similarity, ceiling):
    """
    Spec 0005 AC-2: clamp(raw / ceiling, 0, 1) * 100, rounded to a whole
    number percentage. None whenever there's no basis to compute one (a
    missing raw similarity, or no ceiling) -- never 0, which would misread
    as "definitely not a match" rather than "no data yet".
    """
    if raw_similarity is None or ceiling is None or ceiling <= 0:
        return None
    ratio = max(0.0, min(1.0, raw_similarity / ceiling))
    return round(ratio * 100)

def mean_vector(vectors):
    """The average of several vectors, the taste of a list of liked titles."""
    return np.mean(vectors, axis=0)

def build_mood_vector(mood_text, model=None):
    """
    Encode free-text mood ('feeling grumpy, want something uplifting') into a
    vector in the same space as the title embeddings. Raises ModelNotReady
    while the model is still loading.
    """
    return (model or get_model()).encode([mood_text])[0]

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

def cards_from_ranked(ranked, ceiling, score_key="taste_similarity"):
    """
    Spec 0005's shared card shape from engine rows. score_key picks the raw
    similarity that gets calibrated: taste_similarity for the user's own
    match score, similarity with ceiling 1.0 for plain closeness to a source
    title.
    """
    cards = []
    for row in ranked:
        card = {
            "id": int(row["id"]),
            "media_type": row["media_type"],
            "title": row["title"],
            "release_date": row["release_date"].isoformat() if row["release_date"] else None,
            "poster_path": row["poster_path"],
            "predicted_score": calibrated_score(row[score_key], ceiling),
        }
        # Only /movies/trending's rows carry this (Home's hero carousel);
        # every other endpoint keeps spec 0005's exact card shape.
        if "backdrop_path" in row:
            card["backdrop_path"] = row["backdrop_path"]
        cards.append(card)
    return cards

# ---------- WATCH PROVIDERS ----------

PROVIDER_TIMEOUT_SECONDS = 3  # one short call, no retries (spec 0013, AC-5)
_PROVIDER_KEYS = ("flatrate", "rent", "buy")

def resolve_provider_payload(results, country):
    """
    The full multi country watch/providers payload resolved down to one region
    (the requested country, then NG, then US, spec 0005 AC-7), kept as
    {flatrate, rent, buy}, each a list of {provider_name, logo_path}. This is
    the form stored in watch_provider_cache.
    """
    results = results or {}
    region = results.get(country) if country else None
    if region is None:
        region = results.get("NG") or results.get("US") or {}
    return {
        key: [
            {"provider_name": p.get("provider_name"), "logo_path": p.get("logo_path")}
            for p in region.get(key, [])
        ]
        for key in _PROVIDER_KEYS
    }

def providers_response(payload):
    """A stored payload as the API shape: stream, rent, buy, each {name, logo_path}."""
    payload = payload or {}
    def listed(key):
        return [
            {"name": p.get("provider_name"), "logo_path": p.get("logo_path")}
            for p in payload.get(key, [])
        ]
    return {"stream": listed("flatrate"), "rent": listed("rent"), "buy": listed("buy")}

def resolve_watch_providers(watch_providers_json, country):
    """Spec 0005 AC-7: the multi country payload resolved to one country, in the API shape."""
    return providers_response(resolve_provider_payload(watch_providers_json, country))

def fetch_provider_results(movie_id, media_type):
    """One TMDB call for a title's watch providers, all countries. Raises on any failure."""
    response = requests.get(
        f"{BASE}/{media_type}/{movie_id}/watch/providers",
        headers=HEADERS, timeout=PROVIDER_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json().get("results", {})

def get_watch_providers(movie_id, media_type, country):
    """
    Providers for the detail screen (spec 0013, AC-5). A cached row younger
    than 24 hours is one read. Otherwise one short TMDB call, resolved through
    the country fallback and stored under the requested country key. If TMDB
    fails, a stale row is served when there is one, else empty providers; the
    detail still loads either way.
    """
    country = country or DEFAULT_COUNTRY
    with connection() as conn, conn.cursor() as cur:
        cached, fetched_at = fetch_provider_cache(cur, movie_id, media_type, country)
    if cached is not None and is_fresh(fetched_at):
        return providers_response(cached)

    try:
        results = fetch_provider_results(movie_id, media_type)
    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"watch providers fetch failed for {media_type} {movie_id}: {e}")
        return providers_response(cached)

    payload = resolve_provider_payload(results, country)
    try:
        with connection() as conn, conn.cursor() as cur:
            save_provider_cache(cur, movie_id, media_type, country, payload)
    except Exception as e:
        print(f"watch providers cache write failed for {media_type} {movie_id}: {e}")
    return providers_response(payload)

# ---------- POSTGRES TITLES: VECTORS, LIVE RESOLVE, DETAIL ----------

class CatalogFull(Exception):
    """The database is at the hard ceiling, so no new title is accepted."""

class TmdbUnavailable(Exception):
    """TMDB could not be reached or gave no usable answer."""

def get_vector(movie_id, media_type):
    """
    (found, vector) for one stored title. A row with no embedding yet is
    embedded from its stored combined_text and saved. found is False when the
    title is not in the catalog. Raises ModelNotReady when the row needs an
    embedding and the model is still loading.
    """
    with connection() as conn, conn.cursor() as cur:
        found, vector, combined_text = fetch_embedding(cur, movie_id, media_type)
    if not found or vector is not None:
        return found, vector
    vector = get_model().encode([combined_text or ""])[0]
    with connection() as conn, conn.cursor() as cur:
        save_embedding(cur, movie_id, media_type, vector, EMBEDDING_MODEL)
    return True, vector

def store_new_title(details, media_type):
    """
    Write a title fetched from TMDB and its details row in one transaction
    (spec 0013, AC-6). Refuses with CatalogFull at the hard ceiling (cap plus
    100 MB). The vector is computed when the model is ready; otherwise the
    row is written with a null embedding so the title can be rated at once.
    A row another request wrote first is kept, and only gets its embedding
    filled in if it had none. Returns the vector, or None when there was none.
    """
    with connection() as conn, conn.cursor() as cur:
        if catalog_is_full(cur):
            raise CatalogFull("The catalog is full, so new titles cannot be added right now")
    row = build_movie_row(details, media_type)
    model = peek_model()
    vector = model.encode([row["combined_text"]])[0] if model is not None else None
    row["embedding"] = vector
    with connection() as conn, conn.cursor() as cur:
        write_catalog_rows(cur, [row])
    return vector

def _tmdb(call, *args, **kwargs):
    """Run a TMDB helper, turning a network failure into TmdbUnavailable."""
    try:
        return call(*args, **kwargs)
    except (requests.exceptions.RequestException, ValueError) as e:
        raise TmdbUnavailable(str(e))

def resolve_title_to_vector(title):
    """
    A typed title to (id, media_type, vector): matched in the catalog first
    (no media type hint), otherwise searched on TMDB and stored. After TMDB
    names an id, the catalog is checked for it before anything is fetched or
    embedded. (None, None, None) when nothing matches. Raises ModelNotReady
    when the vector is needed and the model is not ready, CatalogFull, or
    TmdbUnavailable.
    """
    with connection() as conn, conn.cursor() as cur:
        movie_id, media_type = find_title_local(cur, title)
    if movie_id is not None:
        _, vector = get_vector(movie_id, media_type)
        return movie_id, media_type, vector

    movie_id, media_type = _tmdb(search_tmdb_title, title)
    if movie_id is None:
        print(f"No TMDB match found for '{title}'")
        return None, None, None

    found, vector = get_vector(movie_id, media_type)
    if found:
        return movie_id, media_type, vector

    details = _tmdb(fetch_movie_details, movie_id, media_type)
    if details is None:
        raise TmdbUnavailable(f"could not fetch {media_type} {movie_id}")
    vector = store_new_title(details, media_type)
    if vector is None:
        _, vector = get_vector(movie_id, media_type)  # raises ModelNotReady
    return movie_id, media_type, vector

def resolve_id_to_vector(movie_id, media_type):
    """
    An exact (id, media_type) to (vector, error), no title search. error is
    None on success, "not_found" or "fetch_failed" when the title is not in
    the catalog and TMDB cannot supply it (spec 0005 AC-10). Raises
    ModelNotReady when the vector is needed and the model is not ready.
    """
    found, vector = get_vector(movie_id, media_type)
    if found:
        return vector, None
    details, error = fetch_movie_details_by_id(movie_id, media_type)
    if details is None:
        return None, error
    vector = store_new_title(details, media_type)
    if vector is None:
        _, vector = get_vector(movie_id, media_type)  # raises ModelNotReady
    return vector, None

def resolve_catalog_title(title):
    """
    POST /movies/resolve: a typed title to a card ready to rate (spec 0013,
    AC-6). Matched in the catalog first, otherwise fetched from TMDB and
    written. Never needs the model: a title written while it loads gets a null
    embedding, and a local row with a null embedding is filled in when the
    model is ready. None when nothing matches. Raises CatalogFull or
    TmdbUnavailable.
    """
    with connection() as conn, conn.cursor() as cur:
        movie_id, media_type = find_title_local(cur, title)

    if movie_id is None:
        movie_id, media_type = _tmdb(search_tmdb_title, title)
        if movie_id is None:
            return None
        with connection() as conn, conn.cursor() as cur:
            found, _, _ = fetch_embedding(cur, movie_id, media_type)
        if not found:
            details = _tmdb(fetch_movie_details, movie_id, media_type)
            if details is None:
                raise TmdbUnavailable(f"could not fetch {media_type} {movie_id}")
            store_new_title(details, media_type)

    if peek_model() is not None:
        try:
            get_vector(movie_id, media_type)  # fills a null embedding when the model is ready
        except ModelNotReady:
            pass
    with connection() as conn, conn.cursor() as cur:
        return fetch_card(cur, movie_id, media_type)

def load_detail(movie_id, media_type):
    """
    The detail row for a title (spec 0013, AC-5), as (row, error). A title not
    in the catalog is fetched from TMDB by id and written first. A title with
    no details row has it fetched once and written; if that fetch fails the
    base fields are served without it. error is "not_found" or "fetch_failed"
    only when there is nothing to serve. Raises CatalogFull.
    """
    with connection() as conn, conn.cursor() as cur:
        row = fetch_detail_row(cur, movie_id, media_type)

    if row is None:
        details, error = fetch_movie_details_by_id(movie_id, media_type)
        if details is None:
            return None, error
        store_new_title(details, media_type)
    elif not row["has_details"]:
        details, _ = fetch_movie_details_by_id(movie_id, media_type, retries=1, wait=0)
        if details is None:
            return row, None
        detail_row = build_movie_row(details, media_type)
        with connection() as conn, conn.cursor() as cur:
            write_details_row(cur, detail_row)
    else:
        return row, None

    with connection() as conn, conn.cursor() as cur:
        return fetch_detail_row(cur, movie_id, media_type), None
