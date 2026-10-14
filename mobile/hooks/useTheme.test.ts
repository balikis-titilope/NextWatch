import { renderHook } from "@testing-library/react-native";
import { useColorScheme } from "nativewind";
import { dark, light } from "../constants/colors.cjs";
import { useTheme } from "./useTheme";

// Mocked at the "nativewind" module level, not react-native's raw
// useColorScheme: useTheme reads NativeWind's own color scheme state so it
// also reflects a manual setColorScheme/toggleColorScheme override, which
// the raw OS-only hook never sees (see useTheme.ts).
jest.mock("nativewind", () => ({
  useColorScheme: jest.fn(),
}));

describe("useTheme", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns the dark palette when NativeWind's color scheme is dark", async () => {
    (useColorScheme as jest.Mock).mockReturnValue({ colorScheme: "dark" });

    const { result } = await renderHook(() => useTheme());

    expect(result.current).toBe(dark);
  });

  test("returns the light palette when NativeWind's color scheme is light", async () => {
    (useColorScheme as jest.Mock).mockReturnValue({ colorScheme: "light" });

    const { result } = await renderHook(() => useTheme());

    expect(result.current).toBe(light);
  });

  test("defaults to the light palette when the scheme is unknown", async () => {
    (useColorScheme as jest.Mock).mockReturnValue({ colorScheme: undefined });

    const { result } = await renderHook(() => useTheme());

    expect(result.current).toBe(light);
  });
});
