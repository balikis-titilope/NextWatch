import { LinearGradient } from "expo-linear-gradient";
import { Text, View } from "react-native";
import { dark } from "../../constants/colors.cjs";
import { GLOBAL_CINEMA } from "../../constants/landingContent";
import { Container } from "./Container";

const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

// Region tiles are gradients with the region name on top: the design's
// tile icons are too small to crop cleanly (spec 0011 AC-15).
export function LandingGlobalCinema() {
  return (
    <View className="bg-bg-secondary py-16">
      <Container className="gap-10 md:flex-row md:items-center">
        <View className="flex-1">
          <Text
            role="heading"
            aria-level={2}
            className="font-display-lg text-display-lg text-text-primary"
          >
            {GLOBAL_CINEMA.heading}
          </Text>
          <Text className="mt-4 font-body-lg text-body-lg text-text-secondary">
            {GLOBAL_CINEMA.body}
          </Text>
        </View>
        <View className="flex-1 flex-row flex-wrap gap-4">
          {GLOBAL_CINEMA.regions.map((region) => (
            <View
              key={region}
              className="h-28 min-w-[140px] flex-1 basis-[40%] items-center justify-center overflow-hidden rounded-xl border border-divider"
            >
              <LinearGradient colors={[dark["bg-tertiary"], dark["bg-primary"]]} style={FILL} />
              <Text style={{ color: dark["text-primary"] }} className="font-label text-label">
                {region}
              </Text>
            </View>
          ))}
        </View>
      </Container>
    </View>
  );
}
