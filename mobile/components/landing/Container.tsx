import type { ReactNode } from "react";
import { View } from "react-native";

// Centers page content and caps it at 1120px (spec 0011 AC-11). Not the
// app's 480px content width helper, which is for phone-shaped screens.
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <View className={`w-full max-w-[1120px] self-center px-6 ${className}`}>{children}</View>;
}
