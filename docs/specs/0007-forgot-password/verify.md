# Verify: forgot password · spec 0007 · updated 2026-08-10
_Steps derived from spec 0007 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open the Log In screen → a "Forgot password?" link is visible; it is not on the Sign Up screen → AC-1
- [ ] Tap "Forgot password?" → lands on the Request Reset screen → AC-1
- [ ] Submit a registered email on Request Reset → navigates to the Reset Password screen carrying that email → AC-2
- [ ] Submit an unregistered email on Request Reset → inline "No account found with that email" error shows, no navigation → AC-3
- [ ] On Reset Password, type mismatched password and confirm password values → submit stays blocked → AC-4
- [ ] On Reset Password, type a new password under 8 characters → submit stays blocked with no network call → AC-5
- [ ] Submit the real code plus a valid matching new/confirm password → signed in immediately, lands on tabs or onboarding matching what Log In would compute for that account → AC-6
- [ ] Submit a wrong code → distinguishing "code isn't right" inline error, no password change, no navigation → AC-7
- [ ] Submit an expired code → distinguishing "code has expired" inline error, no password change, no navigation → AC-7
- [ ] Submit a new password identical to the account's current password → clear "choose a different password" inline error, no navigation → AC-13
- [ ] Tap "Resend code" → new code sent (reuses the same request as the initial screen), 30s cooldown starts, matches confirm email's resend behavior → AC-8
- [ ] Navigate directly to the Reset Password route with no email param → redirected to Log In → AC-11
- [ ] After a successful reset, check a refresh token obtained on another device before the reset → it no longer works → AC-12
- [ ] After a successful reset, an access token already held by another device (not yet expired) keeps working until its own expiry → AC-12 (documents the known limit, not a bug)

## Commands
- [ ] `POST /auth/request-password-reset` with a registered email → `{"status": "ok"}`, a code is sent → AC-2
- [ ] `POST /auth/request-password-reset` with an unregistered email → 404 with `error_code: "email_not_found"` → AC-3
- [ ] `POST /auth/request-password-reset` or its resend, called repeatedly past Supabase's rate limit → 429 → AC-9
- [ ] `POST /auth/request-password-reset` called repeatedly from the same IP past the local `slowapi` limit → 429, returned before `check_email_registered` runs (no DB call made) → AC-14
- [ ] The same call from a different IP, still within its own limit → proceeds normally → AC-14
- [ ] `POST /auth/reset-password` with a correct, unexpired code and a valid new password → 200 with `access_token`, `refresh_token`, `user_id`; the account's password is changed → AC-6
- [ ] `POST /auth/reset-password` with an expired code → 400 `error_code: "otp_expired"` → AC-7
- [ ] `POST /auth/reset-password` with a wrong code → 400 `error_code: "otp_invalid"` → AC-7
- [ ] `POST /auth/reset-password` with a new password equal to the current one → 400 `error_code: "same_password"` → AC-13
- [ ] `POST /auth/reset-password` with a valid code but a new password under 8 characters → 422 from the request model's server side check → AC-5
- [ ] Simulate a Supabase/network failure during any of the three backend calls (request, verify, finish) → 503, not misread as an invalid credential; if it happens after the code was already verified, the response tells the user to request a new code → AC-10
- [ ] Reuse a code that already succeeded once → `otp_invalid` (single use, cannot be replayed) → AC-7
- [ ] After `POST /auth/reset-password` succeeds, attempt to use a refresh token issued to a session on a different device before the reset → rejected → AC-12
- [ ] Confirm `check_email_registered` only reads `auth.users`, never writes to it, and that no new Supabase credential was introduced → AC-3 (code review, not a runtime check)

## Acceptance-criteria coverage
- AC-1 … forgot password link visibility (Log In only) UI steps
- AC-2 … registered email request UI and command steps
- AC-3 … unregistered email UI and command steps, plus the `auth.users` read only code review
- AC-4 … password/confirm mismatch UI step
- AC-5 … client side minimum length UI step, plus the server side 422 command step
- AC-6 … successful reset UI and command steps
- AC-7 … wrong code, expired code, and replayed code UI and command steps
- AC-8 … resend code UI step
- AC-9 … rate limit command step
- AC-10 … outage command step, including the "request a new code" copy after a post-verify failure
- AC-11 … no email param redirect UI step
- AC-12 … other session revoked UI and command steps, plus the documented access token expiry limit
- AC-13 … same password rejection UI and command steps
- AC-14 … per IP rate limit command steps
