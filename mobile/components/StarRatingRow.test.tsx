import { render, screen, userEvent } from "@testing-library/react-native";
import { StarRatingRow } from "./StarRatingRow";

// @expo/vector-icons pulls in expo-font -> expo-asset, which is nested under
// node_modules/expo/node_modules rather than hoisted to the top level; Metro
// resolves it fine at runtime (confirmed live via /check verify) but Jest's
// stricter resolution can't find it. Neither test here asserts on the icon's
// own render, so stubbing it out avoids the module entirely.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

describe("StarRatingRow", () => {
  describe("read only (no onRate)", () => {
    test("exposes one accessibility value summarizing the rating", async () => {
      await render(<StarRatingRow rating={4} />);

      expect(screen.getByLabelText("Rated 4 out of 5 stars")).toBeOnTheScreen();
    });

    test("exposes no button roles", async () => {
      await render(<StarRatingRow rating={4} />);

      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    test("summarizes a zero rating correctly", async () => {
      await render(<StarRatingRow rating={0} />);

      expect(screen.getByLabelText("Rated 0 out of 5 stars")).toBeOnTheScreen();
    });
  });

  describe("interactive (onRate given)", () => {
    test("renders five star buttons labelled Rate 1 through Rate 5 stars", async () => {
      await render(<StarRatingRow rating={3} onRate={jest.fn()} />);

      expect(screen.getByRole("button", { name: "Rate 1 star" })).toBeOnTheScreen();
      for (let value = 2; value <= 5; value++) {
        expect(screen.getByRole("button", { name: `Rate ${value} stars` })).toBeOnTheScreen();
      }
    });

    test("tapping a star immediately fires onRate with that star's value", async () => {
      const onRate = jest.fn();
      const user = userEvent.setup();
      await render(<StarRatingRow rating={2} onRate={onRate} />);

      await user.press(screen.getByRole("button", { name: "Rate 5 stars" }));

      expect(onRate).toHaveBeenCalledTimes(1);
      expect(onRate).toHaveBeenCalledWith(5);
    });

    test("does not expose a read-only summary label", async () => {
      await render(<StarRatingRow rating={3} onRate={jest.fn()} />);

      expect(screen.queryByLabelText(/^Rated /)).not.toBeOnTheScreen();
    });

    test("supports the sm size at the same interaction contract as md", async () => {
      const onRate = jest.fn();
      const user = userEvent.setup();
      await render(<StarRatingRow rating={1} onRate={onRate} size="sm" />);

      await user.press(screen.getByRole("button", { name: "Rate 2 stars" }));

      expect(onRate).toHaveBeenCalledWith(2);
    });
  });

  describe("rating label", () => {
    test("is hidden unless showLabel is set", async () => {
      await render(<StarRatingRow rating={5} onRate={jest.fn()} />);

      expect(screen.queryByText("Loved it")).not.toBeOnTheScreen();
    });

    test("names the current rating when showLabel is set", async () => {
      await render(<StarRatingRow rating={3} onRate={jest.fn()} showLabel />);

      expect(screen.getByText("It was okay")).toBeOnTheScreen();
    });

    test("shows nothing before a rating is given", async () => {
      await render(<StarRatingRow rating={0} onRate={jest.fn()} showLabel />);

      expect(screen.queryByText("Loved it")).not.toBeOnTheScreen();
      expect(screen.queryByText("It was okay")).not.toBeOnTheScreen();
    });
  });
});
