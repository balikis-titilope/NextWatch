# 0008. Delete a rating

**Date**: 2026-08-11
**Status**: In Progress

## Summary

Right now a user can rate a movie but never remove that rating. This spec adds a way to delete one: a trash icon on each row of the Ratings tab, a confirm step before anything is removed, and a new backend endpoint that deletes the underlying row. Deleting also refreshes Home so its recommendations reflect the change. This only touches the Ratings tab; Profile and onboarding keep working exactly as they do today.

## Requirements

**User stories**:
- As a signed in user, I want to remove a rating I made so that I can correct a mistake or clean up my history, and so it stops shaping my recommendations.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: On the Ratings tab, each rated movie row shows a delete (trash) control.
- **AC-2**: Tapping delete opens a confirm dialog naming the movie before anything is removed.
- **AC-3**: Confirming removes the rating. It disappears from the Ratings tab list and the live count chip updates to match.
- **AC-4**: A user can only delete their own ratings. Deleting a rating that does not exist, or belongs to someone else, returns 404, the same pattern already used elsewhere in this API (never a 403 that would leak which case it was).
- **AC-5**: After a successful delete, Home's recommendation rows (For You, Trending Now, Because you liked X) reflect the change on next view, even though rating a movie (adding or changing a score) deliberately does not force this same refresh.
- **AC-6**: If the delete request fails (offline, server error), the rating stays visible in the list and the user sees an error, not a silently vanished row.
- **AC-7**: Deleting a rating that was already removed (a double tap, or removed from another device) is treated as success on the client (the row disappears), not shown as an error.
- **AC-8**: Onboarding and Profile's "Rate More Movies" are unchanged by this feature; the delete control only appears on the Ratings tab.
- **AC-9**: A successful delete also refreshes the user's `last_active_at` (`touch_last_active`), matching `POST /ratings`, so pruning ratings alone does not make an active user look inactive to spec 0006's re-engagement scan.
- **AC-10**: Deleting a user's last remaining rating leaves the Ratings tab in its normal empty state ("Rate a few movies to see them here") with no leftover count chip.

## Decision

**Chosen option**: Hard delete, trash icon plus confirm dialog on the Ratings tab, Home included in the refresh. Full comparison against a soft delete and an Undo toast alternative: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
No new entities or columns. Operates on the existing `ratings` table (`id`, `user_id`, `movie_id`, `rating`, `created_at`, unique on `(user_id, movie_id)`). A delete removes the one row matching the caller's `user_id` and the given `movie_id`.

