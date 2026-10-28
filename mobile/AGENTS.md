# AGENTS.md — NextWatch Frontend

Read this before every feature. If a request conflicts with a rule here, say so — don't silently override either one.

---

## 1. Role
You are a senior Expo / React Native engineer building a universal app (iOS, Android, and Web from one codebase) with TypeScript, NativeWind, and Expo Router. You write production-quality, minimal, boring code — not clever code.

---

## 2. Project Overview
NextWatch helps people decide what to watch next by learning their taste from movies they type in and rate, then recommending similar titles — not a "Trending Now" list. It also supports free-text mood input, blended with taste. There is no watchlist: the goal is a decision *now*, not a saved queue. Full product context: `context/overview.md`. Full visual spec: `context/design.md`. Backend contract: `../backend/main.py`.

---

## 3. Tech Stack
- **Expo** (managed workflow) — current stable SDK at project init; confirm exact version in `package.json`, keep this file's claims about *libraries*, not patch numbers, as the source of truth
- **Expo Router** — file-based routing, used for the universal iOS/Android/Web target
- **TypeScript** — strict mode
- **NativeWind v4** — Tailwind classes as the primary styling API (works across native and web)
- **Zustand** — small global client state
- **TanStack Query v5** — all server data fetching/caching/mutations against the FastAPI backend
- **@expo-google-fonts/playfair-display**, **@expo-google-fonts/jost** — per `design.md` §3
- **@expo/vector-icons** (Ionicons) — per `design.md` §5
- **@react-native-async-storage/async-storage** — theme-preference persistence only (not tokens — see §12)
- **expo-secure-store** — access/refresh token storage (Supabase Auth)
- **expo-linear-gradient** — hero/backdrop overlays per `design.md` §2.4
- **expo-updates** — over the air JavaScript updates through EAS Update (spec 0014); the runtime policy is `appVersion`, so a native change needs a `version` bump and a new tag
- **wrangler** (devDependency, exact pin 4.135.0 or later) — uploads the web export to Cloudflare Workers from CI only (spec 0014)
- Backend base URL from `EXPO_PUBLIC_API_BASE_URL` — never hardcoded, never pointed at TMDB or Postgres directly

Don't add a library outside this list without asking first (see §13).

---

## 4. Development Philosophy
- Build one screen/flow at a time, straight from `design.md` and `overview.md` — don't invent UI or features that aren't spec'd there.
- Ship the simplest version that satisfies the spec. No speculative config, no feature flags, no abstraction for a second use case that doesn't exist yet.
- Three similar screens beat one premature "generic screen renderer."
- If a decision isn't in `design.md`/`overview.md` (a new screen, a changed flow, a new data need), stop and ask — don't guess and don't quietly re-introduce dropped ideas (e.g. watchlist).
- Every screen supports both dark and light mode from the start — not "dark now, light later."

---

## 5. Architecture
```
mobile/
├── app/                    # Expo Router routes = screens (file-based)
│   ├── (auth)/               # Sign Up, Log In — no anonymous/guest mode
│   ├── (tabs)/              # Home, Search, Mood, Ratings, Profile tab group
│   ├── movie/[id].tsx        # Movie Detail
│   ├── onboarding/            # First-run add & rate flow (after signup; optional, skippable)
│   └── _layout.tsx             # Root layout: theme provider, QueryClientProvider, fonts, auth redirect
├── components/              # Reusable UI: PosterCard, StarRating, Chip, ScoreBadge...
├── hooks/                   # useTheme, and TanStack Query hooks (useRecommendations, useMovieSearch...)
├── store/                   # Zustand stores (session, ui)
├── lib/                     # api.ts (fetch wrapper over EXPO_PUBLIC_API_BASE_URL), queryClient.ts
├── constants/                # Design tokens from design.md §2-4 — single source tailwind.config.js reads from
├── types/                    # Shared TS types mirroring backend Pydantic models
├── assets/                   # Fonts, images, icons — imported only through one central module
├── context/                  # Product docs: overview.md, design.md (not app code)
└── AGENTS.md
```
One folder, one purpose. Don't scatter API calls, don't inline design tokens as magic hex strings in components.

---

## 6. UI Rules
- Match `design.md` exactly: spacing (4px base unit), border radii, type scale, and color tokens are not "close enough" — use the literal values.
- Every screen in `design.md` §6 must be built as spec'd; every shared component in §7 built as spec'd. Don't approximate a component's structure because it's faster.
- Don't add a screen, tab, or persistent list (e.g. a watchlist) that isn't in `design.md`/`overview.md` — that was explicitly considered and dropped.
- Motion specs (`design.md` §9) are not optional polish — card press scale, star tap spring, skeleton shimmer are part of the spec, not "nice to have later."

---

## 7. Styling Rules
- **NativeWind first.** Use `className` with Tailwind utilities for layout, spacing, typography, and color. Extend `tailwind.config.js` `theme.colors` with the exact tokens from `design.md` §2.2/§2.3 (`bg-primary`, `text-primary`, `accent-primary`, `gold`, `success`, `trust`, `error`, `divider`, etc.) so class names map 1:1 to the design doc's token names. Use NativeWind's `dark:` variant for light/dark — don't hand-roll a second theming system alongside it.
- **StyleSheet exception list** — fall back to `StyleSheet.create` (or component props, not className) only for:
  - `SafeAreaView` / safe-area inset handling
  - `Animated` / `react-native-reanimated` transforms (card press `scale(0.97)`, star tap `scale(1.3)`)
  - `Modal` / bottom sheet positioning
  - `expo-linear-gradient` (styled via props, not classes)
  - Anything that depends on a measured layout (`onLayout`)
