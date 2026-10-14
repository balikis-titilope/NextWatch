import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MediaType, MovieCard } from "../types/api";

// Movie Detail's own "Similar" row, and Home's "Because you liked [X]"
// rows (spec 0005 AC-13) -- both call this same id-based endpoint, no
// title lookup or fuzzy matching either way. Ranked purely by embedding
// closeness (spec 0010 AC-6): a movie's similar list can genuinely
// include a TV show, and vice versa.
export function useSimilarMovies(mediaType: MediaType, id: number, topN = 10) {
  return useQuery({
    queryKey: ["movies", mediaType, id, "similar", topN],
    queryFn: () => apiFetch<MovieCard[]>(`/movies/${mediaType}/${id}/similar?top_n=${topN}`),
    enabled: Number.isFinite(id),
  });
}
