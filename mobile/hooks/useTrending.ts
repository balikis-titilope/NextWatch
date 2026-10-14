import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MovieCard } from "../types/api";

// Home's "Top Rated Picks" row and hero (spec 0005 AC-4): top rated titles,
// ordered by the requesting user's own taste server-side. Each card carries
// their match score (null with no usable taste signal yet).
export function useTrending(topN = 10) {
  return useQuery({
    queryKey: ["movies", "trending", topN],
    queryFn: () => apiFetch<MovieCard[]>(`/movies/trending?top_n=${topN}`),
  });
}
