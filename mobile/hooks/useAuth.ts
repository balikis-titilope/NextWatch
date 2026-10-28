import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { apiFetch } from "../lib/api";
import { getDeviceCountry } from "../lib/locale";
import { queryClient } from "../lib/queryClient";
import { identifyUser } from "../lib/telemetry";
import { setTokens } from "../lib/tokens";
import { useSessionStore, type LaunchRoute } from "../store/sessionStore";
import type {
  AuthResponse,
  Me,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
  SignupResponse,
} from "../types/api";

type Credentials = { email: string; password: string };

async function completeAuth(result: AuthResponse) {
  await setTokens(result);
  useSessionStore.getState().setUserId(result.user_id);
  identifyUser(result.user_id);
}

export function useSignup() {
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      // AC-11: the device's region, captured with no user prompt -- sent
      // on the immediate-session path; useVerifySignup sends it again for
      // the confirm-email path, since no user_id exists yet to persist it.
      apiFetch<SignupResponse>("/auth/signup", {
        method: "POST",
        body: { ...credentials, country: getDeviceCountry() },
        token: null,
      }),
    onSuccess: async (result) => {
      if (result.status === "confirmation_required") {
        // AC-12: no credentials exist yet -- /auth/signup already sent
        // the first code, so no auto-resend on arrival here.
        router.replace({ pathname: "/(auth)/confirm-email", params: { email: result.email } });
        return;
      }
      await completeAuth(result);
      // AC-8: a freshly signed up account always starts with onboarding
      // not complete -- route straight in, no separate launch-style check.
      useSessionStore.getState().setLaunchRoute("/onboarding");
      router.replace("/onboarding");
    },
  });
}

export function useVerifySignup() {
  return useMutation({
    mutationFn: (payload: { email: string; token: string }) =>
      apiFetch<AuthResponse>("/auth/verify-signup", {
        method: "POST",
        body: { ...payload, country: getDeviceCountry() },
        token: null,
      }),
    onSuccess: async (result) => {
      await completeAuth(result);
      // AC-13: the same destination a no-confirmation signup already reaches.
      useSessionStore.getState().setLaunchRoute("/onboarding");
      router.replace("/onboarding");
    },
  });
}

