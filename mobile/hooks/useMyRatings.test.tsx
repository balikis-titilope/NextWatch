import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";
import { useMyRatings } from "./useMyRatings";

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMyRatings", () => {
  beforeEach(() => {
    // The query is gated on a logged-in session (enabled: !!userId).
    useSessionStore.setState({ userId: "user-1" });
  });

  afterEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ userId: null });
  });

  test("GETs /me/ratings", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    await renderHook(() => useMyRatings(), { wrapper });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/me/ratings");
    });
  });

  test("resolves with the rating list in the order the backend returns it (most recent first)", async () => {
    const ratings = [
      { movie_id: 2, title: "Dune", rating: 5 },
      { movie_id: 1, title: "Arrival", rating: 4 },
    ];
    (apiFetch as jest.Mock).mockResolvedValue(ratings);

    const { result } = await renderHook(() => useMyRatings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ratings);
  });

  test("resolves with an empty list for a user with no ratings yet", async () => {
    (apiFetch as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => useMyRatings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
