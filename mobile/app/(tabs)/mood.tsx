import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { MoodTextArea } from "../../components/MoodTextArea";
import { PosterCard } from "../../components/PosterCard";
import { PrimaryButton } from "../../components/PrimaryButton";
import { PAGE_MAX_WIDTH, POSTER_GRID_GAP, posterUrl } from "../../constants/config";
import { useCardLayout } from "../../hooks/useCardLayout";
import { useMoodRecommendations } from "../../hooks/useMoodRecommendations";
import { usePageGutter } from "../../hooks/usePageGutter";
import { useSectionGap } from "../../hooks/useSectionGap";
import { useTheme } from "../../hooks/useTheme";
import { apiErrorMessage } from "../../lib/api";
import { isLoadedTitle } from "../../lib/titles";
import type { MediaType, MovieCard } from "../../types/api";

const GRID_SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];
// design.md doesn't fix a page size for Mood results -- a local detail
// (like Search's unbounded /movies grid), picked to fill a couple of grid
// rows per submission.
const MOOD_RESULTS_COUNT = 20;

// Cycled through as the box's placeholder, as a hint of what to write. They
// are only inspiration: the user types their own words.
const MOOD_EXAMPLES = [
  "A rainy Sunday and a big blanket",
  "Something to make me laugh after a rough day",
  "A tense thriller I can't look away from",
  "Nostalgic, like summers when I was a kid",
  "A slow, beautiful film I can get lost in",
];
const PLACEHOLDER_MS = 4000;

// Replaces the old taste/mood slider with three plain choices. The weight is
// the backend's mood_weight: 0 = all taste, 1 = all mood.
const BLENDS = [
  {
    id: "taste",
    weight: 0.25,
    title: "My taste first",
    description: "Mostly films you'd already love, nudged by your mood.",
  },
  {
    id: "balanced",
    weight: 0.5,
    title: "Balanced",
    description: "An even mix of what you love and how you feel.",
  },
  {
    id: "mood",
    weight: 0.8,
    title: "My mood first",
    description: "Follows your words closely. Your taste counts for less.",
  },
] as const;

function openMovie(id: number, mediaType: MediaType) {
  router.push(`/movie/${mediaType}/${id}`);
}

// design.md §6.7's "subtle animated prompt" for the pre-submit empty
// state -- a gentle opacity pulse, same withRepeat/withTiming idiom as
// Skeleton's loading sweep.
function MoodPrompt() {
  const theme = useTheme();
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View className="items-center justify-center gap-3 px-8 py-4">
      <Animated.View style={animatedStyle}>
        <Ionicons name="sparkles-outline" size={40} color={theme["text-disabled"]} />
      </Animated.View>
      {/* Plain Text carries the classes: NativeWind ignores className on
          Animated.Text, which rendered this in default black. */}
      <Animated.View style={animatedStyle}>
        <Text className="text-center font-body-md text-body-md text-text-secondary">
          Describe a feeling, a vibe, or a whole scene.
        </Text>
      </Animated.View>
    </View>
  );
}

