import { TextInput } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { WEB_NO_FOCUS_RING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}

// design.md §6.7's mood input: multi-line, bg-secondary (unlike the
// generic Input Field's bg-tertiary in §7, since this is the screen's
// primary surface, not a form field). Border-color focus animation
// mirrors TextField's, a react-native-reanimated transform, so per
// AGENTS.md §7's StyleSheet exception list this stays out of className.
export function MoodTextArea({ value, onChangeText, placeholder, accessibilityLabel }: Props) {
  const theme = useTheme();
  const focusProgress = useSharedValue(0);

  // On focus the border turns accent.
  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [theme["bg-tertiary"], theme["accent-primary"]],
    ),
  }));

  return (
    <Animated.View
      // Fill via style, not className: NativeWind ignores className on
      // Reanimated's Animated.View, which left this with no background.
      style={[
        {
          borderRadius: 12,
          borderWidth: 1,
          padding: 16,
          backgroundColor: theme["bg-secondary"],
        },
        animatedStyle,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={`${theme["text-primary"]}99`}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        onFocus={() => {
          focusProgress.value = withTiming(1, { duration: 200 });
        }}
        onBlur={() => {
          focusProgress.value = withTiming(0, { duration: 200 });
        }}
        accessibilityLabel={accessibilityLabel}
        style={[
          { minHeight: 128, fontSize: 18, lineHeight: 26, color: theme["text-primary"] },
          // The container draws the focus border; drop the browser's own ring.
          WEB_NO_FOCUS_RING,
        ]}
      />
    </Animated.View>
  );
}
