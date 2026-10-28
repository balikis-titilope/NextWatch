import { useQueries } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MediaType, MovieCard } from "../types/api";

// Home's "Because you liked X" rows fetch every seed's similar list at once,
// so the screen can drop titles that repeat across rows. Same endpoint and
// query key as useSimilarMovies, so the cache is shared with Movie Detail.
// Returns one list per seed, in order (undefined while loading).
export function useSimilarRows(
  seeds: { media_type: MediaType; movie_id: number }[],
  topN: number,
): (MovieCard[] | undefined)[] {
  const results = useQueries({
    queries: seeds.map((seed) => ({
      queryKey: ["movies", seed.media_type, seed.movie_id, "similar", topN],
      queryFn: () =>
        apiFetch<MovieCard[]>(`/movies/${seed.media_type}/${seed.movie_id}/similar?top_n=${topN}`),
    })),
  });
  return results.map((result) => result.data);
}
