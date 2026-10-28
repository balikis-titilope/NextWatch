# 0014. Web hosting and mobile release pipeline

**Date**: 2026-10-14
**Status**: In Progress

## Summary

The web app will be hosted as static files on Cloudflare Workers, deployed by GitHub Actions only after the existing checks pass. Every pull request gets its own preview address. The iOS and Android apps are built by EAS (Expo's build service) when you push a version tag, and go to the test tracks of both stores on their own. Small JavaScript fixes can reach phones without a store release through EAS Update, started by hand. The backend stays on FastAPI Cloud, unchanged.

## Requirements

This is a decision spec, so it carries no acceptance criteria or build plan. The `/develop` run for deployment derives its tasks from `## Proposed stack` and `## Pipeline definition`, and its checks come from the **Rules the pipeline must hold** list below.

## Decision

**Chosen option**: Option 1: Cloudflare Workers for web, GitHub Actions for everything, EAS for mobile builds.

Host the static web build on Cloudflare Workers static assets, deploy it and run mobile releases from GitHub Actions behind the existing checks, build and submit apps on EAS from a version tag, and ship JavaScript only fixes through a manually started EAS Update.

**Implementation skills**: `wrangler` (`cloudflare/skills`, `.agents/skills/wrangler/`) · `eas-app-stores` (`expo/skills`, `mobile/.agents/skills/eas-app-stores/`) · `eas-update` (`expo/skills`, `mobile/.agents/skills/eas-update/`) · `github-actions-templates` (`wshobson/agents`, `.agents/skills/github-actions-templates/`)

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Backend hosting | FastAPI Cloud, unchanged | Already live and targeted by `pyproject.toml`. Not re decided here. The in process scheduler limit from spec 0006 still holds (one instance only). |
| Web hosting | Cloudflare Workers static assets, Worker name `nextwatch-web` | Free static hosting, previews, version history for rollback, single page fallback set in config. |
| Web address | The free `workers.dev` address for now | Ships with no purchase. A custom domain later is a config change plus a redirect. |
| Web deploy | GitHub Actions with `wrangler`, after checks pass | Reuses the existing gates, so a failing test blocks a deploy. |
| Web previews | One per pull request (Workers Previews), calling the production API | The engineer chose previews. There is no staging backend to point at. |
| Mobile builds | EAS Build, production profile, started from a `vX.Y.Z` tag in GitHub Actions | Repeatable, recorded, and gated. Signing already lives on EAS. |
| Store submit | EAS Submit, automatic to TestFlight and Google Play internal testing only | Reaching public review stays a manual click, where store forms need a human anyway. |
| Over the air updates | EAS Update, runtime match on app version, channel `production`, started by hand | Fixes in minutes without store review, with no accidental pushes. Free plan covers 1,000 monthly active users. |
| Observability | Existing Sentry and PostHog (spec 0003) | Release failures show up in GitHub Actions run history and email. No new tool. |

## Pipeline definition

**Workflows** (all in `.github/workflows/`):

| File | Starts on | Does |
|---|---|---|
| `mobile-ci.yml` (changed) | push and pull request touching `mobile/**`, and as a reusable call from the two files below | lint, format check, typecheck, tests (unchanged steps) |
| `web-deploy.yml` (new) | push to `main` and pull request, both limited by `paths: [mobile/**, .github/workflows/web-deploy.yml]`. Skipped for pull requests from forks. | runs `mobile-ci.yml` (a second run on pushes to `main` is accepted), then `expo export --platform web`, then `wrangler`. On `main`: `wrangler deploy`. On a pull request: `wrangler versions upload --preview-alias pr-<number>`, then posts the preview URL as a pull request comment. |
| `mobile-release.yml` (new) | push of a tag matching `v*.*.*` | runs the checks, runs the tag checks (rules 2 and 3 below), then `eas build --platform all --profile production --non-interactive --auto-submit --no-wait`. Concurrency group is keyed on `github.ref`, so every tag gets its own group and none is dropped. |
| `mobile-update.yml` (new) | manual start (`workflow_dispatch`) with a required `tag` input | checks out that tag, fails unless it is the latest released `vX.Y.Z`, runs the checks, then `eas update --channel production --environment production --non-interactive`, then uploads Sentry source maps for the update (`SENTRY_AUTH_TOKEN` as a GitHub secret) |

CLI versions: `expo/expo-github-action@v8` installs EAS CLI with a pinned `eas-version`. `wrangler` is an exact version in `mobile/package.json` devDependencies, 4.135.0 or later.

**Rules the pipeline must hold** (each is a check for `/check verify`):
1. A deploy, release or update never starts unless lint, format, typecheck and tests passed on that exact commit.
2. The tag `vX.Y.Z` is accepted only if `X.Y.Z` equals `version` in `mobile/app.config.ts`, and the tagged commit is on `main`. Otherwise the run fails before any build starts. The version is read with `npx expo config --json --type public | jq -r .version` (the config is TypeScript, so it is never parsed as text). The checkout uses `fetch-depth: 0`, and the main check is `git merge-base --is-ancestor $GITHUB_SHA origin/main`.
3. Build numbers and version codes stay with EAS remote counters (spec 0009). CI never sets them.
4. Only one run per workflow at a time (a `concurrency` group each), and a running production deploy or build is never cancelled by a newer push.
5. Preview builds set `EXPO_PUBLIC_NOINDEX=1`, which makes the web layout emit a `noindex` robots tag. Production sets `EXPO_PUBLIC_SITE_URL` so canonical and `og:url` links use the real address (closes spec 0011's open follow up).
6. A deep link such as `/movie/movie/123` loads the app on web. `mobile/public/_redirects` rewrites `/movie/:type/:id` to the exported `/movie/[type]/[id]` page with status 200, and the Worker config sets `not_found_handling` to `404-page`, so unknown paths return a real 404 and the landing page is never served for a deep link.
7. EAS Update uses runtime policy `appVersion`. A native change means bumping `version` and cutting a new tag. `eas.json` build profiles carry a `channel` and an `environment`: `development` and `preview` use the `preview` pair, `production` uses `production` for both.
8. `EXPO_PUBLIC_SITE_URL` and `EXPO_PUBLIC_NOINDEX` are read in two places: `app/+html.tsx` (robots tag, canonical and `og:url`) and `app/index.web.tsx`. Both are added to the app's startup env validation.
9. Only maintainers can create `v*` tags. A GitHub tag ruleset enforces it.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Web build | API base URL, Sentry DSN, PostHog key and host, site URL | GitHub repository variables (these values end up in the public bundle anyway, so they are not secrets) |
| Web deploy | Cloudflare token and account | GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Web deploy | Worker name, asset folder, fallback mode | `mobile/wrangler.jsonc`: name `nextwatch-web`, assets directory `./dist`, single page fallback |
| Tag build and update | Expo credentials | GitHub secret `EXPO_TOKEN` |
| EAS builds | the `EXPO_PUBLIC_*` values for mobile | EAS environment variables for the `production` environment (the build runs on EAS servers, not in GitHub) |
| EAS builds | Sentry source map upload token, org, project | EAS environment variables for `production`: `SENTRY_AUTH_TOKEN` with secret visibility, `SENTRY_ORG` and `SENTRY_PROJECT` plain (EAS "secrets" are the older, deprecated feature) |
| Tag check | the app version | `version` field of `mobile/app.config.ts`, read with `npx expo config` (rule 2) |
| EAS Update | EAS project id, owner, update url, runtime policy | hardcoded once in `mobile/app.config.ts` (`extra.eas.projectId`, `owner`, `updates.url`, `runtimeVersion: { policy: "appVersion" }`) after running `eas init` once. `eas update:configure` cannot edit a TypeScript config. |
| EAS Update | the `EXPO_PUBLIC_*` values bundled into the update | EAS `production` environment, via `--environment production`. The update is bundled in GitHub, so without this flag the bundle would ship without the API URL and `lib/api.ts` would throw on every phone. |
| Manual update | which commit is published | the required `tag` input (see the workflow table) |
| Production web address | `EXPO_PUBLIC_SITE_URL` | `https://nextwatch-web.<account subdomain>.workers.dev`, recorded once the Cloudflare account exists |
| iOS submit | App Store Connect app id | `submit.production.ios.ascAppId` in `mobile/eas.json`, from the app record created in App Store Connect first |
| Android submit | service account | the file path key `serviceAccountKeyPath` is removed from `eas.json`. `track: internal` stays, and EAS uses the service account uploaded with `eas credentials`. |
| Android submit | the Play service account | stored remotely with `eas credentials`, never in the repo (spec 0009) |
| iOS submit | the App Store Connect API key | same, through `eas credentials` |

**Rollback**:
- Web: redeploy the previous Worker version with `wrangler` (version history is kept). No data is touched.
- Over the air update: publish the previous good commit again to the `production` channel (or use the EAS rollback command).
- Native build: a store release cannot be pulled back by us. Fix forward with a new tag. If it is JavaScript only, a manual update is faster.

**Failure handling**:
- A failed workflow emails whoever pushed the tag or commit (GitHub default). No extra alerting now.
- EAS free builds are low priority, and a queue of over 90 minutes at peak was reported. The release workflow uses `--no-wait`, so it does not hold a GitHub runner while a build queues. A build or submit failure is reported by Expo's own failure email and on the EAS dashboard, and the workflow run only proves the build was accepted.
- A failed web deploy leaves the previous version live, because Workers switches over only after a successful upload.

**Security model**:
- Preview addresses are public to anyone who has the link, and they use the production API with real accounts. Protect them with Cloudflare Access only if that becomes a concern.
- All tokens live in GitHub secrets or EAS secrets, with an account scoped Cloudflare token holding only the Workers Scripts edit permission, used by `web-deploy.yml` alone (Cloudflare tokens cannot be limited to one Worker). Fork pull requests get no secrets, so the preview job must be skipped for pull requests from forks.
- No compliance scope is triggered by this decision. Spec 0009 owns store privacy declarations.

**Configuration required**:
- GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`
- GitHub variables: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_API_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`, `EXPO_PUBLIC_SITE_URL`
- New app setting: `EXPO_PUBLIC_NOINDEX` (set to `1` only for previews)
- New and changed files: `mobile/wrangler.jsonc`, `mobile/public/_redirects`, the three workflow files, `channel` and `environment` fields in `mobile/eas.json`, `ascAppId` added and `serviceAccountKeyPath` removed in `eas.json`, and the EAS and `expo-updates` fields in `mobile/app.config.ts`
- New libraries: `expo-updates` and `wrangler`. The engineer approved both by accepting this spec, as `mobile/AGENTS.md` §13 requires, and both are added to `mobile/AGENTS.md` §3. `wrangler` is pinned to an exact version, 4.135.0 or later, the version Workers Previews needs (basis: the installed `wrangler` skill).
- Manual prerequisites (not code): a Cloudflare account, Apple Developer Program and Google Play Console enrollment, the App Store Connect app record, `eas init` and `eas credentials` run once on a machine for both platforms, `eas env:create` for the production `EXPO_PUBLIC_*` and Sentry values, a GitHub tag ruleset for `v*`, and the first Play upload done by hand (Google requires it before the API can submit)

## Consequences

**Positive**:
- A release is a deliberate tag or merge, repeatable, recorded, and blocked by failing tests.
- The web app gets a public address, which unblocks the share preview, canonical links and the landing page's SEO (spec 0011).
- Hosting cost is zero at current scale.
- A bad web deploy is a one command rollback. A bad JavaScript fix is replaced in minutes.

**Negative / tradeoffs**:
- Web previews and test users write to the production database. A tester can create real ratings, accounts and notifications. A staging backend would remove this, and is not decided here.
- Preview addresses are public by default.
- Three credentials sets to rotate and protect (GitHub, Cloudflare, Expo).
- Free EAS limits: 15 iOS and 15 Android builds a month, low priority queue. A busy release week can run out.
- EAS Update free plan covers 1,000 monthly active users, and a reinstall counts twice. Past that, the plan needs an upgrade or updates stop reaching new users.
- The tag, `version`, and runtime rules add ceremony: a native change forces a version bump even for a tiny release.

**Neutral**:
- The backend release process is untouched and stays manual on FastAPI Cloud, which is outside this workflow's scope (`AGENTS.md`).
- `mobile-ci.yml` gains a reusable call mode, so its current triggers and steps are unchanged.
- The `workers.dev` address is a placeholder. A custom domain later means updating `EXPO_PUBLIC_SITE_URL` and adding a redirect from the old address.

## Follow-up

- [ ] Confirm Cloudflare's free plan terms allow a commercial app, and the free plan limits for Workers static assets. This was not verified in the landscape check.
- [ ] Confirm EAS Hosting's free plan limits and commercial terms only if the web host is ever revisited. Not verified.
- [ ] Check that deep links like `/movie/movie/123` load on the deployed web app, and that the `_redirects` rewrite still lets spec 0011's static HTML for `/` be served as is.
- [ ] Confirm `eas build --auto-submit` works for both platforms with the changed `eas.json` submit profile, on the first real tag.
- [ ] Decide a staging backend and database. Until then, previews and test builds write production data.
- [ ] Enroll in the Apple Developer Program and Google Play Console, and run `eas credentials`. Nothing in the tag release flow can finish until then.
- [ ] Revisit the backend host's single instance limit (spec 0006's scheduler note) before any move to more than one instance.
- [ ] Optional: connect the official Expo MCP server (docs.expo.dev/mcp) in your MCP settings to start and watch EAS builds from the agent. Not connected now.
- [ ] `expo-cicd-workflows` was not installed (it is not in the `expo/skills` pack). `wrangler` (root), `eas-app-stores` and `eas-update` (in `mobile/`) were installed and belong in the `## Agent skills` section of the matching `AGENTS.md`: `wrangler` at root, the two Expo skills in `mobile/AGENTS.md`.
- [ ] Add this decision to the scope: an enrolled feature row for deployment, since no row links this spec yet.

