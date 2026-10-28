import { create } from "zustand";
import { clearTokens } from "../lib/tokens";

// The destination the launch check (spec 0004) resolves to, mirroring the
// route groups under app/. Null until that resolution lands, so index.tsx
// knows to keep the splash screen up rather than redirect to a guess.
// "/reactivate" (spec 0009 AC-4) is reached when the account's
// deactivated_at is set -- a pending deletion the user can cancel.
export type LaunchRoute = "/(auth)/login" | "/onboarding" | "/(tabs)" | "/reactivate";

type SessionState = {
  userId: string | null;
  launchRoute: LaunchRoute | null;
  setUserId: (userId: string | null) => void;
  setLaunchRoute: (launchRoute: LaunchRoute) => void;
  // "Authenticated" is derived from userId !== null everywhere -- no
  // second flag to keep in sync (AGENTS.md §8's flat-shape rule).
  clearSession: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  launchRoute: null,
  setUserId: (userId) => set({ userId }),
  setLaunchRoute: (launchRoute) => set({ launchRoute }),
  clearSession: async () => {
    await clearTokens();
    set({ userId: null });
  },
}));
