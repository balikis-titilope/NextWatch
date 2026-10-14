import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MovieSearchResult } from "../types/api";

// Local-only typeahead (GET /movies/search) -- never hits TMDB, so it's
// cheap enough to run live as the user types (design.md §6.3).
export function useMovieSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["movies", "search", trimmed],
    queryFn: () => apiFetch<MovieSearchResult[]>(`/movies/search?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length > 0,
  });
}
