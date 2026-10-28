# 0012. Web auth split screen

**Date**: 2026-10-11
**Status**: In Progress

## Summary

On web at desktop width, the five auth screens (Log In, Sign Up, Forgot password, Confirm email, Reset password) show a cinematic panel on the left and the form on the right. The panel is set up once in the auth layout, so it stays in place as people move between screens. It starts at 1024 pixels wide, always uses the dark colors, and stops rotating its film quote for people who ask their system for reduced motion. Phones, tablets in portrait and the native apps keep the plain form. A first version was built before this was decided, so the build needs a few changes (see Build plan).

## Context

Today the auth screens on web are a single narrow column on an empty page. On a desktop monitor that feels unfinished next to the new landing page (spec 0011). A first split screen was built during `/develop` on an assumption (this spec was then `Assumed`). It covers only Log In and Sign Up, wraps each screen on its own, and starts at 768 pixels.

Reading the built code against the rest of the app showed three problems:
- At 768 pixels each half is about 384 pixels wide, narrower than the 420 pixel form cap, so the form and the 40 pixel headline are cramped.
- Forgot password, Confirm email and Reset password are not wrapped. Tapping "Forgot password?" on Log In makes the panel disappear, and the form width jumps. Those three screens also have no width cap at all.
- The quote changes every 6 seconds with no way to stop it. That is moving content with no pause control, which fails the WCAG rule for auto updating content for people who ask for reduced motion.

The app is one Expo Router codebase (spec 0001). Every screen supports dark and light (`mobile/AGENTS.md`), images go through `assets/index.ts`, and styling is NativeWind first.

## Requirements

**User stories**:
- As a visitor on a desktop browser, I want the login and signup pages to feel like part of the same product as the landing page, so I trust them.
- As a visitor moving from Log In to Forgot password and back, I want the page to stay put, so it does not jump.
- As someone who asks for reduced motion, I want nothing on the page to move on its own.

**Acceptance criteria** (the contract, each independently checkable):
- **AC-1**: On web at 1024 pixels wide and above, all five auth screens (Log In, Sign Up, Forgot password, Confirm email, Reset password) show the cinematic panel on the left and the form on the right.
- **AC-2**: Below 1024 pixels on web, and on iOS and Android, no panel is shown and every auth screen looks and behaves as it did before this spec. The one exception is that Forgot password, Confirm email and Reset password gain the 420 pixel cap on web at every width (AC-5).
- **AC-3**: Form fields, validation, error messages, links and behavior on all five screens are unchanged.
- **AC-4**: The panel is mounted once by the auth layout. Moving between auth screens does not remount it, so the quote does not restart.
- **AC-5**: On web at every width, the form is capped at 420 pixels wide and centered on all five screens, set in one place (the layout), and the rest of the right half is painted with the page background. On short windows (for example 1024 by 600) the form scrolls instead of clipping.
- **AC-6**: The panel always uses the dark color tokens, in light and dark mode. Its text meets WCAG AA contrast (4.5 to 1) measured against the worst case, a pure white photo under the overlay. The photo and the whole panel are hidden from screen readers (decorative).
- **AC-7**: The panel rotates through the film quotes every 6 seconds with a fade. When the system asks for reduced motion, it shows the first quote with no rotation and no fade.
- **AC-8**: The headline and short line come from one set of copy, "Welcome back to the show." for Log In, Forgot password, Confirm email and Reset password, and "Your next favorite film is waiting." for Sign Up.
- **AC-9**: The photo is imported through `assets/index.ts`. If it fails to load, the panel still shows its dark background, text and logo.

## Options considered

### Option 1: Keep the first build (per screen wrapper, 768 pixels, Log In and Sign Up only)

Ratify what exists. No rework.

**Pros**:
- Already built and working.

**Cons**:
- Panel vanishes on three of five screens, and the form width jumps between them.
- Halves are cramped at 768 pixels.
- Rotating quote has no reduced motion rule.
- Five screens would each need to repeat the same wrapper to fix the first problem.

### Option 2: One split layout in `(auth)/_layout.tsx`, 1024 pixel breakpoint, all five screens

Move the panel and the form width cap into the auth route layout. Screens render only their form.

**Pros**:
- One place for the panel, the breakpoint and the width cap.
- The panel stays mounted across screens, so no flicker and the quote does not restart.
- Fixes the accessibility gap in one place.

**Cons**:
- Touches the layout and removes the per screen wrapper and width class from `login.tsx` and `signup.tsx`.
- Each screen still has its own `SafeAreaView`, which sits inside the right half and must keep working.
- Tablets in portrait (768 to 1023 pixels) get the plain form.

### Option 3: Drop the panel and use a plain centered card on a photo background

A single column card over a full page photo.

**Pros**:
- No layout split, so no breakpoint logic.

**Cons**:
- The form sits over a busy photo, which makes AA contrast harder on the form itself.
- Loses the cinematic panel the product owner chose.

## Decision

**Chosen option**: Option 2: One split layout in `(auth)/_layout.tsx`, 1024 pixel breakpoint, all five screens

