import { MutationCache, QueryCache, QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { ApiError } from "./api";
import { captureError, trackEvent } from "./telemetry";

// TanStack Query's web-oriented "window focus" refetch has no browser
// focus event on native, so nothing would ever trigger it without this --
// wiring focusManager to AppState is the real RN mechanism (spec 0006's
// unread-count refetch depends on it). Web already gets a real focus
// event, so this only takes over on native.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== "web") {
    focusManager.setFocused(status === "active");
  }
}

AppState.addEventListener("change", onAppStateChange);

// A normal 4xx (e.g. a validation error) is expected, user facing behaviour
// surfaced through TanStack Query's own error state (AGENTS.md §14), not a
// crash. Only network failures and 5xx responses represent an actual
// technical failure worth forwarding to Sentry.
function reportUnexpectedError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    // apiFetch already exhausted renewal by the time a 401 reaches here
    // (AC-4/AC-11) -- the session is already cleared. This is only a
    // breadcrumb so a forced logout isn't silent (spec 0004): the check
    // above would otherwise skip it entirely as "just a 4xx".
    trackEvent("session_forced_logout");
    return;
  }
  if (error instanceof ApiError && error.status < 500) return;
  captureError(error);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // apiFetch already owns 401 handling (renew-then-retry, or a
      // terminal clear+redirect) -- retrying here on top of that would
      // just repeat a doomed request.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 1;
      },
      staleTime: 60 * 1000,
    },
  },
  queryCache: new QueryCache({ onError: reportUnexpectedError }),
  mutationCache: new MutationCache({ onError: reportUnexpectedError }),
});
