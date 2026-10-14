import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FAQ } from "../../constants/landingContent";
import { Container } from "./Container";

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-b border-divider">
      <Pressable
        role="button"
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
        className="flex-row items-center justify-between py-4"
      >
        <Text className="flex-1 pr-4 font-label text-label text-text-primary">{question}</Text>
        <Text className="font-label text-label text-text-secondary">{open ? "-" : "+"}</Text>
      </Pressable>
      {open ? (
        <Text className="pb-4 font-body-md text-body-md text-text-secondary">{answer}</Text>
      ) : null}
    </View>
  );
}

// Each item keeps its own open state, so they work independently (AC-9).
export function LandingFaq() {
  return (
    <View className="bg-bg-secondary py-16">
      <Container className="max-w-[720px]">
        <Text
          role="heading"
          aria-level={2}
          className="mb-6 text-center font-display-lg text-display-lg text-text-primary"
        >
          {FAQ.heading}
        </Text>
        {FAQ.items.map((item) => (
          <FaqItem key={item.question} {...item} />
        ))}
      </Container>
    </View>
  );
}
