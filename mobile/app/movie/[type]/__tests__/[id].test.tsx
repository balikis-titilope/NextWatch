import { render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMovieDetail } from "../../../../hooks/useMovieDetail";
import { useRateMovie } from "../../../../hooks/useRateMovie";
import { useSimilarMovies } from "../../../../hooks/useSimilarMovies";
import MovieDetailScreen from "../[id]";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock("../../../../hooks/useMovieDetail", () => ({ useMovieDetail: jest.fn() }));
jest.mock("../../../../hooks/useRateMovie", () => ({ useRateMovie: jest.fn() }));
jest.mock("../../../../hooks/useSimilarMovies", () => ({ useSimilarMovies: jest.fn() }));
// lib/api.ts reads EXPO_PUBLIC_API_BASE_URL via expo-constants at import
// time and throws if unset (see lib/api.config-guard.test.ts) -- this
// screen only needs apiErrorMessage from that module, never a real fetch.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));

const FULL_MOVIE_DETAIL = {
  id: 157336,
  media_type: "movie" as const,
  title: "Interstellar",
  tagline: "Mankind was born on Earth. It was never meant to die here.",
  overview: "A team of explorers travel through a wormhole in space.",
  genres: ["Adventure", "Drama", "Science Fiction"],
  release_date: "2014-11-05",
  runtime: 169,
  status: null,
  number_of_seasons: null,
  number_of_episodes: null,
  episode_runtime: null,
  original_language: "en",
  poster_path: "/p.jpg",
  backdrop_path: "/b.jpg",
  predicted_score: 82,
  cast: [{ name: "Matthew McConaughey", profile_path: "/mm.jpg" }],
  director: ["Christopher Nolan"],
  trailer_key: "zSWdZVtXT7E",
  watch_providers: {
    stream: [{ name: "Netflix", logo_path: "/netflix.jpg" }],
    rent: [],
    buy: [],
  },
  user_rating: null,
};

const FULL_TV_DETAIL = {
  ...FULL_MOVIE_DETAIL,
  id: 71446,
  media_type: "tv" as const,
  title: "Moon Lovers: Scarlet Heart Ryeo",
  release_date: "2016-08-29",
  runtime: null,
  status: "Ended",
  number_of_seasons: 1,
  number_of_episodes: 20,
  episode_runtime: 60,
  director: ["Kim Kyu-tae"],
};

function mockDetailQuery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

