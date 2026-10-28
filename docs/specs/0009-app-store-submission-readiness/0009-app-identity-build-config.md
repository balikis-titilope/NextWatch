# App identity and build config

## Summary

Gives the app a real bundle identifier and package name, and sets up EAS Build and EAS Submit so a real, store ready binary can actually be produced for both platforms. Without this, nothing else in spec 0009 can be tested on a real device build or actually submitted.

## Requirements

**User stories**:
- As the engineer, I want a working `eas.json` and a real app identity so I can produce a build to test on device and eventually submit to both stores.

**Acceptance criteria**:
- **AC-1**: `app.config.ts` sets `ios.bundleIdentifier` and `android.package` to `com.nextwatch.app`.
- **AC-2**: `eas.json` defines `development`, `preview`, and `production` build profiles.
- **AC-3**: `eas.json` defines submit profiles for both `ios` and `android`, referencing the same bundle identifier and package name.
- **AC-4**: Build number (iOS) and version code (Android) are managed remotely by EAS, not bumped by hand in `app.config.ts`.
- **AC-5**: EAS credentials (signing keys, provisioning profiles, the Play service account) are managed remotely through EAS, not stored as local files in the repository.

## Decision

**Chosen option**: `com.nextwatch.app` as the bundle identifier and package name, three EAS build profiles, EAS's own remote credential management, and EAS's remote build number and version code auto increment. Full comparison against a manual versioning approach: see [rationale.md](../rationale.md).

**Implementation skills**: `eas-workflows` (`wshobson/agents`, `mobile/.agents/skills/eas-workflows/`), for any CI automation of these EAS builds later.

## Feature design

**Data model sketch**: not applicable, this is build configuration, not application data.

**State transitions**: not applicable.

**API surface**: not applicable, no new backend or app runtime surface; this child is entirely configuration files and one time console setup.

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| `eas build --profile production` | the bundle identifier / package name used in the built binary | `app.config.ts`'s `ios.bundleIdentifier` / `android.package`, set once in this spec |
| `eas submit` | the build number / version code submitted | EAS's own remote counter (`cli.appVersionSource: "remote"` in `eas.json`), not a value this app computes or stores itself |
| `eas submit --platform ios` | the App Store Connect API key used to authenticate | provided once by the engineer through `eas credentials`, stored remotely by EAS, not in this repository |
| `eas submit --platform android` | the Google Play service account JSON used to authenticate | same, provided once through `eas credentials` |

**Key invariants**:
- The bundle identifier and package name, once used in a real submission, cannot be changed without becoming a different app in each store's eyes; treat `com.nextwatch.app` as fixed from the first submission onward.
- No signing key, provisioning profile, or service account file is ever committed to the repository.

**Security model**: not applicable in the usual sense (no user data), but the EAS credentials themselves (the App Store Connect API key, the Play service account JSON) are real secrets; remote EAS credential management, not local `credentials.json`, is the reason this spec avoids them ever touching version control.

**Configuration required**:
- No new backend or app environment variables. The EAS credentials themselves are configured through `eas credentials` / the Expo dashboard, not `.env`.
- Prerequisite, not a code change: an Apple Developer Program membership and a Google Play Console account, neither of which exists yet per the engineer's answer during design. Both must be enrolled before EAS Submit can actually run, even though `eas.json` itself can be written and `eas build` can produce internal test binaries without them.

**Critical test scenarios**:
- Happy path: `eas build --profile development` produces an installable build with the correct bundle identifier, verifies **AC-1**, **AC-2**
- Config check: `eas.json` validates (`eas build:configure` or equivalent) with all three profiles and both submit profiles present, verifies **AC-2**, **AC-3**
- Versioning: two successive production builds have different, automatically incremented build numbers with no manual edit to `app.config.ts`, verifies **AC-4**

## Build plan

1. Set `ios.bundleIdentifier` and `android.package` to `com.nextwatch.app` in `mobile/app.config.ts`, satisfies **AC-1**
2. Create `mobile/eas.json` with `development`, `preview`, and `production` build profiles, and `ios`/`android` submit profiles, satisfies **AC-2**, **AC-3**
3. Set `cli.appVersionSource: "remote"` in `eas.json` so build number and version code auto increment, satisfies **AC-4**
4. Run `eas credentials` to set up remote signing for both platforms once developer accounts exist, satisfies **AC-5**
5. Enroll Apple Developer Program and Google Play Console, a manual, non code prerequisite this spec flags but cannot itself complete, blocks task 4 and any real `eas submit`

## Consequences

**Positive**: unblocks producing a real, installable build for the first time, on both platforms; removes an entire class of "forgot to bump the build number" rejections.

**Negative / tradeoffs**: EAS Build is a paid service beyond its free tier at real usage volume; the engineer should check current EAS pricing against expected build frequency before relying on it for every CI run.

**Neutral**: `com.nextwatch.app` is a placeholder style identifier (no owned domain behind it); acceptable for a first submission, but note that changing it later means starting over as a new app in both stores' eyes.

## Follow-up

- [ ] Confirm current EAS Build pricing against expected build frequency before wiring it into CI (the `eas-workflows` skill's automation patterns can help once volume is known).
