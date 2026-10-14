import { render, screen, userEvent } from "@testing-library/react-native";
import { useDeleteRating } from "../../../hooks/useDeleteRating";
import { useMyRatings } from "../../../hooks/useMyRatings";
import { useRateMovie } from "../../../hooks/useRateMovie";
import RatingsScreen from "../ratings";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));
jest.mock("../../../hooks/useMyRatings", () => ({ useMyRatings: jest.fn() }));
jest.mock("../../../hooks/useRateMovie", () => ({ useRateMovie: jest.fn() }));
jest.mock("../../../hooks/useDeleteRating", () => ({ useDeleteRating: jest.fn() }));
// The section has its own search + mutation hooks; it is covered where it is defined.
jest.mock("../../../components/RateMoreSection", () => ({ RateMoreSection: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const RATING = {
  movie_id: 1,
  media_type: "movie" as const,
  title: "Arrival",
  release_date: "2016-11-11",
  poster_path: "/arrival.jpg",
  rating: 5,
  rated_at: "2026-01-01T00:00:00Z",
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

function mockMutation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: jest.fn(),
    ...overrides,
  };
}

describe("RatingsScreen delete flow (spec 0008)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRateMovie as jest.Mock).mockReturnValue(mockMutation());
  });

  test("each row shows a delete control (AC-1)", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [RATING], isSuccess: true }));
    (useDeleteRating as jest.Mock).mockReturnValue(mockMutation());

    await render(<RatingsScreen />);

    expect(
      screen.getByRole("button", { name: "Remove your rating for Arrival" }),
    ).toBeOnTheScreen();
  });

  test("tapping delete opens a confirm dialog naming the movie, without deleting yet (AC-2)", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [RATING], isSuccess: true }));
    const deleteMutation = mockMutation();
    (useDeleteRating as jest.Mock).mockReturnValue(deleteMutation);
    const user = userEvent.setup();

    await render(<RatingsScreen />);
    await user.press(screen.getByRole("button", { name: "Remove your rating for Arrival" }));

    expect(screen.getByText("Remove your rating for Arrival?")).toBeOnTheScreen();
    expect(deleteMutation.mutate).not.toHaveBeenCalled();
  });

  test("confirming calls the delete mutation with the movie id (AC-3)", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [RATING], isSuccess: true }));
    const deleteMutation = mockMutation();
    (useDeleteRating as jest.Mock).mockReturnValue(deleteMutation);
    const user = userEvent.setup();

    await render(<RatingsScreen />);
    await user.press(screen.getByRole("button", { name: "Remove your rating for Arrival" }));
    await user.press(screen.getByRole("button", { name: "Confirm remove rating" }));

    expect(deleteMutation.mutate).toHaveBeenCalledWith(
      { movie_id: 1, media_type: "movie" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  test("cancelling leaves the rating untouched", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [RATING], isSuccess: true }));
    const deleteMutation = mockMutation();
    (useDeleteRating as jest.Mock).mockReturnValue(deleteMutation);
    const user = userEvent.setup();

    await render(<RatingsScreen />);
    await user.press(screen.getByRole("button", { name: "Remove your rating for Arrival" }));
    await user.press(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteMutation.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText("Remove your rating for Arrival?")).not.toBeOnTheScreen();
    expect(screen.getByText("Arrival")).toBeOnTheScreen();
  });

  test("a failed delete shows an error and keeps the row (AC-6)", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [RATING], isSuccess: true }));
    (useDeleteRating as jest.Mock).mockReturnValue(
      mockMutation({ isError: true, error: new Error("Couldn't remove this rating. Try again.") }),
    );
    const user = userEvent.setup();

    await render(<RatingsScreen />);
    await user.press(screen.getByRole("button", { name: "Remove your rating for Arrival" }));

    expect(screen.getByText("Couldn't remove this rating. Try again.")).toBeOnTheScreen();
    expect(screen.getByText("Arrival")).toBeOnTheScreen();
  });

  test("deleting the last remaining rating shows the empty state with no count chip (AC-10)", async () => {
    (useMyRatings as jest.Mock).mockReturnValue(mockQuery({ data: [], isSuccess: true }));
    (useDeleteRating as jest.Mock).mockReturnValue(mockMutation());

    await render(<RatingsScreen />);

    expect(screen.getByText("Rate a few titles to see them here")).toBeOnTheScreen();
    expect(screen.queryByText("Titles")).not.toBeOnTheScreen();
    expect(screen.queryByText(/\d+ Titles/)).not.toBeOnTheScreen();
  });
});