On web only, the auth layout renders the cinematic panel beside the screen stack at 1024 pixels and above, caps the form side at 420 pixels, and leaves native and narrow web untouched.

**Implementation skills**: `vercel-react-native-skills` (`vercel-labs/agent-skills`, `mobile/.agents/skills/vercel-react-native-skills/`)

## Rationale

Option 1 leaves a visible defect: the panel disappears when someone taps Forgot password, which is a normal step of the login journey. Fixing that by wrapping three more screens repeats the wrapper five times, and the quote would restart on each navigation. Moving the split into the route layout fixes both with less code than the first build has now.

The 1024 pixel breakpoint follows from the numbers in Context, not taste. Below about 1000 pixels the form (420 pixels plus 24 pixel padding on each side) and a useful panel cannot both fit well. NativeWind's default `lg` breakpoint is 1024, so no config change is needed. This differs from the landing page breakpoint (768 pixels), which is fine: the landing page is one column of content, while this is a two column split that needs more room.

The panel always uses the dark tokens because white text over a dark photo stays readable in both themes. The cost is that light mode shows a dark panel beside a light form, which was accepted. The rotating quote was kept because it carries the cinema feel and makes no product claim, but it needs a reduced motion rule, so it shows the first quote and does not move for those users.

## Feature design

**Data model sketch**: Not applicable. No data is stored or read. Copy and quotes live in `constants/authPanelContent.ts`, the photo in the central assets module.

**State transitions**: None, apart from the quote index, which is local state inside the panel (cycles 0 to 4 and wraps, paused at 0 under reduced motion).

**Layout behavior**:
- `(auth)/_layout.tsx` renders `<AuthSplit>` around the `<Stack>`. `AuthSplit` returns just its children when `Platform.OS !== "web"`. It no longer takes a `variant` prop; it reads the route itself (see Value sourcing). Its header comment is updated from "768px" to "1024px".
- Web structure: a root row (`flex-1 lg:flex-row`), then the panel (`hidden lg:flex`, flex 1), then the right pane. The right pane has two named elements: an outer `flex-1 bg-bg-primary items-center` (paints the whole right half) and an inner `flex-1 w-full max-w-[420px]` that wraps a web only `ScrollView` (`contentContainerStyle` `flexGrow: 1, justifyContent: "center"`) around the `<Stack>`. The cap applies at every web width, so web between 421 and 1023 pixels keeps the capped form it has today.
- The cap lives on the layout wrapper, never on the screens. Each screen keeps its own `SafeAreaView bg-bg-primary` (needed for narrow web and native; web insets are 0, so it is harmless inside the pane), `KeyboardAvoidingView` and padding. The per screen change is removing `web:max-w-[420px] web:self-center` from `login.tsx` and `signup.tsx`.
- Below 1024 pixels the panel is hidden with CSS but stays mounted, so the quote timer keeps running and the image may still download on phones. This is accepted: gating on width in JavaScript risks a hydration mismatch in the static export, and the cost is one small state update every 6 seconds.
- Reduced motion is read once, when the panel mounts. A change made in system settings during a visit applies on the next load. This is accepted.

**API surface**: None. No new endpoints and no new routes.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Show panel or not | Whether the screen is web and at least 1024 pixels wide | `Platform.OS` for web, NativeWind `lg:` breakpoint (1024, default config) for width |
| Render panel | Headline and short line | `useSegments()` then `segments.at(-1) === "signup" ? AUTH_PANEL.signup : AUTH_PANEL.login`. The copy switches at once when moving between Log In and Sign Up, with no crossfade |
| Render panel | Quote line and film name | `AUTH_QUOTES` in `constants/authPanelContent.ts` |
| Render panel | Rotation interval | `QUOTE_INTERVAL_MS` (6000) in `constants/authPanelContent.ts` |
| Render panel | Reduced motion on or off | `useReducedMotion()` from `react-native-reanimated` (already installed, v4), which reads the system setting on web |
| Render panel | Photo | `authCinema` from `assets/index.ts` (`assets/auth-cinema.jpg`), source and license recorded below |
| Render panel | Logo | `logo` from `assets/index.ts` |
| Render panel | Colors | `dark` tokens from `constants/colors.cjs`, never the theme aware tokens |
| Form side | Width cap | 420 pixels, set once on the inner wrapper of `AuthSplit`'s right pane, at every web width |
| Form side | Background | `bg-bg-primary` on the outer right pane (theme aware) |
| Overlay | Gradient stops | Top `B3`, bottom `E6` alpha on `dark["bg-primary"]` (raised from `66` so the logo text passes contrast) |

**Photo source and license**: free commercial license (Unsplash or Pexels), no attribution required. The engineer has not given the exact photo page address, so this is recorded as a follow up, not an acceptance criterion.

**Key invariants**:
- Native behavior and narrow web behavior never change (AC-2).
- The panel is decoration only: no links, no buttons, no data, hidden from screen readers (`aria-hidden`, `accessibilityElementsHidden`), and never takes focus (AC-6).
- The panel mounts once per layout mount and is not remounted by moving between auth screens (AC-4).
- Under reduced motion nothing in the panel animates (AC-7).
- No hard coded colors except the existing `dark` token imports, and the photo overlay uses those tokens.
- The quotes are short, well known lines credited to their films. They are decoration, not a product claim.

