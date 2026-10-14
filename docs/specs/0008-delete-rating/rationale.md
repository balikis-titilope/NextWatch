# 0008. Delete a rating: rationale

## Context

A user can rate a movie (search it, add it, tap a star) in three places: onboarding, Profile's "Rate More Movies", and it then shows up permanently in the Ratings tab. There is no way to remove a rating anywhere. The backend has never had a delete path for `ratings`; `add_rating` in `backend/db/import_data.py` only ever inserts or updates (`ON CONFLICT ... DO UPDATE`).

This became a real complaint once a user pointed out they had no way to walk back a mistaken or no longer accurate rating, both to clean up their own history and because the recommendation engine keeps using every rating on file (`build_user_profile_from_ratings` reads the full, live set every time it computes a taste vector). Without a delete path, a bad or stale rating has no way to stop influencing recommendations short of contacting support or editing the database directly.

The forces at play: this app is universal (iOS, Android, and Web from one codebase), so any interaction pattern has to work on all three without adding a library outside `mobile/AGENTS.md` §3's approved list. The schema has no soft delete anywhere today. And `useRateMovie.ts` already set a precedent for how a rating change touches Home's cache, one this feature has to either follow or deliberately depart from.

## Options considered

### Option 1: Hard delete, trash icon plus confirm dialog, Home included in the refresh

A new `DELETE /ratings/{movie_id}` endpoint removes the row outright. The Ratings tab gets a trash icon per row; tapping it opens a confirm dialog naming the movie. On success, both the ratings list and Home's recommendation query are invalidated.

**Pros**:
- Matches how every other write in this schema already works (plain insert/update/delete, nothing soft).
- Works identically on iOS, Android, and Web with no new library.
- Home never looks stale right after a deliberate, confirmed action.

**Cons**:
- The original `rated_at` timestamp is gone for good once deleted; there is no way to recover it short of a database backup.

### Option 2: Soft delete, keep a history of removed ratings

Add a `deleted_at` column to `ratings` instead of removing the row. Every read (recommendation engine, Ratings tab, notification threshold) filters it out.

**Pros**:
- Nothing is ever truly lost; a removed rating could be restored or audited later.

**Cons**:
- Nothing else in this schema soft deletes; every read path (`get_user_ratings`, `get_user_ratings_detailed`, the recommendation engine's embedding build) would need a new filter, a wider change than the feature calls for.
- No product need for this history was named; it adds a column and a query filter carried forever for a use case nobody asked for.

### Option 3: Skip the confirm dialog, delete immediately with an Undo toast

Tapping delete removes the rating right away and shows a brief Undo affordance instead of asking first.

**Pros**:
- One tap instead of two; feels faster for a confident user.

**Cons**:
- This app has no toast or snackbar component yet; it is new UI infrastructure for one feature.
- A rating is not a trivial, easily repeated action (it took a search and a star tap to create); losing it to a stray tap with only a time limited undo window is a worse default than asking first.

## Rationale

The existing schema and code already answer most of this. `add_rating` in `backend/db/import_data.py` is a plain insert/update with no soft delete anywhere in `ratings`, `movies`, or `notifications`; adding a `deleted_at` column and filtering it out of three separate read paths for a use case nobody asked for (Option 2) is more machinery than the problem needs. The app is universal (iOS, Android, and Web from one codebase, `mobile/AGENTS.md` §3), which rules out a swipe to delete gesture: it does not translate to Web and would pull in a library (`react-native-gesture-handler`'s Swipeable) that is not in the approved stack, where a plain icon button works everywhere with nothing new installed.

The Home refresh call is the one place this spec deliberately departs from existing precedent. `useRateMovie.ts` explicitly skips invalidating `/recommend` on every rating, reasoning that "refetching every list on every single star tap isn't worth the flicker" for a fast, repeatable action. Delete is different: it is gated behind a confirm dialog, so it fires far less often and only when the user has already committed to the action, which makes the flicker cost low and a stale Home right after a deliberate removal the worse look.
