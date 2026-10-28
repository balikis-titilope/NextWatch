# Verify: ratings & profile (delete a rating) · spec 0008 · updated 2026-08-11
_Steps derived from spec 0008 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open the Ratings tab with at least one rated movie → each row shows a trash (delete) icon → AC-1
- [ ] Tap the trash icon → a confirm dialog opens naming the movie ("Remove your rating for X?") → AC-2
- [ ] In that dialog, tap Cancel → dialog closes, the rating is still in the list, untouched → AC-2
- [ ] Tap the trash icon, then confirm → the rating disappears from the list and the count chip drops by one → AC-3
- [ ] Attempt to delete a `movie_id` never rated (or, with a second account's token, one rated by someone else) → 404 in both cases, never a 403 → AC-4
- [ ] After a successful delete, open Home → For You / Trending Now / Because you liked rows reflect the change on next view (rating/adding a movie does NOT force this same refresh — that's intentional, not a bug) → AC-5
- [ ] With the backend unreachable (stop it, or airplane mode), confirm a delete → the request fails, the rating stays visible, and an error message shows in the dialog → AC-6
- [ ] Delete the same rating twice quickly (double-tap), or delete it from another device then retry here → treated as success, the row disappears, no error shown → AC-7
- [ ] Visit onboarding and Profile's "Rate More Movies" → no delete control appears in either place → AC-8
- [ ] After a successful delete, check the user's `last_active_at` (e.g. `GET /me` or the `users` table) → updated to now → AC-9
- [ ] Delete your last remaining rating → Ratings tab shows the normal empty state ("Rate a few movies to see them here") with no leftover count chip → AC-10

## Commands
- [ ] `cd backend && venv\Scripts\python.exe -m unittest test_main_ratings_endpoints -v` → 5 tests pass → AC-3, AC-4, AC-7, AC-9
- [ ] `cd mobile && npx jest hooks/useDeleteRating.test.tsx --testPathPattern "app/\(tabs\)/__tests__/ratings.test.tsx"` (or `npx jest` for the full suite) → all pass → AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-10
- [ ] `cd mobile && npm run typecheck && npm run lint` → clean

## Acceptance-criteria coverage
- AC-1 (trash control on each row) — covered by the UI step and `app/(tabs)/__tests__/ratings.test.tsx`'s "each row shows a delete control" test.
- AC-2 (confirm dialog names the movie, cancel leaves it untouched) — covered by the UI steps and `ratings.test.tsx`'s dialog and cancel tests.
- AC-3 (confirming removes the rating, chip updates) — covered by the UI step, backend `test_delete_own_rating_returns_200_and_status`, and `ratings.test.tsx`'s confirm test.
- AC-4 (only the owner can delete; 404 either way) — covered by backend `test_delete_nonexistent_rating_returns_404` and `test_delete_someone_elses_rating_returns_same_404`.
- AC-5 (Home reflects the change on next view) — covered by `useDeleteRating.test.tsx`'s `["movies"]`-prefix invalidation assertion; still needs the manual UI step since cache invalidation alone doesn't prove the screen re-renders correctly.
- AC-6 (failed delete keeps the row, shows an error) — covered by `useDeleteRating.test.tsx`'s 500 case and `ratings.test.tsx`'s "shows an error and keeps the row" test.
- AC-7 (already-gone treated as success) — covered by `useDeleteRating.test.tsx`'s 404 case.
- AC-8 (Profile/onboarding unchanged) — no new UI was added to either screen; their existing tests still pass unmodified. Worth a manual glance since it's not directly asserted.
- AC-9 (`last_active_at` touched on delete) — covered by backend `test_delete_own_rating_touches_last_active`.
- AC-10 (last rating deleted → empty state, no chip) — covered by `ratings.test.tsx`'s empty-state test, backed by the count-chip condition fix in `ratings.tsx`.

## Known unrelated issue found during this build
`backend/test_main_movies_endpoints.py::RecommendColdStartTests::test_a_qualifying_rating_returns_card_shaped_results` fails on `main` independent of this feature's changes (confirmed: the failure reproduces with delete-rating code present or absent, and the test only exercises `POST /recommend`'s cold-start path in `recommend.py`, which spec 0008 never touches). Spec 0005 (which owns this test file) still shows `Verify it` / `Test it` unchecked in `docs/scope/scope.md` — this looks like a pre-existing gap from that feature, not a regression from spec 0008. Flagged here rather than fixed, since it's out of this spec's scope; likely a `/debug` target under feature 6 (Discover & decide).