export function useResendConfirmation() {
  return useMutation({
    mutationFn: (payload: { email: string }) =>
      apiFetch<{ status: "ok" }>("/auth/resend-confirmation", {
        method: "POST",
        body: payload,
        token: null,
      }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (credentials: Credentials) => {
      const result = await apiFetch<AuthResponse>("/auth/login", {
        method: "POST",
        body: credentials,
        token: null,
      });
      // The credential check succeeded, so the session is real: persist it
      // BEFORE the routing lookup below. Fetching /me with an access token
      // that isn't in SecureStore yet meant a 401 on that call had nothing
      // to renew with, so apiFetch's renewal path rejected with an internal
      // "No refresh token stored" and reported an otherwise successful sign
      // in as a failure. Stored first, /me is an ordinary authenticated
      // call: a 401 there renews and retries for real (spec 0004's diagram)
      // rather than dead ending. It also matches useMe's gate, which only
      // fetches once a user id is set.
      await completeAuth(result);
      // AC-9: routed by the same onboarding_completed check as launch, so
      // signing in on a new device or after a reinstall lands in the
      // right place, not always straight to onboarding. Resolved here,
      // inside mutationFn, rather than onSuccess -- a failure here must
      // surface as a real mutation error (login.isError), not a silently
      // swallowed rejection that leaves the user stuck on the login
      // screen with no feedback. AC-4's deactivated-account prompt depends
      // on this lookup succeeding, so it is deliberately not made
      // non-fatal the way useResetPassword's routing-only call is.
      const me = await queryClient.fetchQuery({
        queryKey: ["me"],
        queryFn: () => apiFetch<Me>("/me", { token: result.access_token }),
      });
      // spec 0009 AC-4: a deactivated account doesn't go straight to the
      // tabs or onboarding -- the reactivate prompt takes priority over
      // the onboarding check.
      const destination: LaunchRoute = me.deactivated_at
        ? "/reactivate"
        : me.onboarding_completed
          ? "/(tabs)"
          : "/onboarding";
      return { result, destination };
    },
    onSuccess: async ({ destination }) => {
      // The session was already established inside mutationFn, before the
      // routing lookup; repeating it here would be a second SecureStore
      // write of the same credential for no gain.
      useSessionStore.getState().setLaunchRoute(destination);
      router.replace(destination);
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    // spec 0007: this same mutation backs both the initial request on
    // forgot-password.tsx and the "Resend code" action on
    // reset-password.tsx (AC-8) -- no separate resend hook, the request
    // is identical either way.
    mutationFn: (payload: RequestPasswordResetRequest) =>
      apiFetch<{ status: "ok" }>("/auth/request-password-reset", {
        method: "POST",
        body: payload,
        token: null,
      }),
  });
}

export function useDeactivateAccount() {
  // spec 0009 AC-1/AC-2: deliberately does NOT clear the session or
  // navigate on success -- the confirm screen (app/delete-account.tsx)
  // shows the 30 day grace-period message first (mutation.isSuccess) and
  // only signs out when the user taps through, so the message is
  // actually seen instead of being raced by _layout.tsx's own
  // session-cleared redirect.
  return useMutation({
    mutationFn: (payload: { password: string; confirm: string }) =>
      apiFetch<{ status: "deactivated" }>("/me/deactivate", {
        method: "POST",
        body: payload,
      }),
  });
}

export function useReactivateAccount() {
  return useMutation({
    mutationFn: () => apiFetch<{ status: "active" }>("/me/reactivate", { method: "POST" }),
    onSuccess: async () => {
      // Same destination computation useLogin's mutationFn does (AC-5):
      // non-fatal if it fails, since the reactivation itself already
      // succeeded -- worst case an incomplete onboarding gets repeated.
      let destination: LaunchRoute = "/(tabs)";
      try {
        const me = await queryClient.fetchQuery({
          queryKey: ["me"],
          queryFn: () => apiFetch<Me>("/me"),
        });
        destination = me.onboarding_completed ? "/(tabs)" : "/onboarding";
      } catch {
        // Routing hiccup only -- the reactivation itself already succeeded.
      }
      useSessionStore.getState().setLaunchRoute(destination);
      router.replace(destination);
    },
  });
}

export function useResetPassword() {
  return useMutation({
    // Unlike useLogin, the destination lookup below is NOT folded into
    // this mutationFn. By the time /auth/reset-password responds, the
    // one-time code is already consumed and the password already changed
    // server-side (backend/auth.py's verify_recovery_code then
    // finish_password_reset) -- that step is done and cannot be retried
    // with the same code. If the routing-only /me call below failed and
    // was allowed to reject this whole mutation, a successful reset would
    // show as an error telling the user their code was invalid, sending
    // them back around a loop (new code, same false failure) even though
    // their password had already changed.
    mutationFn: (payload: ResetPasswordRequest) =>
      apiFetch<AuthResponse>("/auth/reset-password", {
        method: "POST",
        body: payload,
        token: null,
      }),
    onSuccess: async (result) => {
      await completeAuth(result);
      // AC-6: same destination computation useLogin's mutationFn does,
      // but non-fatal here -- a failure just falls back to the tabs
      // (worst case, an incomplete onboarding gets repeated) instead of
      // masking an already-successful password reset as a failure.
      let destination: LaunchRoute = "/(tabs)";
      try {
        const me = await queryClient.fetchQuery({
          queryKey: ["me"],
          queryFn: () => apiFetch<Me>("/me", { token: result.access_token }),
        });
        destination = me.onboarding_completed ? "/(tabs)" : "/onboarding";
      } catch {
        // Routing hiccup only -- the reset itself already succeeded.
      }
      useSessionStore.getState().setLaunchRoute(destination);
      router.replace(destination);
    },
  });
}
