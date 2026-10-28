import { useWindowDimensions } from "react-native";
import {
  DESKTOP_BREAKPOINT,
  SECTION_GAP,
  SECTION_GAP_DESKTOP,
  SECTION_GAP_WIDE,
  WIDE_BREAKPOINT,
} from "../constants/config";

// Vertical space between a tab screen's sections (Home's rows, Profile's
// groups). Scales with the window like usePageGutter, so web gets real room.
export function useSectionGap(): number {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_BREAKPOINT) return SECTION_GAP_DESKTOP;
  if (width >= WIDE_BREAKPOINT) return SECTION_GAP_WIDE;
  return SECTION_GAP;
}
