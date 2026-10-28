import { Redirect } from "expo-router";
import { useColorScheme } from "nativewind";
import { useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Chip } from "../components/Chip";
import { PosterCard } from "../components/PosterCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScoreBadge } from "../components/ScoreBadge";
import { Skeleton } from "../components/Skeleton";
import { StarRatingRow } from "../components/StarRatingRow";

const SAMPLE_POSTER = "https://image.tmdb.org/t/p/w342/qJ2tW6WMUDux911r6m7haRef0WH.jpg";

// Dev-only component gallery: checks every design.md §7 component, every
// variant and state, in both themes (AC-8) before any real screen consumes
// them. A normal route (not underscore-prefixed) so it works regardless of
// Expo Router's exclusion convention; guarded here instead so it never
// reaches a release build.
export default function ShowcaseScreen() {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const [demoRating, setDemoRating] = useState(3);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView className="flex-1 bg-bg-primary" contentContainerClassName="gap-6 px-4 py-6">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-display-md text-display-md text-text-primary">Component gallery</Text>
        <PrimaryButton
          label={colorScheme === "dark" ? "Light" : "Dark"}
          onPress={toggleColorScheme}
        />
      </View>

      <Section title="PrimaryButton — default, disabled, loading">
        <View className="gap-3">
          <PrimaryButton label="Default" onPress={() => {}} />
          <PrimaryButton label="Disabled" onPress={() => {}} disabled />
          <PrimaryButton label="Loading" onPress={() => {}} loading />
        </View>
      </Section>

      <Section title="Chip — inactive, active">
        <View className="flex-row gap-2">
          <Chip label="Inactive" active={false} onPress={() => {}} />
          <Chip label="Active" active onPress={() => {}} />
        </View>
      </Section>

      <Section title="ScoreBadge — with score, and null when undefined">
        <View className="flex-row items-center gap-3">
          <ScoreBadge score={4.2} />
          <View className="h-8 justify-center border border-dashed border-divider px-3">
            <ScoreBadge score={undefined} />
          </View>
          <Text className="font-body-sm text-body-sm text-text-secondary">
            (dashed box renders nothing)
          </Text>
        </View>
      </Section>

      <Section title="StarRatingRow — read only (md, sm)">
        <View className="gap-3">
          <StarRatingRow rating={4} size="md" />
          <StarRatingRow rating={2} size="sm" />
        </View>
      </Section>

      <Section title="StarRatingRow — interactive (tap a star)">
        <StarRatingRow rating={demoRating} size="md" onRate={setDemoRating} />
      </Section>

      <Section title="Skeleton">
        <View className="flex-row gap-3">
          <Skeleton width={100} height={150} />
          <Skeleton width={60} height={16} borderRadius={4} />
        </View>
      </Section>

      <Section title="PosterCard — grid: loaded, broken image, loading">
        <View className="flex-row flex-wrap gap-3">
          <PosterCard
            variant="grid"
            title="Sample movie"
            posterUrl={SAMPLE_POSTER}
            onPress={() => {}}
          />
          <PosterCard
            variant="grid"
            title="Falls back to placeholder"
            posterUrl="https://example.invalid/missing.jpg"
            onPress={() => {}}
          />
          <PosterCard variant="grid" title="Loading" loading onPress={() => {}} />
        </View>
      </Section>

      <Section title="PosterCard — row: loaded, no poster yet">
        <View className="flex-row gap-3">
          <PosterCard
            variant="row"
            title="Sample movie"
            posterUrl={SAMPLE_POSTER}
            onPress={() => {}}
          />
          <PosterCard variant="row" title="No poster yet" onPress={() => {}} />
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2 border-b border-divider pb-6">
      <Text className="font-label text-label text-text-secondary">{title}</Text>
      {children}
    </View>
  );
}
