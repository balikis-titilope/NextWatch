# 0004. Relaunch Routing and Onboarding Completion Tracking

**Date**: 2026-08-08
**Status**: In Progress

_Decision history (context, options considered, rationale) is in [`rationale.md`](rationale.md). This file holds the build spec: the decision, the design, and the build plan._

_Revised after an independent cross check (a different model, read only critique): closed gaps around token storage and persistence, the refresh error contract, mid session logout, post login/signup routing, missing account rows, the launch timeout, retry counts, a refresh recursion guard, splash timing, cache invalidation, and backend naming. See the inline notes below for what changed and why; the cross check's full report is not stored, its fixes are folded directly into this spec._

_Updated 2026-08-08 to add required email confirmation before login: a code sent by email, a confirm email screen, resend, and the distinguishable error when logging in before confirming. See AC-8 (revised) and AC-12 through AC-16, the new endpoints in the API surface, and build tasks 11 through 19._

## Summary

When someone reopens the app with a saved login, the app has to decide, before showing anything, whether to send them to sign in, into onboarding, or straight to the main app. This spec adds one new field on the account record that remembers whether someone has finished or skipped onboarding, and defines exactly how the app checks it at launch, quietly renews an expired login using the saved refresh credential, and falls back to the sign in screen if the saved login can't be renewed or can't be reached. It also defines the small backend pieces this needs, since the backend has no such tracking today, and the token storage layer the mobile app doesn't have yet either.

This spec now also covers what happens right before any of that: NextWatch requires a new account to confirm its email address with a short numeric code before it can sign in. A new screen collects that code, a resend action asks for a new one, and trying to log in before confirming shows a clear message with a way forward instead of a plain wrong password error.

## Requirements

**User stories**:
- As a returning user with a valid saved login who has already been through onboarding, I want the app to go straight to Home, so I don't see onboarding again.
- As a new user who just signed up, I want to see onboarding, so I can rate movies I like before the app recommends anything.
- As a user who tapped Skip, I want the app to never show onboarding again, even if I never rated a single movie, so it doesn't nag me every time I open the app.
- As a returning user whose saved login has quietly expired, I want the app to renew it in the background if it still can, so I don't have to log in again for no reason.
- As a user whose saved login can't be renewed (it was revoked or has fully expired), I want to be sent to the sign in screen, so I can get back into my account.
- As a user with no internet connection at launch, I want the app to fall back to the sign in screen without throwing away a login that might still be valid, so a temporary connectivity problem doesn't force me to re-enter my password once I'm back online.
- As a new user who just signed up, I want to confirm my email with a code sent to me, so the app knows the address is really mine before I can use it.
- As a new user who mistyped their email or didn't get the code, I want to ask for a new one, so I'm not stuck unable to confirm.
- As a returning user who signed up but never confirmed, I want a clear explanation when I try to log in and a way to finish confirming, so I'm not just told my password is wrong.

**Acceptance criteria** (the contract, each independently checkable):
- **AC-1**: On launch, if no refresh credential is stored on the device, the app routes to `(auth)` without making any network call. (Keyed on the refresh credential, not the shorter lived access token, since a device can validly hold a refresh credential with no current access token.)
- **AC-2**: On launch, if the stored login resolves (directly, or after a silent renewal), the app routes to `onboarding` when the account's onboarding is not yet complete, and to `(tabs)` when it is.
- **AC-3**: If the stored access token is missing, expired, or rejected (401), and a stored refresh credential exists, the app quietly exchanges it for a new access and refresh credential pair and retries the check once before deciding the route; the user never sees the sign in screen for this case.
- **AC-4**: If renewing the login is explicitly rejected (the refresh credential itself is invalid, expired, or revoked), the app clears both stored credentials and routes to `(auth)`.
- **AC-5**: Tapping Skip or Done on the onboarding screen marks that account's onboarding as complete. Calling this more than once has no extra effect (it is safe to retry), including for an account whose backend profile row doesn't exist yet. The app moves on to `(tabs)` immediately without waiting for this to finish; if it fails, it retries a bounded number of times in the background, and if it never succeeds, onboarding may show one more time on a later launch (an accepted, rare edge case, not a silent data loss), and this background retry never forces the user back to the sign in screen even if it fails.
- **AC-6**: If several requests hit an expired or rejected login at the same moment, only one renewal attempt fires; the rest wait for that one result (and either resume with the new credential, or fail the same way, together) instead of each starting their own renewal.
- **AC-7**: While the app is resolving the launch decision (checking the token, fetching onboarding status, possibly renewing the login), the splash screen stays visible with no intermediate blank frame. The whole resolution is bounded by one fixed total timeout (not a separate timeout per network call); if it isn't resolved within that time, the app cancels whatever is in flight and routes to `(auth)` without clearing the stored credentials, since a timeout means "couldn't confirm," not "confirmed invalid."
- **AC-8**: A freshly signed up account always starts with onboarding not complete. If email confirmation succeeds immediately as part of signup (no confirmation required, or the account was already confirmed), the app routes straight into onboarding right after signup, without a separate launch check. If email confirmation is required, the app routes to the confirm email screen instead, and only reaches onboarding once the code is confirmed (see AC-13).
- **AC-9**: A returning user who logs in (not just relaunches) is routed by the same onboarding_completed check as the launch path, so signing in on a new device or after a reinstall goes straight to `(tabs)` when onboarding was already completed on another device, and to `onboarding` otherwise.
- **AC-10**: If the launch check fails for a reason that isn't an explicit rejection of the credential (no connectivity, a backend 5xx, a timeout), the app routes to `(auth)` without clearing the stored credentials, so a later launch with connectivity can resolve normally instead of forcing a fresh login over a problem that had nothing to do with the login itself.
- **AC-11**: A request retried with a freshly renewed credential that still gets a 401 is treated as terminal, not retried again: the app clears the stored credentials and routes to `(auth)`. The app never enters a repeating renewal loop.
- **AC-12**: When signup requires email confirmation, the app shows the confirm email screen with the address just entered, and stores no access or refresh credential yet (none exist until confirmation succeeds).
- **AC-13**: Entering the correct confirmation code on the confirm email screen signs the account in (stores the returned access and refresh credential, same as a signup that needed no confirmation) and routes to onboarding, the same destination AC-8 defines.
- **AC-14**: Entering an incorrect or expired code shows an inline error naming the problem; the user can try again or request a new code without leaving the screen.
- **AC-15**: Requesting a new code is available on the confirm email screen with a short client side cooldown after each request, and the server enforces its own rate limit; a request made too soon shows a clear "wait a bit" message rather than a generic error.
- **AC-16**: Attempting to log in with an account whose email is not yet confirmed shows a message distinguishing this from a wrong email or password, with a way to reach the confirm email screen for that address; a fresh code is sent automatically on arriving there, so the user isn't left guessing whether to tap Resend.

