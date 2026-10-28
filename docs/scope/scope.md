# Scope: NextWatch — Mobile App

NextWatch helps people decide what to watch next by learning their taste from movies they rate, blending it with mood, and handing back a short confident list instead of an endless scroll. This scope covers the Expo mobile app (iOS, Android, and Web from one codebase); the FastAPI backend it calls is already built.

**Build approach:** Journey (each phase is one complete user journey, built fully — every step, edge case, and state — before the next one starts).
**Workflow:** Medium (the tail after develop: `/check verify`, then `/test`). `/architect` still gates any feature that needs a decision at every tier; a feature's own tier tag overrides it.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Backend API & data model | Foundation | existing |
| 1 | Mobile stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | in-progress |
| 3 | Design system & UI foundation | Foundation | done |
| 4 | Error monitoring & product analytics | Foundation | in-progress |
| 5 | Account & getting started | Journey 1 | in-progress |
| 6 | Discover & decide | Journey 2 | in-progress |
| 7 | Search & browse | Journey 3 | in-progress |
| 8 | Mood discovery | Journey 4 | in-progress |
| 9 | Ratings & profile | Journey 5 | in-progress |
| 10 | Notifications | Journey 6 | in-progress |
| 11 | Forgot password | Journey 1 | in-progress |
| 12 | App store submission readiness | Release readiness | in-progress |
| 13 | TV show support | Journey 7 | in-progress |
| 14 | Web landing page | Journey 1 | in-progress |
| 15 | Web auth split screen | Journey 1 | in-progress |
| 16 | Catalog in Postgres (pgvector) | Backend data layer | in-progress |
| 17 | Web and mobile deployment | Release readiness | in-progress |

## Foundations

### A. Backend API & data model · existing
FastAPI service (`backend/main.py`) already live: Supabase-backed auth (signup/login/JWT), recommendation engine (taste vector, mood blend, popularity fallback), local + TMDB-fallback movie search/resolve, ratings CRUD, and filters (language/actor/year). Postgres schema (movies, users, ratings) via `backend/db/import_data.py`. Every mobile feature below calls this, never TMDB or Postgres directly. code in `backend/`

### 1. Mobile stack & architecture
The stack is already written down in `mobile/AGENTS.md` §3 (Expo Router, TypeScript strict, NativeWind v4, Zustand, TanStack Query v5, expo-secure-store, expo-linear-gradient) — this box formalizes that decision into a spec and scaffolds the runnable project from it, rather than re-deciding it.
**Done when:** the stack is recorded in a spec and an empty Expo Router project boots locally (iOS/Android/Web) with the folder layout from `AGENTS.md` §5.
spec [0001](../specs/0001-mobile-stack-architecture/index.md) · code in `mobile/`
- [x] Decide the stack (spec): `/architect mobile stack & architecture`
- [x] Scaffold from the decision: `/develop mobile stack & architecture`
- [x] Verify it: `/check verify mobile stack & architecture`
- [x] Test it: `/test mobile stack & architecture`

### 2. Coding standards & tooling
`mobile/AGENTS.md` already covers naming, styling, state, and TypeScript conventions in detail — this step confirms them against the real scaffold and adds the tooling choices (lint, format, pre-commit, CI) it doesn't yet cover.
**Done when:** `AGENTS.md` reflects the scaffolded project and lint/format/pre-commit run clean.
code in `mobile/` (ESLint/Prettier config, `.husky/pre-commit`, `.github/workflows/mobile-ci.yml`)
- [x] Capture tooling choices + confirm conventions: `/audit`
- [x] Install and verify tooling: `/develop tooling` (ESLint + Prettier wired, Husky pre-commit hook tested against a real staged commit, GitHub Actions CI added; lint, format check, typecheck, and all 91 tests pass clean)

