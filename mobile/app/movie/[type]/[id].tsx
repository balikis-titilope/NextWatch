import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip } from "../../../components/Chip";
import { PosterCard } from "../../../components/PosterCard";
import { PrimaryButton } from "../../../components/PrimaryButton";
import { ScoreBadge } from "../../../components/ScoreBadge";
import { Skeleton } from "../../../components/Skeleton";
import { StarRatingRow } from "../../../components/StarRatingRow";
import {
  backdropUrl,
  castPhotoUrl,
  languageLabel,
  posterUrl,
  providerLogoUrl,
  WIDE_BREAKPOINT,
} from "../../../constants/config";
import { useCardLayout } from "../../../hooks/useCardLayout";
import { useMovieDetail } from "../../../hooks/useMovieDetail";
import { useRateMovie } from "../../../hooks/useRateMovie";
import { useSimilarMovies } from "../../../hooks/useSimilarMovies";
import { useTheme } from "../../../hooks/useTheme";
import { apiErrorMessage } from "../../../lib/api";
import type { MediaType, MovieDetail, WatchProvider } from "../../../types/api";

const SIMILAR_TOP_N = 10;
const OVERVIEW_COLLAPSED_LINES = 3;

function formatRuntime(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// Spec 0010 AC-4: a TV show has no single season count in one word the
// way a movie has one runtime -- "3 Seasons, 24 Episodes" mirrors the
// same "one info line" pattern a movie's runtime already uses.
function formatSeasonsEpisodes(seasons: number | null, episodes: number | null): string | null {
  const parts: string[] = [];
  if (seasons) parts.push(`${seasons} Season${seasons === 1 ? "" : "s"}`);
  if (episodes) parts.push(`${episodes} Episode${episodes === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function CastAvatar({ name, profilePath }: { name: string; profilePath: string | null }) {
  const theme = useTheme();
  const uri = castPhotoUrl(profilePath);

  return (
    <View className="w-16 items-center gap-1.5">
      {uri ? (
        <Image source={{ uri }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      ) : (
        <View
          style={{ width: 56, height: 56, borderRadius: 28 }}
          className="items-center justify-center bg-bg-secondary"
        >
          <Ionicons name="person-outline" size={24} color={theme["text-disabled"]} />
        </View>
      )}
      <Text numberOfLines={2} className="text-center font-caption text-caption text-text-secondary">
        {name}
      </Text>
    </View>
  );
}

const WATCH_TABS = [
  { key: "stream", label: "Stream" },
  { key: "rent", label: "Rent" },
  { key: "buy", label: "Buy" },
] as const;
type WatchTabKey = (typeof WATCH_TABS)[number]["key"];

function ProviderLogo({ provider }: { provider: WatchProvider }) {
  const uri = providerLogoUrl(provider.logo_path);
  return (
    <View className="items-center gap-1">
      {uri ? (
        <Image source={{ uri }} style={{ width: 40, height: 40, borderRadius: 8 }} />
      ) : (
        <View
          style={{ width: 40, height: 40, borderRadius: 8 }}
          className="items-center justify-center bg-bg-secondary"
        >
          <Ionicons name="tv-outline" size={18} />
        </View>
      )}
      {provider.name ? (
        <Text
          numberOfLines={1}
          style={{ width: 56 }}
          className="text-center font-caption text-caption text-text-secondary"
        >
          {provider.name}
        </Text>
      ) : null}
    </View>
  );
}

function WhereToWatch({ providers }: { providers: MovieDetail["watch_providers"] }) {
  const nonEmpty = WATCH_TABS.filter((tab) => providers[tab.key].length > 0);
  const [activeTab, setActiveTab] = useState<WatchTabKey | null>(nonEmpty[0]?.key ?? null);

  if (nonEmpty.length === 0 || activeTab === null) return null;

  return (
    <View className="mt-6 px-4">
      <Text className="font-display-sm text-display-sm text-text-primary">Where to Watch</Text>
      <View className="mt-3 flex-row gap-2">
        {nonEmpty.map((tab) => (
          <Chip
            key={tab.key}
            label={tab.label}
            active={activeTab === tab.key}
            onPress={() => setActiveTab(tab.key)}
          />
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 16, paddingTop: 12 }}
      >
        {providers[activeTab].map((provider, index) => (
          <ProviderLogo key={`${provider.name ?? "provider"}-${index}`} provider={provider} />
        ))}
      </ScrollView>
    </View>
  );
}

function SimilarMoviesRow({ mediaType, movieId }: { mediaType: MediaType; movieId: number }) {
  const similar = useSimilarMovies(mediaType, movieId, SIMILAR_TOP_N);
  // PosterCard sizes itself from the shared row width, so the wrapper must
  // match it or neighbouring posters overlap.
  const { rowCardWidth } = useCardLayout();
  if (!similar.data || similar.data.length === 0) return null;

  return (
    <View className="mt-10">
      <Text className="font-display-sm text-display-sm px-4 text-text-primary">Similar</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 20 }}
      >
        {similar.data.map((card) => (
          <View key={`${card.media_type}-${card.id}`} style={{ width: rowCardWidth }}>
            <PosterCard
              posterUrl={posterUrl(card.poster_path)}
              title={card.title}
              variant="row"
              score={card.predicted_score}
              mediaType={card.media_type}
              onPress={() => router.push(`/movie/${card.media_type}/${card.id}`)}
            />
            <Text numberOfLines={1} className="mt-1.5 font-body-sm text-body-sm text-text-primary">
              {card.title}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export default function MovieDetailScreen() {
  const theme = useTheme();
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const mediaType: MediaType = type === "tv" ? "tv" : "movie";
  const movieId = Number(id);
  const detail = useMovieDetail(mediaType, movieId);
  const rate = useRateMovie();
  const { width } = useWindowDimensions();
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  // Optimistic local override so the star row responds instantly; falls
  // back to the server's own user_rating once it's known/refetched (AC-6).
  const [pendingRating, setPendingRating] = useState<number | null>(null);

  if (detail.isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary">
        <View className="px-4 pt-4">
          <Skeleton width="100%" height={240} borderRadius={12} />
          <View className="mt-4 flex-row gap-4">
            <Skeleton width={100} height={150} borderRadius={8} />
            <View className="flex-1 gap-2">
              <Skeleton width="80%" height={24} />
              <Skeleton width="50%" height={16} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <SafeAreaView
        edges={["top"]}
        className="flex-1 items-center justify-center gap-3 bg-bg-primary px-6"
      >
        <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
        <Text className="text-center font-body-md text-body-md text-text-secondary">
          {apiErrorMessage(detail.error, "Couldn't load this title.")}
        </Text>
        <PrimaryButton label="Retry" onPress={() => detail.refetch()} />
      </SafeAreaView>
    );
  }

  const movie = detail.data;
  const isTv = movie.media_type === "tv";
  const year = movie.release_date?.slice(0, 4);
  const runtimeLabel = formatRuntime(isTv ? movie.episode_runtime : movie.runtime);
  const seasonsEpisodesLabel = isTv
    ? formatSeasonsEpisodes(movie.number_of_seasons, movie.number_of_episodes)
    : null;
  const language = movie.original_language ? languageLabel(movie.original_language) : null;
  const infoLine = [year, seasonsEpisodesLabel, runtimeLabel, language]
    .filter(Boolean)
    .join("  •  ");
  const backdrop = backdropUrl(movie.backdrop_path) ?? posterUrl(movie.poster_path);
  const currentRating = pendingRating ?? movie.user_rating ?? 0;
  const creditLabel = isTv ? "Creator" : "Director";

  const handleRate = (value: number) => {
    setPendingRating(value);
    rate.mutate({ movie_id: movie.id, media_type: movie.media_type, rating: value });
  };

  const handleWatchTrailer = () => {
    if (!movie.trailer_key) return;
    Linking.openURL(`https://www.youtube.com/watch?v=${movie.trailer_key}`);
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary" style={{ paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: width >= WIDE_BREAKPOINT ? 330 : 280 }} className="bg-bg-secondary">
          {backdrop ? (
            <Image
              source={{ uri: backdrop }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : null}
          <LinearGradient
            colors={["transparent", theme["bg-primary"]]}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" }}
          />
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={{ position: "absolute", top: 12, left: 16 }}
            className="h-10 w-10 items-center justify-center rounded-full bg-bg-primary/60"
          >
            <Ionicons name="chevron-back" size={22} color={theme["text-primary"]} />
          </Pressable>
        </View>

        <View className="-mt-10 flex-row gap-4 px-4">
          {posterUrl(movie.poster_path) ? (
            <Image
              source={{ uri: posterUrl(movie.poster_path) }}
              style={{ width: 100, height: 150, borderRadius: 8 }}
            />
          ) : (
            <View
              style={{ width: 100, height: 150, borderRadius: 8 }}
              className="items-center justify-center bg-bg-secondary"
            >
              <Ionicons name="film-outline" size={32} color={theme["text-disabled"]} />
            </View>
          )}
          <View className="flex-1 justify-end gap-1 pb-1">
            <Text className="font-display-lg text-display-lg text-text-primary">{movie.title}</Text>
            {infoLine ? (
              <Text className="font-body-sm text-body-sm text-text-secondary">{infoLine}</Text>
            ) : null}
            {movie.director.length > 0 ? (
              <Text className="font-body-sm text-body-sm text-text-secondary">
                {creditLabel}
                {movie.director.length > 1 ? "s" : ""}: {movie.director.join(", ")}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="mt-3 flex-row flex-wrap gap-2 px-4">
          {isTv && movie.status ? (
            <View className="rounded-full bg-bg-secondary px-3 py-1">
              <Text className="font-label text-body-sm text-text-secondary">{movie.status}</Text>
            </View>
          ) : null}
          {movie.genres.map((genre) => (
            <View key={genre} className="rounded-full bg-bg-secondary px-3 py-1">
              <Text className="font-label text-body-sm text-text-secondary">{genre}</Text>
            </View>
          ))}
          <ScoreBadge score={movie.predicted_score} />
        </View>

        <View className="mt-4 gap-3 px-4">
          {movie.trailer_key ? (
            <PrimaryButton label="▶  Watch Trailer" onPress={handleWatchTrailer} />
          ) : null}
          <StarRatingRow rating={currentRating} onRate={handleRate} showLabel />
          <Text className="font-body-sm text-body-sm text-text-secondary">
            Rate what you&apos;ve seen. 4 or 5 stars means you liked it, and a 3 won&apos;t change
            your picks.
          </Text>
        </View>

        <WhereToWatch providers={movie.watch_providers} />

        {movie.overview ? (
          <View className="mt-6 px-4">
            <Text className="font-display-sm text-display-sm text-text-primary">Overview</Text>
            <Text
              numberOfLines={overviewExpanded ? undefined : OVERVIEW_COLLAPSED_LINES}
              className="mt-2 font-body-lg text-body-lg text-text-primary"
            >
              {movie.overview}
            </Text>
            <Pressable onPress={() => setOverviewExpanded((current) => !current)} hitSlop={8}>
              <Text className="mt-1 font-label text-body-sm text-accent-primary">
                {overviewExpanded ? "Read less" : "Read more"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {movie.cast.length > 0 ? (
          <View className="mt-6">
            <Text className="font-display-sm text-display-sm px-4 text-text-primary">Cast</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingTop: 12 }}
            >
              {movie.cast.map((member, index) => (
                <CastAvatar
                  key={`${member.name}-${index}`}
                  name={member.name}
                  profilePath={member.profile_path}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <SimilarMoviesRow mediaType={movie.media_type} movieId={movie.id} />
      </ScrollView>
    </SafeAreaView>
  );
}
