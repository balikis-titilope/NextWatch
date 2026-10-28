import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { queryClient } from "../lib/queryClient";
import { useLogin } from "./useAuth";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));

// An in memory stand in for expo secure store rather than bare jest.fn()s.
// This suite is specifically about the ORDERING between persisting the
// freshly issued tokens and the GET /me routing lookup, so the store has to
// actually hold what setTokens wrote for getRefreshToken to read it back.
// Mocking them as independent no ops would hide the very bug under test:
// before the fix, /me 401s with nothing stored, apiFetch tries to renew, and
// renewSession() rejects with an internal "No refresh token stored" that
// replaces an otherwise successful sign in.
jest.mock("../lib/tokens", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    setTokens: jest.fn(
      async ({ access_token, refresh_token }: { access_token: string; refresh_token: string }) => {
        store.set("access", access_token);
        store.set("refresh", refresh_token);
      },
    ),
    getAccessToken: jest.fn(async () => store.get("access") ?? null),
    getRefreshToken: jest.fn(async () => store.get("refresh") ?? null),
    clearTokens: jest.fn(async () => {
      store.clear();
    }),
    getSessionEpoch: jest.fn(() => 0),
  };
});

jest.mock("../lib/locale", () => ({ getDeviceCountry: jest.fn() }));
jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
// trackEvent/captureError are not called by useLogin directly, but
// lib/queryClient's MutationCache onError invokes them, and it runs on the
// real shared queryClient this hook resolves its destination through. Omitting
// them here makes that handler throw and replace the genuine error under test.
jest.mock("../lib/telemetry", () => ({
  identifyUser: jest.fn(),
  trackEvent: jest.fn(),
  captureError: jest.fn(),
}));
jest.mock("../store/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      setUserId: jest.fn(),
      setLaunchRoute: jest.fn(),
      clearSession: jest.fn(),
    }),
  },
}));

// Routed by URL rather than a strict call sequence: the renewal path
// (apiFetch -> renewSession -> retry) is exactly what this suite needs to
// observe, and pinning it to positional mocks would break the moment that
// path legitimately changes shape.
function mockFetchRoutes(routes: Record<string, () => Partial<Response>>) {
  const fetchMock = jest.fn(async (url: string) => {
    const key = Object.keys(routes).find((route) => String(url).endsWith(route));
    if (!key) throw new Error(`Unexpected request to ${url}`);
    return routes[key]();
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const unauthorized = () => ({
  ok: false,
  status: 401,
  text: async () => JSON.stringify({ detail: "Token has expired" }),
});
const loggedIn = { access_token: "tok", refresh_token: "ref", user_id: "u1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function signIn() {
  const { result } = await renderHook(() => useLogin(), { wrapper });
  result.current.mutate({ email: "a@b.com", password: "pw123456" });
  return result;
}

describe("useLogin: routing lookup happens against a persisted session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // useLogin resolves the destination through the shared queryClient
    // singleton (not the wrapper's client), so its ["me"] entry has to be
    // dropped between tests or a cached body answers the next fetchQuery.
    queryClient.clear();
  });

  test("renews and retries when /me rejects the token, instead of failing with an internal renewal error", async () => {
    // /me answers 401 until a refresh has actually happened, which is what
    // makes this the regression: before the fix the tokens were not stored
    // yet at this point, so renewal had nothing to work with and rejected
    // with "No refresh token stored".
    let refreshed = false;
    const fetchMock = jest.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith("/auth/login")) return ok(loggedIn);
      if (path.endsWith("/auth/refresh")) {
        refreshed = true;
        return ok({ ...loggedIn, access_token: "tok2", refresh_token: "ref2" });
      }
      if (path.endsWith("/me")) {
        return refreshed
          ? ok({ onboarding_completed: true, deactivated_at: null })
          : unauthorized();
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await signIn();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The credential check succeeded, so the user is routed onward rather
    // than shown a failure that has nothing to do with their password.
    expect(router.replace).toHaveBeenCalledWith("/(tabs)");
  });

  test("a plain successful sign in routes to the tabs when onboarding was already completed", async () => {
    mockFetchRoutes({
      "/auth/login": () => ok(loggedIn),
      "/me": () => ok({ onboarding_completed: true, deactivated_at: null }),
    });

    const result = await signIn();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(router.replace).toHaveBeenCalledWith("/(tabs)");
  });

  test("an incomplete onboarding routes to onboarding (spec 0004 AC-9)", async () => {
    mockFetchRoutes({
      "/auth/login": () => ok(loggedIn),
      "/me": () => ok({ onboarding_completed: false, deactivated_at: null }),
    });

    const result = await signIn();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(router.replace).toHaveBeenCalledWith("/onboarding");
  });

  test("a deactivated account routes to the reactivate prompt (spec 0009 AC-4)", async () => {
    mockFetchRoutes({
      "/auth/login": () => ok(loggedIn),
      "/me": () => ok({ onboarding_completed: true, deactivated_at: "2026-01-01T00:00:00Z" }),
    });

    const result = await signIn();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(router.replace).toHaveBeenCalledWith("/reactivate");
  });

  test("a wrong password still surfaces the backend's own message", async () => {
    mockFetchRoutes({
      "/auth/login": () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ detail: { message: "Incorrect email or password." } }),
      }),
    });

    const result = await signIn();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toContain(
      "Incorrect email or password.",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
