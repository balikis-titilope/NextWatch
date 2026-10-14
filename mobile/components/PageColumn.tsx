import type { ReactNode } from "react";
import { View } from "react-native";
import { PAGE_MAX_WIDTH } from "../constants/config";
import { usePageGutter } from "../hooks/usePageGutter";

// The shared page width: fills a phone, and on a wide web window stays a
// centered column of PAGE_MAX_WIDTH, with a responsive side gutter. Wrap every tab screen's content in it.
export function PageColumn({
  children,
  fill = true,
}: {
  children: ReactNode;
  // false inside a ScrollView's content: a flex:1 column there can collapse to
  // zero height on web and let its children paint over the next section.
  fill?: boolean;
}) {
  const gutter = usePageGutter();

  return (
    <View
      style={{
        flex: fill ? 1 : undefined,
        width: "100%",
        maxWidth: PAGE_MAX_WIDTH,
        alignSelf: "center",
        paddingHorizontal: gutter,
      }}
    >
      {children}
    </View>
  );
}
