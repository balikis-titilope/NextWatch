import { useEffect } from "react";
import { Image, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { logo } from "../assets";

// Rendered by app/_layout.tsx in place of the native splash (design.md
// §6.1) for as long as fonts and the launch route (spec 0004) are still
// resolving -- the icon keeps pulsing for the whole wait, however long it
// takes, rather than a one-shot loader that looks stuck on a slow network.
export function AnimatedSplashScreen() {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    scale.value = withRepeat(
      withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, scale]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // NativeWind doesn't patch reanimated's Animated.* components for
  // `className` (see Skeleton.tsx's same split) -- the plain View below
  // carries all layout/color classes, Animated.View carries only the
  // animated `style` transforms.
  return (
    <View className="flex-1 items-center justify-center bg-bg-primary px-8">
      <Animated.View style={containerStyle}>
        <View className="items-center justify-center">
          <View className="absolute h-64 w-64 rounded-full bg-accent-primary/5" />
          <View className="absolute h-44 w-44 rounded-full bg-accent-primary/10" />
          <View className="absolute h-28 w-28 rounded-full bg-accent-primary/15" />
          <Animated.View style={iconStyle}>
            <Image source={logo} style={{ width: 88, height: 88 }} className="rounded-2xl" />
          </Animated.View>
        </View>

        <Text className="mt-6 text-center text-display-xl text-text-primary">
          <Text className="font-display-md">Next</Text>
          <Text className="font-display-lg">Watch</Text>
        </Text>

        <Text className="mt-3 max-w-[240px] text-center font-body-md text-body-md text-text-secondary">
          Your next favorite film is one tap away.
        </Text>
      </Animated.View>
    </View>
  );
}
