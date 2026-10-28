# Account deactivation and deletion

## Summary

Lets a signed in user request their account be deleted, from Profile in the app, or from a web page that needs no app installed. The account is deactivated right away and permanently removed 30 days later by a daily background job, giving a real recovery window while still satisfying both stores' requirement that deletion actually happens. Logging back in during the window offers to reactivate instead of deleting.

## Requirements

**User stories**:
- As a signed in user, I want to delete my account and its data from Profile, with a clear warning before it happens.
- As a user who changes their mind, I want logging back in within 30 days to offer reactivation instead of losing my account.
- As a user who no longer has the app installed, I want a web page where I can still request deletion.

**Acceptance criteria**:
- **AC-1**: Profile has a "Delete account" action, separate from Sign Out, that requires reentering the account password and typing the word `DELETE` before anything happens.
- **AC-2**: Confirming sets `users.deactivated_at` to the current time, signs the account out everywhere (every device, not just this one), and returns the app to the signed out state with a message explaining the 30 day window.
- **AC-3**: While `deactivated_at` is set, every other write endpoint (rating a movie, updating notification preferences, and so on) rejects the request with 403, even if the client is bypassed. Reads stay open to whatever access token the client already holds; see the Key invariants note on why this bounded exposure is accepted rather than gated.
- **AC-4**: Logging back in while `deactivated_at` is set does not go straight to the tabs; it shows a reactivate prompt first.
- **AC-5**: Choosing to reactivate clears `deactivated_at` and proceeds into the app normally; choosing not to leaves the account signed out and still scheduled for deletion.
- **AC-6**: `GET /legal/delete-account` serves a plain web form (email and password) with no login required; submitting it performs the same deactivation as AC-2, for an account the user cannot otherwise reach because the app is not installed.
- **AC-7**: A daily job permanently removes any account whose `deactivated_at` is more than 30 days old: the Supabase Auth user, the `users` row, and (via cascade) every `ratings` and `notifications` row for that account.
- **AC-8**: A deactivated account is excluded from the re engagement and recommendations ready notification scans (spec 0006), since it should not receive notifications during its grace period.
- **AC-9**: `POST /legal/delete-account` is rate limited per IP address, since it is a public, unauthenticated endpoint that checks a password, the same shape as a login endpoint.

## Decision

