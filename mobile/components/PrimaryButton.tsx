import { ActivityIndicator, Pressable, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

// NativeWind doesn't patch reanimated's Animated.* components for `className`
// (a cssInterop registration on createAnimatedComponent's output proved
// unreliable: the button rendered with no fill/size/radius). So the plain
// Pressable carries every visual class and the Animated.View around it
// carries only the press-scale transform, same split as Skeleton.tsx.
export function PrimaryButton({ label, onPress, disabled, loading }: Props) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const isInactive = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        disabled={isInactive}
        onPressIn={() => {
          if (!isInactive) scale.value = withSpring(0.98);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        // Web pointer only: a slight lift while hovering.
        onHoverIn={() => {
          if (!isInactive) lift.value = withSpring(-2);
        }}
        onHoverOut={() => {
          lift.value = withSpring(0);
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isInactive, busy: !!loading }}
        hitSlop={8}
        className={`h-12 w-full items-center justify-center rounded-lg bg-accent-primary px-6 active:bg-accent-hover ${
          isInactive ? "opacity-40" : ""
        }`}
      >
        {loading ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <Text className="font-label text-label text-white">{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}