export default function MoodScreen() {
  const theme = useTheme();
  const blockGap = useSectionGap() / 2;
  const gutter = usePageGutter();
  const { columns: numColumns, gridCardWidth } = useCardLayout();
  const [moodText, setMoodText] = useState("");
  const [blendId, setBlendId] = useState<(typeof BLENDS)[number]["id"]>("balanced");
  const mood = useMoodRecommendations();
  // While the box is empty its placeholder cycles through the examples.
  const [exampleIndex, setExampleIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setExampleIndex((index) => (index + 1) % MOOD_EXAMPLES.length),
      PLACEHOLDER_MS,
    );
    return () => clearInterval(id);
  }, []);
  const placeholder = `${MOOD_EXAMPLES[exampleIndex]}…`;

  const trimmedMood = moodText.trim();
  const canSubmit = trimmedMood.length > 0 && !mood.isPending;
  const blend = BLENDS.find((option) => option.id === blendId) ?? BLENDS[1];

  const handleSubmit = () => {
    if (!trimmedMood) return;
    mood.mutate({ moodText: trimmedMood, moodWeight: blend.weight, topN: MOOD_RESULTS_COUNT });
  };

  const results = (mood.data ?? []).filter(isLoadedTitle);
  const showResults = mood.isSuccess && results.length > 0;
  const showNoResults = mood.isSuccess && results.length === 0;
  const gridData: (string | MovieCard)[] = mood.isPending
    ? GRID_SKELETON_KEYS
    : showResults
      ? results
      : [];

  // The whole page is the list's header plus the grid, so it scrolls as one.
  const header = (
    <View>
      <View className="gap-1 px-4 pt-6">
        <Text className="font-display-lg text-display-lg text-text-primary">Mood Discovery</Text>
        <Text className="font-body-md text-body-md text-text-secondary">
          Tell us how you&apos;re feeling and we&apos;ll find something to match, shaped by the
          films you&apos;ve rated.
        </Text>
      </View>

      <View style={{ marginTop: blockGap }} className="gap-3 px-4">
        <MoodTextArea
          value={moodText}
          onChangeText={setMoodText}
          placeholder={placeholder}
          accessibilityLabel="Describe your mood"
        />
        {mood.isIdle ? <MoodPrompt /> : null}
      </View>

      <View style={{ marginTop: blockGap }} className="gap-3 px-4">
        <View className="gap-1">
          <Text className="font-display-md text-display-md text-text-primary">
            How much should your mood count?
          </Text>
          <Text className="font-body-sm text-body-sm text-text-secondary">
            Your taste comes from the films you&apos;ve rated. Pick how much the words above should
            steer the results.
          </Text>
        </View>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-3">
          {BLENDS.map((option) => {
            const selected = option.id === blendId;
            return (
              <Pressable
                key={option.id}
                onPress={() => setBlendId(option.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${option.title}. ${option.description}`}
                style={{ minWidth: 200, flexGrow: 1, flexBasis: 0, opacity: selected ? 1 : 0.65 }}
                className={`gap-1 rounded-xl border p-5 ${
                  selected
                    ? "border-accent-primary bg-bg-secondary"
                    : "border-bg-tertiary bg-bg-secondary"
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="font-label text-body-md text-text-primary">{option.title}</Text>
                  <View
                    style={{
                      borderColor: selected ? theme["accent-primary"] : theme["text-disabled"],
                    }}
                    className="h-5 w-5 items-center justify-center rounded-full border-2"
                  >
                    {selected ? (
                      <View
                        style={{ backgroundColor: theme["accent-primary"] }}
                        className="h-2.5 w-2.5 rounded-full"
                      />
                    ) : null}
                  </View>
                </View>
                <Text className="font-body-sm text-body-sm text-text-secondary">
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ alignSelf: "center", width: "100%", maxWidth: 320 }} className="mt-2 gap-2">
          <PrimaryButton
            label="Find Movies"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={mood.isPending}
          />
          {!trimmedMood && !mood.isPending ? (
            <Text className="text-center font-body-sm text-body-sm text-text-secondary">
              Describe your mood to continue
            </Text>
          ) : null}
        </View>
      </View>

      {showResults || mood.isPending ? (
        <Text
          style={{ marginTop: blockGap }}
          className="mb-4 px-4 font-display-md text-display-md text-text-primary"
        >
          Matches for your mood
        </Text>
      ) : (
        <View style={{ height: blockGap }} />
      )}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary">
      {/* A soft accent glow behind the heading, like Home and Search. */}
      <LinearGradient
        pointerEvents="none"
        colors={[`${theme["accent-primary"]}33`, `${theme["accent-primary"]}00`]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 280 }}
      />
      <FlatList
        key={numColumns}
        data={gridData}
        keyExtractor={(item) => (typeof item === "string" ? item : `${item.media_type}-${item.id}`)}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: POSTER_GRID_GAP, paddingHorizontal: 16 }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: PAGE_MAX_WIDTH,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingBottom: 24,
          rowGap: 16,
        }}
        ListHeaderComponent={header}
        renderItem={({ item }) =>
          typeof item === "string" ? (
            <PosterCard title="" variant="grid" loading />
          ) : (
            <View style={{ width: gridCardWidth }}>
              <PosterCard
                posterUrl={posterUrl(item.poster_path)}
                title={item.title}
                variant="grid"
                score={item.predicted_score}
                mediaType={item.media_type}
                onPress={() => openMovie(item.id, item.media_type)}
              />
              <Text numberOfLines={1} className="mt-2 font-label text-body-sm text-text-primary">
                {item.title}
              </Text>
            </View>
          )
        }
        ListEmptyComponent={
          mood.isError ? (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
              <Text className="text-center font-body-md text-body-md text-text-secondary">
                {apiErrorMessage(mood.error, "Couldn't find movies for that mood. Try again.")}
              </Text>
              <PrimaryButton label="Retry" onPress={handleSubmit} />
            </View>
          ) : showNoResults ? (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="film-outline" size={64} color={theme["text-disabled"]} />
              <Text className="text-center font-body-lg text-body-lg text-text-primary">
                No movies matched that mood
              </Text>
              <Text className="text-center font-body-sm text-body-sm text-text-secondary">
                Try describing it differently, or choose &quot;My taste first&quot;.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
