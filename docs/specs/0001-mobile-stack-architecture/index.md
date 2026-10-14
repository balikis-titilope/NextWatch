# 0001. Adopt the Expo based stack for the NextWatch mobile app

**Date**: 2026-08-07
**Status**: Accepted

_Decision history (context, options considered, rationale) moved to [`rationale.md`](rationale.md). This file holds the build spec: the decision, the stack, and what still needs to happen._

## Summary

NextWatch's mobile app will be built as one Expo project (using Expo Router for navigation) covering iOS, Android, and Web, written in TypeScript with strict checking on. Screens are styled with NativeWind (Tailwind style classes), small shared state lives in Zustand, and all calls to the existing FastAPI backend go through TanStack Query. This decision was already made and written down in `mobile/AGENTS.md` before this spec; this spec records it formally so the reasoning is not lost and so later work (like the scaffold) can point back to it.

## Decision

**Chosen option**: the Expo Router based stack recorded in `mobile/AGENTS.md` §3.

Build the NextWatch mobile app as a single Expo Router project in TypeScript strict mode, styled with NativeWind v4, using Zustand for small global client state and TanStack Query v5 for all server data from the FastAPI backend, with `expo-secure-store` for auth tokens and `expo-linear-gradient` for the design system's overlay effects.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Platform / framework | Expo (managed workflow) with Expo Router | One codebase for iOS, Android, and Web; file based routing; strong ecosystem and community support |
| Language | TypeScript, strict mode | Type safety against the backend's Pydantic models, no runtime shape surprises |
| Styling | NativeWind v4 | Tailwind style utility classes that map 1 to 1 onto `design.md`'s tokens, one theming system across native and web |
| Client state | Zustand | Small, boring API for the little cross screen state that is not server data (session id, theme override) |
| Server data | TanStack Query v5 | Owns loading, caching, and mutation state for every call to the FastAPI backend, no hand rolled fetch plus `useState` |
| Credential storage | `expo-secure-store`, with a small storage abstraction that falls back to `localStorage` on Web | `expo-secure-store` has no Web implementation, so a bare Web build would crash on token read or write without this fallback; the fallback is noted as lower security on Web in Consequences |
| Theme persistence | `@react-native-async-storage/async-storage` | Only for the dark and light mode preference, not for any credential or server data |
| Visual effects | `expo-linear-gradient` | Hero and backdrop gradient overlays required by `design.md` §2.4 |
| Typography and icons | `@expo-google-fonts/playfair-display`, `@expo-google-fonts/inter`, `@expo/vector-icons` (Ionicons) | The two fonts and icon set specified by `design.md` §3 and §5 |
| Animation | `react-native-reanimated` | Required by `design.md` §9 for card press scale, star tap spring, and skeleton shimmer; already implied by `AGENTS.md` §7's `StyleSheet` exception list but missing from §3's stack list |
| Safe area handling | `react-native-safe-area-context` | Required by `AGENTS.md` §7's own `StyleSheet` exception list (safe area insets) but missing from §3's stack list |
| Bottom sheets | `@gorhom/bottom-sheet` | `design.md` §6.5 specifies filter chips opening as bottom sheets; the standard, actively maintained choice for Expo Router projects |
| Sliders | `@react-native-community/slider` | Needed for the year range filter (`design.md` §6.5) and the mood to taste blend slider (`design.md` §6.7); the standard cross platform slider for Expo |
| Package manager | npm, with a committed `package-lock.json` | Some alternative managers (pnpm, bun) hoist dependencies in a way that can break Expo's autolinking; npm is the safest default and what Expo's own docs assume |
| Backend integration | `EXPO_PUBLIC_API_BASE_URL` only, never a direct call to Supabase, Postgres, or TMDB | Keeps every secret (TMDB token, database URL, Supabase JWT secret) inside the FastAPI backend, per `AGENTS.md` §12 |

