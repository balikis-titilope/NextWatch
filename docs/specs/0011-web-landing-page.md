# 0011. Web landing page for logged out visitors

**Date**: 2026-10-11
**Status**: In Progress

## Summary

NextWatch gets a public landing page on web only, shown at "/" to visitors who are not logged in. It follows the supplied design (hero, why it helps, features, global cinema, how it works, FAQ, footer) and follows the visitor's light or dark setting. The page is built into plain HTML ahead of time so search engines and link previews can read it. iOS and Android do not change, and a logged in web user still goes straight into the app.

## Context

> ⚠️ Premise note: Building the web app into static HTML does not help search engines by itself. Today the root layout shows an animated splash until the session check finishes, and renders nothing until fonts load, so a crawler would only get the splash. The landing route must therefore render on web before both of those finish. This spec decides that, and it is the riskiest part of the build.

Today a logged out visitor who opens the web app at "/" is redirected to the Log In screen (spec 0004). There is no page that explains the product, no way to share a link that previews well, and nothing for a search engine to index. The backend already hosts public legal pages (Privacy, Terms, Support) from spec 0009, but nothing links to them before login.

The app is one Expo Router codebase for iOS, Android and Web. Web currently builds as a single page app. The project rules (`mobile/AGENTS.md`) say every screen supports dark and light, new screens need a spec, and the app has no guest mode. The design is a dark only desktop mock, so light mode and phone width layouts have to be derived from `mobile/context/design.md`.

## Requirements

**User stories**:
- As a first time visitor on web, I want to see what NextWatch does before I sign up, so I can decide whether to join.
- As a returning user on web, I want to log in quickly, and if I am already logged in I want to land in the app without extra steps.
- As the product owner, I want the page to be readable by search engines and to preview well when shared.

**Acceptance criteria** (the contract, each independently checkable):
- **AC-1**: On web, a visitor with no valid session who opens "/" sees the landing page. They are not sent to Log In and do not get stuck on the splash screen.
- **AC-2**: On iOS and Android, "/" behaves exactly as before (redirect to the launch route from spec 0004). The landing page is never shown on native.
- **AC-3**: On web, a visitor with a valid session who opens "/" ends up on the same route spec 0004 resolves (`/(tabs)`, `/onboarding` or `/reactivate`). The landing page may show first, for up to the launch time budget (worst case about 16.5 seconds, two attempts of 8 seconds plus a 0.5 second pause). If the visitor has already left "/" (for example tapped Join Now or Log in) when the result arrives, no redirect happens.
- **AC-4**: On web, if the session check fails or hits the 8 second timeout, the landing page stays on screen with no error message. A confirmed logged out result also leaves the visitor on the landing page.
- **AC-5**: The page has these sections in this order: sticky nav, hero, "Tired of scrolling" callout, "Discover the Difference" block (Mood Discovery, Smart Matches, Built on Your Taste), Global Cinematic DNA (four region tiles), How it Works (Rate, Match, Watch), FAQ, footer. The "Join the Cinephiles" stats block is not shown.
- **AC-6**: "Join Now" (nav) and "Start Rating Now" (hero) open Sign Up (`/(auth)/signup`). A "Log in" link in the nav opens Log In (`/(auth)/login`).
- **AC-7**: The nav stays at the top while scrolling. Discover scrolls to the top, Features to the "Discover the Difference" block, How It Works to its section. There is no About link and no search icon.
- **AC-8**: Footer has Features (scrolls up), Privacy Policy, Terms of Service and Contact. The last three open the backend pages `/legal/privacy-policy`, `/legal/terms` and `/legal/support`. There is no Press Kit link.
- **AC-9**: The three FAQ items start closed and open or close on tap or on keyboard Enter or Space. Each works independently.
- **AC-10**: The page follows the visitor's OS light or dark setting, using the `design.md` color tokens for both. Body text meets WCAG AA contrast in both modes, including over the hero image.
- **AC-11**: At phone width the layout is one column, the nav shows only the logo, "Log in" and "Join Now", and nothing scrolls sideways. At 768 pixels wide and above it matches the design, with content capped at 1120 pixels wide and centered. The landing page does not use the app's 480 pixel content width helper.
- **AC-12**: `expo export --platform web` produces an HTML file for "/" that contains, without running JavaScript, the hero headline, a page title, a meta description and share (Open Graph) tags including an `og:image` tag. A share preview that actually works needs a public web address and an absolute image URL, so it waits on the hosting decision (see Follow-up).
- **AC-13**: The page sends one `landing_viewed` event per load, and a `landing_cta_clicked` event for each signup or login button, with no personal data. Events follow the existing rule that telemetry is off in development.
- **AC-14**: The page has exactly one top level heading, descriptive text for every meaningful image, visible keyboard focus, and every button or link is reachable and usable by keyboard.
- **AC-15**: Every image on the page is imported through the central `assets/index.ts` module, except the share image, which lives in `public/` so it has a stable, unhashed path. Where a clean image is not available, a dark gradient placeholder of the same size is used.

