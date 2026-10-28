# 0013. Recommendation and read endpoints on Postgres

## Summary

This child moves every read endpoint off the in memory pandas table and NumPy matrix and onto SQL queries against Postgres. The math that defines a user's taste stays in Python, exactly as today, and Postgres does the ranking. Responses keep their current shape, so the mobile app is unaffected.

## Requirements

Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-12**, **AC-14**, **AC-15**, **AC-16** of the umbrella ([index.md](index.md)). Depends on the schema and data from [0013-catalog-schema-and-load.md](0013-catalog-schema-and-load.md).

## Design

**Connections** (AC-15): a pooled helper (psycopg2 `ThreadedConnectionPool`, maximum 5) guarded by a semaphore so a caller waits up to 5 seconds for a free connection instead of getting an immediate error. Before handing a connection out it runs a cheap liveness check and replaces a dead one. Every use commits or rolls back before the connection returns to the pool. It reads `DATABASE_URL`, which must be the session pooler URL.

**Taste vector and ceiling** (Python, unchanged formulas):
- One query fetches `embedding::real[]` for the user's rated `(movie_id, media_type)` pairs, joined with their ratings. Reading the vector as a real array avoids parsing the text form.
- `build_user_profile_from_ratings`, `build_user_taste_or_none`, `compute_personal_ceiling`, `calibrated_score`, `combine_vectors` keep their current logic but take rows of `(rating, embedding)` instead of a DataFrame and matrix. A rated title with a null embedding is skipped, as a missing index is skipped today. A taste vector with zero norm counts as no taste, so `<=>` never receives it.

**Ranking query** (the core, used by recommend, similar, and the legacy similar):

```sql
SELECT m.id, m.media_type, m.title, m.release_date, m.poster_path,
       1 - (m.embedding <=> %(q)s::vector) AS similarity,
       CASE WHEN %(taste)s::vector IS NULL THEN NULL
            ELSE 1 - (m.embedding <=> %(taste)s::vector) END AS taste_similarity
FROM movies m
WHERE m.embedding IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ratings r
                  WHERE r.user_id = %(user_id)s AND r.movie_id = m.id AND r.media_type = m.media_type)
  AND (%(language)s IS NULL OR m.original_language = %(language)s)
  AND (%(actor)s IS NULL OR m.cast_members ILIKE '%%' || %(actor_escaped)s || '%%')
  AND (%(start_year)s IS NULL OR EXTRACT(YEAR FROM m.release_date) >= %(start_year)s)
  AND (%(end_year)s IS NULL OR EXTRACT(YEAR FROM m.release_date) <= %(end_year)s)
ORDER BY similarity DESC, m.id, m.media_type
LIMIT %(top_n)s;
```

The similar routes replace the `NOT EXISTS` line with `AND NOT (m.id = %(src_id)s AND m.media_type = %(src_type)s)`. An empty exclusion is therefore never a typed array problem. `taste_similarity` is the raw similarity to the user's pure taste vector (never the mood blended vector), computed in SQL, so no embedding is read back as text. Python calibrates it with the ceiling exactly as `build_movie_cards` does now, and a mood only request still gets a null score. For the id based similar route `ceiling` is 1.0 as today.

**404 versus empty list** (`/recommend`): if the ranking result is empty and any of language, actor, or year is set, run `SELECT EXISTS (...)` over the filters alone (no exclusion, no embedding condition). If nothing matches, return the same `404` message as today; if rows match, return `[]`.

**Endpoints**:
- `POST /recommend`: ratings from Postgres, mood vector from the embedding model (needs the model, so `503` with `Retry-After: 15` while it loads), ranking query with filters, same cold start rule (empty list with no taste and no mood), same ad hoc `liked_titles` path (resolve each title, see the third child; `503` if a needed vector is not ready).
- `GET /movies/trending`: `WHERE vote_count >= 50 ORDER BY vote_average DESC NULLS LAST, popularity DESC NULLS LAST, id, media_type LIMIT %(top_n)s`, each card carrying `taste_similarity` calibrated with the user's ceiling.
- `GET /movies`: filters (`original_language`, `cast_members ILIKE` on the escaped actor, year range, `media_type` unless `both`), `ORDER BY popularity DESC NULLS LAST, id, media_type LIMIT`. Returns the same columns.
- `GET /movies/search`: first titles where `lower(title) LIKE '%' || escaped(lower(q)) || '%'` (query of at least 2 characters), ranked by how close the match is (exact, then prefix, then substring) and then `popularity DESC NULLS LAST`; if fewer than `limit`, top up with trigram matches (the `%` operator with a tuned `pg_trgm.similarity_threshold`, and for queries of at least 4 characters also a one letter edit rule) ordered by `similarity`. One row per `(id, media_type)`. Required cases are in AC-12 (`interstelar`, `dune` and its typo, `healer` not `shelter`).
- `GET /movies/{media_type}/{id}/similar` and the legacy `GET /movies/{title}/similar`: ranking query with the source excluded. The legacy route returns the raw similarity rounded to 2 places. A source row with a null embedding is embedded on demand from its stored `combined_text` and saved, or `503` if the model is not ready.
- `GET /movies/{media_type}/{id}`: one query joining `movies` and `movie_details`, plus the provider cache read described below. A missing details row is fetched from TMDB once and written. A title not found locally falls to live resolve (third child). The user's `predicted_score` needs the title's vector (on demand embedding, `503` if not ready).
- `POST /predict`: user vector from resolved liked titles, candidate vector from the candidate title, cosine in Python as today.
- `GET /`: keeps its keys; `movies_loaded` from `pg_class.reltuples`; a database error is reported without crashing.
- Remove `POST /admin/reload`, `load_all_data`, the `state` dictionary, `title_to_index`, and `ambiguous_title_index`. Typed title resolution keeps the old rules: strip a leading article ("the titanic" to "titanic"), exact lowercase match on either media type, ties broken by `popularity DESC NULLS LAST, vote_count DESC`, then trigram similarity of at least 0.8.

