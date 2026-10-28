import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { Pressable, Text, View } from "react-native";
import { setStoredThemePreference } from "../../lib/themePreference";

// Flips between dark and light and remembers the choice, the same way the
// Profile toggle does (design.md section 6.9), so app/+html.tsx applies it
// before first paint on the next visit.
//
// Which icon shows is decided by CSS (the `dark` class on <html>), not by
// React state, so the static HTML and the hydrated page always agree.
export function ThemeToggle() {
  const { setColorScheme } = useColorScheme();

  const toggle = () => {
    const isDark = document.documentElement.classList.contains("dark");
    const next = isDark ? "light" : "dark";
    setColorScheme(next);
    void setStoredThemePreference(next);
  };

  return (
    <Pressable
      role="button"
      accessibilityLabel="Toggle light and dark mode"
      onPress={toggle}
      className="h-10 w-10 items-center justify-center rounded-full active:bg-bg-tertiary"
    >
      <View className="dark:hidden">
        <Text className="text-text-primary">
          <Ionicons name="moon-outline" size={20} />
        </Text>
      </View>
      <View className="hidden dark:flex">
        <Text className="text-text-primary">
          <Ionicons name="sunny-outline" size={20} />
        </Text>
      </View>
    </Pressable>
  );
}
