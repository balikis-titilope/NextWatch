"""
db/import_data.py

Connects to the Supabase Postgres database and holds the user side of the
data layer (users, ratings, notifications) plus the fresh database schema.
The movie catalog is loaded by db/load_catalog.py and written through the one
shared writer in db/catalog.py (spec 0013).
"""

import json
import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL not found. Check your .env file.")

# ---------- CONNECTION ----------

def get_connection():
    """Open a new connection to the Postgres database."""
    return psycopg2.connect(DATABASE_URL)

# ---------- SCHEMA ----------

CREATE_TABLES_SQL = """
-- pgvector catalog (spec 0013): embeddings live on movies as a vector
-- column, with a trigram index for typeahead. Existing databases pick this
-- up via db/migrations/0006_pgvector_catalog.sql; this block only covers a
-- fresh database. The schema line makes it work on plain Postgres too.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- media_type is part of the primary key (spec 0010): a movie and a TV
-- show can share the same raw TMDB id, so (id) alone is not unique.
-- release_date and director are reused for a TV row's first_air_date and
-- creator(s) respectively, instead of adding parallel TV-only columns --
-- no code path may assume release_date means "movie release date"
-- without also handling the TV case. status, number_of_seasons,
-- number_of_episodes, and episode_runtime are TV-only and stay null on a
-- movie row. Existing databases pick this up via
-- db/migrations/0004_tv_show_support.sql; this block only covers a fresh
-- database.
CREATE TABLE IF NOT EXISTS movies (
    id INTEGER NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
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
    combined_text TEXT,
    status TEXT,
    number_of_seasons INTEGER,
    number_of_episodes INTEGER,
    episode_runtime INTEGER,
    embedding extensions.vector(384),
    embedding_model TEXT,
    popularity REAL,
    refreshed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, media_type)
);

ALTER TABLE movies ALTER COLUMN embedding SET STORAGE PLAIN;

CREATE INDEX IF NOT EXISTS idx_movies_title_trgm
    ON movies USING gin (lower(title) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_movies_popularity
    ON movies (popularity DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS movie_details (
    id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    tagline TEXT,
    runtime INTEGER,
    backdrop_path TEXT,
    trailer_keys TEXT,
    cast_photos JSONB,
    PRIMARY KEY (id, media_type),
    FOREIGN KEY (id, media_type) REFERENCES movies (id, media_type) ON DELETE CASCADE
);
ALTER TABLE movie_details ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS watch_provider_cache (
    id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    country TEXT NOT NULL,
    payload JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, media_type, country),
    FOREIGN KEY (id, media_type) REFERENCES movies (id, media_type) ON DELETE CASCADE
);
ALTER TABLE watch_provider_cache ENABLE ROW LEVEL SECURITY;

-- Profile row for a real Supabase Auth user — id is NOT auto-generated
-- here, it's the same UUID as the corresponding auth.users row. There is
-- no anonymous/guest user concept: a row only exists once someone signs up.
-- onboarding_completed only ever moves false -> true (see spec 0004);
-- country is captured once at signup from the device locale (spec 0005),
-- null on accounts that predate it or where capture failed;
-- last_active_at, ratings_since_rec_notif, and notification_prefs drive
-- the notifications system (spec 0006) -- touched by GET /me and
-- POST /ratings, and by the recommendations_ready threshold check;
-- deactivated_at drives account deactivation and deletion (spec 0009):
-- NULL means active, a timestamp means deletion was requested at that
-- time, purged 30 days later by the daily job in main.py's lifespan.
-- existing databases pick these up via db/migrations/0001_onboarding_completed.sql,
-- 0002_add_user_country.sql, 0003_notifications.sql, and
-- 0005_account_deactivation.sql, this block only covers a fresh database.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    onboarding_completed boolean not null default false,
    country TEXT,
    created_at TIMESTAMP DEFAULT now(),
    last_active_at TIMESTAMPTZ,
    ratings_since_rec_notif INT NOT NULL DEFAULT 0,
    notification_prefs JSONB NOT NULL DEFAULT '{"recommendations_ready": true, "re_engagement": true}',
    deactivated_at TIMESTAMPTZ
);

-- user_id cascades on delete (spec 0009's 0005_account_deactivation.sql) so
-- the daily purge job's `DELETE FROM users` removes a purged account's
-- ratings automatically.
CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (user_id, movie_id, media_type),
    FOREIGN KEY (movie_id, media_type) REFERENCES movies (id, media_type)
);

CREATE INDEX IF NOT EXISTS idx_ratings_movie_id_media_type ON ratings (movie_id, media_type);

-- Persisted notifications (spec 0006): one row per trigger firing, moving
-- unread -> read exactly once, never back. type is an application-level
-- enum ("recommendations_ready" or "re_engagement"), validated in
-- Pydantic, not a Postgres ENUM, so a third type later is a code change,
-- not a migration. payload is reserved and unused this build.
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;
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

# ---------- USERS ----------

def create_user_profile(user_id: str, country: str | None = None):
    """
    Insert a public.users profile row for a user who just signed up via
    Supabase Auth. auth.users already has the matching row by the time
    this is called (Supabase created it during signup), so the foreign
    key is satisfiable. ON CONFLICT DO NOTHING makes this safe to call
    more than once for the same user_id — country is set only on the
    first insert (whichever signup path actually creates the row, see
    spec 0005), never overwritten by a later call.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, country) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING;",
                (user_id, country)
            )
        conn.commit()
    finally:
        conn.close()


