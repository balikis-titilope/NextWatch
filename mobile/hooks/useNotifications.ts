import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useSessionStore } from "../store/sessionStore";
import type { Notification, NotificationPrefs } from "../types/api";

// GET /me/notifications -- the full history list (spec 0006 AC-3), shown
// on the dedicated notifications screen. Gated on userId (see
// useUnreadNotificationCount below for why).
export function useNotifications() {
  const userId = useSessionStore((state) => state.userId);
  return useQuery({
    queryKey: ["me", "notifications"],
    queryFn: () => apiFetch<Notification[]>("/me/notifications"),
    enabled: !!userId,
  });
}

// GET /me/notifications/unread-count -- drives the Home bell badge (spec
// 0006 AC-10). refetchOnWindowFocus is explicit here since this is the one
// query that must catch a notification written while the app was
// backgrounded -- lib/queryClient.ts wires focusManager to AppState so
// this actually fires on native, not just web. Gated on userId so it
// can't keep polling (and retrying token renewal) after logout -- a
// background query surviving past sign-out was spending the shared
// Supabase rate-limit bucket right as the user tried to log back in.
export function useUnreadNotificationCount() {
  const userId = useSessionStore((state) => state.userId);
  return useQuery({
    queryKey: ["me", "notifications", "unread-count"],
    queryFn: () => apiFetch<{ count: number }>("/me/notifications/unread-count"),
    refetchOnWindowFocus: true,
    enabled: !!userId,
  });
}

// POST /me/notifications/{id}/read -- marks one row read in place (spec
// 0006 AC-5). Invalidating ["me", "notifications"] also covers the
// unread-count query (its key starts with the same prefix), so the badge
// updates alongside the list.
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ status: string }>(`/me/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "notifications"] });
    },
  });
}

// POST /me/notifications/read-all -- the "mark all read" action (spec
// 0006 AC-6, AC-12).
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ status: string; marked: number }>("/me/notifications/read-all", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "notifications"] });
    },
  });
}

// PATCH /me/notification-prefs -- the Profile mute toggles (spec 0006
// AC-7, AC-8). notification_prefs lives on Me, not its own query, so this
// invalidates ["me"] rather than a dedicated prefs key.
export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<NotificationPrefs>) =>
      apiFetch<NotificationPrefs>("/me/notification-prefs", {
        method: "PATCH",
        body: updates,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
