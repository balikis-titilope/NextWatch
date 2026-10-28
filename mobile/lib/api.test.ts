import { apiFetch, ApiError, apiErrorMessage, TransportError } from "./api";
import * as tokens from "./tokens";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: "https://api.test" } },
  },
}));

jest.mock("./tokens", () => ({
  __esModule: true,
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
  getSessionEpoch: jest.fn(),
}));

function mockFetchOnce(response: Partial<Response>) {
  global.fetch = jest.fn().mockResolvedValue(response);
  return global.fetch as jest.Mock;
}

function mockFetchSequence(...responses: Partial<Response>[]) {
  const fetchMock = jest.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  global.fetch = fetchMock;
  return fetchMock;
}

describe("apiFetch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tokens.getAccessToken as jest.Mock).mockResolvedValue(null);
    (tokens.getRefreshToken as jest.Mock).mockResolvedValue(null);
    (tokens.setTokens as jest.Mock).mockResolvedValue(undefined);
    (tokens.clearTokens as jest.Mock).mockResolvedValue(undefined);
    // A stable epoch by default -- no logout race in flight during these
    // tests unless a specific test overrides this.
    (tokens.getSessionEpoch as jest.Mock).mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("requests the base URL joined with the given path", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/movies");

    expect(fetchMock).toHaveBeenCalledWith("https://api.test/movies", expect.anything());
  });

  test("always sends a JSON content type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/movies");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  test("adds a Bearer Authorization header when a token is given", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/me", { token: "abc123" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer abc123");
  });

  test("auto-attaches a stored access token when no explicit token is given", async () => {
    (tokens.getAccessToken as jest.Mock).mockResolvedValue("stored-token");
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/me");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer stored-token");
  });

  test("token: null opts out of the stored token entirely", async () => {
    (tokens.getAccessToken as jest.Mock).mockResolvedValue("stored-token");
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/auth/refresh", { token: null });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  test("omits the Authorization header when no token is stored or given", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/movies");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  test("caller supplied headers are merged in", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/movies", { headers: { "X-Trace-Id": "trace-1" } });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["X-Trace-Id"]).toBe("trace-1");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  test("serializes an object body to a JSON string", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/ratings", { method: "POST", body: { movieId: 1, score: 5 } });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe(JSON.stringify({ movieId: 1, score: 5 }));
  });

  test("sends no body when none is given", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

    await apiFetch("/movies");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeUndefined();
  });

  test("resolves with the parsed JSON body on success", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ title: "Arrival" }) });

    const result = await apiFetch<{ title: string }>("/movies/1");

    expect(result).toEqual({ title: "Arrival" });
  });

  test("resolves with undefined for a 204 No Content response, without reading a body", async () => {
    const jsonSpy = jest.fn();
    mockFetchOnce({ ok: true, status: 204, json: jsonSpy });

    const result = await apiFetch("/ratings/1", { method: "DELETE" });

    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  test("throws an ApiError carrying the status and response text on a non-ok response", async () => {
    mockFetchOnce({ ok: false, status: 404, text: async () => "Movie not found" });

    await expect(apiFetch("/movies/999")).rejects.toMatchObject(
      new ApiError("Movie not found", 404),
    );
  });

  test("a thrown ApiError is an instance of Error with name ApiError", async () => {
    mockFetchOnce({ ok: false, status: 401, text: async () => "Unauthorized" });

    await expect(apiFetch("/me")).rejects.toThrow(ApiError);
  });

  test("a 401 from a call that never carried a token passes straight through, untouched", async () => {
    const fetchMock = mockFetchOnce({ ok: false, status: 401, text: async () => "Unauthorized" });

    await expect(apiFetch("/movies")).rejects.toMatchObject(new ApiError("Unauthorized", 401));
    // No renewal attempt: only the one call, never a second one to /auth/refresh.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch session renewal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tokens.getAccessToken as jest.Mock).mockResolvedValue("expired-token");
    (tokens.getRefreshToken as jest.Mock).mockResolvedValue("stored-refresh");
    (tokens.setTokens as jest.Mock).mockResolvedValue(undefined);
    (tokens.clearTokens as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("on a 401 with a stored token, renews once and retries the original request (AC-3)", async () => {
    const fetchMock = mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          user_id: "u1",
        }),
      },
      { ok: true, status: 200, json: async () => ({ title: "Arrival" }) },
    );

    const result = await apiFetch<{ title: string }>("/me");

    expect(result).toEqual({ title: "Arrival" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.test/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers["Authorization"]).toBe("Bearer new-token");
    expect(tokens.setTokens).toHaveBeenCalledWith({
      access_token: "new-token",
      refresh_token: "new-refresh",
      user_id: "u1",
    });
    expect(tokens.clearTokens).not.toHaveBeenCalled();
  });

  test("a 401 that persists after renewal is terminal and clears the session, never renews twice (AC-11)", async () => {
    const fetchMock = mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          user_id: "u1",
        }),
      },
      { ok: false, status: 401, text: async () => "still unauthorized" },
    );

    await expect(apiFetch("/me")).rejects.toMatchObject(new ApiError("still unauthorized", 401));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(tokens.clearTokens).toHaveBeenCalledTimes(1);
  });

  test("an explicit rejection of the refresh token clears the session, after retrying it (AC-4)", async () => {
    // A 401 refresh rejection gets a bounded retry before it's treated as
    // final (the stored refresh token may just not have round-tripped on a
    // prior renewal due to a dropped response) -- three straight
    // rejections is what it takes to actually clear the session.
    const fetchMock = mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      { ok: false, status: 401, text: async () => "invalid_grant" },
      { ok: false, status: 401, text: async () => "invalid_grant" },
      { ok: false, status: 401, text: async () => "invalid_grant" },
    );

    await expect(apiFetch("/me")).rejects.toThrow(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(tokens.clearTokens).toHaveBeenCalledTimes(1);
  });

  test("a refresh rejection that recovers on retry does not clear the session", async () => {
    const fetchMock = mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      { ok: false, status: 401, text: async () => "invalid_grant" },
      {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          user_id: "u1",
        }),
      },
      { ok: true, status: 200, json: async () => ({ title: "Arrival" }) },
    );

    const result = await apiFetch<{ title: string }>("/me");

    expect(result).toEqual({ title: "Arrival" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(tokens.clearTokens).not.toHaveBeenCalled();
    expect(tokens.setTokens).toHaveBeenCalledWith({
      access_token: "new-token",
      refresh_token: "new-refresh",
      user_id: "u1",
    });
  });

  test("a network/5xx renewal failure does not clear the session (AC-10)", async () => {
    mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      { ok: false, status: 503, text: async () => "auth provider unavailable" },
    );

    await expect(apiFetch("/me")).rejects.toMatchObject(
      new ApiError("auth provider unavailable", 503),
    );

    expect(tokens.clearTokens).not.toHaveBeenCalled();
  });

  test("sessionRecovery: false never clears the session, even on a terminal 401 (AC-5)", async () => {
    mockFetchSequence(
      { ok: false, status: 401, text: async () => "expired" },
      {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          user_id: "u1",
        }),
      },
      { ok: false, status: 401, text: async () => "still unauthorized" },
    );

    await expect(
      apiFetch("/me/onboarding/complete", { method: "POST", sessionRecovery: false }),
    ).rejects.toThrow(ApiError);

    expect(tokens.clearTokens).not.toHaveBeenCalled();
  });

  test("concurrent 401s share a single renewal call (AC-6)", async () => {
    const refreshCalls: string[] = [];
    const attemptsByPath: Record<string, number> = {};

    global.fetch = jest.fn((input: unknown) => {
      const path = input as string;
      if (path === "https://api.test/auth/refresh") {
        refreshCalls.push(path);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "new-token",
            refresh_token: "new-refresh",
            user_id: "u1",
          }),
        });
      }
      attemptsByPath[path] = (attemptsByPath[path] ?? 0) + 1;
      const isRetry = attemptsByPath[path] > 1;
      return Promise.resolve(
        isRetry
          ? { ok: true, status: 200, json: async () => ({ title: path }) }
          : { ok: false, status: 401, text: async () => "expired" },
      );
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      apiFetch<{ title: string }>("/movies/1"),
      apiFetch<{ title: string }>("/movies/2"),
    ]);

    expect(a.title).toBe("https://api.test/movies/1");
    expect(b.title).toBe("https://api.test/movies/2");
    expect(refreshCalls).toHaveLength(1);
  });

  test("a rejected fetch raises a TransportError rather than escaping as a bare TypeError", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed")) as never;

    await expect(apiFetch("/auth/login", { token: null })).rejects.toThrow(TransportError);
  });
});

