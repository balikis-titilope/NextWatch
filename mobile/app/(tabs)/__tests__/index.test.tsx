import { render, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import { useBrowseMovies } from "../../../hooks/useBrowseMovies";
import { useMyRatings } from "../../../hooks/useMyRatings";
import { useUnreadNotificationCount } from "../../../hooks/useNotifications";
import { useRecommendations } from "../../../hooks/useRecommendations";
import { useSimilarRows } from "../../../hooks/useSimilarRows";
import { useTrending } from "../../../hooks/useTrending";
import HomeScreen from "../index";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
// lib/api.ts reads EXPO_PUBLIC_API_BASE_URL via expo-constants at import
// time and throws if unset (see lib/api.config-guard.test.ts) -- this
// screen only needs apiErrorMessage from that module, never a real fetch.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));
jest.mock("../../../hooks/useRecommendations", () => ({ useRecommendations: jest.fn() }));
jest.mock("../../../hooks/useBrowseMovies", () => ({ useBrowseMovies: jest.fn() }));
jest.mock("../../../hooks/useTrending", () => ({ useTrending: jest.fn() }));
jest.mock("../../../hooks/useMyRatings", () => ({ useMyRatings: jest.fn() }));
jest.mock("../../../hooks/useSimilarRows", () => ({ useSimilarRows: jest.fn() }));
// spec 0006: the Home header's NotificationBell calls this real TanStack
// Query hook -- mocked here like every other server-state hook this
// screen uses, so rendering it doesn't need a real QueryClientProvider.
jest.mock("../../../hooks/useNotifications", () => ({ useUnreadNotificationCount: jest.fn() }));

const CARD = {
  id: 1,
  media_type: "movie" as const,
  title: "Arrival",
  release_date: "2016-11-11",
  poster_path: "/arrival.jpg",
  predicted_score: 82,
};

function mockQuery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

describe("HomeScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useBrowseMovies as jest.Mock).mockReturnValue(mockQuery({ data: [] }));
    (useSimilarRows as jest.Mock).mockReturnValue([[]]);
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [] }));
    (useUnreadNotificationCount as jest.Mock).mockReturnValue(mockQuery({ data: { count: 0 } }));
  });

  test("cold start: recommendations resolve empty shows the rate-a-few-movies prompt, not a For You row (AC-3)", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [CARD], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("Rate a few movies to get your For You picks")).toBeOnTheScreen();
    expect(screen.queryByText("For You")).not.toBeOnTheScreen();
  });

  test("cold start still renders Top Rated Picks (AC-4)", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [CARD], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("Top Rated Picks")).toBeOnTheScreen();
  });

  test("with a usable taste signal: renders the For You row (AC-1/AC-2)", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [CARD], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("For You")).toBeOnTheScreen();
    expect(screen.queryByText("Rate a few movies to get your For You picks")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Arrival" })).toBeOnTheScreen();
  });

  test("tapping a card navigates to that title's detail screen", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [CARD], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    const user = userEvent.setup();

    await render(<HomeScreen />);

    await user.press(screen.getByRole("button", { name: "Arrival" }));

    expect(router.push).toHaveBeenCalledWith("/movie/movie/1");
  });

  test("shows the welcome banner", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("Welcome back.")).toBeOnTheScreen();
  });

  test("Trending toggle filters the row by media type", async () => {
    const SHOW = { ...CARD, id: 2, media_type: "tv" as const, title: "Severance" };
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [CARD, SHOW], isSuccess: true }));
    const user = userEvent.setup();

    await render(<HomeScreen />);

    expect(screen.getByText("Arrival")).toBeOnTheScreen();
    expect(screen.getByText("Severance")).toBeOnTheScreen();

    // Trending's toggle is the first "TV" button on the page.
    await user.press(screen.getAllByRole("button", { name: "TV" })[0]);

    expect(screen.queryByText("Arrival")).not.toBeOnTheScreen();
    expect(screen.getByText("Severance")).toBeOnTheScreen();
  });

  test("Popular Picks toggle re-queries browse with the chosen media type", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    const user = userEvent.setup();

    await render(<HomeScreen />);

    expect(screen.getByText("Popular Picks")).toBeOnTheScreen();
    expect(useBrowseMovies).toHaveBeenLastCalledWith({ mediaType: "movie", personalized: true });

    // Both rows render a "TV" toggle; the Popular Picks one is last.
    const tvButtons = screen.getAllByRole("button", { name: "TV" });
    await user.press(tvButtons[tvButtons.length - 1]);

    expect(useBrowseMovies).toHaveBeenLastCalledWith({ mediaType: "tv", personalized: true });
  });

  test("rows skip titles that never finished loading (blank title or no poster)", async () => {
    const BLANK = { ...CARD, id: 7, title: "," };
    const NO_POSTER = { ...CARD, id: 8, title: "Posterless", poster_path: null };
    (useRecommendations as jest.Mock).mockReturnValue(
      mockQuery({ data: [CARD, BLANK, NO_POSTER], isSuccess: true }),
    );
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("Arrival")).toBeOnTheScreen();
    expect(screen.queryByText(",")).not.toBeOnTheScreen();
    expect(screen.queryByText("Posterless")).not.toBeOnTheScreen();
  });

  test("shows an error message when recommendations fail to load", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(
      mockQuery({ isError: true, error: new Error("network down") }),
    );
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));

    await render(<HomeScreen />);

    expect(screen.getByText("Couldn't load your recommendations.")).toBeOnTheScreen();
  });

  test("Because you liked rows: newest 5-stars first, then 4-stars, up to 3", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useMyRatings as jest.Mock).mockReturnValue(
      mockQuery({
        isSuccess: true,
        data: [
          { movie_id: 5, media_type: "movie", title: "Newest Four", rating: 4 },
          { movie_id: 4, media_type: "movie", title: "Fourth", rating: 5 },
          { movie_id: 3, media_type: "movie", title: "Neutral Pick", rating: 3 },
          { movie_id: 2, media_type: "movie", title: "Second", rating: 5 },
          { movie_id: 1, media_type: "movie", title: "First", rating: 5 },
        ],
      }),
    );
    (useSimilarRows as jest.Mock).mockReturnValue([
      [{ ...CARD, id: 10, title: "Sim A" }],
      [{ ...CARD, id: 11, title: "Sim B" }],
      [{ ...CARD, id: 12, title: "Sim C" }],
    ]);

    await render(<HomeScreen />);

    // 5-stars win over the more recent 4-star; the 4-star would be 4th, past
    // the cap of 3, and the 3-star never qualifies.
    expect(screen.getByText("Because you liked Fourth")).toBeOnTheScreen();
    expect(screen.getByText("Because you liked Second")).toBeOnTheScreen();
    expect(screen.getByText("Because you liked First")).toBeOnTheScreen();
    expect(screen.queryByText("Because you liked Newest Four")).not.toBeOnTheScreen();
    expect(screen.queryByText("Because you liked Neutral Pick")).not.toBeOnTheScreen();
  });

  test("a title already in For You or rated is left out of the Because rows", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [CARD], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useMyRatings as jest.Mock).mockReturnValue(
      mockQuery({
        isSuccess: true,
        data: [{ movie_id: 20, media_type: "movie", title: "Seed", rating: 5 }],
      }),
    );
    (useSimilarRows as jest.Mock).mockReturnValue([
      [CARD, { ...CARD, id: 21, title: "Fresh Pick" }, { ...CARD, id: 20, title: "Seed" }],
    ]);

    await render(<HomeScreen />);

    expect(screen.getByText("Fresh Pick")).toBeOnTheScreen();
    // "Arrival" (CARD) is in For You only; the seed itself is not a result.
    expect(screen.getAllByText("Arrival")).toHaveLength(1);
  });

  test("no Because you liked row when its similar-movies call resolves empty", async () => {
    (useRecommendations as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useTrending as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useMyRatings as jest.Mock).mockReturnValue(
      mockQuery({
        isSuccess: true,
        data: [{ movie_id: 1, media_type: "movie", title: "First", rating: 5 }],
      }),
    );
    (useSimilarRows as jest.Mock).mockReturnValue([[]]);

    await render(<HomeScreen />);

    expect(screen.queryByText("Because you liked First")).not.toBeOnTheScreen();
  });
});
