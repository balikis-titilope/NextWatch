import type { ReactNode } from "react";
import { Image, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logo } from "../assets";
import { PAGE_MAX_WIDTH, SCREEN_HORIZONTAL_PADDING, WIDE_BREAKPOINT } from "../constants/config";
import { usePageGutter } from "../hooks/usePageGutter";
import { useHomeScrollStore } from "../store/homeScrollStore";
import { TopNavLinks } from "./TopNavLinks";

// The logo + wordmark lockup from the web landing nav (LandingNav.tsx): 32px
// rounded logo beside "NextWatch" in display-md. Rendered at the top of every
// tab screen by app/(tabs)/_layout.tsx; `right` is an optional trailing slot
// (Home's notification bell); wide windows also get the tab links in the middle.
export function AppHeader({
  right,
  transparent = false,
}: {
  right?: ReactNode;
  // Floats over a full-bleed hero (Home): no background and a white wordmark
  // until Home scrolls, then it fills in like the other tabs' header.
  transparent?: boolean;
}) {
  const gutter = usePageGutter();
  const scrolled = useHomeScrollStore((state) => state.scrolled);
  const solid = !transparent || scrolled;
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;

  return (
    <SafeAreaView edges={["top"]} className={solid ? "bg-bg-primary" : ""}>
      <View
        style={{
          width: "100%",
          maxWidth: PAGE_MAX_WIDTH,
          alignSelf: "center",
          paddingHorizontal: gutter + SCREEN_HORIZONTAL_PADDING,
        }}
        className="h-14 flex-row items-center justify-between px-4"
      >
        <View className="flex-row items-center gap-2">
          <Image
            source={logo}
            accessibilityLabel="NextWatch logo"
            style={{ width: 32, height: 32 }}
            className="rounded-lg"
          />
          <Text
            className={`font-display-md text-display-md ${solid ? "text-text-primary" : "text-white"}`}
          >
            NextWatch
          </Text>
        </View>
        {wide ? <TopNavLinks onImage={!solid} /> : null}
        {right ?? (wide ? <View className="w-6" /> : null)}
      </View>
    </SafeAreaView>
  );
}
