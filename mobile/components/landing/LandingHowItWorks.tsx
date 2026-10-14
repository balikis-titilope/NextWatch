import { type LayoutChangeEvent, Text, View } from "react-native";
import { HOW_IT_WORKS } from "../../constants/landingContent";
import { Container } from "./Container";

export function LandingHowItWorks({ onLayout }: { onLayout: (e: LayoutChangeEvent) => void }) {
  return (
    <View onLayout={onLayout} className="py-16">
      <Container>
        <Text
          role="heading"
          aria-level={2}
          className="text-center font-display-lg text-display-lg text-text-primary"
        >
          {HOW_IT_WORKS.heading}
        </Text>
        <Text className="mt-2 text-center font-body-lg text-body-lg text-text-secondary">
          {HOW_IT_WORKS.subheading}
        </Text>
        <View className="mt-10 gap-8 md:flex-row">
          {HOW_IT_WORKS.steps.map((step, index) => (
            <View key={step.title} className="flex-1 items-center">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-primary">
                <Text className="font-label text-label text-white">{index + 1}</Text>
              </View>
              <Text
                role="heading"
                aria-level={3}
                className="mt-4 font-display-md text-display-md text-text-primary"
              >
                {step.title}
              </Text>
              <Text className="mt-2 max-w-[280px] text-center font-body-md text-body-md text-text-secondary">
                {step.body}
              </Text>
            </View>
          ))}
        </View>
      </Container>
    </View>
  );
}
