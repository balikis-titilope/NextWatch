import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { ratingLabel } from "../constants/ratingScale";
import { useTheme } from "../hooks/useTheme";

interface Props {
  rating: number;
  onRate?: (value: number) => void;
  size?: "sm" | "md";
  // Spell out what the stars mean ("Loved it", "It was okay"...) beside them,
  // following the pointer on web and the current rating otherwise.
  showLabel?: boolean;
}

const ICON_SIZE = { sm: 16, md: 24 } as const;

function Star({
  filled,
  size,
  onPress,
  label,
  interactive,
  onHover,
}: {
  filled: boolean;
  size: number;
  onPress?: () => void;
  label: string;
  interactive: boolean;
  onHover?: (hovering: boolean) => void;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const icon = (
    <Animated.View style={animatedStyle}>
      <Ionicons
        name={filled ? "star" : "star-outline"}
        size={size}
        color={filled ? theme.gold : theme["text-disabled"]}
      />
    </Animated.View>
  );

  if (!interactive) return icon;

  // Ensures a 44x44pt tappable area (AC-7) at every icon size, including
  // `sm` (16px), which needs more padding than `md` (24px) does.
  // react-native-web's Pressable doesn't implement `hitSlop` at all (only
  // the legacy Touchable* components do), so -pad margin cancelled by +pad
  // padding is what actually reaches 44pt on web too: it grows the
  // Pressable's own hit box without moving it in the surrounding layout,
  // keeping the star icon itself at its exact design size.
  const minTapTarget = 44;
  const pad = Math.max(0, (minTapTarget - size) / 2);

  return (
    <Pressable
      onPress={() => {
        scale.value = withSpring(1.3, {}, () => {
          scale.value = withSpring(1);
        });
        onPress?.();
      }}
      onHoverIn={() => onHover?.(true)}
      onHoverOut={() => onHover?.(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ margin: -pad, padding: pad }}
    >
      {icon}
    </Pressable>
  );
}

export function StarRatingRow({ rating, onRate, size = "md", showLabel = false }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const interactive = !!onRate;
  const iconSize = ICON_SIZE[size];
  const stars = [1, 2, 3, 4, 5];

  if (!interactive) {
    return (
      <View
        accessible
        accessibilityLabel={`Rated ${rating} out of 5 stars`}
        className="flex-row gap-1"
      >
        {stars.map((value) => (
          <Star key={value} filled={value <= rating} size={iconSize} label="" interactive={false} />
        ))}
      </View>
    );
  }

  const caption = showLabel ? ratingLabel(hovered ?? rating) : null;

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
      <View className="flex-row gap-1">
        {stars.map((value) => (
          <Star
            key={value}
            filled={value <= (hovered ?? rating)}
            size={iconSize}
            label={`Rate ${value} star${value === 1 ? "" : "s"}`}
            interactive
            onPress={() => onRate(value)}
            onHover={(hovering) => setHovered(hovering ? value : null)}
          />
        ))}
      </View>
      {caption ? (
        <Text className="font-label text-body-sm text-text-secondary">{caption}</Text>
      ) : null}
    </View>
  );
}
