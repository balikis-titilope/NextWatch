# 0013. Move the movie catalog and embeddings into Postgres (pgvector)

**Date**: 2026-10-11
**Status**: In Progress

## Summary

The backend now loads the whole movie catalog and every embedding (the list of numbers that describes what a title is about) into server memory at startup. That ran a small cloud container out of memory, and it means new movies only arrive after a local rebuild and a redeploy. This spec moves the catalog and the embeddings into your existing Supabase Postgres using pgvector, so the server starts empty and asks the database for matches. A daily GitHub job keeps the catalog fresh by itself. The mobile app does not change, because every API response keeps its current shape.

## Structure

This is an umbrella spec. Each child is complete enough to build from on its own.

- [0013-catalog-schema-and-load.md](0013-catalog-schema-and-load.md): the migration, the one time backfill and bulk load with its size cap. Supports AC-8, AC-9, AC-13.
- [0013-engine-on-postgres.md](0013-engine-on-postgres.md): how every read endpoint (recommend, similar, trending, browse, search, detail) computes from Postgres instead of memory, plus the connection pool. Supports AC-1 to AC-5, AC-12, AC-14 to AC-16.
- [0013-live-resolve-and-refresh.md](0013-live-resolve-and-refresh.md): the write paths, meaning live resolve of a new title, background model loading, the size ceiling, and the daily refresh job. Supports AC-6, AC-7, AC-10, AC-11.

**Cross child contract** (every child must honor this):

- One embedding model, fastembed id `sentence-transformers/all-MiniLM-L6-v2` (384 numbers, unit length, float32). Every writer (bulk load, refresh, live resolve, on demand embedding) stores that exact string in `movies.embedding_model`. No query filters on it, but a startup check, run in a background thread so it can never block or fail startup, logs a warning if more than one value exists.
- Rows are identified by `(id, media_type)` everywhere, never by `id` alone (spec 0010).
- Similarity means cosine distance, computed by the pgvector operator `<=>`. Displayed similarity is `1 - distance`.
- `combined_text` is built by one shared function, the same text format as today (`overview genres keywords tagline`), and every writer stores it in `movies.combined_text`. Anything that embeds an existing row embeds that stored text as is.
- All new tables have row level security (RLS) on with no policies, like the four existing tables. The backend and the refresh job connect with `DATABASE_URL`, as today.
- A `movies` row may exist with `embedding IS NULL` (for example a title resolved while the model was still loading). Similarity queries never return such a row as a candidate. Anything that needs the vector of such a row embeds its stored `combined_text` on demand and saves it, or returns `503` with `Retry-After: 15` when the model is not ready. The daily refresh also sweeps null embeddings.

## Requirements

**User stories**:
- As a user, I want recommendations, trending, search, and detail to keep working exactly as they do now, so I notice no change.
- As the developer, I want the server to start fast and stay small in memory, so the free cloud container no longer runs out of memory.
- As the developer, I want new and popular titles to appear in the catalog on their own, so I never rebuild and redeploy to refresh data.
- As the developer, I want the catalog to stay under a size I choose, and public routes unable to fill the database, so the free 500 MB database never goes read only.

**Acceptance criteria** (the contract, each one independently checkable):

