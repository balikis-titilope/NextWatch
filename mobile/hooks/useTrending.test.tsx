import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useTrending } from "./useTrending";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useTrending", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("GETs /movies/trending with the given top_n (spec 0005 AC-4)", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useTrending(15), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/movies/trending?top_n=15");
    });
  });

  test("defaults top_n to 10 when not given", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useTrending(), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/movies/trending?top_n=10");
    });
  });

  test("resolves with cards carrying a null score for a user with no usable taste signal", async () => {
    const cards = [
      {
        id: 1,
        title: "Dune",
        release_date: "2021-09-15",
        poster_path: "/d.jpg",
        predicted_score: null,
      },
    ];
    (apiFetch as jest.Mock).mockResolvedValue(cards);

    const { result } = await renderHook(() => useTrending(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(cards);
  });

  test("surfaces a fetch failure as an error state, not a thrown exception", async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error("network down"));

    const { result } = await renderHook(() => useTrending(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
