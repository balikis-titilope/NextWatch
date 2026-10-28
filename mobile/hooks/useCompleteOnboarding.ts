import { useMutation } from "@tanstack/react-query";
import {
  ONBOARDING_COMPLETE_RETRY_ATTEMPTS,
  onboardingCompleteRetryDelay,
} from "../constants/config";
import { apiFetch } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import type { Me } from "../types/api";

// Skip/Done (spec 0004, AC-5): a low-stakes background write that never
// blocks navigation and never forces a sign-out on failure (sessionRecovery:
// false, see lib/api.ts) -- its own bounded retry governs it alone.
export function useCompleteOnboarding() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/me/onboarding/complete", {
        method: "POST",
        sessionRecovery: false,
      }),
    retry: ONBOARDING_COMPLETE_RETRY_ATTEMPTS,
    retryDelay: onboardingCompleteRetryDelay,
    onSuccess: () => {
      queryClient.setQueryData<Me>(["me"], (current) =>
        current ? { ...current, onboarding_completed: true } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
