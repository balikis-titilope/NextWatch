# Verify: Discover & decide · spec 0005 · updated 2026-08-09

_Steps derived from spec 0005 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Sign up a brand new account, no ratings yet → Home shows a "rate a few movies" prompt instead of a For You row, Trending Now still renders with no score badges → AC-3, AC-4
- [ ] Rate 3-5 movies at 4-5 stars, reopen Home → a For You row appears with real posters and whole-number percentage score badges; a "Because you liked [X]" row appears per qualifying rated movie (max 3, most recent first) → AC-1, AC-2, AC-13
- [ ] Rate every movie exactly 3 stars (no 4/5-star rating) → Home still shows Trending Now (scores null) and no For You row, no crash → AC-3
- [ ] Tap any card (Home row, hero, or Search result) → Movie Detail opens fully populated: poster, backdrop, title, year/runtime/language line, genre chips, a match-score chip, cast row with photos, Where to Watch tabs with provider logos, an expandable overview, and a Similar Movies row → AC-5, AC-13
- [ ] On Movie Detail, tap a star to rate → the star row updates immediately; leave and reopen the same movie → the same rating is still shown (`user_rating`) → AC-6
- [ ] Open a movie that has no TMDB trailer → no "Watch Trailer" button rendered, no error → AC-8
- [ ] Open a movie never opened before by anyone (forces the live TMDB-by-id path) → Detail loads fully (cast photos, runtime, tagline, backdrop, where to watch), and rating it afterward succeeds (no foreign-key error) → AC-5, AC-9
- [ ] On an account with no stored country (pre-existing account, or signup capture failed), open Movie Detail → Where to Watch still renders, using the NG-then-US fallback → AC-7, AC-11
- [ ] Sign up a new account, requiring email confirmation → confirm the code → the account's stored country is still set (not dropped by the confirmation step) → AC-11

## Commands
- [ ] `cd backend && venv\Scripts\python -m unittest test_auth_refresh test_cors -v` → all pass
- [ ] `cd backend && venv\Scripts\python -c "import main"` → imports clean, no route or import errors
- [ ] `curl http://127.0.0.1:8000/movies/search?q=<title>` (no bearer token) → 200, not 401 (confirms `/movies/{id}` doesn't shadow `/movies/search`)
- [ ] `curl http://127.0.0.1:8000/movies/<real-tmdb-id>/similar` (no bearer token) → 401 "Missing bearer token" (confirms the id-based route, not the old title-based one, is reached)
- [ ] `cd mobile && npm run typecheck && npm run lint && npm test` → all pass

## Acceptance-criteria coverage
- AC-1 (id/poster_path on every card listing) · covered by the Home rows manual step and the shared card serialization (backend/recommend.py's `build_movie_cards`)
- AC-2 (calibrated 0-100 match score) · covered by the For You row step; unit-level calibration (`calibrated_score`, `compute_personal_ceiling`) exercised directly during this build (0.8/0.8→100, 0.4/0.8→50, 0.9/0.8→100 clamped)
- AC-3 (cold start / no usable taste signal → `[]`) · covered by the new-account and all-neutral-ratings steps
- AC-4 (`GET /movies/trending` shape + own score) · covered by the Trending Now render in both new-account and rated-account steps
- AC-5 (full Movie Detail set) · covered by the "tap any card" step
- AC-6 (`user_rating` reflects the real rating) · covered by the star-tap-then-reopen step
- AC-7 (Where to Watch resolved to the user's country, NG/US fallback, logo paths) · covered by the no-country step; verified directly against live TMDB data during this build (GB resolution returned 4 stream/6 rent/6 buy providers with logo paths)
- AC-8 (`trailer_key: null`, not an error, when absent) · covered by the no-trailer step
- AC-9 (a live-resolved movie matches a bulk-loaded one, persists, can be rated) · covered by the never-opened-before step; verified directly during this build (a genuinely new TMDB id was live-fetched, cached in memory, and confirmed present in Postgres afterward)
- AC-10 (TMDB call failure → clear error, nothing cached; absent sub-field → null, not an error) · verified directly during this build (a bogus id returned 404 with nothing cached; a real movie with a missing sub-field returned null for that field, 200 overall)
- AC-11 (device country captured at signup, both paths, NG/US fallback when unset) · covered by the two signup steps
- AC-12 (raw TMDB relative paths, client-side URL building per image type) · covered by every screenshot-bearing step rendering correctly (poster/backdrop/cast/logo)
- AC-13 ("Because you liked" sourced by movie_id, no fuzzy title match; plain closeness score) · covered by the rated-account step