def deactivate_account(user_id):
    """
    Set deactivated_at to now() (spec 0009 AC-2) -- starts the 30 day
    grace period. Called by both POST /me/deactivate (in app) and
    POST /legal/delete-account (the web form), after each has already
    verified the account's password.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET deactivated_at = now() WHERE id = %s", (user_id,))
        conn.commit()
    finally:
        conn.close()


def reactivate_account(user_id):
    """
    Clear deactivated_at (spec 0009 AC-5). Returns whether the account was
    actually deactivated -- the caller (POST /me/reactivate) maps a false
    here to 409, since reactivating an already-active account isn't a
    valid transition.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users SET deactivated_at = NULL
                WHERE id = %s AND deactivated_at IS NOT NULL
                RETURNING id
                """,
                (user_id,)
            )
            reactivated = cur.fetchone() is not None
        conn.commit()
        return reactivated
    finally:
        conn.close()


def get_accounts_due_for_purge(now=None):
    """
    User ids whose deactivated_at is more than 30 days old (spec 0009
    AC-7) -- what the daily purge job removes. now defaults to the
    database's own clock; a caller (a test) can pin it for a deterministic
    scenario, same pattern as run_re_engagement_scan.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM users
                WHERE deactivated_at IS NOT NULL
                  AND deactivated_at <= COALESCE(%s, now()) - interval '30 days'
                """,
                (now,)
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def get_user_country(user_id):
    """
    Fetch a user's stored country (ISO 3166-1 alpha-2), guaranteeing the
    row exists first (same reasoning as get_user_profile). None means no
    country was captured at signup — callers fall back to NG then US
    (spec 0005, AC-7/AC-11).
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id) VALUES (%s) ON CONFLICT (id) DO NOTHING;",
                (user_id,)
            )
            cur.execute(
                "SELECT country FROM users WHERE id = %s",
                (user_id,)
            )
            country = cur.fetchone()[0]
        conn.commit()
        return country
    finally:
        conn.close()


