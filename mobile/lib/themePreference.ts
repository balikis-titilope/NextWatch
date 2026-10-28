import AsyncStorage from "@react-native-async-storage/async-storage";

// Theme preference is a preference, not a credential (AGENTS.md §8/§12),
// so it goes in AsyncStorage, not expo-secure-store -- the opposite split
// from lib/tokens.ts.
const THEME_PREFERENCE_KEY = "nextwatch_theme_preference";

export type ThemePreference = "dark" | "light";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light";
}

// Absent (first launch, or before this feature existed) means "follow the
// OS scheme" -- null, not a default, so the caller can leave NativeWind's
// own "system" mode alone rather than forcing an override.
export async function getStoredThemePreference(): Promise<ThemePreference | null> {
  const value = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
  return isThemePreference(value) ? value : null;
}

export function setStoredThemePreference(preference: ThemePreference): Promise<void> {
  return AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
}
