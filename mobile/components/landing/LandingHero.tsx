import { LinearGradient } from "expo-linear-gradient";
import { Image, Text, View } from "react-native";
import { landingHero, landingHeroLight } from "../../assets";
import { dark, light } from "../../constants/colors.cjs";
import { HERO } from "../../constants/landingContent";
import { Container } from "./Container";
import { LandingButton } from "./LandingButton";

const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

// Both hero photos are free Pexels stock photos (Pexels license, no
// attribution required). Dark mode uses "An Empty Cinema", warmed toward the
// design's sepia tone (spec 0011 AC-15). Light mode uses a brighter theater
// photo under a cream wash, so the normal theme text stays readable. CSS (the
// `dark` class) picks which one shows, so the static HTML and the page agree.
export function LandingHero({ onCta }: { onCta: () => void }) {
  return (
    <View className="min-h-[520px] justify-center overflow-hidden">
      <View className="dark:hidden" style={FILL}>
        <Image
          source={landingHeroLight}
          resizeMode="cover"
          accessibilityLabel="A warmly lit theater auditorium with red velvet seats"
          style={FILL}
        />
        <LinearGradient
          colors={[`${light["bg-primary"]}B3`, `${light["bg-primary"]}F2`]}
          style={FILL}
        />
      </View>
      <View className="hidden dark:flex" style={FILL}>
        <Image
          source={landingHero}
          resizeMode="cover"
          accessibilityLabel="An empty cinema auditorium facing a lit screen"
          style={FILL}
        />
        <LinearGradient colors={[`${dark["bg-primary"]}99`, dark["bg-primary"]]} style={FILL} />
      </View>
      <Container className="items-center py-20">
        <Text
          role="heading"
          aria-level={1}
          className="max-w-[720px] text-center font-display-xl text-[40px] leading-[48px] text-text-primary md:text-[56px] md:leading-[64px]"
        >
          {HERO.headline}
        </Text>
        <Text className="mt-4 max-w-[560px] text-center font-body-lg text-body-lg text-text-secondary">
          {HERO.body}
        </Text>
        <View className="mt-8">
          <LandingButton label={HERO.cta} href="/(auth)/signup" onPress={onCta} />
        </View>
      </Container>
    </View>
  );
}
