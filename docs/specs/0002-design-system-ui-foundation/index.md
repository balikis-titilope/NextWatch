# 0002. Design system and UI foundation for the mobile app

**Date**: 2026-08-07
**Status**: In Progress

_Decision history (context, options considered, rationale) lives in [`rationale.md`](rationale.md). This file is the build spec: the decision, the component design, and the build plan._

## Summary

NextWatch's mobile app already has a full visual specification in `mobile/context/design.md`, colors, type, spacing, and five shared components, but none of the components exist in code yet. This spec turns that written design into five real, reusable components (`PrimaryButton`, `Chip`, `ScoreBadge`, `StarRatingRow`, `PosterCard`) plus a shared `Skeleton` loading piece, so every screen built from here on (the account, discover, search, mood, and profile journeys) reuses one visual language instead of each screen inventing its own. It also adds a small, temporary in app screen to check every component in both dark and light mode before any real screen depends on them.

## Requirements

**User stories**:
- As a mobile engineer building any later screen, I want a ready made set of shared components that already match the design exactly, so that I do not re implement poster cards, star ratings, chips, buttons, or score badges from scratch on every screen.
- As a user of the app, I want every screen to look and behave consistently (colors, spacing, motion) in both dark and light mode, so that the app feels like one coherent product.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: The color tokens already wired in `tailwind.config.js` and `constants/colors.cjs` match `design.md` §2.2 (dark) and §2.3 (light) exactly, token for token, and `global.css`'s CSS variables are confirmed to match `colors.cjs` exactly rather than assumed in sync. The type scale from `design.md` §3 (font family, size, and line height for `display-xl`, `display-lg`, `display-md`, `body-lg`, `body-md`, `body-sm`, `label`, `caption`) is added to `tailwind.config.js` as named theme extensions, since only colors are wired today.
- **AC-2**: Each of the five `design.md` §7 components, `PosterCard`, `StarRatingRow`, `Chip`, `ScoreBadge` (the "Predicted Score Badge"), and `PrimaryButton`, is built exactly to §7's dimensions, colors, radii, and states, and renders correctly in both dark and light mode.
- **AC-3**: `PosterCard` supports both a `grid` variant (two column grid width, per `design.md` §7's formula) and a `row` variant (fixed 80px, for horizontal scroll rows), and falls back to the `bg-secondary` background with a centered film placeholder icon whenever no image is supplied or the image fails to load.
- **AC-4**: `StarRatingRow` is one component that works both read only (no `onRate` given, for showing a past rating) and interactive (`onRate` given, for rating now), with the tap spring animation (`scale(1.3)`, 150ms) from `design.md` §9 active only in interactive mode.
- **AC-5**: `PrimaryButton` supports default, pressed (`accent-hover` background, `scale(0.98)`), disabled, and loading states.
- **AC-6**: A shared `Skeleton` component exists, built on `react-native-reanimated` driving an `expo-linear-gradient` sweep (both already installed, the gradient decided under spec 0001), reusable as a loading placeholder for card shaped layouts, matching `design.md` §9's left to right shimmer that loops every 1.5 seconds.
- **AC-7**: `PrimaryButton`, `Chip`, `PosterCard`'s press target, and `StarRatingRow` only when interactive (`onRate` given) carry a screen reader role, a label, and a tappable area of at least 44 by 44 points even where the visual size is smaller (padding or hit slop, never shrinking the visual design). `ScoreBadge`, `Skeleton`, and read only `StarRatingRow` are decorative: they expose a plain accessibility label or value where meaningful (for example read only `StarRatingRow` exposes one value like "Rated 4 out of 5 stars"), never a forced button role or tap target.
- **AC-8**: A gallery screen (`app/showcase.tsx`, active only in development, see Build plan) renders every component, in every variant and state listed above, in both dark and light mode, so AC-2 through AC-7 can be checked visually before any real screen consumes these components.
- **AC-9**: A working runtime mechanism exists for NativeWind to actually switch between the dark and light class, driven by NativeWind's own color scheme API (not React Native's raw `useColorScheme`, which NativeWind's class based dark mode does not read from). This is the underlying plumbing only, so AC-2 and AC-8 can be exercised at all; the persistent, user facing theme toggle is Profile and rating history's job (scope item 9), not built here.

## Options considered

See [`rationale.md`](rationale.md) for the full context and the options weighed (hand built components directly against `design.md`, a heavier atomic design layering, or adopting an existing React Native UI kit).

## Decision

**Chosen option**: hand build the five `design.md` §7 components (plus a shared `Skeleton`) directly in `mobile/components/`, one file per component, presentational and prop driven, with no new UI library.

## Rationale

See [`rationale.md`](rationale.md) for the full reasoning behind this choice over the alternatives.

## Feature design

**Data model sketch**:
Not applicable. These are pure presentational components with no persistence and no data of their own; every value they render comes in through props from whichever screen uses them. No migration, no new entity.

**State transitions** (per component, not a single shared state machine):
- `PrimaryButton`: `default` to `pressed` (on press, `accent-hover` background, `scale(0.98)`, springs back on release) to `default`; `default` to `disabled` and back (caller controlled, renders at 40% opacity, no press animation, `accessibilityState={{ disabled: true }}`); `default` to `loading` and back (caller controlled, an `ActivityIndicator` (small, white) replaces the label, implies `disabled`, `accessibilityState={{ busy: true }}`).
- `StarRatingRow`: no intermediate "pending" state, each tap immediately fires `onRate` with the new value, matching `design.md` §6.3's "rated immediately" behavior. `readOnly` (no `onRate` prop) versus `interactive` (`onRate` prop present) is fixed for the component's lifetime, not toggled at runtime. Only the tapped star plays the spring animation, not the whole row.
- `Chip`: `inactive` (`bg-secondary` background, 1px `text-secondary` border, `text-secondary` label) to `active` (`accent-primary` background, no border, white label) on tap; the component is controlled, the caller owns which chip is active, `Chip` only renders the state it is given and fires `onPress`.
- `PosterCard`: two independent signals, not one. The caller's `loading` prop (true while the caller has no `posterUrl` yet, data still in flight) forces the `Skeleton` regardless of image state. Once a `posterUrl` exists, the component's own `<Image onLoad / onError>` moves it from `loaded` (image shown) to `placeholder` (the `bg-secondary` background with a centered `film-outline` Ionicons icon, size 32, `text-disabled`) on any load failure, independent of the caller's `loading` prop.
- `ScoreBadge`: renders the gold pill (`"★ {score.toFixed(1)}"`, exactly `design.md` §7's text, no extra words) when given a `score`; renders nothing (`null`) when `score` is undefined, rather than showing an empty or zero badge. Any additional wording around it (for example the Home hero's "match" label) is text the calling screen composes next to the badge, not part of the component.

**Component surface** (these are UI components, not network endpoints; props in, rendered output out):
| Component | Key props | Renders | Notes |
|---|---|---|---|
| `PrimaryButton` | `label: string`, `onPress: () => void`, `disabled?: boolean`, `loading?: boolean` | A filled `accent-primary` button, 48px tall, 8px radius | Loading shows a small white `ActivityIndicator` in place of the label and implies `disabled`; disabled renders at 40% opacity with no press animation |
| `Chip` | `label: string`, `active: boolean`, `onPress: () => void` | A 28px tall pill, `bg-secondary` with a 1px `text-secondary` border (inactive) or `accent-primary` with no border (active) | Purely presentational; no bottom sheet or filter logic (see Follow up in rationale) |
| `ScoreBadge` | `score?: number` | A gold pill reading exactly `"★ {score.toFixed(1)}"` per `design.md` §7, or nothing if `score` is undefined | Never renders "match" or any other word itself; a caller that wants that wording (e.g. the Home hero) composes it as separate text next to the badge. See Value sourcing below for the open question on what scale `score` is in. |
| `StarRatingRow` | `rating: number` (0 to 5), `onRate?: (value: number) => void`, `size?: "sm" \| "md"` | 5 stars, gold filled up to `rating`, `text-disabled` outline beyond it | `sm` = 16px icons, `md` = 24px icons, 4px gap between stars. Presence of `onRate` is what makes it interactive. |
| `PosterCard` | `posterUrl?: string`, `title: string`, `variant: "grid" \| "row"`, `onPress?: () => void`, `loading?: boolean` | A 2:3 poster image or placeholder, 8px radius, press scales to `0.97` | `title` is never rendered as visible text (design.md keeps the title outside the card, drawn by the screen); it is used only for the accessibility label. `variant` picks the width formula from `design.md` §7, `grid`'s width computed from `useWindowDimensions()`. `ScoreBadge` is never rendered inside `PosterCard`; a screen that wants both composes them side by side, per its own layout. |
| `Skeleton` | `width: number \| string`, `height: number \| string`, `borderRadius?: number` (defaults to 8) | An animated shimmer block, a `Reanimated`-driven `expo-linear-gradient` sweep across `bg-secondary` to `bg-tertiary` and back | Used inside `PosterCard` and by any screen that needs a loading placeholder; `width`/`height` are required, there is no default size |

**Value sourcing** (every value each component renders names where it comes from; a value with no named source is an undecided input, not left for later screens to invent):
| Component / prop | Value rendered | Source |
|---|---|---|
| `PosterCard.posterUrl` | The poster image | Caller passes it; ultimately the movie's poster path from the backend's movie search, resolve, or recommend response. Wiring that is each Journey screen's job, not this spec's. |
| `PosterCard.title` | The accessibility label text (not visible text; see Component surface) | Caller passes it; ultimately the movie's title from the same response as `posterUrl`. |
| `ScoreBadge.score` | The number shown in the gold pill | Caller passes it. **Open gap, not resolved here**: `design.md` shows `"★ 4.2"`, an out of five style number, but the backend's real field (`predicted_score` in `backend/main.py`) is a cosine similarity roughly between 0 and 1, rounded to two decimals. `ScoreBadge` itself just renders whatever number it is given, formatted to one decimal; the scaling or mapping rule from `predicted_score` to a displayed match number is not decided in this spec. Flagged in Follow up for the journey that first wires real scores in. |
| `StarRatingRow.rating` / `onRate` | The star count shown, and the new rating on tap | Caller passes both; ultimately a rating read from or written to the backend's `/ratings` and `/me/ratings` endpoints, wired by the journey that uses this component (Discover and decide, Profile and rating history). |
| `Chip.active` / `onPress` | Which chip is highlighted, and the tap handler | Caller owns and passes both; the actual selected filter state (language, actor, year range) is owned by whichever screen uses `Chip`, most notably Search and browse (#7), not by this component. |
| `PrimaryButton.label` / `onPress` / `disabled` / `loading` | The button's text, tap behavior, and enabled/loading state | All caller supplied; every screen that renders a `PrimaryButton` decides these for its own flow (sign up, log in, "Done", "Find Movies", and so on). |

**Key invariants**:
- A component never fetches its own data or reads global state directly; everything comes in through props. This keeps all five components reusable across every screen without hidden coupling.
- `ScoreBadge` never renders an empty or zero looking pill; it renders nothing when it has no score to show.
- `StarRatingRow`'s interactivity is fully determined by whether `onRate` is passed, never by a separate `readOnly` flag that could disagree with it.
- Every visual value (color, spacing, radius, font size) traces to a named token in `design.md` §2 to §4 or a literal value from §7; no invented "close enough" value.
- `PosterCard` never renders `title` as visible text; only the screen that places a card next to its title does, per `design.md`'s own layouts (§6.4, §6.8).
- Only genuinely interactive elements (`PrimaryButton`, `Chip`, `PosterCard`'s press target, interactive `StarRatingRow`) get a button role and an enforced 44 by 44 point tap target; decorative pieces (`ScoreBadge`, `Skeleton`, read only `StarRatingRow`) never get a forced interactive role, per AC-7.
- Theme switching is read from NativeWind's own color scheme state, never from React Native's raw `useColorScheme` for anything styled with `className` (that hook stays reserved for the few raw color reads `useTheme.ts` already documents, gradients and the status bar).

**Security model**:
Not applicable. These are presentational components with no authentication or authorization surface and no direct data access; any auth gated data a screen shows through them (a rating, a score) is the screen's responsibility, not the component's.

**Critical test scenarios** (each maps to an acceptance criterion above):
- Happy path: the gallery screen renders all five components, every variant and state, correctly in both dark and light mode, verifies **AC-2**, **AC-8**.
- Failure case: `PosterCard` given a `posterUrl` that fails to load falls back to the film icon placeholder instead of a broken image or blank space, verifies **AC-3**.
- Theme switch: toggling NativeWind's color scheme actually changes which token set every component reads, with no component left showing stale colors from the previous theme, verifies **AC-9**.
- Auth/permission: not applicable, no authentication or authorization surface in this feature (see Security model above).

## Build plan

This is a Foundation item, not one of the app's user journeys, so instead of the project's Journey build approach (each full user journey built end to end before the next), it is sliced component by component, simplest and most reused first, after first fixing the two pieces of missing plumbing (a working theme switch, and the typography tokens) that every component and the gallery screen depend on to even be checkable.

1. Wire a real runtime theme switch: use NativeWind's own color scheme API (not React Native's raw `useColorScheme`) in the root layout to toggle the `.dark` class NativeWind reads, confirming `global.css`'s selector actually matches what NativeWind v4 toggles (adjust from `.dark` to `.dark:root` if that is what native CSS variable resolution needs), satisfies **AC-9**
2. Confirm `tailwind.config.js` and `constants/colors.cjs` already match `design.md` §2.2/§2.3 exactly (expected to already hold from the mobile stack scaffold; fix only if a token has drifted), add an automated check (e.g. a small script or test) so `colors.cjs`, `global.css`, and `design.md`'s tables cannot silently drift apart, and extend `tailwind.config.js` with the §3 type scale (`fontFamily`/`fontSize`/`lineHeight` per token, reusing the font faces already loaded in `_layout.tsx`), satisfies **AC-1**
3. Build `PrimaryButton` (`components/PrimaryButton.tsx`): default, pressed, disabled, and loading states, with accessibility props, satisfies **AC-2**, **AC-5**, **AC-7**
4. Build `Chip` (`components/Chip.tsx`): inactive and active states, with accessibility props, satisfies **AC-2**, **AC-7**
5. Build `ScoreBadge` (`components/ScoreBadge.tsx`): renders the gold pill or nothing, satisfies **AC-2**, **AC-7**
6. Build `StarRatingRow` (`components/StarRatingRow.tsx`): read only and interactive modes from one component, Reanimated tap spring, accessibility props, satisfies **AC-2**, **AC-4**, **AC-7**
7. Build `Skeleton` (`components/Skeleton.tsx`): a Reanimated driven `expo-linear-gradient` shimmer loop, satisfies **AC-6**
8. Build `PosterCard` (`components/PosterCard.tsx`): `grid`/`row` variants, film icon placeholder and image error fallback, uses `Skeleton` while loading, accessibility props, satisfies **AC-2**, **AC-3**, **AC-7**
9. Build the gallery screen (`app/showcase.tsx`, a normal route that renders nothing and redirects away when `__DEV__` is false, so it stays reachable in development without depending on Expo Router's underscore-prefix exclusion): every component, variant, and state above, rendered in both themes (using the AC-9 switch to toggle live), satisfies **AC-8**
10. Walk the gallery screen against `design.md` §7's exact values (colors, sizes, radii, states) in both dark and light mode, fixing any component that does not match, satisfies **AC-2** through **AC-9**

## Consequences

**Positive**:
- Every screen built from here on (Journeys 1 through 6) reuses one visual language and one set of components, instead of each screen hand rolling its own card, button, or rating row.
- Accessibility support and the loading shimmer are built into the components now, not retrofitted screen by screen later.
- No new dependency: everything is built on libraries already in the stack (NativeWind, Reanimated, `expo-linear-gradient`, vector icons).
- Dark mode goes from tokens that exist but are never applied to an app that actually switches themes at runtime (AC-9); this spec is what first makes that real, not just something later screens assume works.

**Negative / tradeoffs**:
- The gallery screen (`app/showcase.tsx`) is extra code that must be remembered and either excluded from release builds or deleted once it has served its purpose; see Follow up.
- Building accessibility support into each component now costs a little more time up front than skipping it and adding it later.
- `PosterCard`'s `variant` prop means a screen cannot ask for an arbitrary width outside `grid` or `row` without bypassing the component; acceptable because `design.md` only ever specifies those two widths.
- `Chip` stays purely presentational, so Search and browse (#7) still has to build its own selected filter state and bottom sheet logic on top of it, this spec does not remove that later work, only narrows what it has to build.
- This spec's scope grew slightly beyond "just build five components" to include wiring the theme switch itself (AC-9) and the missing typography tokens (AC-1); both were discovered missing during this spec's own review, and without them AC-2/AC-8 could not be verified at all.

**Neutral**:
- `ScoreBadge`'s scale mismatch (see Value sourcing) is deferred, not resolved, so Discover and decide (#6) inherits an open formatting decision when it wires real scores in.

## Follow-up

- [ ] Confirm the gallery screen's `__DEV__` guard (`app/showcase.tsx`) actually keeps it out of release builds, or delete it once it has served its purpose; recheck during Coding standards and tooling (#2) or before any store submission (already deferred per the scope's Deferred list).
- [ ] Decide how the backend's raw `predicted_score` (a roughly 0 to 1 cosine similarity, `backend/main.py`) maps to `ScoreBadge`'s displayed number (`design.md` shows `"★ 4.2"`, an out of five style number). Owned by whichever journey first wires a real score into `ScoreBadge`, most likely Discover and decide (#6).
