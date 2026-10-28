import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MovieCard } from "../types/api";

// Home's "For You" row (spec 0005 AC-1/AC-2/AC-3): the logged-in user's
// own taste, derived server side from their ratings -- no liked_titles
// needed here, that fallback is only for the anonymous/dev-testing path.
// [] (not an error) means no usable taste signal yet, so Home can show
// the "rate a few movies" prompt instead.
export function useRecommendations(topN = 10) {
  return useQuery({
    queryKey: ["recommend", topN],
    queryFn: () => apiFetch<MovieCard[]>("/recommend", { method: "POST", body: { top_n: topN } }),
  });
}