## Options considered

### Option 1: A web only route inside the existing Expo app, built to static HTML

Add a web specific "/" route, switch web output to static, and make the root layout render it before the splash and fonts finish. One codebase, one design system, no new deploy target.

**Pros**:
- Reuses the existing tokens, fonts, components, theme handling and telemetry.
- The Sign Up and Log In buttons are plain in app routes, so there is no cross site hop.
- Search engines get real HTML.

**Cons**:
- Switching web to static output touches the whole web build, and dynamic routes such as `movie/[type]/[id]` need a host fallback.
- Some imports may not be safe to run at build time and need guarding.
- Root layout needs a web only exception.

### Option 2: A separate marketing site (for example Astro or Next.js) on its own domain

A small standalone site that links to the app.

**Pros**:
- Best search and performance story, and no risk to the app build.
- Can be edited without touching the app.

**Cons**:
- A second project, second deploy, second design system to keep in sync.
- Needs a domain and hosting that do not exist yet, and a team this size would maintain two web surfaces.

### Option 3: Same route, but keep the single page app and only add meta tags

No build change. The landing page renders in the browser.

**Pros**:
- Smallest change.

**Cons**:
- Crawlers and link previews still see an empty shell, so the main reason for a public page is lost.

## Decision

**Chosen option**: Option 1: A web only route inside the existing Expo app, built to static HTML

Add `app/index.web.tsx` as the landing route, set web output to static, and on web make the root layout always render the screen stack, with no splash gate and no font wait. Native keeps the current gates. The landing route does the one redirect for logged in visitors.

**Implementation skills**: `vercel-react-native-skills` (`vercel-labs/agent-skills`, `mobile/.agents/skills/vercel-react-native-skills/`) · `zustand` (`lobehub/lobehub`, `mobile/.agents/skills/zustand/`)

## Rationale

The project already runs one universal codebase with shared tokens, fonts and a theme system (spec 0001, spec 0002). A second site would double the design and deploy work for a small team, and meta tags alone would not let search engines read the page. Option 1 gives real HTML with the least new surface, at the cost of a careful web build change.

The engineer chose to show the page immediately and check the session in the background. That means a logged in user on web may see the landing page for a moment before being sent into the app. This was accepted because the alternative (keeping the splash) leaves crawlers with an empty page and defeats the static build.

A cross check showed that a per route splash gate would swap the screen stack for the splash in the middle of a visit (for example after a tap on Join Now), and that the launch check and the visitor's own navigation can now overlap, which the native splash used to prevent. So on web the gate is removed entirely and the redirect is guarded instead.

The engineer chose to follow the OS theme and derive a light version, which follows `mobile/AGENTS.md` (every screen supports dark and light). The cost is that the light version has no approved design, so it needs a review after the build.

## Feature design

**Data model sketch**: Not applicable. The page stores and reads no data. Copy lives in a constants file, images in the central assets module.

**State transitions**: The route decision on web at "/":

```
open any route on web
  -> screen stack renders at once (no splash, no font wait, never unmounted)
  -> session check runs in the background (spec 0004, 8 second timeout, one retry)
open "/" on web
  -> landing page shows
  -> when launchRoute arrives, ONE redirect runs, only if all are true:
       launchRoute is not empty and is not "/(auth)/login"
       "/" is still the focused screen
       -> router.replace(launchRoute)
  -> logged out, failed and timed out all arrive as "/(auth)/login", so the visitor stays
```

