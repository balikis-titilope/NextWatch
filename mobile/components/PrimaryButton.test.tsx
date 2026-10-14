import { render, screen, userEvent } from "@testing-library/react-native";
import { PrimaryButton } from "./PrimaryButton";

describe("PrimaryButton", () => {
  test("renders the label as its accessible name", async () => {
    await render(<PrimaryButton label="Continue" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Continue" })).toBeOnTheScreen();
  });

  test("calls onPress once per tap when enabled", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<PrimaryButton label="Continue" onPress={onPress} />);

    await user.press(screen.getByRole("button", { name: "Continue" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("disabled: is marked disabled and does not fire onPress when tapped", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<PrimaryButton label="Continue" onPress={onPress} disabled />);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();

    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
  });

  test("loading: is disabled and busy, and hides the label as visible text", async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await render(<PrimaryButton label="Continue" onPress={onPress} loading />);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    expect(screen.queryByText("Continue")).not.toBeOnTheScreen();

    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
  });
});
