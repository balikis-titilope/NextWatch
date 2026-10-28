import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../lib/api";
import type { MediaType } from "../types/api";

// Mirrors useRateMovie.ts's shape (spec 0008). media_type is a required
// query param (spec 0010), not defaulted -- a movie and a TV show can
// share the same movie_id. Unlike rating/adding a movie, a delete DOES
// invalidate Home's rows (AC-5) -- ["movies"] is a prefix match, covering
// trending, this title's detail, and its similar list, none of which
// live under ["recommend", ...] alone.
export function useDeleteRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { movie_id: number; media_type: MediaType }) => {
      try {
        return await apiFetch<{ status: string; movie_id: number }>(
          `/ratings/${vars.movie_id}?media_type=${vars.media_type}`,
          { method: "DELETE" },
        );
      } catch (error) {
        // AC-7: already gone (a double tap, or deleted from another
        // device) is treated as success -- the row still disappears,
        // with no error shown, since the end state asked for (no
        // rating) already holds true.
        if (error instanceof ApiError && error.status === 404) {
          return { status: "deleted", movie_id: vars.movie_id };
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movies"] });
      queryClient.invalidateQueries({ queryKey: ["me", "ratings"] });
      queryClient.invalidateQueries({ queryKey: ["recommend"] });
    },
  });
}