**Chosen option**: deactivate immediately (`users.deactivated_at`), hard delete via a daily purge job after 30 days, with the web form as a second entry point into the exact same deactivation logic. Full comparison against an immediate hard delete and against a support email based web path: see [rationale.md](../rationale.md) (basis: Apple's guideline explicitly permits a grace period; Google Play's policy requires deletion to actually happen and requires a web reachable path, see spec 0009's References).

## Feature design

**Data model sketch**:
- `users` (existing table, `backend/db/import_data.py`): add `deactivated_at TIMESTAMPTZ NULL`. `NULL` means active; a timestamp means deletion was requested at that time.
- `ratings` (existing): its `user_id` foreign key gains `ON DELETE CASCADE`, so a `users` row delete removes the account's ratings automatically.
- `notifications` (existing): its `user_id` foreign key gains `ON DELETE CASCADE`, same reasoning.
- No new tables. Migration `backend/db/migrations/0004_account_deactivation.sql`.

**State transitions**:
active → deactivated (user confirms deletion, in app or via the web form) → either reactivated → active (user logs back in within 30 days and chooses to reactivate), or purged (the daily job removes the account after 30 days, terminal, no further transition).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/me/deactivate` | POST | `password: string`, `confirm: string` (must equal the literal word `"DELETE"`) | `{status: "deactivated"}` | bearer | 401 wrong password, 400 confirm mismatch |
| `/me/reactivate` | POST | none | `{status: "active"}` | bearer | 409 if not currently deactivated |
| `/legal/delete-account` | GET | none | an HTML form | none (public) | none expected |
| `/legal/delete-account` | POST | `email: string`, `password: string` (form encoded) | an HTML confirmation page | none (public); the form itself carries the password as the credential; rate limited per IP, see **AC-9** | 401 wrong credentials, rendered as a form error, not a raw HTTP error page; 429 when rate limited |
| `/me` (existing, extended) | GET | none | adds `deactivated_at: string \| null` to the existing response | bearer | none new |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `POST /me/deactivate` | which account to deactivate | the bearer token via `get_current_user_id`, the same pattern every other authenticated endpoint uses |
| `POST /me/deactivate` | whether the password is correct | `backend/auth.py`'s existing `sign_in(email, password)`, reused rather than a second password check; the account's email comes from `get_current_user_email`, already used for Profile display |
| `POST /me/deactivate` | signing out every device | Supabase's `POST /auth/v1/logout?scope=global`, the same call `finish_password_reset` (spec 0007) already makes with `scope=others`, widened to `global` here since the whole point of this action is to sign the account out everywhere, not just elsewhere |
| Reactivate prompt (AC-4) | whether to show it | `GET /me`'s new `deactivated_at` field, checked by the app's existing launch routing right after a successful login, alongside the onboarding check spec 0004 already added there |
| `POST /legal/delete-account` | which account to deactivate | `sign_in(email, password)` resolves the account and confirms the credential in one call; the returned user id feeds the same deactivation logic `POST /me/deactivate` uses |
| Daily purge job | which accounts are due | `SELECT id FROM users WHERE deactivated_at IS NOT NULL AND deactivated_at <= now() - interval '30 days'` |
| Daily purge job | removing the Supabase Auth user | Supabase's Admin API, `DELETE /auth/v1/admin/users/{id}`, authenticated with the new `SUPABASE_SERVICE_ROLE_KEY`; `users`, `ratings`, and `notifications` rows are removed automatically by the cascades this spec adds; a per account failure (the Admin API call errors) is caught and logged, the job moves on to the next candidate rather than aborting the run, matching how `finish_password_reset` in `backend/auth.py` already logs rather than raises on a non fatal step |
| Daily purge job | when it runs | added to the existing `AsyncIOScheduler` in `main.py`'s `lifespan` with `CronTrigger(hour=3, timezone="UTC")`, distinct from spec 0006's re engagement job at `hour=9` so the two never overlap |
| Server side gate (AC-3) | which endpoints check `deactivated_at` | every write endpoint currently behind `get_current_user_id` except `/me/deactivate` and `/me/reactivate` themselves, via a new dependency `get_current_active_user_id` that wraps `get_current_user_id` with a `deactivated_at IS NULL` check. `GET /me` and `POST /auth/refresh` stay on the plain `get_current_user_id` (no gate), since a deactivated account still needs both to reach the reactivate prompt. There is no backend logout endpoint to exempt: mobile sign out is purely local (clearing stored tokens), never a server call |
| `POST /legal/delete-account` rate limit (AC-9) | the per IP request cap | `slowapi`, added fresh for this endpoint (not reused from spec 0007, whose limiter on `/auth/request-password-reset` was removed at the user's request per that route's own docstring in `backend/main.py`); a starting limit of 5 requests per IP per hour, the same order of magnitude as a typical login rate limit |
| Notification scans excluding deactivated accounts (AC-8) | which users the re engagement and threshold checks consider | add `AND deactivated_at IS NULL` to the existing queries in `backend/db/import_data.py` behind spec 0006's `run_re_engagement_scan` and the ratings threshold check |

**Key invariants**:
- A user can only deactivate or reactivate their own account; identity always comes from a verified bearer token or, on the web form, from a freshly verified password, never a client supplied id.
- Deactivation always requires the current password, both in app and on the web form; there is no way to delete an account with only a stolen session token.
- The purge job never removes an account whose `deactivated_at` is `NULL` or less than 30 days old.
- Reactivation only clears `deactivated_at`; it never touches ratings, notifications, or any other data, since none of it was removed during the grace period.
- Global logout revokes Supabase refresh tokens, not the access token (a short lived JWT) the client already holds; `verify_token` in `backend/auth.py` only checks the JWT's signature and expiry, not a server side revocation list. This means a deactivated account's already issued access token can still call read endpoints until it naturally expires. This is an accepted, time bounded exposure (bounded by the token's own short lifetime), not a gap to gate away; gating every read endpoint for a window this small is not worth the added surface area.

**Security model**:
Ownership only, no roles. Deactivation and reactivation require a valid bearer token identifying the account being changed; the web form requires the account's real password, the same trust level as logging in. The purge job runs with the backend's own elevated credentials (the new service role key), never exposed to any client. This flow is the app's GDPR/CCPA style right to deletion mechanism; treat `SUPABASE_SERVICE_ROLE_KEY` with the same care as any other credential in `backend/.env` (never logged, never sent to the client, per `mobile/AGENTS.md` §12's existing secret handling rules).

**Configuration required**:
- `SUPABASE_SERVICE_ROLE_KEY`: the backend's Supabase service role key, used only by the purge job to hard delete an Auth user via the Admin API. Add to `backend/.env`, never to any `EXPO_PUBLIC_` variable.
- `slowapi` added to `backend/requirements.txt`, applied to `POST /legal/delete-account` only.

**Critical test scenarios**:
- Happy path: a user deactivates from Profile with the correct password and confirmation word, sees the 30 day message, and is signed out, verifies **AC-1**, **AC-2**
- Failure case: deactivation with the wrong password is rejected and nothing changes, verifies **AC-1**
- Auth/permission: a write to any protected endpoint while deactivated returns 403, verifies **AC-3**
- Reactivation: logging back in within the window shows the reactivate prompt; choosing to reactivate clears `deactivated_at` and proceeds normally, verifies **AC-4**, **AC-5**
- Web path: submitting the correct email and password to `POST /legal/delete-account` deactivates the account exactly as the in app flow does, verifies **AC-6**
- Purge: an account deactivated 31 days ago is removed entirely (Auth user, `users`, `ratings`, `notifications`) by the next run of the daily job; one deactivated 10 days ago is untouched, verifies **AC-7**
- Purge failure isolation: one account's Admin API delete failing does not stop the job from purging the other due accounts in the same run, verifies **AC-7**
- Notification exclusion: a deactivated account does not receive a re engagement or recommendations ready notification during its grace period, verifies **AC-8**
- Rate limit: repeated requests to `POST /legal/delete-account` from the same IP past the configured cap return 429, verifies **AC-9**

## Build plan

1. Migration `0004_account_deactivation.sql`: add `users.deactivated_at`, add `ON DELETE CASCADE` to `ratings.user_id` and `notifications.user_id`, satisfies **AC-2**, **AC-7**
2. Backend: `deactivate_account(user_id)` and `reactivate_account(user_id)` in `backend/db/import_data.py`; `POST /me/deactivate` (password check via `sign_in`, confirmation word check, global logout call) and `POST /me/reactivate` in `backend/main.py`; extend `GET /me` with `deactivated_at`, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**
3. Backend: `get_current_active_user_id` dependency, swapped in for `get_current_user_id` on every existing protected write endpoint except deactivate and reactivate (`/me` and `/auth/refresh` stay on the plain dependency), satisfies **AC-3**
4. Backend: exclude deactivated accounts from spec 0006's re engagement scan and ratings threshold check queries, satisfies **AC-8**
5. Backend: `GET`/`POST /legal/delete-account`, the public HTML form and its handler, reusing `deactivate_account` after a `sign_in` credential check, with `slowapi` rate limiting `POST /legal/delete-account` to 5 requests per IP per hour, satisfies **AC-6**, **AC-9**
6. Backend: the daily purge job, added to the existing `AsyncIOScheduler` in `main.py`'s `lifespan` at `CronTrigger(hour=3, timezone="UTC")` (distinct from spec 0006's re engagement job at `hour=9`), calling the Supabase Admin API with `SUPABASE_SERVICE_ROLE_KEY`, logging and continuing past any single account's failure, satisfies **AC-7**
7. Mobile: "Delete account" action on Profile, a confirm screen requiring the password and the confirmation word, calling `POST /me/deactivate`, then clearing local session and routing to the auth stack with the 30 day message, satisfies **AC-1**, **AC-2**
8. Mobile: extend the launch and post login routing (`mobile/app/_layout.tsx` / `mobile/app/index.tsx`, alongside spec 0004's existing onboarding check) to read `deactivated_at` from `GET /me` and show the reactivate prompt before entering the tabs, wired to `POST /me/reactivate`, satisfies **AC-4**, **AC-5**

## Consequences

**Positive**: the app gains a real, storeable account deletion path with a genuine recovery window; the schema's previously missing cascade behavior on `ratings` and `notifications` is fixed as a side effect.

**Negative / tradeoffs**: every existing protected write endpoint needs its dependency swapped from `get_current_user_id` to `get_current_active_user_id`, a small but wide touch across `backend/main.py`; the web deletion form is a new public facing surface guarded only by the account's own password, the same trust level as login, now rate limited for that reason; a deactivated account's already issued access token stays valid for reads until it naturally expires, a small accepted exposure rather than something this spec gates away.

**Neutral**: adds one new secret (`SUPABASE_SERVICE_ROLE_KEY`), one new dependency (`slowapi`), and one new daily job to the existing scheduler.

## Follow-up

- [ ] No confirmation email is sent on deactivation or purge in this pass (the engineer chose in app confirmation only, to keep scope tight); revisit if a user later disputes losing access to a purged account.
