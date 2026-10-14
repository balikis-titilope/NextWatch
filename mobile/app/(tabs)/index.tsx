import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HeroCarousel } from "../../components/HeroCarousel";
import { PageColumn } from "../../components/PageColumn";
import { PosterCard } from "../../components/PosterCard";
import { SpotlightCard } from "../../components/SpotlightCard";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { POSTER_GRID_GAP, posterUrl } from "../../constants/config";
import { useBrowseMovies } from "../../hooks/useBrowseMovies";
import { useCardLayout } from "../../hooks/useCardLayout";
import { useSectionGap } from "../../hooks/useSectionGap";
import { useMyRatings } from "../../hooks/useMyRatings";
import { useRecommendations } from "../../hooks/useRecommendations";
import { useSimilarRows } from "../../hooks/useSimilarRows";
import { useTheme } from "../../hooks/useTheme";
import { useHomeScrollStore } from "../../store/homeScrollStore";
import { useTrending } from "../../hooks/useTrending";
import { apiErrorMessage } from "../../lib/api";
import { dedupeRows, isLoadedTitle, pickBecauseSeeds, pickSpotlight } from "../../lib/titles";
import type { BrowseMovie, MediaType } from "../../types/api";

// design.md §6.4's rows all pull the same page size; the spec doesn't
// distinguish per-row limits.
const ROW_TOP_N = 10;
const HERO_SLIDES = 5;
// Trending is fetched wider than a row so the Movies/TV toggle still has
// enough cards left after filtering client-side (GET /movies/trending has no
// media-type param).
const TRENDING_FETCH_N = 30;
const TRENDING_OPTIONS = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV" },
] as const;
const POPULAR_OPTIONS = [
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV" },
] as const;
// AC-13: up to the 3 most recent 4-5 star ratings, GET /me/ratings is
// already ordered most-recent-first.
const BECAUSE_YOU_LIKED_LIMIT = 3;
// Fetched wider than a row so titles dropped as repeats still leave a full row.
const SIMILAR_FETCH_N = 20;
const ROW_SKELETON_KEYS = ["s1", "s2", "s3", "s4"];

function openMovie(id: number, mediaType: MediaType) {
  router.push(`/movie/${mediaType}/${id}`);
}

type RowItem = Pick<BrowseMovie, "id" | "media_type" | "title" | "poster_path"> & {
  predicted_score?: number | null;
};

// A full-bleed strip in the theme's lighter surface color, so the page
// alternates between two backgrounds instead of one flat color. Its content
// stays in the shared page column.
function Band({ children }: { children: ReactNode }) {
  const sectionGap = useSectionGap();
  return (
    <View
      style={{ marginTop: sectionGap, paddingBottom: sectionGap / 2 }}
      className="bg-bg-secondary"
    >
      <PageColumn fill={false}>{children}</PageColumn>
    </View>
  );
}

