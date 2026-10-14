# 0013. Rationale: move the catalog and embeddings into Postgres (pgvector)

## Context

The backend (feature A, built before this workflow) keeps its whole catalog in a pandas table and every title's embedding in one NumPy matrix, both loaded from `data/movies_test.csv` at startup (`load_all_data` in `main.py`, `load_and_prepare_data` and `generate_embeddings` in `recommend.py`). Recommendations, trending, browse, search, and detail all read that in memory copy. Postgres holds only a partial copy (19 columns, no embeddings) so ratings can point at movies through a foreign key.

Three forces make that design a problem now:

- **Memory.** The first cloud deploy failed with an out of memory error at startup, mostly from PyTorch, and was fixed by moving the model to `fastembed`. The deeper issue remains: the in memory copy grows with the catalog. The full dataset is 77,875 rows, and embedding them at startup would take tens of minutes on every cold start.
- **Freshness.** The full dataset (`movies.csv`, 894 MB) is built locally by `fetch_movies.py`. Any refresh means a local fetch, a local re-embed, and a redeploy. The developer wants the catalog to refresh itself.
- **Free tier limits.** The database is Supabase free tier, 500 MB, and it goes read only past that. The developer will not pay for Pro now. The CSV is 894 MB, but 737 MB of that is one column (all country watch providers) that the database never stored. The text the app really needs is small, and 384 float32 numbers per row cost about 1.5 KB.

Measured facts: the database is 13 MB with 551 movies loaded. `vector` 0.8.2 and `pg_trgm` 1.6 are available but not installed. RLS is on for all four existing tables. The detail endpoint reads `tagline`, `runtime`, `backdrop_path`, `trailer_keys`, `cast_photos_json`, and `watch_providers_json` from the in memory row, and none of those exist in the `movies` table today. The bulk size estimates (about 40 to 200 MB of text for all rows, 114 MB of float32 vectors for 78k rows) are unmeasured, which is why the load is gated by a measured size cap.

## Options considered

### Option 1: Keep everything in memory, but ship precomputed files

Compute embeddings once on the developer's machine, trim the CSV to the needed columns, and deploy a `.npy` file plus a smaller CSV that the server loads at startup.

**Pros**:
- Smallest code change. The recommendation engine stays as it is.
- With a catalog cut to about 25k titles the embedding matrix is only about 38 MB.

**Cons**:
- A refresh still means a local fetch, a re-embed, and a redeploy, which the developer does not want.
- Titles added live live only in memory and vanish on restart.
- Memory still grows with the catalog, and the container already ran out of memory once.

### Option 2: Move the catalog and embeddings into Postgres with pgvector (chosen)

Store the embedding as a `vector(384)` column, rank by cosine distance in SQL with an exact scan, split detail data into a side table, cache providers per title and country, load by vote count within a size cap, and refresh with a daily GitHub job.

**Pros**:
- Server memory no longer depends on catalog size, and startup is nearly instant.
- Postgres is the single copy, so live additions and refreshed rows persist across restarts and redeploys.
- Self refresh is possible with no redeploy.
- Uses Postgres, Supabase, and an extension from the existing stack, with no new service.

**Cons**:
- The recommendation engine moves from pandas to SQL, a real rewrite with ranking risk.
- Each read now costs a database round trip, and each recommend scans all vectors on shared CPU.
- Storage is the new bottleneck, so the catalog must be capped.

### Option 3: A dedicated vector database service

Keep Postgres for relational data and put embeddings in a hosted vector store.

**Pros**:
- Built for similarity search and scales far beyond this project.

**Cons**:
- A new paid or free tier service, new credentials, and a second system to keep in sync with `movies` and `ratings`.
- Filters (language, actor, year) and the ratings join would span two stores.
- Solves a scale problem the project does not have.

### Option 4: Keep the in memory design and buy more memory

Choose a larger cloud instance and load the full catalog at startup.

**Pros**:
- No code change.

**Cons**:
- Pays for memory that PyTorch style loading wasted, and startup still takes tens of minutes to embed 78k rows unless embeddings are also precomputed.
- Still no self refresh and no persistence for live additions.
- The developer does not want to pay yet.

## Rationale

Option 2 is the only option that satisfies all three forces at once: bounded memory, no redeploy to refresh, and a free database. Option 1 is cheaper to build, and with a 25k row catalog it would fit in memory, but it fails the freshness requirement, which the developer stated twice, and leaves live additions in a volatile copy. Options 3 and 4 add cost or a second system without removing the actual problem.

An exact scan, not an approximate index, fits the real size. At 25k to 78k rows pgvector compares every vector in tens of milliseconds, returns the exact top results, and works with the language, actor, and year filters, which approximate indexes handle badly. The embedding is float32 (not half precision) because the developer did not want any accuracy loss and the row count makes the saving small.

Loading by vote count with a measured size cap, not a fixed row cutoff, follows from the developer's concern about coverage. A bigger catalog does not improve any single embedding, since each is built from that title's own text. It only widens the pool of candidates, and the long tail of titles with few votes is thin on text and unfamiliar to users. The cap fills the free tier with the best titles first and leaves room for users and growth. Titles outside the cap are still reachable, because search and live resolve fetch them from TMDB on demand.

