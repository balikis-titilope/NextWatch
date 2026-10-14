import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
  // When set on an active chip, a small "x" inside it dismisses the filter.
  onClear?: () => void;
}

// react-native-web's Pressable doesn't implement `hitSlop` at all (only the
// legacy Touchable* components do, confirmed in node_modules/react-native-web
// during /debug), so the 44pt tap target (AC-7) needs a real box expansion:
// -8px margin cancelled by +8px padding grows the Pressable's own hit box
// without moving it in the surrounding layout, while the visual pill (its
// own inner View) keeps its exact 28px design size.
export function Chip({ label, active, onPress, onClear }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      className="-m-2 max-w-[260px] p-2"
    >
      <View
        className={`h-7 flex-row items-center justify-center gap-1 rounded-full px-3 ${
          active ? "bg-accent-primary" : "border border-text-secondary bg-bg-secondary"
        }`}
      >
        <Text
          numberOfLines={1}
          className={`flex-shrink font-label text-body-sm ${active ? "text-white" : "text-text-secondary"}`}
        >
          {label}
        </Text>
        {active && onClear ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color="white" />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
