import type { ReactNode } from "react";
import { ImageBackground, type LayoutChangeEvent, Text, View } from "react-native";
import { landingBokeh } from "../../assets";
import { DIFFERENCE } from "../../constants/landingContent";
import { Container } from "./Container";

function Title({ children }: { children: string }) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className="font-display-md text-display-md text-text-primary"
    >
      {children}
    </Text>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View
      className={`overflow-hidden rounded-xl border border-divider bg-bg-secondary ${className}`}
    >
      {children}
    </View>
  );
}

export function LandingDifference({ onLayout }: { onLayout: (e: LayoutChangeEvent) => void }) {
  return (
    <View onLayout={onLayout} className="py-16">
      <Container>
        <Text
          role="heading"
          aria-level={2}
          className="text-center font-display-lg text-display-lg text-text-primary"
        >
          {DIFFERENCE.heading}
        </Text>
        <Text className="mt-2 text-center font-body-lg text-body-lg text-text-secondary">
          {DIFFERENCE.subheading}
        </Text>

        <View className="mt-10 gap-4">
          <View className="gap-4 md:flex-row">
            <Card className="flex-1 md:flex-[2]">
              <ImageBackground
                source={landingBokeh}
                resizeMode="cover"
                imageStyle={{ left: "35%" }}
                className="min-h-[220px] justify-between p-6"
              >
                <View className="max-w-[360px]">
                  <Title>{DIFFERENCE.moodTitle}</Title>
                  <Text className="mt-2 font-body-md text-body-md text-text-secondary">
                    {DIFFERENCE.moodBody}
                  </Text>
                </View>
                <View className="mt-6 flex-row flex-wrap gap-2">
                  {DIFFERENCE.moodChips.map((chip, index) => (
                    <View
                      key={chip}
                      className={`rounded-full border px-3 py-1 ${
                        index === 2 ? "border-accent-primary bg-accent-primary" : "border-divider"
                      }`}
                    >
                      <Text
                        className={`font-body-sm text-body-sm ${
                          index === 2 ? "text-white" : "text-text-primary"
                        }`}
                      >
                        {chip}
                      </Text>
                    </View>
                  ))}
                </View>
              </ImageBackground>
            </Card>

            <Card className="flex-1 items-center p-6">
              <View className="h-24 w-16 items-center justify-end rounded-md bg-bg-tertiary pb-2">
                <View className="rounded-full bg-gold px-2 py-0.5">
                  <Text className="font-body-sm text-body-sm text-bg-primary">
                    ★ {DIFFERENCE.matchExample}
                  </Text>
                </View>
              </View>
              <View className="mt-4 items-center">
                <Title>{DIFFERENCE.matchTitle}</Title>
                <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
                  {DIFFERENCE.matchBody}
                </Text>
              </View>
            </Card>
          </View>

          <Card className="gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <View className="max-w-[420px]">
              <Title>{DIFFERENCE.tasteTitle}</Title>
              <Text className="mt-2 font-body-md text-body-md text-text-secondary">
                {DIFFERENCE.tasteBody}
              </Text>
            </View>
            <Text
              accessibilityLabel="Five out of five stars"
              className="font-display-md text-display-md text-gold"
            >
              ★★★★★
            </Text>
          </Card>
        </View>
      </Container>
    </View>
  );
}
