import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { PosterCard } from "./PosterCard";

// @expo/vector-icons pulls in expo-font -> expo-asset, which is nested under
// node_modules/expo/node_modules rather than hoisted to the top level; Metro
// resolves it fine at runtime (confirmed live via /check verify) but Jest's
// stricter resolution can't find it. No test here asserts on the icon's own
// render (the placeholder branch is identified by exclusion, see below), so
// stubbing it out avoids the module entirely.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

const POSTER_URL = "https://example.com/poster.jpg";

// Host-node lookups (not by component type, which react-native-svg/vector-icon
// internals make brittle to match by name): the image is identified by its
// `source` prop, the skeleton by the `accessibilityElementsHidden` marker
// Skeleton.tsx sets on its own root. The placeholder is whichever branch
// renders when neither of those is present.
function findImage(container: { queryAll: (p: (i: any) => boolean) => any[] }) {
  return container.queryAll((el) => el.props.source?.uri !== undefined);
}
function findHiddenSkeletonMarker(container: { queryAll: (p: (i: any) => boolean) => any[] }) {
  return container.queryAll((el) => el.props.accessibilityElementsHidden === true);
}

describe("PosterCard", () => {
  test("with onPress: exposes a button role labelled by the title", async () => {
    await render(
      <PosterCard
        variant="grid"
        title="The Dark Knight"
        posterUrl={POSTER_URL}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "The Dark Knight" })).toBeOnTheScreen();
  });

  test("without onPress: renders no forced interactive role", async () => {
    await render(<PosterCard variant="grid" title="The Dark Knight" posterUrl={POSTER_URL} />);

    expect(screen.queryByRole("button")).not.toBeOnTheScreen();
  });

  test("never renders the title as visible text (accessibility label only)", async () => {
    await render(
      <PosterCard
        variant="grid"
        title="The Dark Knight"
        posterUrl={POSTER_URL}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText("The Dark Knight")).not.toBeOnTheScreen();
  });

  test("shows the poster image when a posterUrl is given", async () => {
    const { container } = await render(
      <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} onPress={jest.fn()} />,
    );

    const images = findImage(container);
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({ uri: POSTER_URL });
  });

  test("falls back to the placeholder when no posterUrl is given", async () => {
    const { container, toJSON } = await render(
      <PosterCard variant="grid" title="Poster" onPress={jest.fn()} />,
    );

    expect(findImage(container)).toHaveLength(0);
    expect(findHiddenSkeletonMarker(container)).toHaveLength(0);
    expect(toJSON()).not.toBeNull();
  });

  test("falls back to the placeholder when the image fails to load", async () => {
    const { container } = await render(
      <PosterCard
        variant="grid"
        title="Poster"
        posterUrl="https://example.invalid/missing.jpg"
        onPress={jest.fn()}
      />,
    );

    const [image] = findImage(container);
    await fireEvent(image, "error");

    expect(findImage(container)).toHaveLength(0);
    expect(findHiddenSkeletonMarker(container)).toHaveLength(0);
  });

  test("loading forces the skeleton regardless of posterUrl", async () => {
    const { container } = await render(
      <PosterCard
        variant="grid"
        title="Poster"
        posterUrl={POSTER_URL}
        loading
        onPress={jest.fn()}
      />,
    );

    expect(findImage(container)).toHaveLength(0);
    expect(findHiddenSkeletonMarker(container).length).toBeGreaterThan(0);
  });

  test("an explicit width sets the image size, with height 1.5x", async () => {
    const { container } = await render(
      <PosterCard
        variant="row"
        title="Poster"
        posterUrl={POSTER_URL}
        width={120}
        onPress={jest.fn()}
      />,
    );

    const [image] = findImage(container);
    expect(StyleSheet.flatten(image.props.style)).toEqual(
      expect.objectContaining({ width: 120, height: 180 }),
    );
  });

  test("without a width, the image takes the shared card size (2:3)", async () => {
    const { container } = await render(
      <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} onPress={jest.fn()} />,
    );

    const [image] = findImage(container);
    const { width, height } = StyleSheet.flatten(image.props.style);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeCloseTo(width * 1.5);
  });

  // design.md §7's rating badge overlay (spec 0005 AC-1/AC-2).
  describe("score badge overlay", () => {
    test("renders the score overlay when a score is given", async () => {
      await render(<PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} score={82} />);

      expect(screen.getByText("82%")).toBeOnTheScreen();
    });

    test("renders a genuine 0 score (distinct from no score at all)", async () => {
      await render(<PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} score={0} />);

      expect(screen.getByText("0%")).toBeOnTheScreen();
    });

    test("omits the overlay entirely when score is null", async () => {
      await render(
        <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} score={null} />,
      );

      expect(screen.queryByText("0%")).not.toBeOnTheScreen();
    });

    test("omits the overlay entirely when score is undefined", async () => {
      await render(<PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} />);

      expect(screen.queryByText(/%$/)).not.toBeOnTheScreen();
    });

    test("never renders the overlay while loading, even with a score given", async () => {
      const { container } = await render(
        <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} score={82} loading />,
      );

      expect(screen.queryByText("82")).not.toBeOnTheScreen();
      expect(findHiddenSkeletonMarker(container).length).toBeGreaterThan(0);
    });
  });

  // Spec 0010 AC-3: the TV badge distinguishing a TV card in a merged list.
  describe("media type badge", () => {
    test("renders a TV badge when mediaType is tv", async () => {
      await render(
        <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} mediaType="tv" />,
      );

      expect(screen.getByText("TV")).toBeOnTheScreen();
    });

    test("renders no badge for a movie card", async () => {
      await render(
        <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} mediaType="movie" />,
      );

      expect(screen.queryByText("TV")).not.toBeOnTheScreen();
    });

    test("renders no badge when mediaType is omitted", async () => {
      await render(<PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} />);

      expect(screen.queryByText("TV")).not.toBeOnTheScreen();
    });

    test("never renders the badge while loading", async () => {
      await render(
        <PosterCard variant="grid" title="Poster" posterUrl={POSTER_URL} mediaType="tv" loading />,
      );

      expect(screen.queryByText("TV")).not.toBeOnTheScreen();
    });
  });
});
