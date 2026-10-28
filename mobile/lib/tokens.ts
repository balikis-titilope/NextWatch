import * as SecureStore from "expo-secure-store";

// Key names fixed by design.md §8 -- a real credential, not a preference,
// so it goes in expo-secure-store, never AsyncStorage (AGENTS.md §12).
// Native only: see tokens.web.ts for the web platform variant (Metro picks
// whichever file matches the target platform, same convention
// expo-secure-store itself uses for its own web stub).
const ACCESS_TOKEN_KEY = "nextwatch_access_token";
const REFRESH_TOKEN_KEY = "nextwatch_refresh_token";

// Bumped every time clearTokens() runs, so a token renewal already in
// flight when a logout happens (e.g. a background query's 401 kicked off
// renewSession() moments before the user tapped Sign Out) can tell its
// result is now stale and must not write tokens back into SecureStore
// after logout just cleared them (lib/api.ts's renewSession checks this).
let sessionEpoch = 0;

export function getSessionEpoch(): number {
  return sessionEpoch;
}

export function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

// Supabase rotates the refresh token on every use -- the old one stops
// working immediately, so both must land before anything waiting on the
// new credential resumes (spec 0004). expo-secure-store has no
// multi-key transaction, so this is "both writes settle, or the caller
// sees the rejection" rather than a true atomic commit.
export async function setTokens({
  access_token,
  refresh_token,
}: {
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access_token),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh_token),
  ]);
}

export async function clearTokens(): Promise<void> {
  sessionEpoch++;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
