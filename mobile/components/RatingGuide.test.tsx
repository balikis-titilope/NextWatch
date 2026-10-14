import { render, screen, userEvent } from "@testing-library/react-native";
import { RatingGuide } from "./RatingGuide";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("RatingGuide", () => {
  test("spells out all five ratings, including that a 3 has no effect", async () => {
    await render(<RatingGuide />);

    for (const label of ["Loved it", "Liked it", "It was okay", "Didn't like it", "Hated it"]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.getByText("No effect on your picks")).toBeOnTheScreen();
  });

  test("collapsible: starts closed and opens on tap", async () => {
    const user = userEvent.setup();
    await render(<RatingGuide collapsible defaultOpen={false} />);

    expect(screen.queryByText("Loved it")).not.toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "How rating works" }));

    expect(screen.getByText("Loved it")).toBeOnTheScreen();
  });
});