- **AC-1**: The server starts and serves `/docs` and every endpoint that needs no embedding model without loading the catalog or the model. Startup memory (resident set size right after startup) with about 10k catalog rows loaded is within 30 MB of startup with 551 rows.
- **AC-2**: Every existing endpoint keeps its path, request fields, response fields, and score meaning from specs 0005 and 0010. The mobile app needs no code change. The only removed route is `POST /admin/reload` (AC-14).
- **AC-3**: `POST /recommend` ranks by cosine similarity in Postgres over `movies.embedding`. It keeps today's rules: taste vector from ratings (signed weights around the neutral point 3), optional mood blend by `mood_weight`, rated titles excluded, language, actor, and year range filters, and an empty list when there is no taste and no mood. It returns `404` only when a filter is set and the filters alone match no rows at all; if titles match the filters but all are excluded or lack embeddings, it returns `[]`. For a set of fixed test users, the top 10 ids match a golden file saved from the in memory engine before it is removed, except that titles whose similarity is within 0.001 of each other may swap order.
- **AC-4**: `GET /movies/trending` (votes at least 50, ordered by `vote_average` then `popularity` both `NULLS LAST`, then `id`, `media_type`), `GET /movies` (filters plus `media_type`, ordered by `popularity` descending `NULLS LAST`, then `id`, `media_type`), `GET /movies/search`, `GET /movies/{media_type}/{id}/similar`, and the legacy `GET /movies/{title}/similar` are all served from Postgres. Trending cards still carry the user's match score. The legacy route keeps returning the raw similarity rounded to 2 places, not a calibrated score. Titles without an embedding are never returned by a similarity query but remain searchable and ratable.
- **AC-5**: `GET /movies/{media_type}/{id}` reads `tagline`, `runtime`, `backdrop_path`, `trailer_keys`, and `cast_photos` from `movie_details`; if that row is missing it fetches the title once from TMDB, writes the row, and serves it. Watch providers come from `watch_provider_cache` under the user's country (`NG` when the user has none). On a missing or older than 24 hours row it makes one provider call to TMDB (3 second timeout, no retries), applies the existing country fallback (user's country, then NG, then US), and stores the resolved result under the requested country key. If TMDB fails it serves a stale row when one exists, otherwise empty providers, and the rest of the detail still loads.
- **AC-6**: Resolving a title that is not in the catalog (by title or by id) fetches it from TMDB and, in one transaction, writes the `movies` row and its `movie_details` row. If the model is ready it embeds the title first; if not, it writes the row with a null embedding. Either way the title is rateable at once and the route never returns `503`. A typed title is first matched locally (leading article stripped, so "the titanic" finds "Titanic"), and after a TMDB search returns an id the local primary key is checked before anything is fetched or embedded. Two simultaneous resolves of the same title never produce an error or a duplicate, and an existing row with a null embedding gets its embedding filled in.
- **AC-7**: The embedding model loads in a background thread at startup when `EMBEDDING_PRELOAD` is true (the default), without delaying readiness; with it false, the first need starts the same background load. A request that needs a vector right now while the model is not ready (mood text in `/recommend`, `/predict`, the ad hoc `liked_titles` path, and similar or detail score for a title whose embedding is null) gets `503` with `Retry-After: 15`. No other endpoint is affected. A failed load logs the error, clears the loading state, and the next need starts a new background load.
- **AC-8**: A bulk load script loads titles from `data/movies.csv`, movies and TV ranked together by `vote_count` highest first, excluding adult titles, in batches. It is resumable: before embedding, it reads the keys that already have an embedding, details row, and popularity, and skips those. It prints a size report at about 10k, 25k, and 50k rows and stops by itself when `pg_database_size` reaches `CATALOG_SIZE_CAP_MB` (default 300).
- **AC-9**: A one time backfill gives the 551 rows already in `movies` an embedding (from their stored `combined_text`), a `movie_details` row, and `popularity`. After it, similarity queries ignore rows where `embedding` is null.
- **AC-10**: A daily GitHub Actions job runs a refresh script. It adds titles with at least 10 votes that were released in the last 30 days or rank high on TMDB popularity (5 pages per type, adult excluded), refreshes `vote_average`, `vote_count`, `popularity`, `poster_path`, and `backdrop_path` for a rotating slice of existing rows (oldest `refreshed_at` first, about one thirtieth of all rows per run), and embeds any rows with a null embedding. A title TMDB no longer has (`404`) advances its `refreshed_at` and is not a failure. The script exits with a non zero code if a database error occurs or more than 20 percent of TMDB calls fail for other reasons, and it prints the newest `refreshed_at` so freshness can be read from the logs.
- **AC-11**: At or over `CATALOG_SIZE_CAP_MB`, bulk load and refresh stop adding rows and print a warning, and nothing is ever deleted automatically. Live resolve still inserts a title until the database reaches a hard ceiling of the cap plus 100 MB; at the ceiling it refuses new titles with `503` and the message that the catalog is full, so a script can never push the database to the 500 MB read only limit. `POST /movies/resolve`, `POST /predict`, and `GET /movies/{title}/similar` are rate limited per client address with the existing slowapi limiter (30 per minute).
- **AC-12**: Typeahead search finds a title by substring (query of at least 2 characters), tolerates a one letter typo for queries of at least 4 characters, returns one row per `(id, media_type)`, and does not match unrelated words. Required cases: `interstelar` finds Interstellar, `dune` finds Dune and a one letter typo of it finds it, and `healer` does not return `shelter`. The characters `%` and `_` in a query or actor name are treated as plain text.
- **AC-13**: The migration is additive and safe to run twice, including on a fresh plain Postgres. It leaves `ratings`, `users`, and `notifications` untouched, enables RLS on every new table, and can be undone by reverting the code and redeploying, because nothing is dropped.
- **AC-14**: `POST /admin/reload` is removed. It has no authentication today and has no meaning once nothing is held in memory.
- **AC-15**: Database access goes through a pooled helper (maximum 5 connections) that waits up to 5 seconds for a free connection instead of failing, checks a connection is alive before use, and always commits or rolls back before returning it. More than 5 concurrent requests all succeed.
- **AC-16**: `GET /` keeps its current keys. `movies_loaded` is taken from a database row estimate instead of the removed memory table, and a database outage makes the route report the error without crashing the server.

