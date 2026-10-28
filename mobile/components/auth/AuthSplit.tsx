import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useEffect, useState } from "react";
import { Image, ImageBackground, Platform, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { authCinema, logo } from "../../assets";
import { AUTH_PANEL, AUTH_QUOTES, QUOTE_INTERVAL_MS } from "../../constants/authPanelContent";
import { dark } from "../../constants/colors.cjs";

const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
const PERFORATIONS = Array.from({ length: 24 });

// A strip of film-style holes down the panel edge.
function FilmStrip() {
  return (
    <View
      accessibilityElementsHidden
      aria-hidden
      className="absolute bottom-0 right-0 top-0 w-6 justify-around py-2"
      style={{ backgroundColor: dark["bg-primary"] }}
    >
      {PERFORATIONS.map((_, index) => (
        <View
          key={index}
          className="h-3 w-3 self-center rounded-sm"
          style={{ backgroundColor: dark["bg-tertiary"] }}
        />
      ))}
    </View>
  );
}

function RotatingQuote() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % AUTH_QUOTES.length), QUOTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const quote = AUTH_QUOTES[index];
  return (
    <Animated.View key={index} entering={FadeIn.duration(600)} className="min-h-[72px]">
      <Text
        style={{ color: dark["text-primary"] }}
        className="font-display-md text-display-md italic"
      >
        “{quote.line}”
      </Text>
      <Text style={{ color: dark["text-secondary"] }} className="mt-1 font-body-md text-body-md">
        {quote.film}
      </Text>
    </Animated.View>
  );
}

// Web only, 768px and wider (spec 0012): a cinematic panel beside the form.
// On native and on phone width this renders just the form, unchanged.
export function AuthSplit({
  variant,
  children,
}: {
  variant: "login" | "signup" | "forgot" | "reset";
  children: ReactNode;
}) {
  if (Platform.OS !== "web") return <>{children}</>;

  const copy = AUTH_PANEL[variant];
  return (
    <View className="flex-1 md:flex-row">
      <ImageBackground
        source={authCinema}
        resizeMode="cover"
        accessibilityElementsHidden
        aria-hidden
        className="hidden flex-1 justify-between overflow-hidden p-12 md:flex"
      >
        <LinearGradient
          colors={[`${dark["bg-primary"]}66`, `${dark["bg-primary"]}E6`]}
          style={FILL}
        />
        <View className="flex-row items-center gap-3">
          <Image source={logo} style={{ width: 40, height: 40 }} className="rounded-lg" />
          <Text style={{ color: dark["text-primary"] }} className="font-display-md text-display-md">
            NextWatch
          </Text>
        </View>

        <View className="max-w-[460px]">
          <Text
            style={{ color: dark["text-primary"] }}
            className="font-display-xl text-[40px] leading-[48px]"
          >
            {copy.headline}
          </Text>
          <Text
            style={{ color: dark["text-secondary"] }}
            className="mt-3 font-body-lg text-body-lg"
          >
            {copy.body}
          </Text>
          <View className="my-8 h-px w-16" style={{ backgroundColor: dark["accent-primary"] }} />
          <RotatingQuote />
        </View>
        <FilmStrip />
      </ImageBackground>
      <View className="flex-1">{children}</View>
    </View>
  );
}
