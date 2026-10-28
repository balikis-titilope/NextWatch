// Web build settings from spec 0014 (rules 5 and 8). Both values are read at
// export time, so a wrong value fails the build, not a visitor's page load.
// Pure functions on purpose: app/+html.tsx runs in Node during the static
// export, so this file must not import anything from React Native.

// Canonical and og:url links need a real public address. Empty means "not set"
// (local dev), which is fine. A value that is not an https address, or that
// carries a path, query or fragment, is a typo worth failing the build over.
export function parseSiteUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`EXPO_PUBLIC_SITE_URL is not a valid URL: "${value}".`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`EXPO_PUBLIC_SITE_URL must start with https:// (got "${value}").`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `EXPO_PUBLIC_SITE_URL must be the bare site address with no path, query or fragment (got "${value}").`,
    );
  }
  return url.origin;
}

// "1" turns the robots noindex tag on (preview builds only). Unset or "0"
// leaves it off. Anything else is a typo, and a silent miss here would let a
// preview address get indexed.
export function parseNoindex(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`EXPO_PUBLIC_NOINDEX must be "1" or unset (got "${value}").`);
}

// process.env.EXPO_PUBLIC_* must be written out in full for Metro to inline it.
export const SITE_URL = parseSiteUrl(process.env.EXPO_PUBLIC_SITE_URL);
export const NOINDEX = parseNoindex(process.env.EXPO_PUBLIC_NOINDEX);