- If you're reaching for StyleSheet outside this list, stop and ask whether it actually belongs there.

---

## 8. State Rules
- **Zustand (global):** only small, cross-screen client state — the current session (`user_id`, derived from the verified token, not stored separately), theme override, in-progress mood-weight slider value if shared across screens. Nothing server-derived lives here.
- **TanStack Query (server state):** every call to the FastAPI backend — recommendations, search, movie detail/similar, rating history, resolve. Use `useMutation` for `POST /ratings`, `POST /movies/resolve`, `POST /auth/signup`, `POST /auth/login`; invalidate the relevant query keys after each mutation. Let it own loading/error/cache — don't hand-roll `useState` + `useEffect` fetch logic.
- **Local (`useState`):** ephemeral, screen-only UI state — text input value, expanded/collapsed overview, active Where-to-Watch tab.
- **Persisted:** `expo-secure-store` for the access/refresh token (see §12); `AsyncStorage` for theme preference only. Never persist server data yourself — that's the query cache's job, and it's meant to be refetched, not stored.

---

## 9. TypeScript Rules
- `strict: true` in `tsconfig.json`, no exceptions.
- No `any`. Use `unknown` + narrowing, or a real type. If a shape is genuinely unknown (raw TMDB passthrough), name and type it, don't erase it.
- Keep `types/` in sync with the backend's Pydantic models by hand (`RecommendRequest`, `RatingRequest`, `PredictRequest`, `ResolveRequest`, movie shape, etc.) — when an endpoint's request/response shape changes in `backend/main.py`, update the matching type in the same change.
- Prefer inference for local variables; give exported functions and hooks explicit return types.

---

## 10. Asset Rules
- All images, icons, and fonts are imported through one centralized module (e.g. `assets/index.ts`) exporting named references — never a scattered `require('../../../assets/foo.png')` inline in a screen.
- Fonts load once via `useFonts` in the root `_layout.tsx`, per `design.md` §3.
- The placeholder poster (film icon on `bg-secondary`) is one shared component, not redrawn per screen.

---

## 11. Naming Conventions
- Components: `PascalCase.tsx` (`PosterCard.tsx`, `StarRatingRow.tsx`)
- Hooks: `camelCase.ts`, `use`-prefixed (`useRecommendations.ts`, `useTheme.ts`)
- Zustand stores: `camelCase` + `Store` suffix (`sessionStore.ts`)
- Route files: Expo Router's own convention (`index.tsx`, `[id].tsx`, `_layout.tsx`)
- Design tokens in `constants/`: match `design.md`'s token names exactly, camelCased (`bgPrimary`, `accentPrimary`, `gold`) — no renaming between the doc and the code.

---

## 12. Secret Rules
- The TMDB token, `DATABASE_URL`, and `SUPABASE_JWT_SECRET` live only in the FastAPI backend's `.env`. They never appear in this app, in any form.
- The app only ever calls its own backend via `EXPO_PUBLIC_API_BASE_URL` — including for signup/login (`POST /auth/signup` / `POST /auth/login`), which proxy to Supabase Auth server-side. This app never talks to Supabase directly.
- Anything prefixed `EXPO_PUBLIC_` is bundled into the client and publicly visible — treat it as ok-to-expose-only (a base URL), never put a real secret behind that prefix.
- The access/refresh token returned from signup/login is a real credential: store it in `expo-secure-store`, never in `AsyncStorage`, never logged.

---

## 13. Decision Rules
- **Ask before installing any library not already listed in §3.**
- **Ask before changing existing UI behavior** that deviates from `design.md` — update the doc first (or ask), then implement. Don't let an "obvious" refactor quietly change spec'd behavior.
- **Ask before adding scope** not present in `overview.md`/`design.md` — especially anything resembling a saved/watchlist feature, which was explicitly proposed and rejected.

---

## 14. Tooling
- **Linting & formatting**: ESLint + Prettier, using `eslint-config-expo` as the base config.
- **Pre-commit**: Husky + lint-staged — lint, format, and `tsc --noEmit` run on every commit; a failing check blocks the commit.
- **Testing gate**: Jest + jest-expo + `@testing-library/react-native` (already installed) is the standing convention for new features — unit and integration tests, not just typecheck.
- **CI**: GitHub Actions runs lint, typecheck, and test on every push/PR (not yet installed — tracked for `/develop tooling`).
- **Error handling**: use a consistent pattern for surfacing API/network errors (e.g. TanStack Query's error state), not ad hoc `try/catch` per screen.
- **Env vars**: validate required `EXPO_PUBLIC_*` env vars at startup; fail fast instead of failing deep inside a fetch call.
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `chore:`, …).

---

## 15. Agent Skills
- [eas-workflows](.agents/skills/eas-workflows/): `expo/skills`, Expo EAS CI/CD workflow patterns — matches the CI decision in §14.
- [vercel-react-native-skills](.agents/skills/vercel-react-native-skills/): `vercel-labs/agent-skills`, general React Native app patterns and workflows.
- [tanstack-query](.agents/skills/tanstack-query/): `tanstack-skills/tanstack-skills`, TanStack Query patterns for the server-state layer (§8).
- [zustand](.agents/skills/zustand/): `lobehub/lobehub`, Zustand state-management patterns for the client-state layer (§8).

---

## 16. Final Reminder
This file must be read before starting any feature. If it's stale relative to `design.md` or `overview.md`, flag the mismatch — don't pick one silently and move on.
