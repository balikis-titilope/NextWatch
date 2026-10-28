const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// A plain base64url decode of the JWT payload segment -- no new
// dependency (spec 0004's own note), just enough to read the `exp`
// claim locally and skip a doomed network call on a token we already
// know is expired. Platform-independent (unlike token storage), so it
// lives here rather than in tokens.ts/tokens.web.ts.
function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(base64UrlDecode(payload)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

// ~60s safety margin (spec 0004): a token that's about to expire is
// treated as already expired so the launch check skips straight to
// renewal instead of racing a request that will 401 anyway.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

export function isAccessTokenExpired(token: string): boolean {
  const exp = decodeJwtExpiry(token);
  if (exp === null) return true;
  const nowSeconds = Date.now() / 1000;
  return exp - EXPIRY_SAFETY_MARGIN_SECONDS <= nowSeconds;
}