**Watch providers** (detail endpoint): country is `users.country`, `NG` when null; read `watch_provider_cache` for `(id, media_type, country)`. On a miss or `fetched_at` older than 24 hours, make one dedicated TMDB call to `/{type}/{id}/watch/providers` (3 second timeout, no retries), apply the existing resolution (the country, then NG, then US), map `provider_name` to `name` as `resolve_watch_providers` does, and upsert the resolved `{flatrate, rent, buy}` under the requested country key. A hit is therefore one row read. If TMDB fails, serve the stale row if one exists, else empty providers. The response shape (`stream`, `rent`, `buy` with `name`, `logo_path`) is unchanged.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Recommend | Excluded titles | `NOT EXISTS` over `ratings` for the bearer user |
| Recommend | Score shown | `taste_similarity` column, calibrated in Python by the ceiling |
| Recommend | Mood vector | embedding model on `mood_text` |
| Trending | Minimum votes | constant 50 |
| Detail | Country | `users.country`, `NG` when null |
| Detail | Provider freshness | `watch_provider_cache.fetched_at` against a 24 hour constant |
| Search | Trigram threshold | tuned constant, validated by the AC-12 cases |
| Pool | Wait time and size | constants: 5 seconds, 5 connections |

**Key invariants**: every query matches rows on `(id, media_type)`; no similarity path returns a row with a null embedding; no read endpoint writes to `movies` except to fill a missing `movie_details` row, an on demand embedding, or the provider cache; the score meaning of specs 0005 and 0010 is unchanged; all SQL parameters are bound and `LIKE` input is escaped.

**Security**: same auth dependencies as today per endpoint. The three public writing routes are covered in the third child. `/admin/reload` removed.

**Critical test scenarios** (against a Postgres with pgvector and a small fixture catalog):
- Fixed test users get the golden top 10, **AC-3**.
- No ratings plus mood text works; filters matching nothing give `404`; filters matching only excluded titles give `[]`, **AC-3**.
- Trending returns only votes at least 50, ordered with nulls last, **AC-4**.
- Search required cases, **AC-12**.
- Detail: lazy details fill, providers with fallback, TMDB failure serves stale or empty fast, **AC-5**.
- Server starts with `/docs` responding and no model loaded, **AC-1**.
- 8 concurrent requests with a pool of 5 all succeed, **AC-15**.
- Root route keeps its keys and survives a database error, **AC-16**.
- `/admin/reload` is gone, **AC-14**.

## Build plan

1. Add the pooled connection helper, **AC-15**. (built: `backend/db/pool.py`)
2. Move the taste vector, ceiling, and score code to row based inputs, with tests against the golden file inputs, **AC-3**. (built: `taste_vector_from_rows`, `personal_ceiling_from_rows`, `cards_from_ranked` in `backend/recommend.py`; the old DataFrame versions stay until step 6 removes them)
3. Implement the ranking query and `/recommend`, `/predict`, both similar routes, **AC-3**, **AC-4**. (built; typed title resolution tries the catalog first, then TMDB, with a minimal store step that the live resolve build hardens)
4. Implement trending, browse, trigram search, and the root route, **AC-4**, **AC-12**, **AC-16**. (built: `backend/db/engine.py`, `backend/main.py`)
5. Implement the detail read, lazy details fill, and the provider cache, **AC-5**. (built: `backend/db/details.py`, `backend/recommend.py`)
6. Delete the in memory path and `/admin/reload`, **AC-1**, **AC-14**. (built)
7. Rewrite `test_recommend.py` and the movies endpoint tests for the database backed code, **AC-2**. (built: `test_recommend.py`, `test_engine.py`, `test_live.py`, `test_main_movies_endpoints.py`)

## Rationale (short)

The taste math stays in Python so the score contract does not change and the old tests carry over. Ranking in SQL removes the matrix from memory. The exact scan avoids approximate index recall problems with filters. Computing the displayed similarity inside the SQL row avoids ever parsing a vector back into Python.
