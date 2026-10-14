"""
db/refresh_catalog.py

The daily catalog refresh (spec 0013, AC-10, AC-11), run by the GitHub
Actions workflow .github/workflows/catalog-refresh.yml:

    cd backend && python -m db.refresh_catalog

Three jobs, in this order:
1. Add: titles with at least 10 votes released in the last 30 days, or ranking
   high on TMDB popularity (5 pages per type, adult excluded). Skipped, with a
   warning, when the database is at or over CATALOG_SIZE_CAP_MB.
2. Stat refresh: vote_average, vote_count, popularity, poster_path and
   backdrop_path for a rotating slice of existing rows (oldest refreshed_at
   first, about one thirtieth of the table per run). A title TMDB no longer has
   (404) advances its refreshed_at and is not a failure.
3. Null embedding sweep: embeds any row that has no embedding yet, from its
   stored combined_text.

Batches commit independently and a failing item is logged and skipped. It
never deletes. It exits non zero when a database error happened or more than
20 percent of the TMDB calls failed for a reason other than 404.

Needs TMDB_TOKEN and DATABASE_URL (the session pooler URL) in the environment.
It prints neither.
"""

import datetime
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from psycopg2.extras import execute_values

from db.catalog import (
    EMBEDDING_MODEL, Embedder, catalog_cap_mb, database_size_mb, vector_literal, write_catalog_rows,
)
from db.pool import connection
from recommend import (
    APPEND_MOVIE, APPEND_TV, BASE, HEADERS, _enrich_movie_details, build_movie_row,
)

NEW_WINDOW_DAYS = 30
MIN_VOTES = 10
DISCOVER_PAGES = 5
SLICE_DIVISOR = 30
FAILURE_RATE_LIMIT = 0.20
BATCH_SIZE = 50
SWEEP_BATCH = 200
FETCH_WORKERS = 8

MEDIA_TYPES = ("movie", "tv")

class Tmdb:
    """
    A small TMDB client that counts what happened to every call, so the script
    can tell a missing title (404, fine) from a real failure. One retry on a
    network error, a 429, or a 5xx.
    """
    def __init__(self, session=None, sleep=time.sleep):
        self._session = session or requests.Session()
        self._sleep = sleep
        self.calls = 0
        self.failures = 0

    def get(self, endpoint, params=None):
        """(status, json). status is 'ok', 'not_found' or 'failed'."""
        self.calls += 1
        for attempt in range(2):
            try:
                response = self._session.get(f"{BASE}{endpoint}", headers=HEADERS, params=params or {}, timeout=20)
            except requests.exceptions.RequestException as e:
                last = str(e)
            else:
                if response.status_code == 404:
                    return "not_found", None
                if response.status_code == 429 or response.status_code >= 500:
                    last = f"HTTP {response.status_code}"
                elif response.status_code != 200:
                    last = f"HTTP {response.status_code}"
                    break
                else:
                    try:
                        return "ok", response.json()
                    except ValueError as e:
                        last = str(e)
            if attempt == 0:
                self._sleep(1)
        self.failures += 1
        print(f"  TMDB call failed: {endpoint}: {last}")
        return "failed", None

    def failure_rate(self):
        return self.failures / self.calls if self.calls else 0.0

class Run:
    """Counters for the one line summary, and whether a database error happened."""
    def __init__(self):
        self.added = 0
        self.refreshed = 0
        self.embedded = 0
        self.skipped = 0
        self.db_error = False

# ---------- 1. ADD ----------

def discover_keys(tmdb, today):
    """(id, media_type) of new and popular titles from TMDB discover, adult excluded."""
    since = (today - datetime.timedelta(days=NEW_WINDOW_DAYS)).isoformat()
    keys = []
    seen = set()
    for media_type in MEDIA_TYPES:
        date_param = "primary_release_date.gte" if media_type == "movie" else "first_air_date.gte"
        passes = (
            {date_param: since},   # released in the last 30 days
            {},                    # popularity only
        )
        for extra in passes:
            for page in range(1, DISCOVER_PAGES + 1):
                status, body = tmdb.get(f"/discover/{media_type}", {
                    "include_adult": "false", "vote_count.gte": MIN_VOTES,
                    "sort_by": "popularity.desc", "page": page, **extra,
                })
                if status != "ok":
                    break
                for item in body.get("results", []):
                    key = (item["id"], media_type)
                    if key not in seen and not item.get("adult"):
                        seen.add(key)
                        keys.append(key)
                if page >= body.get("total_pages", 1):
                    break
    return keys

def keys_with_embedding(cur, keys):
    """Which of keys already have a row with an embedding."""
    if not keys:
        return set()
    cur.execute(
        """
        SELECT m.id, m.media_type FROM movies m
        JOIN unnest(%s::int[], %s::text[]) AS k(id, media_type)
          ON k.id = m.id AND k.media_type = m.media_type
        WHERE m.embedding IS NOT NULL
        """,
        ([k[0] for k in keys], [k[1] for k in keys]),
    )
    return set(cur.fetchall())