def get_user_profile(user_id):
    """
    Fetch a user's profile, guaranteeing the row exists first (an account
    can have a valid Supabase JWT but no public.users row yet — a signup
    whose profile insert failed, or an account created outside the normal
    signup path — see spec 0004). Also touches last_active_at to now() as
    a side effect (spec 0006 AC-9) -- GET /me is one of the two call sites
    that keep it fresh for the re-engagement scan. Returns
    (onboarding_completed, notification_prefs, deactivated_at) --
    deactivated_at (spec 0009) feeds the app's post-login reactivate
    prompt, so GET /me must surface it even while the account is
    deactivated.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id) VALUES (%s) ON CONFLICT (id) DO NOTHING;",
                (user_id,)
            )
            cur.execute(
                """
                UPDATE users SET last_active_at = now()
                WHERE id = %s
                RETURNING onboarding_completed, notification_prefs, deactivated_at
                """,
                (user_id,)
            )
            onboarding_completed, notification_prefs, deactivated_at = cur.fetchone()
        conn.commit()
        return onboarding_completed, notification_prefs, deactivated_at
    finally:
        conn.close()


def set_onboarding_completed(user_id):
    """
    Mark a user's onboarding as complete, guaranteeing the row exists
    first (same reasoning as get_user_profile). Safe to call more than
    once — onboarding_completed only ever moves false -> true.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (id, onboarding_completed)
                VALUES (%s, true)
                ON CONFLICT (id) DO UPDATE SET onboarding_completed = true
                """,
                (user_id,)
            )
        conn.commit()
    finally:
        conn.close()


def add_rating(user_id, movie_id, media_type, rating):
    """
    Insert or update a user's rating for a movie or TV show. If they've
    already rated it, ON CONFLICT updates the existing rating instead of
    erroring — same idea as ON CONFLICT DO NOTHING on the catalog writer,
    but here we actually want to overwrite, not skip. Composite conflict
    target (user_id, movie_id, media_type) since a movie and a TV show
    can share the same raw TMDB id (spec 0010).

    Returns whether this call counts toward the recommendations_ready
    threshold (spec 0006 AC-1): true on a genuine insert or a changed
    rating value, false when it's a repeat of the same value. The
    DO UPDATE's WHERE clause means a same-value conflict updates nothing,
    so RETURNING yields no row for it.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ratings (user_id, movie_id, media_type, rating)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, movie_id, media_type)
                DO UPDATE SET rating = EXCLUDED.rating, created_at = now()
                WHERE ratings.rating IS DISTINCT FROM EXCLUDED.rating
                RETURNING id
                """,
                (user_id, movie_id, media_type, rating)
            )
            counted = cur.fetchone() is not None
        conn.commit()
        return counted
    finally:
        conn.close()


def delete_rating(user_id, movie_id, media_type):
    """
    Remove a user's rating for a movie or TV show, scoped to the caller
    so a rating can only ever be deleted by the user who owns it (spec
    0008 AC-4). media_type is required, not defaulted (spec 0010): a
    movie and a TV show can share the same movie_id, so omitting it
    would risk deleting the wrong row's rating. Returns whether a row
    was actually removed -- the caller uses this to tell "deleted" apart
    from "never rated this / not this user's rating", which the API
    layer collapses into the same 404 either way.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ratings WHERE user_id = %s AND movie_id = %s AND media_type = %s RETURNING id",
                (user_id, movie_id, media_type)
            )
            deleted = cur.fetchone() is not None
        conn.commit()
        return deleted
    finally:
        conn.close()


