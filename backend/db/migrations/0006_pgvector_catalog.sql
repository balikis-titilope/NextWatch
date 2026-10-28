-- Moves the movie catalog's embeddings into Postgres (spec 0013): a pgvector
-- column on movies, a side table for detail fields, and a per country cache
-- of watch providers. Additive only: nothing is dropped, so the old code
-- keeps running against the same database and a rollback is just a redeploy.
--
-- Re-runnable: IF NOT EXISTS throughout, so a second run changes nothing.
-- The schema line lets this work on a plain Postgres (tests) as well as on
-- Supabase, where the extensions schema already exists.

-- ---------- Extensions ----------

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------- movies: new columns ----------
-- embedding stays NULL until backfilled or embedded. A row with a null
-- embedding is never returned by a similarity query (spec 0013 invariants).

ALTER TABLE movies ADD COLUMN IF NOT EXISTS embedding extensions.vector(384);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS popularity REAL;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ DEFAULT now();

-- Keep the 1.5 KB vector inline in the row so an exact scan does not chase a
-- side store for every row.
ALTER TABLE movies ALTER COLUMN embedding SET STORAGE PLAIN;

-- ---------- movie_details ----------
-- Fields only the detail screen reads. At most one row per movies row.

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

-- ---------- watch_provider_cache ----------
-- One row per title and requested country. payload is already resolved
-- through the country fallback: {flatrate, rent, buy}, each a list of
-- {provider_name, logo_path}.

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

-- ---------- Indexes ----------
-- Trigram index for typeahead search; btree for Trending and Browse order.
-- There is deliberately no vector index (exact scan first, see spec 0013).

CREATE INDEX IF NOT EXISTS idx_movies_title_trgm
    ON movies USING gin (lower(title) extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_movies_popularity
    ON movies (popularity DESC NULLS LAST);
