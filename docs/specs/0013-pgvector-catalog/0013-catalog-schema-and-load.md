# 0013. Catalog schema, backfill, and bulk load

## Summary

This child adds the new columns and tables to Postgres, gives the 551 movies already there an embedding and detail data, and builds the one time script that loads the best titles from the big CSV until a size cap is reached. It is the data foundation the other two children read and write.

## Requirements

Satisfies **AC-1** (measurement), **AC-8**, **AC-9**, **AC-13** of the umbrella ([index.md](index.md)). Read the umbrella's data model and cross child contract first.

## Design

**Migration** `backend/db/migrations/0006_pgvector_catalog.sql` (idempotent, additive, no drops):

1. `CREATE SCHEMA IF NOT EXISTS extensions;` then `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;` and `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;`. The schema line makes it work on a plain Postgres (tests) as well as Supabase. The build confirms the `vector` type and the `gin_trgm_ops` operator class resolve under the connection's `search_path`, and qualifies them with `extensions.` if they do not.
2. `ALTER TABLE movies ADD COLUMN IF NOT EXISTS` for `embedding vector(384)`, `embedding_model text`, `popularity real`, `refreshed_at timestamptz DEFAULT now()`, then `ALTER TABLE movies ALTER COLUMN embedding SET STORAGE PLAIN` so the vector stays inline in the row.
3. `CREATE TABLE IF NOT EXISTS movie_details` and `watch_provider_cache` as defined in the umbrella, each with `ENABLE ROW LEVEL SECURITY` and no policies.
4. `CREATE INDEX IF NOT EXISTS` for the trigram index on `lower(title)` and the btree on `popularity DESC NULLS LAST`.
5. The fresh database schema block in `db/import_data.py` gets the same definitions (the existing pattern: the migration covers live databases, the block covers fresh ones).

Run it first on Supabase, then check with a query that both extensions are installed and the new columns exist.

**Shared pieces** (one small module the loader, the refresh, and live resolve all import, so text and vectors are built one way):
- `build_combined_text(...)`: the single function that builds `overview genres keywords tagline` text, the same format as today.
- `vector_literal(array)`: turns a float32 array into the `'[0.1,0.2,...]'` text form for a `::vector` cast.
- `escape_like(text)`: escapes `%`, `_`, and the escape character for `LIKE` and `ILIKE` patterns.
- The embedder wrapper `_Embedder` already in `recommend.py` (fastembed, model id from the cross child contract, cache folder from `FASTEMBED_CACHE_PATH`).
- One writer function that upserts a `movies` row and its `movie_details` row together. The bulk load, the refresh, and live resolve all use it, which replaces `import_movies` and `upsert_movie` (those old insert only paths are removed in the final cleanup).

**Backfill** (one time, the loader's first step): select rows where `embedding IS NULL`, embed each row's stored `combined_text` as is (no rebuilding from CSV columns, because `movies` has no tagline column and `combined_text` already contains it), in batches of 256, and update `embedding`, `embedding_model`, `refreshed_at`. The same pass also fills `popularity` and the `movie_details` row for these rows from the CSV (match on `(id, media_type)`, `movies_test.csv` first, then `movies.csv`), and for any row not found in either CSV leaves `popularity` null and lets the detail endpoint fill `movie_details` lazily.

**Bulk load script** `backend/db/load_catalog.py`:
- Reads `data/movies.csv` with `usecols` that leave out `watch_providers_json` (about 160 MB in memory instead of 894), drops rows without a title, drops rows where `adult` is true, sorts by `vote_count` descending across movies and TV, and drops duplicate `(id, media_type)` keys.
- Before embedding, loads the set of `(id, media_type)` that already have an embedding, a `movie_details` row, and a non null `popularity`, and skips those (resumable and cheap to rerun).
- Per batch of about 500 rows: builds `combined_text`, embeds, then calls the shared writer in one transaction with `ON CONFLICT (id, media_type) DO UPDATE` (fills in missing embedding, popularity, and details on an existing row). Uses `execute_values`. The batch is deduplicated first, so one statement never touches the same key twice.
- `movie_details` fields come from the CSV: `tagline`, `runtime`, `backdrop_path`, `trailer_keys`, and `cast_photos` parsed from `cast_photos_json`.
- After each batch queries `pg_database_size(current_database())`. At about 10k, 25k, and 50k loaded rows it prints a report (rows, size in MB, percent of cap), measures the process resident memory, and runs `EXPLAIN ANALYZE` of a sample similarity query. When size reaches `CATALOG_SIZE_CAP_MB` (default 300) it prints a warning and stops with exit code 0.
- Never stores `watch_providers_json`.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Backfill | Text to embed | `movies.combined_text` already stored |
| Backfill | `popularity`, details | CSV match on `(id, media_type)`, else left for lazy fill |
| Load | Row order | `vote_count` from `data/movies.csv`, descending |
| Load | Excluded rows | no title, or `adult` true |
| Load | `popularity` | CSV `popularity` column |
| Load | `cast_photos` | CSV `cast_photos_json`, parsed |
| Load | `embedding` | embedder on `build_combined_text` |
| Load | Stop condition | `pg_database_size` against `CATALOG_SIZE_CAP_MB` |

**Key invariants**: the script is safe to interrupt and rerun; it never deletes; every written row has the same `embedding_model` and a stored `combined_text`; it never writes a row without a title.

**Security**: reads `DATABASE_URL` from the environment or `.env`, run locally by the developer. No new endpoint.

**Critical test scenarios**:
- Migration twice, and once on a fresh plain Postgres: second run changes nothing, **AC-13**.
- Backfill: all 551 existing rows end with a non null embedding and a details row where the CSV had one, **AC-9**.
- Bulk load on a small fixture CSV: rows ordered by votes, adult rows skipped, duplicate keys handled, resumable on a second run, stops at a tiny test cap, **AC-8**.
- The loaded row for a TV show has `media_type = 'tv'` and its `movie_details` row, **AC-8**.

## Build plan

1. Write the migration and update the schema block in `import_data.py`, **AC-13**. (built, applied twice to Supabase)
2. Add the shared helpers module (`build_combined_text`, `vector_literal`, `escape_like`, the shared writer) and tests, **AC-13**. (built, `test_catalog.py`)
3. Write the backfill and the bulk load script with the size cap, resume rule, and checkpoint reports, **AC-8**, **AC-9**. (built; backfill run, bulk load not run yet)
4. Run the migration and backfill on Supabase, then load to about 10k rows and record the measured size, resident memory, and sample query timing.

## Rationale (short)

One column on `movies` keeps upserts and the ratings foreign key simple, and plain storage keeps the scan from chasing a side store per row. Loading by votes with a measured cap replaces a guessed row cutoff, because the real per row size is not yet known. One shared writer keeps the three write paths identical.
