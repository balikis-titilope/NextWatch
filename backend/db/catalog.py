"""
db/catalog.py

Shared pieces for the pgvector catalog (spec 0013): the bulk load, the daily
refresh, and live resolve all import from here, so the text that gets
embedded, the vector format, and the row writer are built one way.

Kept free of side effects on import (no env checks, no connections) so a
script can use it without needing the full app configuration.
"""

import datetime
import json
import os

import numpy as np
import pandas as pd
from psycopg2.extras import Json, execute_values

# The one embedding model every writer uses (spec 0013's cross child
# contract): 384 numbers, unit length, float32. Stored on every row it
# writes, in movies.embedding_model.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# ---------- TEXT ----------

def safe_str(value):
    """
    Safely convert a value to a string for text-building, treating BOTH
    None and NaN as missing (unlike `value or ""`, which fails on NaN --
    NaN is truthy in Python, so `or` doesn't catch it, and calling
    .replace() on a float then crashes).
    """
    if value is None or pd.isna(value):
        return ""
    return str(value)

def build_combined_text(row):
    """
    The single builder of the text that gets embedded: overview, genres,
    keywords, tagline, in that order, with the pipe separators turned
    into spaces. Same format the embeddings were originally built from, so
    old and new vectors live in the same space.
    """
    overview = safe_str(row.get("overview"))
    genres = safe_str(row.get("genres")).replace("|", " ")
    keywords = safe_str(row.get("keywords")).replace("|", " ")
    tagline = safe_str(row.get("tagline"))
    return f"{overview} {genres} {keywords} {tagline}"

# ---------- VECTORS ----------

def vector_literal(array):
    """Text form pgvector accepts: '[0.1,0.2,...]', for use with a ::vector cast."""
    return "[" + ",".join(f"{float(x):.8g}" for x in array) + "]"

class Embedder:
    """
    Thin wrapper over fastembed's ONNX runtime, keeping the
    `encode(list_of_str) -> 2D numpy array` shape. Same all-MiniLM-L6-v2
    model as before, without PyTorch (the torch stack OOM'd the deployed
    container at startup). The model download folder comes from
    FASTEMBED_CACHE_PATH when set, so a container and a CI cache agree.
    """
    def __init__(self):
        from fastembed import TextEmbedding
        cache_dir = os.getenv("FASTEMBED_CACHE_PATH") or None
        self._model = TextEmbedding(EMBEDDING_MODEL, cache_dir=cache_dir)

    def encode(self, texts):
        return np.array(list(self._model.embed(texts)), dtype=np.float32)

# ---------- SQL TEXT ----------

def escape_like(text):
    """
    Escape %, _ and the escape character itself so user input is matched as
    plain text inside a LIKE or ILIKE pattern (use with ESCAPE '\\', which
    is Postgres's default).
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

# ---------- VALUE CLEANING ----------

def _none(value):
    """None for None/NaN/NaT, the native Python scalar for a numpy one."""
    if value is None:
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and np.isnan(value):
        return None
    if value is pd.NaT:
        return None
    return value

def _int(value):
    value = _none(value)
    return None if value is None else int(value)

def _float(value):
    value = _none(value)
    return None if value is None else float(value)

def _text(value):
    value = _none(value)
    return None if value is None else str(value)

def _date(value):
    """A date for a DATE column; None for empty or unparseable text."""
    value = _none(value)
    if value is None:
        return None
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value
    parsed = pd.to_datetime(str(value), errors="coerce")
    return None if pd.isna(parsed) else parsed.date()

# ---------- WRITER ----------

_MOVIE_COLUMNS = (
    "id, media_type, title, overview, genres, keywords, cast_members, director, "
    "release_date, original_language, production_countries, vote_average, "
    "vote_count, poster_path, combined_text, status, number_of_seasons, "
    "number_of_episodes, episode_runtime, embedding, embedding_model, popularity"
)
_MOVIE_TEMPLATE = (
    "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
    "%s::extensions.vector, %s, %s)"
)

# An existing row is only ever filled in, never overwritten: a vector, its
# model id, popularity, and combined_text are kept when already set. The
# model id follows the vector it describes, so they can never disagree.
_MOVIE_UPSERT = f"""
INSERT INTO movies ({_MOVIE_COLUMNS})
VALUES %s
ON CONFLICT (id, media_type) DO UPDATE SET
    embedding = COALESCE(movies.embedding, EXCLUDED.embedding),
    embedding_model = CASE WHEN movies.embedding IS NULL
                           THEN EXCLUDED.embedding_model
                           ELSE movies.embedding_model END,
    popularity = COALESCE(movies.popularity, EXCLUDED.popularity),
    combined_text = COALESCE(movies.combined_text, EXCLUDED.combined_text)
