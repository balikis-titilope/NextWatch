# Verify: error monitoring & product analytics · spec 0003 · updated 2026-08-08
_Steps derived from spec 0003's own Verification section (this is a standard, not a data backed feature, so there is no AC-N list; steps are tied to the spec's stated checks instead). `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Build a real preview build (`eas build --profile preview`, not Expo Go, not a dev client — telemetry is disabled whenever `__DEV__` is true) → app runs normally → standard: telemetry only activates outside local dev
- [ ] Trigger an unhandled render error in any screen on that build → `ErrorBoundary` fallback renders ("Something went wrong" / "Try again", `PrimaryButton`) instead of a crash or blank screen → standard: render errors are caught, not fatal
- [ ] Confirm the same error appears in Sentry's Issues view within seconds, with a readable (symbolicated, not minified) stack trace → standard: requires `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` set as EAS secrets before this build, or the trace stays minified
- [ ] Tap "Try again" on the fallback screen → app remounts from `/` with a cleared query cache, does not re-render the same broken subtree → standard: retry recovers instead of looping
- [ ] Force a network failure (e.g. kill the backend) against any screen making a request → error reaches Sentry Issues → standard: network failures are forwarded
- [ ] Trigger a routine 4xx (e.g. an invalid request) → confirm it does **not** appear in Sentry, only in the screen's own error state → standard: routine 4xx responses don't flood Sentry
- [ ] Once Journey 1 (Account & getting started) ships: complete a signup on a real build → `signup_completed` appears in PostHog's Live Events, and the user is identified (Sentry `setUser` + PostHog `identify`) with only a user id, no email/name → standard: the three named events, deferred until their call sites exist
- [ ] Once Journey 1 ships: submit a rating → `rating_submitted` appears in PostHog with `{ movie_id, rating }` → same deferral as above
- [ ] Once Journey 2 (Discover & decide) ships: tap a recommendation on Home → `recommendation_tapped` appears in PostHog with `{ movie_id, position, source_row }` → same deferral as above
- [ ] On a local dev build (Expo Go or dev client) repeat any of the above → nothing reaches Sentry or PostHog → standard: telemetry never pollutes real dashboards during development

## Commands
- [ ] `npm run typecheck` → passes → confirms `lib/telemetry.ts`, `ErrorBoundary.tsx`, and the `QueryClient` wiring compile clean
- [ ] `npm run lint` → passes → confirms the `no-restricted-imports` rule is active and no file outside `lib/telemetry.ts` imports `@sentry/react-native` or `posthog-react-native` directly
- [ ] `npm test` → all suites pass → confirms the existing suite (including `app/__tests__/_layout.test.tsx`) still passes with telemetry wired at root

## Acceptance-criteria coverage
_No `AC-N` list (spec 0003 is a standard definition, not a data backed feature); each step above is tied to the specific line in the spec's own "Verification" section it proves instead._