## Decision

**Chosen option**: Option 1: A server side completion flag, checked at launch and at login, backed by a renewal check that runs everywhere in the app, not only at launch (see [`rationale.md`](rationale.md) Option 1).

**Implementation skills**: `tanstack-query` (`tanstack-skills/tanstack-skills`, `.agents/skills/tanstack-query/`)

## Rationale

See [`rationale.md`](rationale.md) for the full reasoning. In short: nothing already stored (ratings history) can tell apart "skipped onboarding on purpose" from "never opened the app," so a dedicated flag is the only reliable signal; keeping it on the backend, not the device, is what makes it survive a reinstall or a new device, matching how every other piece of account state already works.

This update decides one more thing: how email confirmation itself works. A numeric code (an OTP, one time password) typed into the app, not a tap through link, since the app is universal (iOS, Android, and Web per `AGENTS.md`) and a tap through link needs platform associated domain files this project doesn't have; the code works identically everywhere with no extra setup. See `rationale.md`, Option 4.

## Feature design

**Data model sketch**:
- `users` (existing table, extended, one new field):
  - `id`: UUID, primary key, references `auth.users` (unchanged)
  - `onboarding_completed`: boolean, not null, default `false` (**new**). Only ever moves `false` to `true`; nothing sets it back.

No new tables, no new relationships.

**State transitions** (launch routing decision, resolved once per app open; the resolution runs alongside font loading in `app/_layout.tsx`, not after it, and the splash screen stays up until both are done, see build task 8):

```
App launch (splash visible)
  |
  no refresh credential stored -----------------------------------------------> route to (auth), no network call [AC-1]
  |
  refresh credential stored:
       |
       stored access token present AND locally decoded as not expired
       (base64 decode of the JWT payload's `exp` claim, ~60s safety margin;
        no new dependency, no network call needed just to check this)
             |
             call GET /me
                  succeeds -----------------------------------------------------> route by onboarding_completed [AC-2]
                  401 -----------------------------------------------------------> go to "renew" below
                  network/5xx error ----------------------------------------------> route to (auth), keep credentials [AC-10]
       |
       access token missing, or locally decoded as expired/about to expire
       -> skip the doomed call above, go straight to "renew" below
  |
  renew: POST /auth/refresh
       explicit reject (Supabase says the credential itself is bad) ------------> clear credentials, route to (auth) [AC-4]
       network/5xx error (Supabase or the backend is just unreachable) ---------> route to (auth), keep credentials [AC-10]
       succeeds -> persist the new access AND refresh credential atomically
                   (Supabase rotates the refresh credential on every use;
                   the old one stops working, so both must be saved together
                   before anything else proceeds)
                -> retry GET /me once, marked "no further renewal on 401"
                      succeeds --------------------------------------------------> route by onboarding_completed [AC-2, AC-3]
                      401 (renewal itself didn't fix it) -----------------------> terminal: clear credentials, route to (auth) [AC-11]
                      network/5xx error ----------------------------------------> route to (auth), keep credentials [AC-10]
  |
  total resolution time exceeds the fixed timeout (8 seconds, one shared
  AbortController for whatever step is in flight) -----------------------------> cancel in flight work, route to (auth),
                                                                                   keep credentials [AC-7, AC-10]
```

