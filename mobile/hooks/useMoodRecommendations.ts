import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MovieCard, RecommendRequest } from "../types/api";

interface MoodInput {
  moodText: string;
  moodWeight: number;
  topN: number;
}

// design.md §6.7: the user explicitly triggers this by tapping "Find
// Movies" -- a mutation, not a query that fires on mount like Home's
// useRecommendations.
export function useMoodRecommendations() {
  return useMutation({
    mutationFn: ({ moodText, moodWeight, topN }: MoodInput) =>
      apiFetch<MovieCard[]>("/recommend", {
        method: "POST",
        body: {
          mood_text: moodText,
          mood_weight: moodWeight,
          top_n: topN,
        } satisfies RecommendRequest,
      }),
  });
}
