import { LAUNCH_TIMEOUT_MS } from "../constants/config";
import { useSessionStore, type LaunchRoute } from "../store/sessionStore";
import type { Me } from "../types/api";
import { ApiError, apiFetch, renewSession } from "./api";
import { isAccessTokenExpired } from "./jwt";
import { getAccessToken, getRefreshToken } from "./tokens";

// One retry (spec 0004 revision): a slow/flaky connection at launch
// shouldn't read as "logged out" when the stored session is still
// perfectly valid -- only a confirmed rejection or a repeated transient
// failure routes to login (see isTransientLaunchError below).
const LAUNCH_ATTEMPTS = 2;
const LAUNCH_RETRY_DELAY_MS = 500;

// A confirmed rejection of the credential itself (ApiError 401 --
// apiFetch/renewSession already cleared the session for this case) means
// launch really did confirm the session is gone; retrying won't change
// that. Everything else -- an aborted request (LAUNCH_TIMEOUT_MS), an
// offline/network fetch failure, or a backend/Supabase 503 -- means
// "couldn't confirm," which is worth one retry before falling back to
// login.
function isTransientLaunchError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status !== 401;
  return true;
}

async function attemptLaunchRoute(): Promise<LaunchRoute> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LAUNCH_TIMEOUT_MS);
  try {
    const accessToken = await getAccessToken();
    // A missing/known-expired access token would only 401 -- skip that
    // doomed round trip and join the shared renewal directly.
    const token =
      accessToken && !isAccessTokenExpired(accessToken) ? accessToken : await renewSession();

    const me = await apiFetch<Me>("/me", { token, signal: controller.signal });
    useSessionStore.getState().setUserId(me.user_id);
    // spec 0009 AC-4: a relaunch that lands on a still-deactivated account
    // (deactivated from the web form, or from another device, since the
    // last launch) shows the reactivate prompt instead of going straight in.
    if (me.deactivated_at) return "/reactivate";
    return me.onboarding_completed ? "/(tabs)" : "/onboarding";
  } finally {
    clearTimeout(timeoutId);
  }
}

// The relaunch routing decision (spec 0004): resolved once per app open,
// alongside font loading in app/_layout.tsx (see the effect there), not
// after it -- the splash screen stays up until both are done (AC-7).
export async function resolveLaunchRoute(): Promise<LaunchRoute> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    return "/(auth)/login"; // AC-1: keyed on the refresh credential, no network call at all
  }

  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt++) {
    try {
      return await attemptLaunchRoute();
    } catch (error) {
      const isLastAttempt = attempt === LAUNCH_ATTEMPTS;
      if (isLastAttempt || !isTransientLaunchError(error)) {
        // apiFetch/renewSession already cleared credentials on an
        // explicit rejection (AC-4/AC-11); a timeout/network/5xx failure
        // leaves them intact (AC-10) -- either way, launch routes to
        // (auth) once retries are exhausted.
        return "/(auth)/login";
      }
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_RETRY_DELAY_MS));
    }
  }
  return "/(auth)/login"; // unreachable -- satisfies TS's control-flow analysis
}
