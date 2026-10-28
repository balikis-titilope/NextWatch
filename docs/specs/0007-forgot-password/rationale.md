# 0007. Forgot password — Rationale

## Context

NextWatch has no anonymous mode. Every rating, and therefore every bit of taste signal the recommendation engine learns from, lives behind a real account. `mobile/context/design.md` originally noted, twice, that password reset was "not built for MVP." That was a reasonable cut for a first pass, but it leaves anyone who forgets their password with no way back into their account at all, permanently losing their rating history with no support workaround available in this project (there is no admin tooling yet either, per `docs/scope/scope.md`'s Deferred section). The engineer chose to reverse that MVP exclusion now rather than let it become a silent gap once real users exist.

The backend (`backend/auth.py`) already proxies every auth operation to Supabase Auth rather than the mobile app talking to Supabase directly, so this feature must follow that same shape: new backend endpoints that wrap Supabase's own password recovery API, not a parallel system. Supabase Auth already exposes a full recovery flow (send code, verify code, update password), so the real design work here is choosing how much of Supabase's native flow to use as is versus layering custom behavior on top, and being honest about the security tradeoffs of a couple of specific choices the engineer made along the way.

Two forces shaped those specific choices. First, the mobile app has no deep link handling built yet (confirmed against `mobile/AGENTS.md`), which rules out a magic link flow without extra setup; the app does already have a proven numeric code UX from the signup confirmation flow (`mobile/app/(auth)/confirm-email.tsx`, spec 0004), which this feature can copy directly. Second, the engineer's choice to have this flow name a specific reason when an email is not registered, rather than the generic "we sent you an email either way" response the existing `resend_confirmation_code` function deliberately uses to avoid email enumeration, is a real security tradeoff, made consciously and documented below rather than downgraded.

## Options considered

### Option 1: Numeric code by email, using Supabase Auth's native recovery flow

Reuse Supabase's built in password recovery: request a code (`/auth/v1/recover`), verify it (`/auth/v1/verify`, type `recovery`), then update the password on the resulting session (`PUT /auth/v1/user`). The mobile side is two screens copying the exact shape of the existing signup confirmation screens.

**Pros**:
- No new deep link handling to build; the numeric code pattern already exists and is proven in this app.
- Supabase owns code generation, expiry, and delivery; nothing to build or operate ourselves.
- Smallest surface: no new database tables, no custom token storage.

**Cons**:
- A little more typing for the user than tapping a link (six digits versus one tap).

### Option 2: Magic link by email

Supabase emails a link that deep links straight into a reset screen with the recovery token already attached.

**Pros**:
- One tap for the user, no code to transcribe.

**Cons**:
- Needs deep link handling (universal links / app links, `expo-router`'s linking config) that does not exist in this app yet; a real chunk of new setup for a UX gain this app hasn't needed anywhere else.
- Harder to reason about on web (the third target platform, per `mobile/AGENTS.md` §3) where the "app" opening a link is not guaranteed the same way.

### Option 3: Build a custom reset token system

Store our own reset tokens in Postgres (`reset_tokens` table: user id, token hash, expiry), email them ourselves, and verify against our own table instead of Supabase's recovery flow.

**Pros**:
- Full control over token format, expiry, and delivery copy.

**Cons**:
- This is reinventing authentication that a proven provider already does correctly (token expiry, single use, secure hashing, rate limiting), a known failure pattern; Supabase Auth already solves this problem for the rest of the app's login and signup, so bypassing it here for no stated reason adds a second, inconsistent auth surface to maintain.
- New table, new email sending path (this project doesn't otherwise send email itself, Supabase does), more code to secure and test for a feature Supabase already ships.

## Rationale

Option 1 wins because it costs the least to build (`backend/auth.py` already proxies Supabase Auth calls the same way for signup, login, and email confirmation) and the least to operate (Supabase remains the single source of truth for who can authenticate, so there is never a question of which system's record is correct). It also keeps the mobile app's UX consistent: a user who has already been through the confirm email screen sees the same shape of screen again here, not a new pattern to learn.

On the two security relative choices: the engineer asked for the reset request to name whether an email is registered, breaking from the enumeration safe pattern the existing `resend_confirmation_code` function deliberately uses. That is a real tradeoff, not a neutral one: anyone can use this endpoint to check whether a given email has an account on this app. It is documented plainly in Consequences below rather than softened. Answering that lookup does not need a new privileged Supabase credential, though: Supabase's public recovery endpoint itself will not reveal whether an email is registered (the same enumeration safe design `resend_confirmation_code` already follows), but the backend already holds a direct Postgres connection (`DATABASE_URL`, used elsewhere in `backend/db/`) to the same database Supabase Auth's `auth.users` table lives in. A read only query against that table answers the question directly, with no new secret and no guessed admin API shape to get wrong.

The "revoke other sessions" requirement also turned out to need no elevated privilege: Supabase Auth's own sign out endpoint accepts a `scope` parameter (`others`), which revokes every session except the one presented, using nothing but that session's own access token, the one the recovery flow already has in hand right after a successful code verification. Between the direct database read and the self service sign out call, this feature needs no new Supabase credential at all, only the connection and the anon key this backend already has.
