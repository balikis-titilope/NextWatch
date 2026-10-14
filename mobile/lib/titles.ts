// A catalog row whose details never finished loading comes back with a blank
// or punctuation-only title and no poster (rendered as a "," under a film
// icon). Lists skip those instead of showing an empty card.
export function isLoadedTitle(item: { title: string; poster_path: string | null }): boolean {
  return /[\p{L}\p{N}]/u.test(item.title) && !!item.poster_path;
}

type SpotlightCandidate = {
  id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date: string | null;
};

// Home's Spotlight card: the top pick among the latest releases, meaning the
// first title (the list is already ordered by the user's taste) that has a
// backdrop, finished loading, and came out this year or last year. With no such
// title it falls back to the first one overall. The hero carousel then shows
// the titles after it.
export function pickSpotlight<T extends SpotlightCandidate>(
  cards: T[],
  now: Date = new Date(),
): T | undefined {
  const candidates = cards.filter((card) => card.backdrop_path && isLoadedTitle(card));
  const earliest = now.getFullYear() - 1;
  return (
    candidates.find(
      (card) => card.release_date && Number(card.release_date.slice(0, 4)) >= earliest,
    ) ?? candidates[0]
  );
}

// Home's "Because you liked X" rows: seeds are the user's newest 5-star
// ratings first, then newest 4-star ones, up to `limit`. `ratings` is
// GET /me/ratings order (most recent first).
export function pickBecauseSeeds<T extends { rating: number }>(ratings: T[], limit: number): T[] {
  const fives = ratings.filter((entry) => entry.rating === 5);
  const fours = ratings.filter((entry) => entry.rating === 4);
  return [...fives, ...fours].slice(0, limit);
}

// Fills each row, in order, with its loaded titles that no earlier row (or
// the starting `seen` set) already shows, so a title appears once on Home.
// `seen` is updated as rows are filled.
export function dedupeRows<
  T extends { id: number; media_type: string; title: string; poster_path: string | null },
>(rows: (T[] | undefined)[], seen: Set<string>, limit: number): T[][] {
  return rows.map((row) => {
    const kept = (row ?? [])
      .filter((card) => isLoadedTitle(card) && !seen.has(`${card.media_type}-${card.id}`))
      .slice(0, limit);
    kept.forEach((card) => seen.add(`${card.media_type}-${card.id}`));
    return kept;
  });
}
