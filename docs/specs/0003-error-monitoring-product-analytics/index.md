# 0003. Wire Sentry and PostHog as the mobile app's error monitoring and product analytics standard

**Date**: 2026-08-08
**Status**: In Progress

_Decision history (context, options considered, rationale) is in [`rationale.md`](rationale.md). This file holds the build spec: the decision, the standard every screen follows, and what still needs to happen._

## Summary

NextWatch's mobile app gets two new tools wired once at the root layout: Sentry to catch crashes with a real stack trace, and PostHog to record what people actually do (sign up, rate a movie, tap a recommendation). Every screen talks to them through one shared module instead of calling either tool directly, so the app can swap either vendor later without touching every screen. Nothing runs in local development builds, only in real (preview or production) builds, so testing on a phone during development never pollutes the real dashboards.

## Decision

**Chosen option**: Two specialized tools, Sentry for crash and error monitoring, PostHog for product analytics (see [`rationale.md`](rationale.md) Option 1).

Both are wired through one shared module, `mobile/lib/telemetry.ts`, so no screen imports either vendor's SDK directly.

**Implementation skills**: `sentry-react-native-sdk` (`getsentry/sentry-agent-skills`, `.agents/skills/sentry-react-native-sdk/`) · `instrument-product-analytics` (`posthog/ai-plugin`, `.agents/skills/instrument-product-analytics/`)

## Rationale

