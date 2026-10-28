import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  test("is hidden from the accessibility tree (purely decorative)", async () => {
    const { toJSON } = await render(<Skeleton width={100} height={150} />);

    const root = toJSON();
    expect(root?.props.accessibilityElementsHidden).toBe(true);
    expect(root?.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  test("renders at the given width and height, defaulting borderRadius to 8", async () => {
    const { toJSON } = await render(<Skeleton width={100} height={150} />);

    const flatStyle = StyleSheet.flatten(toJSON()?.props.style);
    expect(flatStyle).toEqual(
      expect.objectContaining({ width: 100, height: 150, borderRadius: 8 }),
    );
  });

  test("accepts a custom borderRadius", async () => {
    const { toJSON } = await render(<Skeleton width={40} height={40} borderRadius={4} />);

    const flatStyle = StyleSheet.flatten(toJSON()?.props.style);
    expect(flatStyle).toEqual(expect.objectContaining({ borderRadius: 4 }));
  });

  test("accepts a percentage width", async () => {
    const { toJSON } = await render(<Skeleton width="100%" height={20} />);

    const flatStyle = StyleSheet.flatten(toJSON()?.props.style);
    expect(flatStyle).toEqual(expect.objectContaining({ width: "100%" }));
  });
});
