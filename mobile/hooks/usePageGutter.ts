import { useWindowDimensions } from "react-native";
import {
  DESKTOP_BREAKPOINT,
  PAGE_GUTTER,
  PAGE_GUTTER_DESKTOP,
  PAGE_GUTTER_WIDE,
  WIDE_BREAKPOINT,
} from "../constants/config";

// Side space between the window edge and a tab screen's content, applied once
// by PageColumn and AppHeader (screens keep their own 16px inset inside it).
// Phone 24px in total, like the landing page; wide windows get more room.
export function usePageGutter(): number {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_BREAKPOINT) return PAGE_GUTTER_DESKTOP;
  if (width >= WIDE_BREAKPOINT) return PAGE_GUTTER_WIDE;
  return PAGE_GUTTER;
}