The refresh runs in GitHub Actions, not inside the app, because the app may be asleep, may run on more than one instance, and has the least memory. A scheduled script has plenty of RAM and the repository already has a working cron. The model loads in the background at startup (the developer's preference for user experience) with a single switch to fall back to lazy loading, because the model is now only needed for mood text and new titles, and the earlier memory failure came from PyTorch, which is gone.

The choice of a clean cut over a dual path follows the mandate to avoid speculative configuration: the old path is the one that ran out of memory, the backend is not yet in production, and the migration is additive, so a revert and redeploy is a complete rollback.

## Decisions settled by the engineer in the design conversation

- Treat the backend change as a scoped exception to the AGENTS.md rule, not a whole backend adoption.
- Keep every API response identical, so the mobile app ships nothing.
- Use `pg_trgm` for typeahead search.
- Load by votes, plus recent titles by TMDB popularity, ranking movies and TV together.
- Embedding on a column of `movies`, float32, no vector index at first, exact scan.
- Providers cached per title and country in Postgres, about 24 hours.
- Detail fields in a side `movie_details` table; popularity as a real column.
- Bulk load stops automatically at a size cap with checkpoints; refresh stops adding at the cap and never deletes.
- Refresh runs in GitHub Actions; it adds new and popular titles and rotates a stat refresh.
- Model loads in the background at startup, with an on/off setting.
- Clean cut with an additive migration.

## Decisions made in this spec (recommended, with the runner up)

- **Pooled database connections** (small pool, maximum 5): every read endpoint now queries the database, and the current pattern opens a new connection per call, which adds latency through the Supabase pooler. Runner up: keep per call connections. Pool size 5 stays well under the free tier pooler's connection limit.
- **No new Python dependency for vectors**: pass vectors as text literals cast with `::vector`, instead of adding the `pgvector` Python package. Runner up: the package, which adds a small helper but a new dependency.
- **Taste vector and personal ceiling stay in Python**: fetch the user's rated embeddings with one query and use the existing formulas, then give the query vector to SQL for ranking. This keeps the score contract from spec 0005 identical. Runner up: compute the weighted average in SQL, which is more complex and harder to test against the old behavior.
- **Typed title resolution**: exact lowercase match first, then trigram similarity of at least 0.8 for a typed title, and 0.5 as the starting point for typeahead, both tuned against the existing tests. Runner up: keep difflib in Python over a fetched candidate list, which would load rows back into memory.
- **Provider cache time to live**: 24 hours as a constant, no setting. Runner up: a setting, which is configuration with no current need.
- **`embedding_model` column**: cheap protection against mixing vectors if the model ever changes.
- **Failure handling**: TMDB down on detail serves a stale cache row or empty providers and never fails the screen; a failed model load retries on the next need and returns `503` meanwhile; a refresh item that fails is logged and skipped, and the run exits non zero if any batch fails.
- **Observability**: the load and refresh scripts print a one line summary (rows added, rows skipped, size in MB, percent of cap), and the recommend SQL gets a measured `EXPLAIN ANALYZE` at the load checkpoints.
- **Performance target**: recommend under about one second at the loaded size, with an index added only if a query passes 300 ms.

## Changes made after the independent cross check

A read only review on a different model found gaps, and the engineer chose to apply the recommended fixes. The main ones, with the reason for each:

- **Rating a new title never waits for the model.** A row may exist with a null embedding, because that already satisfies the ratings foreign key. Runner up: return `503` from resolve while the model loads, which the mobile app does not handle. Embedding happens inline when the model is ready, otherwise on demand or in the daily sweep.
- **Hard ceiling and rate limits on the public writing routes.** `/movies/resolve`, `/predict`, and legacy `/similar` need no login and could be scripted to fill the 500 MB database, which would make it read only and break login and ratings. The ceiling is the cap plus 100 MB, and the limit is 30 per minute per address. Runner up: leave it as a follow up, rejected because the failure is severe.
- **Exclusion with `NOT EXISTS`, not an array of pairs.** An empty array of `(id, media_type)` pairs fails in Postgres, which would break every request from a user with no ratings.
- **A pool that waits.** The stock pool fails immediately at its limit, and FastAPI can run many sync requests at once.
- **Vector stored inline.** Rows above about 2 KB can have large values moved out of the row, which would add a side fetch per row to an exact scan.
- **Trigram search with explicit cases.** A plain similarity threshold misses short title typos and fails the existing typo case, so the required cases are named in AC-12 and the threshold is tuned against them.
- **The detail screen fills a missing details row on first view, and the backfill fills details for the 551 rows.** Otherwise those titles would lose tagline, cast, and trailer, which breaks the unchanged contract.
- **Short provider call.** A TMDB outage with the existing retry settings could hang the detail screen for about a minute, so providers use one call with a 3 second timeout.
- **A TMDB 404 is not a refresh failure,** so a deleted title is not retried and reported every day.
- **A golden file of current results, saved first.** The old engine is removed in the cleanup, so acceptance of the ranking needs a reference captured before it goes.
