# Verify: notifications · spec 0006 · updated 2026-08-09
_Steps derived from spec 0006 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Rate 5 distinct movies with no mute set → the Home bell shows an unread badge; opening it shows a "New picks for you" row → AC-1, AC-3, AC-4, AC-10
- [ ] Tap the Home bell → navigates to the full notification list screen; tap a notification row → it marks read in place (no navigation away) → AC-10
- [ ] Open the notifications screen with 0 notifications → empty state renders, no "mark all read" action shown → AC-12
- [ ] Open the notifications screen with at least 1 unread notification → "mark all read" is shown; tap it → all rows read, bell badge returns to hidden → AC-6, AC-12
- [ ] Background then foreground the app → the bell's unread count refetches → AC-10
- [ ] Profile: toggle "New recommendations" off, rate 5 movies → no notification appears; toggle back on and rate 5 more → exactly one appears afterward → AC-7, AC-8, AC-11
- [ ] Profile: toggle "Re-engagement nudges" off then on → GET /me's notification_prefs reflects each change immediately → AC-7, AC-11

## Commands
- [ ] Rate 10 distinct movies inside 24h (two threshold crossings) → only one `recommendations_ready` row exists for that window → AC-1
- [ ] Re-rate the same movie 3→4→5 stars in a row → no notification written (only a genuine value change counts) → AC-1
- [ ] Call `run_re_engagement_scan(now=X)` twice with the identical `now` → the second call inserts 0 rows (verified live during this build) → AC-2
- [ ] An account created before this migration, never active since, more than 7 days past `created_at` → still appears in the re-engagement scan (backfilled `last_active_at`) → AC-2
- [ ] `POST /me/notifications/{id}/read` with an id belonging to a different user → 404, that user's row remains unread → AC-5
- [ ] `POST /me/notifications/read-all` with 3 unread rows → all 3 get `read_at` set, `unread-count` returns 0 → AC-6
- [ ] `PATCH /me/notification-prefs` with `{"re_engagement": false}` → `GET /me`'s `notification_prefs.re_engagement` is `false`, `recommendations_ready` unchanged → AC-7
- [ ] `PATCH /me/notification-prefs` with an unknown key → 422 → AC-7
- [ ] `GET /me` on an account whose `last_active_at` is more than 7 days old → `last_active_at` updates to now → AC-9
- [ ] Mute `recommendations_ready`, rate 5 movies, then unmute and rate 5 more → no notification during the muted stretch, exactly one after, any earlier rows still present in `GET /me/notifications` → AC-8

## Acceptance-criteria coverage
- AC-1 … threshold/repeat-value/10-ratings command steps
- AC-2 … re-engagement scan idempotency + backfilled-account command steps
- AC-3 … 5-ratings happy path and the notifications-screen list rendering
- AC-4 … unread-count happy path
- AC-5 … wrong-user 404 command step
- AC-6 … mark-all-read command step and UI step
- AC-7 … PATCH happy path, unknown-key 422, and the two Profile toggle UI steps
- AC-8 … mute/unmute command step
- AC-9 … GET /me last_active_at command step
- AC-10 … bell tap, foreground-refetch, and mark-read-in-place UI steps
- AC-11 … the two Profile toggle UI steps
- AC-12 … empty-state and mark-all-read UI steps
