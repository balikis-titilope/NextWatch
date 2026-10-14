// What each star rating means, and what it does to the user's picks. Mirrors
// backend/recommend.py: taste_vector_from_rows pulls toward 4 and 5, pushes
// away from 1 and 2, and ignores 3 (the neutral point).
export const RATING_SCALE = [
  { value: 5, label: "Loved it", effect: "More like this" },
  { value: 4, label: "Liked it", effect: "More like this" },
  { value: 3, label: "It was okay", effect: "No effect on your picks" },
  { value: 2, label: "Didn't like it", effect: "Fewer like this" },
  { value: 1, label: "Hated it", effect: "Fewer like this" },
] as const;

export function ratingLabel(value: number): string | null {
  return RATING_SCALE.find((entry) => entry.value === value)?.label ?? null;
}
