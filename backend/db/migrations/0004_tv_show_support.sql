-- Adds TV show support (spec 0010): a media_type discriminator on movies
-- and ratings, promoted into part of movies' primary key so a movie and a
-- TV show that happen to share the same raw TMDB id never collide. Also
-- adds three TV-only columns and a shared status column. release_date and
-- director are reused for a TV row (first_air_date and creator(s)
-- respectively) rather than adding parallel columns -- see the comment on
-- CREATE_TABLES_SQL in db/import_data.py for the same note on a fresh
-- database.
--
-- Phased: add nullable, backfill, then constrain with a transitional
-- DEFAULT (dropped later, once the backend/mobile code deploying
-- media_type on every write is confirmed live -- see spec 0010's
-- Migration plan phase 6, not part of this file).
--
-- Re-runnable: IF NOT EXISTS / IF EXISTS / existence checks throughout,
-- and a backfill that only touches still-null rows, make this safe
-- against a second run.

-- ---------- Phase 1: add nullable columns ----------

ALTER TABLE movies ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS number_of_seasons INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS number_of_episodes INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS episode_runtime INTEGER;

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS media_type TEXT;

-- ---------- Phase 2: backfill ----------

UPDATE movies SET media_type = 'movie' WHERE media_type IS NULL;
UPDATE ratings SET media_type = 'movie' WHERE media_type IS NULL;

-- ---------- Phase 3: constrain, with a transitional default ----------
-- The DEFAULT is load bearing, not cosmetic: it keeps any still-deployed
-- old code (inserting without media_type) from failing on every write
-- during the gap before the media_type-aware backend ships. Dropped in a
-- later migration once that code is confirmed live (spec 0010 phase 6).

ALTER TABLE movies ALTER COLUMN media_type SET DEFAULT 'movie';
ALTER TABLE movies ALTER COLUMN media_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'movies_media_type_check'
    ) THEN
        ALTER TABLE movies ADD CONSTRAINT movies_media_type_check CHECK (media_type IN ('movie', 'tv'));
    END IF;
END $$;

ALTER TABLE ratings ALTER COLUMN media_type SET DEFAULT 'movie';
ALTER TABLE ratings ALTER COLUMN media_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ratings_media_type_check'
    ) THEN
        ALTER TABLE ratings ADD CONSTRAINT ratings_media_type_check CHECK (media_type IN ('movie', 'tv'));
    END IF;
END $$;

-- Drop the ratings -> movies(id) FK first: it depends on movies' current
-- (id)-only primary key, which the next step replaces.
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_movie_id_fkey;

-- Composite primary key on movies (id, media_type), replacing (id) alone.
ALTER TABLE movies DROP CONSTRAINT IF EXISTS movies_pkey;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'movies_pkey'
    ) THEN
        ALTER TABLE movies ADD CONSTRAINT movies_pkey PRIMARY KEY (id, media_type);
    END IF;
END $$;

-- Composite unique constraint on ratings (was (user_id, movie_id) alone).
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_user_id_movie_id_key;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ratings_user_id_movie_id_media_type_key'
    ) THEN
        ALTER TABLE ratings ADD CONSTRAINT ratings_user_id_movie_id_media_type_key UNIQUE (user_id, movie_id, media_type);
    END IF;
END $$;

-- Composite foreign key on ratings (movie_id, media_type) -> movies(id, media_type).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ratings_movie_id_media_type_fkey'
    ) THEN
        ALTER TABLE ratings ADD CONSTRAINT ratings_movie_id_media_type_fkey
            FOREIGN KEY (movie_id, media_type) REFERENCES movies (id, media_type);
    END IF;
END $$;

-- Postgres does not auto-index a foreign key column.
CREATE INDEX IF NOT EXISTS idx_ratings_movie_id_media_type ON ratings (movie_id, media_type);
