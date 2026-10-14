import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logo } from "../../assets";
import { PrimaryButton } from "../../components/PrimaryButton";
import { RatingGuide } from "../../components/RatingGuide";
import { StarRatingRow } from "../../components/StarRatingRow";
import { posterUrl } from "../../constants/config";
import { useCompleteOnboarding } from "../../hooks/useCompleteOnboarding";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMovieSearch } from "../../hooks/useMovieSearch";
import { useRateMovie } from "../../hooks/useRateMovie";
import { useResolveMovie } from "../../hooks/useResolveMovie";
import { useTheme } from "../../hooks/useTheme";
import { useSessionStore } from "../../store/sessionStore";
import type { MediaType, MovieSearchResult } from "../../types/api";

interface Pick {
  movieId: number;
  mediaType: MediaType;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  rating: number;
}

// design.md §6.3: Done only appears once at least 3 movies have been rated.
const MIN_RATED_FOR_DONE = 3;

function ResultThumbnail({ posterPath }: { posterPath: string | null }) {
  const theme = useTheme();
  const uri = posterUrl(posterPath);

  if (!uri) {
    return (
      <View
        style={{ width: 40, height: 60, borderRadius: 4 }}
        className="items-center justify-center bg-bg-secondary"
      >
        <Ionicons name="film-outline" size={18} color={theme["text-disabled"]} />
      </View>
    );
  }

  return <Image source={{ uri }} style={{ width: 40, height: 60, borderRadius: 4 }} />;
}

export default function Onboarding() {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const debouncedQuery = useDebouncedValue(query, 200);
  const search = useMovieSearch(debouncedQuery);
  const resolve = useResolveMovie();
  const rate = useRateMovie();
  const completeOnboarding = useCompleteOnboarding();

  const ratedCount = picks.filter((pick) => pick.rating > 0).length;
  const showDone = ratedCount >= MIN_RATED_FOR_DONE;
  const showResults = query.trim().length > 0 && !!search.data && search.data.length > 0;
  const showEmptyLocalState =
    debouncedQuery.trim().length > 0 && search.isSuccess && search.data.length === 0;

  const addPick = (movie: Omit<Pick, "rating">) => {
    setPicks((current) => {
      if (
        current.some((pick) => pick.movieId === movie.movieId && pick.mediaType === movie.mediaType)
      ) {
        return current;
      }
      return [...current, { ...movie, rating: 0 }];
    });
    setQuery("");
  };

  const handleAddLocalResult = (result: MovieSearchResult) => {
    addPick({
      movieId: result.id,
      mediaType: result.media_type,
      title: result.title,
      releaseDate: result.release_date,
      posterPath: result.poster_path,
    });
  };

  const handleResolve = () => {
    const title = query.trim();
    if (!title) return;
    resolve.mutate(title, {
      onSuccess: (movie) => {
        addPick({
          movieId: movie.movie_id,
          mediaType: movie.media_type,
          title: movie.title,
          releaseDate: movie.release_date,
          posterPath: movie.poster_path,
        });
      },
    });
  };

  const handleRate = (movieId: number, mediaType: MediaType, rating: number) => {
    setPicks((current) =>
      current.map((pick) => (pick.movieId === movieId ? { ...pick, rating } : pick)),
    );
    rate.mutate({ movie_id: movieId, media_type: mediaType, rating });
  };

  const finishOnboarding = () => {
    // AC-5: move on immediately, don't wait for this to land.
    completeOnboarding.mutate();
    useSessionStore.getState().setLaunchRoute("/(tabs)");
    router.replace("/(tabs)");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <View className="flex-1 px-6 pt-4">
        <View className="flex-row items-center justify-center gap-2">
          <Image source={logo} style={{ width: 24, height: 24 }} className="rounded-md" />
          <Text className="text-center font-display-lg text-display-lg text-text-primary">
            Build Your Profile
          </Text>
        </View>
        <Text className="mt-2 text-center font-body-md text-body-md text-text-secondary">
          Search, add, and rate titles you&apos;ve seen to help us understand your taste.
        </Text>

        <View className="mt-5">
          <RatingGuide />
        </View>

        <View className="mt-5 h-12 flex-row items-center gap-2 rounded-lg bg-bg-secondary px-3">
          <Ionicons name="search-outline" size={20} color={theme["text-secondary"]} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleResolve}
            placeholder="Type a title you like…"
            placeholderTextColor={theme["text-secondary"]}
            returnKeyType="search"
            accessibilityLabel="Search for a title"
            className="flex-1 font-body-md text-body-md text-text-primary"
          />
          {resolve.isPending ? (
            <ActivityIndicator size="small" color={theme["accent-primary"]} />
          ) : null}
        </View>

        {showResults ? (
          <View className="mt-2 gap-2">
            {search.data?.map((result) => (
              <Pressable
                key={result.id}
                onPress={() => handleAddLocalResult(result)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${result.title}`}
                className="flex-row items-center gap-3 rounded-lg bg-bg-secondary p-2"
              >
                <ResultThumbnail posterPath={result.poster_path} />
                <View className="flex-1">
                  <Text className="font-body-md text-body-md text-text-primary">
                    {result.title}
                  </Text>
                  {result.release_date ? (
                    <Text className="font-body-sm text-body-sm text-text-secondary">
                      {result.release_date.slice(0, 4)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showEmptyLocalState ? (
          <Pressable
            onPress={handleResolve}
            accessibilityRole="button"
            accessibilityLabel={`Search TMDB for ${query.trim()}`}
            className="mt-2 flex-row items-center justify-center gap-2 rounded-lg bg-bg-secondary p-3"
          >
            <Ionicons name="search-outline" size={16} color={theme["accent-primary"]} />
            <Text className="text-center font-body-sm text-body-sm text-accent-primary">
              Search TMDB for &quot;{query.trim()}&quot;
            </Text>
          </Pressable>
        ) : null}

        {picks.length > 0 ? (
          <Text className="mt-4 font-body-sm text-body-sm text-text-secondary">
            Tap the stars to rate each pick — rate at least {MIN_RATED_FOR_DONE} to continue
          </Text>
        ) : null}

        <FlatList
          data={picks}
          keyExtractor={(pick) => `${pick.mediaType}-${pick.movieId}`}
          contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center gap-3 rounded-lg bg-bg-secondary p-3">
              <ResultThumbnail posterPath={item.posterPath} />
              <View className="flex-1 gap-1">
                <Text className="font-body-md text-body-md text-text-primary">{item.title}</Text>
                <StarRatingRow
                  rating={item.rating}
                  onRate={(value) => handleRate(item.movieId, item.mediaType, value)}
                  size="sm"
                  showLabel
                />
              </View>
            </View>
          )}
        />

        <View className="gap-3 pb-4">
          {showDone ? <PrimaryButton label="Done" onPress={finishOnboarding} /> : null}
          <Pressable
            onPress={finishOnboarding}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            hitSlop={8}
          >
            <Text className="text-center font-body-md text-body-md text-text-secondary">Skip</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
