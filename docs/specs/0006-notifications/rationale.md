# 0006. Notifications — rationale

## Context

`design.md` section 6.4 shows a bell icon on Home with nothing behind it: no trigger, no backend feed, no state, anywhere in `overview.md` or the backend. Scope item 10 (Notifications, Journey 6) exists specifically to decide what a notification is for this product and build the real bell state plus a real notification list.

NextWatch has no social features (no follows, comments, or shared activity) and no watchlist, so there is no natural stream of "something happened" events the way a social app has. Any notification here has to be product generated: something the backend itself decides is worth surfacing, not something one user did to another.

The taste vector recomputes fresh from a user's full rating history on every request (see `overview.md`); there is no stored "current recommendation list" to diff against for free. Detecting "your recommendations changed" therefore needs either a cheap proxy signal or a real recompute on a hot path.

The backend has no deployment configuration at all yet (no `Procfile`, `Dockerfile`, or hosting config), confirmed by `docs/scope/scope.md`'s note that app store and production readiness are deferred; this is still a single, always on process used for development. That shapes what infrastructure is reasonable to add: a new external service or job runner is a heavier lift than the product stage justifies, while an in process solution is proportionate but comes with an explicit limit (it only works as long as the backend stays one process).

The mobile app already has an established pattern for server state (TanStack Query) and a Profile screen with one existing preference toggle (dark mode), which this feature extends rather than invents.

## Options considered

### Option 1: In app notification center, persisted rows written at trigger time (chosen)

A real `notifications` table. Backend code writes one row the moment a trigger fires (a rating pushes the counter over the threshold, or a scheduled scan finds an inactive user). The mobile app polls an unread count on foreground and shows a full history in a dedicated screen.

**Pros**:
- Clean read/unread state and a real, auditable history, the same shape as every other user owned table in this backend (`ratings`, `users`)
- No OS level permission prompt or device token plumbing needed to ship a first version
- Matches the backend's existing direct Postgres access pattern; no new access model to design

**Cons**:
- Only reaches a user while the app is open (see Option 2); a lapsed user who has stopped opening the app never sees the re engagement nudge that exists specifically to reach lapsed users, a real gap this build accepts and records in Follow up

### Option 2: Real push notifications (Expo push service) as the primary delivery mechanism

OS level push while the app is closed, using Expo's push service, device token registration, and a backend send job.

**Pros**:
- Actually reaches a user who has stopped opening the app, which is the one case Option 1 cannot cover
- Expo's push service is the standard, well supported choice for this stack, so the tooling risk is low if built

**Cons**:
- A materially bigger build: a permission prompt flow, a device token table, token refresh and invalidation handling, and a new backend send path, none of which exist today
- Doubles this spec's scope for a first version of a feature whose trigger rules are themselves still unproven

### Option 3: Computed on read, not persisted

`GET /notifications` compares live state (for example, ratings since a client supplied "last seen" marker) against the current moment and derives a result per call, with nothing written to a table.

**Pros**:
- No new write path, no read or unread column to keep consistent

**Cons**:
- No durable history: a user cannot look back at something they already saw and dismissed
- Cost grows with whatever has to be recomputed per request, and re engagement in particular needs a stored "last active" signal regardless, so this does not actually avoid new state, it just avoids the notifications table itself

### Option 4: Infrastructure only, no real triggers yet

Ship the bell, the list, and the read state, wired to a `notifications` table that nothing ever writes to.

**Pros**:
- Smallest possible slice; removes all risk from getting a trigger rule wrong

**Cons**:
- Does not satisfy the scope box's own "done when": "the bell reflects a real unread state and opens a list of real, backend sourced notifications". An always empty list is not a real notification system, it is a UI shell with nothing behind it, the exact problem this journey exists to fix

## Rationale

Option 1 is the right fit for where this product actually is. It gives the bell a real, durable state (the concrete goal in scope item 10) without taking on push infrastructure the app has never needed before, at a stage where the backend itself has no production deployment yet (Context). Option 2 is the correct next step, not this one: it solves a real gap (reaching a lapsed user who has stopped opening the app), but that gap is honestly recorded in Follow up rather than silently absorbed into a bigger, riskier first build. Option 3 was rejected because it does not remove the need for persisted state, the re engagement trigger needs a stored `last_active_at` no matter what, so avoiding a `notifications` table only shifts complexity into recompute logic without any real benefit. Option 4 does not meet the feature's own definition of done.

Within Option 1, the trigger for "new recommendations ready" uses a rating count threshold (every 5 new ratings) rather than a live top N diff, because the taste vector recomputes from scratch on every request (Context): diffing would mean running a full recommend pass inside the `POST /ratings` hot path for every rating, for a signal a simple counter approximates well enough. The re engagement scan runs on an in process APScheduler job rather than an external cron target or Supabase `pg_cron`, because the backend has no deployment or hosting configuration to hang an external trigger off yet (Context), and `pg_cron` would move real application logic (which users to notify) out of the Python codebase and into SQL, breaking from every other piece of business logic in this backend. The explicit cost of that choice, that it only works reliably as a single always on process, is recorded in Consequences and Follow up so it is revisited deliberately rather than forgotten.

## Refinements from the independent cross check

A cross check pass (a different model, read only, reviewing the drafted spec) found several load bearing gaps between the first draft and what `/develop` would actually need, folded into the spec above:

- **Re-rating the same movie repeatedly should not count 5 times.** During design, the simplest rule was chosen ("any successful `POST /ratings` call increments the counter"), reasoned as one code path with no insert/update branch. The cross check pointed out that adjusting a single movie's star rating from 3 to 4 to 5 fires three separate `POST /ratings` calls in the real mobile UI (`profile.tsx`'s `handleRate`), so "any call" lets one movie's re-taps simulate five different ratings. The spec now counts only a true insert or a changed value, closing that gap while keeping the original one-code-path simplicity (the write function just needs to report which case occurred).
- **A counter that sits at 5 after a skipped write would fire on the very next rating.** The original AC only described the reset on a successful write. The spec now resets the counter on every threshold hit, written or not, which also means unmuting never produces an instant backlog notification, a consequence that fell out of the fix rather than needing its own rule.
- **Every account created before this migration would start with `last_active_at` at NULL**, permanently exempting them from the 7 day inactivity scan (`NULL < now() - 7 days` never matches). The migration now backfills it to `created_at`.
- **The atomic increment alone did not make the threshold check atomic.** Only wrapping the read, the write, and the reset in one SQL statement closes the race two concurrent ratings could otherwise hit.

## Evidence: existing schema and endpoints referenced

- `backend/db/import_data.py`: `users` table (`id UUID PRIMARY KEY REFERENCES auth.users(id)`, `country`, `created_at`, plus `onboarding_completed` from migration `0001`) and `ratings` table (`user_id`, `movie_id`, `rating`, `created_at`, upserted with `created_at = now()` on conflict, confirmed by the SQL in `add_rating`)
- `backend/main.py`: `GET /me`, `POST /me/onboarding/complete`, `POST /ratings`, all behind the existing `get_current_user_id` bearer token dependency; no scheduler, background job, or notification related code anywhere in the backend today
- `mobile/hooks/useMe.ts`: the existing `GET /me` query, confirmed as the natural place to piggyback a `last_active_at` touch since it already fires on launch (spec 0004's routing)
- `mobile/app/(tabs)/profile.tsx`: the existing dark mode `Switch` row, confirmed as the pattern the new mute toggles extend