### 3. Design system & UI foundation
`mobile/context/design.md` already specifies color tokens (dark/light), type scale, spacing, and every shared component (`PosterCard`, `StarRatingRow`, `Chip`, `ScoreBadge`, `PrimaryButton`) in full — this formalizes it into a spec and builds the base components + `tailwind.config.js` tokens every screen depends on.
**Done when:** `tailwind.config.js` tokens map 1:1 to `design.md` §2.2/§2.3, and every §7 component renders correctly in both dark and light mode.
spec [0002](../specs/0002-design-system-ui-foundation/index.md) · code in `mobile/components/`, `mobile/app/showcase.tsx`, `mobile/hooks/useTheme.ts`, `mobile/tailwind.config.js`
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
  - [x] Wire a real dark/light theme switch, and confirm/extend the color and typography tokens (AC-1, AC-9)
  - [x] Build the small presentational components: `PrimaryButton`, `Chip`, `ScoreBadge` (AC-2, AC-5, AC-7)
  - [x] Build `StarRatingRow` and the shared `Skeleton` shimmer (AC-2, AC-4, AC-6, AC-7)
  - [x] Build `PosterCard` (AC-2, AC-3, AC-7)
  - [x] Build the dev gallery screen and check every component against `design.md` §7 in both themes (AC-8)
