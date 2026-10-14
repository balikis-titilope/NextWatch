import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { RATING_SCALE } from "../constants/ratingScale";
import { useTheme } from "../hooks/useTheme";

// Explains that ratings steer the recommendations, so people don't rate
// something they liked 3 stars or less. `collapsible` folds it into a
// "How rating works" toggle for screens where it should stay out of the way.
export function RatingGuide({
  collapsible = false,
  defaultOpen = true,
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(collapsible ? defaultOpen : true);

  const header = (
    <View className="flex-row items-center gap-2">
      <Ionicons name="information-circle-outline" size={18} color={theme["accent-primary"]} />
      <Text className="flex-1 font-label text-body-md text-text-primary">How rating works</Text>
      {collapsible ? (
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={theme["text-secondary"]}
        />
      ) : null}
    </View>
  );

  return (
    <View className="gap-3 rounded-xl border border-bg-tertiary bg-bg-secondary p-4">
      {collapsible ? (
        <Pressable
          onPress={() => setOpen((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel="How rating works"
          accessibilityState={{ expanded: open }}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}

      {open ? (
        <>
          <Text className="font-body-sm text-body-sm text-text-secondary">
            Your stars teach us your taste, so rate honestly. If you liked something, give it 4 or 5
            stars. A 3 doesn&apos;t change your picks at all.
          </Text>
          <View className="gap-2">
            {RATING_SCALE.map((entry) => (
              <View key={entry.value} className="flex-row items-center gap-3">
                <View style={{ width: 70 }} className="flex-row gap-0.5">
                  {Array.from({ length: entry.value }, (_, i) => (
                    <Ionicons key={i} name="star" size={11} color={theme.gold} />
                  ))}
                </View>
                <Text style={{ width: 104 }} className="font-label text-body-sm text-text-primary">
                  {entry.label}
                </Text>
                <Text className="flex-1 font-body-sm text-body-sm text-text-secondary">
                  {entry.effect}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