"""

_DETAILS_UPSERT = """
INSERT INTO movie_details (id, media_type, tagline, runtime, backdrop_path, trailer_keys, cast_photos)
VALUES %s
ON CONFLICT (id, media_type) DO NOTHING
"""

def write_catalog_rows(cur, rows, page_size=500):
    """
    The one writer of catalog rows (the bulk load, the daily refresh, and
    live resolve all call it): upserts the movies rows and their
    movie_details rows on the cursor's open transaction, so the caller
    decides when to commit.

    Each row is a dict with the movies columns (cast_members is passed as
    "cast"), plus tagline/runtime/backdrop_path/trailer_keys/cast_photos for
    the details row and an optional "embedding" (a float32 array, or None,
    for a title resolved while the model was still loading). The batch is
    deduplicated on (id, media_type) first (last one wins), because one
    statement must never touch the same key twice. Rows without a title are
    skipped. Returns the number of rows written.
    """
    unique = {}
    for row in rows:
        title = _text(row.get("title"))
        if not title or _none(row.get("id")) is None:
            continue
        unique[(int(row["id"]), row.get("media_type") or "movie")] = row

    if not unique:
        return 0

    movie_values = []
    detail_values = []
    for (movie_id, media_type), row in unique.items():
        embedding = row.get("embedding")
        movie_values.append((
            movie_id, media_type, _text(row["title"]), _text(row.get("overview")),
            _text(row.get("genres")), _text(row.get("keywords")), _text(row.get("cast")),
            _text(row.get("director")), _date(row.get("release_date")),
            _text(row.get("original_language")), _text(row.get("production_countries")),
            _float(row.get("vote_average")), _int(row.get("vote_count")),
            _text(row.get("poster_path")), _text(row.get("combined_text")), _text(row.get("status")),
            _int(row.get("number_of_seasons")), _int(row.get("number_of_episodes")),
            _int(row.get("episode_runtime")),
            None if embedding is None else vector_literal(embedding),
            None if embedding is None else EMBEDDING_MODEL,
            _float(row.get("popularity")),
        ))
        detail_values.append((
            movie_id, media_type, _text(row.get("tagline")), _int(row.get("runtime")),
            _text(row.get("backdrop_path")), _text(row.get("trailer_keys")),
            Json(row.get("cast_photos") or []),
        ))

    execute_values(cur, _MOVIE_UPSERT, movie_values, template=_MOVIE_TEMPLATE, page_size=page_size)
    execute_values(cur, _DETAILS_UPSERT, detail_values, page_size=page_size)
    return len(movie_values)

def write_details_row(cur, row):
    """
    Write only the movie_details row for a title already in movies (a missing
    details row filled in on first view). Never overwrites an existing one.
    row has tagline, runtime, backdrop_path, trailer_keys and cast_photos.
    """
    execute_values(cur, _DETAILS_UPSERT, [(
        int(row["id"]), row["media_type"], _text(row.get("tagline")), _int(row.get("runtime")),
        _text(row.get("backdrop_path")), _text(row.get("trailer_keys")),
        Json(row.get("cast_photos") or []),
    )])

# ---------- SIZE ----------

DEFAULT_CAP_MB = 300
HARD_CEILING_EXTRA_MB = 100  # live resolve may go this far past the cap, never further

def catalog_cap_mb():
    """CATALOG_SIZE_CAP_MB: where the bulk load and the refresh stop adding rows."""
    return float(os.getenv("CATALOG_SIZE_CAP_MB", DEFAULT_CAP_MB))

def hard_ceiling_mb():
    """Where live resolve refuses new titles: the cap plus a fixed margin."""
    return catalog_cap_mb() + HARD_CEILING_EXTRA_MB

def database_size_mb(cur):
    """Current database size in MB, the number the size cap is checked against."""
    cur.execute("SELECT pg_database_size(current_database())")
    return cur.fetchone()[0] / (1024 * 1024)

def catalog_is_full(cur):
    """True when the database is at or over the hard ceiling (cap plus 100 MB)."""
    return database_size_mb(cur) >= hard_ceiling_mb()

def parse_cast_photos(raw):
    """cast_photos_json from the CSV (a JSON string) as a list of {name, profile_path}."""
    raw = _none(raw)
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []
