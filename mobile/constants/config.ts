// Fixed client-side constants named in spec 0004's Value sourcing table --
// not derived from any request or design token, so they live here rather
// than inline in a component or hook.

import Constants from "expo-constants";

// Same source lib/api.ts's API_BASE_URL reads, but without its top-level
// throw guard -- this module is a leaf with no other side-effecting
// imports (several tests, e.g. PosterCard's, import it transitively
// without mocking expo-constants), so it must stay import-safe even when
// the env var isn't set, unlike lib/api.ts which enforces that invariant
// for real network calls.
const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

// The hosted legal pages (spec 0009's legal-screens-consent child) --
// static HTML served by the backend at these paths, opened in the system
// browser via Linking.openURL, never reimplemented natively.
export const PRIVACY_POLICY_URL = `${API_BASE_URL}/legal/privacy-policy`;
export const TERMS_URL = `${API_BASE_URL}/legal/terms`;
// Footer Contact link on the web landing page (spec 0011), same backend host.
export const SUPPORT_URL = `${API_BASE_URL}/legal/support`;

// Time budget for one launch routing attempt (checking the token, fetching
// onboarding status, possibly renewing the login) -- one shared timeout for
// the attempt, not per network call within it (AC-7). lib/launchRouting.ts
// retries the whole attempt once on a transient (not confirmed-invalid)
// failure before falling back to the login route.
export const LAUNCH_TIMEOUT_MS = 8000;

// Onboarding completion (Skip/Done) retry policy: bounded so a background
// write never retries forever, capped exponential backoff so a flaky
// connection isn't hammered.
export const ONBOARDING_COMPLETE_RETRY_ATTEMPTS = 3;
export function onboardingCompleteRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
}

// TMDB's public image CDN -- the backend returns every image field as a
// raw relative path (poster_path, backdrop_path, cast profile_path,
// provider logo_path); this app prefixes it with one of TMDB's own size
// buckets per image type (spec 0005, AC-12). The prefix itself is TMDB's
// well-known CDN host, not a provider choice.
const TMDB_IMAGE_HOST = "https://image.tmdb.org/t/p";

function tmdbImageUrl(path: string | null | undefined, size: string): string | undefined {
  return path ? `${TMDB_IMAGE_HOST}/${size}${path}` : undefined;
}

export function posterUrl(posterPath: string | null | undefined): string | undefined {
  return tmdbImageUrl(posterPath, "w342");
}

export function backdropUrl(backdropPath: string | null | undefined): string | undefined {
  return tmdbImageUrl(backdropPath, "w1280");
}

export function castPhotoUrl(profilePath: string | null | undefined): string | undefined {
  return tmdbImageUrl(profilePath, "w185");
}

export function providerLogoUrl(logoPath: string | null | undefined): string | undefined {
  return tmdbImageUrl(logoPath, "w92");
}

// design.md §8 "Language Filter Mapping (frontend responsibility)" -- the
// human-readable options shown in the Search & Browse language sheet,
// mapped to the ISO codes GET /movies's `language` param expects.
export const LANGUAGE_OPTIONS: Record<string, string> = {
  English: "en",
  Korean: "ko",
  Hindi: "hi",
  Chinese: "zh",
  Japanese: "ja",
  French: "fr",
  Spanish: "es",
  Yoruba: "yo",
  Hausa: "ha",
  Igbo: "ig",
};

// Reverse lookup for displaying the active filter chip's label from a
// stored ISO code.
export function languageLabel(code: string): string {
  return Object.entries(LANGUAGE_OPTIONS).find(([, value]) => value === code)?.[0] ?? code;
}

// Search & Browse's year-range slider bounds (design.md §6.5 specifies two
// sliders but not their range) -- 1950 covers the dataset's practical
// lower bound of classic-era film, the upper bound tracks the current year
// rather than a value that goes stale.
export const YEAR_RANGE_MIN = 1950;
export const YEAR_RANGE_MAX = new Date().getFullYear();

// This is a phone-first design (design.md never pictures a desktop
// layout); on native, useWindowDimensions() is already phone width. On
// web, the same window can be arbitrarily wide, so anything sized as a
// fraction of it (the Home hero) would balloon far past its intended
// size. Capping at a large-phone width keeps every screen-relative size
// correct everywhere -- see useContentWidth().
export const MAX_CONTENT_WIDTH = 480;

export const POSTER_GRID_GAP = 12;
export const SCREEN_HORIZONTAL_PADDING = 16;

// Page layout (shared by every tab screen via components/PageColumn.tsx and
// AppHeader): content sits in one centered column no wider than this, so
// banners, rows and grids line up across pages on a wide web window.
export const PAGE_MAX_WIDTH = 1600;
export const WIDE_BREAKPOINT = 768;
export const DESKTOP_BREAKPOINT = 1200;

// Side gutter outside every tab screen's own 16px inset (SCREEN_HORIZONTAL_PADDING),
// see hooks/usePageGutter.ts: 8 + 16 = 24px on a phone (the landing page's px-6),
// 32 + 16 = 48 on a wide window, 56 + 16 = 72 on a desktop one.
export const PAGE_GUTTER = 8;
export const PAGE_GUTTER_WIDE = 32;
export const PAGE_GUTTER_DESKTOP = 56;

// One fluid card grid for every poster list (Home rows, Search, Mood, Similar
// Movies), see hooks/useCardLayout.ts: as many columns as fit at about
// CARD_TARGET_WIDTH each, then widened so the columns exactly fill the page
// column. Phones show PHONE_ROW_VISIBLE cards per row so the next one peeks.
export const CARD_TARGET_WIDTH = 190;
export const PHONE_ROW_VISIBLE = 2.5;

// Vertical gap between a tab screen's sections, see hooks/useSectionGap.ts.
export const SECTION_GAP = 40;
export const SECTION_GAP_WIDE = 64;
export const SECTION_GAP_DESKTOP = 80;

// Inner side padding of every filter bottom sheet. Applied through style:
// className padding does not reach the sheet containers on web.
export const SHEET_PADDING = 32;

// react-native-web only: the browser draws its own focus ring on a text input.
// The ring's style must be "none" (a zero width is ignored while the style is
// the default "auto"). Our inputs draw their own focus border on the wrapper.
// Cast because React Native's style types do not list "none" for outlineStyle.
export const WEB_NO_FOCUS_RING = { outlineStyle: "none", outlineWidth: 0 } as object;
