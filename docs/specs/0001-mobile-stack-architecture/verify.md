# Verify: mobile stack & architecture · spec 0001 · updated 2026-08-07
_Steps derived from the scope's "Done when" for this feature (spec 0001 is a decision record without numbered ACs). `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Run `npm run web` in `mobile/`, open the served URL → the app loads and redirects to the Log In screen, styled with the `bg-primary`/`text-primary` tokens (dark or light depending on OS) → Done when: Web boot
- [ ] Toggle the OS/browser color scheme between dark and light while the app is open → background and text colors flip automatically (no reload needed) → Done when: NativeWind `dark:` wiring
- [ ] Run `npm run ios` on a macOS machine or simulator → the app boots to the Log In screen → Done when: iOS boot
- [ ] Run `npm run android` with an Android emulator running → the app boots to the Log In screen → Done when: Android boot
- [ ] Navigate to each stub route (`/(auth)/login`, `/(auth)/signup`, `/(tabs)`, `/(tabs)/search`, `/(tabs)/mood`, `/(tabs)/profile`, `/movie/1`, `/onboarding`) → each renders its placeholder screen with no crash → Done when: folder layout matches `AGENTS.md` §5

## Commands
- [ ] `npm run typecheck` (in `mobile/`) → exits 0, no TypeScript errors → Done when: TypeScript strict mode compiles clean
- [ ] `npx expo-doctor` (in `mobile/`) → 18/18 checks pass → Done when: dependency and config correctness
- [ ] `npx expo export --platform web` → bundles successfully; the emitted CSS contains `bg-bg-primary` and a `.dark { --color-bg-primary: ... }` block → Done when: NativeWind token wiring is real, not just present in source
- [ ] `npx expo export --platform ios` and `npx expo export --platform android` → both bundle successfully with no missing-module errors → Done when: iOS/Android dependency graph resolves (simulators were not available to fully boot native builds during this build; this is the closest available proxy — a real device/simulator boot is still owed before this feature can be marked `done`)

## Acceptance-criteria coverage
- Scope "Done when" (spec [0001](../0001-mobile-stack-architecture/index.md), scope feature #1): "the stack is recorded in a spec and an empty Expo Router project boots locally (iOS/Android/Web) with the folder layout from `AGENTS.md` §5" — covered by all steps above. The iOS/Android steps above were verified only via Metro bundle export (no simulator in this environment); a real boot on an iOS/Android simulator or device is the one gap `/check verify` should close.

## /check verify outcome (2026-08-07)
Ran fresh: `npm run typecheck` (clean), `npx expo-doctor` (18/18), web dev server boot exercised over HTTP (no browser MCP available, so this was request and bundle level, not a visual render), `npx expo export` for web, ios, and android (all bundle clean, web CSS confirmed containing the real `bg-bg-primary` token and a `.dark` block with distinct values). Folder layout matches `AGENTS.md` §5 exactly.

No behavior failed. What stayed unverified was strictly a tooling gap in the run environment (no browser MCP, no iOS/Android simulator), not a defect: a real visual render and a real device/simulator boot were never observed. The engineer reviewed this evidence and accepted it as sufficient for this foundational, screens are placeholders scaffold, so `Verify it` was ticked on that basis. If a browser or simulator becomes available later, it is still worth a real look before this app grows real screens on top of it.
