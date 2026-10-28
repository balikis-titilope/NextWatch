import { Link } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { logo } from "../../assets";
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_URL } from "../../constants/config";
import { FOOTER } from "../../constants/landingContent";
import { Container } from "./Container";

const EXTERNAL_LINKS = [
  { label: FOOTER.privacy, href: PRIVACY_POLICY_URL },
  { label: FOOTER.terms, href: TERMS_URL },
  { label: FOOTER.contact, href: SUPPORT_URL },
];

// Real anchors opening in a new tab, so they are crawlable (spec 0011).
export function LandingFooter({ onFeatures }: { onFeatures: () => void }) {
  return (
    <View className="border-t border-divider py-10" role="contentinfo">
      <Container className="gap-6 md:flex-row md:items-center md:justify-between">
        <View className="flex-row items-center gap-2">
          <Image
            source={logo}
            accessibilityLabel="NextWatch logo"
            style={{ width: 28, height: 28 }}
            className="rounded-md"
          />
          <Text className="font-display-md text-display-md text-text-primary">NextWatch</Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-x-6 gap-y-2">
          <Pressable role="button" onPress={onFeatures}>
            <Text className="font-body-md text-body-md text-text-secondary">{FOOTER.features}</Text>
          </Pressable>
          {EXTERNAL_LINKS.map((link) => (
            <Link key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
              <Text className="font-body-md text-body-md text-text-secondary">{link.label}</Text>
            </Link>
          ))}
        </View>
        <Text className="font-body-sm text-body-sm text-text-secondary">{FOOTER.copyright}</Text>
      </Container>
    </View>
  );
}