def fetch_row(tmdb, movie_id, media_type):
    """A full catalog row for one title from TMDB (details, cast, keywords), or None."""
    status, body = tmdb.get(
        f"/{media_type}/{movie_id}", {"append_to_response": APPEND_TV if media_type == "tv" else APPEND_MOVIE},
    )
    if status != "ok" or body.get("adult"):
        return None
    return build_movie_row(_enrich_movie_details(body, media_type), media_type)

def add_new_titles(tmdb, embedder_factory, run, today, cap_mb):
    """Job 1. Returns the embedder it created (or None) so later jobs reuse it."""
    with connection() as conn, conn.cursor() as cur:
        size = database_size_mb(cur)
    if size >= cap_mb:
        print(f"WARNING: database is {size:.1f} MB, at or over the {cap_mb:g} MB cap. Not adding titles.")
        return None

    keys = discover_keys(tmdb, today)
    with connection() as conn, conn.cursor() as cur:
        known = keys_with_embedding(cur, keys)
    missing = [k for k in keys if k not in known]
    print(f"discover: {len(keys)} titles, {len(missing)} to add")
    if not missing:
        return None

    embedder = embedder_factory()
    for start in range(0, len(missing), BATCH_SIZE):
        batch = missing[start:start + BATCH_SIZE]
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            fetched = list(pool.map(lambda k: fetch_row(tmdb, k[0], k[1]), batch))
        rows = [row for row in fetched if row is not None]
        run.skipped += len(batch) - len(rows)
        if not rows:
            continue
        vectors = embedder.encode([row["combined_text"] for row in rows])
        for row, vector in zip(rows, vectors):
            row["embedding"] = vector
        try:
            with connection() as conn, conn.cursor() as cur:
                run.added += write_catalog_rows(cur, rows)
                size = database_size_mb(cur)
        except Exception as e:
            print(f"  database error writing a batch: {e}")
            run.db_error = True
            continue
        if size >= cap_mb:
            print(f"WARNING: database reached {size:.1f} MB, the {cap_mb:g} MB cap. Stopping adds.")
            break
    return embedder

# ---------- 2. STAT REFRESH ----------

def pick_slice(cur):
    """The (id, media_type) rows with the oldest refreshed_at, about one thirtieth of the table."""
    cur.execute("SELECT count(*) FROM movies")
    total = cur.fetchone()[0]
    size = math.ceil(total / SLICE_DIVISOR)
    cur.execute(
        "SELECT id, media_type FROM movies ORDER BY refreshed_at ASC NULLS FIRST, id, media_type LIMIT %s",
        (size,),
    )
    return cur.fetchall()

def fetch_stats(tmdb, movie_id, media_type):
    """('ok', stats) | ('not_found', None) | ('failed', None) for one title's changing fields."""
    status, body = tmdb.get(f"/{media_type}/{movie_id}")
    if status != "ok":
        return status, None
    return "ok", {
        "vote_average": body.get("vote_average"),
        "vote_count": body.get("vote_count"),
        "popularity": body.get("popularity"),
        "poster_path": body.get("poster_path"),
        "backdrop_path": body.get("backdrop_path"),
    }

def apply_stats(cur, updates, gone):
    """
    updates: [(id, media_type, stats)]; gone: [(id, media_type)] that TMDB no
    longer has. Both advance refreshed_at. Existing values are kept when TMDB
    sends null for a field.
    """
    if updates:
        execute_values(
            cur,
            """
            UPDATE movies m SET
                vote_average = COALESCE(v.vote_average, m.vote_average),
                vote_count = COALESCE(v.vote_count, m.vote_count),
                popularity = COALESCE(v.popularity, m.popularity),
                poster_path = COALESCE(v.poster_path, m.poster_path),
                refreshed_at = now()
            FROM (VALUES %s) AS v(id, media_type, vote_average, vote_count, popularity, poster_path)
            WHERE m.id = v.id AND m.media_type = v.media_type
            """,
            [(i, t, s["vote_average"], s["vote_count"], s["popularity"], s["poster_path"]) for i, t, s in updates],
            template="(%s::int, %s::text, %s::real, %s::int, %s::real, %s::text)",
        )
        execute_values(
            cur,
            """
            UPDATE movie_details d SET backdrop_path = v.backdrop_path
            FROM (VALUES %s) AS v(id, media_type, backdrop_path)
            WHERE d.id = v.id AND d.media_type = v.media_type AND v.backdrop_path IS NOT NULL
            """,
            [(i, t, s["backdrop_path"]) for i, t, s in updates],
            template="(%s::int, %s::text, %s::text)",
        )
    if gone:
        cur.execute(
            """
            UPDATE movies m SET refreshed_at = now()
            FROM unnest(%s::int[], %s::text[]) AS k(id, media_type)
            WHERE m.id = k.id AND m.media_type = k.media_type
            """,
            ([k[0] for k in gone], [k[1] for k in gone]),
        )

