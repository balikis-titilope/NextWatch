import { Text, View } from "react-native";
import { CALLOUT } from "../../constants/landingContent";
import { Container } from "./Container";

export function LandingCallout() {
  return (
    <View className="py-16">
      <Container className="max-w-[880px]">
        <View className="items-center rounded-lg border border-divider bg-bg-secondary px-6 py-10">
          <Text
            role="heading"
            aria-level={2}
            className="max-w-[720px] text-center font-display-lg text-display-lg text-text-primary"
          >
            {CALLOUT.heading}
          </Text>
          <Text className="mt-4 max-w-[640px] text-center font-body-lg text-body-lg text-text-secondary">
            {CALLOUT.body}
          </Text>
        </View>
      </Container>
    </View>
  );
}
