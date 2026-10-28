import { useSessionStore } from "../store/sessionStore";
import { ApiError, apiFetch } from "./api";
import { resolveLaunchRoute } from "./launchRouting";
import { getAccessToken, getRefreshToken } from "./tokens";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: "https://api.test" } },
  },
}));

jest.mock("./api", () => ({
  ApiError: jest.requireActual("./api").ApiError,
  apiFetch: jest.fn(),
  renewSession: jest.fn(),
}));

jest.mock("./tokens", () => ({
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
}));

// A JWT shaped just enough for jwt.ts's local exp check -- header/signature
// content is irrelevant, only the payload's exp claim is read.
function tokenExpiringIn(seconds: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + seconds };
  const base64url = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${base64url}.signature`;
}

// resolveLaunchRoute currently starts with an unrelated fixed delay (see
// launchRouting.ts) -- advanced past up front so it doesn't factor into
// these tests' timer assertions.
const STARTUP_DELAY_MS = 4000;
const RETRY_DELAY_MS = 1000; // >= launchRouting.ts's own retry delay

describe("resolveLaunchRoute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useSessionStore.setState({ userId: null, launchRoute: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("routes straight to login with no network call when there's no stored refresh token (AC-1)", async () => {
    (getRefreshToken as jest.Mock).mockResolvedValue(null);

    const promise = resolveLaunchRoute();
    await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    const route = await promise;

    expect(route).toBe("/(auth)/login");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  test("routes to the destination /me resolves, using a valid stored access token", async () => {
    (getRefreshToken as jest.Mock).mockResolvedValue("refresh-1");
    (getAccessToken as jest.Mock).mockResolvedValue(tokenExpiringIn(3600));
    (apiFetch as jest.Mock).mockResolvedValue({ user_id: "u1", onboarding_completed: true });

    const promise = resolveLaunchRoute();
    await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    const route = await promise;

    expect(route).toBe("/(tabs)");
    expect(useSessionStore.getState().userId).toBe("u1");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  test("a confirmed 401 rejection routes to login without retrying", async () => {
    (getRefreshToken as jest.Mock).mockResolvedValue("refresh-1");
    (getAccessToken as jest.Mock).mockResolvedValue(tokenExpiringIn(3600));
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError("Invalid or expired token", 401));

    const promise = resolveLaunchRoute();
    await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    const route = await promise;

    expect(route).toBe("/(auth)/login");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  test("a transient failure retries once and recovers instead of reading as logged out", async () => {
    (getRefreshToken as jest.Mock).mockResolvedValue("refresh-1");
    (getAccessToken as jest.Mock).mockResolvedValue(tokenExpiringIn(3600));
    (apiFetch as jest.Mock)
      .mockRejectedValueOnce(new ApiError("Auth provider unavailable", 503))
      .mockResolvedValueOnce({ user_id: "u1", onboarding_completed: false });

    const promise = resolveLaunchRoute();
    await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const route = await promise;

    expect(route).toBe("/onboarding");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  test("a transient failure that persists across the retry falls back to login without clearing the session", async () => {
    (getRefreshToken as jest.Mock).mockResolvedValue("refresh-1");
    (getAccessToken as jest.Mock).mockResolvedValue(tokenExpiringIn(3600));
    (apiFetch as jest.Mock).mockRejectedValue(new ApiError("Auth provider unavailable", 503));

    const promise = resolveLaunchRoute();
    await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const route = await promise;

    expect(route).toBe("/(auth)/login");
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().userId).toBeNull();
  });
});
