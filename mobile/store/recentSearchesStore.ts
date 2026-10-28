import { create } from "zustand";

const MAX_RECENT = 6;

// The titles the user recently opened from Search, newest first. Kept in
// memory only for the session: AGENTS.md §8 reserves AsyncStorage for the
// theme preference.
type RecentSearchesState = {
  recent: string[];
  add: (title: string) => void;
  clear: () => void;
};

export const useRecentSearchesStore = create<RecentSearchesState>((set) => ({
  recent: [],
  add: (title) =>
    set((state) => {
      const trimmed = title.trim();
      if (!trimmed) return state;
      const rest = state.recent.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase());
      return { recent: [trimmed, ...rest].slice(0, MAX_RECENT) };
    }),
  clear: () => set({ recent: [] }),
}));