**Wiring and configuration notes** (so the scaffold step does not have to guess):
- **NativeWind v4 setup** needs four pieces, not just `tailwind.config.js`: a `global.css` importing Tailwind's layers, `withNativeWind` wrapping the config in `metro.config.js`, NativeWind's babel preset with the `jsxImportSource` set, and `content` globs covering `app/` and `components/`.
- **Design tokens** in `constants/` are TypeScript (per `AGENTS.md` §5), but `tailwind.config.js` is a CommonJS file. The scaffold should emit the token values from a small `.cjs` (or `.js`) module that both `tailwind.config.js` and any TypeScript code can import, rather than keeping two copies of the same values in sync by hand.
- **Expo SDK version**: pin to the current stable Expo SDK at scaffold time (per `AGENTS.md` §3's own policy), but check NativeWind v4's supported SDK range first, since that compatibility is the binding constraint, not Expo's release alone.
- **Environment and config**: use `app.config.ts` (not static `app.json`) so `EXPO_PUBLIC_API_BASE_URL` can vary by build; commit a `.env.example` and never a real `.env`. For device testing (not just simulators), the base URL must be the development machine's LAN IP, `localhost` will not resolve from a physical device.
- **Testing framework** (Jest, React Native Testing Library, or otherwise) is deliberately left undecided here; the `/test` skill asks for and saves this preference itself the first time it runs, so it is not a gap this spec needs to close.

**Scaffold outcome (2026-08-07)**: NativeWind v4's peer on `react-native-reanimated` created a real conflict with the newest Expo SDK (57, which bundles Reanimated 4.x) — see `rationale.md` addendum below. The engineer chose to pin the scaffold to **Expo SDK 54** (the version NativeWind v4/the ecosystem around it was built against), which installed cleanly with no dependency overrides.

## Consequences

**Positive**:
- One codebase ships to iOS, Android, and Web instead of three separate builds.
- Design tokens in `design.md` map directly to NativeWind class names, so screens stay visually consistent without a second styling system.
- TanStack Query removes hand rolled loading and error state for every backend call.
- Auth tokens are stored the correct way (`expo-secure-store`) from the start, not retrofitted later.

**Negative / tradeoffs**:
- Expo's managed workflow trades away some low level native customization; a feature that needs a native module outside Expo's supported set would require a config plugin or, in the worst case, ejecting.
- NativeWind trades fine grained, per platform native styling control for one consistent utility class system; a handful of cases (documented in `AGENTS.md` §7, like `Animated`/`reanimated` transforms and `Modal` positioning) still need plain `StyleSheet`.
- Zustand was adopted without comparing it against Redux, so if the app later needs Redux style middleware, time travel debugging, or a large plugin ecosystem, that will mean introducing a new tool rather than extending the one already in place.
- Backend types are kept in sync with `backend/main.py`'s Pydantic models by hand (`mobile/types/`, per `AGENTS.md` §9); there is no codegen step, so a changed endpoint shape can silently drift until someone updates the matching type.
- Treating Web as a first class target does not mean full parity for free: React Native Web has known gaps around `Modal` and bottom sheet behavior, gesture handling, and some `react-native-reanimated` animations, so a few interactions (the bottom sheets and motion specs above) will likely need Web specific handling or a graceful fallback, not just "it also runs on Web."
- **Pinned to Expo SDK 54, not the newest SDK (57 at scaffold time)**, because of the NativeWind v4 / Reanimated peer conflict noted above. Upgrading later means re-checking NativeWind's supported SDK range again.

**Neutral**:
- TypeScript strict mode adds upfront friction (no `any`, explicit narrowing) but is the project's standing rule, not a new cost introduced by this decision.
- Theme preference and auth tokens are persisted through two different mechanisms (`AsyncStorage` and `expo-secure-store`), which is intentional (only one of them holds a real credential) but means two storage APIs to know instead of one.

## Follow-up

- [x] Scaffold the actual Expo Router project (folder layout from `AGENTS.md` §5, an empty project that boots on iOS, Android, and Web) as the execution step for this feature; `/develop` derives those steps from the Proposed stack above. Code in `mobile/`.
- [ ] As the API surface grows, consider a codegen step (for example generating TypeScript types from the backend's Pydantic models) to remove the hand sync burden noted under Negative / tradeoffs; not needed for the initial scaffold.
