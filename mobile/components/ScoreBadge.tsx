import { Text, View } from "react-native";

interface Props {
  // A whole number 0-100 (spec 0005 AC-2/AC-13), or null/undefined when
  // there's no basis to compute one yet -- never 0 for "no data".
  score?: number | null;
  // "match" (default): /recommend, /movies/trending, and GET /movies/{id}'s
  // own score -- calibrated to the viewer's own taste (AC-2). "similarity":
  // GET /movies/{id}/similar's plain closeness to a source movie, not
  // calibrated to the viewer (AC-13) -- same visible pill, a different
  // accessibility label so a screen reader doesn't imply personalization
  // that isn't there.
  variant?: "match" | "similarity";
}

// Renders nothing (not an empty or zero-looking pill) when there is no
// score to show yet, per design.md §7's Predicted Score Badge.
export function ScoreBadge({ score, variant = "match" }: Props) {
  if (score === undefined || score === null) return null;

  const label =
    variant === "similarity" ? `${score}% similar to this movie` : `${score}% match for you`;

  return (
    <View
      accessible
      accessibilityLabel={label}
      className="flex-row items-center gap-1 self-start rounded-full border border-gold/30 bg-gold/15 px-3 py-1"
    >
      <Text className="font-label text-body-sm text-gold">★ {score}%</Text>
    </View>
  );
}
