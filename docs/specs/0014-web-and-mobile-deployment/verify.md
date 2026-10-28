# Verify: Web and mobile deployment · spec 0014 · updated 2026-10-14
_Steps derived from spec 0014's "Rules the pipeline must hold" (R1 to R9, this decision spec has no AC ids) and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones. Most steps need the manual prerequisites done first._

## UI / manual
- [ ] Open a pull request that touches `mobile/**` → the Web deploy run shows `checks` passing before `deploy` starts, and a comment appears with a `pr-<number>` preview address → R1, previews
- [ ] Open the preview address, view source → a `robots` meta with `noindex, nofollow` is present, and there is no canonical link → R5
- [ ] Push a commit to the same pull request → the same comment is updated, not duplicated → previews
- [ ] Open a pull request from a fork → the Web deploy `checks` and `deploy` jobs are skipped → security model
- [ ] Merge to `main` → the live address serves the new build, view source shows no `robots` tag, a `canonical` link and `og:url` with the real address → R5, `EXPO_PUBLIC_SITE_URL` row
- [ ] Open `<live address>/movie/movie/123` directly in a new tab → the movie page loads, not the landing page → R6
- [ ] Open `<live address>/no-such-page` → a real 404 page (check status in dev tools), not the landing page → R6
- [ ] Open `<live address>/` → the landing page still loads as exported static HTML → R6, follow up
- [ ] Break a test on a branch and merge it to `main` (or run the workflow on it) → no deploy happens → R1
- [ ] Start two runs close together on `main` → they run one after the other, and the first is not cancelled → R4
- [ ] Push tag `v1.0.1` while `app.config.ts` says `1.0.0` → Mobile release fails at "Check the tag matches the app version", before any EAS build → R2
- [ ] Push a `v1.0.0` tag on a commit that is not on `main` → fails at "Check the tagged commit is on main" → R2
- [ ] Push a matching `v1.0.0` tag on `main` (after enrollments and `eas credentials`) → two builds appear on the EAS dashboard and reach TestFlight and Google Play internal testing → R3, Mobile builds row, iOS and Android submit rows
- [ ] Check the new build's number in the store → it follows the EAS remote counter, and no workflow step sets one → R3
- [ ] Run Mobile update with an older tag, a missing tag, and `abc` → each fails in "Check the tag is the latest release" → update workflow
- [ ] Run Mobile update with the latest tag → checks run on that tag, then the update appears on the `production` channel in EAS → R1, R7
- [ ] On a phone with the matching production build, force close and reopen the app twice → the update is applied and the app can reach the API (no "EXPO_PUBLIC_API_BASE_URL is not set" crash) → `EXPO_PUBLIC_*` bundled into the update row
- [ ] Bump `version` without a new build, publish an update → the old installed build does not receive it → R7
- [ ] In GitHub settings, try to push a `v*` tag as a non maintainer → rejected by the tag ruleset → R9

## Commands
- [ ] `cd mobile && npm run typecheck && npm run lint && npm test -- --ci` → all pass (includes `lib/siteConfig.test.ts`) → R8
- [ ] `cd mobile && EXPO_PUBLIC_API_BASE_URL=https://x.test EXPO_PUBLIC_NOINDEX=1 npm run build:web` → exits 0, `dist/404.html`, `dist/_redirects`, and `robots` noindex in `dist/index.html` → R5, R6
- [ ] `cd mobile && EXPO_PUBLIC_API_BASE_URL=https://x.test EXPO_PUBLIC_SITE_URL=http://bad npm run build:web` → fails with an `EXPO_PUBLIC_SITE_URL` error → R8
- [ ] `cd mobile && EXPO_PUBLIC_API_BASE_URL=https://x.test EXPO_PUBLIC_NOINDEX=yes npm run build:web` → fails with an `EXPO_PUBLIC_NOINDEX` error → R8
- [ ] `cd mobile && npx expo config --json --type public | jq -r .version` → prints `1.0.0` (matches `app.config.ts`) → R2, tag check row
- [ ] `cd mobile && npx expo config --json --type public | jq '.runtimeVersion, .updates, .extra.eas'` → runtime policy `appVersion`, plus the update url and project id after `eas init` → R7, EAS Update row
- [ ] `cd mobile && npx wrangler deploy --dry-run` → succeeds with name `nextwatch-web`, assets directory `./dist` → web deploy row
- [ ] `grep -E '"(channel|environment)"' mobile/eas.json` → development and preview carry `preview`, production carries `production` → R7
- [ ] `grep -n "serviceAccountKeyPath" mobile/eas.json` → no match, and `ascAppId` is a real id, not the placeholder → Android and iOS submit rows
- [ ] `grep -n "cancel-in-progress" .github/workflows/*.yml` → every release workflow has `false`, each has a `concurrency` group → R4
- [ ] `grep -n "workflow_call" .github/workflows/mobile-ci.yml` → present, and the push and pull request triggers are unchanged → R1

## Acceptance-criteria coverage
- R1 covered by the pull request preview, broken test, and `workflow_call` steps · R2 by the tag mismatch, off `main`, and `expo config` steps · R3 by the build number step · R4 by the concurrency steps · R5 by the preview and live view source steps and the NOINDEX build command · R6 by the deep link, 404 and `/` steps · R7 by the version bump step, `eas.json` and `expo config` commands · R8 by the two bad value build commands and the unit tests · R9 by the non maintainer tag step
- Value sourcing: web build vars (live view source, build commands) · Cloudflare secrets (deploy runs) · `EXPO_TOKEN` (release and update runs) · EAS environment variables and Sentry (phone update step, source maps in Sentry) · tag input (update steps) · site address (live view source) · `ascAppId` and Android service account (`eas.json` commands, first tag run)
