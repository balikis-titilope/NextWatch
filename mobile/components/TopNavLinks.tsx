import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";

const LINKS = [
  { label: "Home", path: "/" },
  { label: "Search", path: "/search" },
  { label: "Mood", path: "/mood" },
  { label: "Ratings", path: "/ratings" },
  { label: "Profile", path: "/profile" },
] as const;

// The tab destinations as text links in the header, for wide windows where
// a bottom dock would sit far from the content (the tab bar is hidden there).
export function TopNavLinks({ onImage }: { onImage: boolean }) {
  const pathname = usePathname();

  return (
    <View className="flex-row items-center gap-6">
      {LINKS.map(({ label, path }) => {
        const active = pathname === path;
        const color = onImage
          ? active
            ? "text-white"
            : "text-white/70"
          : active
            ? "text-accent-primary"
            : "text-text-secondary";
        return (
          <Pressable
            key={path}
            onPress={() => router.navigate(path)}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
          >
            <Text className={`font-label text-body-md ${color}`}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
