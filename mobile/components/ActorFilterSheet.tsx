import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { forwardRef, useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { PrimaryButton } from "./PrimaryButton";
import { TextField } from "./TextField";
import { SHEET_PADDING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";

interface Props {
  value: string;
  onApply: (value: string) => void;
}

// design.md §6.5: actor input chip opens a bottom sheet with a free-text
// field -- GET /movies's `actor` param does a partial, case-insensitive
// match server-side (backend/recommend.py filter_by_actor).
export const ActorFilterSheet = forwardRef<BottomSheetModal, Props>(function ActorFilterSheet(
  { value, onApply },
  ref,
) {
  const theme = useTheme();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const apply = () => {
    onApply(draft.trim());
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
  };

  const clear = () => {
    setDraft("");
    onApply("");
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
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
        style={{ gap: 16, paddingHorizontal: SHEET_PADDING, paddingTop: 8, paddingBottom: 32 }}
      >
        <Text className="font-display-md text-display-md text-text-primary">Actor</Text>
        <TextField
          leadingIcon="person-outline"
          value={draft}
          onChangeText={setDraft}
          placeholder="Actor name"
          accessibilityLabel="Filter by actor name"
          onSubmitEditing={apply}
        />
        <PrimaryButton label="Apply" onPress={apply} />
        {value ? (
          <Pressable
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear actor filter"
          >
            <Text className="text-center font-body-md text-body-md text-text-secondary">Clear</Text>
          </Pressable>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});
