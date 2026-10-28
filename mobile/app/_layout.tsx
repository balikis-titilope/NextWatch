import "../global.css";
import { Jost_400Regular, Jost_600SemiBold } from "@expo-google-fonts/jost";
import {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from "@expo-google-fonts/playfair-display";
import { QueryClientProvider } from "@tanstack/react-query";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFonts } from "expo-font";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "nativewind";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AnimatedSplashScreen } from "../components/AnimatedSplashScreen";
import { AppHeaderLogo } from "../components/AppHeaderLogo";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useTheme } from "../hooks/useTheme";
import { resolveLaunchRoute } from "../lib/launchRouting";
import { queryClient } from "../lib/queryClient";
import { initTelemetry } from "../lib/telemetry";
import { getStoredThemePreference } from "../lib/themePreference";
import { useSessionStore } from "../store/sessionStore";

// The animated splash always plays at least this long, even when the launch
// check resolves instantly (a logged-out user has no network call to wait on).
const MIN_SPLASH_MS = 1500;

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });
// Skipped during the static web export (spec 0011), which runs this module in Node.
if (typeof window !== "undefined") initTelemetry();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Jost_400Regular,
    Jost_600SemiBold,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
  });
  const launchRoute = useSessionStore((state) => state.launchRoute);
  const setLaunchRoute = useSessionStore((state) => state.setLaunchRoute);
  const userId = useSessionStore((state) => state.userId);
  const wasAuthenticated = useRef(false);
  const { setColorScheme } = useColorScheme();
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMinSplashElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(id);
  }, []);

  // Runs once, alongside font loading rather than after it, so neither
  // the splash hiding nor index.tsx's redirect can happen before the
  // launch decision (spec 0004) is known.
  useEffect(() => {
    resolveLaunchRoute().then((route) => {
      // Web shows the landing page while this runs (spec 0011), so a visitor
      // may have logged in meanwhile; a late "logged out" result must not
      // overwrite that fresh login.
      if (route === "/(auth)/login" && useSessionStore.getState().userId !== null) return;
      setLaunchRoute(route);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restores a manual Dark/Light override from the Profile toggle
  // (design.md §6.9); with no stored preference (first launch) the app
  // defaults to dark rather than following the OS scheme.
  useEffect(() => {
    getStoredThemePreference().then((preference) => {
      setColorScheme(preference ?? "dark");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hides the native splash (config-plugin image, no custom fonts, can't
  // animate) as soon as fonts are ready -- AnimatedSplashScreen, which can
  // animate, takes over from there and keeps pulsing until launchRoute
  // resolves too, rather than sitting behind the static native splash for
  // that whole gap.
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Clearing the session (lib/api.ts, on a terminal 401 or an explicitly
  // rejected renewal) only updates state -- nothing reacts to it on its
  // own. This is what actually sends an already-launched user back to
  // sign in when that happens mid-session, instead of leaving them
  // stranded on a screen backed by a session that no longer exists.
  useEffect(() => {
    if (userId !== null) {
      wasAuthenticated.current = true;
      return;
    }
    // On web launchRoute can still be null here: the stack renders before the
    // launch check finishes (spec 0011).
    if (wasAuthenticated.current && (launchRoute !== null || Platform.OS === "web")) {
      wasAuthenticated.current = false;
      router.replace("/(auth)/login");
    }
  }, [userId, launchRoute]);

  // Web never blocks the first render on fonts or the launch check, so the
  // static export contains the landing page instead of a splash (spec 0011).
  if (Platform.OS !== "web" && !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
          <ErrorBoundary>
            {Platform.OS === "web" || (launchRoute !== null && minSplashElapsed) ? (
              <RootStack />
            ) : (
              <AnimatedSplashScreen />
            )}
          </ErrorBoundary>
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Split out so the notifications screen's native header (spec 0006's one
// exception to this app's otherwise header-less Stack, see AGENTS.md) can
// read live theme colors -- useTheme() needs to run under the same
// component tree, not before launchRoute gates whether RootStack renders.
function RootStack() {
  const theme = useTheme();

  return (
    // contentStyle: react-navigation's default screen background follows the OS
    // scheme, not NativeWind's, and shows through around the floating tab dock.
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme["bg-primary"] },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="movie/[type]/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="showcase" />
      <Stack.Screen name="reactivate" />
      <Stack.Screen
        name="notifications"
        options={{
          headerShown: true,
          title: "Notifications",
          headerRight: () => <AppHeaderLogo />,
          headerStyle: { backgroundColor: theme["bg-primary"] },
          headerTintColor: theme["text-primary"],
        }}
      />
      <Stack.Screen
        name="delete-account"
        options={{
          headerShown: true,
          title: "Delete Account",
          headerRight: () => <AppHeaderLogo />,
          headerStyle: { backgroundColor: theme["bg-primary"] },
          headerTintColor: theme["text-primary"],
        }}
      />
    </Stack>
  );
}
