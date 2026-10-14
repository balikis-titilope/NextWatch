import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../hooks/useTheme";
import { useUnreadNotificationCount } from "../hooks/useNotifications";

// spec 0006 AC-10: real unread count, hidden at 0, capped display at
// "99+"; refetch-on-foreground comes from lib/queryClient.ts's focusManager
// wiring plus this query's own refetchOnWindowFocus.
export function NotificationBell() {
  const theme = useTheme();
  const unread = useUnreadNotificationCount();
  const count = unread.data?.count ?? 0;

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      hitSlop={8}
      className="relative"
    >
      <Ionicons name="notifications-outline" size={24} color={theme["text-primary"]} />
      {count > 0 ? (
        <View
          style={{ position: "absolute", top: -4, right: -6 }}
          className="min-w-[18px] items-center justify-center rounded-full bg-error px-1"
        >
          <Text className="font-label text-caption text-white">{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