// The fallback copy every screen passes in is a last resort, not the normal
// answer: a failure that can be named should name itself.
describe("apiErrorMessage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("prefers the server's own detail message over anything derived", () => {
    const error = new ApiError(JSON.stringify({ detail: "Invalid email or password" }), 401);
    expect(apiErrorMessage(error, "fallback")).toBe("Invalid email or password");
  });

  test("prefers a structured {message, error_code} detail too", () => {
    const error = new ApiError(
      JSON.stringify({
        detail: { message: "Confirm your email before logging in.", error_code: "x" },
      }),
      403,
    );
    expect(apiErrorMessage(error, "fallback")).toBe("Confirm your email before logging in.");
  });

  test("names an unreachable server instead of returning the generic fallback", () => {
    const error = new TransportError("Network request failed", "offline");
    expect(apiErrorMessage(error, "Something went wrong. Try again.")).toBe(
      "Couldn't reach NextWatch. Check your connection and try again.",
    );
  });

  test("distinguishes a timeout from being offline", () => {
    expect(apiErrorMessage(new TransportError("timed out", "timeout"))).toBe(
      "NextWatch took too long to respond. Try again.",
    );
  });

  test("a 503 with no usable detail still says the server is unwell", () => {
    // The real shape seen in the field: a proxy or gateway answering with a
    // status and an empty body.
    expect(apiErrorMessage(new ApiError("", 503), "Something went wrong. Try again.")).toBe(
      "NextWatch is having trouble right now. Try again in a moment.",
    );
  });

  test("a 429 reads as rate limiting, not a generic failure", () => {
    expect(apiErrorMessage(new ApiError("", 429))).toBe(
      "Too many requests. Wait a bit before trying again.",
    );
  });

  test("never renders a raw JSON validation payload", () => {
    // FastAPI answers an unparseable body with detail as an ARRAY, which
    // parseErrorBody cannot read a message out of. The raw JSON used to be
    // shown verbatim on screen.
    const error = new ApiError(
      JSON.stringify({
        detail: [{ type: "json_invalid", loc: ["body", 1], msg: "JSON decode error" }],
      }),
      422,
    );
    const message = apiErrorMessage(error, "Something went wrong. Try again.");
    expect(message).toBe("Some of those details aren't valid. Check them and try again.");
    expect(message).not.toContain("json_invalid");
  });

  test("never renders an HTML error page from something in front of the API", () => {
    const error = new ApiError("<html><body>502 Bad Gateway</body></html>", 502);
    expect(apiErrorMessage(error, "fallback")).toBe(
      "NextWatch is having trouble right now. Try again in a moment.",
    );
  });

  test("still shows a short plain-text body from the server as written", () => {
    expect(apiErrorMessage(new ApiError("Rate limit exceeded", 400))).toBe("Rate limit exceeded");
  });

  test("does not claim a 401 was a wrong password", () => {
    // Deliberate: the same status covers a rejected credential and a rejected
    // request, and guessing wrong misinforms the user about their password.
    expect(apiErrorMessage(new ApiError("", 401), "Something went wrong. Try again.")).toBe(
      "Something went wrong. Try again.",
    );
  });

  test("a 401 that does carry a detail still reaches the user verbatim", () => {
    const error = new ApiError(JSON.stringify({ detail: "Invalid email or password" }), 401);
    expect(apiErrorMessage(error, "Something went wrong. Try again.")).toBe(
      "Invalid email or password",
    );
  });
});
