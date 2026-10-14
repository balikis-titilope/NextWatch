# 0009. App store submission readiness: rationale

## Context

NextWatch has no privacy policy, no terms of service, and no way for a user to delete their account. `docs/scope/scope.md` lists this under Deferred: "this build targets dev/internal use, not store review, for now." The engineer now wants to move toward a real submission to both the iOS App Store and Google Play, so these gaps have to close.

Two forces make this more than a simple checklist. First, both stores treat account deletion as a hard requirement, not a nice to have, for any app that lets a user create an account (NextWatch's whole flow is built around a real Supabase account, no anonymous mode). Apple's Guideline 5.1.1(v) requires the option to be easy to find and to result in a real deletion of the account and its data. Google Play's User Data policy goes further: it requires both an in app path and a path reachable on the open web, outside the app, and it explicitly does not accept mere deactivation as satisfying the requirement (policy update effective April 15, 2026, with a 30 day compliance window at the time of writing).

Second, this touches data the app was never built to remove. `ratings` and `notifications` both reference `users(id)` with no cascade behavior; `users.id` itself cascades from `auth.users(id)`, but a delete would still fail on the two child tables today. Any account deletion design has to account for this schema gap, not just add a button.

The consequence of not deciding this now: the app stays unable to reach either store, since both platforms reject a submission with account creation and no deletion path, and neither accepts a privacy policy that does not exist.

## Options considered

### A. Scope breadth: the three deferred items only, vs. full submission readiness

**Option 1: Just privacy policy, terms, and account deletion.** The narrowest reading of the scope's Deferred line.
**Pros**: smaller spec, faster to ship.
**Cons**: leaves bundle identifier, EAS build and submit config, and the store privacy declarations undesigned; a real submission attempt would stall on missing app.config.ts fields and an unconfigured EAS project, forcing a second design pass shortly after this one.

**Option 2: Full submission readiness (legal screens, account deletion, app identity and build config, store metadata and privacy declarations).** What the engineer chose.
**Pros**: one coherent pass instead of two; the four pieces share real dependencies (the hosted policy URL feeds both consoles' required fields; the account deletion flow feeds the data safety declarations).
**Cons**: a bigger spec, split into four child specs to stay scannable.

Chosen: Option 2, full submission readiness, as an umbrella of four child specs.

### B. Account deletion mechanism: hard delete immediately, vs. deactivate then purge

**Option 1: Hard delete on request.** The account and its rows are removed the moment the user confirms.
**Pros**: simplest state machine, no purge job to run.
**Cons**: no recovery from a mistaken or coerced deletion; Apple's own guidance explicitly allows a grace period, so this gives up a real user protection for no compliance benefit.

**Option 2: Deactivate immediately, hard delete after a 30 day window.** What the engineer chose. `users.deactivated_at` marks the request; a daily job purges accounts past the window.
**Pros**: a real, if time boxed, recovery path; matches the pattern Apple's guideline explicitly permits ("grace periods... permitted"); reuses the daily APScheduler job pattern spec 0006 already established for re engagement scanning.
**Cons**: more moving parts (a new column, a purge job, a reactivate flow, a server side gate on every write); the account is described to the user as "delete", but for 30 days the underlying rows still exist, which must be handled carefully in how the flow is worded so it is not misleading.

Google Play's "temporary deactivation does not qualify" language is about the end state, not the existence of a grace period: as long as the account and its data are genuinely and automatically removed at the end of the window with no further action from the user, this reads as a delete with a grace period, not a deactivation. Both stores' guidance explicitly allows this shape (see References).

Chosen: Option 2.

### C. The web accessible deletion path Google Play requires

**Option 1: A self service web form (email and password), reusing the same account logic the in app flow uses.**
**Pros**: genuinely self service, satisfies Google's "accessible path" language without adding a manual process; small addition given the deactivation logic already exists as a shared function.
**Cons**: one more public facing surface to secure (rate limiting, the same password check the in app flow already does).

**Option 2: A static page pointing to a support email, processed by hand.**
**Pros**: almost no new code.
**Cons**: does not scale past a handful of requests, is a weaker fit for "accessible path" since it depends on a person acting on it, and risks a slower actual deletion than the 30 day window promises the user.

Chosen: Option 1, following the engineer's answer.

## Rationale

The account deletion design (deactivate, then purge after 30 days) is the one piece of this spec that is genuinely a compliance decision rather than an implementation detail, so it gets the most scrutiny. The forces above (Apple's explicit grace period allowance, the existing spec 0006 job pattern, and the schema's current lack of any soft delete anywhere) all point the same direction: reuse the daily job pattern, add one nullable timestamp, and be explicit in the UI copy that the account is scheduled for deletion, not merely paused, so the "delete means delete" expectation both stores apply is met in substance even though the underlying rows persist briefly.

The web deletion form (Option C.1) was chosen over the support email path because Google Play's requirement is about substance, not appearance: a request that depends on a human noticing and acting on an email is not really an accessible, self service path, and this project already has the password verification logic needed to build the self service version cheaply.

## Landscape research (web verified, August 12, 2026)

A background research pass checked the current text of both platforms' policies and the current EAS documentation before this spec was written. Full report cached at `docs/.agent-cache/research/app-store-submission-readiness.md`.

- **Apple Guideline 5.1.1(v)**: in app deletion required, easy to find (typically in Settings), must remove the account and its personal data, not just deactivate it. No requirement for instant deletion; a stated timeline with confirmation is acceptable, and a grace period is explicitly permitted.
- **Google Play User Data policy**: requires both an in app path and a path reachable outside the app (e.g. a web form). States plainly that temporary deactivation does not satisfy the requirement. Policy update effective April 15, 2026.
- **Apple App Privacy details**: for this app's actual data collection (email for auth, a user id, ratings and taste history, Sentry and PostHog analytics keyed to the user id, never email or name per `mobile/lib/telemetry.ts`'s `identifyUser`), expect to declare Contact Info, User ID, browsing or usage history, and Analytics categories.
- **Google Play Data Safety form**: the same four categories map onto Play Console's own taxonomy (Contact Info, Activity or Usage data, device identifiers for Sentry and PostHog, Analytics).
- **Expo EAS Build and Submit**: current recommended setup is three `eas.json` build profiles (development, preview, production) and EAS's own remote credential management rather than a local `credentials.json`; iOS submission needs an Apple Developer Program membership and an App Store Connect API key, Android needs a Google Play service account JSON file.

This research is a snapshot from a single automated pass, not a legal review. Both stores' policy wording changes over time; the engineer should reread the current Apple and Google pages linked below directly in App Store Connect and Play Console at the time of the actual submission, not rely solely on this spec.

## References

**Project sources** (verifiable, in this repo):
- `backend/db/import_data.py`, the `users`, `ratings`, and `notifications` table definitions and their existing foreign keys
- `backend/db/migrations/0003_notifications.sql` and the `AsyncIOScheduler` setup in `backend/main.py`'s `lifespan`, the daily job pattern this spec reuses for the purge job
- `backend/auth.py`, the existing `sign_in`, `finish_password_reset`'s session revocation call, and `check_email_registered`'s direct query against `auth.users`
- `mobile/lib/telemetry.ts`, confirming only a user id (never email or name) reaches Sentry or PostHog
- spec [0006](../0006-notifications/index.md), the re engagement scan pattern this spec's purge job mirrors
- spec [0007](../0007-forgot-password/index.md), the password based confirmation and session revocation pattern this spec's account deletion flow mirrors
- the `eas-workflows` community skill (`mobile/.agents/skills/eas-workflows/`), referenced by the app identity and build config child spec

**Practices & standards**:
- soft delete with a bounded, automatically enforced grace period, as distinct from an indefinite or user triggered soft delete
- reusing an existing password verification path for a destructive account action, rather than inventing a second one

**Links** (web verified, August 12, 2026):
- Offering account deletion in your app (Apple): https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Understanding Google Play's app account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- App Store Connect App Privacy details (Apple): https://developer.apple.com/app-store/app-privacy-details/
- Google Play Data safety section: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- EAS Build introduction (Expo): https://docs.expo.dev/build/introduction/
- Configure EAS Submit with eas.json (Expo): https://docs.expo.dev/submit/eas-json/
- Using existing credentials (Expo): https://docs.expo.dev/app-signing/existing-credentials/
