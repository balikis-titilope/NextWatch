# 0006. Notifications

**Date**: 2026-08-09
**Status**: In Progress

## Summary

This decides what a NextWatch notification actually is and builds the real system behind the bell icon that has sat empty on Home. Two backend triggers write real notifications: five new ratings since the last one ("your picks updated"), and seven days of no activity ("come back and see what's new"). Notifications live in a real database table, are shown in app only (no push notifications yet), and each type can be muted from Profile. The bell shows a real unread count and opens a full history screen.

## Context

See `rationale.md` for the full problem context, the options weighed, and why this shape was chosen over real push notifications, a computed on read approach, and an infrastructure only slice.

## Requirements

**User stories**:
- As a user whose recommendations have meaningfully changed, I want to be told, so I know it is worth opening the app again.
- As a user who has drifted away from the app, I want a gentle nudge back, so I do not forget the app exists.
- As a user, I want to see my notification history and know what is unread, so nothing gets lost.
- As a user, I want to turn off a notification type I do not want, so the app respects my preference.

**Acceptance criteria**:
- **AC-1**: When a user's ratings since their last "recommendations ready" notification reaches 5 (counting only a `POST /ratings` call that inserts a new rating or changes an existing one to a different value, not a repeated call with the same value), the counter reaching 5 always resets it to 0, whether or not a notification actually gets written. A notification is written only if, at that same moment, the user has not muted the type and has not received one in the last rolling 24 hours; a skip (muted or on cooldown) still resets the counter, so the very next rating after a skip does not instantly refire.
- **AC-2**: A daily scheduled job finds users whose `last_active_at` (or `created_at` for an account that has never been active since this migration) is more than 7 days old, who have not received a "re engagement" notification in the last 7 days, and who have not muted that type, and writes one notification row per qualifying user. The scan is expressed as a single set based query, so running it twice in the same window is a no op, not a duplicate write.
- **AC-3**: `GET /me/notifications` returns the authenticated user's most recent 50 notifications, newest first, each with `id`, `type`, `title`, `body`, `read_at`, `created_at`.
- **AC-4**: `GET /me/notifications/unread-count` returns the count of the authenticated user's notifications where `read_at` is null.
- **AC-5**: `POST /me/notifications/{id}/read` sets `read_at` on a notification owned by the authenticated user; calling it again on an already read notification succeeds without error (idempotent); calling it on a notification owned by a different user returns 404.
- **AC-6**: `POST /me/notifications/read-all` sets `read_at` on every currently unread notification owned by the authenticated user in one call.
- **AC-7**: `GET /me` includes `notification_prefs` (booleans per type) in its response; `PATCH /me/notification-prefs` updates one or more type flags for the authenticated user, defaulting both types to enabled for every account.
- **AC-8**: Muting a type stops future notifications of that type from being written for that user; it does not alter or hide notifications of that type already in their history.
- **AC-9**: `GET /me` updates the authenticated user's `last_active_at` to the current time as a side effect of the call, without changing any existing field in its response shape.
- **AC-10**: The Home header bell shows the real unread count (refetched when the app returns to the foreground) and opens a full screen notification list; tapping a notification marks it read.
- **AC-11**: Profile shows two toggles, "New recommendations" and "Re engagement nudges", wired to `notification_prefs`, defaulting to on.
- **AC-12**: The notification list shows an empty state with zero notifications, and shows a "mark all read" action whenever at least one notification is unread.

## Decision

**Chosen option**: Option 1: In app notification center, persisted rows written at trigger time.

Notifications are real, persisted rows written by the backend the moment a trigger fires (a rating count threshold, or a daily inactivity scan), shown only in app (no OS push in this build), with a per type mute the user controls from Profile.

**Implementation skills**: `apscheduler` (`slanycukr/riot-api-project`, `backend/.agents/skills/apscheduler/`)

## Rationale

See `rationale.md` for the full comparison against real push notifications, a computed on read approach, and an infrastructure only slice, and why the rating count threshold and the in process scheduler were chosen over their alternatives.

## Feature design

**Data model sketch**:

`users` (existing table, extended):
- `id UUID PRIMARY KEY` (existing, references `auth.users`)
- `country`, `created_at`, `onboarding_completed` (existing, unchanged)
- `last_active_at TIMESTAMPTZ NULL` (new; touched by `GET /me` and by `POST /ratings`; backfilled to `created_at` for every existing row in the migration, so no pre-existing account starts permanently exempt from AC-2)
- `ratings_since_rec_notif INT NOT NULL DEFAULT 0` (new; incremented atomically by `POST /ratings`)
- `notification_prefs JSONB NOT NULL DEFAULT '{"recommendations_ready": true, "re_engagement": true}'` (new)

