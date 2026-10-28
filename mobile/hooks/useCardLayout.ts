import { useWindowDimensions } from "react-native";
import {
  CARD_TARGET_WIDTH,
  PAGE_MAX_WIDTH,
  PHONE_ROW_VISIBLE,
  POSTER_GRID_GAP,
  SCREEN_HORIZONTAL_PADDING,
  WIDE_BREAKPOINT,
} from "../constants/config";
import { usePageGutter } from "./usePageGutter";

// The one card grid every poster list uses. `columns` fit at about
// CARD_TARGET_WIDTH each in the page column, and `cardWidth` stretches them
// so a full row or grid line ends exactly at the page's right padding (no
// ragged gap, no half-cut card). Home's horizontal rows use the same width
// as the grid on wide windows, so every list on every page lines up; on a
// phone a row shows PHONE_ROW_VISIBLE cards so the next one peeks in.
export function useCardLayout() {
  const { width } = useWindowDimensions();
  const gutter = usePageGutter();
  const wide = width >= WIDE_BREAKPOINT;
  // Page gutter plus the screen's own inset, on both sides.
  const available = Math.min(width, PAGE_MAX_WIDTH) - (gutter + SCREEN_HORIZONTAL_PADDING) * 2;

  const columns = Math.max(
    2,
    Math.floor((available + POSTER_GRID_GAP) / (CARD_TARGET_WIDTH + POSTER_GRID_GAP)),
  );
  const cardWidth = (available - POSTER_GRID_GAP * (columns - 1)) / columns;

  const peekWidth =
    (available + SCREEN_HORIZONTAL_PADDING - POSTER_GRID_GAP * Math.floor(PHONE_ROW_VISIBLE)) /
    PHONE_ROW_VISIBLE;

  return {
    wide,
    columns,
    gridCardWidth: cardWidth,
    rowCardWidth: wide ? cardWidth : peekWidth,
  };
}
