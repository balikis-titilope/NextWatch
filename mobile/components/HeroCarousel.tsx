import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import {
  DESKTOP_BREAKPOINT,
  PAGE_MAX_WIDTH,
  SCREEN_HORIZONTAL_PADDING,
  WIDE_BREAKPOINT,
  backdropUrl,
} from "../constants/config";
import { usePageGutter } from "../hooks/usePageGutter";
import { HERO_LINES } from "../constants/heroContent";
import { useTheme } from "../hooks/useTheme";
import type { MovieCard } from "../types/api";

const ADVANCE_MS = 6000;
const FADE_MS = 500;
// Extra height under the floating header (status bar inset + 56px bar).
const HEADER_BAR = 56;
// Space kept clear at the bottom for the title row and arrows.
const TITLE_ROW_RESERVE = 100;
const HEIGHT = 320;
const HEIGHT_WIDE = 520;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

interface Props {
  // Trending titles that have a backdrop. Fewer than 2 still renders (a
  // single image, no arrows); none renders the plain gradient banner.
  slides: MovieCard[];
}

// TMDB-style home hero: a backdrop that rotates through titles on its own,
// welcome text over it, and a bottom row with the arrows either side of the
// current title (tap it to open the title).
export function HeroCarousel({ slides }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerOffset = insets.top + HEADER_BAR;
  // Same left edge as the rows below (page gutter + the screens' own inset).
  const gutter = usePageGutter() + SCREEN_HORIZONTAL_PADDING;
  const contentStyle = {
    width: "100%",
    maxWidth: PAGE_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: gutter,
  } as const;
  // Hero-sized type that grows with the window: phone, tablet, desktop.
  const titleSize = width >= DESKTOP_BREAKPOINT ? 90 : width >= WIDE_BREAKPOINT ? 80 : 44;
  const subtitleSize = width >= DESKTOP_BREAKPOINT ? 24 : width >= WIDE_BREAKPOINT ? 20 : 16;
  const [index, setIndex] = useState(0);
  const count = slides.length;
  // Slides can shrink between renders (the trending list refetches).
  const current = slides[count > 0 ? index % count : 0];

  // Re-armed on every index change, so a manual tap restarts the 6s wait
  // instead of the carousel skipping again right after it.
  useEffect(() => {
    if (count < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearTimeout(id);
  }, [index, count]);

  const step = (direction: 1 | -1) => setIndex((i) => (i + direction + count) % count);
  const copy = HERO_LINES[(count > 0 ? index % count : 0) % HERO_LINES.length];
  const uri = current ? backdropUrl(current.backdrop_path) : undefined;

  return (
    <View
      style={{ height: (width >= WIDE_BREAKPOINT ? HEIGHT_WIDE : HEIGHT) + headerOffset }}
      className="overflow-hidden bg-bg-secondary"
    >
      {uri ? (
        <Animated.View
          key={`${current.media_type}-${current.id}`}
          entering={FadeIn.duration(FADE_MS)}
          exiting={FadeOut.duration(FADE_MS)}
          style={FILL}
        >
          <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        </Animated.View>
      ) : null}
      <LinearGradient
        colors={
          uri
            ? ["rgba(0,0,0,0.7)", "rgba(0,0,0,0.2)"]
            : [theme["accent-primary"], theme["bg-secondary"]]
        }
        start={{ x: uri ? 0.5 : 0, y: 0 }}
        end={uri ? { x: 0.5, y: 0.6 } : { x: 1, y: 1 }}
        style={[FILL, uri ? null : { opacity: 0.35 }]}
      />
      {uri ? (
        // Left-to-right scrim behind the headline, easing out so there is no
        // visible edge across the artwork.
        <LinearGradient
          colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0.25)", "rgba(0,0,0,0)"]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={FILL}
        />
      ) : null}
      {uri ? (
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.75)"]}
          start={{ x: 0, y: 0.55 }}
          end={{ x: 0, y: 1 }}
          style={FILL}
        />
      ) : null}

      {/* Vertically centered between the header and the title row below,
          still left-aligned with the rest of the page. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: headerOffset,
          bottom: TITLE_ROW_RESERVE,
          justifyContent: "center",
        }}
      >
        {/* Keyed per slide so the words change, and fade in, with the poster. */}
        <Animated.View
          key={index}
          entering={FadeIn.duration(FADE_MS)}
          style={contentStyle}
          className="items-start gap-2"
        >
          <Text
            style={{ fontSize: titleSize, lineHeight: titleSize * 1.15 }}
            className={`font-hero ${uri ? "text-white" : "text-text-primary"}`}
          >
            {copy.headline}
          </Text>
          <Text
            style={{ fontSize: subtitleSize, lineHeight: subtitleSize * 1.5 }}
            className={`font-label ${uri ? "text-white" : "text-text-secondary"}`}
          >
            {copy.line}
          </Text>
        </Animated.View>
      </View>

      {uri ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 24 }}>
          <View style={contentStyle} className="flex-row items-end justify-between gap-4">
            <Pressable
              onPress={() => router.push(`/movie/${current.media_type}/${current.id}`)}
              accessibilityRole="button"
              accessibilityLabel={current.title}
              className="flex-1 gap-1"
            >
              <Text className="font-label text-caption uppercase tracking-widest text-white/70">
                Picked for you
              </Text>
              <Text
                numberOfLines={2}
                style={{ fontSize: width >= WIDE_BREAKPOINT ? 32 : 24 }}
                className="font-display-lg text-white"
              >
                {current.title}
              </Text>
            </Pressable>
            {count > 1 ? (
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => step(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="Previous title"
                  hitSlop={8}
                  className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
                >
                  <Ionicons name="chevron-back" size={22} color="white" />
                </Pressable>
                <Pressable
                  onPress={() => step(1)}
                  accessibilityRole="button"
                  accessibilityLabel="Next title"
                  hitSlop={8}
                  className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
                >
                  <Ionicons name="chevron-forward" size={22} color="white" />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