def refresh_stats(tmdb, run):
    """Job 2."""
    with connection() as conn, conn.cursor() as cur:
        chosen = pick_slice(cur)
    print(f"stat refresh: {len(chosen)} titles")
    for start in range(0, len(chosen), BATCH_SIZE):
        batch = chosen[start:start + BATCH_SIZE]
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            results = list(pool.map(lambda k: fetch_stats(tmdb, k[0], k[1]), batch))
        updates = [(k[0], k[1], stats) for k, (status, stats) in zip(batch, results) if status == "ok"]
        gone = [k for k, (status, _) in zip(batch, results) if status == "not_found"]
        run.skipped += sum(1 for status, _ in results if status == "failed")
        try:
            with connection() as conn, conn.cursor() as cur:
                apply_stats(cur, updates, gone)
            run.refreshed += len(updates) + len(gone)
        except Exception as e:
            print(f"  database error updating a batch: {e}")
            run.db_error = True

# ---------- 3. NULL EMBEDDING SWEEP ----------

def sweep_null_embeddings(embedder_factory, embedder, run):
    """Job 3. Returns the embedder it used, creating one only if there is work."""
    last = (-1, "")
    while True:
        try:
            with connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, media_type, combined_text FROM movies
                    WHERE embedding IS NULL AND (id, media_type) > (%s, %s)
                    ORDER BY id, media_type LIMIT %s
                    """,
                    (last[0], last[1], SWEEP_BATCH),
                )
                rows = cur.fetchall()
        except Exception as e:
            print(f"  database error reading null embeddings: {e}")
            run.db_error = True
            return embedder
        if not rows:
            return embedder
        embedder = embedder or embedder_factory()
        vectors = embedder.encode([text or "" for _, _, text in rows])
        try:
            with connection() as conn, conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    UPDATE movies m SET embedding = v.embedding::extensions.vector, embedding_model = v.model
                    FROM (VALUES %s) AS v(id, media_type, embedding, model)
                    WHERE m.id = v.id AND m.media_type = v.media_type AND m.embedding IS NULL
                    """,
                    [(i, t, vector_literal(vec), EMBEDDING_MODEL) for (i, t, _), vec in zip(rows, vectors)],
                    template="(%s::int, %s::text, %s, %s::text)",
                    page_size=SWEEP_BATCH,
                )
            run.embedded += len(rows)
        except Exception as e:
            print(f"  database error writing embeddings: {e}")
            run.db_error = True
        last = (rows[-1][0], rows[-1][1])

# ---------- MAIN ----------

def summary_line(run, size_mb, cap_mb, newest):
    return (
        f"refresh done: added={run.added} refreshed={run.refreshed} embedded={run.embedded} "
        f"skipped={run.skipped} size={size_mb:.1f}MB ({size_mb / cap_mb * 100:.0f}% of the {cap_mb:g}MB cap) "
        f"newest_refreshed_at={newest}"
    )

def main(tmdb=None, embedder_factory=Embedder, today=None):
    """Runs the three jobs and returns the process exit code."""
    tmdb = tmdb or Tmdb()
    today = today or datetime.date.today()
    cap_mb = catalog_cap_mb()
    run = Run()

    embedder = None
    try:
        embedder = add_new_titles(tmdb, embedder_factory, run, today, cap_mb)
    except Exception as e:
        print(f"add step failed: {e}")
        run.db_error = True
    try:
        refresh_stats(tmdb, run)
    except Exception as e:
        print(f"stat refresh failed: {e}")
        run.db_error = True
    try:
        sweep_null_embeddings(embedder_factory, embedder, run)
    except Exception as e:
        print(f"embedding sweep failed: {e}")
        run.db_error = True

    try:
        with connection() as conn, conn.cursor() as cur:
            size = database_size_mb(cur)
            cur.execute("SELECT max(refreshed_at) FROM movies")
            newest = cur.fetchone()[0]
    except Exception as e:
        print(f"final read failed: {e}")
        run.db_error = True
        size, newest = 0.0, None
    print(summary_line(run, size, cap_mb, newest.isoformat() if newest else "none"))

    failed = False
    if run.db_error:
        print("ERROR: a database error occurred.")
        failed = True
    if tmdb.failure_rate() > FAILURE_RATE_LIMIT:
        print(f"ERROR: {tmdb.failures} of {tmdb.calls} TMDB calls failed (limit {FAILURE_RATE_LIMIT:.0%}).")
        failed = True
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
