import { render, screen, userEvent } from "@testing-library/react-native";
import { Chip } from "./Chip";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("Chip", () => {
  test("renders the label as its accessible name", async () => {
    await render(<Chip label="Comedy" active={false} onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Comedy" })).toBeOnTheScreen();
  });

  test("inactive: is not marked selected", async () => {
    await render(<Chip label="Comedy" active={false} onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Comedy" })).not.toBeSelected();
  });

  test("active: is marked selected", async () => {
    await render(<Chip label="Comedy" active onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Comedy" })).toBeSelected();
  });

  test("calls onPress once per tap", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<Chip label="Comedy" active={false} onPress={onPress} />);

    await user.press(screen.getByRole("button", { name: "Comedy" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("an active chip with onClear has a clear button that does not trigger onPress", async () => {
    const onPress = jest.fn();
    const onClear = jest.fn();
    const user = userEvent.setup();
    await render(<Chip label="Action" active onPress={onPress} onClear={onClear} />);

    await user.press(screen.getByRole("button", { name: "Clear Action" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("an inactive chip never shows the clear button", async () => {
    await render(<Chip label="Action" active={false} onPress={jest.fn()} onClear={jest.fn()} />);

    expect(screen.queryByRole("button", { name: "Clear Action" })).not.toBeOnTheScreen();
  });
});
