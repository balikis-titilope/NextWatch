import { create } from "zustand";

// Whether Home has scrolled off the top of its hero, so the transparent
// header (rendered by the tab layout, outside the screen) can fill in.
type HomeScrollState = {
  scrolled: boolean;
  setScrolled: (scrolled: boolean) => void;
};

export const useHomeScrollStore = create<HomeScrollState>((set) => ({
  scrolled: false,
  setScrolled: (scrolled) => set({ scrolled }),
}));
