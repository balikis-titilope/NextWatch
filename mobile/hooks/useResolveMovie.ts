import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { ResolvedMovie } from "../types/api";

// Fallback for a title GET /movies/search can't find locally: searches
// TMDB, fetches full details, and caches it server-side (design.md §6.3).
export function useResolveMovie() {
  return useMutation({
    mutationFn: (title: string) =>
      apiFetch<ResolvedMovie>("/movies/resolve", { method: "POST", body: { title } }),
  });
}
