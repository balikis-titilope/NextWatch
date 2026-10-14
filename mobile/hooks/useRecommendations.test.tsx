import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useRecommendations } from "./useRecommendations";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRecommendations", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("POSTs /recommend with the given top_n (spec 0005 AC-1/AC-2)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useRecommendations(15), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/recommend", {
        method: "POST",
        body: { top_n: 15 },
      });
    });
  });

  test("defaults top_n to 10 when not given", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useRecommendations(), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/recommend", { method: "POST", body: { top_n: 10 } });
    });
  });

  test("resolves with an empty list without error, the AC-3 cold-start shape", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => useRecommendations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  test("resolves with the card list on a usable taste signal", async () => {
    const cards = [
      {
        id: 1,
        title: "Arrival",
        release_date: "2016-11-11",
        poster_path: "/a.jpg",
        predicted_score: 82,
      },
    ];
    (apiFetch as jest.Mock).mockResolvedValue(cards);

    const { result } = await renderHook(() => useRecommendations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(cards);
  });
});