**State transitions**: Not applicable. A rating either exists or it does not; there is no intermediate state.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/ratings/{movie_id}` | DELETE | `movie_id`: int (path, required) | `{status: "deleted", movie_id: int}` | bearer | 404 (not found or not owned) |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `DELETE /ratings/{movie_id}` | `movie_id` being deleted | path parameter, already known client side from the Ratings tab row being acted on |
| `DELETE /ratings/{movie_id}` | `user_id` whose rating is deleted | the bearer token via `get_current_user_id`, the same pattern as every other authenticated endpoint |
| `DELETE /ratings/{movie_id}` | deleted vs not found outcome | a single `DELETE ... WHERE user_id = %s AND movie_id = %s RETURNING id`; a returned row means deleted, no row means not found or not owned |
| `DELETE /ratings/{movie_id}` | `last_active_at` freshness (AC-9) | `touch_last_active(user_id)`, called on a successful delete the same way `POST /ratings` already does (`backend/main.py`) |
| Mobile: which caches to refresh after delete (AC-5) | Home's For You / Trending Now / Because you liked, and Movie Detail's own `user_rating` | invalidate `["me", "ratings"]`, the `["movies"]` prefix (covers `["movies", "trending", topN]`, `["movies", movie_id]`, and `["movies", movie_id, "similar"]`), and `["recommend"]`. `["recommend"]` alone was found to miss Trending Now and Movie Detail during this spec's cross check, since both live under the `["movies", ...]` key, not `["recommend", ...]` |
| Confirm dialog (AC-2) | movie title shown in "Remove your rating for X?" | already held client side in the Ratings tab's loaded `RatingEntry`, no extra fetch needed |
| Confirm dialog (AC-2) | the dialog mechanism itself | React Native's built in `Modal` (allowed by `mobile/AGENTS.md` §7's StyleSheet exception list). `Alert.alert` is not used anywhere in `mobile/` today and does not render on Web, the same universal app reason swipe to delete was ruled out in `rationale.md` |
| Mobile: "already gone" vs a genuine failure (AC-7) | which branch `useDeleteRating`'s `onError` takes | `ApiError.status` (`mobile/lib/api.ts`): `status === 404` runs the same cache invalidation as success and shows no error; anything else shows `apiErrorMessage` and keeps the row |
| Ratings tab count chip (AC-10) | whether the chip renders after the list becomes empty | `myRatings.data && myRatings.data.length > 0`, not today's `myRatings.data ?` (true even for an empty array), a pre-existing display gap this feature makes newly reachable |

**Key invariants**:
- A rating can only be deleted by the user who owns it.
- Deleting a rating never deletes the movie row itself or any other user's rating for that movie.
- The `ratings_since_rec_notif` counter behind the `recommendations_ready` notification (spec 0006, AC-1) is not touched by a delete. It already only tracks activity since the last notification fired, not a live total, so a past notification is not retroactively undone by removing the rating that helped trigger it.
- `last_active_at` is still updated on a delete (AC-9), so a user who only removes ratings is not mistaken for inactive by spec 0006's re-engagement scan.

**Security model**:
Identity comes from the bearer token via `get_current_user_id`, never a client supplied user id. A delete for a `movie_id` the caller never rated, or one owned by someone else, returns 404 in both cases, matching the existing pattern in `mark_my_notification_read` (404 either way, so existence is never leaked through the response).

**Configuration required**: None. No new environment variables.

**Critical test scenarios**:
- Happy path: a user deletes a rating they own; it disappears from the Ratings tab and the count chip drops by one. Verifies **AC-1**, **AC-3**.
- Confirmation: tapping delete opens a dialog naming the movie; dismissing it leaves the rating untouched. Verifies **AC-2**.
- Auth/permission: deleting a `movie_id` the caller never rated, or one owned by a different user, returns 404. Verifies **AC-4**.
- Failure case: the DELETE request fails (network or server error); the rating stays visible and an error is shown. Verifies **AC-6**.
- Already gone: deleting a rating already removed elsewhere returns 404, and the client removes the row locally without showing an error. Verifies **AC-7**.
- Cross screen effect: after a successful delete, Home's For You, Trending Now, and Movie Detail's own rating state all reflect the change on next view, not just the Ratings tab. Verifies **AC-5**.
- Activity tracking: a successful delete updates `last_active_at`. Verifies **AC-9**.
- Last rating removed: deleting the only remaining rating shows the normal empty state with no leftover count chip. Verifies **AC-10**.

## Build plan

1. [x] Backend: add `delete_rating(user_id, movie_id)` to `backend/db/import_data.py` (`DELETE FROM ratings WHERE user_id = %s AND movie_id = %s RETURNING id`, mirroring `add_rating`'s style and returning whether a row was actually removed), satisfies **AC-3**, **AC-4**
2. [x] Backend: add `DELETE /ratings/{movie_id}` to `backend/main.py`, using `get_current_user_id`, returning 404 when `delete_rating` finds no row, and calling `touch_last_active(user_id)` on a successful delete (matching `POST /ratings`), satisfies **AC-3**, **AC-4**, **AC-7**, **AC-9**
3. [x] Backend: unit test the ownership scoping, the 404 path, and the `last_active_at` update. Built as `backend/test_main_ratings_endpoints.py`, mirroring `test_cors.py`'s lighter no-lifespan `TestClient` (no real model/embeddings load needed) combined with `test_main_movies_endpoints.py`'s auth-override and `patch.object(main, ...)` idioms, satisfies **AC-4**, **AC-7**, **AC-9**
4. [x] Mobile: delete response shape -- inlined as `apiFetch<{status, movie_id}>` directly in the new hook (not a named export in `mobile/types/api.ts`), matching `useRateMovie.ts`'s own actual convention for its `POST /ratings` response (the codebase's real practice, not a named type), satisfies **AC-3**
5. [x] Mobile: add a `useDeleteRating` hook (`mobile/hooks/useDeleteRating.ts`) mirroring `useRateMovie.ts`'s shape, invalidating `["me", "ratings"]`, the `["movies"]` prefix, and `["recommend"]` on success, satisfies **AC-3**, **AC-5**
6. [x] Mobile: add a trash icon to each row in `mobile/app/(tabs)/ratings.tsx`, wired to a confirm dialog built with React Native's `Modal` (not `Alert.alert`, which does not render on Web) naming the movie, calling `useDeleteRating` on confirm, satisfies **AC-1**, **AC-2**
7. [x] Mobile: handle the failure and already gone cases. Implemented inside `useDeleteRating`'s `mutationFn` (catch + branch on `ApiError.status`) rather than `onError`, so a 404 resolves the mutation as a genuine success (`isSuccess: true`, not `isError`) with the same invalidation, while any other status rethrows for the screen's error branch (`apiErrorMessage`) to keep the row, satisfies **AC-6**, **AC-7**
8. [x] Mobile: fix the Ratings tab's count chip condition (`myRatings.data && myRatings.data.length > 0`, not the old `myRatings.data ?`, which is true even for an empty array) so it disappears once the last rating is deleted, satisfies **AC-10**
9. [x] Mobile: test the new hook (`useDeleteRating.test.tsx`) and the Ratings tab's delete flow (`app/(tabs)/__tests__/ratings.test.tsx`): delete control present, confirm dialog naming the movie, confirm calls the mutation, cancel leaves the rating untouched, a failed delete shows an error and keeps the row, last rating delete shows the empty state with no chip, satisfies **AC-1**, **AC-2**, **AC-6**, **AC-7**, **AC-9**, **AC-10**

## Consequences

**Positive**:
- Users can correct a mistaken rating or clean up their history, and the recommendation engine stops factoring in a rating they no longer stand by.
- No new library, schema, or infrastructure; the whole feature reuses patterns already in the codebase.
- Incidentally fixes a pre-existing display bug (the Ratings tab's count chip rendering "0 Movies" next to the empty state), surfaced by this feature's cross check because delete is what makes the zero-ratings state newly and commonly reachable.

**Negative / tradeoffs**:
- A deleted rating's original `rated_at` timestamp is gone for good; there is no in app way to recover it.
- Delete now behaves slightly differently from rate/add on Home refresh (delete invalidates it, rate deliberately does not); a future reader comparing `useDeleteRating.ts` to `useRateMovie.ts` should understand this is intentional, not an inconsistency to "fix".

**Neutral**:
- No new environment variables, dependencies, or schema changes.

## Follow-up

- [ ] Profile's "Rate More Movies" and onboarding's picks list still have no delete affordance (explicitly out of scope here). Revisit if that gap becomes a real complaint.
- [ ] `/check verify` and `/test` should specifically exercise the confirm dialog and the already gone (404 treated as success) path, since both are easy to skip in a quick manual pass.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
