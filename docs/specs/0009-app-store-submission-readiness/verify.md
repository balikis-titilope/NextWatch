# Verify: app store submission readiness · spec 0009 · updated 2026-08-13

_Steps derived from spec 0009's acceptance criteria (index.md and its four child specs). `/check verify` runs these; `/test` locks the durable ones. Store metadata and privacy declarations (the fourth child) is pure console configuration with no code surface, so it has no steps here — see its Follow-up instead._

## UI / manual

- [ ] Sign up screen shows a consent line naming both documents, each a tappable link → tapping opens the system browser at `/legal/privacy-policy` or `/legal/terms` → AC-2, AC-4 (legal-screens-consent)
- [ ] Profile (while active) has permanent Privacy Policy and Terms of Service entries → tapping opens the system browser → AC-3, AC-4 (legal-screens-consent)
- [ ] Profile has a "Delete Account" action visually separate from Sign Out → tapping opens the confirm screen → AC-1 (account-deactivation-deletion)
- [ ] On the confirm screen, submit with the wrong password → rejected, nothing changes → AC-1
- [ ] Submit with the correct password but confirm word not exactly `DELETE` → blocked client-side (button stays disabled) → AC-1
- [ ] Submit with correct password + `DELETE` → success screen shows the 30 day message → AC-1, AC-2
- [ ] After deactivating, relaunch the app (or log in again) → reactivate prompt (`/reactivate`) shows instead of tabs/onboarding → AC-4
- [ ] On the reactivate prompt, tap "Reactivate My Account" → routes into onboarding or tabs per the account's `onboarding_completed`, `GET /me`'s `deactivated_at` is now null → AC-5
- [ ] On the reactivate prompt, tap "Not now" → signed out, back at the login screen → AC-5
- [ ] Visit `/legal/delete-account` in a browser with no app installed → plain HTML form (email, password) → AC-6
- [ ] Submit that form with a real account's credentials → HTML confirmation page, account deactivated the same as the in-app flow → AC-6
- [ ] Submit that form with a wrong password → HTML page re-rendered with an inline error, not a raw HTTP error page → AC-6 (Key errors)

## Commands

- [ ] `grep -n "bundleIdentifier\|package:" mobile/app.config.ts` → both set to `com.nextwatch.app` → AC-1 (app-identity-build-config)
- [ ] `cat mobile/eas.json` → `build.development`, `build.preview`, `build.production` all present; `submit.production.ios`, `submit.production.android` present; `cli.appVersionSource` is `"remote"` → AC-2, AC-3, AC-4 (app-identity-build-config)
- [ ] `curl -i $EXPO_PUBLIC_API_BASE_URL/legal/privacy-policy` → 200, HTML body, no `Authorization` header sent → AC-1 (legal-screens-consent)
- [ ] `curl -i $EXPO_PUBLIC_API_BASE_URL/legal/terms` → 200, HTML body → AC-1
- [ ] `curl -i $EXPO_PUBLIC_API_BASE_URL/legal/support` → 200, HTML body naming a real support email → AC-5
- [ ] `curl -X POST $EXPO_PUBLIC_API_BASE_URL/ratings -H "Authorization: Bearer <a deactivated account's token>" -d '{"movie_id":1,"rating":5}'` → 403 → AC-3 (account-deactivation-deletion)
- [ ] Same deactivated account: `curl $EXPO_PUBLIC_API_BASE_URL/me -H "Authorization: Bearer <token>"` → 200, `deactivated_at` populated (reads stay open, per Key invariants) → AC-3
- [ ] Deactivate a test account, then in Postgres: `UPDATE users SET deactivated_at = now() - interval '31 days' WHERE id = '<test id>'`, then call `run_daily_purge()` (or wait for the `hour=3 UTC` job) → the account's row, its ratings, and its notifications are all gone (cascade) → AC-7
- [ ] Deactivate one test account and leave a second active; run the re-engagement scan and the recommendations-ready threshold check against both → only the active account is eligible → AC-8
- [ ] Hit `POST /legal/delete-account` 6 times in under an hour from the same IP → the 6th returns 429 → AC-9

## Acceptance-criteria coverage

- **app-identity-build-config**: AC-1, AC-2, AC-3, AC-4 covered above. AC-5 (EAS credentials via remote management) not yet verifiable — blocked on Apple Developer Program / Google Play Console enrollment (spec's own Follow-up), still a manual prerequisite.
- **legal-screens-consent**: AC-1 through AC-5 covered above.
- **account-deactivation-deletion**: AC-1 through AC-9 covered above.
- **store-metadata-privacy-declarations**: AC-1 through AC-4 are console-only (Apple App Privacy details, Google Play Data Safety form) — no code, no automated step; verify by reading the console forms against the child spec's Value sourcing table at submission time, once the developer accounts above exist.
