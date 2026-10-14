import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";
import type { RatingEntry } from "../types/api";

// GET /me/ratings, already ordered most-recent-first (backend/db/import_data.py's
// get_user_ratings). Home's "Because you liked [X]" rows filter this to
// 4-5 star ratings, most recent 3 (spec 0005 AC-13); the Ratings tab
// (Journey 5) will show the full list. Gated on userId so it can't keep
// firing (and retrying token renewal) after logout, same reasoning as
// useMe/useUnreadNotificationCount.
export function useMyRatings() {
  const userId = useSessionStore((state) => state.userId);
  return useQuery({
    queryKey: ["me", "ratings"],
    queryFn: () => apiFetch<RatingEntry[]>("/me/ratings"),
    enabled: !!userId,
  });
}
