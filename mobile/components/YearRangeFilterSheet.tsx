import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { forwardRef, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Chip } from "./Chip";
import { PrimaryButton } from "./PrimaryButton";
import { TextField } from "./TextField";
import { YEAR_RANGE_MAX, YEAR_RANGE_MIN, SHEET_PADDING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";

interface Props {
  startYear: number | null;
  endYear: number | null;
  onApply: (startYear: number | null, endYear: number | null) => void;
}

// Ready-made ranges, one tap each. null on a side means "no limit".
const QUICK_RANGES: { label: string; start: number | null; end: number | null }[] = [
  { label: "Last 5 years", start: YEAR_RANGE_MAX - 4, end: null },
  { label: "2020s", start: 2020, end: null },
  { label: "2010s", start: 2010, end: 2019 },
  { label: "2000s", start: 2000, end: 2009 },
  { label: "1990s", start: 1990, end: 1999 },
  { label: "1980s", start: 1980, end: 1989 },
  { label: "Before 1980", start: null, end: 1979 },
];

// An empty or unreadable box means "no limit"; anything else is kept inside
// the supported years.
function parseYear(text: string): number | null {
  const value = Number.parseInt(text.trim(), 10);
  if (!Number.isFinite(value)) return null;
  return Math.min(YEAR_RANGE_MAX, Math.max(YEAR_RANGE_MIN, value));
}

// design.md §6.5's year range, without sliders: quick ranges for the common
// cases, plus From/To boxes for an exact range.
export const YearRangeFilterSheet = forwardRef<BottomSheetModal, Props>(
  function YearRangeFilterSheet({ startYear, endYear, onApply }, ref) {
    const theme = useTheme();
    const [fromText, setFromText] = useState(startYear?.toString() ?? "");
    const [toText, setToText] = useState(endYear?.toString() ?? "");

    useEffect(() => {
      setFromText(startYear?.toString() ?? "");
      setToText(endYear?.toString() ?? "");
    }, [startYear, endYear]);

    const dismiss = () => (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
    const hasRange = startYear !== null || endYear !== null;

    const choose = (start: number | null, end: number | null) => {
      onApply(start, end);
      dismiss();
    };

    const applyCustom = () => {
      let start = parseYear(fromText);
      let end = parseYear(toText);
      if (start !== null && end !== null && start > end) [start, end] = [end, start];
      choose(start === YEAR_RANGE_MIN ? null : start, end === YEAR_RANGE_MAX ? null : end);
    };

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        backgroundStyle={{ backgroundColor: theme["bg-secondary"] }}
        handleIndicatorStyle={{ backgroundColor: theme["text-disabled"] }}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
      >
        <BottomSheetView
          style={{ gap: 8, paddingHorizontal: SHEET_PADDING, paddingTop: 8, paddingBottom: 32 }}
        >
          <Text className="font-display-md text-display-md text-text-primary">Year</Text>
          <Text className="font-body-sm text-body-sm text-text-secondary">
            Pick a range, or type exact years.
          </Text>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {QUICK_RANGES.map((range) => (
              <Chip
                key={range.label}
                label={range.label}
                active={startYear === range.start && endYear === range.end}
                onPress={() => choose(range.start, range.end)}
              />
            ))}
          </View>

          <View className="mt-6 flex-row gap-3">
            <View className="flex-1 gap-1">
              <Text className="font-body-sm text-body-sm text-text-secondary">From</Text>
              <TextField
                leadingIcon="calendar-outline"
                value={fromText}
                onChangeText={setFromText}
                placeholder={String(YEAR_RANGE_MIN)}
                accessibilityLabel="From year"
                keyboardType="number-pad"
                maxLength={4}
                clearable
              />
            </View>
            <View className="flex-1 gap-1">
              <Text className="font-body-sm text-body-sm text-text-secondary">To</Text>
              <TextField
                leadingIcon="calendar-outline"
                value={toText}
                onChangeText={setToText}
                placeholder={String(YEAR_RANGE_MAX)}
                accessibilityLabel="To year"
                keyboardType="number-pad"
                maxLength={4}
                onSubmitEditing={applyCustom}
                clearable
              />
            </View>
          </View>

          <View className="mt-4 gap-3">
            <PrimaryButton label="Apply" onPress={applyCustom} />
            {hasRange ? (
              <Pressable
                onPress={() => choose(null, null)}
                accessibilityRole="button"
                accessibilityLabel="Clear year filter"
              >
                <Text className="text-center font-body-md text-body-md text-text-secondary">
                  Clear
                </Text>
              </Pressable>
            ) : null}
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
