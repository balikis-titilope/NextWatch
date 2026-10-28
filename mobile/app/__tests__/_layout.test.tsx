import { render, waitFor } from "@testing-library/react-native";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { resolveLaunchRoute } from "../../lib/launchRouting";
import { useSessionStore } from "../../store/sessionStore";
import RootLayout from "../_layout";

jest.mock("../../global.css", () => ({}));

// Jest does not load tailwind.config.js, so NativeWind's real setColorScheme
// throws (it needs darkMode: "class"). The layout sets the dark default on launch.
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useColorScheme: () => ({ setColorScheme: jest.fn() }),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: "https://api.test" } },
  },
}));

jest.mock("expo-font", () => ({
  useFonts: jest.fn(),
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(),
  setOptions: jest.fn(),
  hideAsync: jest.fn(),
}));

const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => children;
  Stack.displayName = "Stack";
  const Screen = () => null;
  Screen.displayName = "Stack.Screen";
  Stack.Screen = Screen;
  return { Stack, router: { replace: (...args: unknown[]) => mockReplace(...args) } };
});

jest.mock("../../lib/launchRouting", () => ({
  resolveLaunchRoute: jest.fn(),
}));

describe("RootLayout", () => {
  beforeEach(() => {
    useSessionStore.setState({ userId: null, launchRoute: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("renders nothing while fonts are still loading", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([false]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(auth)/login");

    const { toJSON } = await render(<RootLayout />);

    expect(toJSON()).toBeNull();
  });

  test("does not hide the splash screen while fonts are still loading", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([false]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(auth)/login");

    await render(<RootLayout />);

    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  test("hides the native splash screen once fonts finish loading, even if the launch decision is still resolving", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([true]);
    (resolveLaunchRoute as jest.Mock).mockReturnValue(new Promise(() => {}));

    await render(<RootLayout />);

    // AnimatedSplashScreen (not RootStack) is what's shown next -- it can
    // animate on its own, so there's no need to wait behind the static
    // native splash for launchRoute too.
    await waitFor(() => expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1));
  });

  test("does not hide the native splash screen again once the launch decision also resolves", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([true]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(auth)/login");

    await render(<RootLayout />);
    await waitFor(() => expect(useSessionStore.getState().launchRoute).toBe("/(auth)/login"));

    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  test("renders the app content once fonts finish loading", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([true]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(auth)/login");

    const { toJSON } = await render(<RootLayout />);

    expect(toJSON()).not.toBeNull();
  });

  test("routes back to log in when the session clears after launch has already resolved", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([true]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(tabs)");

    await render(<RootLayout />);
    await waitFor(() => expect(useSessionStore.getState().launchRoute).toBe("/(tabs)"));

    useSessionStore.setState({ userId: "u1" });
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());

    useSessionStore.setState({ userId: null });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/login"));
  });

  test("does not redirect on the initial unauthenticated launch (never was authenticated)", async () => {
    (Font.useFonts as jest.Mock).mockReturnValue([true]);
    (resolveLaunchRoute as jest.Mock).mockResolvedValue("/(auth)/login");

    await render(<RootLayout />);
    await waitFor(() => expect(useSessionStore.getState().launchRoute).toBe("/(auth)/login"));

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
