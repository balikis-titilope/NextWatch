import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useCardLayout } from "../hooks/useCardLayout";
import { useTheme } from "../hooks/useTheme";
import { Skeleton } from "./Skeleton";

interface Props {
  posterUrl?: string;
  title: string;
  variant: "grid" | "row";
  onPress?: () => void;
  loading?: boolean;
  // design.md §7's match badge overlay ("82%", top-right) -- rendered whenever a
  // score is available (null/undefined, incl. while still loading, omits
  // it entirely rather than showing a 0-looking badge).
  score?: number | null;
  // Spec 0010 AC-3: a small "TV" badge distinguishes a TV card in a
  // merged movie/TV list. Movie cards are unchanged (no badge) -- only
  // "tv" renders one, "movie"/undefined render nothing.
  mediaType?: "movie" | "tv";
  // Overrides the shared card width (hooks/useCardLayout.ts); height stays 1.5x.
  width?: number;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PosterCard({
  posterUrl,
  title,
  variant,
  onPress,
  loading,
  score,
  mediaType,
  width: widthOverride,
}: Props) {
  const theme = useTheme();
  const layout = useCardLayout();
  const [imageFailed, setImageFailed] = useState(false);
  const scale = useSharedValue(1);

  useEffect(() => {
    setImageFailed(false);
  }, [posterUrl]);

  // One fluid size shared by every list (see useCardLayout), not a fixed one.
  const width = widthOverride ?? (variant === "row" ? layout.rowCardWidth : layout.gridCardWidth);
  const height = width * 1.5;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const showSkeleton = loading;
  const showPlaceholder = !loading && (!posterUrl || imageFailed);

  const scoreBadge =
    !showSkeleton && score !== undefined && score !== null ? (
      <View
        style={{ position: "absolute", top: 6, right: 6 }}
        className="flex-row items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5"
      >
        <Ionicons name="sparkles" size={10} color={theme.gold} />
        <Text className="font-label text-caption font-bold text-white">{score}%</Text>
      </View>
    ) : null;

  const mediaTypeBadge =
    !showSkeleton && mediaType === "tv" ? (
      <View
        style={{ position: "absolute", top: 6, left: 6 }}
        className="rounded-md bg-black/60 px-1.5 py-0.5"
      >
        <Text className="font-label text-caption font-bold text-white">TV</Text>
      </View>
    ) : null;

  const content = showSkeleton ? (
    <Skeleton width={width} height={height} borderRadius={8} />
  ) : (
    <View style={{ width, height }}>
      {showPlaceholder ? (
        <View
          style={{ width, height, borderRadius: 8 }}
          className="items-center justify-center bg-bg-secondary"
        >
          <Ionicons name="film-outline" size={32} color={theme["text-disabled"]} />
        </View>
      ) : (
        <Image
          source={{ uri: posterUrl }}
          style={{ width, height, borderRadius: 8 }}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      )}
      {scoreBadge}
      {mediaTypeBadge}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.97);
      }}
      onPressOut={() => {
        scale.value = withSpring(1);
      }}
      // Web pointer only: a gentle lift while hovering (no-op on touch).
      onHoverIn={() => {
        scale.value = withSpring(1.05);
      }}
      onHoverOut={() => {
        scale.value = withSpring(1);
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={animatedStyle}
    >
      {content}
    </AnimatedPressable>
  );
}
