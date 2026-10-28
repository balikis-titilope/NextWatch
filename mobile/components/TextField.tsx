import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, type TextInputProps } from "react-native";
import type { Ref } from "react";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { WEB_NO_FOCUS_RING } from "../constants/config";
import { useTheme } from "../hooks/useTheme";

interface Props {
  leadingIcon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  maxLength?: number;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  onFocus?: () => void;
  onBlur?: () => void;
  // Shows a trailing clear button while there is text.
  clearable?: boolean;
  inputRef?: Ref<TextInput>;
}

// design.md §7 "Input Field": bg-tertiary, 8px radius, leading icon inside
// the field, trailing eye toggle for password fields only, border animates
// to accent-primary on focus over 200ms. The border-color animation is a
// react-native-reanimated transform, so per AGENTS.md §7's StyleSheet
// exception list this is styled with StyleSheet + theme colors, not
// className.
export function TextField({
  leadingIcon,
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  maxLength,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  clearable,
  inputRef,
}: Props) {
  const theme = useTheme();
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const focusProgress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusProgress.value,
      [0, 1],
      [theme["bg-tertiary"], theme["accent-primary"]],
    ),
  }));

  return (
    <Animated.View
      style={[styles.container, { backgroundColor: theme["bg-tertiary"] }, animatedStyle]}
    >
      <Ionicons name={leadingIcon} size={20} color={theme["text-secondary"]} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme["text-secondary"]}
        secureTextEntry={hidden}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => {
          focusProgress.value = withTiming(1, { duration: 200 });
          onFocus?.();
        }}
        onBlur={() => {
          focusProgress.value = withTiming(0, { duration: 200 });
          onBlur?.();
        }}
        accessibilityLabel={accessibilityLabel}
        style={[styles.input, { color: theme["text-primary"] }, WEB_NO_FOCUS_RING]}
      />
      {clearable && value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel="Clear text"
          hitSlop={8}
        >
          <Ionicons name="close-circle" size={18} color={theme["text-secondary"]} />
        </Pressable>
      ) : null}
      {secureTextEntry ? (
        <Pressable
          onPress={() => setHidden((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={hidden ? "Show password" : "Hide password"}
          hitSlop={8}
        >
          <Ionicons
            name={hidden ? "eye-outline" : "eye-off-outline"}
            size={20}
            color={theme["text-secondary"]}
          />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
