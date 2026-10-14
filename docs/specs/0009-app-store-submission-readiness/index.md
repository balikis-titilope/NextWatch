# 0009. App store submission readiness

**Date**: 2026-08-12
**Status**: In Progress

## Summary

This spec makes NextWatch ready to submit to the iOS App Store and Google Play, closing the three items `docs/scope/scope.md` had marked deferred (privacy policy, terms, account deletion) plus the build and store configuration a real submission also needs. It splits into four parts: legal screens and consent, account deactivation and deletion, app identity and build config, and store metadata and privacy declarations. Together they cover everything both stores require before the app can be reviewed, including a 30 day, recoverable account deletion flow and a web page a user can reach without opening the app, which Google Play specifically requires.

## Structure

This is an umbrella spec. Each child is self sufficient to build from on its own.

- [0009-legal-screens-consent.md](0009-legal-screens-consent.md): the Privacy Policy and Terms of Service, hosted at a public URL and linked from signup and Profile. Both stores require a working privacy policy URL before they will even accept a submission.
- [0009-account-deactivation-deletion.md](0009-account-deactivation-deletion.md): the account deletion flow itself (deactivate now, permanently purge after 30 days), the schema and backend changes it needs, and the web form Google Play requires outside the app. Satisfies Apple Guideline 5.1.1(v) and Google Play's User Data policy.
- [0009-app-identity-build-config.md](0009-app-identity-build-config.md): the bundle identifier and package name, EAS build and submit profiles, and versioning, the mechanics of actually producing a store ready build.
- [0009-store-metadata-privacy-declarations.md](0009-store-metadata-privacy-declarations.md): what to declare in Apple's App Privacy details and Google Play's Data Safety form, given what this app actually collects.

## Requirements

**User stories**:
- As a prospective user browsing either store, I want to read a real privacy policy and terms of service before I create an account.
- As a user, I want a clear way to delete my account and its data, both from inside the app and from a web page if I no longer have the app installed.
- As the engineer, I want a real, submittable build (correct bundle identifier, EAS profiles, store metadata) so a submission is not blocked on missing configuration.

**Acceptance criteria** (the umbrella level bar; each child spec carries its own detailed criteria):
- **AC-1**: A Privacy Policy and a Terms of Service are reachable at a public URL and linked from the signup screen and Profile.
- **AC-2**: A signed in user can request account deletion from Profile; the account is deactivated immediately, permanently removed after 30 days, and recoverable by logging back in before then.
- **AC-3**: A user can also request account deletion from a web page that does not require the app to be installed.
- **AC-4**: `app.config.ts` has a real bundle identifier and package name, and `eas.json` has working development, preview, and production build profiles plus submit profiles for both stores.
- **AC-5**: The data types this app actually collects (email, ratings and taste history, Sentry and PostHog analytics keyed to a user id) are documented for both Apple's App Privacy details and Google Play's Data Safety form.

## Decision

**Chosen option**: build all four pieces now, as one coherent pass, rather than the three deferred items alone. Full comparison against the narrower scope: see [rationale.md](rationale.md).

**Implementation skills**: `eas-workflows` (`wshobson/agents`, `mobile/.agents/skills/eas-workflows/`)

## Cross child contract

Pieces shared across more than one child, so they are decided once here rather than redecided per child:

- **Legal and deletion web routes share one backend base.** `GET /legal/privacy-policy`, `GET /legal/terms`, `GET /legal/support`, and the `GET`/`POST /legal/delete-account` form all live on the existing FastAPI backend, under the same `EXPO_PUBLIC_API_BASE_URL` domain the mobile app already calls. No new hosting target. `POST /legal/delete-account` alone is rate limited (`slowapi`), since it is the only one of the four that checks a password.
- **One new secret, used by account deletion only**: `SUPABASE_SERVICE_ROLE_KEY`, needed to hard delete the Supabase Auth user at purge time. Never referenced by the mobile app or any `EXPO_PUBLIC_` variable.
- **The bundle identifier decided in the app identity child (`com.nextwatch.app`) is what both the EAS submit profiles and the store metadata child's console entries are configured against.** Keep it consistent across `app.config.ts`, `eas.json`, App Store Connect, and Play Console.
- **The account deletion flow's actual behavior (30 day grace period, then a real delete) is what the store metadata child declares in the Data Safety form's deletion fields.** If the deletion child's design changes, the declaration in the metadata child must be updated to match, or the app's own store listing becomes inaccurate.

## Build plan

Ordered by what each piece unblocks, not a fixed recipe: app identity and build config first, since it is what makes a real device build possible to test everything else against; then the two user facing pieces; store metadata last, since its declarations describe the other three.

1. Build app identity and build config (see [0009-app-identity-build-config.md](0009-app-identity-build-config.md)), unblocks real EAS builds for testing the rest of this spec on device
2. Build legal screens and consent (see [0009-legal-screens-consent.md](0009-legal-screens-consent.md))
3. Build account deactivation and deletion (see [0009-account-deactivation-deletion.md](0009-account-deactivation-deletion.md))
4. Build store metadata and privacy declarations (see [0009-store-metadata-privacy-declarations.md](0009-store-metadata-privacy-declarations.md)), satisfying **AC-5**, and depends on tasks 2 and 3 being real so its declarations describe actual behavior

## Consequences

**Positive**:
- The app becomes submittable to both stores; nothing here is optional for a first submission.
- The account deletion design (deactivate, then purge) gives users a genuine recovery window instead of an irreversible tap, while still satisfying both stores' requirement that deletion actually happen.
- The backend gains a real path to remove a user's data completely, closing a gap (no delete anywhere in the schema) that existed before this spec.

**Negative / tradeoffs**:
- A new secret (`SUPABASE_SERVICE_ROLE_KEY`) has to be managed and kept out of version control and out of the mobile app.
- The web deletion form is a new, unauthenticated facing surface (reachable by anyone who knows an account's email and password, which is the intended use, but also means it needs the same care as the login endpoint).
- Four child specs is more to read than one, though each is scoped to a single build task.

**Neutral**:
- No change to any screen or flow outside Profile, signup, and the new legal and deletion web pages.

## Follow-up

- [ ] The landscape research behind the account deletion and store metadata children is a single automated pass, not a legal review (see rationale.md). Reread Apple's and Google's current policy pages directly at submission time.
- [ ] Store listing assets (screenshots, marketing copy, support URL beyond what's already decided) are out of scope for this spec; they are store console work, not app code.
- [ ] App icon and splash assets already exist (`mobile/assets/icon.png`, the Android adaptive icon layers, `logo.png`); verify they meet each store's exact size and format requirements before the first submission, not assumed here.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
