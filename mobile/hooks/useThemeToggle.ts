import { useColorScheme } from "nativewind";
import { setStoredThemePreference } from "../lib/themePreference";

// The Profile screen's Dark/Light settings row (design.md §6.9): flips
// NativeWind's own color scheme (what every dark: className and useTheme
// actually read) and persists the choice so app/_layout.tsx can restore
// it on the next launch instead of falling back to the OS scheme.
export function useThemeToggle() {
  const { colorScheme, setColorScheme } = useColorScheme();

  const toggle = () => {
    const next = colorScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
    setStoredThemePreference(next);
  };

  return { colorScheme, toggle };
}
