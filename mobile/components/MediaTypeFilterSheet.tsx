import { Ionicons } from "@expo/vector-icons";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { forwardRef, useMemo } from "react";
import { Pressable, Text } from "react-native";
import { SHEET_PADDING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";
import type { MediaType } from "../types/api";

interface Props {
  selected: MediaType | "both";
  onSelect: (mediaType: MediaType | "both") => void;
}

interface Row {
  label: string;
  value: MediaType | "both";
}

const ROWS: Row[] = [
  { label: "Both", value: "both" },
  { label: "Movies", value: "movie" },
  { label: "TV", value: "tv" },
];

// Spec 0010 AC-3: the Movies/TV/Both filter chip, same bottom sheet
// pattern as LanguageFilterSheet.
export const MediaTypeFilterSheet = forwardRef<BottomSheetModal, Props>(
  function MediaTypeFilterSheet({ selected, onSelect }, ref) {
    const theme = useTheme();
    const rows = useMemo(() => ROWS, []);

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={["40%"]}
        backgroundStyle={{ backgroundColor: theme["bg-secondary"] }}
        handleIndicatorStyle={{ backgroundColor: theme["text-disabled"] }}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
        )}
      >
        <BottomSheetScrollView
          contentContainerStyle={{
            gap: 4,
            paddingHorizontal: SHEET_PADDING,
            paddingTop: 8,
            paddingBottom: 32,
          }}
        >
          <Text className="mb-2 font-display-md text-display-md text-text-primary">Type</Text>
          {rows.map((row) => {
            const active = row.value === selected;
            return (
              <Pressable
                key={row.value}
                onPress={() => {
                  onSelect(row.value);
                  (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
                }}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                accessibilityState={{ selected: active }}
                className="flex-row items-center justify-between rounded-lg px-3 py-3"
              >
                <Text
                  className={`font-body-md text-body-md ${active ? "text-accent-primary" : "text-text-primary"}`}
                >
                  {row.label}
                </Text>
                {active ? (
                  <Ionicons name="checkmark" size={20} color={theme["accent-primary"]} />
                ) : null}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);
