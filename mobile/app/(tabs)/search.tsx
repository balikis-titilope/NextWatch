import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActorFilterSheet } from "../../components/ActorFilterSheet";
import { Chip } from "../../components/Chip";
import { LanguageFilterSheet } from "../../components/LanguageFilterSheet";
import { MediaTypeFilterSheet } from "../../components/MediaTypeFilterSheet";
import { PosterCard } from "../../components/PosterCard";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextField } from "../../components/TextField";
import { YearRangeFilterSheet } from "../../components/YearRangeFilterSheet";
import { apiErrorMessage } from "../../lib/api";
import { isLoadedTitle } from "../../lib/titles";
import {
  languageLabel,
  PAGE_MAX_WIDTH,
  posterUrl,
  POSTER_GRID_GAP,
  YEAR_RANGE_MAX,
  YEAR_RANGE_MIN,
} from "../../constants/config";
import { useBrowseMovies } from "../../hooks/useBrowseMovies";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useMovieSearch } from "../../hooks/useMovieSearch";
import { useResolveMovie } from "../../hooks/useResolveMovie";
import { useCardLayout } from "../../hooks/useCardLayout";
import { usePageGutter } from "../../hooks/usePageGutter";
import { useSectionGap } from "../../hooks/useSectionGap";
import { useTheme } from "../../hooks/useTheme";
import { useRecentSearchesStore } from "../../store/recentSearchesStore";
import type { BrowseMovie, MediaType, MovieSearchResult } from "../../types/api";

const GRID_SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];
// The grid grows a whole number of rows at a time as you scroll, so the last
// row is never a lone orphan card; the personalized pool on the backend stops
// at 200.
const ROWS_PER_PAGE = 4;
const MAX_BROWSE_LIMIT = 200;