**Signup and email confirmation** (the path that leads into the diagram above; a confirmed session enters at its top):

```
Signup form submitted -> POST /auth/signup
  |
  status: "ok" (confirmation off, or the account was already confirmed) -> store credentials,
                                                                              route to onboarding [AC-8]
  |
  status: "confirmation_required" -> route to confirm email screen, no credentials stored [AC-12]
       |
       user enters the code -> POST /auth/verify-signup
            correct, not expired -----------------------------> store credentials, route to onboarding [AC-13]
            incorrect or expired -----------------------------> inline error, stay on screen [AC-14]
       |
       user asks for a new code -> POST /auth/resend-confirmation
            accepted -------------------------------------------> new code sent, cooldown starts [AC-15]
            rate limited (Supabase returns 429) -----------------> "wait a bit" message, no new code sent [AC-15]

Login attempt on an unconfirmed account -> POST /auth/login
     Supabase's "email not confirmed" error -> distinguishable message + link to confirm email screen,
                                                 autoResend=true fires one POST /auth/resend-confirmation
                                                 on arrival so a code is already on its way [AC-16]
     (a relaunch before confirming has no stored refresh credential yet, so it lands on the sign in screen
     per AC-1, not back on the confirm email screen; that screen is only reached from a live signup or
     login attempt, never resumed automatically, and always with a real email; reached with no email
     param -> redirect to (auth)/login, not a blank screen)
```

