import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { MediaType, MovieDetail } from "../types/api";

// Movie/TV Detail's full data (spec 0005 AC-5 through AC-10, extended for
// TV by spec 0010 AC-4). media_type is required -- a movie and a TV show
// can share the same raw id.
export function useMovieDetail(mediaType: MediaType, id: number) {
  return useQuery({
    queryKey: ["movies", mediaType, id],
    queryFn: () => apiFetch<MovieDetail>(`/movies/${mediaType}/${id}`),
    enabled: Number.isFinite(id),
  });
}
