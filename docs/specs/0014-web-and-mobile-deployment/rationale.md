# 0014. Web hosting and mobile release pipeline (decision record)

Decision history for spec 0014. The build spec is in [index.md](index.md).

## Context

> ⚠️ Premise note: There is one backend and one database, with no staging copy. Web previews and any test build therefore talk to real user data. This spec accepts that on purpose (see Consequences), because a staging backend is a separate decision and would delay a first release.

Workspace: repo wide, covering `mobile/` (Expo, one codebase for iOS, Android and web) and the CI files in `.github/workflows/`. Platform is a mix of static web and native mobile.

What exists today:
- The backend runs on FastAPI Cloud at `nextwatch.fastapicloud.dev`. No spec records that choice. Its CORS setting is a wildcard (bearer tokens, no cookies), so a new web address needs no backend change.
- `mobile/eas.json` has three build profiles, remote build numbers, and a production submit profile (spec 0009). Apple and Google developer accounts are not enrolled yet, and `eas credentials` has not been run.
- `mobile-ci.yml` runs lint, format check, typecheck and tests, but only on pushes and pull requests that touch `mobile/**`. Nothing builds or deploys.
- Spec 0011 builds the web app as static HTML, and left "where it is hosted" open. Its share preview and canonical links need a public web address.
- `web.output` is `static`. `lib/api.ts` throws at import if `EXPO_PUBLIC_API_BASE_URL` is missing, so the web build needs it set.

Without a decision, the first release would be run by hand from one laptop, the web app would have no address, and a store build could ship without the tests having passed.

## Options considered

### Option 1: Cloudflare Workers for web, GitHub Actions for everything, EAS for mobile builds

The web export is uploaded to Cloudflare Workers static assets by a GitHub Actions job. Mobile builds start from a tag in GitHub Actions and run on EAS servers. Updates go out through EAS Update.

**Pros**:
- One place (GitHub Actions) gates every release behind the existing tests.
- Cloudflare is the host it steers new static projects to, with per pull request previews and quick rollback to an earlier version.
- Each part can be swapped on its own (a different web host does not touch the mobile flow).

**Cons**:
- Three services to hold credentials for (GitHub, Cloudflare, Expo).
- More YAML to write and maintain than the all Expo option.

### Option 2: All Expo (EAS Hosting and EAS Workflows)

Web hosted on EAS Hosting, with builds and submits driven by EAS Workflows.

**Pros**:
- One vendor and one dashboard, and it fits the toolchain already in use.
- EAS Hosting accepts the static export.

**Cons**:
- Custom domains are paid plan only on EAS Hosting. Free plan request limits and commercial use terms could not be verified.
- A tag only trigger for EAS Workflows was not confirmed. Gating on the existing GitHub tests would need extra glue.

### Option 3: Cloudflare Pages from Git, manual EAS commands

Cloudflare builds the site itself on every push, and mobile releases are run by hand with the EAS CLI.

**Pros**:
- Least setup, almost no YAML.

**Cons**:
- Web deploys even when tests fail, and build settings live in a second place.
- Mobile releases are not repeatable and leave no record of what shipped or who shipped it.
- Cloudflare now says to start new projects on Workers, so Pages may age.

## Rationale

See the decision record sections below. In short: the repo already runs its tests in GitHub Actions, so putting every release behind those tests costs little and removes the biggest risk (shipping a broken build). Cloudflare is free for a static site, gives previews and rollback, and its own guidance points new projects to Workers rather than Pages. EAS stays the build service because it already holds the signing setup from spec 0009, and the free plan (15 iOS and 15 Android builds a month) is enough for a tag driven release rhythm. The engineer chose the recommended pick at every step.

(basis: your `AGENTS.md`, which already puts CI in GitHub Actions) · (basis: spec 0009, EAS profiles and remote credentials) · (basis: spec 0011, hosting left open) · (basis: Cloudflare Pages overview, "Start new projects with Workers")

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md`: CI on GitHub Actions, backend out of `/develop` scope
- Spec 0009: EAS profiles, remote credentials, store accounts not yet enrolled
- Spec 0011: static web build, hosting left open, API base URL required at export
- Spec 0006: scheduler needs a single always on backend instance
- `.github/workflows/mobile-ci.yml`, `.github/workflows/catalog-refresh.yml`, `mobile/eas.json`, `backend/main.py` (CORS)
- Installed skill `wrangler` (Workers Previews, Wrangler version, public preview URLs)

**Practices & standards**:
- Gate every deploy on the same tests that run on a pull request
- Fix forward for store releases, roll back for web
- Keep credentials in the CI secret store, never in the repo
- Pin the deploy tool version

**Links** (web verified only):
- Cloudflare Pages limits (500 builds a month, 20,000 files, 25 MiB per asset): https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Pages overview, advises new projects to start on Workers: https://developers.cloudflare.com/pages/
- Cloudflare `_redirects` rules: https://developers.cloudflare.com/pages/configuration/redirects/
- EAS Hosting introduction (static export supported, custom domains paid): https://docs.expo.dev/eas/hosting/introduction/
- EAS Workflows introduction: https://docs.expo.dev/eas/workflows/introduction/
- expo-github-action: https://github.com/expo/expo-github-action
- EAS Update runtime versions (native changes need a new build): https://docs.expo.dev/eas-update/runtime-versions/
- EAS plans and limits (free build and update numbers came from the pricing page snippet and were not fully verified): https://expo.dev/pricing.md
- EAS Update free plan, 1,000 users: https://expo.dev/changelog/2023-08-01-eas-free-plan-limits
