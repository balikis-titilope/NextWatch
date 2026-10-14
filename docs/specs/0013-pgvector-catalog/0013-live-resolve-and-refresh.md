# 0013. Live resolve, model loading, size ceiling, and the daily refresh

## Summary

This child covers everything that writes catalog data after the first load: a user searching for a title that is not in the catalog, the background loading of the embedding model, the size ceiling that protects the free database, and the daily GitHub job that adds new titles and refreshes vote counts. Nothing here needs a local rebuild or a redeploy.

## Requirements

Satisfies **AC-6**, **AC-7**, **AC-10**, **AC-11** of the umbrella ([index.md](index.md)). Depends on [0013-catalog-schema-and-load.md](0013-catalog-schema-and-load.md).

## Design

**Live resolve** (`POST /movies/resolve`, id lookups, `liked_titles`, `/predict`, and detail or similar misses):
1. Look the title up in Postgres first: strip a leading article, exact lowercase title match on either media type (ties by `popularity DESC NULLS LAST, vote_count DESC`), then trigram similarity of at least 0.8 for a typed title. An id lookup is a primary key read.
2. On a miss, fetch from TMDB with the existing functions (`search_tmdb_title`, `fetch_movie_details`, `fetch_movie_details_by_id`). After a search returns `(id, media_type)`, check that primary key locally before fetching or embedding anything, and return the local row if it exists.
3. If the database size is at or over the hard ceiling (cap plus 100 MB), refuse the new title with `503` and the message that the catalog is full.
4. Build the row with the existing `build_movie_row` and the shared `combined_text` function. If the model is ready, embed it. If not, keep the embedding null (the title is still rateable) and start the background model load if it is not already running.
5. Call the shared writer: in one transaction insert the `movies` row and the `movie_details` row with `ON CONFLICT (id, media_type) DO UPDATE SET embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model WHERE movies.embedding IS NULL` (so an existing row without an embedding gets one, and an existing row with one is untouched). If another request won the insert, read and return the existing row. Both requests return the same title and neither errors.
6. Return the same response as today. Nothing is held in memory.
7. Resolve never returns `503` for the model. `/predict`, the `liked_titles` path, and similar or detail score for a null embedding row do need the vector now, so they embed on demand when the model is ready and return `503` with `Retry-After: 15` when it is not.
8. TMDB unreachable returns `502`, not found on TMDB returns `404`, both as today.
9. `POST /movies/resolve`, `POST /predict`, and `GET /movies/{title}/similar` are public and can write, so each is rate limited per client address with the existing slowapi limiter (30 per minute, a constant) and returns `429` beyond it.

**Model loading**:
- `get_embedder()` holds one process wide model, guarded by a lock, with a `ready` flag and a `loading` flag. The fastembed cache folder comes from `FASTEMBED_CACHE_PATH`; the model id is fixed by the cross child contract.
- With `EMBEDDING_PRELOAD` true (default), the FastAPI lifespan starts a background thread that loads the model and sets `ready`. Startup and the readiness check never wait for it. With it false, the first need starts the same background load.
- A request that needs a vector right now while the model is not ready starts a load if none is running and gets `503` with `Retry-After: 15`. It never waits inline, in either mode.
- A failed load logs the error and clears `loading`, so the next need starts a new background load. It never crashes the server.
- Endpoints that never embed (`/recommend` with no mood text, trending, browse, search, detail for a row that has an embedding, similar for a source that has one) never touch the model.
- The startup check for mixed model ids runs in its own background thread and never fails startup, even if the database is unreachable.

**Refresh script** `backend/db/refresh_catalog.py`, run by a daily workflow:
1. If the database size is at or above `CATALOG_SIZE_CAP_MB`, skip adding (print a warning), still run the stat refresh and the null embedding sweep.
2. **Add**: for movies and TV, TMDB discover with `include_adult=false`, `vote_count.gte=10`, sorted by popularity, 5 pages per type, using `primary_release_date.gte` (movies) and `first_air_date.gte` (TV) for the last 30 days, plus a popularity only pass of the same page count. For each id not already present with an embedding, fetch details, build the row with the shared helper, embed, and write through the shared writer.
3. **Stat refresh**: select the oldest `refreshed_at` rows (about one thirtieth of the table per run), fetch their current `vote_average`, `vote_count`, `popularity`, `poster_path`, `backdrop_path`, and update them with a new `refreshed_at`. The embedding and text are not recomputed. A TMDB `404` for a row advances its `refreshed_at` and is not counted as a failure, so a deleted title is not retried every day.
4. **Null embedding sweep**: embed any rows with `embedding IS NULL` from their stored `combined_text`.
5. Batches commit independently. A failing item is logged and skipped. The script prints a one line summary (added, refreshed, embedded, skipped, size in MB, percent of cap, newest `refreshed_at`). It exits with a non zero code if a database error occurs or more than 20 percent of TMDB calls fail for reasons other than `404`.
6. It never deletes.