def get_user_ratings(user_id):
    """
    Fetch all of a user's ratings, joined with movie/show titles for
    readability. Returns a list of (movie_id, media_type, title, rating)
    tuples.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT movies.id, movies.media_type, movies.title, ratings.rating
                FROM ratings
                JOIN movies ON ratings.movie_id = movies.id AND ratings.media_type = movies.media_type
                WHERE ratings.user_id = %s
                ORDER BY ratings.created_at DESC
                """,
                (user_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_user_ratings_detailed(user_id):
    """
    Fetch all of a user's ratings joined with the movie/show fields the
    Ratings tab list needs (design.md §6.8): poster, release year, and
    when the rating was made. A separate query from get_user_ratings
    (used by the recommendation engine, which only wants the
    (movie_id, media_type, title, rating) shape) so that contract
    doesn't shift. Returns a list of (movie_id, media_type, title,
    release_date, poster_path, rating, rated_at) tuples, most recently
    rated first.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT movies.id, movies.media_type, movies.title, movies.release_date, movies.poster_path,
                       ratings.rating, ratings.created_at
                FROM ratings
                JOIN movies ON ratings.movie_id = movies.id AND ratings.media_type = movies.media_type
                WHERE ratings.user_id = %s
                ORDER BY ratings.created_at DESC
                """,
                (user_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


# ---------- NOTIFICATIONS (spec 0006) ----------

# Fixed per-type copy, decided at design time (spec 0006), not user input.
NOTIFICATION_COPY = {
    "recommendations_ready": (
        "New picks for you",
        "Your recommendations just updated based on your recent ratings.",
    ),
    "re_engagement": (
        "Ready when you are",
        "Your next favorite might already be waiting.",
    ),
}


def touch_last_active(user_id):
    """
    Update last_active_at to now() (spec 0006 AC-9). Called from
    POST /ratings and (via get_user_profile) GET /me, so a resident app
    session that only rates, and never refires /me, still keeps this
    fresh for the re-engagement scan.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET last_active_at = now() WHERE id = %s", (user_id,))
        conn.commit()
    finally:
        conn.close()


def check_recommendations_threshold(user_id):
    """
    Atomically increments ratings_since_rec_notif, resetting it to 0 the
    moment it reaches 5 whether or not a notification actually gets
    written that time (spec 0006 AC-1), and writes a recommendations_ready
    notification only if the user hasn't muted the type and hasn't
    received one in the last rolling 24 hours. One statement, guarded by
    FOR UPDATE on the user's own row, so two ratings submitted close
    together can't both cross the threshold and both write a row (spec
    0006's atomicity invariant). Only call this for a rating that counted
    (add_rating returned true) -- a repeat of the same value shouldn't
    advance the counter at all. In practice a deactivated account can
    never reach here (POST /ratings is already behind
    get_current_active_user_id, spec 0009 AC-3), but old's
    deactivated_at IS NULL filter, and updated's matching EXISTS guard,
    make that invariant hold at the query level too (spec 0009 AC-8) --
    without the EXISTS guard, updated would still fire on an empty old
    and null out ratings_since_rec_notif.
    """
    title, body = NOTIFICATION_COPY["recommendations_ready"]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH params AS (
                    SELECT %s::uuid AS user_id
                ),
                old AS (
                    SELECT u.ratings_since_rec_notif, u.notification_prefs
                    FROM users u, params
                    WHERE u.id = params.user_id AND u.deactivated_at IS NULL
                    FOR UPDATE
                ),
                updated AS (
                    UPDATE users
                    SET ratings_since_rec_notif = CASE
                        WHEN (SELECT ratings_since_rec_notif FROM old) + 1 >= 5 THEN 0
                        ELSE (SELECT ratings_since_rec_notif FROM old) + 1
                    END
                    FROM params
                    WHERE users.id = params.user_id AND EXISTS (SELECT 1 FROM old)
                    RETURNING users.id
                ),
                threshold AS (
                    SELECT
                        (SELECT ratings_since_rec_notif FROM old) + 1 >= 5 AS hit,
                        COALESCE((SELECT notification_prefs ->> 'recommendations_ready' FROM old)::boolean, true) AS pref_enabled
                ),
                recent AS (
                    SELECT EXISTS (
                        SELECT 1 FROM notifications, params
                        WHERE notifications.user_id = params.user_id
                          AND notifications.type = 'recommendations_ready'
                          AND notifications.created_at > now() - interval '24 hours'
                    ) AS on_cooldown
                )
                INSERT INTO notifications (user_id, type, title, body)
                SELECT params.user_id, 'recommendations_ready', %s, %s
                FROM params, threshold, recent
                WHERE threshold.hit AND threshold.pref_enabled AND NOT recent.on_cooldown
                """,
                (user_id, title, body)
            )
        conn.commit()
    finally:
        conn.close()


def run_re_engagement_scan(now=None):
    """
    Writes one re_engagement notification per qualifying user: inactive
    7+ days by COALESCE(last_active_at, created_at), hasn't muted the
    type, and hasn't received one in the last 7 days. A single
    set-based INSERT ... SELECT ... WHERE NOT EXISTS, so running it
    twice in the same window is a no-op, not a duplicate write (spec
    0006 AC-2). now defaults to the database's own clock; a caller (a
    test) can pin it for a deterministic scenario. Excludes deactivated
    accounts (spec 0009 AC-8) -- a user in their 30 day grace period
    shouldn't get pulled back in. Returns the number of notifications
    written.
    """
    title, body = NOTIFICATION_COPY["re_engagement"]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notifications (user_id, type, title, body, created_at)
                SELECT u.id, 're_engagement', %s, %s, COALESCE(%s, now())
                FROM users u
                WHERE u.deactivated_at IS NULL
                  AND COALESCE(u.last_active_at, u.created_at) < COALESCE(%s, now()) - interval '7 days'
                  AND COALESCE((u.notification_prefs ->> 're_engagement')::boolean, true)
                  AND NOT EXISTS (
                      SELECT 1 FROM notifications n
                      WHERE n.user_id = u.id
                        AND n.type = 're_engagement'
                        AND n.created_at > COALESCE(%s, now()) - interval '7 days'
                  )
                """,
                (title, body, now, now, now)
            )
            inserted = cur.rowcount
        conn.commit()
        return inserted
    finally:
        conn.close()


def get_notifications(user_id, limit=50):
    """The user's most recent notifications, newest first (spec 0006 AC-3)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, type, title, body, read_at, created_at
                FROM notifications
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, limit)
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_unread_notification_count(user_id):
    """Count of the user's unread notifications (spec 0006 AC-4)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND read_at IS NULL",
                (user_id,)
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def mark_notification_read(user_id, notification_id):
    """
    Mark one of the user's own notifications read; idempotent if already
    read. Scoped to user_id in the WHERE clause, so a notification_id
    belonging to someone else finds no row -- the caller reports that as
    404 (spec 0006 AC-5). Returns whether a row was found.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE notifications
                SET read_at = COALESCE(read_at, now())
                WHERE id = %s AND user_id = %s
                RETURNING id
                """,
                (notification_id, user_id)
            )
            found = cur.fetchone() is not None
        conn.commit()
        return found
    finally:
        conn.close()


def mark_all_notifications_read(user_id):
    """Mark every currently-unread notification of the user's read in one call (spec 0006 AC-6). Returns how many were marked."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
                (user_id,)
            )
            marked = cur.rowcount
        conn.commit()
        return marked
    finally:
        conn.close()


def get_notification_prefs(user_id):
    """
    Read-only fetch of the user's notification_prefs, with no
    last_active_at side effect (unlike get_user_profile) -- used by the
    PATCH endpoint's no-op path (spec 0006 AC-7).
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT notification_prefs FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            return row[0] if row else {"recommendations_ready": True, "re_engagement": True}
    finally:
        conn.close()


def update_notification_prefs(user_id, updates):
    """
    Partial-merge one or both notification_prefs keys into the existing
    JSONB object rather than replacing it (spec 0006 AC-7); the caller
    (main.py) rejects an unknown key with 422 before this ever runs.
    Returns the updated prefs object.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET notification_prefs = notification_prefs || %s::jsonb
                WHERE id = %s
                RETURNING notification_prefs
                """,
                (json.dumps(updates), user_id)
            )
            row = cur.fetchone()
        conn.commit()
        return row[0] if row else None
    finally:
        conn.close()


if __name__ == "__main__":
    create_tables()