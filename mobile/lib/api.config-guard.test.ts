jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: {} },
  },
}));

describe("api module setup", () => {
  test("throws a clear error at import time when EXPO_PUBLIC_API_BASE_URL is not configured", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a synchronous require to assert the module-load-time throw
    expect(() => require("./api")).toThrow(/EXPO_PUBLIC_API_BASE_URL/);
  });
});
