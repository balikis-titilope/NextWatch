import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Children, type ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DESKTOP_BREAKPOINT,
  PAGE_MAX_WIDTH,
  PRIVACY_POLICY_URL,
  SCREEN_HORIZONTAL_PADDING,
  TERMS_URL,
} from "../../constants/config";
import { useMe } from "../../hooks/useMe";
import { useMyRatings } from "../../hooks/useMyRatings";
import { useUpdateNotificationPrefs } from "../../hooks/useNotifications";
import { usePageGutter } from "../../hooks/usePageGutter";
import { useSectionGap } from "../../hooks/useSectionGap";
import { useTheme } from "../../hooks/useTheme";
import { useThemeToggle } from "../../hooks/useThemeToggle";
import { useSessionStore } from "../../store/sessionStore";

// react-native-web draws an "on" switch thumb in teal unless told otherwise;
// native ignores the prop.
const WEB_SWITCH_THUMB = { activeThumbColor: "#FFFFFF" } as object;

// A titled group of rows in one rounded card, with a hairline between rows.
function Section({
  title,
  children,
  danger,
}: {
  title: string;
  children: ReactNode;
  // A risky area: red-tinted border and heading.
  danger?: boolean;
}) {
  const rows = Children.toArray(children);
  return (
    <View className="gap-2">
      <Text
        className={`px-1 font-label text-caption uppercase tracking-widest ${
          danger ? "text-error" : "text-text-secondary"
        }`}
      >
        {title}
      </Text>
      <View
        className={`overflow-hidden rounded-2xl border bg-bg-secondary ${
          danger ? "border-error/40" : "border-bg-tertiary"
        }`}
      >
        {rows.map((row, index) => (
          <View key={index} className={index > 0 ? "border-t border-bg-tertiary" : ""}>
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

// One settings row: icon, label with an optional line under it, and either a
// trailing control (a switch) or a chevron when the whole row is tappable.
function Row({
  icon,
  label,
  description,
  onPress,
  right,
  destructive,
  external,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  external?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? theme.error : theme["text-secondary"];
  const content = (
    <View className="min-h-[56px] flex-row items-center gap-4 px-4 py-3">
      <View style={{ width: 24 }} className="items-center">
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View className="flex-1">
        <Text
          className={`font-body-md text-body-md ${destructive ? "text-error" : "text-text-primary"}`}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={{ color: `${theme["text-primary"]}B3` }}
            className="font-body-sm text-body-sm"
          >
            {description}
          </Text>
        ) : null}
      </View>
      {right ??
        (onPress ? (
          <Ionicons
            name={external ? "open-outline" : "chevron-forward"}
            size={18}
            color={theme["text-secondary"]}
          />
        ) : null)}
    </View>
  );

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={label}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 py-1">
      <Text className="font-display-md text-display-md text-text-primary">{value}</Text>
      <Text className="font-caption text-caption text-text-secondary">{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const sectionGap = useSectionGap();
  const gutter = usePageGutter();
  const { width } = useWindowDimensions();
  const me = useMe();
  const myRatings = useMyRatings();
  const updatePrefs = useUpdateNotificationPrefs();
  const { colorScheme, toggle: toggleTheme } = useThemeToggle();
  const clearSession = useSessionStore((state) => state.clearSession);

  const email = me.data?.email ?? "";
  const ratings = myRatings.data ?? [];
  const loved = ratings.filter((entry) => entry.rating >= 4).length;
  const average =
    ratings.length > 0
      ? (ratings.reduce((sum, entry) => sum + entry.rating, 0) / ratings.length).toFixed(1)
      : "—";
  const twoColumns = width >= DESKTOP_BREAKPOINT;
  const switchColors = {
    trackColor: { false: theme["bg-tertiary"], true: theme["accent-primary"] },
    thumbColor: "#FFFFFF",
  } as const;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: PAGE_MAX_WIDTH,
          alignSelf: "center",
          paddingHorizontal: gutter + SCREEN_HORIZONTAL_PADDING,
          paddingBottom: 40,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="pt-6 font-display-lg text-display-lg text-text-primary">Profile</Text>

        <View
          style={{ marginTop: sectionGap / 2, gap: 24 }}
          className={twoColumns ? "flex-row items-start" : ""}
        >
          {/* Who you are, and what you've rated. */}
          <View
            style={twoColumns ? { width: 360 } : undefined}
            className="gap-4 rounded-2xl border border-bg-tertiary bg-bg-secondary p-6"
          >
            <View className="flex-row items-center gap-4">
              <View
                style={{
                  backgroundColor: theme["accent-primary"],
                  width: 56,
                  height: 56,
                  flexShrink: 0,
                }}
                className="items-center justify-center rounded-full"
              >
                {email ? (
                  <Text className="font-display-lg text-display-lg text-white">
                    {email.charAt(0).toUpperCase()}
                  </Text>
                ) : (
                  <ActivityIndicator size="small" color="white" />
                )}
              </View>
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="font-body-lg text-body-lg text-text-primary"
                  accessibilityLabel="Signed in as"
                >
                  {email || "—"}
                </Text>
                <Text className="font-body-sm text-body-sm text-text-secondary">
                  Your taste profile grows with every rating.
                </Text>
              </View>
            </View>

            <View className="flex-row rounded-xl bg-bg-primary py-2">
              <Stat value={String(ratings.length)} label="Rated" />
              <Stat value={String(loved)} label="Loved (4–5★)" />
              <Stat value={average} label="Avg rating" />
            </View>

            <Pressable
              onPress={() => router.navigate("/ratings")}
              accessibilityRole="button"
              accessibilityLabel="Rate more titles"
              style={{ height: 44, flexShrink: 0 }}
              className="flex-row items-center justify-center gap-2 rounded-lg bg-accent-primary"
            >
              <Ionicons name="star-outline" size={18} color="white" />
              <Text className="font-label text-label text-white">Rate more titles</Text>
            </Pressable>
          </View>

          {/* Settings. */}
          <View style={twoColumns ? { flex: 1 } : undefined} className="gap-6">
            <Section title="Preferences">
              <Row
                icon="moon-outline"
                label="Dark mode"
                right={
                  <Switch
                    value={colorScheme === "dark"}
                    onValueChange={toggleTheme}
                    accessibilityLabel="Toggle dark mode"
                    {...switchColors}
                    {...WEB_SWITCH_THUMB}
                  />
                }
              />
              {/* spec 0006 AC-11: both default to on; PATCH /me/notification-prefs
                  merges just the changed key */}
              <Row
                icon="sparkles-outline"
                label="New recommendations"
                description="Tell me when fresh picks are ready."
                right={
                  <Switch
                    value={me.data?.notification_prefs.recommendations_ready ?? true}
                    onValueChange={(value) => updatePrefs.mutate({ recommendations_ready: value })}
                    accessibilityLabel="Toggle new recommendation notifications"
                    {...switchColors}
                    {...WEB_SWITCH_THUMB}
                  />
                }
              />
              <Row
                icon="notifications-outline"
                label="Re-engagement nudges"
                description="A gentle reminder if I've been away."
                right={
                  <Switch
                    value={me.data?.notification_prefs.re_engagement ?? true}
                    onValueChange={(value) => updatePrefs.mutate({ re_engagement: value })}
                    accessibilityLabel="Toggle re-engagement notifications"
                    {...switchColors}
                    {...WEB_SWITCH_THUMB}
                  />
                }
              />
            </Section>

            {/* spec 0009 AC-3/AC-4: permanent entries, reachable any time the account
                is active; opened in the system browser via Linking, same as signup's
                consent line. */}
            <Section title="About">
              <Row
                icon="shield-checkmark-outline"
                label="Privacy Policy"
                external
                onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
              />
              <Row
                icon="document-text-outline"
                label="Terms of Service"
                external
                onPress={() => Linking.openURL(TERMS_URL)}
              />
            </Section>

            <Section title="Account">
              <Row icon="log-out-outline" label="Sign out" onPress={() => clearSession()} />
            </Section>

            {/* spec 0009 AC-1: a separate action from Sign Out -- routes to its own
                confirm screen (password + typed DELETE) before anything happens.
                Kept apart from the everyday rows because it cannot be undone. */}
            <View style={{ marginTop: 8 }}>
              <Section title="Danger zone" danger>
                <Row
                  icon="trash-outline"
                  label="Delete account"
                  description="Permanently removes your account and ratings."
                  destructive
                  onPress={() => router.push("/delete-account")}
                />
              </Section>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