Rules for the guard: use a one time effect tied to focus on "/" (never a reactive `<Redirect>`, because the hidden landing stays mounted after a push and login or signup also set `launchRoute`); once the visitor leaves "/", no later result redirects them. The background launch result is dropped if the visitor logged in or signed up in the meantime (`userId` already set), so a late "/(auth)/login" cannot overwrite a fresh login. On web the mid session logout redirect in the root layout no longer needs `launchRoute` to be set first.

On native, "/" is unchanged: wait for launchRoute, then redirect.

**API surface**: No new backend endpoints. The page uses these existing destinations:

| Destination | Type | Used by | Auth | Key errors |
|---|---|---|---|---|
| `/(auth)/signup` | in app route | Join Now, Start Rating Now | none | none |
| `/(auth)/login` | in app route | Log in link | none | none |
| `${API_BASE_URL}/legal/privacy-policy` | backend page | footer | none | link may 404 if backend is down, no handling needed |
| `${API_BASE_URL}/legal/terms` | backend page | footer | none | same |
| `${API_BASE_URL}/legal/support` | backend page | footer Contact | none | same |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Render landing | Every heading, paragraph, button label, FAQ answer | `constants/landingContent.ts`, copied from the design (see Copy below) |
| Render landing | Hero, bokeh, poster and region images | `assets/index.ts`, cropped from the design screenshot or gradient placeholders |
| Render landing | Colors, fonts, spacing | `design.md` tokens via `tailwind.config.js` (dark and light) |
| Pick theme | Dark or light | Visitor's OS setting through NativeWind, plus a stored manual override if one exists (`lib/themePreference.ts`) |
| Footer links | Privacy, Terms URLs | `PRIVACY_POLICY_URL`, `TERMS_URL` in `constants/config.ts` |
| Footer Contact | Support URL | new `SUPPORT_URL` in `constants/config.ts`, same base URL pattern |
| Redirect decision | Route for a logged in visitor | `launchRoute` in `sessionStore` (spec 0004) |
| SEO | Page title, meta description, share image | Drafted from the hero copy (below), share image is the hero crop from `assets/index.ts` |
| SEO | Canonical URL, `og:url`, absolute `og:image` URL | Not set until the web host and address are decided (see Follow-up); the image file itself is `public/landing-share.png` |
| SEO | Where the tags live | `expo-router/head` inside `app/index.web.tsx` for title, description and share tags; `app/+html.tsx` for the theme script |
| Render landing | Font before Inter and Playfair load | System stack: `ui-sans-serif, system-ui, sans-serif` for body, `Georgia, serif` for headings; a small layout shift on load is accepted |
| Static HTML | Theme before first paint | A small script in `app/+html.tsx` reads `nextwatch_theme_preference` from localStorage, else the OS setting, and sets the `dark` class. With no script (build time) the export is dark, matching the design |
| Layout | Desktop breakpoint and width | 768 pixels and above; content max width 1120 pixels, centered |
| Sticky nav | How it stays at the top | The nav sits outside the ScrollView; section scroll targets come from `onLayout` positions inside the ScrollView |
| Footer links | How they open | Real anchor links (crawlable) opening in a new tab, not `Linking.openURL` |
| Analytics | Event name and `cta` value | Fixed strings: `landing_viewed`; `landing_cta_clicked` with `cta` one of `nav_join`, `nav_login`, `hero_start` |
| Section scroll | Vertical position of each section | Measured at layout time with `onLayout` (an allowed StyleSheet case in `mobile/AGENTS.md` section 7) |

**SEO text (draft, engineer reviews)**:
- Title: `NextWatch: your next favorite film`
- Description: `The discovery engine for true cinephiles. Rate a few films, get a short list matched to your taste and mood, and stop scrolling.`

