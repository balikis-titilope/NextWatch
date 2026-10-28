# Verify: Mood discovery · no spec (no decision owed) · updated 2026-08-09
_Steps derived from the scope's "Done when" line (`docs/scope/scope.md`, feature 8) — there's no spec's acceptance criteria to number, since this build needed no architecture decision. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open the Mood tab before typing anything → the pulsing "Type anything — 'something cozy' works too" prompt is visible, no results grid
- [ ] Type a mood description (e.g. "something cozy and uplifting") → text appears in the mood text area, placeholder disappears
- [ ] With the mood field empty, "Find Movies" stays disabled and cannot be tapped
- [ ] Move the slider from 0 (Stick to my taste) to 1 (Follow my mood) → the thumb moves smoothly across the track
- [ ] Enter a mood and tap "Find Movies" → the button shows a loading spinner, then a 2-column poster grid of results renders
- [ ] Submit the same mood text once with the slider near 0 and once near 1 → the two result sets are visibly different (taste-anchored vs mood-anchored)
- [ ] Submit a mood likely to return nothing (or stop the backend and submit) → the "No movies matched that mood" empty state renders
- [ ] Stop/break the backend connection and submit → the error state renders with a Retry button; tapping Retry resubmits the same mood/slider values
- [ ] Tap a result poster → navigates to that movie's Movie Detail screen

## Commands
- [ ] `cd mobile && npm run typecheck` → passes clean
- [ ] `cd mobile && npm test` → all suites pass (186+ tests, no regressions)

## Coverage
- Scope "Done when" clause 1 (typing a mood and submitting returns a blended result set) — covered by the "enter a mood and tap Find Movies" and backend-integration steps above.
- Scope "Done when" clause 2 (moving the slider visibly shifts results between taste and mood) — covered by the "slider near 0 vs near 1" step above.
