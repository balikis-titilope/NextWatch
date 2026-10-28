import { render, screen } from "@testing-library/react-native";
import { AnimatedSplashScreen } from "./AnimatedSplashScreen";

describe("AnimatedSplashScreen", () => {
  test("renders the NextWatch wordmark and tagline (design.md §6.1)", async () => {
    await render(<AnimatedSplashScreen />);

    expect(screen.getByText("Next")).toBeOnTheScreen();
    expect(screen.getByText("Watch")).toBeOnTheScreen();
    expect(screen.getByText("Your next favorite film is one tap away.")).toBeOnTheScreen();
  });
});
