import { render, screen } from "@testing-library/react-native";
import ShowcaseScreen from "../showcase";

const mockRedirect = jest.fn((_props: { href: string }) => null);

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

// The gallery must never reach a release build (spec 0002 Follow-up): this
// pins down the __DEV__ guard directly, since nothing else exercises it.
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useColorScheme: () => ({ colorScheme: "light", toggleColorScheme: jest.fn() }),
}));

// @expo/vector-icons pulls in expo-font -> expo-asset, which is nested under
// node_modules/expo/node_modules rather than hoisted to the top level; Metro
// resolves it fine at runtime (confirmed live via /check verify) but Jest's
// stricter resolution can't find it. Neither test here asserts on any icon's
// own render, so stubbing it out avoids the module entirely.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

describe("ShowcaseScreen", () => {
  const devGlobal = globalThis as unknown as { __DEV__: boolean };
  const originalDev = devGlobal.__DEV__;

  afterEach(() => {
    devGlobal.__DEV__ = originalDev;
    jest.clearAllMocks();
  });

  test("redirects home instead of rendering when __DEV__ is false (kept out of release builds)", async () => {
    devGlobal.__DEV__ = false;

    await render(<ShowcaseScreen />);

    expect(mockRedirect).toHaveBeenCalledWith({ href: "/" });
    expect(screen.queryByText("Component gallery")).not.toBeOnTheScreen();
  });

  test("renders the full component gallery when __DEV__ is true", async () => {
    devGlobal.__DEV__ = true;

    await render(<ShowcaseScreen />);

    expect(screen.getByText("Component gallery")).toBeOnTheScreen();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
