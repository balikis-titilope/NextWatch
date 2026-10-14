# 0004. Rationale: relaunch routing and onboarding completion tracking

_Decision history for [`index.md`](index.md). This file holds the context, the options weighed, and the full reasoning; `/develop` does not need to read it._

## Context

Scope feature 5, "Account & getting started" (`docs/scope/scope.md`), is planned but unbuilt: `mobile/app/index.tsx` is a hardcoded redirect to the login screen with a comment pointing straight at this decision, and the `(auth)` and `onboarding` screens are placeholders. `mobile/context/design.md` states the routing rule in words, twice ("valid token but never completed onboarding, redirect into onboarding; otherwise, tabs"), but never says how "completed onboarding" is tracked, and its text describing a Done button that only appears after 3 or more ratings turned out to be stale: the actual design mockup (`mobile/assets/stitch_md_design_system/onboarding_rate_your_favorites/`) shows Done and Skip both always available, no minimum. Neither the backend's `public.users` table (only an `id` column) nor any client side storage holds a signal for this today.

The natural looking shortcut, using the account's existing rating history as the signal, does not work: a user who taps Skip without rating anything has the same, empty rating history as a user who has never opened the app. The two cases are only distinguishable if the app remembers the Skip itself. The engineer confirmed Skip must be permanent even at zero ratings, which settles this: some new piece of state is unavoidable, the only real question is where it lives and how the app checks it.

**Update, 2026-08-08: email confirmation.** `backend/auth.py`'s `sign_up` carries a comment flagging an unresolved gap: it returns Supabase's access and refresh tokens directly "if email confirmation is off in the Supabase project", and the routing built from this spec (AC-8, task 9) has always assumed that's the case, signup returns tokens immediately and the app goes straight into onboarding. Whether that assumption actually holds depends on a Supabase project dashboard setting this spec never decided. The engineer confirmed email confirmation should be required: a new account must prove it owns the email address before it can sign in, matching Supabase's own default and most production apps with real accounts. That settles the "whether"; the "how" (what the user sees, and what mechanism confirms the address) is the new decision recorded below as Options 4 and 5.

Two constraints from the rest of the project shape where the onboarding flag state can live. `mobile/AGENTS.md` §12 restricts `AsyncStorage` to theme preference only, and `expo-secure-store` (already used for the access and refresh tokens) has no query surface for arbitrary account facts, only the raw stored values, so a device local flag would mean introducing a storage convention the project doesn't otherwise use. Separately, `AGENTS.md`'s Rules explicitly mark `backend/` as out of scope for `/develop` (it predates this workflow, has no lint or CI), yet this decision structurally needs backend changes (a new column, endpoints to read and set it, and a token refresh endpoint) for the app to route correctly at all. That tension doesn't go away by choosing a client side flag either, since the token refresh work discussed below also touches the backend regardless.

## Options considered

### Option 1: Server side completion flag, checked at launch, with a renewal check that runs everywhere

A new `onboarding_completed` boolean on the backend's `users` table, read via a new `GET /me` and set via a new `POST /me/onboarding/complete`. A stored, expired access token triggers a silent renewal (`POST /auth/refresh`, proxying Supabase's refresh grant) through a shared handler in `lib/api.ts` that runs for any request, not only the launch check.

**Pros**:
- Survives a reinstall or a new device, since the source of truth is the account, not the phone.
- One shared 401 handling path benefits every screen built from here on, not just this one launch check.
- No new client side storage convention; keeps `AsyncStorage`'s "theme only" rule intact.

**Cons**:
- Needs backend work that sits outside `/develop`'s automated path, has to be built and kept in sync by hand.
- The shared 401 handler touches `lib/api.ts`, code every screen already depends on, so a mistake there has a wide blast radius.

### Option 2: Client only flag (`AsyncStorage`), renewal checked only at launch

Store the completion flag on the device only, and only attempt a token renewal as part of the launch check, not as a general handler.

**Pros**:
- No backend change at all for the flag itself; smallest possible build.
- Keeps the renewal logic contained to one place (the launch check), simpler to reason about than a handler that can fire from anywhere.

