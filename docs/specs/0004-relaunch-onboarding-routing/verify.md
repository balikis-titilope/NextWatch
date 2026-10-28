# Verify: account & getting started · spec 0004 · updated 2026-08-08
_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] With no saved login, launch the app → lands on `(auth)/login`, no `/me` or `/auth/refresh` network call fires → AC-1
- [ ] Sign up with a new email/password on `(auth)/signup` → routes straight to `/onboarding`, no launch-style check in between → AC-8
- [ ] On `/onboarding`, search a locally known title, tap a result, tap stars to rate 3+ movies → each star tap fires `POST /ratings`; "Done" appears only once ≥3 are rated → AC-5, value: onboarding search/add/rate
- [ ] Tap "Skip" (or "Done") → app moves to `(tabs)` immediately, before `POST /me/onboarding/complete` resolves → AC-5
- [ ] Relaunch after Skip/Done → routes straight to `(tabs)`, never back to onboarding → AC-2, AC-5
- [ ] Log in with an account that already completed onboarding on another session → routes to `(tabs)`, not `/onboarding` → AC-9
- [ ] Log in with an account that has not completed onboarding → routes to `/onboarding` → AC-9
- [ ] With a valid saved login, force the stored access token to be near/expired (or wait past its lifetime) and relaunch → app silently renews via `/auth/refresh` and reaches `(tabs)`/`onboarding` without ever showing the sign in screen → AC-3
- [ ] Revoke/invalidate the stored refresh token (e.g. clear it server-side or corrupt it) and relaunch → stored credentials are cleared, app routes to `(auth)/login` → AC-4
- [ ] With the backend unreachable (stop it) and a valid saved login, relaunch → app routes to `(auth)/login` but keeps the stored credentials (restart the backend and relaunch again → resolves normally without a fresh login) → AC-10
- [ ] Throttle/disconnect network at launch so resolution can't finish inside the timeout → splash stays up the whole time (no blank frame), then routes to `(auth)/login` with credentials intact → AC-7, AC-10
- [ ] While signed in, force a request to 401 (e.g. tamper with the stored access token) → app silently renews and retries once, no visible interruption → AC-3, AC-6 (fire two such requests at once → only one `/auth/refresh` call fires, both resume together)
- [ ] Force a renewed-but-still-401 case (e.g. revoke the refresh token between the first 401 and the retry) → credentials are cleared and the app navigates back to `(auth)/login` from wherever it was (not just at launch) → AC-11, AC-4/AC-6 build task's `_layout.tsx` redirect effect
- [ ] Sign up with a new email against the live Supabase project (task 11 done: "Confirm email" on, custom SMTP configured, template sends `{{ .Token }}`) → app shows `(auth)/confirm-email` with the entered address, no credentials stored yet → AC-12
- [ ] Enter the real code from the confirmation email on `(auth)/confirm-email` → signs in (stores credentials), routes to `/onboarding` → AC-13
- [ ] Enter a wrong code → inline error shown, screen stays usable, code field still editable → AC-14
- [ ] Wait past the 10-minute OTP expiry, then enter the (now expired) code → inline error text distinguishes "expired" from "wrong" (via `error_code: "otp_expired"` vs `"otp_invalid"`) → AC-14
- [ ] Tap "Resend code" before the 30s client-side cooldown ends → button stays disabled and counting down, no request sent → AC-15
- [ ] Tap "Resend code" again once the cooldown clears → a new code arrives, cooldown restarts → AC-15
- [ ] Trigger Supabase's own rate limit (several resends in quick succession) → "wait a bit" message, not a generic error → AC-15
- [ ] Attempt to log in with the correct password on an account that hasn't confirmed → distinguishing message ("Confirm your email before logging in.") plus a "Confirm your email" link, not the generic invalid-credentials copy → AC-16
- [ ] Tap that link → lands on `(auth)/confirm-email` prefilled with the entered address, and a fresh code has already been requested (`autoResend`) by the time the screen opens → AC-16
- [ ] Sign up against a Supabase project/account where confirmation is not required (or already confirmed) → routes straight into `/onboarding`, no confirm-email screen shown → AC-8 (revised)
- [ ] Sign up again with an already-registered email → response/UI looks identical to a fresh `confirmation_required` signup (no distinguishable error); use the confirm-email screen's "Already have an account? Log in instead" link as the way out → supports AC-12

