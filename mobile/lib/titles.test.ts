import { dedupeRows, isLoadedTitle, pickBecauseSeeds, pickSpotlight } from "./titles";

describe("isLoadedTitle", () => {
  test("a real title with a poster is loaded", () => {
    expect(isLoadedTitle({ title: "Arrival", poster_path: "/a.jpg" })).toBe(true);
    expect(isLoadedTitle({ title: "12 Days with God", poster_path: "/a.jpg" })).toBe(true);
    expect(isLoadedTitle({ title: "아내", poster_path: "/a.jpg" })).toBe(true);
  });

  test("a blank or punctuation-only title is not", () => {
    expect(isLoadedTitle({ title: "", poster_path: "/a.jpg" })).toBe(false);
    expect(isLoadedTitle({ title: ",", poster_path: "/a.jpg" })).toBe(false);
    expect(isLoadedTitle({ title: "  ", poster_path: "/a.jpg" })).toBe(false);
  });

  test("a missing poster is not", () => {
    expect(isLoadedTitle({ title: "Arrival", poster_path: null })).toBe(false);
  });
});

describe("pickSpotlight", () => {
  const now = new Date("2026-06-01");
  const card = (
    id: number,
    release_date: string | null,
    backdrop_path: string | null = "/b.jpg",
    title = `Title ${id}`,
  ) => ({ id, media_type: "movie", title, poster_path: "/p.jpg", backdrop_path, release_date });

  test("is the first title from this year or last year, in list order", () => {
    const cards = [card(1, "2019-01-01"), card(2, "2025-03-01"), card(3, "2026-02-01")];
    expect(pickSpotlight(cards, now)?.id).toBe(2);
  });

  test("falls back to the first title overall when none is recent", () => {
    const cards = [card(1, "2019-01-01"), card(2, "2020-03-01")];
    expect(pickSpotlight(cards, now)?.id).toBe(1);
  });

  test("needs a backdrop and a loaded title", () => {
    const cards = [
      card(1, "2026-01-01", null),
      card(2, "2026-01-01", "/b.jpg", ","),
      card(3, "2025-01-01"),
    ];
    expect(pickSpotlight(cards, now)?.id).toBe(3);
  });

  test("returns nothing when no title qualifies", () => {
    expect(pickSpotlight([card(1, "2026-01-01", null)], now)).toBeUndefined();
  });
});

describe("pickBecauseSeeds", () => {
  const r = (id: number, rating: number) => ({ id, rating });

  test("newest 5-stars first, then newest 4-stars, capped", () => {
    const ratings = [r(1, 4), r(2, 5), r(3, 3), r(4, 5), r(5, 4), r(6, 5)];
    expect(pickBecauseSeeds(ratings, 3).map((x) => x.id)).toEqual([2, 4, 6]);
    expect(pickBecauseSeeds(ratings, 5).map((x) => x.id)).toEqual([2, 4, 6, 1, 5]);
  });

  test("falls back to 4-stars when there are few 5-stars; ignores 3 and below", () => {
    expect(pickBecauseSeeds([r(1, 4), r(2, 5), r(3, 2)], 3).map((x) => x.id)).toEqual([2, 1]);
    expect(pickBecauseSeeds([r(1, 3)], 3)).toEqual([]);
  });
});

describe("dedupeRows", () => {
  const c = (id: number) => ({ id, media_type: "movie", title: `T${id}`, poster_path: "/p.jpg" });

  test("a title shows once: not if already seen, not in a later row", () => {
    const seen = new Set(["movie-1"]);
    const rows = dedupeRows([[c(1), c(2), c(3)], [c(3), c(4)], undefined], seen, 10);
    expect(rows.map((row) => row.map((x) => x.id))).toEqual([[2, 3], [4], []]);
  });

  test("caps each row and skips titles that never loaded", () => {
    const blank = { ...c(9), title: "," };
    const rows = dedupeRows([[blank, c(5), c(6), c(7)]], new Set(), 2);
    expect(rows[0].map((x) => x.id)).toEqual([5, 6]);
  });
});
