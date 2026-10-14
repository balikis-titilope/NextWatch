# 0010. TV show support

**Date**: 2026-08-13
**Status**: In Progress

## Summary

NextWatch currently only understands movies: search, ratings, and recommendations all fail silently on a TV show, even an exact title match, because the whole pipeline (TMDB calls, the database, the recommendation engine) only ever looks at TMDB's movie catalog. This spec extends the existing movie system to also handle TV shows everywhere a movie works today (search, rating, recommendations, mood discovery, trending, notifications, filters), by adding a media type field to the existing data instead of building a separate parallel system. A TV show is treated as one ratable unit, like a movie, with no season or episode tracking.

**Reasoning and options**: see [rationale.md](rationale.md)

## Requirements

**User stories**:
- As a user, I want to search for and rate TV shows, not just movies, so my taste profile and recommendations reflect everything I actually watch.
- As a user, I want search results to clearly show whether something is a movie or a TV show, so a merged list doesn't confuse me.
- As a user, I want Home, Mood Discovery, and similar-title recommendations to include TV shows, so I get a complete picture of what to watch next.

**Acceptance criteria**:
- **AC-1**: Searching a TV show title (e.g. a title that only exists on TMDB's TV catalog) returns a confident match; the exact bug this spec fixes ("The Manipulated", "Moon Lovers: Scarlet Heart Ryeo" failing to resolve) no longer happens.
- **AC-2**: A user can rate a TV show. The rating is stored against the show's (id, media_type) pair and counts toward the same taste vector as movie ratings (one unified profile, not two).
- **AC-3**: Search and Browse results merge movies and TV shows into one ranked list. Each TV card shows a small type badge; movie cards are unchanged. Browse additionally supports a media_type filter chip (Movies / TV / Both, default Both).
- **AC-4**: The Movie Detail screen, now at the nested route `/movie/[type]/[id]`, renders TV appropriate fields for a TV show (first_air_date shown as its date, number_of_seasons, number_of_episodes, status such as Returning Series/Ended/Canceled, creator(s) instead of director, an episode runtime), and is unchanged for a movie.
- **AC-5**: Home's For You / Trending Now / Because you liked rows, and Mood Discovery's results, can surface either media type, ranked by one unified taste vector and embedding space.
- **AC-6**: "Similar to this title" (`GET /movies/{media_type}/{id}/similar`) ranks purely by embedding closeness and can return the other media type when it is genuinely the closest match (a movie's similar list can include a TV show).
- **AC-7**: A user's taste vector blends every rating, movie or TV, into one profile; there is no separate per type profile.
- **AC-8**: The Ratings tab and Profile's "Rate More" flow (renamed from "Rate More Movies") list, rate, and delete both types identically, with type neutral copy.
- **AC-9**: Onboarding's search/add/rate flow supports TV shows, with type neutral copy ("search, add, and rate titles" instead of "movies").
- **AC-10**: The re-engagement notification's copy no longer names "movie" specifically (type neutral wording).
- **AC-11**: A title that cannot be confidently matched against either TMDB's movie or TV catalog behaves exactly like today's unmatched-movie case; no new failure state is introduced.
- **AC-12**: The migration preserves every existing rating and movie row; each is backfilled with media_type = 'movie' and continues to resolve, join, and delete correctly afterward.
- **AC-13**: A one time bulk TV fetch (target 20,000 shows) populates the local dataset the same way the existing movie fetch does, via one unified, media type aware fetch script.

## Decision

**Chosen option**: Option 1: Extend the existing `movies` table with a media_type discriminator and a composite primary key, instead of a separate `tv_shows` table.

The `movies` table (kept under its existing name; see Rationale) gains `media_type` as part of its primary key, three new nullable columns for TV only facts, and reuses existing columns (`release_date`, `director`) for the TV equivalent concept (first_air_date, creator). `ratings` gains a matching `media_type` column and a composite foreign key. The recommendation engine's single in-memory dataframe and embedding matrix, already the load bearing data structure, absorbs both types without change to its ranking logic.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `backend/.agents/skills/supabase-postgres-best-practices/`)

## Feature design

**Data model sketch**:

`movies` (extended):
| Column | Type | Notes |
|---|---|---|
| id | INTEGER | PK (composite) — raw TMDB id |
| media_type | TEXT | PK (composite), NOT NULL, CHECK IN ('movie','tv') — new |
| title | TEXT NOT NULL | shared |
| overview, genres, keywords, cast_members | TEXT | shared, unchanged |
| director | TEXT | shared — holds creator(s) for a TV row |
| release_date | DATE | shared — holds first_air_date for a TV row |
| status | TEXT | new, shared — TMDB's own status string for either type |
| original_language, production_countries, vote_average, vote_count, poster_path, backdrop_path, combined_text | — | shared, unchanged |
| number_of_seasons | INTEGER | new, TV only, null on a movie row |
| number_of_episodes | INTEGER | new, TV only, null on a movie row |
| episode_runtime | INTEGER | new, TV only (minutes per episode, TMDB's first reported value), null on a movie row |

`ratings` (extended):
| Column | Type | Notes |
|---|---|---|
| movie_id | INTEGER | FK, composite with media_type |
| media_type | TEXT | new, NOT NULL — backfilled 'movie' for every existing row |
| UNIQUE | (user_id, movie_id, media_type) | was (user_id, movie_id) |
| FK | (movie_id, media_type) references movies(id, media_type) | was movies(id) |
| index | (movie_id, media_type) | new — Postgres does not auto index a foreign key column |

Relationships: `movies` 1 to N `ratings` (composite key). `users` 1 to N `ratings` (unchanged). `notifications` untouched (its `payload` column is reserved and unused, references no title today).

**State transitions**: none new. A rating is still 1 to 5, created or updated, deleted; no TV specific lifecycle.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /movies/search | GET | query: str | list of {id, title, release_date, poster_path, media_type} | none | - |
| /movies/resolve | POST | title: str | {movie_id, title, release_date, poster_path, media_type} | none | 404 no confident match in either catalog |
| /movies/{media_type}/{id} | GET | media_type path ('movie'\|'tv'), id path | MovieDetail (+ media_type, status, number_of_seasons, number_of_episodes, episode_runtime) | bearer optional (for user_rating) | 404 not_found, 502 fetch_failed |
| /movies/{media_type}/{id}/similar | GET | media_type path, id path | list of MovieCard (+ media_type), cross type allowed | bearer optional | 404 |
| /movies | GET | language?, actor?, start_year?, end_year?, media_type? ('movie'\|'tv'\|'both', default 'both') | list of BrowseMovie (+ media_type) | none | - |
| /movies/trending | GET | - | list of MovieCard (+ media_type), naturally mixed | bearer optional | - |
| /recommend | POST | liked_titles?, mood_text?, mood_weight?, top_n?, filters | list of MovieCard (+ media_type), unified taste | bearer | - |
| /ratings | POST | movie_id, media_type ('movie'\|'tv'), rating | {id} | bearer | 422 invalid media_type |
| /ratings/{movie_id} | DELETE | movie_id path, media_type query (new, required, no default) | 204 | bearer | 404, 422 missing media_type |
| /me/ratings | GET | - | list of RatingEntry (+ media_type) | bearer | - |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| GET /movies/{media_type}/{id} | which row to fetch | path params media_type + id, both required, no default |
| POST /movies/resolve | the resolved media_type | derived: whichever of TMDB /search/movie or /search/tv returns a confident titles_match; tie broken by higher popularity/vote_count when both are confident |
| DELETE /ratings/{movie_id} | which rating to delete | path movie_id + required query param media_type; omitting it is a 422, not a silent default, matching the id disambiguation rule everywhere else |
| GET /movies (browse) | media_type filter applied | query param, defaults to 'both' when omitted |
| Migration backfill | media_type for every existing row | hardcoded 'movie': every row in the system predates TV support |
| TMDB TV detail fetch | cast, creator | credits pulled via TMDB's aggregate_credits (full series cast across seasons, not one season), director column holds created_by's names, not a crew "Director" job (TV crew data does not carry that job title the way movie crew does) |
| TMDB TV detail fetch | keywords | TMDB's /tv/{id} keywords response nests under `results`, not `keywords` like the movie endpoint; the enrich step needs a media_type branch here specifically |
| TMDB TV detail fetch | title, release_date, episode_runtime, production_countries | field renames build_movie_row/build_movie_text must apply for a TV payload: name to title, first_air_date to release_date, episode_run_time's first value to episode_runtime, origin_country to production_countries (TV has no production_countries field of its own), runtime left null (TV has no single total runtime) |
| GET /movies (browse, media_type = both), GET /movies/trending | which item ranks first in a merged list | sorted by popularity descending before the result is limited; with no explicit order, a merged list defaults to load order (movies first, since they load first), which would silently bury every TV result |
| POST /recommend | whether results are filtered by media_type | intentionally not filtered; the whole point of the unified taste vector (AC-5, AC-7) is one merged ranking across both types |
| Every id lookup in db/import_data.py and recommend.py (upsert_movie, import_movies, add_rating, delete_rating, get_user_ratings, get_user_ratings_detailed, get_movie_by_id, build_user_profile_from_ratings, compute_personal_ceiling, /recommend's excluded ids set, Movie Detail's user_rating lookup, build_movie_cards) | which row id refers to | every one of these currently assumes a single column id; each must take and pass through media_type, not id alone, once the composite key lands (Build plan task 2b) |

**Key invariants**:
- Every `movies` row has `media_type` in ('movie', 'tv'); every `ratings` row's media_type matches its referenced `movies` row (enforced by the composite FK).
- (id, media_type) is unique in `movies`; (user_id, movie_id, media_type) is unique in `ratings`.
- `release_date` and `director` hold the type appropriate value (first_air_date/creator for TV); no code path may assume `release_date` means "movie release date" without handling the TV case too.
- The recommendation engine's embeddings matrix and title_to_index stay index aligned with the merged movies and TV dataframe regardless of source (bulk fetch or live resolve).
- `title_to_index` is keyed on (title_lower, media_type), not title_lower alone: a movie and a TV show can share the same lowercase title ("Fargo", "Parasite", "The Office" all exist as both), and a single key map would silently drop one on load. A free text lookup with no type hint (the resolve path) keeps a secondary title_lower to list of (index, media_type) map, and applies the same popularity/vote_count tie break as /movies/resolve.
- `search_local_titles`'s de duplication is on (id, media_type), not id alone, for the same collision reason; deduping on id alone would silently remove a real search result.

**Security model**: unchanged from the existing pattern. Every rating write is scoped to the authenticated user_id exactly as today; media_type introduces no new role, no new sensitive data class, no new cross user exposure.

**Critical test scenarios**:
- Happy path: search "Moon Lovers: Scarlet Heart Ryeo", get a confident TV result, rate it, see it in the Ratings tab with correct season/date info. Verifies **AC-1**, **AC-2**, **AC-8**.
- Failure case: DELETE /ratings/{movie_id} without the media_type query param returns 422, not a silent guess. Verifies the value sourcing rule under **AC-2**, **AC-8**.
- Auth/permission: rating a TV show while unauthenticated returns 401, identical to the existing movie rating path. Verifies **AC-2**.
- Cross type similar: GET /movies/movie/{id}/similar for a movie returns a TV show high in its ranked list when it is genuinely the closest embedding. Verifies **AC-6**.
- Migration: an existing, pre TV rating for a movie still joins and returns correctly via GET /me/ratings with media_type = 'movie' after the migration runs. Verifies **AC-12**.
- No match: searching a nonsense title returns the same "not found" behavior as today, now checked against both catalogs. Verifies **AC-11**.

## Build plan

Ordered per the project's Journey build approach: the data model and TMDB integration are the shared foundation every surface depends on, then each existing journey gets TV parity fully, one at a time, starting with the journey where the bug was actually reported (Search & browse) before moving to the others.

1. [x] Migration: composite key on movies, media_type + composite FK on ratings, new TV columns, backfill (see Migration plan below, including the transitional DEFAULT that keeps old code writable during the deploy window), satisfies **AC-12**
2. [x] Backend, TMDB integration: extend the unified fetch script (fetch_movies.py) with a media_type parameter branching /discover/movie vs /discover/tv and /movie/{id} vs /tv/{id}; extend build_movie_row/build_movie_text with the full TV field map (name to title, first_air_date to release_date, episode_run_time's first value to episode_runtime, origin_country to production_countries, runtime left null); extend the detail enrich step for aggregate_credits, created_by, and the keywords response shape difference. Writes both types into the same CSV, satisfies **AC-13**
2b. [x] Backend, composite key propagation: update every existing id based function to take and use media_type, not id alone: upsert_movie/import_movies (ON CONFLICT (id) becomes ON CONFLICT (id, media_type)), add_rating/delete_rating (media_type param, composite ON CONFLICT/WHERE), get_user_ratings/get_user_ratings_detailed (composite join, media_type in the returned tuple), get_movie_by_id, build_user_profile_from_ratings, compute_personal_ceiling, /recommend's excluded ids set, Movie Detail's user_rating lookup, build_movie_cards's output shape (media_type included). Also fix title_to_index to key on (title_lower, media_type) with the ambiguous lookup fallback, and search_local_titles's de duplication to (id, media_type), both per the Key invariants above. Satisfies **AC-2**, **AC-12**
3. [x] Backend, resolve and search: generalize search_tmdb_movie into a dual TMDB lookup (search both /search/movie and /search/tv, confidence check plus popularity tie break) used ONLY by /movies/resolve; /movies/search (local typeahead) stays local only, just widened to project media_type from the already merged local dataset, no new network call added to every keystroke, satisfies **AC-1**
4. [x] Backend, id based routes: path segment disambiguation on GET /movies/{media_type}/{id} and its /similar route (cross type ranking, no type filter); remove or redirect the now superseded single id routes (/movies/{id:int}, /movies/{id:int}/similar) so a caller can't silently hit the old, now ambiguous shape; audit any other legacy id or title based route (e.g. a title based similar lookup, /predict) and either extend it with the same media_type requirement or deprecate it explicitly, satisfies **AC-4**, **AC-6**
5. [x] Backend, filters and mutation surface: media_type on POST /ratings and DELETE /ratings/{movie_id} (required query param, no default); the media_type browse filter on GET /movies, with GET /movies and GET /movies/trending both explicitly ordered by popularity descending before limiting, so a merged "Both" list doesn't bury every TV result behind movies loaded first, satisfies **AC-2**, **AC-3**
6. [x] Backend: re engagement notification copy made type neutral, satisfies **AC-10**
7. [x] Mobile: shared types (types/api.ts) gain media_type, plus status, number_of_seasons, number_of_episodes, and episode_runtime on MovieDetail, across MovieCard, MovieDetail, BrowseMovie, RatingEntry, MovieSearchResult, ResolvedMovie
8. [x] Mobile, Search & browse journey: merged results with the TV badge on PosterCard, the media_type filter chip (bottom sheet, matching Language/Actor/Year), the nested /movie/[type]/[id] route, and Movie Detail's TV field rendering (season/episode counts, status, creator, episode runtime), satisfies **AC-3**, **AC-4**
9. [x] Mobile, Discover & decide journey: Home's rows and the detail screen consume the now mixed card/detail data with no new logic beyond what task 8 built, satisfies **AC-5**
10. [x] Mobile, Mood discovery journey: results grid reuses the same PosterCard/badge from task 8, satisfies **AC-5**
11. [x] Mobile, Ratings & profile journey: Ratings tab and Profile's "Rate More" (renamed, type neutral copy) work against the composite key end to end, including delete, satisfies **AC-7**, **AC-8**
12. [x] Mobile, Account & getting started journey: onboarding's search/add/rate flow gains TV parity and type neutral copy, satisfies **AC-9**
13. Run the real (non test) unified bulk fetch once the above ships, populating movies.csv/movies_test.csv with the real dataset, satisfies **AC-13**

## Consequences

**Positive**:
- Fixes the reported bug for real: any TV title can now be found, rated, and folded into recommendations, not just movies.
- One unified recommendation engine, one taste vector, one search experience; no parallel TV specific system to maintain.
- The composite key and shared columns mean almost no new branching in the code paths that already work correctly (filters, Ratings tab, PosterCard).

**Negative / tradeoffs**:
- Every id based movies query, everywhere in the codebase, must now carry media_type; a query written to select by id alone can silently produce a Postgres constraint violation or resolve to the wrong logical entity if code drifts from this rule during future changes.
- `release_date` and `director` holding TV data reads oddly to a future engineer unfamiliar with this decision; needs a one line comment at the schema definition, not just this spec.
- Trending and cold start recommendations for TV stay sparse until the real bulk fetch runs or enough users search/rate TV shows, same limitation the movie side already accepted before its own real fetch has run.
- The ALTER TABLE steps that change movies' primary key take a brief exclusive lock; acceptable at this app's current pre launch scale, but must run as a deliberate deploy step, not silently alongside unrelated traffic.

**Neutral**:
- "Movie" stays the umbrella term in code, endpoints, and table names even though it now also covers TV; documented here and in AGENTS.md rather than fixed by a rename.
- The TV bulk fetch (20,000 shows) roughly doubles this feature's TMDB request volume and CSV size versus a resolve only approach.
- `status` is not backfilled for existing movie rows and is not populated by re running today's fetch pipeline unmodified; it stays null on a movie until that row is next re fetched or live resolved. Fine for a display only field, but worth knowing going in rather than discovering it looks sparse.

## Follow-up

- [ ] Run the real (non test) unified bulk fetch (60,000 movies + 20,000 TV shows) once this ships; today's dataset is still the 300 row TEST_MODE sample.
- [ ] Add the schema comment on `release_date`/`director` explaining the TV reuse, at the point the migration is written, so it doesn't only live in this spec.
- [ ] `db/import_data.py`'s docstring ("movies, users, ratings, watchlist") already references a watchlist table that does not exist in `CREATE_TABLES_SQL`; unrelated to this feature but worth a one line fix whenever that file is next touched.

## Migration plan

**Strategy**: Phased schema migration (add nullable, backfill, then constrain). Not a strangler rewrite, since this is additive schema evolution on a live but low traffic table, not a system replacement; not a single big bang statement, since adding a NOT NULL column or changing a primary key without first backfilling risks a long lock or a constraint violation on existing rows.

**Phases**:
1. `ALTER TABLE movies ADD COLUMN media_type TEXT` (nullable), plus the three new TV columns and `status`; `ALTER TABLE ratings ADD COLUMN media_type TEXT` (nullable). No behavior change yet; existing code keeps working untouched.
2. Backfill: `UPDATE movies SET media_type = 'movie' WHERE media_type IS NULL`; `UPDATE ratings SET media_type = 'movie' WHERE media_type IS NULL`. Single pass is fine at this dataset's current size (hundreds to tens of thousands of rows); the real bulk fetch (task 13) happens after this, not before.
3. Constrain, with a transitional default: set both media_type columns NOT NULL DEFAULT 'movie' with a CHECK IN ('movie','tv'); drop the single column primary key on movies, add the composite primary key (id, media_type); drop the old ratings unique constraint and foreign key, add the composite versions plus the new (movie_id, media_type) index. The DEFAULT here is load bearing, not cosmetic: it is what keeps the still deployed old code (which inserts without media_type, and whose ON CONFLICT (id) / ON CONFLICT (user_id, movie_id) clauses no longer match any constraint once the keys are composite) from failing on every write during the gap before phase 4 ships.
4. Deploy the backend code that reads and writes with media_type everywhere (build plan tasks 2 to 6, including task 2b's full function list). Phase 3 and phase 4 form one atomic deploy window, not two independently timed steps: old code is only protected by the DEFAULT in between, not fully correct.
5. Deploy the mobile update (build plan tasks 7 to 12) in the same release.
6. Once phase 4's code is confirmed live and writing media_type explicitly on every path, drop the DEFAULT on both columns (ALTER COLUMN media_type DROP DEFAULT). It was a deploy window safety net, not a permanent invariant; leaving it in place would silently mask a future code path that forgets to pass media_type.

**Rollback**: Reverting the code deploy (phase 4 to 5) is a normal revert as long as no TV rows exist yet; every row created before this ships is backfilled to media_type = 'movie', so pre TV code paths still find what they expect. Rolling back after TV rows have actually been written requires an explicit decision to delete them or accept the schema stays ahead of the code; this is a real risk, not a clean revert, and is why phase 3's constraint changes should not ship until phase 4 is ready to follow immediately (see the phase 3/4 note above).

**Risks**: The primary key change in phase 3 takes a brief ACCESS EXCLUSIVE lock on `movies` and `ratings`, blocking reads and writes for its duration. Acceptable at this app's current pre launch scale; should still run as a deliberate deploy step, not silently alongside unrelated traffic.
