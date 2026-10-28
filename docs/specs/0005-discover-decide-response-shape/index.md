# 0005. Backend Response Shape for Discover & Decide

**Date**: 2026-08-09
**Status**: In Progress

_Decision history (context, options considered, rationale) is in [`rationale.md`](rationale.md). This file holds the build spec: the decision, the design, and the build plan._

_Revised after an independent cross check (a different model, read only critique): closed gaps around the score calibration (a plain cosine times 100 is not a percentage, and can go negative), a foreign key violation when rating a freshly resolved movie, a missing `popularity` field on live resolved movies, a crash on all neutral ratings, an inaccurate migration re-run step, `country` being dropped on the email confirmation signup path, and the fuzzy title match risk on "Because you liked" rows (now resolved by a new id based similar endpoint). See the inline notes below for what changed and why._

## Summary

Home and Movie Detail need real data from the backend, and today the backend does not carry enough. `/recommend` and `/movies/{title}/similar` currently return only a title, a release date, and a raw similarity number, missing even the movie's own id. This spec extends `/recommend`, adds three new endpoints (`GET /movies/trending`, `GET /movies/{id}`, `GET /movies/{id}/similar`), and settles how images, match scores, and where to watch data are built and shown. It also adds one new account field, a stored country, so where to watch can reflect where the viewer actually is.

## Context

See [`rationale.md`](rationale.md) for the full problem context.

## Requirements

**User stories**:
- As a user opening the app, I want Home to show a hero pick, a For You row, a Trending Now row, and rows for movies like ones I recently liked, each with a real poster and a match score, so I can tap into something I'll probably enjoy.
- As a user tapping a movie card, I want Movie Detail to load fully (poster, backdrop, overview, cast with photos, runtime, genres, where to watch, a trailer button when one exists, and similar movies), so I can decide and act without leaving the screen.
- As a user who already rated a movie, I want Movie Detail's star row to show my existing rating when I come back to it, so I'm not misled into thinking I haven't rated it.
- As a brand new user with no ratings yet, I want Home to tell me to rate a few movies instead of showing me a for you row that's secretly just Trending Now again.
- As a user, I want Where to Watch to reflect real streaming services in a real country, not a hardcoded one that might not be mine.
- As a user, I want a match score to mean "how close is this to the movies I already love," not a number compared against strangers or against whatever else happens to be on screen.

**Acceptance criteria** (the contract, each independently checkable):
- **AC-1**: Every response listing movies (`/recommend`'s personalized results, `GET /movies/trending`, `GET /movies/{id}/similar`) includes each movie's `id` and `poster_path`, so cards are tappable and images render.
- **AC-2**: A match score, wherever it reflects the requesting user's own taste (`/recommend`, `GET /movies/trending`, `GET /movies/{id}`'s own score), is a whole number percentage from 0 to 100, calculated as this movie's cosine similarity to the user's taste vector, divided by the average cosine similarity of the user's own 4 or 5 star rated movies to that same taste vector (their personal "ceiling"), clamped to 0 to 1 before converting to a percentage. A user with no 4 or 5 star ratings has no ceiling to calibrate against, so no score is shown (null, see AC-3).
- **AC-3**: `/recommend` returns an empty list when the requesting user has no ratings, no ratings that produce a usable taste signal (for example every rating is exactly 3 stars, neither liked nor disliked, which has no ceiling to calibrate against either), and no mood text was supplied, instead of silently falling back to popularity or raising an error, so Home can show a "rate a few movies" prompt rather than a row that duplicates Trending Now.
- **AC-4**: `GET /movies/trending` returns top rated titles with at least 50 votes, ordered by closeness to the requesting user's taste (rating order when they have no usable taste signal) and leaving out titles they already rated; each item carries its own `id`, `poster_path`, and `release_date`, with its match score computed against the requesting user's own taste per AC-2 (null when the user has no usable taste signal, the same condition as AC-3).
- **AC-5**: `GET /movies/{id}` returns the full detail set Movie Detail needs: title, tagline, overview, genres, release date, runtime, language, poster, backdrop, match score, cast (with photos), director, a trailer key (or null), where to watch, and the requesting user's own existing rating for that movie (or null). It resolves a movie not yet cached locally by fetching it directly from TMDB by id (no title search needed).
- **AC-6**: `GET /movies/{id}`'s `user_rating` field reflects the requesting user's real, current rating for that movie, so the star row can pre-fill it.
- **AC-7**: Where to Watch providers in `GET /movies/{id}` are resolved to the requesting user's stored country, falling back to NG then US when no country is stored, and include each provider's logo path, not just its name.
- **AC-8**: `GET /movies/{id}` returns `trailer_key: null` (not an error) when a movie has no TMDB trailer, so the mobile app can hide the Watch Trailer button cleanly.
- **AC-9**: A movie resolved live from TMDB (not yet in the bulk dataset) ends up with the same fields as a bulk loaded movie, cast photos, runtime, tagline, backdrop, trailer key, `popularity`, and where to watch data included, and is persisted to Postgres the same way `/movies/resolve` already does, so it can be rated afterward without a foreign key error.
- **AC-10**: If the single TMDB call `GET /movies/{id}` depends on for live enrichment fails outright (network error, timeout, or a non-200 response), the endpoint returns a clear error and caches nothing. If that call succeeds but one of its own sub fields is simply absent for this movie (for example no trailer exists), the response returns `null` for that field; this is normal, not a failure.
- **AC-11**: A new account's country is captured automatically from the device's locale at signup, with no user prompt, and stored on the account, on both the immediate session signup path and the confirm-email-then-session path (it is not dropped when email confirmation is required). An account with no stored country (capture failed, or the account predates this field) falls back to NG then US for Where to Watch, the same as before.
- **AC-12**: Every TMDB image path (`poster_path`, `backdrop_path`, cast `profile_path`, provider `logo_path`) is returned as a raw TMDB relative path, never a full URL; the mobile app builds the full URL client side, extending the existing `posterUrl()` convention with one size per image type.
- **AC-13**: "Because you liked [X]" rows are sourced by calling the new `GET /movies/{id}/similar` once per qualifying liked movie, using the `movie_id` that `GET /me/ratings` already returns (no title lookup, no fuzzy matching), for up to the 3 most recent ratings of 4 or 5 stars (`GET /me/ratings` is already ordered most recent first). A user with no qualifying rating shows no such rows.