**Copy (from the design; the screenshot is the source of truth for exact wording)**:
- Nav: logo, Discover, Features, How It Works, Log in, Join Now
- Hero: "Your Next Favorite Film is One Tap Away." / "The intelligent discovery engine for true cinephiles. Stop endlessly scrolling and start watching what moves you." / button "Start Rating Now"
- Callout: "Tired of scrolling for 45 minutes?" / "NextWatch tells you what to watch in seconds. Our intelligent engine cuts through the noise so you can spend less time searching and more time experiencing great cinema."
- Discover the Difference ("A tailored cinematic journey, built for you."): Mood Discovery (text and mood chips), Smart Matches ("Predicted scores based on your unique cinematic DNA", with an example score badge), Built on Your Taste (text and five stars)
- Global Cinematic DNA: heading, paragraph, tiles K-Dramas, Bollywood, Nollywood, European Arthouse
- How it Works ("Three steps to your next obsession."): 1 Rate, 2 Match, 3 Watch
- FAQ (heading replaces the dropped "Join the Cinephiles"): Is NextWatch free to use? / What regions are supported? / How accurate are the matches?
- Footer: logo, Features, Privacy Policy, Terms of Service, Contact, "© 2026 NextWatch. Cinematic Discovery."

**Key invariants**:
- Native behavior of "/" never changes (AC-2).
- On web the screen stack is never unmounted for a splash, and never waits on the session check or fonts to render (AC-1, AC-4, AC-12).
- The landing route never redirects a logged out visitor, redirects at most once, and only while "/" is focused (AC-3, AC-4).
- `landing_viewed` fires on mount every time, including for visitors who are about to be redirected (accepted noise).
- No claim on the page is shown that the owner has not confirmed (the stats block is dropped for this reason).
- No colors are hard coded; every color is a design token (`mobile/AGENTS.md` section 7).
- No personal data goes into analytics events.

**Security model**: A fully public page with no login and no stored data. Only anonymous analytics events leave the browser. Compliance scope: anonymous web analytics may need a cookie or consent notice depending on where visitors are; this is flagged in Follow-up and is not decided here.

**Configuration required**:
- `app.config.ts`: set `web.output` to `"static"`.
- No new environment variables. `EXPO_PUBLIC_API_BASE_URL` is already used for the legal links, and it must be set when running `expo export`, because `lib/api.ts` throws on import without it.

**Critical test scenarios**:
- Happy path: logged out web visitor opens "/", sees all sections, taps Join Now, lands on Sign Up, verifies **AC-1**, **AC-5**, **AC-6**
- Happy path: exported HTML for "/" contains headline, title, description and share tags with JavaScript off, verifies **AC-12**
- Failure case: backend unreachable on web, landing stays with no error, verifies **AC-4**
- Failure case: logged in web user opens "/" and ends on the spec 0004 route, verifies **AC-3**
- Native: iOS/Android "/" still redirects to launchRoute and never renders the landing, verifies **AC-2**
- Theme and layout: dark, light, phone width and desktop width all render without sideways scroll and with readable text, verifies **AC-10**, **AC-11**
- Analytics: one `landing_viewed` per load and the right `cta` value per button, verifies **AC-13**

## Build plan

Approach: Journey (one complete visitor path built fully, with every state, before moving on). The riskiest step goes first because everything else depends on it.

