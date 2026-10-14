import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MediaType } from "../types/api";

// Shared by onboarding, Movie Detail, and Ratings (same upsert endpoint --
// design.md §6.3/§6.6/§6.8). media_type is required (spec 0010): a movie
// and a TV show can share the same movie_id.
export function useRateMovie() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { movie_id: number; media_type: MediaType; rating: number }) =>
      apiFetch<{ status: string; movie_id: number; media_type: MediaType; rating: number }>(
        "/ratings",
        { method: "POST", body: vars },
      ),
    onSuccess: (_, vars) => {
      // AC-6: Movie Detail's user_rating reflects this immediately; the
      // ratings list feeds "Because you liked" row eligibility (AC-13).
      // Not invalidating /recommend or /movies/trending here -- their
      // scores would technically shift too, but refetching every list on
      // every single star tap isn't worth the flicker for what settles
      // naturally on the next normal refetch.
      queryClient.invalidateQueries({ queryKey: ["movies", vars.media_type, vars.movie_id] });
      queryClient.invalidateQueries({ queryKey: ["me", "ratings"] });
    },
  });
}
