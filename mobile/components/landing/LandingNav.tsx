import { Image, Pressable, Text, View } from "react-native";
import { logo } from "../../assets";
import { NAV_LINKS, type NavSection } from "../../constants/landingContent";
import { Container } from "./Container";
import { LandingButton } from "./LandingButton";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  onNavigate: (section: NavSection) => void;
  onCta: (cta: "nav_join" | "nav_login") => void;
}

// Sits outside the page ScrollView, so it stays at the top while scrolling
// (AC-7). Below 768px only the logo, Log in and Join Now show (AC-11).
export function LandingNav({ onNavigate, onCta }: Props) {
  return (
    <View className="z-10 border-b border-divider bg-bg-primary" role="navigation">
      <Container className="h-16 flex-row items-center justify-between">
        <Pressable
          role="button"
          accessibilityLabel="NextWatch, back to top"
          onPress={() => onNavigate("top")}
          className="flex-row items-center gap-2"
        >
          <Image
            source={logo}
            accessibilityLabel="NextWatch logo"
            style={{ width: 32, height: 32 }}
            className="rounded-lg"
          />
          <Text className="hidden font-display-md text-display-md text-text-primary md:flex">
            NextWatch
          </Text>
        </Pressable>

        <View className="hidden flex-row items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Pressable
              key={link.label}
              role="button"
              onPress={() => onNavigate(link.section)}
              className="px-1 py-2"
            >
              <Text className="font-body-md text-body-md text-text-secondary">{link.label}</Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row items-center gap-1 md:gap-2">
          <ThemeToggle />
          <LandingButton
            label="Log in"
            href="/(auth)/login"
            variant="quiet"
            onPress={() => onCta("nav_login")}
          />
          <LandingButton label="Join Now" href="/(auth)/signup" onPress={() => onCta("nav_join")} />
        </View>
      </Container>
    </View>
  );
}
