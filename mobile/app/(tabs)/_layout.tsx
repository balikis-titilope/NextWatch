import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { NotificationBell } from "../../components/NotificationBell";
import { useWindowDimensions } from "react-native";
import { WIDE_BREAKPOINT } from "../../constants/config";
import { useTheme } from "../../hooks/useTheme";

export default function TabsLayout() {
  const theme = useTheme();
  // Wide windows navigate from the header (TopNavLinks); phones get the dock.
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;

  return (
    <Tabs
      screenOptions={{
        // Logo + wordmark at the top of every tab screen.
        header: () => <AppHeader />,
        tabBarActiveTintColor: theme["accent-primary"],
        tabBarInactiveTintColor: theme["text-secondary"],
        // A floating dock: inset from the edges, rounded, no top rule.
        tabBarStyle: {
          display: wide ? "none" : "flex",
          backgroundColor: theme["bg-tertiary"],
          marginHorizontal: 12,
          marginBottom: 8,
          borderRadius: 24,
          borderTopWidth: 0,
        },
        tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
        tabBarItemStyle: { paddingHorizontal: 4 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerTransparent: true,
          header: () => <AppHeader transparent right={<NotificationBell />} />,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "search" : "search-outline"} size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="mood"
        options={{
          title: "Mood",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "sparkles" : "sparkles-outline"}
              size={size - 3}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="ratings"
        options={{
          title: "Ratings",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "star" : "star-outline"} size={size - 3} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={size - 3} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