describe("MovieDetailScreen", () => {
  const mutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ type: "movie", id: "157336" });
    (useRateMovie as jest.Mock).mockReturnValue({ mutate });
    (useSimilarMovies as jest.Mock).mockReturnValue(mockDetailQuery({ data: [] }));
  });

  test("shows a loading skeleton while the detail request is in flight", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ isLoading: true }));

    await render(<MovieDetailScreen />);

    expect(screen.queryByText("Interstellar")).not.toBeOnTheScreen();
  });

  test("shows an error state with a retry action on failure (e.g. AC-10's 502)", async () => {
    const refetch = jest.fn();
    (useMovieDetail as jest.Mock).mockReturnValue(
      mockDetailQuery({ isError: true, error: new Error("Could not reach TMDB"), refetch }),
    );

    const user = userEvent.setup();
    await render(<MovieDetailScreen />);

    await user.press(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  test("renders the full detail set: title, genres, cast, overview (AC-5)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));

    await render(<MovieDetailScreen />);

    expect(screen.getByText("Interstellar")).toBeOnTheScreen();
    expect(screen.getByText("Adventure")).toBeOnTheScreen();
    expect(screen.getByText("Matthew McConaughey")).toBeOnTheScreen();
    expect(
      screen.getByText("A team of explorers travel through a wormhole in space."),
    ).toBeOnTheScreen();
  });

  test("shows the Watch Trailer button when a trailer_key is present, and opens the right URL (AC-8)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));
    const openURLSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const user = userEvent.setup();

    await render(<MovieDetailScreen />);

    await user.press(screen.getByRole("button", { name: "▶  Watch Trailer" }));

    expect(openURLSpy).toHaveBeenCalledWith("https://www.youtube.com/watch?v=zSWdZVtXT7E");
  });

  test("hides the Watch Trailer button entirely when trailer_key is null (AC-8)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(
      mockDetailQuery({ data: { ...FULL_MOVIE_DETAIL, trailer_key: null } }),
    );

    await render(<MovieDetailScreen />);

    expect(screen.queryByRole("button", { name: "▶  Watch Trailer" })).not.toBeOnTheScreen();
  });

  test("rating a star calls the mutation with this movie's id, media_type, and the tapped value (AC-6)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));
    const user = userEvent.setup();

    await render(<MovieDetailScreen />);

    await user.press(screen.getByRole("button", { name: "Rate 4 stars" }));

    expect(mutate).toHaveBeenCalledWith({ movie_id: 157336, media_type: "movie", rating: 4 });
  });

  test("pre-fills the star row from the existing user_rating (AC-6)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(
      mockDetailQuery({ data: { ...FULL_MOVIE_DETAIL, user_rating: 4 } }),
    );

    await render(<MovieDetailScreen />);

    expect(screen.getByLabelText("Rate 4 stars")).toBeOnTheScreen();
    expect(screen.getByLabelText("Rate 5 stars")).toBeOnTheScreen();
  });

  test("Where to Watch shows only the non-empty tabs (stream present, rent/buy empty)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));

    await render(<MovieDetailScreen />);

    expect(screen.getByText("Where to Watch")).toBeOnTheScreen();
    expect(screen.getByText("Stream")).toBeOnTheScreen();
    expect(screen.queryByText("Rent")).not.toBeOnTheScreen();
    expect(screen.queryByText("Buy")).not.toBeOnTheScreen();
    expect(screen.getByText("Netflix")).toBeOnTheScreen();
  });

  test("Where to Watch section is omitted entirely when no providers exist in any category (AC-7 fallback)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(
      mockDetailQuery({
        data: { ...FULL_MOVIE_DETAIL, watch_providers: { stream: [], rent: [], buy: [] } },
      }),
    );

    await render(<MovieDetailScreen />);

    expect(screen.queryByText("Where to Watch")).not.toBeOnTheScreen();
  });

  test("renders a Similar row when the similar route resolves results (AC-13)", async () => {
    (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));
    (useSimilarMovies as jest.Mock).mockReturnValue(
      mockDetailQuery({
        data: [
          {
            id: 19995,
            media_type: "movie",
            title: "Avatar",
            release_date: "2009-12-16",
            poster_path: "/a.jpg",
            predicted_score: 49,
          },
        ],
      }),
    );

    await render(<MovieDetailScreen />);

    expect(screen.getByText("Similar")).toBeOnTheScreen();
  });

  // Spec 0010 AC-4: TV-appropriate fields render for a TV show.
  describe("TV show fields", () => {
    beforeEach(() => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({ type: "tv", id: "71446" });
    });

    test("renders season/episode counts, status, and creator instead of director", async () => {
      (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_TV_DETAIL }));

      await render(<MovieDetailScreen />);

      expect(screen.getByText("Moon Lovers: Scarlet Heart Ryeo")).toBeOnTheScreen();
      expect(screen.getByText("Ended")).toBeOnTheScreen();
      expect(screen.getByText(/1 Season, 20 Episodes/)).toBeOnTheScreen();
      expect(screen.getByText("Creator: Kim Kyu-tae")).toBeOnTheScreen();
    });

    test("uses episode_runtime, not the null movie runtime field, in the info line", async () => {
      (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_TV_DETAIL }));

      await render(<MovieDetailScreen />);

      expect(screen.getByText(/1h 0m/)).toBeOnTheScreen();
    });

    test("rating a TV show sends media_type tv", async () => {
      (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_TV_DETAIL }));
      const user = userEvent.setup();

      await render(<MovieDetailScreen />);

      await user.press(screen.getByRole("button", { name: "Rate 4 stars" }));

      expect(mutate).toHaveBeenCalledWith({ movie_id: 71446, media_type: "tv", rating: 4 });
    });

    test("is unchanged for a movie: no status chip, Director label not Creator", async () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({ type: "movie", id: "157336" });
      (useMovieDetail as jest.Mock).mockReturnValue(mockDetailQuery({ data: FULL_MOVIE_DETAIL }));

      await render(<MovieDetailScreen />);

      expect(screen.getByText("Director: Christopher Nolan")).toBeOnTheScreen();
      expect(screen.queryByText(/Creator:/)).not.toBeOnTheScreen();
    });
  });
});
