# Verify: pgvector catalog · spec 0013 · updated 2026-10-12
_Steps derived from spec 0013 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones. This file covers the data foundation milestone and the pooled connection helper; later milestones append their own steps._

## UI / manual
- [ ] Nothing user facing in this milestone. The mobile app must behave exactly as before → AC-2

## Commands
Run from `backend/`, with `.venv\Scripts\python.exe`.
- [ ] `python -m unittest test_catalog test_import_data test_recommend` → all pass → AC-13
- [ ] Run `db/migrations/0006_pgvector_catalog.sql` twice against the database → both runs succeed, nothing changes on the second → AC-13
- [ ] Query `pg_extension` → `vector` and `pg_trgm` are installed → AC-13
- [ ] Query `pg_class.relrowsecurity` for `movie_details` and `watch_provider_cache` → both true; `ratings`, `users`, `notifications` unchanged → AC-13
- [ ] `select count(*), count(embedding), count(distinct embedding_model) from movies` → every row has an embedding, one model id → AC-9
- [ ] `select min(vector_norm(embedding)), max(vector_norm(embedding)) from movies` → both about 1 (unit length) → AC-9
- [ ] `python -m db.load_catalog load --max-rows 10000` → prints a size report at 10k with size, memory, and a sample `EXPLAIN ANALYZE` → AC-8
- [ ] Run the same load command a second time → writes 0 new rows (resumable) → AC-8
- [ ] `python -m db.load_catalog load --cap-mb 1` → warns the database is at or over the cap, loads nothing, exits 0 → AC-8, AC-11
- [ ] After a load, `select media_type, count(*) from movies group by 1` and check a `tv` row has a `movie_details` row → TV rows load with details → AC-8
- [ ] Compare loaded ids against the CSV `adult` column → no adult title was loaded → AC-8
- [ ] `golden/recommend_top10.json` exists with 14 cases and non empty top 10 lists (except `no_taste_no_mood`) → AC-3 (reference for the later engine milestone)

## Pooled connections (engine milestone, task 1)
Run from `backend/`, with `.venv\Scripts\python.exe`.
- [ ] `python -m unittest test_pool` → all pass (wait then `PoolTimeout`, dead connection replaced, commit or rollback on every return, 8 callers on a pool of 5) → AC-15
- [ ] Call `db.pool.warm_up()`, then run 8 threads that each open `connection()` and run `select 1` against Supabase → all 8 succeed, none raises `PoolTimeout` → AC-15
- [ ] Same 8 threads in a cold process without `warm_up()`, from a machine far from the database → may hit `PoolTimeout` while the first connections open (1 to 4 seconds each); confirm the deployed server calls `warm_up()` in a background thread at startup → AC-15
- [ ] Run a block that raises inside `connection()`, then check the next block sees no half written row → the failed block was rolled back → AC-15
- [ ] Value sourcing, pool size and wait time: `POOL_SIZE` is 5 and `WAIT_SECONDS` is 5 in `db/pool.py`; `DATABASE_URL` is the session pooler URL → AC-15

## Value sourcing (one step per row of the spec's table)
- [ ] Backfill text: a row's embedding equals the embedding of its stored `combined_text`, not text rebuilt from CSV columns → AC-9
- [ ] Backfill popularity: a row found in `movies_test.csv` has the CSV popularity; the 3 rows in neither CSV keep null popularity → AC-9
- [ ] Load order: the first rows written have the highest `vote_count` in the CSV (compare the top of `movies` by `vote_count` to the CSV) → AC-8
- [ ] Load stop condition: set `CATALOG_SIZE_CAP_MB` just above the current size and confirm the loader stops when `pg_database_size` crosses it → AC-8

## Acceptance-criteria coverage
- AC-8 … bulk load, resume, cap, TV rows, adult filter, load order · AC-9 … backfill checks · AC-13 … migration twice, extensions, RLS, unit tests · AC-3 … golden file exists (checked later against the Postgres engine) · AC-15 … pool unit tests, 8 concurrent callers, rollback on error

