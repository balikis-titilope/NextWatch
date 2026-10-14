import { Pressable, Text, View } from "react-native";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

// The compact pill switch beside a Home row's title (Trending: All/Movies/TV,
// What's Popular: Movies/TV). One selected segment, filled accent-primary.
export function SegmentedToggle<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View className="h-7 flex-row rounded-full border border-text-secondary bg-bg-secondary">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            className={`items-center justify-center rounded-full px-3 ${
              active ? "bg-accent-primary" : ""
            }`}
          >
            <Text
              className={`font-label text-body-sm ${active ? "text-white" : "text-text-secondary"}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
