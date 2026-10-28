import { Link } from "expo-router";
import { Pressable, Text } from "react-native";

interface Props {
  label: string;
  href: "/(auth)/signup" | "/(auth)/login";
  onPress?: () => void;
  variant?: "primary" | "quiet";
}

// A real in app link (renders an <a>), so it is keyboard reachable and
// crawlable. Colors come only from design tokens.
export function LandingButton({ label, href, onPress, variant = "primary" }: Props) {
  const primary = variant === "primary";
  return (
    <Link href={href} asChild onPress={onPress}>
      <Pressable
        role="link"
        accessibilityLabel={label}
        className={
          primary
            ? "h-12 items-center justify-center rounded-lg bg-accent-primary px-6 active:bg-accent-hover"
            : "h-12 items-center justify-center px-3"
        }
      >
        <Text className={`font-label text-label ${primary ? "text-white" : "text-text-primary"}`}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}
