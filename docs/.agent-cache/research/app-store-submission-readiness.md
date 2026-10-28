# App Store Submission Readiness Research Report

**Research Date:** August 12, 2026  
**Scope:** iOS App Store & Google Play submission requirements for NextWatch  

---

## 1. Apple App Store Review Guideline 5.1.1(v) — Account Deletion

**Requirement:** Apps supporting account creation must provide in-app account deletion with a direct web link option if deletion is completed outside the app. Deletion must be easy to find (typically in Settings) and remove the entire account and personal data—not just deactivation. No immediate deletion required; you may inform users of a timeline and provide confirmation. Reauthentication and confirmation steps are acceptable. Grace periods aligned with subscription expiration are permitted if immediate deletion is also available.

**Source:** [Offering account deletion in your app - Apple Developer](https://developer.apple.com/support/offering-account-deletion-in-your-app/)

---

## 2. Google Play User Data Policy — Account Deletion

**Requirement:** Apps must provide account deletion through **both in-app AND web-based options**. Users need a readily discoverable option in the app AND an accessible path outside the app (e.g., web form). Temporary deactivation does not qualify. Associated user data must be deleted when deletion is requested. Policy updated effective April 15, 2026, with 30-day compliance window.

**Source:** [Understanding Google Play's app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

---

## 3. Apple App Privacy Details (Nutritional Label)

**Data Categories Required:** For this app, declare:
- **Contact Info:** Email address (authentication)
- **User ID:** Account identifier (ratings/preferences tracking)
- **Browsing History / Search History:** Ratings history & taste preferences
- **Analytics:** Sentry (crash telemetry, device IDs) and PostHog (usage analytics, device/session IDs)

Each category requires: purpose (required/optional), linked to user identity (yes/no), data retention policy.

**Source:** [App Store Connect Privacy section](https://developer.apple.com/app-store/app-privacy-details/)

---

## 4. Google Play Data Safety Form

**Data Categories Required:** Complete form in Play Console:
- **Email address** → Contact Info
- **Ratings/preferences history** → Activity or Location History
- **Sentry telemetry** → Device identifiers, Crash/error logs
- **PostHog analytics** → Device identifiers, Usage data

Each entry specifies: data type, collection reason, user-facing status, deletion practices.

**Source:** [Google Play Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

---

## 5. Expo EAS Build + EAS Submit (2026)

**Build Profiles:** eas.json typically includes `development`, `preview`, `production`. Managed credentials via EAS is the recommended default (vs. local credentials.json).

**Requirements:**
- **iOS:** Apple Developer Program membership + App Store Connect API key
- **Android:** Google Play service account JSON file
- **Credential Management:** Remote EAS credential storage is the recommended default; local credentials.json available as alternative

**EAS Submit:** Configure `submit` profiles in eas.json with platform-specific options (bundle ID, package name), run `eas submit --platform ios/android`.

**Sources:**
- [EAS Build - Expo Documentation](https://docs.expo.dev/build/introduction/)
- [Configure EAS Submit with eas.json](https://docs.expo.dev/submit/eas-json/)
- [Using existing credentials](https://docs.expo.dev/app-signing/existing-credentials/)

---

## Summary

**Key Compliance Items:**
- Account deletion: in-app + optional web link (Apple); in-app + required web path (Google)
- Privacy disclosures: 4+ data categories for both stores (email, user ID, history, analytics)
- EAS: Use remote credential management; configure 3 build profiles + submit profiles in eas.json
- Google Play deadline: April 15, 2026 compliance window active