Separately, once the app is past launch: any authenticated request that gets a 401 triggers the same renewal step, deduplicated so concurrent 401s share one in-flight renewal rather than racing separate ones (AC-6). A request that never carried a stored credential in the first place (an intentionally anonymous call) is not treated as a session failure; its 401 passes straight back to the caller untouched. A successful renewal here resumes every waiting request with the new credential; an explicit rejection here clears the session and the root layout, which watches the session state, routes the user back to `(auth)` (see build task 6). A network/5xx failure here is surfaced to the caller as a normal failed request (through the app's existing TanStack Query error handling, spec [0003](../0003-error-monitoring-product-analytics/index.md)); it does not clear the session, matching AC-10's launch time behavior. The one exception: the onboarding completion call from AC-5 never triggers this forced navigation on renewal failure, even though it goes through the same `apiFetch`, since AC-5 already treats that call's failure as low stakes and a background write should never yank a user who has already moved on to `(tabs)` back to the sign in screen.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/me` | GET | none (identity from bearer token) | `user_id`, `onboarding_completed` | bearer | 401 invalid/expired/missing token; 503 if the database itself is unreachable |
| `/me/onboarding/complete` | POST | none | `status: "ok"` | bearer | 401 invalid/expired/missing token |
| `/auth/refresh` | POST | `refresh_token: string` (req) | `access_token`, `refresh_token`, `user_id` | none (the refresh token itself is the credential, same trust level as `/auth/login`) | 401 only when Supabase explicitly rejects the credential (`invalid_grant`, expired, revoked); 503 for anything else Supabase or the network returns (timeout, 5xx, rate limit), so a transient Supabase outage never reads as "your login is bad" |
| `/auth/signup` | POST | `email`, `password` (req) | `status: "ok"` with `access_token`, `refresh_token`, `user_id`; or `status: "confirmation_required"` with `email` | none | 400 invalid email/password. No distinguishable error for an already registered email; see the note below the table |
| `/auth/verify-signup` | POST | `email`, `token` (the code, req) | `access_token`, `refresh_token`, `user_id`, same shape as `/auth/login` | none | 400 invalid or expired code, with `error_code: "otp_expired"` or `"otp_invalid"` passed through from Supabase, same pattern as `/auth/login`'s `error_code` below |
| `/auth/resend-confirmation` | POST | `email` (req) | `status: "ok"` (always, even for an unknown or already confirmed email, so the response never reveals which) | none | 429 rate limited |
| `/auth/login` (error contract revised) | POST | `email`, `password` (req) | `access_token`, `refresh_token`, `user_id` | none | 401 invalid email or password; 403 with `error_code: "email_not_confirmed"` when the account exists but hasn't confirmed yet |

`/auth/signup` assumes Supabase's own email enumeration protection stays on (its default alongside "Confirm email"): signing up again with an email that's already registered returns the same `confirmation_required` looking response as a genuinely new signup, not a distinguishable error, so an attacker can't use signup to learn which emails already have accounts. This means a returning user who mistakenly signs up again lands on the confirm email screen with no real code coming (the account already exists); build task 17 adds an "Already have an account? Log in instead" link on that screen as the recovery path for this case, not an error to detect. Do not turn this Supabase setting off to make the 422 case detectable, that would reopen the enumeration hole.

The existing `sign_in` proxy in `backend/auth.py` collapses every non 2xx Supabase response into a 401; `/auth/refresh` must NOT copy that as is, since doing so would force-log-out every signed in user during any transient Supabase issue and delete their refresh credential in the process. `/auth/refresh` needs its own response handling: a Supabase 400/401 with an `invalid_grant`-shaped body maps to this endpoint's 401; anything else (timeout, connection error, Supabase 5xx, 429) maps to 503.

Both `GET /me` and `POST /me/onboarding/complete` write/read through an upsert, not a plain `SELECT`/`UPDATE`: an account can have a valid Supabase JWT but no `public.users` row yet (a signup whose profile insert failed, or an account created outside the normal signup path), and a plain `UPDATE ... WHERE id = ...` against a missing row succeeds with zero rows changed while still returning `{"status": "ok"}`, silently breaking AC-5 with no error anywhere. Both endpoints must guarantee the row exists (`INSERT ... ON CONFLICT DO NOTHING` before reading, or `INSERT ... ON CONFLICT (id) DO UPDATE` for the write) before reporting success.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `GET /me` | `onboarding_completed` | `users.onboarding_completed` column (row guaranteed to exist via the upsert above) |
| `GET /me` | `user_id` | decoded from the bearer token's `sub` claim, same pattern as the existing `get_current_user_id` dependency |
| `POST /me/onboarding/complete` | which account gets updated | bearer token's user id, never a client supplied id |
| `POST /auth/refresh` | new `access_token` / `refresh_token` pair | Supabase Auth's refresh grant response, proxied with its own error mapping (see API surface above, not copied from `sign_in`) |
| Launch routing decision | which screen to route to | derived client side from: refresh credential presence in `expo-secure-store`, a local decode of the access token's `exp` claim, `GET /me`'s `onboarding_completed`, and the renewal outcome |
| Launch routing decision | user id for the in memory session | `GET /me`'s `user_id` (launch), or the login/signup/refresh response's `user_id` (those paths), written into `sessionStore` |
| Splash timeout fallback | how long to wait before giving up | a fixed client side constant, 8 seconds total for the whole resolution (not per request), defined once in `constants/` |
| Onboarding completion retry | how many attempts, how spaced | a fixed client side policy on the mutation: 3 attempts, exponential backoff capped at 30 seconds |
| `POST /auth/signup` | `status` | derived: `"ok"` when Supabase's signup response already includes a session (an `access_token`); `"confirmation_required"` when it doesn't (no `user_id` needed for this branch, see the API surface note above) |
| `POST /auth/verify-signup` | `access_token` / `refresh_token` / `user_id` | Supabase Auth's verify response (`type=signup`), proxied directly |
| `POST /auth/verify-signup`'s 400 | `error_code: "otp_expired"` / `"otp_invalid"` | Supabase's own error code on the verify response, passed through, not reinterpreted |
| `POST /auth/resend-confirmation` | `status: "ok"` | a fixed value, always returned regardless of whether Supabase's resend call hits a real, already confirmed, or unknown email, so the response never reveals which through the success body (its 429 is a separate, already accepted exposure, see Key invariants) |
| `POST /auth/login`'s 403 | `error_code: "email_not_confirmed"` | Supabase's own error code on the token grant response, passed through, not reinterpreted |
| Confirm email screen | which email address to show | the address entered on the signup or login form that led here, passed as a route param, never refetched |
| Confirm email screen | whether to auto fire one resend on mount | an `autoResend` route param, set to true only when navigating here from the login flow's AC-16 case (the signup flow already has a code in flight from `/auth/signup` itself, so it defaults false there) |
| Confirm email screen, no email param | which screen to show | fixed: redirect to `(auth)/login`, this route is only ever reached with a real email carried from signup or login, never bookmarked or deep linked to directly |

**Key invariants**:
- `onboarding_completed` only ever moves `false` to `true`; no code path resets it.
- Every read or write of `onboarding_completed` is scoped to the account identified by the bearer token; a client supplied user id is never trusted, matching the existing pattern on `/ratings` and `/me/ratings`.
- Only one renewal exchange is ever in flight for a given session at a time; concurrent 401s share the one result instead of racing separate renewal calls.
- A renewed access/refresh credential pair is persisted to `expo-secure-store` atomically (both or neither) before any waiting request is resumed, since Supabase rotates the refresh credential on every use and the old one stops working immediately.
- A request retried after a renewal is marked so a second 401 on it is terminal (clear credentials, route to `(auth)`), never triggers a second renewal attempt.
- Stored credentials are only ever cleared on an explicit rejection of the credential itself (a 401 that means "this login is invalid"), never on a network error, a server error, or a timeout.
- The onboarding completion call (AC-5) never triggers the forced sign-out navigation on renewal failure; its own retry policy governs it alone.
- The email confirmation code is single use; Supabase invalidates the previous code the moment a new one is requested or a code is successfully verified.
- No credential (access or refresh token) is ever stored on the device before a code is verified; the confirm email screen holds only the entered code and the email address in local component state, nothing persisted.
- `/auth/resend-confirmation` never reveals whether a given email is registered, already confirmed, or unknown through its success response body; it always returns the same `{"status": "ok"}`. Its 429 (Supabase's own rate limit, which only fires for a real, unconfirmed account) is a narrow exception, the same already accepted exposure class as `/auth/login`'s distinguishable error, not a new one.
- The confirm email screen always renders with a real email address; it is never reachable without one (see the no-param routing rule in Value sourcing above).

**Security model**:
Identity always comes from the verified bearer token (the existing `get_current_user_id` dependency), never a client supplied id, same boundary as every other authenticated endpoint in `backend/main.py`. `/auth/refresh` doesn't require a bearer token itself (the whole point is the access token may be gone), but requires a valid, unexpired Supabase refresh token as the credential, the same trust level `/auth/login` already operates at. No new PII is introduced; this only adds one boolean and proxies a grant type Supabase Auth already supports.

Distinguishing "wrong password" from "email not confirmed" on `/auth/login` is a deliberate, small account enumeration tradeoff: it tells someone that a given email is registered but unconfirmed, in exchange for not leaving a legitimate user stuck on a generic error with no way forward. This matches common practice (the same tradeoff most consumer apps requiring confirmation make) and is narrower than, say, a signup endpoint that reveals whether an email is already registered, which this project does not do. `/auth/resend-confirmation` does not add to this exposure: it always returns the same response regardless of whether the email is registered, confirmed, or unknown.

**Configuration required**:
- Reuses the backend's existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET` and the mobile app's existing `EXPO_PUBLIC_API_BASE_URL`; no new env vars.
- Supabase project dashboard: Authentication → Providers → Email, turn on "Confirm email", and set the confirmation email template to send a numeric code (`{{ .Token }}`), not the default confirmation link. Manual, like the checked in SQL migration file below; not something `/develop`'s automated, lint and CI enforced path touches.
- Supabase project dashboard: confirm email enumeration protection stays on (Supabase's default alongside "Confirm email"); this is what makes a repeat signup for an existing email indistinguishable from a new one, see the API surface note above.
- Supabase project dashboard: set the email OTP expiry to 10 minutes (Authentication → Providers → Email → "Email OTP Expiration"), shorter than Supabase's 1 hour default; a security code that stays valid for an hour is unusually long lived. The code itself is 6 digits (Supabase's default format).

**Critical test scenarios**:
- Happy path: fresh signup, `onboarding_completed` is false, routes to onboarding, tap Skip, flag becomes true, relaunch routes straight to `(tabs)`. Verifies **AC-1, AC-2, AC-5, AC-8, AC-9**.
- Renewal succeeds: access token expired or missing, refresh succeeds, the app never shows the sign in screen for this case. Verifies **AC-3**.
- Renewal explicitly rejected: refresh credential itself is invalid, stored credentials are cleared and the app routes to `(auth)`. Verifies **AC-4**.
- Renewal terminal loop guard: the retried request (after a successful renewal) still 401s; the app clears credentials and routes to `(auth)` without attempting a second renewal. Verifies **AC-11**.
- Transient failure, not a rejection: `/auth/refresh` (or `GET /me`) returns a 503 or times out; the app routes to `(auth)` but keeps the stored credentials so a later launch can succeed without a fresh login. Verifies **AC-10**.
- Offline at launch: no connectivity at all; same outcome and same guarantee as the transient failure case above. Verifies **AC-10**.
- Missing profile row: `POST /me/onboarding/complete` for an account with no `public.users` row still results in `onboarding_completed = true` on the next `GET /me`. Verifies **AC-5**.
- Concurrency: several API calls 401 at the same moment, only one renewal call fires, all resume together. Verifies **AC-6**.
- Auth/permission: calling `GET /me` or `POST /me/onboarding/complete` with no bearer token returns 401 and no account data. Supports **AC-2, AC-5**.
- Login on a new device: an account that already completed onboarding elsewhere logs in fresh and lands on `(tabs)`, not `onboarding`. Verifies **AC-9**.
- Signup requiring confirmation: a fresh signup returns `confirmation_required`, the app shows the confirm email screen, and no credentials are stored. Verifies **AC-12**.
- Correct code: entering the code Supabase actually sent completes sign in and routes to onboarding. Verifies **AC-13**.
- Incorrect code: a wrong or expired code shows an inline error and the screen stays usable. Verifies **AC-14**.
- Resend: requesting a new code before the client side cooldown ends is blocked locally; requesting one after Supabase's own rate limit is hit returns a clear "wait a bit" message, not a generic error. Verifies **AC-15**.
- Login before confirming: a correct password on an unconfirmed account shows the distinguishing message with a path to the confirm email screen, and a fresh code has already been requested by the time it opens. Verifies **AC-16**.
- Repeat signup for an already registered email: the response looks identical to a fresh `confirmation_required` signup (no distinguishable error); the confirm email screen's "already have an account? log in" link is the intended way out, not an error state. Supports **AC-12**.
- Wrong vs expired code: entering a code for the wrong reason (mistyped vs past the 10 minute window) both show an inline error, distinguished by `error_code`. Verifies **AC-14**.

## Build plan

Backend tasks are `backend/` work done by hand; `AGENTS.md`'s Rules mark `backend/` out of scope for `/develop`'s automated, lint and CI enforced flow, but this feature cannot function without them, so they're named here rather than assumed. Mobile tasks 5 onward are blocked on tasks 1 through 4 being live (a working precondition check: `curl $API_BASE_URL/me` with a valid token returns a body containing `onboarding_completed`). Mobile tasks 16 onward are additionally blocked on tasks 11 through 15 being live (precondition: a signup against the live Supabase project, with "Confirm email" on, returns `status: "confirmation_required"` and a real code arrives by email).

1. **(backend, manual)** Add the migration as a checked in, re-runnable file, `backend/db/migrations/0001_onboarding_completed.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean not null default false;`. Also extend the `CREATE TABLE IF NOT EXISTS users (...)` block in `backend/db/import_data.py` with the same column, for a fresh database (the migration file and the `CREATE TABLE` block must agree). Satisfies **AC-2, AC-8, AC-9**.
2. **(backend, manual)** Add two named DB helpers in `backend/db/import_data.py`, matching the existing pattern (`get_user_ratings`, `add_rating`, `create_user_profile`): `get_user_profile(user_id)` (upserts the row if missing, returns `onboarding_completed`) and `set_onboarding_completed(user_id)` (upserts the row with `onboarding_completed = true`). Supports **AC-2, AC-5**.
3. **(backend, manual)** Add `GET /me` to `backend/main.py`, calling `get_user_profile`, returning `{user_id, onboarding_completed}` for the bearer token's account via a named Pydantic response model (`MeResponse`), following the same `Depends(get_current_user_id)` pattern as `/me/ratings`. Satisfies **AC-2**.
4. **(backend, manual)** Add `POST /me/onboarding/complete`, calling `set_onboarding_completed`, returning `{"status": "ok"}`. Add `POST /auth/refresh` to `backend/main.py` / `backend/auth.py`, proxying Supabase Auth's `grant_type=refresh_token` request with its own error mapping (401 only for an explicit `invalid_grant`-style rejection, 503 for anything else, see API surface, do not copy `sign_in`'s "collapse everything to 401" behavior). Satisfies **AC-3, AC-4, AC-5, AC-10**.
5. **(mobile)** Add `lib/tokens.ts`, the credential storage layer that doesn't exist yet: `getAccessToken`, `getRefreshToken`, `setTokens({access_token, refresh_token})` (writes both atomically), and `clearTokens()`, wrapping `expo-secure-store` under the `nextwatch_access_token` / `nextwatch_refresh_token` keys already named in `design.md` §8. Supports **AC-1, AC-3, AC-4**.
6. **(mobile)** Extend `store/sessionStore.ts` with a `clearSession` action (calls `clearTokens` and nulls `userId`); derive "authenticated" from `userId !== null` rather than adding a second flag, keeping the store's existing simple, flat shape. Add an effect in `app/_layout.tsx` that watches this store and calls `router.replace("/(auth)/login")` when the session flips to cleared while the app is already past the initial launch resolution (so a mid session renewal failure actually navigates somewhere, not just clears state nobody reacts to). Supports **AC-4, AC-6**.
7. **(mobile)** Add the shared 401 handling to `lib/api.ts`'s `apiFetch`: auto attach the stored access token to every call unless the caller opts out; on a 401 from a call that carried a token, start (or join, if one is already running) a single renewal attempt via task 5/task 4's `/auth/refresh`, persist the new pair before resuming any waiter, retry the original request once with a "no further renewal" marker, and clear the session (via task 6's `clearSession`) only on an explicit rejection, never on a network/5xx error. A 401 from a call that never carried a token passes straight through, untouched. In `lib/queryClient.ts`, set the query `retry` option to a predicate that never retries a 401 (`apiFetch` already owns that path) and add a `trackEvent`/breadcrumb call (spec [0003](../0003-error-monitoring-product-analytics/index.md)) on a forced logout, since the existing global `onError` filters out anything under 500 and would otherwise make this silent. Satisfies **AC-3, AC-4, AC-6, AC-10, AC-11**.
8. **(mobile)** Implement the launch routing check, replacing the hardcoded redirect in `app/index.tsx`, as the state machine above. Move `SplashScreen.hideAsync()` in `app/_layout.tsx` to fire only once both `fontsLoaded` and the launch decision are resolved (today it fires on `fontsLoaded` alone, which would flash a blank frame before `index.tsx` even mounts); publish the resolved decision through `sessionStore` so `index.tsx` can render a synchronous `<Redirect>` once the layout allows it through. Use an imperative one shot fetch (`queryClient.fetchQuery` with `retry: false` on the `["me"]` query key, not a component level `useQuery`) since this resolves before the routed screens exist to host a hook; wrap the whole resolution in one `AbortController` tied to the fixed timeout constant. Add the `Me` response type to `mobile/types/`, matching `MeResponse` from task 3. Satisfies **AC-1, AC-2, AC-7, AC-9, AC-10, AC-11**.
9. **(mobile)** Wire the login and signup mutations' `onSuccess`: signup routes straight to `onboarding` when it returns tokens directly (a fresh account always starts incomplete, no extra check needed; task 18 adds the branch for when it doesn't); login calls the same `["me"]` fetch task 8 defines and routes by its `onboarding_completed`, so a login on a new device or after a reinstall reaches the right screen. Satisfies **AC-8, AC-9**.
10. **(mobile)** Wire the onboarding screen's Skip and Done actions to call `POST /me/onboarding/complete` (a `useMutation`, fired without blocking navigation, `retry: 3` with capped exponential backoff per the Value sourcing table); on success, update the cached `["me"]` query data (`onboarding_completed: true`) and invalidate it, per `AGENTS.md` §8's "invalidate the relevant query keys after each mutation." Satisfies **AC-5**.
11. **(backend, manual)** In the Supabase dashboard, turn on "Confirm email" and switch the confirmation email template to send a numeric code instead of a link. Satisfies **AC-12**.
12. **(backend, manual)** Update `sign_up` in `backend/auth.py` to detect whether Supabase's signup response already includes a session (an `access_token`) or not, and update `POST /auth/signup` in `backend/main.py` to return the discriminated `status: "ok"` / `status: "confirmation_required"` shape from the API surface above (the pending branch carries only `email`, no `user_id`). Verify the exact response shape against the live Supabase project in this mode before finalizing the detection logic (see Follow-up). Satisfies **AC-8, AC-12**.
13. **(backend, manual)** Add `verify_signup_code` to `backend/auth.py`, proxying Supabase's `/auth/v1/verify` with `type=signup`, and add `POST /auth/verify-signup` to `backend/main.py`, returning the same `access_token`/`refresh_token`/`user_id` shape as `/auth/login`; map an invalid or expired code to 400 with `error_code: "otp_expired"` / `"otp_invalid"` passed through from Supabase, same pattern as task 15. Satisfies **AC-13, AC-14**.
14. **(backend, manual)** Add `resend_confirmation_code` to `backend/auth.py`, proxying Supabase's `/auth/v1/resend` with `type=signup`, and add `POST /auth/resend-confirmation` to `backend/main.py`, always returning `{"status": "ok"}` regardless of Supabase's response, except passing a 429 straight through. Satisfies **AC-15**.
15. **(backend, manual)** Update `sign_in` in `backend/auth.py` to detect Supabase's `email_not_confirmed` error code, the same pattern `refresh_access_token` already uses for `REJECTED_REFRESH_TOKEN_CODES`, and raise a 403 with `{"detail": ..., "error_code": "email_not_confirmed"}` instead of collapsing it into the generic 401. Satisfies **AC-16**.
16. **(mobile)** Add the `SignupResponse` discriminated type to `mobile/types/api.ts`, and add `useVerifySignup` and `useResendConfirmation` mutations to `hooks/useAuth.ts`, following the existing `useSignup`/`useLogin` pattern (a `useMutation`, `token: null`). Satisfies **AC-13, AC-15**.
17. **(mobile)** Add `app/(auth)/confirm-email.tsx`: reads the `email` and `autoResend` route params, redirecting to `/(auth)/login` if `email` is missing; a code `TextField` (`keyboardType="number-pad"`, `maxLength={6}`); a Confirm button wired to `useVerifySignup` (on success: store credentials via the existing `completeAuth` helper, route to onboarding; on a `400` with `error_code`, show the matching wrong/expired code message); a Resend button wired to `useResendConfirmation` with a 30 second client side cooldown, disabled and counting down after each tap (fired once automatically on mount when `autoResend` is true); and an "Already have an account? Log in instead" link. Satisfies **AC-12, AC-13, AC-14, AC-15, AC-16**.
18. **(mobile)** Update `useSignup` in `hooks/useAuth.ts` to branch on the new `status` field: `"ok"` keeps today's behavior unchanged; `"confirmation_required"` skips `completeAuth` (no tokens exist yet) and routes to `/(auth)/confirm-email` with `email` as a route param (`autoResend` omitted/false, `/auth/signup` itself already sent the first code). Satisfies **AC-8, AC-12**.
19. **(mobile)** Update `useLogin` and the login screen to detect the `email_not_confirmed` error code on a failed login (extend `apiErrorMessage`'s parsed body to also expose `error_code`) and show a distinguishing message with a link to `/(auth)/confirm-email`, prefilled with the entered email and `autoResend=true`, instead of the generic invalid credentials copy. Satisfies **AC-16**.

## Consequences

**Positive**:
- Relaunch routing correctly and permanently respects a Skip, matching the confirmed product requirement, not just the common case.
- The completion flag survives a reinstall or a new device, the same guarantee every other piece of account state (ratings) already has.
- The renewal handling in `lib/api.ts` benefits every screen going forward, not just the launch check, cutting down on forced re logins across the whole app.
- No new client side storage convention is introduced; `AGENTS.md` §12's "AsyncStorage is for theme only" rule stays intact, and the new `lib/tokens.ts` is the one place that touches `expo-secure-store`.
- A transient network or backend problem at launch no longer destroys a valid login, only an explicit rejection does.
- Matches Supabase's own default and common practice: an account can't be used until the email address is proven reachable, cutting down on fake or mistyped signups reaching onboarding and recommendations.
- The numeric code needs no new mobile dependency and no custom URL scheme handling, and it works identically on iOS, Android, and Web, unlike a tap through link.

**Negative / tradeoffs**:
- Four backend tasks sit outside `/develop`'s automated, lint and CI enforced path and have to be built and kept in sync with this spec by hand, more error prone than tracked work; the checked in migration file and named DB helpers (tasks 1 to 2) exist specifically to make that drift easier to catch.
- The 401 handling touches `lib/api.ts`, the fetch wrapper every screen in the app already uses; a bug here has app wide blast radius, not just this feature's.
- Marking onboarding complete can fail silently in the background by design (to avoid blocking navigation and to avoid forcing a sign-out over a background write); a user with a bad connection at exactly that moment could see onboarding once more than intended.
- The launch path now includes a local JWT decode (a plain base64 decode of the payload, no new dependency) to avoid a doomed request on the common "token expired since last open" case; it's a small amount of extra logic to keep in sync if the token shape ever changes.
- A slow or fully unreachable backend at launch means the splash screen stays up until the fixed 8 second timeout fires, rather than showing an immediate loading state.
- A new step between signup and onboarding is real friction: a user has to leave the app, find the email, and type a code, for every new account.
- `/auth/login`'s distinguishable error for an unconfirmed account is a small, accepted account enumeration surface (see Security model above).
- Five more backend endpoints or changes (tasks 11 to 15) sit outside `/develop`'s automated path, on top of the four already accepted for tasks 1 to 4.

**Neutral**:
- Every screen's 401 handling now flows through one shared place instead of being handled ad hoc; the existing TanStack Query error surfacing for genuine 4xx responses (`AGENTS.md` §14, spec [0003](../0003-error-monitoring-product-analytics/index.md)) is unchanged for anything that isn't this specific renewal path.
- `onboarding_completed` is one directional (false to true only); there is intentionally no way to make onboarding reappear on purpose.
- `GET /me`'s upsert means the first call to it for any account effectively backfills a missing `public.users` row; this is a deliberate side effect, not a bug, since it's the same guarantee `create_user_profile` already gives on signup.
- The confirm email screen's email address is passed as a route param, not persisted anywhere; a relaunch before confirming lands back on the sign in screen (AC-1), and the user logs in again to reach it (re-signing up is a dead end for an already registered email, see the API surface note above), which is why AC-16's login path auto sends a fresh code rather than assuming one is still usable.
- Turning "Confirm email" on only changes what happens for a signup made from now on; every account that already exists has `email_confirmed_at` already set by Supabase (it was never blank to begin with), so flipping the setting doesn't lock anyone out or need a data migration.

## Follow-up

- [ ] The Profile screen (`design.md` §6.9) needs the account's email on every load; today that's only available right after signup or login from Supabase's response, not persisted or refetched. `GET /me` could grow to include it later, but that's not this spec's problem to solve, it likely belongs to the Ratings & profile journey (scope feature 9) or gets folded into feature 5's account work if it's needed sooner.
- [ ] Consider whether `/auth/refresh` should share a helper with `/auth/signup` and `/auth/login`'s Supabase Auth calls rather than duplicating the `requests.post` logic, since `backend/auth.py` doesn't have one yet; keep the error mapping distinct either way (see API surface note on why `/auth/refresh` cannot reuse `sign_in`'s collapse-to-401 behavior).
- [ ] Verify that Supabase's `/auth/v1/signup` response has no `access_token` key when "Confirm email" is on, against the live Supabase project, before finalizing build task 12's detection logic; this is standard GoTrue behavior but hasn't been checked against this project's actual instance. (No `user_id` extraction to verify here, the pending branch doesn't return one, see the API surface note above.)
- [ ] If NextWatch ever gets a real hosted web domain with associated domain files (`apple-app-site-association`, `assetlinks.json`), reconsider a tap through confirmation link as a lower friction alternative to typing a code; out of reach today since no such domain exists (see `rationale.md`, Option 5).
- [ ] The Supabase confirmation email's copy and subject line need writing through the Supabase dashboard's email template editor; not a code change, but needed before this ships.
- [ ] `backend/` still has no migration tooling beyond individually checked in SQL files; `backend/db/migrations/0001_onboarding_completed.sql` (build task 1) is the first one. If more migrations follow, worth a real tool (Alembic or similar) rather than accumulating loose files, but that's out of scope here.