**Workflow** `.github/workflows/catalog-refresh.yml`: runs daily on a cron (a time different from the keep alive job) and on manual dispatch, uses Python with the backend requirements, caches the fastembed model folder between runs, and reads `TMDB_TOKEN` and `DATABASE_URL` from repository secrets (`DATABASE_URL` is the IPv4 session pooler URL, already used by the keep alive workflow). Note: GitHub disables scheduled workflows after 60 days with no repository activity, and failure emails go to the person who last edited the workflow.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Live resolve | Row and vector | TMDB payload through `build_movie_row`, embedder on `combined_text`; null vector if the model is not ready |
| Live resolve | Catalog full | `pg_database_size` against cap plus 100 MB |
| Live resolve | Rate limit | 30 per minute per client address, constant |
| Model | Readiness | `ready` flag from `get_embedder()` |
| Refresh | New window, minimum votes | 30 days, 10 votes, constants in the script |
| Refresh | Pages | 5 per type, constant in the script |
| Refresh | Slice | oldest `refreshed_at`, size `ceil(total / 30)` |
| Refresh | Failure threshold | 20 percent of non `404` TMDB failures, constant |
| Refresh | Size and cap | `pg_database_size`, `CATALOG_SIZE_CAP_MB` |

**Key invariants**: a resolve writes the row and its details in one transaction or not at all; the model id written equals the cross child contract id; the refresh never deletes and never adds past the cap; live resolve never adds past the hard ceiling; no code path loads the whole catalog into memory.

**Security**: the refresh uses only GitHub secrets and prints neither. The public writing routes are rate limited and stop at the hard ceiling.

**Configuration required**: `EMBEDDING_PRELOAD`, `CATALOG_SIZE_CAP_MB`, `FASTEMBED_CACHE_PATH`, and the secrets `TMDB_TOKEN`, `DATABASE_URL` (see the umbrella).

**Critical test scenarios**:
- Resolve a title not in the catalog: row, details, and embedding written, then it appears in similar results, **AC-6**.
- Resolve while the model is not ready: row written with a null embedding, response returned, no `503`, **AC-6**.
- Resolve for an id returned by a TMDB search that already exists locally: no second fetch, **AC-6**.
- Two concurrent resolves of the same new title: one row, no error, and an existing null embedding gets filled, **AC-6**.
- Mood text and `/predict` while the model is loading return `503` with `Retry-After`, trending still `200`, **AC-7**.
- A failed model load does not crash the server and the next need starts a new load, **AC-7**.
- Refresh adds a recent title with enough votes, refreshes stats for the oldest rows, embeds null rows, and treats a TMDB `404` as success, **AC-10**.
- Refresh with a database error exits non zero; with one transient TMDB failure among many it still exits zero, **AC-10**.
- Refresh at the cap skips adding and prints a warning, resolve still inserts below the ceiling and returns `503` at it, **AC-11**.
- The 31st resolve in a minute from one address returns `429`, **AC-11**.

## Build plan

1. Add `get_embedder()`, background loading in the lifespan, on demand embedding, and the `503` behavior, **AC-7**. (built: `backend/db/embedder.py` with `get_model()`, `peek_model()`, `start_background_load()`)
2. Rewrite live resolve through the shared writer with null embedding allowed, conflict handling, the hard ceiling, and rate limits, **AC-6**, **AC-11**. (built)
3. Write the refresh script (add, stat refresh, null sweep, cap check, exit codes), **AC-10**, **AC-11**. (built: `backend/db/refresh_catalog.py`)
4. Add the daily workflow and document the two secrets and the 60 day rule, **AC-10**. (built: `.github/workflows/catalog-refresh.yml`, not yet run on GitHub)
5. Tests for each scenario above, using a fake embedder and a stubbed TMDB client, **AC-6**, **AC-7**, **AC-10**, **AC-11**. (built: `test_embedder.py`, `test_live.py`, `test_refresh.py`)

## Rationale (short)

Writing live results straight to Postgres removes the volatile in memory copy, and letting a row exist before its embedding means rating a new title never waits for the model. A background load gives the best user experience without blocking readiness, and the switch to lazy loading is one setting if memory turns out to be tight. A scheduled script on GitHub has the memory and the independence the app lacks. The hard ceiling and rate limits stop the open public routes from ever filling the free database.
