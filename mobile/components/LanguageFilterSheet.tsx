import { Ionicons } from "@expo/vector-icons";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { forwardRef, useMemo } from "react";
import { Pressable, Text } from "react-native";
import { LANGUAGE_OPTIONS, SHEET_PADDING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";

interface Props {
  selected: string | null;
  onSelect: (code: string | null) => void;
}

interface Row {
  label: string;
  code: string | null;
}

// design.md §6.5: language filter chip opens a bottom sheet with
// human-readable options mapped to ISO codes.
export const LanguageFilterSheet = forwardRef<BottomSheetModal, Props>(function LanguageFilterSheet(
  { selected, onSelect },
  ref,
) {
  const theme = useTheme();
  const rows: Row[] = useMemo(
    () => [
      { label: "All languages", code: null },
      ...Object.entries(LANGUAGE_OPTIONS).map(([label, code]) => ({ label, code })),
    ],
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={["60%"]}
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
        <Text className="mb-2 font-display-md text-display-md text-text-primary">Language</Text>
        {rows.map((row) => {
          const active = row.code === selected;
          return (
            <Pressable
              key={row.label}
              onPress={() => {
                onSelect(row.code);
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
});