1. Turn on static web output (`web.output: "static"`) and run `expo export --platform web` with `EXPO_PUBLIC_API_BASE_URL` set. Fix what breaks at build time, checking these by name: `initTelemetry()` (guard with `typeof window === "undefined"`), the splash screen module, `react-native-reanimated`, `react-native-gesture-handler`, `@gorhom/bottom-sheet`, and the web token storage. Check in app navigation across the existing routes, and serve the export with `npx serve` using a single page fallback. Also correct the existing `Stack.Screen name="movie/[id]"`, which does not match the file `movie/[type]/[id]`. Direct loads of dynamic routes need host rewrites and are covered by the hosting follow up, satisfies **AC-12**, **AC-2**
2. Change the root layout for web only: always render the screen stack, with the web check placed before the `fontsLoaded` check and before the splash gate, so nothing blocks the first render; keep both gates unchanged on native. Use the system font stack until fonts load. Drop a launch result if a login already set `userId`, and remove the `launchRoute !== null` condition from the mid session logout redirect on web, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-12**
3. Add `app/index.web.tsx` with the guarded one time redirect described in State transitions, and keep `app/index.tsx` for native, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**
4. Add `SUPPORT_URL` to `constants/config.ts` and create `constants/landingContent.ts` with the copy above, satisfies **AC-5**, **AC-8**
5. Copy the design screenshot into the repo as a reference (not bundled), crop the clean regions, make gradient placeholders where a crop would show baked in design text, and export them through `assets/index.ts`, satisfies **AC-15**
6. Build the page sections in `components/landing/` (nav outside the ScrollView, hero, callout, difference block, global cinema, how it works, FAQ with expand and collapse, footer with real anchor links), with section scrolling from `onLayout` positions, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-9**
7. Apply dark and light tokens, including a dark overlay on the hero so text stays readable in light mode, and add the theme script to `app/+html.tsx` so the page has the right theme before first paint, satisfies **AC-10**
8. Make the layout responsive: one column and the reduced nav below 768 pixels, design layout above, content capped at 1120 pixels, satisfies **AC-11**
9. Add the page title, description and share tags with `expo-router/head` in `app/index.web.tsx`, and put the share image in `public/`, satisfies **AC-12**
10. Add `landing_viewed` (on every mount) and `landing_cta_clicked` through `trackEvent`, satisfies **AC-13**
11. Accessibility pass: one h1, image descriptions, focus styles, keyboard use of the nav and FAQ, satisfies **AC-14**
12. Tests (handed to `/test` afterwards): web branches of the layout by mocking `Platform.OS` and `usePathname`, a new test file for `index.web.tsx` (stay when logged out, one redirect when logged in, no redirect after leaving "/"), and the existing native tests in `app/__tests__/` staying green, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**

## Consequences

**Positive**:
- Web visitors finally see what the product is, with real HTML for search and link previews.
- Reuses the existing design system, theme, fonts and telemetry, and adds no new library.
- Native apps are untouched.

**Negative / tradeoffs**:
- The static web output affects the whole web build and every other web route; dynamic routes need host fallback rules.
- A logged in web user may see the landing page for a moment before the redirect.
- The root layout gets a web only exception, which is more logic in the most sensitive file.
- On web, protected screens can now render before the launch check finishes, so they must show their own loading or logged out state. Spec 0004's rule that launch resolution and navigation never overlap only holds on native.
- The light version and the phone layout are derived, not designed, so they need a visual review.
- Images cropped from a screenshot are low resolution and may carry baked in text, so some use gradient placeholders for now.
- Web now has a second launch behavior that spec 0004 does not describe, so that spec goes stale until it is updated.

**Neutral**:
- The stats block and "About" link are left out until real data and content exist.
- Hosting for the static build is not decided here.

## Follow-up

- [ ] Add the landing page to `mobile/context/design.md` (screens, and the derived light and phone layouts), because `mobile/AGENTS.md` section 13 says to update the design doc before building a new screen
- [ ] Note the web "/" exception in spec 0004 (logged out web visitors see the landing page, not Log In) and in `mobile/AGENTS.md` section 5; `/sync` should reconcile this
- [ ] Decide where the static web build is hosted. When chosen: add the web address to the backend CORS list, set `og:url` and canonical URLs, and add fallback rewrites for dynamic routes such as `movie/[type]/[id]`
- [ ] Get clean, full resolution images (hero photo, bokeh, poster, region icons) to replace the screenshot crops and gradient placeholders
- [ ] Confirm every claim in the copy is true before launch: "completely free", supported regions, "AI", "uncannily accurate", and the example match score
- [ ] Decide whether anonymous web analytics needs a cookie or consent notice for visitors in regions that require one, and update the privacy policy if so. The PostHog web client stores an anonymous id in the browser, and the landing page does not wait for consent in this spec
- [ ] Check what each protected screen shows on web when it renders before the launch check finishes (loading or logged out), since the splash no longer hides it
- [ ] Bring back the "Join the Cinephiles" stats block once real numbers exist (a backend totals endpoint or confirmed figures)
- [ ] Decide whether to add an About page or section later
- [ ] Add this feature to `docs/scope/scope.md` (no row exists yet)
