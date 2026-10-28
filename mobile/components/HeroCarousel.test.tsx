import { act, render, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import { HeroCarousel } from "./HeroCarousel";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const slide = (id: number, title: string, media_type: "movie" | "tv" = "movie") => ({
  id,
  media_type,
  title,
  release_date: "2020-01-01",
  poster_path: null,
  predicted_score: null,
  backdrop_path: `/b${id}.jpg`,
});
const SLIDES = [slide(1, "Arrival"), slide(2, "Severance", "tv"), slide(3, "Dune")];

describe("HeroCarousel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  test("shows the welcome text, the first title and the arrows", async () => {
    await render(<HeroCarousel slides={SLIDES} />);

    expect(screen.getByText("Welcome back.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Arrival" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Next title" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Previous title" })).toBeOnTheScreen();
  });

  test("the arrows move through titles and wrap around", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<HeroCarousel slides={SLIDES} />);

    await user.press(screen.getByRole("button", { name: "Next title" }));
    expect(screen.getByRole("button", { name: "Severance" })).toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "Previous title" }));
    await user.press(screen.getByRole("button", { name: "Previous title" }));
    expect(screen.getByRole("button", { name: "Dune" })).toBeOnTheScreen();
  });

  test("advances on its own every 6 seconds", async () => {
    await render(<HeroCarousel slides={SLIDES} />);

    await act(async () => {
      jest.advanceTimersByTime(6000);
    });

    expect(screen.getByRole("button", { name: "Severance" })).toBeOnTheScreen();
  });

  test("tapping the title opens that title's detail screen", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<HeroCarousel slides={SLIDES} />);

    await user.press(screen.getByRole("button", { name: "Next title" }));
    await user.press(screen.getByRole("button", { name: "Severance" }));

    expect(router.push).toHaveBeenCalledWith("/movie/tv/2");
  });

  test("no slides: plain banner, no title and no arrows", async () => {
    await render(<HeroCarousel slides={[]} />);

    expect(screen.getByText("Welcome back.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Next title" })).not.toBeOnTheScreen();
  });

  test("one slide: shows its title but no arrows", async () => {
    await render(<HeroCarousel slides={[SLIDES[0]]} />);

    expect(screen.getByRole("button", { name: "Arrival" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Next title" })).not.toBeOnTheScreen();
  });
});
