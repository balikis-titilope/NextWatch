import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";
import type { Me } from "../types/api";

// GET /me -- the launch routing check (spec 0004) already fetches this ad
// hoc during login; this is the reusable query form for the Profile
// screen's session info (design.md §6.9), which just wants the signed-in
// account's email. Gated on userId so it stops firing (and can't trigger
// a token renewal) once the session is cleared -- a still-mounted screen
// polling this after logout was spending the shared Supabase rate-limit
// bucket right when the user tries to log back in.
export function useMe() {
  const userId = useSessionStore((state) => state.userId);
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/me"),
    enabled: !!userId,
  });
}