function ResultThumbnail({ posterPath }: { posterPath: string | null }) {
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

function movieCaption(item: BrowseMovie): string {
  const genre = item.genres?.split("|")[0]?.trim();
  const year = item.release_date?.slice(0, 4);
  if (genre && year) return `${genre} • ${year}`;
  return genre || year || "";
}

export default function SearchScreen() {
  const theme = useTheme();
  const blockGap = useSectionGap() / 2;
  const gutter = usePageGutter();
  const { columns: numColumns, gridCardWidth } = useCardLayout();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [actor, setActor] = useState("");
  const [startYear, setStartYear] = useState<number | null>(null);
  const [endYear, setEndYear] = useState<number | null>(null);
  const [mediaType, setMediaType] = useState<MediaType | "both">("both");
  const [pages, setPages] = useState(1);
  const [focused, setFocused] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const languageSheetRef = useRef<BottomSheetModal>(null);
  const actorSheetRef = useRef<BottomSheetModal>(null);
  const yearSheetRef = useRef<BottomSheetModal>(null);
  const mediaTypeSheetRef = useRef<BottomSheetModal>(null);

  const recent = useRecentSearchesStore((state) => state.recent);
  const addRecent = useRecentSearchesStore((state) => state.add);
  const clearRecent = useRecentSearchesStore((state) => state.clear);

  const debouncedQuery = useDebouncedValue(query, 200);
  const search = useMovieSearch(debouncedQuery);
  const resolve = useResolveMovie();
  const queryClient = useQueryClient();
  const limit = Math.min(pages * numColumns * ROWS_PER_PAGE, MAX_BROWSE_LIMIT);
  const browse = useBrowseMovies({
    language: language ?? undefined,
    actor: actor || undefined,
    startYear: startYear ?? undefined,
    endYear: endYear ?? undefined,
    mediaType,
    limit,
    personalized: true,
  });

  // A new filter starts over from the first page.
  useEffect(() => {
    setPages(1);
  }, [language, actor, startYear, endYear, mediaType]);

  // Web: "/" jumps to the search field, like most search UIs.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const isSearching = query.trim().length > 0;
  const showRecents = focused && !isSearching && recent.length > 0;
  const showSearchResults = isSearching && !!search.data && search.data.length > 0;
  const showSearchEmptyLocal =
    isSearching && debouncedQuery.trim().length > 0 && search.isSuccess && search.data.length === 0;
  const filtersActive =
    !!language || !!actor || startYear !== null || endYear !== null || mediaType !== "both";
  const anyFilterActive = filtersActive;
  const canLoadMore = (browse.data?.length ?? 0) >= limit && limit < MAX_BROWSE_LIMIT;
  const loadMore = () => {
    if (!isSearching && canLoadMore && !browse.isFetching) setPages((current) => current + 1);
  };

  const clearAllFilters = () => {
    setLanguage(null);
    setActor("");
    setStartYear(null);
    setEndYear(null);
    setMediaType("both");
  };

  const openMovie = (movieId: number, itemMediaType: MediaType) => {
    setQuery("");
    router.push(`/movie/${itemMediaType}/${movieId}`);
  };

  const handleSelectSearchResult = (result: MovieSearchResult) => {
    addRecent(result.title);
    openMovie(result.id, result.media_type);
  };

  const handleResolveSearch = () => {
    const title = query.trim();
    if (!title) return;
    // Stays on the search page: the title is now in the catalog, so showing it
    // in the results list is just a fresh local search.
    resolve.mutate(title, {
      onSuccess: (movie) => {
        addRecent(movie.title);
        setQuery(movie.title);
        queryClient.invalidateQueries({ queryKey: ["movies", "search"] });
      },
    });
  };

  // Enter keeps you on the page: the matches are already listed as you type.
  // Only when nothing matches locally does it go on to look the title up on TMDB.
  const handleSubmit = () => {
    const title = query.trim();
    if (!title) return;
    addRecent(title);
    if (search.isSuccess && search.data.length === 0) handleResolveSearch();
  };

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFocused(true);
  };
  // Delayed so a tap on a recent search lands before the list disappears.
  const handleBlur = () => {
    blurTimer.current = setTimeout(() => setFocused(false), 150);
  };

  const languageChipLabel = language ? `Language: ${languageLabel(language)}` : "Language";
  const actorChipLabel = actor ? `Actor: ${actor}` : "Actor";
  const yearActive = startYear !== null || endYear !== null;
  const yearChipLabel = yearActive
    ? `${startYear ?? YEAR_RANGE_MIN}–${endYear ?? YEAR_RANGE_MAX}`
    : "Year";
  const mediaTypeChipLabel = mediaType === "movie" ? "Movies" : mediaType === "tv" ? "TV" : "Type";

  // Everything above the grid. It is the FlatList's header, so the whole page
  // is one scroll (no inner scroll box) and the scrollbar sits at the window edge.
  const hasGrid = !browse.isError && !(browse.data && browse.data.length === 0);
  const header = (
    <View>
      <View className="gap-1 px-4 pt-6">
        <Text className="font-display-lg text-display-lg text-text-primary">Search & Browse</Text>
        <Text className="font-body-md text-body-md text-text-secondary">
          Find something new by language, cast, or year.
        </Text>
      </View>

      <View style={{ marginTop: blockGap }} className="px-4">
        <TextField
          leadingIcon="search-outline"
          value={query}
          onChangeText={setQuery}
          placeholder={
            Platform.OS === "web"
              ? "Search for a movie…  (press / to focus)"
              : "Search for a movie…"
          }
          accessibilityLabel="Search for a movie"
          returnKeyType="search"
          onSubmitEditing={handleSubmit}
          onFocus={handleFocus}
          onBlur={handleBlur}
          clearable
          inputRef={inputRef}
        />
      </View>

      {isSearching ? (
        <View className="mt-2 px-4">
          {showSearchResults ? (
            <View className="gap-2 pb-6">
              {search.data?.map((result) => (
                <Pressable
                  key={`${result.media_type}-${result.id}`}
                  onPress={() => handleSelectSearchResult(result)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${result.title}`}
                  className="flex-row items-center gap-3 rounded-lg bg-bg-secondary p-2"
                >
                  <ResultThumbnail posterPath={result.poster_path} />
                  <View className="flex-1">
                    <Text className="font-body-md text-body-md text-text-primary">
                      {result.title}
                    </Text>
                    <View className="flex-row items-center gap-1.5">
                      {result.release_date ? (
                        <Text className="font-body-sm text-body-sm text-text-secondary">
                          {result.release_date.slice(0, 4)}
                        </Text>
                      ) : null}
                      {result.media_type === "tv" ? (
                        <View className="rounded-full bg-bg-tertiary px-1.5 py-0.5">
                          <Text className="font-label text-caption font-bold text-text-secondary">
                            TV
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          {resolve.isPending ? (
            <View className="mt-2 items-center">
              <ActivityIndicator size="small" color={theme["accent-primary"]} />
            </View>
          ) : null}

          {resolve.isError ? (
            <Text className="mt-2 text-center font-body-sm text-body-sm text-text-secondary">
              {apiErrorMessage(resolve.error, `Couldn't find "${query.trim()}" on TMDB either.`)}
            </Text>
          ) : null}

          {showSearchEmptyLocal ? (
            <Pressable
              onPress={handleResolveSearch}
              accessibilityRole="button"
              accessibilityLabel={`Search TMDB for ${query.trim()}`}
              className="mt-2 rounded-lg bg-bg-secondary p-3"
            >
              <Text className="text-center font-body-sm text-body-sm text-text-secondary">
                Can&apos;t find it locally — search for &quot;{query.trim()}&quot;
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : showRecents ? (
        <View style={{ marginTop: blockGap }} className="px-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-display-md text-display-md text-text-primary">
              Recent searches
            </Text>
            <Pressable
              onPress={clearRecent}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
              hitSlop={8}
            >
              <Text className="font-label text-body-sm text-accent-primary">Clear</Text>
            </Pressable>
          </View>
          <View className="mt-3 gap-2">
            {recent.map((title) => (
              <Pressable
                key={title}
                onPress={() => setQuery(title)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${title}`}
                className="flex-row items-center gap-3 rounded-lg bg-bg-secondary px-3 py-3"
              >
                <Ionicons name="time-outline" size={18} color={theme["text-secondary"]} />
                <Text className="flex-1 font-body-md text-body-md text-text-primary">{title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <>
          <View className="mt-4 flex-row items-center">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-1"
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: "center" }}
            >
              <Chip
                label={languageChipLabel}
                active={!!language}
                onPress={() => languageSheetRef.current?.present()}
                onClear={() => setLanguage(null)}
              />
              <Chip
                label={actorChipLabel}
                active={!!actor}
                onPress={() => actorSheetRef.current?.present()}
                onClear={() => setActor("")}
              />
              <Chip
                label={yearChipLabel}
                active={yearActive}
                onPress={() => yearSheetRef.current?.present()}
                onClear={() => {
                  setStartYear(null);
                  setEndYear(null);
                }}
              />
              <Chip
                label={mediaTypeChipLabel}
                active={mediaType !== "both"}
                onPress={() => mediaTypeSheetRef.current?.present()}
                onClear={() => setMediaType("both")}
              />
            </ScrollView>
            {anyFilterActive ? (
              <Pressable
                onPress={clearAllFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                hitSlop={8}
                className="pr-4"
              >
                <Text className="font-label text-body-sm text-accent-primary">Clear all</Text>
              </Pressable>
            ) : null}
          </View>

          {hasGrid ? (
            <Text
              style={{ marginTop: blockGap }}
              className="mb-4 px-4 font-display-md text-display-md text-text-primary"
            >
              {anyFilterActive ? "Results" : "Picked for you"}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );

  const browsing = !isSearching && !showRecents;
  const gridData: (string | BrowseMovie)[] = !browsing
    ? []
    : browse.isLoading
      ? GRID_SKELETON_KEYS
      : (browse.data ?? []).filter(isLoadedTitle);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary">
      {/* A soft accent glow behind the heading, echoing Home's hero. */}
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
                mediaType={item.media_type}
                score={item.predicted_score}
                onPress={() => openMovie(item.id, item.media_type)}
              />
              <Text numberOfLines={1} className="mt-2 font-label text-body-sm text-text-primary">
                {item.title}
              </Text>
              <Text className="font-caption text-caption text-text-secondary">
                {movieCaption(item)}
              </Text>
            </View>
          )
        }
        ListEmptyComponent={
          !browsing || browse.isLoading ? null : browse.isError ? (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
              <Text className="text-center font-body-md text-body-md text-text-secondary">
                {apiErrorMessage(browse.error, "Couldn't load movies. Try again.")}
              </Text>
              <PrimaryButton label="Retry" onPress={() => browse.refetch()} />
            </View>
          ) : (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="film-outline" size={64} color={theme["text-disabled"]} />
              <Text className="text-center font-body-lg text-body-lg text-text-primary">
                Nothing matched
              </Text>
              <Text className="text-center font-body-sm text-body-sm text-text-secondary">
                Try loosening a filter, or clear them all.
              </Text>
              {anyFilterActive ? (
                <PrimaryButton label="Clear filters" onPress={clearAllFilters} />
              ) : null}
            </View>
          )
        }
        // Loads the next rows on its own as you near the bottom.
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          browsing && browse.isFetching && !browse.isLoading ? (
            <View className="items-center pb-6 pt-2">
              <ActivityIndicator size="small" color={theme["accent-primary"]} />
            </View>
          ) : null
        }
      />

      <LanguageFilterSheet ref={languageSheetRef} selected={language} onSelect={setLanguage} />
      <ActorFilterSheet ref={actorSheetRef} value={actor} onApply={setActor} />
      <YearRangeFilterSheet
        ref={yearSheetRef}
        startYear={startYear}
        endYear={endYear}
        onApply={(newStart, newEnd) => {
          setStartYear(newStart);
          setEndYear(newEnd);
        }}
      />
      <MediaTypeFilterSheet ref={mediaTypeSheetRef} selected={mediaType} onSelect={setMediaType} />
    </SafeAreaView>
  );
}
