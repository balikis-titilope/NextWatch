import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../hooks/useTheme";

type Dimension = number | `${number}%`;

interface Props {
  width: Dimension;
  height: Dimension;
  borderRadius?: number;
}

// Reanimated-driven expo-linear-gradient sweep, left to right, looping
// every 1.5s (design.md §9), used as a loading placeholder for card shaped
// layouts (e.g. inside PosterCard while its image is in flight).
export function Skeleton({ width, height, borderRadius = 8 }: Props) {
  const theme = useTheme();
  const translateX = useSharedValue(-1);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.linear }),
      -1,
      false,
    );
  }, [translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${translateX.value * 100}%` }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius }}
      className="overflow-hidden bg-bg-secondary"
    >
      <Animated.View style={[{ width: "100%", height: "100%" }, animatedStyle]}>
        <LinearGradient
          colors={[theme["bg-secondary"], theme["bg-tertiary"], theme["bg-secondary"]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: "100%", height: "100%" }}
        />
      </Animated.View>
    </View>
  );
}
