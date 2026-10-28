import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useMovieDetail } from "./useMovieDetail";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DETAIL = {
  id: 157336,
  media_type: "movie",
  title: "Interstellar",
  tagline: "Mankind was born on Earth. It was never meant to die here.",
  overview: "overview text",
  genres: ["Adventure", "Drama", "Science Fiction"],
  release_date: "2014-11-05",
  runtime: 169,
  original_language: "en",
  poster_path: "/p.jpg",
  backdrop_path: "/b.jpg",
  predicted_score: 82,
  cast: [{ name: "Matthew McConaughey", profile_path: "/mm.jpg" }],
  director: ["Christopher Nolan"],
  trailer_key: "abc123",
  watch_providers: { stream: [], rent: [], buy: [] },
  user_rating: null,
};

describe("useMovieDetail", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("GETs /movies/{media_type}/{id} for a valid numeric id (spec 0005 AC-5, spec 0010 AC-4)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue(DETAIL);

    const { result } = await renderHook(() => useMovieDetail("movie", 157336), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/movies/movie/157336");
    expect(result.current.data).toEqual(DETAIL);
  });

  test("GETs the tv path for a TV show", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ ...DETAIL, media_type: "tv" });

    await renderHook(() => useMovieDetail("tv", 71446), { wrapper });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/movies/tv/71446"));
  });

  test("does not fetch at all for a NaN id (e.g. an unresolved route param)", async () => {
    await renderHook(() => useMovieDetail("movie", Number("not-a-number")), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test("surfaces a 404 as an error state (AC-10, id not found)", async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error("Movie 999999999 could not be found"));

    const { result } = await renderHook(() => useMovieDetail("movie", 999999999), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