function MovieRow({
  title,
  cards,
  loading,
  headerRight,
  inBand,
  hideScores,
}: {
  title: string;
  cards: RowItem[];
  loading?: boolean;
  headerRight?: ReactNode;
  // Sits inside a Band, which already supplies the space above it.
  inBand?: boolean;
  // Plain-similarity rows ("Because you liked X"): the percentage there is not
  // on the same scale as the match score, so no badge.
  hideScores?: boolean;
}) {
  const { rowCardWidth } = useCardLayout();
  const sectionGap = useSectionGap();
  const shown = cards.filter(isLoadedTitle);

  if (!loading && shown.length === 0 && !headerRight) return null;

  return (
    <View style={{ marginTop: inBand ? sectionGap / 2 : sectionGap }}>
      <View className="flex-row items-center gap-3 px-4">
        <Text className="flex-shrink font-display-md text-display-md text-text-primary">
          {title}
        </Text>
        {headerRight}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: POSTER_GRID_GAP, paddingHorizontal: 16, paddingTop: 20 }}
      >
        {loading
          ? ROW_SKELETON_KEYS.map((key) => <PosterCard key={key} title="" variant="row" loading />)
          : shown.map((card) => (
              <View key={`${card.media_type}-${card.id}`} style={{ width: rowCardWidth }}>
                <PosterCard
                  posterUrl={posterUrl(card.poster_path)}
                  title={card.title}
                  variant="row"
                  score={hideScores ? undefined : card.predicted_score}
                  mediaType={card.media_type}
                  onPress={() => openMovie(card.id, card.media_type)}
                />
                <Text
                  numberOfLines={1}
                  className="mt-1.5 font-body-sm text-body-sm text-text-primary"
                >
                  {card.title}
                </Text>
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

// Scroll distance after which the floating header gets its background.
const SCROLLED_OFFSET = 24;

export default function HomeScreen() {
  const setScrolled = useHomeScrollStore((state) => state.setScrolled);
  // The header outlives this screen; don't leave it solid after leaving Home.
  useEffect(() => () => setScrolled(false), [setScrolled]);
  const theme = useTheme();
  const sectionGap = useSectionGap();
  const [trendingFilter, setTrendingFilter] = useState<"all" | MediaType>("all");
  const [popularType, setPopularType] = useState<MediaType>("movie");
  const recommendations = useRecommendations(ROW_TOP_N);
  const trending = useTrending(TRENDING_FETCH_N);
  const popular = useBrowseMovies({ mediaType: popularType, personalized: true });
  const ratings = useMyRatings();

  const forYou = recommendations.data ?? [];
  const trendingList = (trending.data ?? [])
    .filter((card) => trendingFilter === "all" || card.media_type === trendingFilter)
    .slice(0, ROW_TOP_N);
  // The top pick (first in the taste-ordered list) gets the full-width
  // Spotlight card; the hero carousel rotates through the titles after it.
  const spotlight = pickSpotlight(trending.data ?? []);
  const heroSlides = (trending.data ?? [])
    .filter(
      (card) =>
        card.backdrop_path &&
        isLoadedTitle(card) &&
        !(card.id === spotlight?.id && card.media_type === spotlight?.media_type),
    )
    .slice(0, HERO_SLIDES);
  // AC-3: [] (not an error) means no usable taste signal yet.
  const showRatePrompt = recommendations.isSuccess && forYou.length === 0;

  // "Because you liked X": X is a recent 5-star (then 4-star) rating; each row
  // leaves out what's already shown above it, what the user has rated, and X.
  const seeds = pickBecauseSeeds(ratings.data ?? [], BECAUSE_YOU_LIKED_LIMIT);
  const similarRows = useSimilarRows(seeds, SIMILAR_FETCH_N);
  const seen = new Set<string>([
    ...forYou.map((card) => `${card.media_type}-${card.id}`),
    ...(ratings.data ?? []).map((entry) => `${entry.media_type}-${entry.movie_id}`),
  ]);
  const becauseRows = dedupeRows(similarRows, seen, ROW_TOP_N);

  return (
    // No top edge: the transparent header floats over the full-bleed hero,
    // which pads itself below the status bar.
    <SafeAreaView edges={[]} className="flex-1 bg-bg-primary">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > SCROLLED_OFFSET)}
      >
        <HeroCarousel slides={heroSlides} />
        <PageColumn fill={false}>
          {recommendations.isError ? (
            <View style={{ marginTop: sectionGap }} className="items-center gap-2 px-4">
              <Ionicons name="alert-circle-outline" size={32} color={theme.error} />
              <Text className="text-center font-body-sm text-body-sm text-text-secondary">
                {apiErrorMessage(recommendations.error, "Couldn't load your recommendations.")}
              </Text>
            </View>
          ) : null}

          {showRatePrompt ? (
            <View style={{ marginTop: sectionGap }} className="items-center gap-2 px-4">
              <Ionicons name="star-outline" size={32} color={theme["text-disabled"]} />
              <Text className="text-center font-body-md text-body-md text-text-primary">
                Rate a few movies to get your For You picks
              </Text>
              <Text className="text-center font-body-sm text-body-sm text-text-secondary">
                Search for a movie you&apos;ve seen and rate it to teach NextWatch your taste.
              </Text>
            </View>
          ) : null}

          <MovieRow title="For You" cards={forYou} loading={recommendations.isLoading} />
        </PageColumn>

        <Band>
          <MovieRow
            inBand
            title="Top Rated Picks"
            cards={trendingList}
            loading={trending.isLoading}
            headerRight={
              <SegmentedToggle
                options={[...TRENDING_OPTIONS]}
                value={trendingFilter}
                onChange={setTrendingFilter}
              />
            }
          />
        </Band>

        <PageColumn fill={false}>
          {spotlight ? <SpotlightCard card={spotlight} /> : null}
        </PageColumn>

        <Band>
          <MovieRow
            inBand
            title="Popular Picks"
            cards={(popular.data ?? []).slice(0, ROW_TOP_N)}
            loading={popular.isLoading}
            headerRight={
              <SegmentedToggle
                options={[...POPULAR_OPTIONS]}
                value={popularType}
                onChange={setPopularType}
              />
            }
          />
        </Band>

        <PageColumn fill={false}>
          {seeds.map((seed, i) => (
            <MovieRow
              key={`${seed.media_type}-${seed.movie_id}`}
              title={`Because you liked ${seed.title}`}
              cards={becauseRows[i]}
              hideScores
            />
          ))}
        </PageColumn>
      </ScrollView>
    </SafeAreaView>
  );
}
