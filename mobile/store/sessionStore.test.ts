import { clearTokens } from "../lib/tokens";
import { useSessionStore } from "./sessionStore";

jest.mock("../lib/tokens", () => ({
  clearTokens: jest.fn().mockResolvedValue(undefined),
}));

describe("useSessionStore", () => {
  afterEach(() => {
    useSessionStore.setState({ userId: null, launchRoute: null });
    jest.clearAllMocks();
  });

  test("starts with no signed in user", () => {
    expect(useSessionStore.getState().userId).toBeNull();
  });

  test("starts with no resolved launch route", () => {
    expect(useSessionStore.getState().launchRoute).toBeNull();
  });

  test("setUserId stores the given user id", () => {
    useSessionStore.getState().setUserId("user-42");

    expect(useSessionStore.getState().userId).toBe("user-42");
  });

  test("setUserId(null) clears a previously set session", () => {
    useSessionStore.getState().setUserId("user-42");

    useSessionStore.getState().setUserId(null);

    expect(useSessionStore.getState().userId).toBeNull();
  });

  test("setLaunchRoute stores the resolved launch decision", () => {
    useSessionStore.getState().setLaunchRoute("/(tabs)");

    expect(useSessionStore.getState().launchRoute).toBe("/(tabs)");
  });

  test("clearSession clears the stored tokens and nulls the user id", async () => {
    useSessionStore.getState().setUserId("user-42");

    await useSessionStore.getState().clearSession();

    expect(clearTokens).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().userId).toBeNull();
  });
});
