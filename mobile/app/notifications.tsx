import { Ionicons } from "@expo/vector-icons";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../components/PrimaryButton";
import { Skeleton } from "../components/Skeleton";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../hooks/useNotifications";
import { useTheme } from "../hooks/useTheme";
import { apiErrorMessage } from "../lib/api";
import type { Notification } from "../types/api";

const LIST_SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5"];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// A small, single-consumer relative-time helper (no shared formatter
// exists elsewhere in the app yet -- ratings.tsx's formatRatedDate is an
// absolute-date formatter, a different need).
function formatRelativeTime(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

function NotificationRow({ item, onPress }: { item: Notification; onPress: () => void }) {
  const isUnread = item.read_at === null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${isUnread ? ", unread" : ""}`}
      className="flex-row gap-3 rounded-lg bg-bg-secondary p-3"
    >
      <View className="w-2 items-center pt-1.5">
        {isUnread ? (
          <View style={{ width: 8, height: 8, borderRadius: 4 }} className="bg-accent-primary" />
        ) : null}
      </View>
      <View className="flex-1 gap-1">
        <Text className="font-label text-body-md text-text-primary">{item.title}</Text>
        <Text className="font-body-sm text-body-sm text-text-secondary">{item.body}</Text>
        <Text className="font-caption text-caption text-text-secondary">
          {formatRelativeTime(item.created_at)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const hasUnread = (notifications.data ?? []).some((item) => item.read_at === null);

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-bg-primary">
      {hasUnread ? (
        <View className="flex-row justify-end px-4 pt-4">
          <Pressable
            onPress={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
            hitSlop={8}
          >
            <Text className="font-label text-body-sm text-accent-primary">Mark all read</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-2 flex-1 px-4">
        {notifications.isLoading ? (
          <FlatList
            data={LIST_SKELETON_KEYS}
            keyExtractor={(key) => key}
            contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
            renderItem={() => (
              <View className="flex-row gap-3 rounded-lg bg-bg-secondary p-3">
                <View className="flex-1 gap-2">
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="90%" height={14} />
                  <Skeleton width="30%" height={12} />
                </View>
              </View>
            )}
          />
        ) : notifications.isError ? (
          <View className="flex-1 items-center justify-center gap-3">
            <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
            <Text className="text-center font-body-md text-body-md text-text-secondary">
              {apiErrorMessage(notifications.error, "Couldn't load your notifications. Try again.")}
            </Text>
            <PrimaryButton label="Retry" onPress={() => notifications.refetch()} />
          </View>
        ) : notifications.data && notifications.data.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-3">
            <Ionicons name="notifications-outline" size={64} color={theme["text-disabled"]} />
            <Text className="text-center font-body-lg text-body-lg text-text-primary">
              No notifications yet
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications.data ?? []}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
            renderItem={({ item }) => (
              <NotificationRow item={item} onPress={() => markRead.mutate(item.id)} />
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
