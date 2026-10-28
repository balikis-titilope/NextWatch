import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useRateMovie } from "./useRateMovie";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useRateMovie", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("POSTs /ratings with the movie id, media_type, and rating", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "saved",
      movie_id: 1,
      media_type: "movie",
      rating: 4,
    });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRateMovie(), { wrapper });
    result.current.mutate({ movie_id: 1, media_type: "movie", rating: 4 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/ratings", {
      method: "POST",
      body: { movie_id: 1, media_type: "movie", rating: 4 },
    });
  });

  test("rates a TV show the same way", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "saved",
      movie_id: 71446,
      media_type: "tv",
      rating: 5,
    });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRateMovie(), { wrapper });
    result.current.mutate({ movie_id: 71446, media_type: "tv", rating: 5 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/ratings", {
      method: "POST",
      body: { movie_id: 71446, media_type: "tv", rating: 5 },
    });
  });

  test("on success, invalidates this title's detail cache so user_rating refreshes (AC-6)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "saved",
      movie_id: 42,
      media_type: "movie",
      rating: 5,
    });
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useRateMovie(), { wrapper });
    result.current.mutate({ movie_id: 42, media_type: "movie", rating: 5 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["movies", "movie", 42] });
  });

  test("on success, invalidates the ratings list cache so 'Because you liked' rows refresh (AC-13)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "saved",
      movie_id: 42,
      media_type: "movie",
      rating: 5,
    });
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useRateMovie(), { wrapper });
    result.current.mutate({ movie_id: 42, media_type: "movie", rating: 5 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me", "ratings"] });
  });

  test("does not invalidate anything when the mutation fails", async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error("rating must be between 1 and 5"));
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useRateMovie(), { wrapper });
    result.current.mutate({ movie_id: 1, media_type: "movie", rating: 9 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
