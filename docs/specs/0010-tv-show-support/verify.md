# Verify: TV show support · spec 0010 · updated 2026-08-13
_Steps derived from spec 0010 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Search "Moon Lovers: Scarlet Heart Ryeo" (or another TV-only title) → a confident result resolves and opens Movie Detail → AC-1
- [ ] Rate that show, then open the Ratings tab → it appears with correct rating and season/date info → AC-2, AC-8
- [ ] Search & Browse: submit a query that matches both movies and TV shows → results merge into one ranked list, each TV card shows a small "TV" badge, movie cards look unchanged → AC-3
- [ ] Browse: open the media type filter chip → select "Movies", "TV", "Both" → results filter accordingly, default is "Both" → AC-3
- [ ] Open a TV show's Movie Detail (`/movie/tv/[id]`) → shows first_air_date as its date, number_of_seasons, number_of_episodes, status (e.g. Returning Series/Ended/Canceled), creator(s) instead of director, episode runtime → AC-4
- [ ] Open a movie's Movie Detail (`/movie/movie/[id]`) → unchanged from before this build → AC-4
- [ ] Home: For You / Trending Now / Because you liked rows can each surface a TV card mixed with movies → AC-5
- [ ] Mood Discovery: submit a mood → results grid can include TV cards with the same badge → AC-5
- [ ] Open a movie's Movie Detail and scroll to its Similar row → confirm it is allowed to include a TV show when genuinely closest (not filtered to movie-only) → AC-6
- [ ] Rate a movie and a TV show as the same user → confirm recommendations blend both (e.g. a TV rating visibly shifts For You results) → AC-7
- [ ] Ratings tab: rate, and delete both a movie and a TV rating → both work identically, copy doesn't say "movie" specifically → AC-8
- [ ] Profile → "Rate More" (not "Rate More Movies") → search/add/rate a TV show the same way as a movie → AC-8
- [ ] Onboarding: search/add/rate flow works for a TV show, copy reads "search, add, and rate titles" not "movies" → AC-9
- [ ] Trigger the re-engagement notification (or inspect its copy in `db/import_data.py`'s `NOTIFICATION_COPY`) → no "movie" specifically named → AC-10
- [ ] Search a nonsense title that matches neither TMDB catalog → same "not found" behavior as before this build, no new failure state → AC-11

## Commands
- [ ] `SELECT COUNT(*) FROM movies WHERE media_type='movie'` in Postgres → equals the pre-migration row count (551 at migration time) → AC-12
- [ ] `SELECT id, media_type, title FROM movies WHERE media_type='tv' LIMIT 5` after the real bulk fetch → real TV rows present → AC-13
- [ ] `GET /me/ratings` for a user with a pre-existing (pre-TV) rating → still returns `media_type: "movie"` and joins correctly → AC-12
- [ ] `DELETE /ratings/{movie_id}` with no `media_type` query param → 422, not a silent default → AC-2/AC-8's value-sourcing rule
- [ ] `POST /movies/resolve` with a title matching TV, then a movie, then both (e.g. "Fargo") → each resolves to the correct `media_type`, the both-case picks the higher popularity/vote_count catalog → Value sourcing: resolve's derived media_type
- [ ] `GET /movies?media_type=both&limit=5` → results explicitly ordered by popularity descending (not CSV load order) → Value sourcing: browse/trending ordering
- [ ] `python fetch_movies.py` (TEST_MODE=False, run once the background fetch this session started completes) → populates `data/movies.csv` with ~60,000 movies + ~20,000 TV shows, both types present → AC-13
- [ ] After the real fetch: `import_data.import_movies("data/movies.csv")` then `POST /admin/reload` → `state["df"]` count matches, `recommend.py`'s `DATA_PATH`/`import_data.py`'s `CSV_PATH` flipped off `_test` files → AC-13

## Acceptance-criteria coverage
- AC-1 (TV title search resolves) … UI step 1
- AC-2 (rate a TV show, unified taste vector storage) … UI steps 2, 12; command step 4
- AC-3 (merged Search/Browse results, badge, filter chip) … UI steps 3, 4
- AC-4 (TV-appropriate Movie Detail fields) … UI steps 5, 6
- AC-5 (Home/Mood Discovery surface both types) … UI steps 7, 8
- AC-6 (cross-type similar ranking) … UI step 9
- AC-7 (unified taste vector blends both types) … UI step 10
- AC-8 (Ratings tab / Rate More parity, type neutral copy) … UI steps 11, 12
- AC-9 (onboarding TV parity, type neutral copy) … UI step 13
- AC-10 (re-engagement notification copy) … UI step 14
- AC-11 (unmatched title behaves like today) … UI step 15
- AC-12 (migration preserves existing ratings/movies) … command steps 1, 3
- AC-13 (bulk TV fetch via unified script) … command steps 2, 7, 8
