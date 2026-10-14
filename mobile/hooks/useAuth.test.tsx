import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { getDeviceCountry } from "../lib/locale";
import { useSignup, useVerifySignup } from "./useAuth";

// Scoped to this session's change: threading the device country into the
// two signup request bodies (spec 0005 AC-11). useAuth's pre-existing
// routing side effects (confirmation-required redirect, onboarding
// launch route, etc.) predate this change and are not re-covered here.
jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));
jest.mock("../lib/locale", () => ({
  getDeviceCountry: jest.fn(),
}));
jest.mock("expo-router", () => ({
  router: { replace: jest.fn() },
}));
jest.mock("../lib/tokens", () => ({
  setTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../lib/telemetry", () => ({
  identifyUser: jest.fn(),
}));
jest.mock("../store/sessionStore", () => ({
  useSessionStore: { getState: () => ({ setUserId: jest.fn(), setLaunchRoute: jest.fn() }) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSignup: device country capture (spec 0005 AC-11)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("sends the device's region alongside email/password", async () => {
    (getDeviceCountry as jest.Mock).mockReturnValue("GB");
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "confirmation_required",
      email: "a@b.com",
    });

    const { result } = await renderHook(() => useSignup(), { wrapper });
    result.current.mutate({ email: "a@b.com", password: "pw123456" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/auth/signup", {
      method: "POST",
      body: { email: "a@b.com", password: "pw123456", country: "GB" },
      token: null,
    });
  });

  test("sends country: undefined when the device reports no region (falls back server side)", async () => {
    (getDeviceCountry as jest.Mock).mockReturnValue(undefined);
    (apiFetch as jest.Mock).mockResolvedValue({
      status: "confirmation_required",
      email: "a@b.com",
    });

    const { result } = await renderHook(() => useSignup(), { wrapper });
    result.current.mutate({ email: "a@b.com", password: "pw123456" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [, options] = (apiFetch as jest.Mock).mock.calls[0];
    expect(options.body.country).toBeUndefined();
  });
});

describe("useVerifySignup: device country capture (spec 0005 AC-11)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("sends the device's region again alongside email/token, for the confirm-email path", async () => {
    (getDeviceCountry as jest.Mock).mockReturnValue("NG");
    (apiFetch as jest.Mock).mockResolvedValue({
      access_token: "tok",
      refresh_token: "ref",
      user_id: "u1",
    });

    const { result } = await renderHook(() => useVerifySignup(), { wrapper });
    result.current.mutate({ email: "a@b.com", token: "123456" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/auth/verify-signup", {
      method: "POST",
      body: { email: "a@b.com", token: "123456", country: "NG" },
      token: null,
    });
  });
});
