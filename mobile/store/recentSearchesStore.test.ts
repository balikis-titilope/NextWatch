import { useRecentSearchesStore } from "./recentSearchesStore";

describe("recentSearchesStore", () => {
  beforeEach(() => useRecentSearchesStore.getState().clear());

  test("newest first, no case-insensitive duplicates, blanks ignored", () => {
    const { add } = useRecentSearchesStore.getState();
    add("Arrival");
    add("  ");
    add("Dune");
    add("arrival");
    expect(useRecentSearchesStore.getState().recent).toEqual(["arrival", "Dune"]);
  });

  test("keeps only the latest 6", () => {
    const { add } = useRecentSearchesStore.getState();
    ["a", "b", "c", "d", "e", "f", "g"].forEach(add);
    expect(useRecentSearchesStore.getState().recent).toEqual(["g", "f", "e", "d", "c", "b"]);
  });
});
