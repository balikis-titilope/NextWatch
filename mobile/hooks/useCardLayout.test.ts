import { renderHook } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";
import { PAGE_MAX_WIDTH, POSTER_GRID_GAP, SCREEN_HORIZONTAL_PADDING } from "../constants/config";
import { usePageGutter } from "./usePageGutter";
import { useCardLayout } from "./useCardLayout";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const setWidth = (width: number) =>
  (useWindowDimensions as jest.Mock).mockReturnValue({
    width,
    height: 900,
    scale: 1,
    fontScale: 1,
  });

// A full grid line must end exactly at the page's right padding.
function lineWidth(columns: number, cardWidth: number) {
  return columns * cardWidth + (columns - 1) * POSTER_GRID_GAP;
}

describe("useCardLayout", () => {
  test.each([360, 768, 1100, 1440, 1920, 2560])(
    "columns fill the page exactly at %ipx",
    async (w) => {
      setWidth(w);
      const { result } = await renderHook(() => useCardLayout());

      const { result: gutter } = await renderHook(() => usePageGutter());
      const available =
        Math.min(w, PAGE_MAX_WIDTH) - (gutter.current + SCREEN_HORIZONTAL_PADDING) * 2;
      expect(lineWidth(result.current.columns, result.current.gridCardWidth)).toBeCloseTo(
        available,
      );
    },
  );

  test("a phone gets 2 columns and a peeking row", async () => {
    setWidth(360);
    const { result } = await renderHook(() => useCardLayout());

    expect(result.current.columns).toBe(2);
    expect(result.current.wide).toBe(false);
    // 2.5 cards visible: two full cards plus half of the third.
    expect(result.current.rowCardWidth).toBeLessThan(result.current.gridCardWidth);
  });

  test("a wide window uses the same width for rows and grids, with more columns", async () => {
    setWidth(1440);
    const { result } = await renderHook(() => useCardLayout());

    expect(result.current.wide).toBe(true);
    expect(result.current.columns).toBeGreaterThanOrEqual(6);
    expect(result.current.rowCardWidth).toBe(result.current.gridCardWidth);
  });
});
