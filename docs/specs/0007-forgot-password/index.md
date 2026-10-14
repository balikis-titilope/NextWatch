# 0007. Forgot password

**Date**: 2026-08-10
**Status**: In Progress

## Summary

This spec designs a forgot password flow for the mobile app, something `design.md` explicitly left out of the first build. A user who forgets their password can now request a numeric code by email, enter it along with a new password, and get signed back in automatically, with every other logged in session on other devices revoked. It reuses the same code entry pattern already built for signup email confirmation, so there is no new UX for users to learn. Building it means adding two new backend endpoints; no new privileged credential is needed, since the one place that looked like it might need one turned out to be answerable with the backend's existing database connection.

## Requirements

**User stories**:
- As a user who forgot their password, I want to reset it by email so that I can get back into my account and keep my rating history, without needing support.
- As the product, I want a password reset to close out any other active session for that account, so a forgotten or compromised password does not leave a lingering way in elsewhere.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A "Forgot password?" link appears on the Log In screen only (not on Sign Up), navigating to a new Request Reset screen.
- **AC-2**: On the Request Reset screen, submitting a registered email sends a 6 digit numeric code to that email via Supabase Auth, then navigates to the Reset Password screen carrying the email.
- **AC-3**: On the Request Reset screen, submitting an email with no matching account shows an inline "No account found with that email" error and does not navigate forward.
- **AC-4**: The Reset Password screen has a code field, a new password field, and a confirm password field; the new password and confirm password must match before the form can submit.
- **AC-5**: The new password must be at least 8 characters; a shorter password blocks submission on the client, before any network call.
- **AC-6**: Submitting a correct, unexpired code with a valid new password updates the account's password via Supabase Auth and signs the user in immediately (same access and refresh token handling as the existing signup confirmation flow), landing on the same destination the Log In flow already computes (the tabs, or onboarding, from `GET /me`'s `onboarding_completed`).
- **AC-7**: Submitting an incorrect or expired code shows a distinguishing inline error (matching the confirm email screen's invalid versus expired code pattern) and does not update the password or navigate forward.
- **AC-8**: The Reset Password screen offers a "Resend code" action with the same 30 second cooldown pattern as the confirm email screen.
- **AC-9**: Hitting Supabase's rate limit on either the request or the resend action shows a clear "too many requests" inline message, not a generic error.
- **AC-10**: A transient Supabase or network outage during any step shows a distinguishing "try again" message rather than being read as an invalid credential or invalid code.
- **AC-11**: The Reset Password screen redirects to the Log In screen if it is reached with no email carried in navigation params (same guard the confirm email screen already uses).
- **AC-12**: After a successful reset, every other refresh token for that account is revoked, so no other device can start a new session; a device that already holds a live access token keeps working until that token itself expires (this backend verifies access tokens locally against Supabase's public keys, so it cannot detect a revocation before the token's own expiry, up to about an hour).
- **AC-13**: Submitting a new password identical to the account's current password shows a clear inline error ("choose a different password") and does not proceed.
- **AC-14**: ~~`POST /auth/request-password-reset` is rate limited per IP address (independently of Supabase's own rate limit on the `/recover` call that comes after it); exceeding the limit returns 429 with the same "too many requests" messaging as AC-9, before the email lookup even runs.~~ **Reversed 2026-08-11**: the per-IP `slowapi` limiter was removed at the engineer's explicit request. `POST /auth/request-password-reset` is no longer rate limited by this backend at all — only Supabase's own upstream rate limit on `/recover` still applies. This reopens the unthrottled email-enumeration probing this AC existed to throttle (see Consequences); accepted knowingly, not an oversight.

## Options considered

See `rationale.md`.

## Decision

**Chosen option**: Option 1: Numeric code by email, using Supabase Auth's native recovery flow.

This flow calls Supabase Auth's own recovery endpoints (request code, verify code, update password) the same way `backend/auth.py` already proxies signup, login, and email confirmation, and reuses the mobile app's existing numeric code screen pattern from `mobile/app/(auth)/confirm-email.tsx`.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `backend/.agents/skills/supabase/`)

## Rationale

See `rationale.md`.

## Feature design

**Data model sketch**:
No new tables or columns. Supabase Auth manages the recovery code and its expiry entirely on its own side, the same way it already manages the signup confirmation code; the backend only proxies requests to it, as it already does for `sign_up` / `sign_in` / `verify_signup_code` in `backend/auth.py`.

**State transitions**:
Not applicable; no new stateful entity is introduced.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/auth/request-password-reset` | POST | `email: str` | `{status: "ok"}` | none (pre login); rate limited per IP (`slowapi`, e.g. 5 requests / 15 min) ahead of the email lookup | 404 `email_not_found`, 429 rate limited (ours, or Supabase's on the downstream call), 503 outage |
| `/auth/reset-password` | POST | `email: str`, `token: str`, `new_password: str` | `access_token`, `refresh_token`, `user_id` | none (pre login; the recovery code itself is the credential) | 400 `otp_invalid` / `otp_expired` / `same_password`, 429 rate limited, 503 outage |

429 and 503 carry a plain string `detail`, not a structured `error_code`, matching how `resend_confirmation_code` and `refresh_access_token` already raise them in `backend/auth.py`; the mobile client branches on the response's HTTP status (`ApiError.status`, from `mobile/lib/api.ts`), not on `apiErrorCode`, for these two cases.

Backend functions to add in `backend/auth.py`, following the same style as `verify_signup_code` and `resend_confirmation_code`:
- `check_email_registered(email: str) -> bool`: a read only query against `auth.users` (`SELECT 1 FROM auth.users WHERE lower(email) = lower(%s)`) over the backend's existing `DATABASE_URL` connection, the same one `backend/db/import_data.py` already uses. No Supabase Auth API call, no new credential; see the Follow-up item on confirming this connection's role can read `auth.users`.
- `send_password_reset(email: str) -> None`: calls `POST /auth/v1/recover` with the anon key headers already used elsewhere in this file, same 429/503 handling as `resend_confirmation_code`.
- `verify_recovery_code(email: str, token: str) -> dict`: calls `POST /auth/v1/verify` with `type: "recovery"`, same shape and error mapping (`otp_invalid` / `otp_expired`) as `verify_signup_code`. The returned code is single use: once this call succeeds, the same code cannot be verified again.
- `finish_password_reset(access_token: str, new_password: str) -> dict`: calls `PUT /auth/v1/user` with headers `apikey` (anon key) and `Authorization: Bearer <access_token>` to set the new password (a `same_password` error from Supabase here maps straight to the 400 above), then `POST /auth/v1/logout?scope=others` with the same access token to revoke every other session for the account. If the sign out call itself fails after the password update already succeeded, log it and still return success. If the password update call fails (network/5xx), return 503 with copy that tells the user to request a new code, not to retry this one. Neither call needs a privileged key; both act on the token already presented.

`POST /auth/request-password-reset` also carries a `slowapi` `Limiter` decorator in `backend/main.py` (in-memory backend, no Redis needed at this project's current scale), capping requests per client IP (e.g. 5 per 15 minutes) before `check_email_registered` ever runs, closing the enumeration exposure AC-3 accepts (see Consequences). This is the one new backend dependency this spec adds (`slowapi` in `requirements.txt`).

**Value sourcing** (every value each action produces, computes, or displays names where it comes from; a required value with no named source is an undecided input, resolve it before this spec is done, do NOT leave the build to invent it):
| Action | Value produced / displayed | Source |
|---|---|---|
| `POST /auth/request-password-reset` | whether the email is registered (drives 404 vs sending the code) | Direct read of `auth.users` over the backend's existing `DATABASE_URL` connection, via `check_email_registered` |
| `POST /auth/request-password-reset` | the 6 digit code and its delivery | Supabase's own `/auth/v1/recover` call; Supabase generates, expires, and emails it |
| `POST /auth/reset-password` | `access_token` / `refresh_token` / `user_id` to sign the user in | Supabase's `/auth/v1/verify` (`type: recovery`) response, same shape `verify_signup_code` already returns |
| `POST /auth/reset-password` | the `same_password` rejection | Supabase's own `PUT /auth/v1/user` response when the new password matches the current one |
| `POST /auth/reset-password` | revocation of other sessions | Supabase's `/auth/v1/logout?scope=others`, called with the access token from the verify step |
| Mobile: post reset destination route | tabs vs onboarding | `GET /me`'s `onboarding_completed` field, the same source `useLogin`'s `onSuccess` already reads in `mobile/hooks/useAuth.ts` |
| Mobile + backend: minimum password length shown/enforced | 8 characters | Fixed policy, matching the project's Supabase dashboard password minimum (already set to 8 by the engineer); enforced client side before submit and server side in the request model, as defense in depth |

**Key invariants**:
- A password reset never succeeds without a code that Supabase itself issued and verified; the backend never invents or stores its own reset token.
- `check_email_registered` only ever reads `auth.users`; it never writes to it.
- The recovery code is single use, consumed the moment `verify_recovery_code` succeeds; a failure in the password update step after that point means the same code cannot be retried, only a fresh one requested.
- A successful password update always attempts the `scope=others` sign out in the same request; if that particular call fails, the password change itself still stands (the user is not blocked from resetting their password by a session cleanup failure), but the failure is not silently invisible either, log it server side.
- The new password's minimum length (8 characters) is checked both client side and in the backend's request model; the client check is for fast feedback, the server check is the one that actually holds.
- `POST /auth/request-password-reset` is always rate limited per IP before `check_email_registered` runs; this limit exists specifically because of the enumeration behavior AC-3 accepts, and must not be removed if that behavior stays.

**Security model**:
- Both new endpoints are unauthenticated (pre login), matching `/auth/signup`, `/auth/login`, and `/auth/verify-signup` already in `backend/main.py`.
- `POST /auth/request-password-reset` deliberately reveals whether an email is registered (AC-3), a conscious deviation from the enumeration safe pattern `resend_confirmation_code` already uses elsewhere in this same file. This is a real security tradeoff; it is why this one endpoint carries its own per IP rate limit (AC-14), separate from anything Supabase applies.
- No new privileged credential is introduced. The email lookup reads `auth.users` through the connection this backend already holds (`DATABASE_URL`); no Supabase service role key is added.
- No user identity is trusted from client input anywhere in this flow; the account acted on is always the one Supabase's own verified recovery code resolves to.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: a registered user requests a reset, receives a code, submits it with a new matching password, is signed in and lands on the correct destination screen, verifies **AC-2**, **AC-6**, **AC-12**.
- Failure case: an expired code is submitted; the error distinguishes itself from a wrong code, the password is not changed, and no navigation happens, verifies **AC-7**. A new password identical to the current one is rejected with a clear message, verifies **AC-13**.
- Auth/permission: neither new endpoint accepts or requires a bearer token; a reset cannot be completed without a real code Supabase issued and verified, verifies **AC-6**, **AC-7**.

## Build plan

1. Backend: add `check_email_registered`, `send_password_reset`, `verify_recovery_code`, `finish_password_reset` to `backend/auth.py`, satisfies **AC-2**, **AC-3**, **AC-6**, **AC-7**, **AC-9**, **AC-10**, **AC-12**, **AC-13**
2. Backend: add `slowapi` to `requirements.txt`, wire its `Limiter` (in-memory backend) into `backend/main.py`, and apply it to `POST /auth/request-password-reset`, satisfies **AC-14**
3. Backend: add `POST /auth/request-password-reset` and `POST /auth/reset-password`, plus their request models (the `new_password` field validated for an 8 character minimum server side), to `backend/main.py`, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-9**, **AC-10**, **AC-13**
4. Mobile: add `useRequestPasswordReset` and `useResetPassword` hooks to `mobile/hooks/useAuth.ts`, mirroring `useResendConfirmation` and `useVerifySignup`; `useResetPassword`'s `onSuccess` reuses `completeAuth` and the same destination check `useLogin` already does. The Reset Password screen's "Resend code" action reuses `useRequestPasswordReset`, the same mutation as the initial request, not a separate hook. Satisfies **AC-2**, **AC-6**, **AC-8**
5. Mobile: add the request/response types to `mobile/types/api.ts`, satisfies **AC-2**, **AC-6**
6. Mobile: build `mobile/app/(auth)/forgot-password.tsx` (email field, submit, inline not found error, surfaces the 429 from AC-14 the same way as AC-9), satisfies **AC-2**, **AC-3**, **AC-14**
7. Mobile: build `mobile/app/(auth)/reset-password.tsx` (code, new password, confirm password fields, resend action with cooldown, invalid/expired/same-password error handling, the no email guard redirect), satisfies **AC-4**, **AC-5**, **AC-7**, **AC-8**, **AC-11**, **AC-13**
8. Mobile: add the "Forgot password?" link to `mobile/app/(auth)/login.tsx`, satisfies **AC-1**

## Consequences

**Positive**:
- Users who forget their password can recover their account and rating history themselves, closing a real gap with no support workaround today.
- Reuses an existing, proven UX pattern (the numeric code screen) instead of introducing a new one.
- No new database tables or custom token handling; Supabase Auth remains the single source of truth for authentication.

**Negative / tradeoffs**:
- `POST /auth/request-password-reset` is an email enumeration channel by design (AC-3): anyone can learn whether a given email has an account on this app. Every other auth endpoint in this codebase (`resend_confirmation_code`) deliberately avoids this. This was a conscious choice, not an oversight. ~~AC-14's per IP rate limit throttles casual or single source probing, but does not stop a determined attacker spreading requests across many IPs; revisit if abuse is observed.~~ **As of 2026-08-11, AC-14's limiter is removed** — this enumeration channel is now entirely unthrottled by this backend (Supabase's own upstream `/recover` rate limit is the only remaining backstop). Revisit if abuse is observed.
- This backend has no general rate limiting infrastructure; this spec adds `slowapi` as its first instance, scoped to exactly one route (`POST /auth/request-password-reset`), not a project wide rate limiting decision. Extending it to other endpoints is a separate, later call.
- `check_email_registered` reads Supabase's own `auth.users` table directly, a table this app's schema does not own; if Supabase changes that table's shape in a future project upgrade, this read could silently break. Worth a comment in the code pointing back to this spec.

**Neutral**:
- `mobile/context/design.md` §6.2 still says password reset is not built for MVP; that note is now stale and needs updating once this ships (see Follow-up, `/architect` does not edit `design.md` itself).

## Follow-up

- [ ] Update `mobile/context/design.md` §6.2 to remove the "No Forgot Password link for MVP" and "Password reset is not built for MVP" notes, and describe the two new screens, once this feature is built and verified (owned by `/sync`).
- [ ] Confirm the project's actual Supabase project (GoTrue version) supports the `logout?scope=others` parameter before `/develop` relies on it in `finish_password_reset`; this was not verified against live Supabase docs, per the engineer's choice to skip References for this spec. **2026-08-11**: this was live-observed as the root cause of a "code isn't valid" loop on real password resets -- see `mobile/hooks/useAuth.ts`'s `useResetPassword` fix below, which stopped a bad `scope=others` outcome from masking an already-successful reset. Still worth confirming directly against the Supabase project.
- [ ] Confirm the backend's `DATABASE_URL` connection role can read the `auth` schema (`auth.users`) before `/develop` relies on it in `check_email_registered`; Supabase's default connection string usually can for reads, but this was not verified against the live project.
- [x] ~~Consider extending `slowapi` rate limiting to other unauthenticated endpoints (`/auth/login`, `/auth/signup`) now that it exists in this backend for the first time; out of scope for this spec, which adds it narrowly for AC-14 only.~~ Moot as of 2026-08-11: `slowapi`/AC-14's limiter was removed from this backend entirely (see AC-14 above), so there is no longer an existing instance to extend.
- [x] Enrolled into `docs/scope/scope.md` as feature 11, Forgot password (Journey 1).
