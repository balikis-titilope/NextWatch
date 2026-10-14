"""
db/load_catalog.py

One time jobs that fill the pgvector catalog (spec 0013). Run from the
backend folder, as a module:

    python -m db.load_catalog backfill        # embed the rows already in movies
    python -m db.load_catalog load            # bulk load from data/movies.csv
    python -m db.load_catalog                 # both, in that order

Both are safe to interrupt and to rerun: they only fill in what is missing
and never delete. The bulk load stops by itself when the database reaches
CATALOG_SIZE_CAP_MB (default 300).
"""

import argparse
import os
import sys
import time

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

from db.catalog import (
    EMBEDDING_MODEL, Embedder, build_combined_text, database_size_mb,
    parse_cast_photos, vector_literal, write_catalog_rows,
)

load_dotenv()

CSV_FULL = "data/movies.csv"
CSV_TEST = "data/movies_test.csv"
DEFAULT_CAP_MB = 300
BACKFILL_BATCH = 256
LOAD_BATCH = 500
REPORT_AT = (10_000, 25_000, 50_000)

# watch_providers_json is deliberately left out: it is about 700 MB of the
# CSV in memory and the catalog never stores it (providers are cached live).
CSV_COLUMNS = [
    "id", "media_type", "title", "tagline", "overview", "genres", "keywords",
    "cast", "director", "release_date", "status", "runtime",
    "number_of_seasons", "number_of_episodes", "episode_runtime",
    "original_language", "production_countries", "popularity", "vote_average",
    "vote_count", "poster_path", "backdrop_path", "adult", "trailer_keys",
    "cast_photos_json",
]

def _connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not found. Check your .env file.")
    return psycopg2.connect(url)

def _clean_csv_frame(df):
    """Normalize one frame read with CSV_COLUMNS: default media_type, drop
    untitled and adult rows."""
    if "media_type" not in df.columns:
        df["media_type"] = "movie"
    df["media_type"] = df["media_type"].fillna("movie")
    df = df[df["title"].notna() & (df["title"].astype(str).str.strip() != "")]
    if "adult" in df.columns:
        df = df[~(df["adult"].astype(str).str.lower() == "true")]
    return df

def _read_csv_chunks(path, chunksize=50_000):
    return pd.read_csv(path, usecols=lambda c: c in CSV_COLUMNS, chunksize=chunksize)

def _row_dict(row):
    """One CSV row as the dict the shared writer expects, embedding left out."""
    data = row.to_dict()
    data["combined_text"] = build_combined_text(data)
    data["cast_photos"] = parse_cast_photos(data.get("cast_photos_json"))
    return data

# ---------- RSS / reports ----------

def _resident_memory_mb():
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except ImportError:
        return None

def _report(cur, rows, cap_mb):
    """Print the checkpoint report: rows, size, memory, and one sample similarity query."""
    size = database_size_mb(cur)
    rss = _resident_memory_mb()
    print(f"\n--- checkpoint: {rows} rows ---")
    print(f"database size: {size:.1f} MB ({size / cap_mb * 100:.0f}% of the {cap_mb} MB cap)")
    print(f"process memory: {'%.0f MB' % rss if rss else 'n/a (pip install psutil to measure)'}")
    cur.execute(
        """
        EXPLAIN (ANALYZE, COSTS OFF)
        SELECT id FROM movies
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> (SELECT embedding FROM movies WHERE embedding IS NOT NULL LIMIT 1)
        LIMIT 10
        """
    )
    for (line,) in cur.fetchall():
        print("  " + line)
    print("---\n")

# ---------- Backfill ----------