## Browse, detail, model loading, live resolve and refresh (engine and live resolve milestones)
Run from `backend/`, with `.venv\Scripts\python.exe`. Start the server with `EMBEDDING_PRELOAD=false python -m uvicorn main:app --port 8765` for the server steps.
- [ ] `python -m unittest discover -p "test_*.py"` → all pass (about 9 minutes against Supabase) → AC-2, AC-4, AC-5, AC-6, AC-7, AC-10, AC-11, AC-12, AC-14, AC-15, AC-16
- [ ] `python -m golden.check_golden` → prints `14 of 14 cases match the golden file` → AC-3
- [ ] `GET /docs` and `GET /` right after startup, model not loaded → both `200`, `/` returns `movies_loaded` as a number → AC-1, AC-16
- [ ] With the server running, `GET /` while the database is unreachable (wrong `DATABASE_URL`) → `200` with `status` `error`, server stays up → AC-16
- [ ] Measure server memory (resident set size) right after startup, then again after `python -m db.load_catalog load --max-rows 10000` has grown the catalog → within 30 MB of each other → AC-1
- [ ] `GET /movies/search?q=interstelar` → finds Interstellar; `?q=dune` finds Dune; `?q=dnue` finds Dune; `?q=healer` does not return Shelter; `?q=a%25b` treats `%` as plain text → AC-12
- [ ] `GET /movies/trending` with a bearer token → every title has at least 50 votes, ordered by `vote_average` then `popularity`; without a token → `401` → AC-4, AC-2
- [ ] `GET /movies?language=ko&media_type=tv&limit=5` → only Korean TV rows, most popular first → AC-4
- [ ] `GET /movies/movie/{id}` for a loaded title → cast, tagline, runtime and providers for the user's country; the second call reads the provider cache (no TMDB call) → AC-5
- [ ] `GET /movies/movie/{id}` for a title with no `movie_details` row → the row is written on first view → AC-5
- [ ] `GET /movies/movie/{id}` with TMDB blocked and a provider row older than 24 hours → `200` in under 5 seconds with the stale providers, or empty ones if none → AC-5
- [ ] `POST /recommend` with `mood_text` while the model is still loading → `503` with `Retry-After: 15`; `GET /movies/trending` at the same moment → `200` → AC-7
- [ ] Start with `EMBEDDING_PRELOAD=true`, wait for the log line `Embedding model loaded.`, then `POST /recommend` with `mood_text` → `200` → AC-7
- [ ] `POST /movies/resolve` with a title not in the catalog (while the model is loading) → `200`, a `movies` row with a null embedding and a `movie_details` row; a second call returns the same row → AC-6
- [ ] After the model is ready, `POST /movies/resolve` for that same title → the row's embedding is filled in and `embedding_model` is the contract id → AC-6
- [ ] Two simultaneous `POST /movies/resolve` calls for one new title → both `200`, exactly one row → AC-6
- [ ] 31 `POST /predict` calls (or `/movies/resolve`) within a minute from one address → the 31st returns `429` → AC-11
- [ ] Set `CATALOG_SIZE_CAP_MB` to the current size minus 100, then `POST /movies/resolve` with a new title → `503` with the catalog full message; set it back and it works → AC-11
- [ ] `POST /admin/reload` → `404` → AC-14
- [ ] `python -m db.refresh_catalog` (needs `TMDB_TOKEN`, `DATABASE_URL`) → prints one `refresh done: added=… refreshed=… embedded=… skipped=… size=… newest_refreshed_at=…` line and exits `0` → AC-10
- [ ] `CATALOG_SIZE_CAP_MB=1 python -m db.refresh_catalog` → prints a warning, adds nothing, still refreshes stats, exits `0` → AC-10, AC-11
- [ ] Run the `Catalog refresh` workflow from the Actions tab (Run workflow) with the two secrets set → green, and its log shows the summary line → AC-10
- [ ] Value sourcing, search threshold: `SEARCH_TRIGRAM_MIN` is `0.5` in `db/engine.py` and the search steps above pass → AC-12
- [ ] Value sourcing, trending minimum votes: `TRENDING_MIN_VOTES` is `50` in `db/engine.py` → AC-4
- [ ] Value sourcing, provider freshness and country: `PROVIDER_CACHE_TTL` is 24 hours and `DEFAULT_COUNTRY` is `NG` in `db/details.py` → AC-5
- [ ] Value sourcing, refresh constants: 30 days, 10 votes, 5 pages, slice of one thirtieth, 20 percent failure limit in `db/refresh_catalog.py` → AC-10
- [ ] Value sourcing, rate limit and ceiling: `WRITE_RATE_LIMIT` is `30/minute` in `main.py`; hard ceiling is cap plus 100 in `db/catalog.py` → AC-11

## Acceptance-criteria coverage (added)
- AC-1 … startup and memory steps · AC-2 … endpoint tests, `401` check · AC-4 … trending, browse · AC-5 … detail steps · AC-6 … resolve steps · AC-7 … model loading steps · AC-10 … refresh steps · AC-11 … cap, ceiling, rate limit · AC-12 … search steps · AC-14 … `/admin/reload` · AC-16 … root route steps
