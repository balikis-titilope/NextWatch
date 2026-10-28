import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Image, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/PrimaryButton";
import { RateMoreSection } from "../../components/RateMoreSection";
import { Skeleton } from "../../components/Skeleton";
import { StarRatingRow } from "../../components/StarRatingRow";
import { apiErrorMessage } from "../../lib/api";
import { PAGE_MAX_WIDTH, posterUrl } from "../../constants/config";
import { useDeleteRating } from "../../hooks/useDeleteRating";
import { useMyRatings } from "../../hooks/useMyRatings";
import { usePageGutter } from "../../hooks/usePageGutter";
import { useRateMovie } from "../../hooks/useRateMovie";
import { useSectionGap } from "../../hooks/useSectionGap";
import { useTheme } from "../../hooks/useTheme";
import type { MediaType, RatingEntry } from "../../types/api";

const THUMB_WIDTH = 60;
const THUMB_HEIGHT = 90;
const LIST_SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5"];

function RatingThumbnail({ posterPath }: { posterPath: string | null }) {
  const theme = useTheme();
  const uri = posterUrl(posterPath);

  if (!uri) {
    return (
      <View
        style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 6 }}
        className="items-center justify-center bg-bg-tertiary"
      >
        <Ionicons name="film-outline" size={22} color={theme["text-disabled"]} />
      </View>
    );
  }

  return (
    <Image source={{ uri }} style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 6 }} />
  );
}

