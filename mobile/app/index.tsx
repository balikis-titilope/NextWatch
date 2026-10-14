import { Redirect } from "expo-router";
import { useSessionStore } from "../store/sessionStore";

// The launch resolution (spec 0004) runs in the root layout, alongside
// font loading, and publishes its result into sessionStore before the
// splash screen ever hides -- by the time this can render, launchRoute
// is never null.
export default function Index() {
  const launchRoute = useSessionStore((state) => state.launchRoute);
  if (!launchRoute) return null;
  return <Redirect href={launchRoute} />;
}
