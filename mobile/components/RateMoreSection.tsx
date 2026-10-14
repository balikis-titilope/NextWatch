import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { RatingGuide } from "./RatingGuide";
import { StarRatingRow } from "./StarRatingRow";
import { TextField } from "./TextField";
import { posterUrl } from "../constants/config";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useMovieSearch } from "../hooks/useMovieSearch";
import { useRateMovie } from "../hooks/useRateMovie";
import { useResolveMovie } from "../hooks/useResolveMovie";
import { useTheme } from "../hooks/useTheme";
import type { MediaType, MovieSearchResult } from "../types/api";

interface Pick {
  movieId: number;
  mediaType: MediaType;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  rating: number;
}

function PickThumbnail({ posterPath }: { posterPath: string | null }) {
  const theme = useTheme();
  const uri = posterUrl(posterPath);

  if (!uri) {
    return (
      <View
        style={{ width: 40, height: 60, borderRadius: 4 }}
        className="items-center justify-center bg-bg-tertiary"
      >
        <Ionicons name="film-outline" size={18} color={theme["text-disabled"]} />
      </View>
    );
  }

  return <Image source={{ uri }} style={{ width: 40, height: 60, borderRadius: 4 }} />;
}

// Search for a title you've seen and rate it. Sits at the top of the Ratings
// page, above the list of what you've already rated. A title shows up here
// until its rating is saved, and then it joins that list (`ratedKeys`).
export function RateMoreSection({ ratedKeys }: { ratedKeys: ReadonlySet<string> }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const debouncedQuery = useDebouncedValue(query, 200);
  const search = useMovieSearch(debouncedQuery);
  const resolve = useResolveMovie();
  const rate = useRateMovie();

  const showResults = query.trim().length > 0 && !!search.data && search.data.length > 0;
  const showEmptyLocalState =
    debouncedQuery.trim().length > 0 && search.isSuccess && search.data.length === 0;
  const visiblePicks = picks.filter((pick) => !ratedKeys.has(`${pick.mediaType}-${pick.movieId}`));

  const addPick = (movie: Omit<Pick, "rating">) => {
    setPicks((current) => {
      if (
        current.some((pick) => pick.movieId === movie.movieId && pick.mediaType === movie.mediaType)
      ) {
        return current;
      }
      return [{ ...movie, rating: 0 }, ...current];
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
      current.map((pick) =>
        pick.movieId === movieId && pick.mediaType === mediaType ? { ...pick, rating } : pick,
      ),
    );
    rate.mutate({ movie_id: movieId, media_type: mediaType, rating });
  };

  return (
    <View className="px-4">
      <Text className="font-display-md text-display-md text-text-primary">Rate more</Text>
      <Text className="mt-1 font-body-sm text-body-sm text-text-secondary">
        Keep rating to sharpen your recommendations.
      </Text>

      <View className="mt-4">
        <RatingGuide collapsible defaultOpen={false} />
      </View>

      <View className="mt-4">
        <TextField
          leadingIcon="search-outline"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleResolve}
          placeholder="Type a title you've seen…"
          accessibilityLabel="Search for a title"
          returnKeyType="search"
          clearable
        />
        {resolve.isPending ? (
          <View className="mt-2 items-center">
            <ActivityIndicator size="small" color={theme["accent-primary"]} />
          </View>
        ) : null}
      </View>

      {showResults ? (
        <View className="mt-2 gap-2">
          {search.data?.map((result) => (
            <Pressable
              key={`${result.media_type}-${result.id}`}
              onPress={() => handleAddLocalResult(result)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${result.title}`}
              className="flex-row items-center gap-3 rounded-lg bg-bg-secondary p-2"
            >
              <PickThumbnail posterPath={result.poster_path} />
              <View className="flex-1">
                <Text className="font-body-md text-body-md text-text-primary">{result.title}</Text>
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

      {visiblePicks.length > 0 ? (
        <Text className="mt-4 font-body-sm text-body-sm text-text-secondary">
          Tap the stars to rate each pick
        </Text>
      ) : null}

      <View className="mt-2 gap-3">
        {visiblePicks.map((pick) => (
          <View
            key={`${pick.mediaType}-${pick.movieId}`}
            className="flex-row items-center gap-3 rounded-lg bg-bg-secondary p-3"
          >
            <PickThumbnail posterPath={pick.posterPath} />
            <View className="flex-1 gap-1">
              <Text className="font-body-md text-body-md text-text-primary">{pick.title}</Text>
              <StarRatingRow
                rating={pick.rating}
                onRate={(value) => handleRate(pick.movieId, pick.mediaType, value)}
                size="sm"
                showLabel
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