function formatRatedDate(ratedAt: string): string {
  return new Date(ratedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function RatingRow({
  item,
  onOpen,
  onRate,
  onDelete,
}: {
  item: RatingEntry;
  onOpen: () => void;
  onRate: (rating: number) => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const year = item.release_date?.slice(0, 4);

  return (
    <View className="flex-row gap-3 rounded-lg bg-bg-secondary p-3">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
      >
        <RatingThumbnail posterPath={item.poster_path} />
      </Pressable>
      <View className="flex-1 justify-center gap-1">
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.title}`}
        >
          <Text numberOfLines={2} className="font-body-md text-body-md text-text-primary">
            {item.title}
          </Text>
          {year ? (
            <Text className="font-body-sm text-body-sm text-text-secondary">{year}</Text>
          ) : null}
        </Pressable>
        <StarRatingRow rating={item.rating} onRate={onRate} size="sm" showLabel />
        <Text className="font-caption text-caption text-text-secondary">
          {formatRatedDate(item.rated_at)}
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={`Remove your rating for ${item.title}`}
        hitSlop={8}
        className="items-start justify-start p-1"
      >
        <Ionicons name="trash-outline" size={20} color={theme.error} />
      </Pressable>
    </View>
  );
}

function DeleteRatingModal({
  visible,
  title,
  isDeleting,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  isDeleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full gap-4 rounded-lg bg-bg-secondary p-5">
          <Text className="font-display-md text-display-md text-text-primary">
            Remove your rating for {title}?
          </Text>
          {errorMessage ? (
            <Text className="font-body-sm text-body-sm text-error">{errorMessage}</Text>
          ) : null}
          <View className="flex-row justify-end gap-6">
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
            >
              <Text className="font-label text-label text-text-secondary">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={isDeleting}
              accessibilityRole="button"
              accessibilityLabel="Confirm remove rating"
              hitSlop={8}
            >
              <Text
                className={`font-label text-label text-error ${isDeleting ? "opacity-40" : ""}`}
              >
                {isDeleting ? "Removing…" : "Remove"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function RatingsScreen() {
  const theme = useTheme();
  const blockGap = useSectionGap() / 2;
  const gutter = usePageGutter();
  const myRatings = useMyRatings();
  const rate = useRateMovie();
  const deleteRating = useDeleteRating();
  const [pendingDelete, setPendingDelete] = useState<RatingEntry | null>(null);

  const openMovie = (movieId: number, mediaType: MediaType) =>
    router.push(`/movie/${mediaType}/${movieId}`);
  const handleRate = (movieId: number, mediaType: MediaType, rating: number) =>
    rate.mutate({ movie_id: movieId, media_type: mediaType, rating });

  const cancelDelete = () => {
    setPendingDelete(null);
    deleteRating.reset();
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteRating.mutate(
      { movie_id: pendingDelete.movie_id, media_type: pendingDelete.media_type },
      { onSuccess: () => setPendingDelete(null) },
    );
  };

  const ratings = myRatings.data ?? [];
  const ratedKeys = new Set(ratings.map((entry) => `${entry.media_type}-${entry.movie_id}`));
  const hasRatings = ratings.length > 0;
  const listData: (string | RatingEntry)[] = myRatings.isLoading ? LIST_SKELETON_KEYS : ratings;

  // Everything above the list is its header, so the page scrolls as one and
  // "Rate more" sits right above the titles you've already rated.
  const header = (
    <View>
      <View className="flex-row items-center gap-2 px-4 pt-6">
        <Text className="font-display-lg text-display-lg text-text-primary">Ratings</Text>
        {hasRatings ? (
          <View className="h-6 items-center justify-center rounded-full bg-bg-tertiary px-2.5">
            <Text className="font-label text-caption text-text-secondary">
              {ratings.length} Titles
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: blockGap }}>
        <RateMoreSection ratedKeys={ratedKeys} />
      </View>

      {hasRatings || myRatings.isLoading ? (
        <Text
          style={{ marginTop: blockGap }}
          className="mb-4 px-4 font-display-md text-display-md text-text-primary"
        >
          Your ratings
        </Text>
      ) : (
        <View style={{ height: blockGap }} />
      )}
    </View>
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-bg-primary">
      {/* A soft accent glow behind the heading, echoing Home's hero. */}
      <LinearGradient
        pointerEvents="none"
        colors={[`${theme["accent-primary"]}33`, `${theme["accent-primary"]}00`]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 280 }}
      />
      <FlatList
        data={listData}
        keyExtractor={(item) =>
          typeof item === "string" ? item : `${item.media_type}-${item.movie_id}`
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          width: "100%",
          maxWidth: PAGE_MAX_WIDTH,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingBottom: 24,
          rowGap: 12,
        }}
        ListHeaderComponent={header}
        renderItem={({ item }) =>
          typeof item === "string" ? (
            <View className="px-4">
              <View className="flex-row gap-3 rounded-lg bg-bg-secondary p-3">
                <Skeleton width={THUMB_WIDTH} height={THUMB_HEIGHT} borderRadius={6} />
                <View className="flex-1 justify-center gap-2">
                  <Skeleton width="70%" height={16} />
                  <Skeleton width="40%" height={12} />
                </View>
              </View>
            </View>
          ) : (
            <View className="px-4">
              <RatingRow
                item={item}
                onOpen={() => openMovie(item.movie_id, item.media_type)}
                onRate={(rating) => handleRate(item.movie_id, item.media_type, rating)}
                onDelete={() => setPendingDelete(item)}
              />
            </View>
          )
        }
        ListEmptyComponent={
          myRatings.isLoading ? null : myRatings.isError ? (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="alert-circle-outline" size={40} color={theme.error} />
              <Text className="text-center font-body-md text-body-md text-text-secondary">
                {apiErrorMessage(myRatings.error, "Couldn't load your ratings. Try again.")}
              </Text>
              <PrimaryButton label="Retry" onPress={() => myRatings.refetch()} />
            </View>
          ) : (
            <View className="items-center justify-center gap-3 py-10">
              <Ionicons name="star-outline" size={64} color={theme["text-disabled"]} />
              <Text className="text-center font-body-lg text-body-lg text-text-primary">
                Rate a few titles to see them here
              </Text>
            </View>
          )
        }
      />

      <DeleteRatingModal
        visible={pendingDelete !== null}
        title={pendingDelete?.title ?? ""}
        isDeleting={deleteRating.isPending}
        errorMessage={
          deleteRating.isError
            ? apiErrorMessage(deleteRating.error, "Couldn't remove this rating. Try again.")
            : null
        }
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </SafeAreaView>
  );
}
