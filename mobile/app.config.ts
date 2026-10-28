import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "NextWatch",
  slug: "nextwatch",
  scheme: "nextwatch",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // "automatic", not "dark": a locked appearance stops NativeWind's
  // setColorScheme (which goes through Appearance.setColorScheme on native)
  // from switching the app, so the Profile toggle left OS-driven text and
  // controls in the wrong scheme. app/_layout.tsx still defaults to dark.
  userInterfaceStyle: "automatic",
  // Over the air updates (spec 0014 rule 7): an update only reaches builds with
  // the same app version, so a native change means bumping `version` above.
  // TODO after the first `eas init` (spec 0014, manual prerequisites): add
  // `owner`, `updates.url` and `extra.eas.projectId` here. They are not secrets.
  runtimeVersion: { policy: "appVersion" },
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.nextwatch.app",
  },
  android: {
    package: "com.nextwatch.app",
    adaptiveIcon: {
      backgroundColor: "#1A1612",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
    output: "static",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-splash-screen",
      {
        image: "./assets/logo.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: "#1A1612",
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        url: "https://sentry.io/",
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  },
};

export default config;