def backfill(batch_size=BACKFILL_BATCH):
    """
    Give every movies row that has no embedding one, from its stored
    combined_text as is (movies has no tagline column, and combined_text
    already contains it). The same pass fills popularity and the
    movie_details row from the CSV where the title is found there
    (movies_test.csv first, then movies.csv); a row in neither CSV keeps a
    null popularity and gets its details lazily from the detail endpoint.
    """
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, media_type, combined_text FROM movies WHERE embedding IS NULL ORDER BY id, media_type")
            pending = cur.fetchall()
        print(f"Backfill: {len(pending)} rows without an embedding.")
        if not pending:
            return

        embedder = Embedder()
        done = 0
        for start in range(0, len(pending), batch_size):
            chunk = pending[start:start + batch_size]
            vectors = embedder.encode([(text or " ") for _, _, text in chunk])
            with conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    UPDATE movies m
                    SET embedding = v.e::extensions.vector, embedding_model = v.model, refreshed_at = now()
                    FROM (VALUES %s) AS v(id, media_type, e, model)
                    WHERE m.id = v.id::integer AND m.media_type = v.media_type
                    """,
                    [(mid, mtype, vector_literal(vec), EMBEDDING_MODEL) for (mid, mtype, _), vec in zip(chunk, vectors)],
                    template="(%s, %s, %s, %s)",
                    page_size=batch_size,
                )
            conn.commit()
            done += len(chunk)
            print(f"  embedded {done}/{len(pending)}")

        _backfill_csv_fields({(mid, mtype) for mid, mtype, _ in pending}, conn)
    finally:
        conn.close()

def _backfill_csv_fields(keys, conn):
    """Fill popularity and movie_details for `keys` from the CSVs."""
    remaining = set(keys)
    for path in (CSV_TEST, CSV_FULL):
        if not remaining or not os.path.exists(path):
            continue
        found = []
        for chunk in _read_csv_chunks(path):
            chunk = _clean_csv_frame(chunk)
            mask = [(int(i), t) in remaining for i, t in zip(chunk["id"], chunk["media_type"])]
            for _, row in chunk[mask].iterrows():
                found.append(_row_dict(row))
        if not found:
            continue
        with conn.cursor() as cur:
            write_catalog_rows(cur, found)  # conflict path only fills popularity and details
        conn.commit()
        remaining -= {(int(r["id"]), r["media_type"]) for r in found}
        print(f"  filled popularity and details for {len(found)} rows from {path}")
    if remaining:
        print(f"  {len(remaining)} rows are in neither CSV; their details fill lazily.")

# ---------- Bulk load ----------

def _write_batch(conn, batch, attempts=4):
    """
    Write one batch and commit it. A dropped connection (the Supabase pooler
    closing an idle or busy session, a network blip) rolls the batch back,
    so it is safe to reconnect and write the same batch again; the writer
    is an upsert, so a retry can never duplicate. Returns the (possibly new)
    connection and the number of rows written.
    """
    for attempt in range(1, attempts + 1):
        try:
            with conn.cursor() as cur:
                written = write_catalog_rows(cur, batch)
            conn.commit()
            return conn, written
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
            if attempt == attempts:
                raise
            print(f"  connection dropped ({type(e).__name__}); reconnecting, attempt {attempt + 1} of {attempts}")
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(2 * attempt)
            conn = _connect()


def load(cap_mb=None, max_rows=None, csv_path=CSV_FULL, batch_size=LOAD_BATCH):
    """
    Load titles from the big CSV, movies and TV ranked together by
    vote_count (highest first), skipping adult and untitled rows, in
    batches. Resumable: keys that already have an embedding, a details row,
    and a popularity are skipped before any embedding work. Stops by itself
    when pg_database_size reaches the cap, or after max_rows catalog rows.
    """
    cap_mb = cap_mb or float(os.getenv("CATALOG_SIZE_CAP_MB", DEFAULT_CAP_MB))
    conn = _connect()
    try:
        with conn.cursor() as cur:
            size = database_size_mb(cur)
            if size >= cap_mb:
                print(f"Database is {size:.1f} MB, at or over the {cap_mb:g} MB cap. Nothing loaded.")
                return
            cur.execute(
                """
                SELECT m.id, m.media_type FROM movies m
                JOIN movie_details d ON d.id = m.id AND d.media_type = m.media_type
                WHERE m.embedding IS NOT NULL AND m.popularity IS NOT NULL
                """
            )
            done = set(cur.fetchall())
        print(f"{len(done)} titles already complete; reading {csv_path}...")

        df = pd.concat(_read_csv_chunks(csv_path), ignore_index=True)
        df = _clean_csv_frame(df)
        df["vote_count"] = pd.to_numeric(df["vote_count"], errors="coerce").fillna(0)
        df = df.sort_values("vote_count", ascending=False, kind="stable")
        df = df.drop_duplicates(subset=["id", "media_type"])
        keys = list(zip(df["id"].astype(int), df["media_type"]))
        df = df[[k not in done for k in keys]]
        print(f"{len(df)} titles left to load.")

        embedder = Embedder()
        total = len(done)
        reported = {n for n in REPORT_AT if total >= n}
        started = time.time()
        written = 0
        for start in range(0, len(df), batch_size):
            if max_rows is not None and total >= max_rows:
                print(f"Reached the {max_rows} row target.")
                break
            batch = [_row_dict(r) for _, r in df.iloc[start:start + batch_size].iterrows()]
            vectors = embedder.encode([r["combined_text"] for r in batch])
            for row, vec in zip(batch, vectors):
                row["embedding"] = vec
            conn, written_now = _write_batch(conn, batch)
            with conn.cursor() as cur:
                total += written_now
                written += written_now
                size = database_size_mb(cur)
                print(f"  {total} rows, {size:.1f} MB ({time.time() - started:.0f}s)")
                for n in REPORT_AT:
                    if total >= n and n not in reported:
                        reported.add(n)
                        _report(cur, total, cap_mb)
                if size >= cap_mb:
                    print(f"WARNING: database reached {size:.1f} MB, the {cap_mb:g} MB cap. Stopping; nothing is deleted.")
                    break
        print(f"Done. Wrote {written} rows this run; catalog has about {total}.")
    finally:
        conn.close()

def main(argv=None):
    parser = argparse.ArgumentParser(description="Fill the pgvector catalog (spec 0013).")
    parser.add_argument("step", nargs="?", choices=("backfill", "load", "all"), default="all")
    parser.add_argument("--cap-mb", type=float, help="size cap in MB (default CATALOG_SIZE_CAP_MB or 300)")
    parser.add_argument("--max-rows", type=int, help="stop once the catalog holds this many rows")
    parser.add_argument("--csv", default=CSV_FULL, help="CSV to bulk load (default data/movies.csv)")
    args = parser.parse_args(argv)

    print(f"Embedding model: {EMBEDDING_MODEL}")
    if args.step in ("backfill", "all"):
        backfill()
    if args.step in ("load", "all"):
        load(cap_mb=args.cap_mb, max_rows=args.max_rows, csv_path=args.csv)
    return 0

if __name__ == "__main__":
    sys.exit(main())