## Decision

**Chosen option**: Option 1: extend `/recommend`, add three new single purpose endpoints (`GET /movies/trending`, `GET /movies/{id}`, `GET /movies/{id}/similar`), and keep every call client composed rather than bundled. `/movies/{title}/similar` is left unchanged and unused by this feature. See [`rationale.md`](rationale.md), Option 1.

## Rationale

See [`rationale.md`](rationale.md) for the full reasoning, including the resolved value sourcing gaps and the cross check findings.

## Feature design

**Data model sketch**:

| Entity | Change |
|---|---|
| `users` (Postgres, existing) | + `country` TEXT, nullable, ISO 3166-1 alpha-2 (e.g. "NG", "US"). Set once from the device's locale at signup, on whichever signup path actually creates the account (see AC-11); no other write path in this spec. |
| Movie (in memory `df` / CSV, not Postgres) | `backdrop_path`, `runtime`, `tagline`, `popularity` added to the live single movie fetch path (already present in the bulk CSV except `popularity`, which both paths need for `recommend_popular` ranking to work on a live resolved movie). `trailer_key` added to the live fetch path. Two new fields alongside the existing ones: `cast_photos` (a `{name, profile_path}` list, kept separate from the existing pipe separated `cast` name string, which `filter_by_actor` and the Postgres upsert still need unchanged) and `watch_providers` (one JSON value covering every country TMDB returns, resolved to the requesting user's country per request, replacing the old fetch-time flattening to one region). |
| `movies` (Postgres, existing) | Unchanged. Detail reads from the in memory `df`, not Postgres; Postgres only backs the ratings foreign key and the Ratings tab's title lookup. A live resolved movie is now always `upsert_movie`'d (task 3), closing a gap where it previously wasn't, which would have made rating it fail on the foreign key. |
| `ratings` (Postgres, existing) | Unchanged. |

No new relationships; still `users` 1:N `ratings` N:1 `movies`.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/recommend` | POST | existing body (`liked_titles`, `mood_text`, `mood_weight`, `top_n`, filters) | list of `{id, title, release_date, poster_path, predicted_score}`; `[]` when there's no usable taste signal and no mood | bearer (optional today, unchanged) | 404 (no movies match filters) |
| `/movies/trending` | GET (new) | `top_n` (default 20) | list of `{id, title, release_date, poster_path, predicted_score}` (score is the requesting user's own match, null with no usable taste signal) | bearer (required) | none expected |
| `/movies/{id}` | GET (new) | `id` (path, TMDB movie id) | `{id, title, tagline, overview, genres, release_date, runtime, original_language, poster_path, backdrop_path, predicted_score, cast, director, trailer_key, watch_providers, user_rating}` | bearer (required) | 404 (id not found locally or on TMDB), 502 (TMDB call itself failed) |
| `/movies/{id}/similar` | GET (new) | `id` (path), `top_n` | list of `{id, title, release_date, poster_path, predicted_score}` (score is a plain 0-100 clamp of closeness to the source movie, not calibrated to the requesting user, a deliberately different meaning from AC-2) | bearer (required, for consistency with the rest of the app and to avoid an anonymous endpoint mutating shared server state; not needed for the computation itself) | 404 (id not found locally or on TMDB) |
| `/auth/signup` | POST | existing body + new `country` (optional, ISO 3166-1 alpha-2) | unchanged | none (unchanged) | unchanged |
| `/auth/verify-signup` | POST | existing body + new `country` (optional, carried over from the signup attempt that required confirmation) | unchanged | none (unchanged) | unchanged |

`/movies/{title}/similar` is unchanged by this spec; it stays as is, unauthenticated, title keyed, and is simply not used by Discover & Decide (see Rationale).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `/recommend`, `/movies/trending`, `/movies/{id}/similar` | `id`, `poster_path` per movie | the `df` row's `id` / `poster_path` columns; currently selected out of the response, this spec adds them back |
| `/recommend`, `/movies/trending`, `/movies/{id}` | `predicted_score` (% match to the requesting user) | `clamp(cosine_similarity(user_taste_vector, movie_embedding) / personal_ceiling, 0, 1) * 100`, rounded. `user_taste_vector` from `build_user_profile_from_ratings`. `personal_ceiling` = the average cosine similarity of the user's own 4 or 5 star rated movies to that same taste vector. Null when the user has no ratings, no usable taste signal (all ratings neutral), or no 4 or 5 star rating to form a ceiling from |
| `/movies/{id}/similar` | `predicted_score` (% closeness to the source movie) | `clamp(cosine_similarity(source_movie_embedding, movie_embedding), 0, 1) * 100`, rounded (existing computation, reformatted, deliberately not calibrated against the user, see Key invariants) |
| `/movies/{id}` | `watch_providers`, resolved to one region | `users.country` for the requesting user; NG then US when null (AC-7, AC-11) |
| `/movies/{id}` | `user_rating` | the `ratings` table row for `(user_id, movie_id)`, null if none exists |
| `/movies/{id}` | `cast[].profile_path`, `trailer_key`, `backdrop_path`, `runtime`, `tagline`, `popularity` | TMDB's `/movie/{id}` with `append_to_response=keywords,credits,videos,watch/providers`, the same call already made elsewhere, now capturing more of its own response |
| `/auth/signup`, `/auth/verify-signup` | `users.country` initial value | the device's locale, read by the mobile app via `expo-localization` and sent as a new field in whichever signup request actually creates the account |
| Home card taps | navigation target (`/movie/[id]`) | the `id` field now present on every card shape response (AC-1) |
| "Because you liked [X]" rows | which liked movies qualify, and their `movie_id` | `GET /me/ratings`, already ordered most recent first; filter client side to ratings of 4 or 5 stars, take up to 3. No title lookup needed, `movie_id` is already in that response |
| "Because you liked [X]" row header text | the liked movie's own title, `X` | the same `GET /me/ratings` row's `title` field |

**Key invariants**:
- A card shape response (`{id, title, release_date, poster_path, predicted_score}`) is identical in field names across `/recommend`, `/movies/trending`, and `/movies/{id}/similar`, even though `predicted_score`'s meaning differs: on `/recommend`, `/movies/trending`, and `GET /movies/{id}`'s own score, it is calibrated against the user's own highly rated movies (AC-2); on `/movies/{id}/similar` it is a plain clamp of closeness to the source movie, not calibrated to any user. This is a deliberate, documented difference in meaning under one shape, not an inconsistency to fix.
- `predicted_score` is always null, never `0` or omitted, whenever there is no basis to compute it: no taste vector, no usable taste signal, or no 4 or 5 star rated movie to form a personal ceiling from. A `0` would read as "definitely not a match," which is not what "no data yet" means.
- `df` keeps a stable `RangeIndex` so `embeddings[i]` always matches `df` row `i`; `GET /movies/trending` and any other code reading `embeddings` by a `df` row index depends on this holding.
- Every TMDB relative path (`poster_path`, `backdrop_path`, `profile_path`, `logo_path`) leaves the backend unmodified; only the mobile app prefixes it with the TMDB image CDN base.

**Security model**:
- `GET /movies/trending` and `GET /movies/{id}` require a bearer token (`Depends(get_current_user_id)`), matching the app's no anonymous mode rule; both need the user's identity to compute a personal match score, and `/movies/{id}` additionally needs it for `user_rating`.
- `GET /movies/{id}/similar` also requires a bearer token, for consistency with the rest of the app and to avoid an anonymous endpoint that mutates shared in memory state (`df`/`embeddings`) and spends TMDB quota; unlike the other two, it does not need the user's identity for its own computation (the score is about the source movie, not the caller).
- `/movies/{title}/similar` stays exactly as is: unauthenticated, unused by this feature.
- `/recommend` keeps its existing optional auth (`get_optional_user_id`), unchanged by this spec.

**Configuration required**: none (no new env vars; TMDB access reuses the existing `TMDB_TOKEN`).

**Critical test scenarios** (each maps to an acceptance criterion in `## Requirements`):
- Happy path: a logged in user with 5 ratings, at least one 4 or 5 star, loads Home, gets a non-empty For You row with real ids, posters, and percentage scores, and a Trending Now row with its own personal scores, verifies **AC-1**, **AC-2**, **AC-4**.
- Cold start: a brand new user with zero ratings calls `/recommend` and gets `[]`, and calls `/movies/trending` and gets movies with `predicted_score: null`, verifies **AC-3**, **AC-4**.
- All neutral ratings: a user whose every rating is exactly 3 stars calls `/recommend` and gets `[]` (not a 500), verifies **AC-3**.
- Detail load, cache hit: `GET /movies/{id}` for a movie already in the bulk dataset returns full detail including cast photos and where to watch in one fast, synchronous response, verifies **AC-5**, **AC-7**.
- Detail load, cache miss: `GET /movies/{id}` for a movie never seen before resolves directly from TMDB by id, caches and persists it (Postgres included), and returns the same full shape a bulk loaded movie would; rating it afterward succeeds, verifies **AC-5**, **AC-9**.
- TMDB call fails outright: a live resolve where the TMDB request itself errors returns a clear error and caches nothing, verifies **AC-10**.
- Sub field absent: a live or bulk movie with no TMDB trailer returns `trailer_key: null`, a 200, not an error, verifies **AC-8**, **AC-10**.
- Where to watch, no country: an account with no stored country still gets a Where to Watch section, resolved via the NG then US fallback, verifies **AC-7**, **AC-11**.
- Country on the confirmation path: a signup that requires email confirmation still ends up with `users.country` set once confirmed, verifies **AC-11**.
- Own rating: a user who rated a movie 4 stars, then reopens its Detail screen, sees `user_rating: 4`, verifies **AC-6**.
- Because you liked, no fuzzy match: a user who rated two different movies sharing a similar title, only one of them 5 stars, gets a "Because you liked" row sourced from the exact `movie_id` of the one they rated, never the other, verifies **AC-13**.

## Build plan

1. Add the migration `db/migrations/0002_add_user_country.sql`: nullable `country TEXT` column on `users`. Satisfies **AC-11**.
2. Backend: add `country: str | None` to both `SignupRequest` and `VerifySignupRequest`; thread it through `sign_up()` / `verify_signup_code()` / `create_user_profile()` so it is stored whichever path actually creates the account, immediate session or post confirmation. Satisfies **AC-11**.
3. Backend: bring `recommend.py`'s live single movie fetch path (`fetch_movie_details`, `build_movie_row`) up to the same field capture as `fetch_movies.py`, plus `popularity` (missing from both today but required for `recommend_popular` to rank a live resolved movie): add `backdrop_path`, `runtime`, `tagline`, `trailer_keys`, `popularity`, cast as a separate `{name, profile_path}` list (kept alongside the existing pipe separated `cast` name string, which `filter_by_actor` and the Postgres upsert still need), and the full, unflattened multi country `watch/providers` response (request `watch/providers` in `append_to_response`, which it does not today). On every live resolve, call `upsert_movie(row)` (mirroring `/movies/resolve`, which this path currently skips), so the movie can be rated afterward without a foreign key error. Satisfies **AC-9**.
4. Backend: update `fetch_movies.py` to capture cast `profile_path` per cast member and the full multi country `watch/providers` response, writing them as two new JSON columns (`cast_photos_json`, `watch_providers_json`) alongside the existing pipe separated `cast`/`watch_stream`/`watch_rent`/`watch_buy` columns (kept, not replaced). Update `load_and_prepare_data` to parse the two new columns. Then regenerate `data/movies_test.csv`: delete `data/movies_test.csv` and `data/fetch_progress_test.json` (its per movie resume state), keep `data/discovered_movies_test.json` (the discovery list needs no re-fetch), and re-run `fetch_movies.py` in `TEST_MODE`. Satisfies **AC-9** (see Migration plan below; re-running without deleting the progress file would resume into a no-op).
5. Backend: add a shared card serialization helper returning `{id, title, release_date, poster_path, predicted_score}`, used by `/recommend`, `/movies/trending`, and `/movies/{id}/similar`. `predicted_score` is null whenever there is no basis to compute it, including the case where `build_user_profile_from_ratings` would otherwise raise (every rating exactly neutral), which this helper treats as "no usable taste signal," not an error. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**.
6. Backend: implement the personal ceiling calibration used by task 5's helper and by `/movies/{id}`: for a user with at least one 4 or 5 star rating, compute the average cosine similarity of those specific rated movies to the user's own taste vector, and use it as the divisor (clamped 0 to 1 before the 0 to 100 conversion) for every `predicted_score` computed for that user in this request. A user with no such rating has no ceiling, so no score (AC-3's condition extends to this case too). Satisfies **AC-2**.
7. Backend: change `/recommend`'s cold start branch to trigger whenever there is no usable taste signal (no ratings, or a taste vector `build_user_profile_from_ratings` cannot form) and no mood text, returning `[]` instead of falling back to `recommend_popular`. Satisfies **AC-3**.
8. Backend: add `GET /movies/trending` (auth required, `top_n` query param): select via `recommend_popular`, reading `id`/`poster_path`/`popularity` directly off the matched `df` rows (today's `recommend_popular` selection omits them), and compute each item's `predicted_score` via task 5/6's helper, using `embeddings` at the same `df` row index (relies on `df`'s stable `RangeIndex`, a Key invariant above). Satisfies **AC-4**.
9. Backend: add `GET /movies/{id}/similar` (auth required, `top_n` query param): look up the source movie in `state["df"]` by `id` (falling back to a live TMDB by id fetch on miss, the same path as task 10), then rank the rest of the catalog by cosine similarity to the source movie's own embedding (the existing similar movies computation, unchanged), returning the card shape with `predicted_score` as a plain 0 to 100 clamp of that similarity, not calibrated to the requesting user (a deliberately different meaning from task 6). Satisfies **AC-13**.
10. Backend: add `GET /movies/{id}` (auth required): look up `state["df"]` by `id` first; on a miss, fetch directly from TMDB's `/movie/{id}` (no fuzzy title search) and cache into `df` / `embeddings` / `title_to_index`, persisting via `upsert_movie` (task 3). If the TMDB call itself fails outright, return a clear error and cache nothing; if it succeeds but a sub field is simply absent for this movie, return `null` for that field. Resolve `watch_providers` to the requesting user's country (`users.country`, NG then US fallback), look up `user_rating` from the ratings table, and compute `predicted_score` via task 5/6's helper. Satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-10**.
11. Mobile: add `expo-localization`; read the device's region at signup and send it as the new `country` field on `POST /auth/signup`, and again on `POST /auth/verify-signup` if the account needed confirmation (task 2). Satisfies **AC-11**.
12. Mobile: extend `constants/config.ts`'s image URL convention with one size per image type (poster, backdrop, cast photo, provider logo), alongside the existing `posterUrl()`. Satisfies **AC-12**.
13. Mobile: update `types/api.ts` with the new card shape, `MovieDetail`, and `WatchProviders` types mirroring the backend response. "Because you liked" rows call `GET /movies/{id}/similar` using the `movie_id` `GET /me/ratings` already returns (already ordered most recent first), filtered to ratings of 4 or 5 stars, up to 3. Movie Detail's own Similar Movies row reuses the same `GET /movies/{id}/similar` call with the id already in its route, no title threading needed. Satisfies **AC-1** through **AC-8**, **AC-12**, **AC-13**.

## Consequences

**Positive**:
- Home and Movie Detail now have one coherent, complete contract to build against, instead of three endpoints returning barely more than a title.
- A movie resolved live behaves identically to one loaded in bulk, no special casing on the mobile side for "was this movie already known," and it can actually be rated afterward.
- Where to Watch reflects a real per user country instead of one hardcoded region for everyone.
- A match score means "how close is this to the movies I already love," calibrated per user from their own real rating history, not an invented global constant and not a comparison against other users.

**Negative / tradeoffs**:
- The first time a genuinely new movie is opened, `GET /movies/{id}` pays a real TMDB round trip (details, credits, videos, watch providers) synchronously, the same latency pattern `/movies/resolve` already accepts today, but now on the Detail screen's critical path too.
- The new `country` field has no edit UI until Profile (Journey 5) ships; a wrong locale guess sticks until then.
- Caching every country's watch provider data grows the in memory footprint per movie somewhat; still bounded per movie, not per user.
- Cast photos depend on TMDB actually having a `profile_path` for that person; not every actor has one, so the mobile placeholder circle stays in real use, not just as a loading state.
- A personal ceiling built from only one or two 4 or 5 star ratings is a small, potentially noisy sample; it still works (any positive rating gives a ceiling), but its calibration firms up as a user rates more.

**Neutral**:
- `predicted_score` keeps two different meanings under one field name depending on the endpoint (personal calibration vs. plain closeness to a source movie); documented above, not a defect.
- Regenerating `data/movies_test.csv` is a one time data refresh for the current test dataset, not a schema change.
- `/movies/{title}/similar` is left entirely alone; it still exists and works exactly as before, this feature simply does not call it.

## Migration plan

**Strategy**: no migration needed for the schema change itself (a nullable column addition, zero downtime); the movie dataset refresh is a one time data regeneration, not a live migration.

**Phases**:
1. Ship the `users.country` migration and the backend/mobile signup changes together (task 1, 2, 11). Existing accounts simply have `country = null` until this ships for them, already handled by the NG then US fallback.
2. Update `recommend.py`'s live fetch path and `fetch_movies.py`'s bulk fetch path (task 3, 4) before regenerating `data/movies_test.csv`, so both paths capture the same fields going forward.
3. Regenerate `data/movies_test.csv`: delete `data/movies_test.csv` and `data/fetch_progress_test.json`, keep `data/discovered_movies_test.json`, then re-run `fetch_movies.py` in `TEST_MODE` (task 4). Deleting the progress file matters: `fetch_movies.py` resumes from it and skips every id already marked done, so re-running without deleting it would fetch nothing and silently leave the CSV in its old shape.
4. Ship the new/extended endpoints (task 5 through 10) last, once the data they read is in the shape they expect.

**Rollback**: each phase reverts independently by reverting its commit; the `country` column can stay in place unused if phase 1 alone is rolled back, no data loss since nothing else depends on it yet.

**Risks**: re-running `fetch_movies.py` re-fetches all ~300 test movies from TMDB, subject to the same rate limiting `fetch_movies.py` already handles; if interrupted, deleting the progress file means it starts over cleanly rather than silently resuming into a no-op, the same failure mode this phase exists to avoid.

## Follow-up

- [ ] Country becomes user editable once Profile (Journey 5, `docs/scope/scope.md` row 9) ships; this spec only covers the automatic capture at signup.
- [ ] `mobile/AGENTS.md` §3 needs `expo-localization` added to the approved library list before `/develop` builds against this spec.
- [ ] `ScoreBadge`'s accessibility label (currently hardcoded "Predicted score") and formatting (currently `score.toFixed(1)`) need updating for the percentage format decided here; also consider whether `/movies/{id}/similar`'s "closeness to this movie" meaning should read differently in the accessibility label than `/recommend`'s and `/movies/trending`'s "closeness to you" meaning.
- [ ] When `fetch_movies.py`'s `TEST_MODE` is eventually flipped to `False` for the real 60,000 movie fetch, it must be the version updated by this spec (cast photos, multi country providers), not an earlier one.
- [ ] A personal ceiling based on only one or two 4-5 star ratings is a small sample; not a blocker, but worth watching once there's real usage data to see if it needs a minimum-ratings floor before showing a score at all.
