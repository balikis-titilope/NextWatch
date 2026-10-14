import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { BrowseMovie, MediaType } from "../types/api";

export interface BrowseFilters {
  language?: string;
  actor?: string;
  startYear?: number;
  endYear?: number;
  // Spec 0010 AC-3: the Movies/TV/Both filter chip; omitted means the
  // backend's own default ("both").
  mediaType?: MediaType | "both";
  // Home's "Popular Picks" and the Search tab: order the popular pool by the
  // user's taste, and add their match score to each title.
  personalized?: boolean;
  limit?: number;
}

function toQueryString(filters: BrowseFilters): string {
  const params = new URLSearchParams();
  if (filters.language) params.set("language", filters.language);
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.startYear !== undefined) params.set("start_year", String(filters.startYear));
  if (filters.endYear !== undefined) params.set("end_year", String(filters.endYear));
  if (filters.mediaType) params.set("media_type", filters.mediaType);
  if (filters.personalized) params.set("personalized", "true");
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

// GET /movies (design.md §6.5): language/actor/year-range/media-type
// filters compose server-side; browses only what's already loaded, never
// hits TMDB.
export function useBrowseMovies(filters: BrowseFilters) {
  return useQuery({
    queryKey: ["movies", "browse", filters],
    queryFn: () => apiFetch<BrowseMovie[]>(`/movies${toQueryString(filters)}`),
    // Keep the grid on screen while a bigger page or new filter loads.
    placeholderData: keepPreviousData,
  });
}