**Security model**: Public, anonymous screens. No data, no storage, no new network calls beyond the already bundled image. No compliance scope.

**Configuration required**: None. No new environment variables, no new library.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: web at 1280 pixels wide, open Log In, see the panel and the form with the 420 pixel cap, tap Forgot password, panel stays and does not flicker, verifies **AC-1**, **AC-4**, **AC-5**
- Happy path: Sign Up shows the "Your next favorite film is waiting." headline and the other four show the Log In headline, verifies **AC-8**
- Layout (Jest): checks the `hidden lg:flex` classes and the `Platform.OS` gating only, because Jest cannot evaluate media queries, verifies **AC-1**, **AC-2**
- Layout (`/check verify` in a real browser): widths 800, 1024 and 1280, plus a 1024 by 600 window where the form scrolls, verifies **AC-1**, **AC-2**, **AC-5**
- Behavior: submit Log In and Sign Up with valid and invalid input, errors and navigation match today, verifies **AC-3**
- Reduced motion: with reduced motion on, the first quote shows and never changes after 7 seconds, verifies **AC-7**
- Normal motion: the quote changes after 6 seconds and the timer is cleared on unmount, verifies **AC-7**
- Accessibility: the panel is not in the accessibility tree, text contrast against a pure white photo under the overlay is at least 4.5 to 1, verifies **AC-6**
- Failure case: the photo does not load, the panel still shows dark background, logo, headline and quote, verifies **AC-9**

## Build plan

Approach: Journey (one complete user path, here the login journey from Log In through Forgot password and Reset password, built fully before anything else). The code mostly exists, so this is a rework in small steps.

1. Update `constants/authPanelContent.ts`: add a comment that panel copy is shared by the four non signup screens, keep `AUTH_PANEL.login` and `AUTH_PANEL.signup`, satisfies **AC-8**
2. Move `AuthSplit` into `(auth)/_layout.tsx` around the `<Stack>`, switch its breakpoint classes from `md:` to `lg:`, drop its `variant` prop and pick the copy from `useSegments` (Sign Up gets `signup`, all others `login`), update its header comment, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-8**
3. Build the right pane as described in Layout behavior (outer `bg-bg-primary` pane, inner 420 pixel wrapper, web only `ScrollView`), remove `web:max-w-[420px] web:self-center` and the `<AuthSplit>` wrapper from `login.tsx` and `signup.tsx`, satisfies **AC-5**, **AC-3**, **AC-2**
4. Add the reduced motion rule to `RotatingQuote` with `useReducedMotion()`: no interval and no `FadeIn` when on, satisfies **AC-7**
5. Raise the overlay top stop to `B3` and check the panel text against a pure white photo, darkening further if any text is under 4.5 to 1, satisfies **AC-6**
6. Make sure the photo failing to load still leaves a readable panel: set the panel's own dark background behind the image, satisfies **AC-9**
7. Tests (handed to `/test` afterwards): Jest checks the panel classes and `Platform.OS` gating, reduced motion and rotation behavior, headline per screen, and that existing auth screen tests stay green. Real widths are checked later by `/check verify`, satisfies **AC-1** through **AC-9**

## Consequences

**Positive**:
- The login journey keeps one stable look across all five screens.
- One place owns the panel, the breakpoint and the width cap, so the five screens cannot drift apart.
- The rotating quote no longer breaks the reduced motion rule.
- Net less code in `login.tsx` and `signup.tsx`.

**Negative / tradeoffs**:
- Tablets in portrait and small laptop windows under 1024 pixels get the plain form with no panel.
- Light mode shows a dark panel beside a light form. This was accepted.
- Reset password and Confirm email show "Welcome back to the show.", which does not describe those steps. This was accepted to avoid more copy to maintain.
- The photo's license cannot be confirmed from the repo until the source page is recorded.
- Quotes from films rely on short line use. They are decoration, so a swap for neutral lines is easy if anyone objects.

**Neutral**:
- The landing page uses 768 pixels, this uses 1024. They are separate layouts.
- The `AuthSplit` file moves from a per screen wrapper to a layout component but keeps its name and path.

## Follow-up

- [ ] The engineer to give the photo's source page address, then write it with its license in the "Photo source and license" field. Owned by the engineer, does not block the build
- [ ] Add the auth split screen to `mobile/context/design.md` (web layout, 1024 pixel breakpoint, dark panel), because `mobile/AGENTS.md` section 13 says to update the design doc before changing UI behavior
- [ ] Add this feature to `docs/scope/scope.md`: no row links this spec yet, so it has no `done` gate. Suggested home is a sub task under row 14 (Web landing page) or a new row, so `/develop` and `/check verify` can close it
- [ ] Visual check of the dark panel beside the light form in light mode (the 1024 by 600 check is now in the test scenarios)
- [ ] `/sync` should note the web auth layout in `mobile/AGENTS.md` section 5 (`(auth)/` row)