**Cons**:
- Reinstalling the app or logging in on a new device loses the flag, so a user who already finished onboarding would see it again, the opposite of what was asked for.
- Goes against `AGENTS.md` §12, which currently reserves `AsyncStorage` for theme preference only; using it here means either breaking that rule or writing a second, undocumented local storage path.
- A token that expires while the app is already open (not just at launch) still forces a full re-login, since renewal isn't wired anywhere else.

### Option 3: Infer completion from existing ratings data, no new field at all

Treat "has at least one rating" as "has completed onboarding," reusing the already existing `/me/ratings` endpoint, adding nothing new to the schema.

**Pros**:
- Zero new backend surface for the flag; `/me/ratings` already exists and is already needed elsewhere (the Ratings tab, Profile).
- Nothing to keep in sync, the signal is a natural side effect of normal use.

**Cons**:
- Cannot represent "skipped on purpose," which the engineer confirmed must be permanent: a user who skips with zero ratings looks identical, forever, to a user who has never opened the app, so they would see onboarding again on every relaunch until they happen to rate something.
- Directly contradicts the confirmed requirement rather than trading off against it, this option was really only viable if that requirement had been softened.

### Option 4: Numeric code (OTP), typed into the app

Supabase's own email confirmation, configured to send a 6 digit code instead of a link. The new confirm email screen collects it and calls a new `/auth/verify-signup` endpoint that proxies Supabase's verify call.

**Pros**:
- Works identically on iOS, Android, and Web, the same three targets `AGENTS.md` names for this app; no platform specific deep link setup.
- No new mobile dependency and no custom URL scheme handling to build or test.
- The failure modes are simple and visible: wrong code, expired code, both handled inline on one screen.

**Cons**:
- Real friction: the user has to leave the app, find the email, and type six digits, for every new account.
- A slow email delivery leaves the user staring at an empty code field with nothing to do but wait or retry.

### Option 5: Tap through confirmation link, opened via a custom URL scheme deep link

Supabase's default confirmation flow: the email contains a link, tapping it hits Supabase's own confirm endpoint, which redirects to a URL this project configures (a `nextwatch://` deep link, using the custom scheme `app.config.ts` already declares).

**Pros**:
- No code to type; confirming is a single tap from the email itself.
- Uses a scheme the project already has (`app.config.ts`'s `scheme: "nextwatch"`), so no brand new mobile configuration for the native side.

**Cons**:
- Many email clients (Gmail's and Outlook's mobile apps especially) open links in an in app browser rather than handing off to the custom scheme directly, which can silently fail to reach the app.
- The universal Web target has no equivalent: a custom URL scheme does not work from a browser tab, so Web would need a real hosted domain with Apple and Google's associated domain verification files (Universal Links, App Links) to get the same one tap experience, infrastructure this project does not have.
- Harder to test: verifying a deep link opens the right screen with the right data needs a real device or simulator deep link setup, not just an HTTP call.

## Rationale

Option 3 was the cheapest and was seriously considered, since it needs no new backend surface at all, but it fails the one requirement that was pinned down early and explicitly: Skip has to be sticky even at zero ratings, and no reading of the existing `ratings` table can tell "skipped on purpose" apart from "never seen the screen." That rules it out on correctness, not just preference.

Between the two flag based options, Option 2's appeal is avoiding backend work, but it fails its own goal the moment a user reinstalls or switches devices, exactly the case a permanent flag is supposed to survive, and it would mean quietly working around `AGENTS.md` §12's `AsyncStorage` convention rather than following it. Option 1 costs more up front, four small backend endpoints built by hand outside the usual workflow, but it is the only option that actually satisfies "never show onboarding again," matches how every other piece of account state already works (server side, via the backend), and turns the token renewal work into something every screen benefits from instead of a one-off case wired only into the launch path. The backend work being manual, unusual for this project, is a real cost, which is why the build plan calls each task out explicitly rather than letting it hide inside a "wire up routing" task.

For the confirmation mechanism, Option 4's numeric code wins over Option 5's tap through link mainly because of the Web target: `AGENTS.md` names iOS, Android, and Web as one codebase, and a custom scheme link only reliably works from a native app, not a browser tab, without associated domain infrastructure this project has never set up (no hosted web domain exists yet). A code sent by email and typed into whichever platform the user is on sidesteps that gap entirely, at the cost of a small amount of user friction that most apps requiring confirmation already ask for. If NextWatch gets a real web domain later, Option 5 is worth revisiting (see `index.md`, Follow-up).
