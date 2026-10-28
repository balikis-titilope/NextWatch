import Constants from "expo-constants";
import { useSessionStore } from "../store/sessionStore";
import { getAccessToken, getRefreshToken, getSessionEpoch, setTokens } from "./tokens";

export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;

if (!API_BASE_URL) {
  throw new Error("EXPO_PUBLIC_API_BASE_URL is not set. Copy .env.example to .env and fill it in.");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// fetch() rejects instead of returning a Response when the request never
// completed at all: no route to the host, DNS failure, connection refused,
// or a timeout. That is a transport failure, not an HTTP one, and it carries
// no response body to read a `detail` out of. Left as a bare TypeError it
// escaped every branch in apiErrorMessage, so each screen fell through to its
// own generic "Something went wrong" -- precisely the case where the user most
// needs to be told the request never left the device.
export class TransportError extends Error {
  constructor(
    message: string,
    public kind: "offline" | "timeout" | "unknown",
  ) {
    super(message);
    this.name = "TransportError";
  }
}

// React Native reports a dead connection and a DNS failure with the same
// "Network request failed" string and a timeout as an AbortError, but neither
// wording is guaranteed across platforms, so match on all of them rather than
// on one exact phrase.
function toTransportError(error: unknown): TransportError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return new TransportError(message, "timeout");
  }
  if (
    /network request failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|timeout|timed out/i.test(
      message,
    )
  ) {
    return new TransportError(message, "timeout");
  }
  return new TransportError(message, "offline");
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  // Explicit token overrides the stored one; pass `null` to opt out of
  // auto-attaching the stored token entirely (e.g. /auth/login,
  // /auth/refresh -- there's no session yet for those calls).
  token?: string | null;
  // AC-5: the onboarding-completion call is a low-stakes background
  // write that must never itself force a sign-out navigation -- its own
  // bounded retry policy (task 10) governs it alone.
  sessionRecovery?: boolean;
};

type RefreshResponse = { access_token: string; refresh_token: string; user_id: string | null };

// Only one renewal is ever in flight at a time (AC-6): concurrent 401s
// share this one promise instead of racing separate renewal calls.
// Exported so the launch routing check (lib/launchRouting.ts) can join
// the same single-flight renewal when it already knows the stored access
// token is expired, instead of waiting for a doomed request to 401 first.
let renewalPromise: Promise<string> | null = null;

// Supabase rotates the refresh token on every use -- if a prior renewal's
// response never made it back to the client (dropped connection, app
// backgrounded mid-request), the stored refresh token can be rejected even
// though nothing about the session is actually wrong. A bounded retry on a
// 401 gives that a chance to resolve before it's treated as a genuine,
// session-ending rejection; a non-401 failure (network/5xx) isn't retried
// here since it already leaves the session intact below.
const REFRESH_REJECTION_RETRY_ATTEMPTS = 3;
const REFRESH_REJECTION_RETRY_DELAY_MS = 400;

export function renewSession(): Promise<string> {
  if (!renewalPromise) {
    renewalPromise = (async () => {
      // Snapshot the session at the moment this renewal started -- if a
      // logout (clearSession -> clearTokens) happens while this call is
      // still in flight, the epoch will have moved on by the time it
      // resolves, and this stale result must not be allowed to write
      // tokens back into SecureStore or to complete an unrelated retry
      // (mirrors the shared-bucket rate-limit issue backend/auth.py's
      // sign_in docstring documents on the server side).
      const startEpoch = getSessionEpoch();
      const refresh_token = await getRefreshToken();
      if (!refresh_token) {
        throw new ApiError("No refresh token stored", 401);
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= REFRESH_REJECTION_RETRY_ATTEMPTS; attempt++) {
        if (getSessionEpoch() !== startEpoch) {
          throw new ApiError("Session cleared", 401);
        }
        try {
          const result = await apiFetch<RefreshResponse>("/auth/refresh", {
            method: "POST",
            body: { refresh_token },
            token: null,
          });
          if (getSessionEpoch() !== startEpoch) {
            throw new ApiError("Session cleared", 401);
          }
          // Supabase rotates the refresh token on every use -- persist
          // both before anything waiting on renewalPromise resumes.
          await setTokens(result);
          return result.access_token;
        } catch (error) {
          lastError = error;
          const isRejection = error instanceof ApiError && error.status === 401;
          if (!isRejection || attempt === REFRESH_REJECTION_RETRY_ATTEMPTS) break;
          await new Promise((resolve) => setTimeout(resolve, REFRESH_REJECTION_RETRY_DELAY_MS));
        }
      }

      // Only an explicit rejection of the credential itself, surviving
      // every retry, clears the session (AC-4); a network/5xx renewal
      // failure (ApiError 503, or fetch throwing outright when offline)
      // leaves it intact (AC-10) so a later attempt can still succeed.
      if (
        lastError instanceof ApiError &&
        lastError.status === 401 &&
        getSessionEpoch() === startEpoch
      ) {
        await useSessionStore.getState().clearSession();
      }
      throw lastError;
    })().finally(() => {
      renewalPromise = null;
    });
  }
  return renewalPromise;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
  _isRetry = false,
): Promise<T> {
  const { body, token, headers, sessionRecovery = true, ...rest } = options;
  const authToken = token === null ? undefined : (token ?? (await getAccessToken()) ?? undefined);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    // Never reached the server, so there is no status and no body to work
    // with -- classify it here, once, rather than in every screen.
    throw toTransportError(error);
  }

  if (response.ok) {
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  const message = await response.text();

  // A 401 from a call that never carried a token isn't a session
  // failure (an intentionally anonymous call) -- it passes straight
  // back to the caller untouched, same as any other error status.
  if (response.status !== 401 || !authToken) {
    throw new ApiError(message, response.status);
  }

  if (_isRetry) {
    // AC-11: a retry on a freshly renewed credential that still 401s is
    // terminal, never attempted twice. sessionRecovery:false (AC-5) is
    // the one exception -- see the type above.
    if (sessionRecovery) {
      await useSessionStore.getState().clearSession();
    }
    throw new ApiError(message, response.status);
  }

  const newToken = await renewSession();
  return apiFetch<T>(path, { ...options, token: newToken }, true);
}