## Decision

**Chosen option**: Option 2: Move the catalog and embeddings into Postgres with pgvector and an exact (full) scan, load it by vote count within a size cap, and keep it fresh with a daily GitHub job.

Embeddings become a `vector(384)` column on the existing `movies` table (stored inline, not moved out of the row), detail fields go in a side `movie_details` table, watch providers are cached per title and country, and the recommendation math splits cleanly: Python builds the taste vector from a user's rated embeddings (unchanged math), and Postgres ranks every title against it.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `backend/.agents/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `backend/.agents/skills/supabase/`) · `fastapi-templates` (`wshobson/agents`, `backend/.agents/skills/fastapi-templates/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model**:

`movies` (existing, key `(id, media_type)`), additions only:

| Column | Type | Notes |
|---|---|---|
| `embedding` | `vector(384)`, nullable, `STORAGE PLAIN` | float32, unit length. Null until backfilled or embedded. Plain storage keeps the 1.5 KB vector inline so a scan does not fetch it from a side store per row. |
| `embedding_model` | text | The model id written with the vector. |
| `popularity` | real, nullable | TMDB popularity, used to sort Trending and Browse. |
| `refreshed_at` | timestamptz, default `now()` | Orders the rotating stat refresh. |

New indexes on `movies`: a trigram index (GIN, `gin_trgm_ops`) on `lower(title)`, and a btree on `popularity` descending. There is no vector index at first (see invariants).

`movie_details` (new): key `(id, media_type)` referencing `movies` with `ON DELETE CASCADE`. Columns: `tagline` text, `runtime` integer, `backdrop_path` text, `trailer_keys` text (pipe separated, as today), `cast_photos` jsonb (list of `{name, profile_path}`). One row per `movies` row at most. Read by the detail endpoint.

`watch_provider_cache` (new): key `(id, media_type, country)` referencing `movies` with `ON DELETE CASCADE`. Columns: `payload` jsonb (`{flatrate, rent, buy}`, each a list of `{provider_name, logo_path}`, already resolved through the country fallback), `fetched_at` timestamptz. Many rows per `movies` row (one per requested country).

Relationships: `movies` 1 to 0..1 `movie_details`; `movies` 1 to N `watch_provider_cache`; `ratings` N to 1 `movies` (existing foreign key, unchanged). Extensions: `vector` and `pg_trgm`.

**State transitions**: none. A `movies` row moves from `embedding IS NULL` to `embedding IS NOT NULL` once, and `refreshed_at` moves forward on each stat refresh.

