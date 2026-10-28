import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useSimilarMovies } from "./useSimilarMovies";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSimilarMovies", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("GETs /movies/{media_type}/{id}/similar by id, no title involved (spec 0005 AC-13)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useSimilarMovies("movie", 157336, 10), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/movies/movie/157336/similar?top_n=10");
    });
  });

  test("defaults top_n to 10 when not given", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useSimilarMovies("movie", 157336), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/movies/movie/157336/similar?top_n=10");
    });
  });

  test("does not fetch for a NaN id", async () => {
    await renderHook(() => useSimilarMovies("movie", Number("nope")), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test("resolves with cards scored as plain closeness, not personalized (AC-13's distinct meaning), and can mix media types (spec 0010 AC-6)", async () => {
    const cards = [
      {
        id: 19995,
        media_type: "movie",
        title: "Avatar",
        release_date: "2009-12-16",
        poster_path: "/a.jpg",
        predicted_score: 49,
      },
      {
        id: 71446,
        media_type: "tv",
        title: "Moon Lovers: Scarlet Heart Ryeo",
        release_date: "2016-08-29",
        poster_path: "/m.jpg",
        predicted_score: 44,
      },
    ];
    (apiFetch as jest.Mock).mockResolvedValue(cards);

    const { result } = await renderHook(() => useSimilarMovies("movie", 157336), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(cards);
  });
});
