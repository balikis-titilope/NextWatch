// expo-secure-store ships no web implementation at all (its own
// ExpoSecureStore.web.ts is an empty stub -- every call throws on web).
// localStorage is the established fallback for a universal Expo app; the
// tradeoff is real (no OS-level secure enclave on web, so this is
// XSS-exposed unlike native's Keychain/Keystore-backed SecureStore) but
// inherent to storing a bearer token in any browser, not specific to this
// app. Same public API as tokens.ts so every other module can import from
// "./tokens" without caring which platform it's running on.
const ACCESS_TOKEN_KEY = "nextwatch_access_token";
const REFRESH_TOKEN_KEY = "nextwatch_refresh_token";

// Bumped every time clearTokens() runs, so a renewal already in flight when
// a logout happens can tell its result is stale (see the identical counter in
// tokens.ts). This one is not optional: lib/api.ts imports getSessionEpoch
// from "./tokens", which resolves to THIS file on web, and calls it as the
// first step of renewSession(). Leaving it out made it undefined here and
// threw on every web token renewal.
let sessionEpoch = 0;

export function getSessionEpoch(): number {
  return sessionEpoch;
}

export async function getAccessToken(): Promise<string | null> {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function setTokens({
  access_token,
  refresh_token,
}: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  localStorage.setItem(ACCESS_TOKEN_KEY, access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
}

export async function clearTokens(): Promise<void> {
  sessionEpoch++;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
