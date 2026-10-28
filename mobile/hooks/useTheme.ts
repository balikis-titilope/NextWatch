import { useColorScheme } from "nativewind";
import { dark, light } from "../constants/colors.cjs";

// For NativeWind `className` styling, prefer the bg-*/text-*/etc. tokens
// registered in tailwind.config.js (they follow NativeWind's own dark:
// variant automatically). Reach for this hook only where a raw color value
// is required outside className (LinearGradient stops, StatusBar style).
//
// Reads NativeWind's own color scheme state (via its `useColorScheme`), not
// React Native's raw `useColorScheme` from "react-native": the raw hook only
// reflects the OS setting and never sees a manual override made through
// NativeWind's `setColorScheme`/`toggleColorScheme` (the mechanism a later
// user-facing toggle, e.g. Profile, will call).
export function useTheme() {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? dark : light;
}