`notifications` (new table):
- `id BIGSERIAL PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `type TEXT NOT NULL` (application level enum: `"recommendations_ready"` or `"re_engagement"`, validated in Pydantic, not a Postgres `ENUM`, so a third type later is a code change, not a migration)
- `title TEXT NOT NULL`
- `body TEXT NOT NULL`
- `payload JSONB NULL` (reserved, unused this build; a future type may carry structured data such as a `movie_id`)
- `read_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Indexes: `(user_id, created_at DESC)` for the list query; a partial index on `user_id WHERE read_at IS NULL` for the unread count query

Cardinality: `users` 1:N `notifications`. No change to `ratings` or `movies`.

Landing spot: both `db/migrations/0003_notifications.sql` (the existing database upgrade path) and `import_data.py`'s `CREATE_TABLES_SQL` (the fresh database path) need these columns and this table, matching this backend's existing dual pattern (confirmed by migrations `0001` and `0002`, which only cover the upgrade path because `country`/`onboarding_completed` predate this rule being made explicit). The new notification read/write functions belong in `db/import_data.py`, alongside `add_rating` and `get_user_ratings`, following the existing per call `get_connection()` pattern.

**State transitions**:

A notification is created unread (`read_at` null) and moves to read exactly once (`read_at` set to the time it was marked read). No other states; nothing reverts a notification from read back to unread.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/me/notifications` | GET | none | array of `{id, type, title, body, read_at, created_at}`, max 50, newest first | bearer | 401 |
| `/me/notifications/unread-count` | GET | none | `{count: int}` | bearer | 401 |
| `/me/notifications/{id}/read` | POST | `id` (path) | `{status: "ok"}` | bearer | 401, 404 (not found or not owned) |
| `/me/notifications/read-all` | POST | none | `{status: "ok", marked: int}` | bearer | 401 |
| `/me` (extended) | GET | none | existing fields plus `notification_prefs: {recommendations_ready: bool, re_engagement: bool}`; touches `last_active_at` | bearer | 401 |
| `/me/notification-prefs` | PATCH | one or both of `recommendations_ready: bool`, `re_engagement: bool`, extra keys rejected (partial update, a body with neither key is a no op that returns the current prefs unchanged) | the updated `notification_prefs` object | bearer | 401, 422 (unknown key or wrong type) |
| `/ratings` (existing, modified) | POST | unchanged (`movie_id`, `rating`) | unchanged, plus the trigger side effect described in AC-1; also touches `last_active_at` | bearer | unchanged (400 invalid rating) |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `POST /ratings` | whether this call counts toward the threshold | whether the upsert inserted a new row or changed an existing rating's value (the write function returns this; a repeated call with the identical value does not count), not just "the call succeeded" |
| `POST /ratings` | whether to write a `recommendations_ready` row, in one atomic SQL statement (a CTE: `UPDATE ... RETURNING` the new counter, feeding a conditional `INSERT ... WHERE NOT EXISTS` for a recent row of that type, feeding the counter reset) | `users.ratings_since_rec_notif` compared to the threshold 5; `users.notification_prefs.recommendations_ready`; the most recent `recommendations_ready` row's `created_at` (must be absent or over 24h old); see AC-1 for the reset rule on a skip |
| `POST /ratings` (and `GET /me`) | `last_active_at` value written | the server clock (`now()`) at request time; touched from both call sites so a resident app session that only rates, and never refires `/me`, still updates it |
| Daily scheduler job | which users are "inactive 7+ days" and whether to skip a qualifying user, in one set based `INSERT ... SELECT ... WHERE NOT EXISTS` statement (no separate select-then-decide steps, so a duplicate run of the job is a no op) | `COALESCE(users.last_active_at, users.created_at)` compared to `now() - interval '7 days'`; `users.notification_prefs.re_engagement`; the most recent `re_engagement` row's `created_at` (must be absent or over 7 days old) |
| `GET/POST` notification writes | the `title`/`body` text stored on the row | a fixed per type copy table in backend code (decided here, not user input): `recommendations_ready` → "New picks for you" / "Your recommendations just updated based on your recent ratings."; `re_engagement` → "Ready when you are" / "Your next favorite movie might already be waiting." |
| Mobile bell badge | unread count shown, and its display rule | `GET /me/notifications/unread-count`, itself `COUNT(*) WHERE read_at IS NULL`; hidden entirely at 0, shown as the number up to 99, shown as "99+" beyond that |
| Mobile notification tap | what happens after marking read | marks it read in place on the list (no navigation away); navigating out would undercut the mark-all-read affordance in AC-12 |
| Mobile unread-count refetch | when it refetches | `focusManager` wired to React Native's `AppState` in `lib/queryClient.ts` (the real TanStack Query mechanism for a foregrounded app, not a named option that does not exist in the library) plus `refetchOnWindowFocus: true` on the query itself |

**Key invariants**:
- The threshold check, the notification insert, and the counter reset happen in one atomic SQL statement, never a separate read then decide then write in application code, so two ratings submitted close together cannot both cross the threshold and both write a row (closes a race the increment alone does not).
- The counter always resets to 0 the moment it reaches 5, whether or not a notification actually gets written that time. A skip (muted, or still in the 24h cooldown) does not leave the counter sitting at 5, so the next single rating after a skip requires 5 more ratings, not just one, before checking again. A practical effect: unmuting a type does not create an instant notification on the next rating, since the counter was already being reset on every threshold hit while muted, not accumulating a backlog.
- At most one `recommendations_ready` notification per user per rolling 24 hours.
- At most one `re_engagement` notification per user per rolling 7 day window (the scheduler checks the last such row's `created_at`, not just `last_active_at`, so a user who stays inactive is not renotified every day the job runs).
- `notification_prefs` always has both keys present for every account (enforced by the column default; a missing key at read time falls back to `true` via `COALESCE`; `PATCH` merges only the keys given into the existing object rather than replacing it, and rejects an unknown key with 422 rather than silently ignoring it).
- Muting a type only prevents future writes of that type; it never touches existing rows (AC-8).
- A failure while writing a notification (the trigger check, or the write itself) never fails the `POST /ratings` request that triggered it: the notification side effect runs after the rating write commits, and any error in it is logged, not raised, so a rating is never lost because a notification failed to write.

**Security model**:
Every endpoint requires the existing Supabase JWT (`get_current_user_id` dependency) and scopes its query by the authenticated `user_id`, identical to the existing `/me/ratings` pattern; no cross user access anywhere in this surface. The scheduler job runs on the backend's own direct Postgres connection (the same `DATABASE_URL` every other backend module already uses) rather than a per request, per user connection, because it must scan across all users; this introduces no new privilege boundary, the backend already talks to Postgres directly rather than through Supabase's row level security layer. No new sensitive data: notification text contains nothing beyond what the user already owns (their own rating activity).

**Configuration required**:
None. The scheduler runs in process, on a fixed daily time (`CronTrigger(hour=9, timezone="UTC")`, started once in the FastAPI `lifespan` handler); no new environment variable, secret, or third party credential is needed.

**Critical test scenarios**:
- Happy path: rate 5 distinct movies, no mute set → a `recommendations_ready` row exists, `GET /me/notifications/unread-count` returns 1, the row appears in `GET /me/notifications`, verifies **AC-1**, **AC-3**, **AC-4**
- Failure case: rate 10 distinct movies in one sitting (two threshold crossings within the same rolling 24 hours) → only one `recommendations_ready` row exists for that window, verifies **AC-1**
- Failure case: re-tap the same movie's stars 5 times (3, then 4, then 5, and so on) → no notification, since only the first insert and any genuinely changed value count, verifies **AC-1**
- Failure case: call the re engagement scan function twice in a row with the same `now` → the second call writes zero rows, verifies **AC-2**
- Edge case: an account created before this migration, that never touched `GET /me` or `POST /ratings` since, and is more than 7 days past `created_at` → still appears in the re engagement scan (backfilled `last_active_at`), verifies **AC-2**
- Auth/permission: user A calls `POST /me/notifications/{id}/read` with an `id` belonging to user B → 404, user B's row remains unread, verifies **AC-5**
- Happy path: call `POST /me/notifications/read-all` with 3 unread rows → all 3 have `read_at` set, `unread-count` returns 0, verifies **AC-6**
- Happy path: `PATCH /me/notification-prefs` with `{"re_engagement": false}` → `GET /me`'s `notification_prefs.re_engagement` is `false`, `recommendations_ready` is unchanged, verifies **AC-7**
- Edge case: mute `recommendations_ready`, rate 5 movies, then unmute and rate 5 more → no notification during the muted stretch, exactly one after, and any `recommendations_ready` rows written before the mute are still present in `GET /me/notifications`, verifies **AC-8**
- Happy path: sign in on an account whose `last_active_at` is more than 7 days old, call `GET /me` → `last_active_at` updates to now, verifies **AC-9**
- UI: an account with 0 notifications opens the notifications screen → the empty state renders, no "mark all read" action shown; an account with 1 unread notification → the action is shown, verifies **AC-11**, **AC-12**

## Build plan

1. Migration: `db/migrations/0003_notifications.sql` creating `notifications` (with its two indexes) and adding `users.last_active_at` (backfilled to `created_at`), `users.ratings_since_rec_notif`, `users.notification_prefs` with the confirmed defaults; mirror the same table and columns into `import_data.py`'s `CREATE_TABLES_SQL` for the fresh database path, satisfies **AC-1**, **AC-2**, **AC-7**, **AC-9**
2. Backend: in `db/import_data.py`, add the notification read/write functions (list, unread count, mark read, mark all read, the atomic threshold-check-and-write statement, the prefs read/merge, and `run_re_engagement_scan(now=None)` as a plain, directly testable function) following the module's existing per call `get_connection()` pattern
3. Backend: extend `GET /me` to touch `last_active_at` and return `notification_prefs`; add `PATCH /me/notification-prefs` (partial merge, 422 on an unknown key), satisfies **AC-7**, **AC-9**
4. Backend: modify `POST /ratings` to touch `last_active_at` and run the atomic threshold check from Value sourcing (only a true insert or changed value counts), satisfies **AC-1**, **AC-8**, **AC-9**
5. Backend: add `GET /me/notifications`, `GET /me/notifications/unread-count`, `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`, satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**
6. Backend: wire APScheduler (per the installed `apscheduler` skill's conventions) in the FastAPI `lifespan` handler, `CronTrigger(hour=9, timezone="UTC")`, calling `run_re_engagement_scan()` from task 2, satisfies **AC-2**, **AC-8**
7. Mobile: add `notification_prefs` to the `Me` type in `types/api.ts`; add `useNotifications` hooks (list, unread count, mark read, mark all read, notification prefs read and update); wire `focusManager` to `AppState` in `lib/queryClient.ts` and set `refetchOnWindowFocus: true` on the unread count query, supports **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-9**, **AC-10**
8. Mobile: wire the Home header bell to the real unread count (hidden at 0, capped display at "99+"), make it pressable, and navigate to the new notifications screen on tap; register `app/notifications.tsx` as a `Stack.Screen` in the root `_layout.tsx` with a back header, satisfies **AC-10**
9. Mobile: build `app/notifications.tsx` (list rows: unread dot, title, body, relative timestamp; empty state; mark all read action shown only when at least one row is unread; tapping a row marks it read in place, no navigation), satisfies **AC-3**, **AC-5**, **AC-6**, **AC-10**, **AC-12**
10. Mobile: add the two mute toggles to Profile, wired to `notification_prefs` via the PATCH endpoint, satisfies **AC-7**, **AC-8**, **AC-11**

## Consequences

**Positive**:
- The bell finally reflects real state instead of sitting inert; the scope box's stated "done when" is met
- The re engagement trigger gives the product its first retention lever
- The type system (an open text column plus a code level enum) makes adding a third notification type later a code change, not a migration

**Negative / tradeoffs**:
- No push notifications yet: a user who has stopped opening the app cannot be reached by the re engagement nudge that exists specifically to reach them; this is a known, accepted gap, not an oversight (see Follow up)
- The APScheduler job only runs reliably as long as the backend stays a single always on process; it does not survive a restart mid cycle gracefully beyond re running on next boot, and does not work at all if the backend ever moves to multiple instances or a serverless deployment
- Two new counters live on `users` (`ratings_since_rec_notif`, `last_active_at`) that only the app's own code paths keep correct; a manual database edit that bypasses the app would desynchronize them, the same exposure every other denormalized field on this table already has

**Neutral**:
- Adds a new Python dependency, `apscheduler`, the first scheduled or background job anywhere in this backend
- Adds three columns to `users` via migration, following the same pattern as the existing `country` and `onboarding_completed` migrations

## Follow-up

- [ ] Real push notifications (Expo push service) are the natural next spec once this in app system ships; they close the one gap this build accepts (reaching a user who has stopped opening the app)
- [ ] A rating milestone notification type ("you've rated 10 movies") was raised during design and deferred as closer to gamification than the product's "decide fast" ethos; revisit only if requested
- [ ] The in process APScheduler job does not survive a multi instance or serverless deployment; revisit the scheduling mechanism (an external scheduled trigger, or a managed scheduler) if and when the backend's hosting changes from a single always on process
- [ ] The `apscheduler` community skill was installed to `backend/.agents/skills/apscheduler/`; the backend has no `AGENTS.md` yet to point to it (out of scope for this workflow per the root `AGENTS.md` `## Rules`), so there is nowhere to record this pointer today. Flag for whenever the backend is brought into scope for documentation.
