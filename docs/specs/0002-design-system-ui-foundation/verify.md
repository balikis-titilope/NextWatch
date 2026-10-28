# Verify: design system & UI foundation · spec 0002 · updated 2026-08-08
_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Run the app (`npx expo start --web`, or iOS/Android), visit `/showcase` → gallery renders every component (`PrimaryButton`, `Chip`, `ScoreBadge`, `StarRatingRow`, `Skeleton`, `PosterCard`) in every listed variant/state → AC-2, AC-8
- [ ] On `/showcase`, tap the theme toggle button → every component's colors switch immediately between the dark and light palettes, nothing left showing a stale color → AC-9
- [ ] Compare each rendered component's colors, radii, sizes, and states against `design.md` §7 line by line in both themes → AC-2
- [ ] `PosterCard` grid variant with a valid `posterUrl` shows the image; the one given `posterUrl="https://example.invalid/missing.jpg"` falls back to the `bg-secondary` + `film-outline` placeholder, not a broken image icon or blank space → AC-3
- [ ] `PosterCard` with `loading` shows the `Skeleton` shimmer regardless of whether `posterUrl` is set → AC-3 (Value sourcing: `loading` prop forces skeleton independent of image state)
- [ ] `StarRatingRow` read only (no `onRate`) shows no press animation on tap and exposes one accessibility value like "Rated 4 out of 5 stars"; interactive (`onRate` given) shows the tapped star spring to scale 1.3 and back, and immediately fires the new rating → AC-4
- [ ] `PrimaryButton`: default renders filled `accent-primary`; press-and-hold shows `accent-hover` + scale 0.98 springing back on release; `disabled` renders at 40% opacity with no press animation; `loading` shows a small white `ActivityIndicator` in place of the label → AC-5
- [ ] `Skeleton` shimmer visibly sweeps left to right and loops continuously, roughly every 1.5s → AC-6
- [ ] With a screen reader (VoiceOver/TalkBack) or the accessibility inspector: `PrimaryButton`, `Chip`, an interactive `PosterCard`, and interactive `StarRatingRow` (both `sm` and `md`) each expose a button role, a label, and at least a 44×44pt tap target (padding/hit slop); `ScoreBadge`, `Skeleton`, and read only `StarRatingRow` expose no forced interactive role → AC-7
- [ ] `ScoreBadge` with no `score` prop renders nothing (not an empty/zero pill) → AC-2 (Value sourcing: caller supplies `score`; component never invents one)

## Commands
- [ ] `npx tsc --noEmit` → passes clean → AC-1, AC-2 through AC-9 (typed props/state)
- [ ] `npx jest __tests__/colorTokens.test.ts` → passes, proving `global.css` CSS variables match `constants/colors.cjs` exactly in both palettes → AC-1
- [ ] Manually diff `tailwind.config.js`'s `colors`/`fontFamily`/`fontSize` extensions against `design.md` §2.2, §2.3, and §3 → AC-1

## Acceptance-criteria coverage
- AC-1 (tokens + type scale match `design.md`, confirmed not assumed) · covered by the `colorTokens.test.ts` run + the manual tailwind config diff
- AC-2 (all 5 components match §7 exactly, both themes) · covered by the gallery walk-through
- AC-3 (`PosterCard` grid/row variants + placeholder fallback) · covered by the broken-image and loading gallery steps
- AC-4 (`StarRatingRow` read only vs interactive, tap spring only when interactive) · covered by its dedicated step
- AC-5 (`PrimaryButton` default/pressed/disabled/loading) · covered by its dedicated step
- AC-6 (`Skeleton` shimmer, 1.5s loop) · covered by its dedicated step
- AC-7 (accessibility roles, labels, 44×44 targets on interactive elements only) · covered by the screen reader step
- AC-8 (gallery screen renders everything, both themes) · covered by the first UI step
- AC-9 (NativeWind-driven runtime theme switch, not RN's raw `useColorScheme`) · covered by the theme-toggle step; also see `hooks/useTheme.test.ts`, which mocks NativeWind's `useColorScheme` specifically to lock this in

## Known open gap (not in scope here)
- `ScoreBadge.score`'s mapping from the backend's raw `predicted_score` (~0–1 cosine similarity) to the displayed out-of-five style number is unresolved (spec 0002 Follow-up). Not verifiable here since no real score is wired yet; owned by whichever journey first wires a real score in (most likely "Discover & decide").