// FastAPI's HTTPException serializes as {"detail": "..."}; ApiError.message
// is the raw response text. `detail` is either a plain string (most
// endpoints) or, for a handful of auth errors (spec 0004: /auth/login,
// /auth/verify-signup), an object carrying both a human message and a
// stable `error_code` the caller can branch on -- this unwraps either
// shape once instead of every call site re-parsing the same JSON.
function parseErrorBody(error: unknown): { message?: string; error_code?: string } {
  if (!(error instanceof ApiError)) return {};
  try {
    const body = JSON.parse(error.message) as { detail?: unknown };
    if (typeof body.detail === "string") return { message: body.detail };
    if (body.detail && typeof body.detail === "object") {
      const detail = body.detail as { message?: unknown; error_code?: unknown };
      return {
        message: typeof detail.message === "string" ? detail.message : undefined,
        error_code: typeof detail.error_code === "string" ? detail.error_code : undefined,
      };
    }
  } catch {
    // Not JSON -- fall through, caller uses the raw message/fallback.
  }
  return {};
}

// The request never reached the server. Saying so is more useful than any
// screen's generic fallback, because the fix is on the user's side (connect,
// or start the backend) rather than something to retry blindly.
const TRANSPORT_MESSAGES: Record<TransportError["kind"], string> = {
  offline: "Couldn't reach NextWatch. Check your connection and try again.",
  timeout: "NextWatch took too long to respond. Try again.",
  unknown: "Couldn't reach NextWatch right now. Try again.",
};

// A server that answered but sent nothing usable still told us something
// through its status code, and that is worth more than echoing a raw body.
// Deliberately no entry for 401/403: a rejected credential and a rejected
// request look identical from here, and login.tsx's own comment is explicit
// that telling a user their password was wrong when it was not is worse than
// saying nothing specific.
function statusMessage(status: number): string | undefined {
  if (status === 422) return "Some of those details aren't valid. Check them and try again.";
  if (status === 429) return "Too many requests. Wait a bit before trying again.";
  if (status >= 500) return "NextWatch is having trouble right now. Try again in a moment.";
  return undefined;
}

// A body worth showing verbatim is plain prose. A body starting with "{" or
// "<" is a JSON blob or an HTML error page from something in front of the
// API, and rendering either inline is how a raw payload ends up on screen.
function isPlainTextBody(body: string): boolean {
  const trimmed = body.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[") &&
    !trimmed.startsWith("<")
  );
}

// Clean, user-facing copy (design.md's "inline error text below the
// form" pattern) instead of a raw JSON blob, falling back to the raw
// text (or a generic message) when the body isn't the expected shape.
export function apiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  // 1. The server's own message. Highest priority: it knows why it refused,
  //    e.g. "Invalid email or password" or "Auth provider unavailable".
  const { message } = parseErrorBody(error);
  if (message) return message;
  // 2. Never got a response at all.
  if (error instanceof TransportError) return TRANSPORT_MESSAGES[error.kind];
  // 3. A short prose body from the server is worth showing as written.
  if (error instanceof ApiError && isPlainTextBody(error.message)) return error.message;
  // 4. Fall back to what the status code implies.
  if (error instanceof ApiError) return statusMessage(error.status) ?? fallback;
  return fallback;
}

// The stable machine-readable code (e.g. "email_not_confirmed",
// "otp_expired") a handful of auth errors carry alongside their message,
// for callers that need to branch on the specific reason, not just show
// text (spec 0004, AC-14/AC-16).
export function apiErrorCode(error: unknown): string | undefined {
  return parseErrorBody(error).error_code;
}
