"""
db/details.py

The detail screen's reads and writes (spec 0013, AC-5): the joined movies and
movie_details row, the user's own rating, and the per country watch provider
cache. Every function takes an open cursor and leaves the transaction to the
caller (use db.pool.connection). Parameters are always bound.

Kept free of side effects on import.
"""

import datetime

from psycopg2.extras import Json

# A cached provider row older than this is fetched again.
PROVIDER_CACHE_TTL = datetime.timedelta(hours=24)

# The country used when the user has none stored.
DEFAULT_COUNTRY = "NG"

_DETAIL_SQL = """
SELECT m.id, m.media_type, m.title, m.overview, m.genres, m.release_date, m.status,
       m.number_of_seasons, m.number_of_episodes, m.episode_runtime,
       m.original_language, m.poster_path, m.director,
       d.id IS NOT NULL AS has_details,
       d.tagline, d.runtime, d.backdrop_path, d.trailer_keys, d.cast_photos
FROM movies m
LEFT JOIN movie_details d ON d.id = m.id AND d.media_type = m.media_type
WHERE m.id = %s AND m.media_type = %s
"""

_DETAIL_KEYS = (
    "id", "media_type", "title", "overview", "genres", "release_date", "status",
    "number_of_seasons", "number_of_episodes", "episode_runtime",
    "original_language", "poster_path", "director",
    "has_details", "tagline", "runtime", "backdrop_path", "trailer_keys", "cast_photos",
)

def fetch_detail_row(cur, movie_id, media_type):
    """The title's movies fields joined with its details row, as a dict, or None when it is not in the catalog."""
    cur.execute(_DETAIL_SQL, (movie_id, media_type))
    row = cur.fetchone()
    return None if row is None else dict(zip(_DETAIL_KEYS, row))

def fetch_user_rating(cur, user_id, movie_id, media_type):
    """The user's own rating for this exact (id, media_type), or None."""
    cur.execute(
        "SELECT rating FROM ratings WHERE user_id = %s::uuid AND movie_id = %s AND media_type = %s",
        (user_id, movie_id, media_type),
    )
    row = cur.fetchone()
    return None if row is None else row[0]

def fetch_provider_cache(cur, movie_id, media_type, country):
    """(payload, fetched_at) for the title under this country key, or (None, None)."""
    cur.execute(
        "SELECT payload, fetched_at FROM watch_provider_cache WHERE id = %s AND media_type = %s AND country = %s",
        (movie_id, media_type, country),
    )
    row = cur.fetchone()
    return (None, None) if row is None else (row[0], row[1])

def is_fresh(fetched_at, now=None):
    """True when a cached row is younger than the 24 hour limit."""
    if fetched_at is None:
        return False
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return now - fetched_at < PROVIDER_CACHE_TTL

def save_provider_cache(cur, movie_id, media_type, country, payload):
    """Store the resolved providers under the requested country, replacing an older row."""
    cur.execute(
        """
        INSERT INTO watch_provider_cache (id, media_type, country, payload, fetched_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (id, media_type, country)
        DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at
        """,
        (movie_id, media_type, country, Json(payload)),
    )
