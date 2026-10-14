# Legal screens and consent

## Summary

Adds a real Privacy Policy and Terms of Service, hosted at a public web address on the existing backend, linked from the signup screen and from Profile, plus a support page both consoles require a link for at submission time.

## Requirements

**User stories**:
- As a prospective user, I want to read the Privacy Policy and Terms of Service before I create an account.
- As a signed in user, I want to reread them at any time from Profile.

**Acceptance criteria**:
- **AC-1**: `GET /legal/privacy-policy` and `GET /legal/terms` on the backend each return a real, readable page, publicly reachable with no login required.
- **AC-2**: The signup screen shows a line naming both documents, each a tappable link, before the account is created.
- **AC-3**: Profile has a permanent entry for each document, reachable any time the account is active. (An account in its 30 day deletion grace period is signed out immediately by design, per the account deactivation and deletion child spec, so Profile is not reachable during that window; this is expected, not a gap.)
- **AC-4**: Tapping either link opens the hosted page in the system browser, not a native reimplementation of the text.
- **AC-5**: `GET /legal/support` on the backend returns a real, publicly reachable page naming a support contact, satisfying both consoles' required support URL field.

## Decision

**Chosen option**: draft the text as a standard indie app template covering this app's actual data collection, host it as static HTML served by the existing FastAPI backend, and open it from the app via an in app browser rather than duplicating the content natively.

Hosting on the backend (rather than a separate static host) reuses the one deploy target the app already has and gives both stores a stable address under the same domain `EXPO_PUBLIC_API_BASE_URL` already points at. Opening it via React Native's built in `Linking.openURL` (the system browser, not an in app WebView) rather than a native screen keeps the text in exactly one place with no new library: a native reimplementation would need to be kept in sync with the hosted copy by hand, and a WebView package such as `expo-web-browser` is not on `mobile/AGENTS.md` §3's approved list, so `Linking`, already part of React Native core, is the choice that needs no install and no ask (basis: your `AGENTS.md` §3 and §13, no unlisted library without asking).

## Feature design

**Data model sketch**:
No new tables or columns. The policy and terms text live as two static HTML files in the backend's source tree, not the database, since they change rarely and belong in version control like any other content.

**State transitions**: Not applicable, static content.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/legal/privacy-policy` | GET | none | HTML page | none (public) | none expected |
| `/legal/terms` | GET | none | HTML page | none (public) | none expected |
| `/legal/support` | GET | none | HTML page naming a support email | none (public) | none expected |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `GET /legal/privacy-policy` | the policy text | a static HTML file in `backend/`, drafted for this app's real data collection (email, ratings and taste history, Sentry and PostHog analytics), reviewed by the engineer before shipping |
| `GET /legal/terms` | the terms text | a static HTML file in `backend/`, same drafting and review process |
| `GET /legal/support` | the support email address | a static HTML file naming a real, monitored inbox the engineer owns, e.g. `support@` the app's own domain if one exists, else the engineer's existing project contact address; no new inbox or ticketing tool is created for this |
| Signup screen's consent line | the two link targets | `${EXPO_PUBLIC_API_BASE_URL}/legal/privacy-policy` and `/legal/terms`, the same base URL `mobile/lib/api.ts` already uses for every backend call |
| Profile's two entries | the two link targets | same as above |
| Both consoles' support URL field | the value entered at submission time | `${EXPO_PUBLIC_API_BASE_URL}/legal/support`, entered directly in App Store Connect and Play Console, not read by the app itself |

**Key invariants**:
- The hosted pages are the single source of truth; nothing in the mobile app repeats their text.
- Both pages are reachable without a bearer token; a signed out prospective user must be able to read them before creating an account.

**Security model**:
Fully public, read only content. No user data is read or written by these endpoints.

**Configuration required**: none. No new environment variables.

**Critical test scenarios**:
- Happy path: all three endpoints return 200 with real content, verifies **AC-1**, **AC-5**
- Signup: the consent line's two links open the correct hosted pages, verifies **AC-2**
- Profile: both entries are present and open the correct pages while the account is active, verifies **AC-3**

## Build plan

1. Draft the Privacy Policy, Terms of Service, and support page as static HTML, covering the data collection confirmed in spec 0009's rationale (email, ratings and taste history, Sentry and PostHog analytics keyed to a user id, never email or name to either vendor), satisfies **AC-1**, **AC-5**
2. Add `GET /legal/privacy-policy`, `GET /legal/terms`, and `GET /legal/support` to `backend/main.py`, serving the three static files, satisfies **AC-1**, **AC-5**
3. Add the consent line and its two links to the signup screen, opening each via `Linking.openURL`, satisfies **AC-2**, **AC-4**
4. Add the two entries to Profile, opening each the same way, satisfies **AC-3**, **AC-4**

## Consequences

**Positive**: both stores' hard requirement for a working privacy policy URL is satisfied; the app has a real, reviewable terms of service for the first time.

**Negative / tradeoffs**: the text is engineer drafted from a standard template, not lawyer reviewed; acceptable for an indie app at this stage, but a real legal review is worth doing before any scale that makes the app a meaningful liability target.

**Neutral**: no new dependency; `Linking` is part of React Native core, already available with no change to `mobile/AGENTS.md` §3's approved list.

## Follow-up

- [ ] Consider a real legal review of the drafted text once the app has real users, not just before submission.
