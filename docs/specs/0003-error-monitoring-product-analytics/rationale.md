# 0003. Rationale: error monitoring and product analytics standard

_Decision history for [`index.md`](index.md). This file holds the context, the options weighed, and the full reasoning; `/develop` does not need to read it._

## Context

NextWatch's mobile app currently has no crash reporting and no product analytics anywhere in the codebase. A check of the app confirms this directly: there are no `console.error` calls in `mobile/`, no error boundary anywhere, and `mobile/app/_layout.tsx` (the root layout) only loads fonts and wraps the app in the query client provider, nothing that watches for failures or records what people do.

Every journey from here onward (Account & getting started through Notifications) will ship on top of whatever this spec decides. In Expo Go's dev client, a crash shows a visible red screen. In a real build, the version everyone but the developer runs, the same crash just closes the app or shows a blank screen, with nothing recorded anywhere. Waiting to add this after journeys 1 through 6 are already built would mean retrofitting tracking calls into a dozen finished screens, and losing any signal from the earliest and riskiest usage, real people going through sign up and onboarding for the first time.

Forces at play:
- **Small, likely solo maintained project, Expo managed workflow.** Any tool chosen needs a first class Expo config plugin. Bare native module linking (manually editing native iOS/Android projects) is the kind of maintenance burden a managed Expo app is specifically trying to avoid.
- **Pre revenue.** The scope's Deferred section defers monetization entirely, so whatever is chosen needs to fit a free or near free tier comfortably at low volume.
- **Mobile only, by explicit scope.** `backend/` predates this workflow and is explicitly out of scope for `/architect` and `/develop` in `AGENTS.md`'s Rules section. This spec covers the mobile app only; the backend having no error monitoring of its own is a real gap, just not one this spec closes.
- **No new secret in the client.** `AGENTS.md` §12 is explicit that a real credential never lives in the app, only in the backend's `.env`. Any provider credential wired into the mobile app must be a client safe public key (a DSN, a project API key), and anything more sensitive (a source map upload token) has to be a build time only secret, not bundled into the app.

## Options considered

### Option 1: Two specialized tools, Sentry for crashes and PostHog for analytics

A dedicated crash reporter (Sentry) and a dedicated product analytics tool (PostHog), each doing one job well, wired independently through one shared wrapper module.

**Pros**:
- Sentry's stack traces, source map symbolication, release health, and breadcrumbs are purpose built for this and materially stronger than any bolt on exception capture.
- PostHog's funnels, cohorts, and event analytics are purpose built for product questions and materially stronger than any bolt on analytics.
- Each vendor is swappable independently later without touching the other.
- Both ship a first class Expo config plugin, no bare native linking.
- Both have a real, installed Agent Skill (`sentry-react-native-sdk`, `instrument-product-analytics`) teaching the actual Expo specific setup, which lowers the risk of a subtly wrong integration.

**Cons**:
- Two SDKs, two dashboards, two sets of credentials to manage instead of one.
- Slightly more app boot time initialization code than a single tool would need.

### Option 2: One unified tool, PostHog for both

PostHog alone, using its exception autocapture for crashes alongside its normal event analytics.

**Pros**:
- One SDK, one dashboard, one set of credentials.
- Simpler initial wiring, nothing to keep in sync across two vendors.

**Cons**:
- PostHog's crash handling is a secondary feature bolted onto an analytics product; it lacks Sentry's release health tracking, its depth of breadcrumb and device context, and its maturity around React Native source map symbolication specifically.
- Debugging a hard crash later, the exact moment this capability matters most, would be materially harder.
- If the app's crash volume ever grows enough to need real crash tooling, this would mean a second migration instead of getting it right once now.

### Option 3: Firebase suite, Crashlytics and Analytics

Google Firebase's crash reporting and analytics products together.

**Pros**:
- Both are free at effectively unlimited volume for an app this size.
- Ties naturally into a Firebase project if the app later wants Firebase remote config or push notifications, which is relevant since Notifications (scope row 10) is still an undecided future journey.

**Cons**:
- Requires a native Firebase project, `google-services.json` / `GoogleService-Info.plist`, and the `@react-native-firebase` native modules, a heavier lift in an Expo managed workflow than Sentry or PostHog's pure config plugin approach.
- Firebase Analytics' funnel and cohort tooling is weaker than PostHog's for product analytics specific questions.
- Introduces a new vendor account (Google/Firebase) beyond Supabase and TMDB, with its own data handling characteristics, for no benefit this project needs today.

### Option 4: Phase it, Sentry now, PostHog later

Ship crash reporting with this foundation, add product analytics in a later pass once there are real users to analyze.

**Pros**:
- Halves the vendor accounts, dashboards, and environment values to manage at the point this ships.
- Crash visibility is the more urgent capability at zero users; analytics on an app nobody has used yet produces nothing actionable.

**Cons**:
- The scope row's own "Done when" bar names both capabilities as this feature's exit criteria: "an unhandled error in any screen is captured with a stack trace, **and** a signup/rating/recommendation-tap event reaches the analytics provider." Shipping Sentry only would leave this foundation feature incomplete against its own scope, not simply simpler.
- The shared wrapper module (`mobile/lib/telemetry.ts`) already absorbs almost all of the cost a "later" pass would save; adding PostHog's four functions to a module that already exists is a small increment, not a second design effort.

## Rationale

Option 1 fits every force from Context. The Expo managed workflow constraint rules out Option 3's native Firebase setup as unnecessary complexity for what this decision needs to deliver: config plugin only integration, no ejecting, no native project files to hand maintain. The specialization need, wanting genuinely good crash diagnostics and genuinely good product analytics rather than an adequate version of each, rules out Option 2's single bolt on tool; a crash is exactly the moment good tooling earns its keep, and PostHog's exception capture is not built to be a primary crash reporter. Option 4's phased path is the closest real alternative, and it is a reasonable instinct at zero users, but the scope row that owns this decision already defines "done" as both capabilities working together; deferring PostHog would ship this foundation feature incomplete against its own stated bar, not just leaner, and the wrapper module it would have saved effort on gets built either way. Both chosen tools clear the cost bar at this app's size, and both being available as real, already installed Agent Skills materially de-risks the implementation: `/develop` gets the actual current Expo specific setup steps instead of reconstructing them from general React Native knowledge that may be stale.

The tradeoff accepted is real: two vendors instead of one means two dashboards and two credentials to keep track of. That cost is worth paying because each tool is genuinely best in class at its own job, and because the shared wrapper module (`mobile/lib/telemetry.ts`, defined in the Standard definition) means every call site in the app talks to one internal API regardless of how many vendors sit behind it; swapping either vendor later touches one file, not every screen that calls `trackEvent` or `captureError`.