See [`rationale.md`](rationale.md) for the full reasoning. In short: the Expo managed workflow rules out anything needing native project files (Firebase's suite); wanting genuinely good crash diagnostics and genuinely good product analytics, not an adequate version of each, rules out a single bolt on tool; and both chosen tools have a real, already installed Agent Skill that teaches their actual Expo specific setup.

## Standard definition

**Canonical pattern**: every screen, hook, or mutation calls the shared wrapper, never the vendor SDKs directly.

```typescript
// mobile/lib/telemetry.ts
import * as Sentry from "@sentry/react-native";
import { PostHog } from "posthog-react-native";
import Constants from "expo-constants";

let posthogClient: PostHog | null = null;

// Read live, not cached at module load: Jest always sets __DEV__ true, so a
// frozen module-level constant would make every function below a permanent
// no-op and the module untestable.
function isEnabled() {
  return !__DEV__;
}

export function initTelemetry() {
  if (!isEnabled()) return;

  const { sentryDsn, posthogApiKey, posthogHost } = Constants.expoConfig?.extra ?? {};
  if (!sentryDsn || !posthogApiKey) {
    // This is a real (preview/production) build that shipped without its EAS
    // env vars. Warn and stay disabled, never throw: initTelemetry() runs
    // before the error boundary exists and before Sentry itself would be
    // initialized, so throwing here would brick the app at launch for every
    // user, with no way to even report it. Unlike EXPO_PUBLIC_API_BASE_URL in
    // lib/api.ts (required in every build, the app is unusable without it),
    // telemetry is additive: the app should keep working without it.
    console.warn("Telemetry env vars missing in a non-dev build; Sentry and PostHog stay disabled.");
    return;
  }

  try {
    Sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: 0, // performance tracing is out of scope for this spec
      sendDefaultPii: false,
    });
    posthogClient = new PostHog(posthogApiKey, {
      host: posthogHost ?? "https://us.i.posthog.com",
      flushAt: 1, // low volume app; flush every event rather than risk losing a batch
    });
  } catch (error) {
    // A malformed DSN or key should not be able to crash the app either.
    console.warn("Telemetry failed to initialize", error);
  }
}

// Call in the signup and login mutations' onSuccess. Only the user id is
// sent, never email or name, to keep what reaches either vendor to a
// minimum. PostHog's identify() automatically merges the anonymous
// distinct_id used for any pre-login events into this one; no alias() call
// is needed.
export function identifyUser(userId: string) {
  if (!isEnabled()) return;
  Sentry.setUser({ id: userId });
  posthogClient?.identify(userId);
}

// Call on sign out.
export function resetUser() {
  if (!isEnabled()) return;
  Sentry.setUser(null);
  posthogClient?.reset();
}

export function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (!isEnabled()) return;
  posthogClient?.capture(name, properties);
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!isEnabled()) {
    console.error(error);
    return;
  }
  Sentry.captureException(error, { extra: context });
}
```

`@sentry/react-native`'s own `Sentry.init()` automatically installs a global handler for uncaught JS exceptions and unhandled promise rejections; no extra wiring is needed for those beyond the `initTelemetry()` call itself. The `ErrorBoundary` below only covers render-time errors, which React's own error boundaries cannot catch automatically.

**`app.config.ts` wiring** (extends the existing `extra` bridge pattern `mobile/lib/api.ts` already reads `apiBaseUrl` through, rather than reading `process.env` directly from app code):

```typescript
plugins: [
  "expo-router",
  "expo-secure-store",
  "expo-font",
  [
    "@sentry/react-native/expo",
    { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, url: "https://sentry.io/" },
  ],
],
extra: {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST,
},
```

**Error boundary**: `mobile/components/ErrorBoundary.tsx`, a class component (`static getDerivedStateFromError` sets `hasError`, `componentDidCatch` calls `captureError`), wraps the `<Stack>` in `mobile/app/_layout.tsx`. Its fallback screen uses the design system tokens (spec [0002](../0002-design-system-ui-foundation/index.md)): `bg-primary` background, `text-primary` headline "Something went wrong", `text-secondary` body "The app hit an unexpected error. Your data is safe, try again.", and a `PrimaryButton` labelled "Try again". The retry handler does not just reset `hasError` (that would re-render the same subtree that just threw): it also calls `queryClient.clear()` and `router.replace("/")` to remount the app from root.

**The three named events** (the scope row's "Done when" bar), lowercase snake_case, past tense, matching PostHog's own convention:
- `signup_completed`: fired in the signup mutation's (`POST /auth/signup`) `onSuccess`, alongside `identifyUser(user_id)`.
- `rating_submitted`: fired in the ratings mutation's (`POST /ratings`) `onSuccess`, with `{ movie_id, rating }`.
- `recommendation_tapped`: fired in the recommendation `PosterCard`'s press handler on Home, with `{ movie_id, position, source_row }` (`source_row` e.g. `"for_you"`, `"trending_now"`, `"because_you_liked"`).

Later journeys add their own events the same way, through the same module, as they're built.

**Relationship to the existing API error pattern** (`AGENTS.md` §14): TanStack Query already surfaces `ApiError` (a normal 4xx, e.g. a validation error) in the UI per the project's existing error handling convention; that is expected, user facing behaviour, not a crash. Only network failures and 5xx responses are forwarded to `captureError`, via a shared `onError` on the `QueryClient` in `mobile/lib/queryClient.ts`, so routine 4xx responses do not flood Sentry.

**Configuration required**:
- `EXPO_PUBLIC_SENTRY_DSN`: Sentry project DSN. Public by design (the same kind of client safe value as `EXPO_PUBLIC_API_BASE_URL`), safe under the `EXPO_PUBLIC_` prefix, read through `app.config.ts`'s `extra.sentryDsn`.
- `EXPO_PUBLIC_POSTHOG_API_KEY`: PostHog project API key. Also a public, client safe key, read through `extra.posthogApiKey`.
- `EXPO_PUBLIC_POSTHOG_HOST`: PostHog ingestion host, read through `extra.posthogHost`, defaults to PostHog Cloud US (`https://us.i.posthog.com`) if unset.
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`: EAS secrets (build time only, set in the Expo project's EAS secrets, never in `.env` or bundled into the app). Used by the Sentry Expo config plugin to upload source maps during `eas build`, so a real crash's stack trace is readable instead of minified.
- Packages to install: `@sentry/react-native`, `posthog-react-native`, plus PostHog's required peers `expo-file-system`, `expo-application`, `expo-device`, `expo-localization` (named here per `AGENTS.md` §13's "ask before installing" rule, so `/develop` does not need to ask separately).

**Replaces**:
- Nothing currently exists, so there is no old pattern to migrate off. This is the pattern for all new code going forward, not a cleanup of existing inconsistency.
- Explicitly disallowed going forward: any direct `import * as Sentry from "@sentry/react-native"` or `import { PostHog } from "posthog-react-native"` outside `mobile/lib/telemetry.ts` itself.

**Enforcement**:
An ESLint `no-restricted-imports` rule in the project's ESLint config (`eslint-config-expo` base, per `AGENTS.md` §14, tracked for `/develop tooling`):

```javascript
// eslint.config.js (excerpt)
{
  files: ["**/*.{ts,tsx}"],
  ignores: ["lib/telemetry.ts", "**/*.test.{ts,tsx}", "**/__mocks__/**"],
  rules: {
    "no-restricted-imports": ["error", { paths: ["@sentry/react-native", "posthog-react-native"] }],
  },
},
```

Test files and mocks are exempted since a Jest mock of either SDK has to import it. Cheap to add given lint already runs on every commit through the Husky pre-commit hook.

**Rollout**:
New code immediately. There is nothing existing to migrate; every screen built from Journey 1 onward wires its events and error handling through `mobile/lib/telemetry.ts` from the start.

**Exceptions**:
None. Every screen and mutation goes through the shared module.

**Verification** (what `/check verify` confirms against the scope row's "Done when" bar; this is a standard, not a data backed feature, so there is no `## Requirements` acceptance criteria list, this is the equivalent check): on a real preview or production build (not Expo Go, telemetry is disabled in dev per `isEnabled()` above), force a crash and confirm a symbolicated stack trace (readable, not minified) appears in Sentry; complete a signup, submit a rating, and tap a recommendation, and confirm all three events appear in PostHog's Live Events view.

## Consequences

**Positive**:
- Every journey from Account & getting started onward gets real crash visibility and real usage signal from day one, instead of it being bolted on after the fact.
- One choke point (`mobile/lib/telemetry.ts`) means swapping either vendor later touches one file, not every screen.
- The lint rule makes the standard self enforcing instead of relying on review catching a stray direct import.

**Negative / tradeoffs**:
- Two vendor accounts, two dashboards, four new environment values to keep straight instead of one.
- `SENTRY_AUTH_TOKEN` must be set as an EAS secret before the first real build, or source maps never upload and crash stack traces stay unreadable (minified); this is easy to forget since the app still builds and runs fine without it, it just silently ships with broken crash diagnostics.
- The Snyk security assessment flagged the `instrument-product-analytics` skill (`posthog/ai-plugin`) High Risk during install, while Gen and Socket both scored it Safe / 0 alerts. It comes from PostHog's own GitHub org, so this is most likely a broad-permissions flag rather than a real problem, but it is worth a quick manual look before leaning on it, since an installed skill runs with full agent permissions (see Follow-up).

**Neutral**:
- Local dev builds send nothing to either vendor, so confirming the wiring actually works requires testing on a preview or production build at least once before a journey ships, not just running in Expo Go.
- Only a user id reaches either vendor, never an email or name; a future feature that genuinely needs more identifying detail on an event has to add it deliberately, it does not happen by default.
- The backend (`backend/`) still has no crash or error monitoring of its own; this spec does not close that gap (see Follow-up).

## Follow-up

- [ ] Consider a build time check (in `app.config.ts`, or a CI step before `eas build`) that fails the build itself when the EAS secrets are missing, catching a misconfiguration before it reaches a device rather than relying only on the runtime warn in `initTelemetry()`.
- [ ] Flag a future decision for backend (FastAPI) error monitoring; `backend/` predates this workflow and was intentionally kept out of this spec's scope, but it currently has no crash visibility at all.
- [ ] Give the `instrument-product-analytics` skill (`posthog/ai-plugin`) a quick manual read before relying on it, given the Snyk High Risk flag noted in Consequences; it runs with full agent permissions like any installed skill.
- [ ] Add `sentry-react-native-sdk` and `instrument-product-analytics` to `mobile/AGENTS.md` §15 (Agent Skills) once installed and wired; they are not yet referenced there.
- [ ] Verify `@sentry/react-native` and `posthog-react-native`'s current supported Expo SDK range covers the project's pinned Expo SDK 54 (spec [0001](../0001-mobile-stack-architecture/index.md)) before installing either package.
- [ ] An MCP server exists for both Sentry (`mcp.sentry.dev`) and PostHog (`mcp.posthog.com`), offered during this design and declined for now; connecting either later would give live access to real error and analytics data during future debugging, purely additive, no code change required.