**API surface** (unchanged contract, listed to show what each reads and which new errors exist):

| Endpoint | Method | Reads from | Auth | Key errors |
|---|---|---|---|---|
| `/` | GET | row estimate | none | none new |
| `/recommend` | POST | `movies.embedding` ranking, ratings | optional bearer | 404 only when the filters alone match nothing, 503 when the model is not ready and `mood_text` or `liked_titles` need a vector |
| `/movies/trending` | GET | `movies` | bearer | none new |
| `/movies` | GET | `movies` | none | none new |
| `/movies/search` | GET | `movies` (trigram) | none | none new |
| `/movies/resolve` | POST | `movies`, else TMDB then write | none, rate limited | 404, 429, 503 only when the catalog is full |
| `/movies/{media_type}/{id}` | GET | `movies`, `movie_details`, `watch_provider_cache` | bearer | 404, 502 when TMDB is down and the title is not local, 503 when the title needs an embedding and the model is not ready |
| `/movies/{media_type}/{id}/similar` | GET | `movies.embedding` | bearer | 404, 503 as above |
| `/movies/{title}/similar` | GET | `movies.embedding` | none, rate limited | 404, 429, 503 |
| `/predict` | POST | `movies.embedding` | none, rate limited | 404, 429, 503 |
| `/admin/reload` | POST | removed | | |

**Value sourcing** (every value an action produces or displays, and where it comes from):

