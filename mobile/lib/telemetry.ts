import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { PostHog } from "posthog-react-native";

let posthogClient: PostHog | null = null;

// Read live, not cached at module load: Jest always sets __DEV__ true, so a
// frozen module-level constant would make every function below a permanent
// no-op and the module untestable.
function isEnabled() {
  return !__DEV__;
}

export function initTelemetry() {
  if (!isEnabled()) return;

  const { sentryDsn, posthogApiKey, posthogHost } = Constants.expoConfig?.extra ?? {};
  if (!sentryDsn || !posthogApiKey) {
    // This is a real (preview/production) build that shipped without its EAS
    // env vars. Warn and stay disabled, never throw: initTelemetry() runs
    // before the error boundary exists and before Sentry itself would be
    // initialized, so throwing here would brick the app at launch for every
    // user, with no way to even report it. Unlike EXPO_PUBLIC_API_BASE_URL in
    // lib/api.ts (required in every build, the app is unusable without it),
    // telemetry is additive: the app should keep working without it.
    console.warn(
      "Telemetry env vars missing in a non-dev build; Sentry and PostHog stay disabled.",
    );
    return;
  }

  try {
    Sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: 0, // performance tracing is out of scope for this spec
      sendDefaultPii: false,
    });
    posthogClient = new PostHog(posthogApiKey, {
      host: posthogHost ?? "https://us.i.posthog.com",
      flushAt: 1, // low volume app; flush every event rather than risk losing a batch
    });
  } catch (error) {
    // A malformed DSN or key should not be able to crash the app either.
    console.warn("Telemetry failed to initialize", error);
  }
}

// Call in the signup and login mutations' onSuccess. Only the user id is
// sent, never email or name, to keep what reaches either vendor to a
// minimum. PostHog's identify() automatically merges the anonymous
// distinct_id used for any pre-login events into this one; no alias() call
// is needed.
export function identifyUser(userId: string) {
  if (!isEnabled()) return;
  Sentry.setUser({ id: userId });
  posthogClient?.identify(userId);
}

// Call on sign out.
export function resetUser() {
  if (!isEnabled()) return;
  Sentry.setUser(null);
  posthogClient?.reset();
}

// Matches PostHog's JSON-safe event property type structurally (not
// re-exported from posthog-react-native's public entry, so defined locally).
type TelemetryValue =
  string | number | boolean | null | TelemetryValue[] | { [key: string]: TelemetryValue };

export function trackEvent(name: string, properties?: Record<string, TelemetryValue>) {
  if (!isEnabled()) return;
  posthogClient?.capture(name, properties);
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!isEnabled()) {
    console.error(error);
    return;
  }
  Sentry.captureException(error, { extra: context });
}
