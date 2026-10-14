# 0001. Rationale — Adopt the Expo based stack for the NextWatch mobile app

_The build spec (decision, stack table, consequences) lives in [`index.md`](index.md). This file holds the decision history: why, what was compared, what was learned scaffolding it._

## Context

NextWatch needs one codebase that ships to iOS, Android, and Web, talks only to the already built FastAPI backend (never directly to Supabase, Postgres, or TMDB), and matches the visual system already specified in `mobile/context/design.md` (color tokens, type scale, spacing, dark and light mode). The team is small, so the stack needs to be easy to build and maintain without a dedicated native or infrastructure specialist.

No mobile code exists yet (`mobile/` currently holds only `AGENTS.md` and two product documents). The stack choice was made in prose, ahead of any code, and needs to be captured as a spec before the project is scaffolded so the decision has a durable record.

## Options considered

Options considered were not documented in full detail at decision time (this was a documentation pass, not a fresh evaluation). What the engineer recalled per choice:

**Navigation and app framework**: Expo Router (chosen) versus a bare React Native setup with React Navigation wired by hand. Expo Router was chosen for its stronger ecosystem and built in file based routing that works the same way across iOS, Android, and Web.

**State management**: Zustand (chosen) versus Redux. Not formally compared at decision time; Zustand's small API matched the need for light, cross screen state without Redux's larger setup and boilerplate. A third option, plain React Context, was not raised at decision time either; it would avoid a dependency entirely, but re render performance for the shared mood weight slider is worse than a subscription based store, and Zustand's API is small enough that the extra dependency is a minor cost next to that.

**Styling**: NativeWind v4 (chosen) versus plain `StyleSheet` or a component library such as Tamagui. Chosen because it gives one reusable set of utility classes that work across native and web, instead of hand rolled styles or two separate theming systems for native versus web.

**Everything else** (TanStack Query v5, `expo-secure-store`, `expo-linear-gradient`, the two Google Fonts packages, `@expo/vector-icons`): adopted as the standard choice for each need inside the Expo ecosystem already chosen above (server data caching, credential storage, gradient overlays, typography, iconography). These were not separately evaluated against alternatives; they are the conventional pairing for an Expo Router project and were not treated as open decisions.

## Rationale

The main driver behind every pick was ease: how quickly the team can build and keep building with a tool, not raw feature completeness. Expo Router was picked over hand wiring React Navigation because it comes with a larger ecosystem and file based routing built in, which matters more with a small team shipping to three platforms from one codebase. NativeWind was picked over plain `StyleSheet` because a design system with named color and spacing tokens (`design.md` §2.2 to §2.4) maps far more directly onto reusable utility classes than onto scattered inline styles repeated per screen. Zustand was picked for TanStack Query's counterpart on the client side: small, boring, and enough for the little cross screen state this app needs (session id, theme override, a shared slider value), without pulling in Redux's larger surface for state that does not need it.

Because the backend is already built and fixed (`backend/main.py`), the stack's job is narrower than a greenfield pick: it does not choose a database, an auth provider, or a hosting platform, those already exist. It only chooses how the client talks to that backend and renders its data, which is why TanStack Query (a server cache, not a state manager) and `expo-secure-store` (matching the JWT based Supabase Auth already proxied by the backend) were the natural fits rather than open questions.

## Scaffold addendum (2026-08-07)

Scaffolding surfaced a version conflict not visible at decision time: NativeWind v4 peer-depends on `react-native-reanimated` in a way that assumes an older Reanimated line, while the newest Expo SDK (57, current at scaffold time) bundles Reanimated 4.x. Installing NativeWind v4 cleanly against SDK 57 would have required forcing the install (`--legacy-peer-deps`) against an unofficial, unsupported combination.

The engineer was asked and chose to pin the scaffold to **Expo SDK 54** instead — the SDK version NativeWind v4 and its surrounding ecosystem (`@gorhom/bottom-sheet`, etc.) were built against — over forcing the newest SDK. This kept every dependency (including `react-native-reanimated`, resolved to `~4.1.1` by SDK 54 itself, and `@gorhom/bottom-sheet@^5.2.14`) installing cleanly with no overrides, at the cost of not being on the newest SDK. This is recorded in `index.md`'s Consequences as a negative/tradeoff, not re-litigated here as a new decision: the underlying choice (NativeWind v4) was not reconsidered, only which SDK version to build it on.