## Commands
- [ ] `curl $API_BASE_URL/me -H "Authorization: Bearer <valid token>"` → `{"user_id": "...", "onboarding_completed": false}` for a fresh signup → AC-2, value: `GET /me` sourcing
- [ ] `curl -X POST $API_BASE_URL/me/onboarding/complete -H "Authorization: Bearer <token>"` twice in a row → both return `{"status": "ok"}`, no error on the second (idempotent) → AC-5
- [ ] `curl -X POST $API_BASE_URL/me/onboarding/complete -H "Authorization: Bearer <token for an account with no public.users row>"` → still returns `{"status": "ok"}`, and a follow-up `GET /me` shows `onboarding_completed: true` → AC-5, value: upsert-guarantees-row-exists
- [ ] `curl -X POST $API_BASE_URL/auth/refresh -d '{"refresh_token": "<valid>"}'` → 200 with a new `access_token`/`refresh_token`/`user_id` → AC-3, value: `POST /auth/refresh` sourcing
- [ ] `curl -X POST $API_BASE_URL/auth/refresh -d '{"refresh_token": "garbage"}'` → 401 (explicit rejection) → AC-4
- [ ] With Supabase temporarily unreachable, `curl -X POST $API_BASE_URL/auth/refresh -d '{"refresh_token": "<valid>"}'` → 503, not 401 → AC-10
- [ ] `curl $API_BASE_URL/me` with no `Authorization` header → 401, no account data → security model check
- [ ] `psql`/Supabase SQL: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users'` → confirms `onboarding_completed boolean not null default false` is live on the real database, not just the migration file → data layer done-ness check
- [ ] `cd mobile && npm run typecheck && npm run lint && npm test -- --watchAll=false` → all clean (ran during this build: typecheck clean, lint clean, 114/114 tests pass)
- [ ] `cd backend && python -m unittest test_auth_refresh -v` → passes, unaffected by this change (ran during this build: 6/6 pass)
- [ ] `curl -X POST $API_BASE_URL/auth/signup -d '{"email":"<new>","password":"<pw>"}'` against the live Supabase project with "Confirm email" on → `{"status": "confirmation_required", "email": "<new>"}` → AC-12, value: `POST /auth/signup`'s `status` sourcing
- [ ] `curl -X POST $API_BASE_URL/auth/verify-signup -d '{"email":"<new>","token":"<real code>"}'` → 200 with `access_token`/`refresh_token`/`user_id` → AC-13
- [ ] `curl -X POST $API_BASE_URL/auth/verify-signup -d '{"email":"<new>","token":"000000"}'` (wrong code) → 400 with `error_code` in the body → AC-14
- [ ] `curl -X POST $API_BASE_URL/auth/resend-confirmation -d '{"email":"<any>"}'` → always `{"status": "ok"}`, whether `<any>` is registered, confirmed, or unknown → AC-15, value: `POST /auth/resend-confirmation` never reveals which
- [ ] `curl -X POST $API_BASE_URL/auth/login -d '{"email":"<unconfirmed>","password":"<correct pw>"}'` → 403 with `{"detail": {"error_code": "email_not_confirmed", ...}}` → AC-16, value: `POST /auth/login`'s 403 sourcing

## Acceptance-criteria coverage
- AC-1 … no saved login, launch → auth, no network call · manual step 1
- AC-2 … stored login resolves → routed by `onboarding_completed` · manual steps 5, 6, 7; command step 1
- AC-3 … expired/missing access token + valid refresh → silent renewal, user never sees sign in · manual steps 8, 13
- AC-4 … explicit refresh rejection → credentials cleared, routes to auth · manual step 9; command step 5
- AC-5 … Skip/Done marks complete, idempotent, non-blocking, bounded retry, never forces sign-out · manual steps 3, 4, 5; command steps 2, 3
- AC-6 … concurrent 401s share one renewal · manual step 13 (parenthetical)
- AC-7 … splash stays up until resolved, one fixed timeout · manual step 11
- AC-8 … fresh signup always starts incomplete, routes straight to onboarding · manual step 2
- AC-9 … login routed by the same `onboarding_completed` check as launch · manual steps 6, 7
- AC-10 … non-rejection failure (offline/5xx/timeout) → auth, credentials kept · manual steps 10, 11; command step 6
- AC-11 … retried request still 401 after renewal → terminal, credentials cleared, no loop · manual step 14
- AC-8 (revised) … no-confirmation-needed signup still routes straight to onboarding · manual step "Sign up against a Supabase project/account where confirmation is not required"
- AC-12 … signup returns `confirmation_required`, no credentials stored, confirm-email screen shown · manual step 1 (blocked on task 11); command step "POST /auth/signup … confirmation_required"; repeat-signup step
- AC-13 … correct code signs in and routes to onboarding · manual step "Enter the real code…"; command step "POST /auth/verify-signup … real code"
- AC-14 … wrong/expired code shows a distinguishing inline error, screen stays usable · manual steps "Enter a wrong code…", "Wait past the 10-minute OTP expiry…"; command step "POST /auth/verify-signup … wrong code"
- AC-15 … resend cooldown (client) + Supabase rate limit (server), response never reveals which email is real · manual steps "Tap Resend…" (×3); command step "POST /auth/resend-confirmation"
- AC-16 … login on an unconfirmed account shows a distinguishing message + link, auto-resend fires on arrival · manual steps "Attempt to log in…", "Tap that link…"; command step "POST /auth/login … 403"

**Note**: build task 11 (Supabase dashboard: "Confirm email" on, custom SMTP configured, template switched to send `{{ .Token }}`, OTP expiry set to 10 minutes) is done — the engineer completed it by hand on 2026-08-08. The email-confirmation steps above (AC-12 through AC-16, AC-8 revised) are now exercisable against the live project.