- [x] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`

### 4. Error monitoring & product analytics
Pick a crash-reporting and product-analytics provider and wire it at the root layout, so every journey from Account & getting started onward emits real signal (signups, ratings given, recommendation taps) instead of bolting it on later.
**Done when:** an unhandled error in any screen is captured with a stack trace, and a signup/rating/recommendation-tap event reaches the analytics provider.
spec [0003](../specs/0003-error-monitoring-product-analytics/index.md) · code in `mobile/lib/telemetry.ts`, `mobile/components/ErrorBoundary.tsx`, `mobile/app/_layout.tsx`, `mobile/lib/queryClient.ts`, `mobile/app.config.ts`, `mobile/metro.config.js`
- [x] Design it (spec): `/architect error monitoring & product analytics`
- [ ] Build it: `/develop error monitoring & product analytics`
  - [x] Shared `telemetry.ts` module wired at root layout (Sentry + PostHog init, disabled outside real builds); `ErrorBoundary` catching render errors; `QueryClient`'s global `onError` forwarding network/5xx failures, not routine 4xx
  - [x] Enforcement: ESLint `no-restricted-imports` blocking direct SDK imports outside `telemetry.ts`; new env vars documented in `.env.example`
  - [ ] The three named events (`signup_completed`, `rating_submitted`, `recommendation_tapped`) — deferred: their call sites (the signup/ratings mutations, `PosterCard`'s press handler) don't exist yet since Journeys 1 and 2 aren't built. Each should call `trackEvent` through this module when built (spec 0003's own rollout note).
- [ ] Verify it: `/check verify error monitoring & product analytics`
- [ ] Test it: `/test error monitoring & product analytics`

## Journey 1: Account & getting started

### 5. Account & getting started
Sign up / log in (real accounts via Supabase Auth, proxied through the backend, no anonymous mode) followed by the optional, skippable onboarding flow to search, add, and rate movies before seeing Home. Fully specified in `design.md` §6.2–6.3 against the backend's `/auth/signup`, `/auth/login`, `/movies/search`, `/movies/resolve`, and `/ratings`.
**Done when:** a user can sign up or log in, the app correctly remembers whether they have been through onboarding (a permanent flag, set by tapping Skip or Done, no minimum rating count) and routes relaunches and logins accordingly (no saved login → auth, saved login with onboarding not yet complete → onboarding, otherwise → tabs), and a lost or expired login is silently renewed when possible instead of forcing a fresh sign in.
spec [0004](../specs/0004-relaunch-onboarding-routing/index.md) · code in `mobile/app/(auth)/`, `mobile/app/onboarding/`, `mobile/app/index.tsx`, `mobile/app/_layout.tsx`, `mobile/lib/`, `mobile/store/sessionStore.ts`, `backend/main.py`, `backend/auth.py`, `backend/db/`
- [x] Design the relaunch routing & onboarding completion tracking (spec): `/architect account & getting started`
- [x] Build it: `/develop account & getting started`
  - [x] Backend support: `onboarding_completed` field, `GET /me`, `POST /me/onboarding/complete`, `POST /auth/refresh` (AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-9, AC-10)
  - [x] Mobile credential storage and shared token renewal: `lib/tokens.ts`, `sessionStore`, the `apiFetch` 401 handler (AC-1, AC-3, AC-4, AC-6, AC-10, AC-11)
  - [x] Launch routing, plus login/signup routing (AC-1, AC-2, AC-7, AC-8, AC-9, AC-10, AC-11)
  - [x] Onboarding screen's Skip/Done wired to mark completion (AC-5)
  - [x] The sign up, log in, and onboarding screens themselves, built against `design.md` §6.2–6.3 and the `stitch_md_design_system` mockups (already fully specified, no separate spec needed)
  - [x] Email confirmation: `/auth/signup` and `/auth/login` revised, `POST /auth/verify-signup`, `POST /auth/resend-confirmation` (AC-8 revised, AC-12, AC-13, AC-14, AC-15, AC-16), and the mobile confirm email screen — code complete and typechecked/linted/tested clean; build task 11 (Supabase dashboard "Confirm email" + custom SMTP + numeric-code template) done by hand, engineer confirmed
- [ ] Verify it: `/check verify account & getting started`
- [ ] Test it: `/test account & getting started`

## Journey 2: Discover & decide

### 6. Discover & decide
The core recurring loop: Home's hero pick, "For You" / "Trending Now" / "Because you liked [X]" rows, tapping into Movie Detail (poster, overview, cast, where to watch, inline rating, similar movies). Fully specified in `design.md` §6.4/§6.6 against the backend's `/recommend`, `GET /movies/trending`, `GET /movies/{id}`, and `GET /movies/{id}/similar`.
**Done when:** Home renders real recommendations (popularity fallback on cold start, a "rate a few movies" prompt when there's no taste signal yet), tapping any card opens a fully populated Movie Detail, and rating inline there updates via `/ratings` and reflects immediately.
spec [0005](../specs/0005-discover-decide-response-shape/index.md) · code in `mobile/app/(tabs)/index.tsx`, `mobile/app/movie/[id].tsx`, `backend/main.py`, `backend/recommend.py`, `backend/fetch_movies.py`, `backend/db/`
- [x] Design the backend response shape (spec): `/architect discover & decide`
- [x] Build it: `/develop discover & decide`
  - [x] Backend: `country` field, migration, and signup/verify-signup threading (AC-11)
  - [x] Backend: live-fetch field parity, `popularity`, shared card serialization, and the personal-ceiling score calibration (AC-1, AC-2, AC-3, AC-9)
  - [x] Backend: `GET /movies/trending`, `GET /movies/{id}`, `GET /movies/{id}/similar` (AC-4 through AC-10, AC-13)
  - [x] Mobile: `expo-localization`, per-image-type URL sizes, updated types, and the Home/Movie Detail screens built against the new contract (AC-1, AC-2, AC-12, AC-13)
- [ ] Verify it: `/check verify discover & decide`
- [ ] Test it: `/test discover & decide`

## Journey 3: Search & browse

### 7. Search & browse
Search bar plus language/actor/year-range filter chips (bottom sheets), 2-column results grid. Fully specified in `design.md` §6.5 against the backend's `/movies`.
**Done when:** filters compose correctly against `/movies`, active filters are visually marked, and the empty state renders when nothing matches.
code in `mobile/app/(tabs)/search.tsx`, `mobile/components/LanguageFilterSheet.tsx`, `mobile/components/ActorFilterSheet.tsx`, `mobile/components/YearRangeFilterSheet.tsx`, `mobile/hooks/useBrowseMovies.ts`, `backend/main.py` (`GET /movies` now returns `poster_path`)
- [x] Build it: `/develop search & browse`
  - [x] Typeahead search (reuses `GET /movies/search` + `POST /movies/resolve`) navigating straight to Movie Detail
  - [x] Language / actor / year-range filter chips, each opening a bottom sheet, composed against `GET /movies`
  - [x] 2-column results grid with loading, error, and empty states
- [ ] Verify it: `/check verify search & browse`
- [ ] Test it: `/test search & browse`

## Journey 4: Mood discovery

### 8. Mood discovery
Free-text mood input blended with the user's taste vector on a slider, results in the same grid as Search. Fully specified in `design.md` §6.7 against the backend's `/recommend` (`mood_text`, `mood_weight`).
**Done when:** typing a mood and submitting returns a blended result set, and moving the slider visibly shifts results between taste and mood.
code in `mobile/app/(tabs)/mood.tsx`, `mobile/components/MoodTextArea.tsx`, `mobile/hooks/useMoodRecommendations.ts`, `mobile/types/api.ts` · verify steps [verify-mood-discovery.md](verify-mood-discovery.md)
- [x] Build it: `/develop mood discovery`
  - [x] Mood text area, "stick to my taste / follow my mood" slider, and "Find Movies" CTA, submitting to `POST /recommend` (`mood_text`, `mood_weight`) via a mutation (backend already supported both fields; no backend change needed)
  - [x] Results grid reusing `PosterCard` (same pattern as Search's grid), with loading skeleton, error + retry, pre-submit animated prompt, and no-results empty states
- [ ] Verify it: `/check verify mood discovery`
- [ ] Test it: `/test mood discovery`

## Journey 5: Ratings & profile

### 9. Ratings & profile
Two tabs, one journey: the Ratings tab (full rating history, promoted out of Profile so it's a quicker daily action — design.md §6.8) and the Profile tab (session info, sign out, continuous "Rate More Movies", dark/light toggle — design.md §6.9). Same data either way, against the backend's `/me/ratings` and `/ratings`; not a saved-for-later watchlist.
**Done when:** the Ratings tab lists every rated movie most-recent-first and tapping stars inline updates a rating; Profile shows session info, lets the user rate more movies continuously, and the theme toggle persists via AsyncStorage.
spec [0008](../specs/0008-delete-rating/index.md) (delete a rating only; the rest of this feature predates `/architect`) · code in `mobile/app/(tabs)/ratings.tsx`, `mobile/app/(tabs)/profile.tsx`, `mobile/app/(tabs)/_layout.tsx`, `mobile/app/_layout.tsx`, `mobile/hooks/useMe.ts`, `mobile/hooks/useThemeToggle.ts`, `mobile/lib/themePreference.ts`, `mobile/types/api.ts`, `backend/main.py`, `backend/auth.py`, `backend/db/import_data.py`
- [x] Build it: `/develop ratings & profile`
  - [x] Backend: `GET /me` now also returns `email`; `GET /me/ratings` now also returns `release_date`, `poster_path`, and `rated_at` per row, via a new `get_user_ratings_detailed` query kept separate from the recommendation engine's own `get_user_ratings`
  - [x] Ratings tab: most-recent-first list (poster, title, release year, inline star rating, date rated, live count chip), loading/error/empty states, tap-through to Movie Detail
  - [x] Profile tab: session email + Sign Out, continuous "Rate More Movies" (reuses onboarding's search/resolve/rate pattern, no completion gate), Dark/Light toggle wired to NativeWind's color scheme and persisted via AsyncStorage, restored on relaunch
  - [x] Delete a rating: `DELETE /ratings/{movie_id}` plus a trash icon and confirm dialog on the Ratings tab, with Home's recommendation rows refreshed afterward (spec [0008](../specs/0008-delete-rating/index.md), AC-1 through AC-10)
- [ ] Verify it: `/check verify ratings & profile`
- [ ] Test it: `/test ratings & profile`

## Journey 6: Notifications

### 10. Notifications
`design.md` §6.4 shows a bell icon on Home with nothing behind it — no trigger, no backend feed, no state defined anywhere in `overview.md` or the backend. This journey decides what a notification actually is for this product (what triggers one, what it shows, how the backend serves it) and builds the real bell state + notification list.
**Done when:** two backend triggers (a 5 rating threshold "recommendations ready", and a 7 day inactivity "re-engagement" scan) write real, persisted notifications; the Home bell shows a real unread count and opens a full history list; each type can be muted from Profile.
spec [0006](../specs/0006-notifications/index.md) · code in `backend/db/migrations/`, `backend/db/import_data.py`, `backend/main.py`, `mobile/app/notifications.tsx`, `mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/profile.tsx`, `mobile/hooks/`, `mobile/lib/queryClient.ts`, `mobile/types/api.ts`
- [x] Design it (spec): `/architect notifications`
- [x] Build it: `/develop notifications`
  - [x] Data model + backend read/write functions: migration (notifications table, users columns, backfill, indexes), `import_data.py` functions including the atomic threshold check and the testable re-engagement scan (AC-1, AC-2, AC-7, AC-9)
  - [x] Backend triggers + endpoints: `GET`/`PATCH /me` notification_prefs, `POST /ratings` threshold trigger, the four `/me/notifications` endpoints (AC-1, AC-3 through AC-9)
  - [x] APScheduler re-engagement job wired into the FastAPI lifespan (AC-2, AC-8) -- v3's `AsyncIOScheduler`, not the bundled skill's v4 examples (v4 isn't published on PyPI)
  - [x] Mobile hooks, bell badge, and the full screen notification list (AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-12)
  - [x] Profile mute toggles (AC-7, AC-8, AC-11)
- [ ] Verify it: `/check verify notifications`
- [ ] Test it: `/test notifications`

### 11. Forgot password · Journey 1
Lets a user who forgot their password recover account access by email, without needing support. Belongs to Journey 1 (Account & getting started) but added after that journey's main build, so it is numbered and tracked separately from feature 5 rather than folded into its already-built structure. Reuses the app's existing numeric code UX (spec 0004's signup confirmation pattern) via Supabase Auth's native password recovery flow.
**Done when:** a user can request a reset code by email, enter it with a new password, get signed back in automatically, and every other active session for that account is revoked.
spec [0007](../specs/0007-forgot-password/index.md) · code in `mobile/app/(auth)/`, `mobile/hooks/useAuth.ts`, `mobile/types/api.ts`, `backend/auth.py`, `backend/main.py`, `backend/requirements.txt`
- [x] Design it (spec): `/architect forgot password`
- [x] Build it: `/develop forgot password`
  - [x] Backend: Supabase recovery proxy functions (`check_email_registered`, `send_password_reset`, `verify_recovery_code`, `finish_password_reset`) plus the `slowapi` rate limit on the request endpoint (AC-2, AC-3, AC-6, AC-7, AC-9, AC-10, AC-12, AC-13, AC-14)
  - [x] Backend: `POST /auth/request-password-reset` and `POST /auth/reset-password` endpoints and request models (AC-2 through AC-7, AC-9, AC-10, AC-13, AC-14)
  - [x] Mobile: `useRequestPasswordReset` / `useResetPassword` hooks and API types (AC-2, AC-6, AC-8)
  - [x] Mobile: Request Reset and Reset Password screens, plus the Log In screen's new "Forgot password?" link (AC-1, AC-3, AC-4, AC-5, AC-7, AC-8, AC-11, AC-13, AC-14)
- [ ] Verify it: `/check verify forgot password`
- [ ] Test it: `/test forgot password`

## Release readiness

### 12. App store submission readiness
Closes the three items previously listed as deferred (privacy policy, terms, account deletion) plus the build and store configuration a real submission also needs: bundle identifier and EAS build/submit profiles, and what to declare in each store's privacy forms. Splits into four child specs.
**Done when:** a Privacy Policy and Terms of Service are reachable at a public URL and linked from signup and Profile; a signed in user can request account deletion from Profile or from a web page outside the app, with a 30 day recoverable grace period; `app.config.ts` and `eas.json` have a real bundle identifier, package name, and working build/submit profiles for both stores; and Apple's App Privacy details and Google Play's Data Safety form are filled in to match what the app actually collects.
spec [0009](../specs/0009-app-store-submission-readiness/index.md) · code in `mobile/app/(auth)/signup.tsx`, `mobile/app/(tabs)/profile.tsx`, `mobile/app.config.ts`, `mobile/eas.json`, `backend/main.py`, `backend/auth.py`, `backend/db/migrations/`, `backend/db/import_data.py`, `backend/requirements.txt`
- [x] Design it (spec): `/architect app store submission readiness`
- [ ] Build it: `/develop app store submission readiness`
  - [x] App identity and build config: bundle identifier, package name, `eas.json` build and submit profiles (AC-4) -- `com.nextwatch.app`, three build profiles, remote versioning; `eas credentials` and store enrollment (task 4-5) are manual prerequisites, not yet done
  - [x] Legal screens and consent: privacy policy, terms, and support pages, linked from signup and Profile (AC-1)
  - [x] Account deactivation and deletion: schema change, server side gate, the web deletion form, the daily purge job, and the mobile deactivate/reactivate flows (AC-2, AC-3) -- migration renumbered `0005_account_deactivation.sql` (0004 taken by the concurrent TV-show-support build), applied and confirmed live
  - [ ] Store metadata and privacy declarations: Apple App Privacy details and Google Play Data Safety form (AC-5) -- pure console configuration, no code; blocked on the Apple/Google developer accounts from task above
- [ ] Verify it: `/check verify app store submission readiness`
- [ ] Test it: `/test app store submission readiness`

### 17. Web and mobile deployment · Release readiness
Gives the web app a public home and turns releases into a repeatable, tested step. Web is hosted on Cloudflare Workers from GitHub Actions with a preview per pull request; iOS and Android builds start from a version tag on EAS and submit to the test tracks only; JavaScript fixes ship through a manual EAS Update. The backend stays on FastAPI Cloud. Closes the open hosting follow up in spec 0011 and the pipeline half of spec 0009.
**Done when:** a merge to `main` publishes the web app at its public address after the checks pass, a pull request gets a preview address, a `vX.Y.Z` tag that matches `app.config.ts` builds both apps on EAS and lands them in TestFlight and Google Play internal testing, and a manual update reaches an installed build on the `production` channel.
spec [0014](../specs/0014-web-and-mobile-deployment/index.md) · code in `.github/workflows/`, `mobile/wrangler.jsonc`, `mobile/public/_redirects`, `mobile/eas.json`, `mobile/app.config.ts`, `mobile/app/+html.tsx`, `mobile/app/index.web.tsx`
- [x] Design it (spec): `/architect deployment`
- [ ] Build it: `/develop deployment`
  - [x] Web hosting: `wrangler.jsonc`, `_redirects` deep link rewrite, `SITE_URL` and `NOINDEX` wired into `+html.tsx` and `index.web.tsx`, `web-deploy.yml` with per pull request previews
  - [ ] Mobile release: `eas init`, EAS and `expo-updates` fields in `app.config.ts`, `eas.json` channels, environments, `ascAppId`, removed service account path, `mobile-release.yml` with the tag checks
  - [x] Over the air updates: `mobile-update.yml` with the `tag` input, `--environment production`, Sentry source maps
  - [ ] Manual prerequisites done and recorded: Cloudflare account, store enrollments, `eas credentials`, EAS environment variables, GitHub secrets and variables, `v*` tag ruleset
- [ ] Verify it: `/check verify deployment`
- [ ] Test it: `/test deployment`

## Journey 7: TV show support

### 13. TV show support
`search_tmdb_movie` (`backend/recommend.py`) only ever called TMDB's `/search/movie`, and the whole data model (`movies_test.csv`, the embeddings pipeline, the recommendation engine) was movie only, so a TV series could never resolve, even with an exact title match, since it lives in TMDB's separate `/search/tv` catalog. Flagged after a user searched three real titles ("The Manipulated", "Moon Lovers: Scarlet Heart Ryeo") that all turned out to be TV series, not movies. This journey brings TV shows to full parity with movies: search, rate, recommend, mood discovery, trending, notifications, and filters, via one shared `movies` table (a new `media_type` column, part of a composite primary key) instead of a separate TV system.
**Done when:** a TV show can be searched and rated like a movie, counts toward the same unified taste vector, shows a type badge in merged Search/Browse/Home results with an optional media_type filter, has its own Movie Detail rendering (seasons, episodes, status, creator), and the real bulk TV fetch (20,000 shows) has run.
spec [0010](../specs/0010-tv-show-support/index.md) · code in `backend/db/migrations/`, `backend/db/import_data.py`, `backend/recommend.py`, `backend/fetch_movies.py`, `backend/main.py`, `mobile/types/api.ts`, `mobile/components/PosterCard.tsx`, `mobile/app/movie/`, `mobile/app/(tabs)/search.tsx`, `mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/mood.tsx`, `mobile/app/(tabs)/ratings.tsx`, `mobile/app/(tabs)/profile.tsx`, `mobile/app/onboarding/`
- [x] Design it (spec): `/architect TV show support`
- [ ] Build it: `/develop TV show support`
  - [x] Data model & TMDB integration: migration (composite key, TV columns, phased with a transitional default), unified fetch script + TV field mapping, composite key propagation across `import_data.py`/`recommend.py`
  - [x] Backend API: dual-catalog resolve/search, path segment id routes (`/movies/{media_type}/{id}`), media_type on ratings/browse, popularity ordered merged lists, type neutral notification copy
  - [x] Mobile, Search & browse parity: updated types, TV badge, media_type filter chip, nested `/movie/[type]/[id]` route, TV-aware Movie Detail
  - [x] Mobile, Discover/Mood/Ratings/Onboarding parity: mixed rows, type neutral copy ("Rate More"), delete against the composite key
  - [ ] Run the real (non test) unified bulk fetch (60,000 movies + 20,000 TV shows)
- [ ] Verify it: `/check verify TV show support`
- [ ] Test it: `/test TV show support`

### 14. Web landing page · Journey 1
A public landing page for logged out web visitors at "/", built to static HTML so search engines and link previews can read it, following the supplied dark design with a derived light version and a phone layout. Web only: iOS and Android are unchanged, and a logged in web user still goes straight into the app. Added after Journey 1's main build, so it is tracked separately from feature 5.
**Done when:** a logged out web visitor sees the full landing page at "/" in dark or light, can reach Sign Up and Log In from it, a logged in visitor still ends up on their spec 0004 route, and `expo export --platform web` emits real HTML for "/" with title, description and share tags.
spec [0011](../specs/0011-web-landing-page.md) · code in `mobile/app/index.web.tsx`, `mobile/app/_layout.tsx`, `mobile/app/+html.tsx`, `mobile/components/landing/`, `mobile/constants/`, `mobile/assets/`
- [x] Design it (spec): `/architect web landing page`
- [ ] Build it: `/develop web landing page`
  - [x] Static web build and root layout changes for web, plus the guarded redirect in `index.web.tsx` (AC-1 through AC-4, AC-12)
  - [x] Content, assets and page sections: nav, hero, callout, features, global cinema, how it works, FAQ, footer (AC-5 through AC-9, AC-15)
  - [ ] Theming, responsive layout, SEO tags and theme script (AC-10, AC-11, AC-12)
  - [ ] Analytics events and accessibility pass (AC-13, AC-14)
- [ ] Verify it: `/check verify web landing page`
- [ ] Test it: `/test web landing page`

### 15. Web auth split screen · Journey 1
On web at 1024 pixels and wider, the five auth screens (Log In, Sign Up, Forgot password, Confirm email, Reset password) show a cinematic panel beside the form, set up once in the auth layout. Phones, narrow web and the native apps are unchanged. A first version was built before the decision, so this row covers the rework.
**Done when:** all five auth screens show the panel at 1024 pixels and above, the panel stays put when moving between them, the form is capped at 420 pixels at every web width, the quote does not move under reduced motion, and narrow web and native look as before.
spec [0012](../specs/0012-web-auth-split-screen.md) · code in `mobile/app/(auth)/_layout.tsx`, `mobile/app/(auth)/login.tsx`, `mobile/app/(auth)/signup.tsx`, `mobile/components/auth/`, `mobile/constants/authPanelContent.ts`, `mobile/assets/`
- [x] Design it (spec): `/architect web auth split screen`
- [ ] Build it: `/develop web auth split screen`
  - [ ] Move the split into the auth layout, 1024 pixel breakpoint, right pane with the 420 pixel cap, background and scroll (AC-1 through AC-5, AC-8)
  - [ ] Reduced motion for the quote and the overlay contrast fix (AC-6, AC-7, AC-9)
- [ ] Verify it: `/check verify web auth split screen`
- [ ] Test it: `/test web auth split screen`

## Backend data layer

### 16. Catalog in Postgres (pgvector)
The backend loads the whole movie catalog and every embedding into server memory at startup, which ran a small cloud container out of memory and means new movies only arrive after a local rebuild and a redeploy. This moves the catalog and embeddings into Supabase Postgres with pgvector, keeps every API response identical so the mobile app does not change, loads the best titles by vote count up to a size cap, and adds a daily GitHub job that refreshes the catalog on its own. A scoped exception to the `AGENTS.md` rule that keeps `backend/` out of `/develop` and `/sync`: only this data layer change is built under the workflow.
**Done when:** the server starts and serves requests without loading the catalog or the embedding model into memory, every existing endpoint returns the same shape and score meaning from Postgres, the catalog is loaded to the size cap, a title searched live is stored with its embedding and survives a restart, and the daily refresh adds new titles and refreshes vote counts without a redeploy.
spec [0013](../specs/0013-pgvector-catalog/index.md) · code in `backend/db/migrations/`, `backend/db/import_data.py`, `backend/db/load_catalog.py`, `backend/db/refresh_catalog.py`, `backend/recommend.py`, `backend/main.py`, `.github/workflows/catalog-refresh.yml`
- [x] Design it (spec): `/architect pgvector catalog migration`
- [ ] Build it: `/develop pgvector catalog`
  - [x] Golden file of current results, then the migration, shared helpers, backfill, and the size capped bulk load (AC-8, AC-9, AC-13)
  - [x] Pooled connections and the recommend, browse, search, and detail read paths on Postgres (AC-1 through AC-5, AC-12, AC-15, AC-16)
  - [x] Live resolve write path, background model loading, size ceiling and rate limits (AC-6, AC-7, AC-11)
  - [x] Daily refresh script and GitHub workflow (AC-10, AC-11)
  - [ ] Remove the in memory path and `POST /admin/reload` (done), run the full load to the cap, deploy and verify (AC-1, AC-2, AC-8, AC-14)
- [ ] Verify it: `/check verify pgvector catalog`
- [ ] Test it: `/test pgvector catalog`

## Deferred

Out of scope for this build pass, kept so the plan stays honest.
- **Admin page**: internal content/data management · needs a decision — deferred per `overview.md`, no auth role system exists yet.
- **Monetization / paid tiers**: deferred until the core loop proves out per `overview.md`; only a reserved `plan`/`tier` column, no feature work.
- **Watchlist / saved-for-later**: explicitly excluded by product decision (`overview.md`), not merely postponed — don't reintroduce without an explicit new decision.
- **Backend type codegen**: generating TypeScript types from the backend's Pydantic models instead of hand syncing `mobile/types/` — deferred until the API surface grows enough to justify it, not needed for the initial scaffold (from spec [0001](../specs/0001-mobile-stack-architecture/index.md)).
- **Backend (FastAPI) error monitoring**: `backend/` predates this workflow and is out of scope for `/architect`/`/develop` per `AGENTS.md`; the backend currently has no crash visibility of its own, flagged here so the gap isn't silently forgotten (from spec [0003](../specs/0003-error-monitoring-product-analytics/index.md)).
- **Real push notifications** (Expo push service, OS level delivery while the app is closed): deferred until the in app notification system (item 10) ships; closes that feature's one accepted gap, reaching a user who has stopped opening the app (from spec [0006](../specs/0006-notifications/index.md)).
- **Delete a rating from Profile and onboarding**: spec [0008](../specs/0008-delete-rating/index.md) only adds delete to the Ratings tab (item 9); Profile's "Rate More Movies" and onboarding's picks list keep showing rated movies with no way to remove them. Deferred rather than built everywhere at once, since the Ratings tab is the primary place users manage past ratings; revisit if that gap becomes a real complaint.
- **TV episode/season tracking**: spec [0010](../specs/0010-tv-show-support/index.md) explicitly treats a TV show as one ratable unit, like a movie, with no "which episode am I on" state or per-episode ratings — that shape of feature was ruled out as a reintroduction of the already-rejected watchlist/progress-tracking concept. Revisit only with an explicit new decision.
- **Niche out of catalog candidates**: the catalog is capped, so a very niche taste can miss its best match outside it. Using TMDB `/similar` and `/recommendations` to fetch and embed those candidates live, then merge them with catalog results, is deferred until the catalog is loaded and results can be judged (from spec [0013](../specs/0013-pgvector-catalog/index.md)).
- **Mobile handling of `503` with `Retry-After`**: after a cold start, mood requests can return `503` for about a minute while the embedding model loads. The mobile app has no retry or friendly message for it yet (from spec [0013](../specs/0013-pgvector-catalog/index.md)).
- **Landing page stats block and About page**: spec [0011](../specs/0011-web-landing-page.md) leaves out the "Join the Cinephiles" numbers (no real figures or backend totals yet) and the "About" link (no content). Bring them back once real numbers and copy exist.

- **Staging backend and database**: web previews and test builds call the production API and write real data (from spec [0014](../specs/0014-web-and-mobile-deployment/index.md)). A separate staging environment is deferred until a real tester or user base makes that risk matter.

## Legend

**The decision box.** Every feature that needs one carries exactly one, the sub-task whose label ends with `(spec)`. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `planned`, no decision needed | `/scope` | one box: `Build it: /develop <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked; spec linked; `Build it: /develop <feature>` + 2 to 5 milestones rolled up from the spec; `Verify it` + `Test it` boxes |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | `/test` (Medium tier's last required stage), then `/sync` | all required boxes ticked; `/sync` captures conventions into `AGENTS.md` |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status**: `planned` → `in-progress` → `done`, plus `existing` (pre-workflow, untouched by `/develop`/`/sync`) and `dropped` (de-scoped, kept for history).
- **Workflow** (header line): the project default tier — **Medium** = `/check verify` then `/test` after `/develop`. A feature's own tier tag (none set currently) overrides it; Notifications is the most likely future candidate for a bump given it's a new, undecided system.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
