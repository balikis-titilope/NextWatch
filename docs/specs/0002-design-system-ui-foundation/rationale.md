# 0002. Design system and UI foundation, rationale

## Context

`mobile/context/design.md` already fully specifies NextWatch's visual system: color tokens for dark and light mode (§2.2/§2.3), a two font type scale (§3), spacing and radius rules (§4), and, in §7, the exact structure of the five components every screen shares, `PosterCard`, `Star Rating Row`, `Genre/Language Chip`, `Predicted Score Badge`, and `Primary Button`. The color tokens are already wired into `tailwind.config.js` and `constants/colors.cjs` from the mobile stack scaffold (spec 0001), but `mobile/components/` holds nothing but a placeholder file. Every later screen in the scope, Account and getting started, Discover and decide, Search and browse, Mood discovery, and Profile and rating history, depends on these five components existing and matching the design exactly; building them once, correctly, is what unblocks all of that work.

The forces at play are less "which technology" and more "how much do we build, and how do we prove it is right before anything depends on it". `design.md` is unusually complete for a five component set, exact pixel values, exact color tokens, exact motion specs, so there is little genuine ambiguity in what to build. The real decision is how to build it (hand rolled against the spec, versus a heavier internal system, versus an off the shelf kit) and how to check it, since none of these five components will be exercised by a real screen until the account journey (#5) starts, several steps away.

A review of this spec before acceptance found that `tailwind.config.js`'s `darkMode: "class"` strategy has nothing in the running app that ever applies the `.dark` class, `hooks/useTheme.ts` reads React Native's own `useColorScheme`, which NativeWind's class based strategy does not consult, so only the light palette has ever actually rendered. That makes "renders correctly in both dark and light mode" (this feature's whole done when line) unverifiable as originally scoped. Rather than defer that gap to Profile and rating history (#9, which owns the persisted, user facing toggle), this spec absorbs the underlying runtime switch (AC-9), since without it none of AC-2 or AC-8 can actually be checked.

## Options considered

### Option 1: Hand build the five components directly against `design.md`

Write `PrimaryButton`, `Chip`, `ScoreBadge`, `StarRatingRow`, and `PosterCard` as plain React Native components in `mobile/components/`, styled with NativeWind classes that already map to the wired tokens, animated with the already installed `react-native-reanimated`, one file per component, no new abstraction layer and no new library.

**Pros**:
- Nothing to install, evaluate, or theme; every piece needed (NativeWind, Reanimated, vector icons) is already in the stack per `mobile/AGENTS.md` §3.
- `design.md` §7 already gives exact values, so "hand build to spec" has almost no ambiguity left to resolve.
- Matches `AGENTS.md` §4's standing rule to ship the simplest version that satisfies the spec.

**Cons**:
- No built in tooling (no automatic accessibility audit, no visual regression harness) beyond what this spec adds by hand (the gallery screen, accessibility props).

### Option 2: An atomic design layering (atoms, molecules, organisms)

Introduce a formal layered structure, primitive "atom" components (a themed `Text`, `Pressable`, `Box`) that the five real components are built from, rather than writing each of the five directly against React Native primitives.

**Pros**:
- Can reduce duplication if the component count grows much larger later.
- A common pattern in larger design systems with dozens of components.

**Cons**:
- Five components do not need a formal layering system; the extra abstraction has to be learned and maintained for no real benefit yet, exactly the kind of premature structure `AGENTS.md` §4 warns against ("no abstraction for a second use case that doesn't exist yet").
- Slows down this spec's actual goal, unblocking the next journeys, for a benefit that only pays off at a scale this app is not at.

### Option 3: Adopt an existing React Native UI kit (for example Tamagui, React Native Paper, or gluestack-ui)

Install a component library and theme it to match `design.md`'s tokens, rather than writing the five components by hand.

**Pros**:
- Comes with more components than these five, useful if the design later grows well past what `design.md` specifies today.
- Some ready made accessibility behavior out of the box.

**Cons**:
- `design.md` specifies exact, unusual values (warm tinted `#1A1612` backgrounds, a specific gold pill score badge, particular spring animations) that a general purpose kit would need heavy overriding to match exactly, likely costing more time than hand building five components.
- A new dependency, which `mobile/AGENTS.md` §13 requires asking about before adding, and which the app would then carry (and keep updated) for the life of the project.
- None of these five components need what a kit chiefly buys, form primitives, complex overlays, data tables. A kit is the right call for a much larger surface than this.

## Rationale

Option 1 wins because the two things that would justify Option 2 or Option 3, real duplication pressure across many similar components, or a design so open ended it needs a general purpose kit's primitives, are both absent here. `design.md` §7 already resolves nearly every visual question; five files, one per component, following it directly is both the fastest path and the one with the least new surface to maintain, in keeping with `mobile/AGENTS.md` §4's standing rule to ship the simplest version and avoid abstraction for a use case that does not exist yet. Introducing an atomic layer (Option 2) or a themed kit (Option 3) would both cost real time (learning or theming overhead) against a design that is already fully specified, for a payoff, scaling to many more components, that this app is not at yet, and that `AGENTS.md` §13 would require asking about before taking on the new dependency Option 3 implies.

The one real open question this decision does carry, how to prove all five components are right before any journey screen uses them, is answered by AC-8 and Build plan task 8 (the temporary gallery screen), not by picking a heavier framework; a lightweight, deletable dev route is enough to check five presentational components against a design doc that already gives exact values.