| Action | Value | Source |
|---|---|---|
| `/recommend` | Taste vector | Python, from `embedding::real[]` of the user's rated titles joined on `(movie_id, media_type)` with their ratings, same formula as today |
| `/recommend` | Personal ceiling for `predicted_score` | Same rated rows, average cosine of 4 and 5 star titles to the taste vector, same formula as today |
| `/recommend` | Query vector | `combine_vectors(taste, mood)` with `mood_weight` from the request; a taste vector whose norm is zero counts as no taste |
| `/recommend` | Mood vector | The embedding model encoding `mood_text` from the request |
| `/recommend`, trending | Raw similarity shown per result | SQL column `taste_similarity = 1 - (embedding <=> taste vector)` in the result row, null when there is no taste vector |
| `/recommend` | Rated titles to exclude | `NOT EXISTS` against `ratings` for the bearer user |
| `/recommend` | 404 or empty list | `EXISTS` over the filters alone, when the ranking result is empty and a filter is set |
| Trending | Minimum votes 50 | Constant in code (same as today's `min_vote_count`) |
| Detail | Provider country | `users.country`, `NG` when null; cache key is that value |
| Detail | Provider content | TMDB call after the existing fallback (country, then NG, then US), stored under the requested country |
| Detail | Cache freshness | `watch_provider_cache.fetched_at` against a 24 hour constant |
| Detail | Cast photos, tagline, runtime, backdrop, trailer | `movie_details`; a missing row is fetched from TMDB once |
| Live resolve | Vector | Embedding model on stored or built `combined_text`; null when the model is not ready |
| Live resolve | Catalog full | `pg_database_size` against cap plus 100 MB |
| Bulk load | Rank order | `vote_count` descending from `data/movies.csv`, adult excluded |
| Bulk load | Current size | `pg_database_size(current_database())` |
| Bulk load | Size cap | `CATALOG_SIZE_CAP_MB`, default 300 |
| Refresh | New window and minimum votes | 30 days and 10 votes, constants in the refresh script |
| Refresh | Rotating slice size | `ceil(total rows / 30)`, rows with the oldest `refreshed_at` |
| Refresh | TMDB access | `TMDB_TOKEN` GitHub secret |
| Refresh | Database access | `DATABASE_URL` GitHub secret |
| `GET /` | `movies_loaded` | `pg_class.reltuples` estimate for `movies` |

**Key invariants**:
- Every `(id, media_type)` in `ratings` exists in `movies`. No code path deletes a `movies` row.
- Similarity queries only consider rows with `embedding IS NOT NULL`.
- Similarity uses an exact scan. A vector index is added only when measurement shows a recommend query over 300 ms on the real loaded size, then only with a recall check against the exact results, and only after reserving its space (about 100 MB at 60k rows) by lowering the cap.
- Total database size stays under the cap through the writers that respect it (bulk load, refresh), and never passes cap plus 100 MB through any writer.
- Embedding model id is identical on every written row (see cross child contract).
- SQL parameters are always bound, never formatted into the statement text, and `%` and `_` from user input are escaped before they go into a `LIKE` pattern.

**Security model**: no new public routes (one is removed). All new tables have RLS on with no policies, so Supabase's public API cannot read them; the backend connects with `DATABASE_URL`, which bypasses RLS, as it does today. The three public routes that can write (`/movies/resolve`, `/predict`, legacy `/similar`) are rate limited and stop at the hard ceiling. The refresh job holds `TMDB_TOKEN` and `DATABASE_URL` only as GitHub Actions secrets, never printed. No personal data is added to any new table.

**Configuration required**:
- `EMBEDDING_PRELOAD`: `true` (default) loads the model in the background at startup, `false` starts the same load on first need.
- `CATALOG_SIZE_CAP_MB`: size ceiling for the bulk load and the refresh, default `300`. The hard ceiling for live resolve is this value plus 100.
- `FASTEMBED_CACHE_PATH`: folder where fastembed keeps the downloaded model (set explicitly so the container and the GitHub cache agree).
- GitHub repository secrets `TMDB_TOKEN` and `DATABASE_URL` for the refresh workflow (`DATABASE_URL` is already set for the keep alive workflow and must be the IPv4 session pooler URL).

**Critical test scenarios** (run against a Postgres with pgvector, the `pgvector/pgvector` Docker image, with `CREATE SCHEMA IF NOT EXISTS extensions` run first):
- Happy path: fixed test users call `/recommend` and the top 10 ids match the golden file, verifies **AC-3**.
- Edge case: a user with no ratings sends only `mood_text`, and a request with filters that match nothing returns `404` while filters that match only excluded titles return `[]`, verifies **AC-3**.
- Happy path: detail for a loaded title returns cast, tagline, runtime, and providers for the user's country; a title without a details row gets one on first view, verifies **AC-5**.
- Failure case: TMDB down on detail serves stale providers or empty ones with `200` in under 5 seconds, verifies **AC-5**.
- Happy path: resolving a brand new TMDB title writes `movies` and `movie_details`, then it appears in `/similar`, verifies **AC-6**.
- Failure case: resolving while the model is not ready writes a row with a null embedding and returns it, never `503`; mood text and `/predict` do return `503` with `Retry-After`, and `/movies/trending` still returns `200`, verifies **AC-6**, **AC-7**.
- Failure case: two simultaneous resolves of one title leave exactly one row, no error, verifies **AC-6**.
- Failure case: bulk load reaches the cap and stops with a warning, a rerun adds nothing, verifies **AC-8**, **AC-11**.
- Failure case: at the hard ceiling a new anonymous resolve returns `503` with the catalog full message, verifies **AC-11**.
- Edge case: search `interstelar`, `dune`, a one letter typo of `dune`, and `healer`; `%` in a query matches nothing special, verifies **AC-12**.
- Edge case: rows with null embeddings never appear in `/recommend` or `/similar`, verifies **AC-9**.
- Edge case: 8 concurrent requests all succeed with a pool of 5, verifies **AC-15**.
- Edge case: running the migration twice, and once on a fresh plain Postgres, changes nothing the second time, verifies **AC-13**.
- Auth: `/admin/reload` returns `404`, verifies **AC-14**; protected endpoints still return `401` without a token, verifies **AC-2**.

## Build plan

Build approach is the project default, Journey (one complete user journey at a time), applied here as: the data must exist before any read path can be proven, then each read journey is finished completely before the next, then the write paths, then cleanup.

1. Freeze the reference: run the current in memory engine for a fixed set of test users and save each top 10 result list as a golden file, satisfies **AC-3**. (Do this before any engine code changes.) (built: `backend/golden/make_golden.py`, `backend/golden/recommend_top10.json`)
2. Write migration `db/migrations/0006_pgvector_catalog.sql` and update the fresh database schema block in `db/import_data.py` to match (including `CREATE SCHEMA IF NOT EXISTS extensions`), satisfies **AC-13**. (child: catalog schema and load) (built and applied to Supabase)
3. Build the backfill for the 551 existing rows and the bulk load script with the size cap and checkpoint reports, run it to about 10k rows and record the measured size, startup memory, and sample query timing, satisfies **AC-8**, **AC-9**, **AC-1**. (child: catalog schema and load) (built; run to 10,048 rows: 53.4 MB, sample query 20 ms, memory not yet measured)
4. Add the pooled connection helper and the shared helpers (vector to text literal, shared `combined_text` function, LIKE escaping), satisfies **AC-15**. (child: engine on Postgres) (built: `backend/db/pool.py` with `connection()` and `warm_up()`, tests in `backend/test_pool.py`; the shared helpers already live in `backend/db/catalog.py`)
5. Recommend journey: taste vector from stored embeddings, `/recommend` ranking, filters, personal ceiling, `/predict`, satisfies **AC-3**. (child: engine on Postgres) (built: `backend/db/engine.py`, taste math on rows and resolve helpers in `backend/recommend.py`, the four routes in `backend/main.py`; `python -m golden.check_golden` passes 14 of 14; tests in `backend/test_engine.py`)
6. Browse journey: trending, browse, trigram search, id and title similar, the root route, satisfies **AC-4**, **AC-12**, **AC-16**. (child: engine on Postgres) (built: `trending_titles`, `browse_titles`, `search_titles`, `estimate_movie_count` in `backend/db/engine.py`, the routes in `backend/main.py`)
7. Detail journey: `movie_details` read with lazy fill, and the provider cache with a short TMDB call, satisfies **AC-5**. (child: engine on Postgres) (built: `backend/db/details.py`, `load_detail` and `get_watch_providers` in `backend/recommend.py`)
8. Background model loading, on demand embedding, and the `503` behavior, satisfies **AC-7**. (child: live resolve and refresh) (built: `backend/db/embedder.py`, the `503` handler in `backend/main.py`)
9. Live resolve write path with null embedding allowed, conflict handling, the hard ceiling, and rate limits, satisfies **AC-6**, **AC-11**. (child: live resolve and refresh) (built: `store_new_title`, `resolve_catalog_title` in `backend/recommend.py`, `catalog_is_full` in `backend/db/catalog.py`, rate limits in `backend/main.py`)
10. Refresh script and the daily GitHub workflow, satisfies **AC-10**, **AC-11**. (child: live resolve and refresh) (built: `backend/db/refresh_catalog.py`, `.github/workflows/catalog-refresh.yml`; the script is tested, the workflow has not run on GitHub yet)
11. Remove the in memory path (`state` dataframe, `load_all_data`, title indexes), `POST /admin/reload`, and the old insert only paths `import_movies` and `upsert_movie` (replaced by the shared writer), satisfies **AC-1**, **AC-14**. (built: `state`, `load_all_data`, the title indexes, `POST /admin/reload`, `import_movies` and `upsert_movie` are gone; `scikit-learn` dropped from the requirements)
12. Run the full bulk load to the cap, check the size and recommend latency against the 300 ms trigger, then deploy and verify against the live URL, satisfies **AC-1**, **AC-2**, **AC-8**.

## Migration plan

**Strategy**: additive migration, then a clean cut. No dual path and no feature flag.

**Phases**:
1. Run the additive migration on Supabase. The current code ignores the new columns and tables, so it is safe at any time.
2. Backfill the 551 rows, then bulk load to the size cap (resumable, can be done in several sittings).
3. Deploy the new code that reads Postgres and has the in memory path removed. The backend has not been put into production yet, so there is no live traffic to protect during this switch.
4. Enable the daily refresh workflow after the first deploy is verified.

**Rollback**: revert the code commit and redeploy. The migration dropped nothing, so the old code still runs against the same database. The new columns and tables can stay. Rows written by new code with null embeddings are ignored by old code, and the refresh sweep or on demand embedding fills them later.

**Risks**:
- Loading to the cap could overshoot if rows are larger than estimated. The loader checks size after every batch, and the cap (300 MB) leaves 200 MB below the free tier limit, with the hard ceiling at 400 MB.
- Exact scan latency on shared free tier CPU is unmeasured. Step 3 and step 12 measure it and the invariant above sets the trigger for adding an index.
- Trigram matching scores differ from the old fuzzy matcher, so the thresholds are tuned against the required cases in AC-12 and the existing tests.
- Popularity values from the old CSV and from TMDB today may be on different scales, so Trending order can be mixed until the first full rotation of the stat refresh. The bulk load refreshes `popularity` for the rows it writes only if TMDB is called for them; accept the mix for the first month.

## Consequences

**Positive**:
- The server starts almost empty and stays small in memory, which removes the container out of memory failure for good.
- New and popular titles arrive daily with no local rebuild and no redeploy.
- Titles added by users or by the refresh survive restarts, because Postgres is the only copy.
- The catalog size is bounded by a setting, and public routes cannot fill the free database.
- Rating a new title never waits for the model, because a row can be written before its embedding exists.

**Negative / tradeoffs**:
- Every read endpoint now makes a database call, and each recommend request scans every vector in Postgres. On the free tier's shared CPU this is slower than memory, though still expected to be well under a second at this size.
- The recommendation engine (`recommend.py`, `main.py` read paths) is rewritten from pandas to SQL, with a real chance of subtle ranking differences. The golden file comparison in AC-3 is the guard.
- Part of the logic (the refresh) now runs in GitHub Actions rather than in the app, so a broken secret fails until you read the failure email, and GitHub disables scheduled workflows after 60 days with no repository activity.
- The catalog is capped, so obscure titles outside it are only reachable by search (live resolve), not by recommendation.
- The embedding model still runs on the server for mood text and new titles, so about 200 to 300 MB of memory is used once it loads, and mood requests get `503` for the first minute after a cold start.
- A hard ceiling means that if the catalog is full, a brand new title cannot be added until space is freed or the cap is raised.

**Neutral**:
- `fastembed` (already swapped in) replaces `sentence-transformers`. Vectors are the same model and match within rounding.
- `data/movies.csv` stays a local file used only by the bulk load.
- The backend remains outside the project's `/develop` and `/sync` rule except for this change (see Follow-up).

## Follow-up

- [ ] Backend scope exception: AGENTS.md says `backend/` is out of scope for `/develop` and `/sync`. This change is built under the workflow as a scoped exception. After the build, `/sync` should update that rule to say the backend data layer (catalog, engine, refresh) is covered, and add a `backend/AGENTS.md` context file for it.
- [ ] Enroll this work as a feature row in `docs/scope/scope.md` so the build tasks and spec status track it (the backend feature A is marked `existing`).
- [ ] Optional later: use TMDB `/similar` and `/recommendations` to cover niche out of catalog candidates, embedding them live and merging with catalog results.
- [ ] Optional later: bake the embedding model files into the deploy image so cold starts never download from Hugging Face (not now, because a bigger upload already timed out once).
- [ ] If measured recommend latency passes 300 ms on the loaded size, add an HNSW index with a recall check, after lowering the cap to make room, as the invariant describes.
- [ ] If the catalog nears the cap and you want more rows, the options are Supabase Pro, trimming `cast_members` for the lowest ranked titles, or lowering the cap.
- [ ] The mobile app does not yet handle `503` with `Retry-After` on mood requests. Consider a retry or a friendly message in a later mobile change.
- [ ] Add a heartbeat alert if the refresh stops silently (for example check `max(refreshed_at)` from the keep alive workflow).
