import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Image, Pressable, Text, View, useWindowDimensions } from "react-native";
import { WIDE_BREAKPOINT, backdropUrl } from "../constants/config";
import { useSectionGap } from "../hooks/useSectionGap";
import type { MovieCard } from "../types/api";

const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

// One editorial break between Home's scrolling rows: a single wide backdrop
// with the title over it. Sits inside the page column, so it shares the rows'
// left edge.
export function SpotlightCard({ card }: { card: MovieCard }) {
  const { width } = useWindowDimensions();
  const sectionGap = useSectionGap();
  const wide = width >= WIDE_BREAKPOINT;
  const uri = backdropUrl(card.backdrop_path);
  if (!uri) return null;
  const year = card.release_date?.slice(0, 4);

  return (
    <View style={{ marginTop: sectionGap }} className="px-4">
      <Pressable
        onPress={() => router.push(`/movie/${card.media_type}/${card.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Spotlight: ${card.title}`}
        style={{ height: wide ? 420 : 280 }}
        className="overflow-hidden rounded-2xl bg-bg-secondary"
      >
        <Image source={{ uri }} style={FILL} resizeMode="cover" />
        <LinearGradient
          colors={["rgba(0,0,0,0.85)", "rgba(0,0,0,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 0.8, y: 0.5 }}
          style={FILL}
        />
        <View style={{ padding: wide ? 48 : 28 }} className="flex-1 justify-end gap-3">
          <Text className="font-label text-caption uppercase tracking-widest text-white/70">
            Spotlight
          </Text>
          <Text
            numberOfLines={2}
            style={{ fontSize: wide ? 40 : 26, maxWidth: 560 }}
            className="font-display-xl text-white"
          >
            {card.title}
          </Text>
          <View className="mt-2 flex-row items-center gap-3">
            <View className="rounded-full bg-accent-primary px-4 py-2">
              <Text className="font-label text-body-sm text-white">View details</Text>
            </View>
            <Text className="font-body-md text-body-md text-white/80">
              {card.predicted_score !== null
                ? `${card.predicted_score}% match for you`
                : "Highly rated"}
              {year ? ` · ${year}` : ""}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}
