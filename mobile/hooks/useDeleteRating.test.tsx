import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ApiError, apiFetch } from "../lib/api";
import { useDeleteRating } from "./useDeleteRating";

// lib/api.ts reads EXPO_PUBLIC_API_BASE_URL via expo-constants at import
// time and throws if unset -- this hook only needs the real ApiError class
// (for the 404 instanceof check below) plus a mocked apiFetch, never a
// real fetch, so expo-constants just needs a value to satisfy that guard.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));
jest.mock("../lib/api", () => {
  const actual = jest.requireActual("../lib/api");
  return { ...actual, apiFetch: jest.fn() };
});

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useDeleteRating", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("DELETEs /ratings/{movie_id} with the media_type query param", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ status: "deleted", movie_id: 1 });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useDeleteRating(), { wrapper });
    result.current.mutate({ movie_id: 1, media_type: "movie" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/ratings/1?media_type=movie", { method: "DELETE" });
  });

  test("deletes a TV rating with media_type=tv", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ status: "deleted", movie_id: 71446 });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useDeleteRating(), { wrapper });
    result.current.mutate({ movie_id: 71446, media_type: "tv" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/ratings/71446?media_type=tv", { method: "DELETE" });
  });

  test("on success, invalidates the movies prefix so Home/Movie Detail refresh (AC-5)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ status: "deleted", movie_id: 42 });
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteRating(), { wrapper });
    result.current.mutate({ movie_id: 42, media_type: "movie" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["movies"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me", "ratings"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["recommend"] });
  });

  test("a 404 (already gone) is treated as success, not an error (AC-7)", async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError("not found", 404));
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteRating(), { wrapper });
    result.current.mutate({ movie_id: 7, media_type: "movie" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me", "ratings"] });
  });

  test("a genuine failure surfaces as an error and does not invalidate (AC-6)", async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError("server error", 500));
    const { client, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteRating(), { wrapper });
    result.current.mutate({ movie_id: 3, media_type: "movie" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
