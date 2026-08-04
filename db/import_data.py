"""
db/import_data.py

Connects to the Supabase Postgres database, creates the schema
(movies, users, ratings, watchlist), and imports movies.csv into
the movies table.
"""

import os
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL not found. Check your .env file.")

# Same pattern as fetch_movies.py's TEST_MODE — flip when the full fetch is ready
CSV_PATH = "data/movies_test.csv"  # change to "data/movies.csv" for the real import

# ---------- CONNECTION ----------

def get_connection():
    """Open a new connection to the Postgres database."""
    return psycopg2.connect(DATABASE_URL)

# ---------- SCHEMA ----------

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    overview TEXT,
    genres TEXT,
    keywords TEXT,
    cast_members TEXT,
    director TEXT,
    release_date DATE,
    original_language TEXT,
    production_countries TEXT,
    vote_average REAL,
    vote_count INTEGER,
    poster_path TEXT,
    combined_text TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    movie_id INTEGER REFERENCES movies(id),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    movie_id INTEGER REFERENCES movies(id),
    added_at TIMESTAMP DEFAULT now(),
    UNIQUE (user_id, movie_id)
);
"""

def create_tables():
    """Run the schema creation SQL. Safe to run multiple times —
    IF NOT EXISTS means it won't error or duplicate on repeat runs."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLES_SQL)
        conn.commit()
        print("Tables created (or already existed).")
    finally:
        conn.close()

def safe_str(value):
    """
    Safely convert a value to a string for text-building, treating BOTH
    None and NaN as missing (unlike `value or ""`, which fails on NaN —
    NaN is truthy in Python, so `or` doesn't catch it, and calling
    .replace() on a float then crashes).
    """
    if pd.isna(value):
        return ""
    return str(value)

def build_combined_text(row):
    """
    Same combined_text format used in recommend.py — kept in sync here
    so the embedding pipeline can eventually read this straight from the
    database instead of recomputing it from the CSV every run.
    """
    overview = safe_str(row.get("overview"))
    genres = safe_str(row.get("genres")).replace("|", " ")
    keywords = safe_str(row.get("keywords")).replace("|", " ")
    tagline = safe_str(row.get("tagline"))
    return f"{overview} {genres} {keywords} {tagline}"

def import_movies(csv_path=CSV_PATH, batch_size=500):
    """
    Read the CSV and insert every row into the movies table using
    batched inserts (execute_values) instead of one row per network
    round-trip — much faster at real scale (60k rows).
    """
    df = pd.read_csv(csv_path)
    df = df.where(pd.notnull(df), None)  # convert pandas NaN -> Python None (Postgres NULL)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            rows = [
                (
                    row["id"], row["title"], row["overview"], row["genres"], row["keywords"],
                    row["cast"], row["director"], row["release_date"],
                    row["original_language"], row["production_countries"],
                    row["vote_average"], row["vote_count"], row["poster_path"],
                    build_combined_text(row)
                )
                for _, row in df.iterrows()
            ]

            execute_values(
                cur,
                """
                INSERT INTO movies (
                    id, title, overview, genres, keywords,
                    cast_members, director, release_date,
                    original_language, production_countries,
                    vote_average, vote_count, poster_path, combined_text
                )
                VALUES %s
                ON CONFLICT (id) DO NOTHING
                """,
                rows,
                page_size=batch_size
            )
        conn.commit()
        print(f"Imported {len(rows)} movies (in batches of {batch_size}).")
    finally:
        conn.close()

# ---------- USERS ----------

def create_user():
    """
    Create a new, minimal user row — no auth fields yet, just enough to
    have a stable id to attach ratings/watchlist to. Returns the new
    user's id.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO users DEFAULT VALUES RETURNING id;")
            new_id = cur.fetchone()[0]
        conn.commit()
        return new_id
    finally:
        conn.close()


def add_rating(user_id, movie_id, rating):
    """
    Insert or update a user's rating for a movie. If they've already
    rated it, ON CONFLICT updates the existing rating instead of
    erroring — same idea as ON CONFLICT DO NOTHING in import_movies,
    but here we actually want to overwrite, not skip.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ratings (user_id, movie_id, rating)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, movie_id)
                DO UPDATE SET rating = EXCLUDED.rating, created_at = now()
                """,
                (user_id, movie_id, rating)
            )
        conn.commit()
    finally:
        conn.close()


def get_user_ratings(user_id):
    """
    Fetch all of a user's ratings, joined with movie titles for
    readability. Returns a list of (movie_id, title, rating) tuples.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT movies.id, movies.title, ratings.rating
                FROM ratings
                JOIN movies ON ratings.movie_id = movies.id
                WHERE ratings.user_id = %s
                ORDER BY ratings.created_at DESC
                """,
                (user_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


if __name__ == "__main__":
    create_tables()
    import_movies()