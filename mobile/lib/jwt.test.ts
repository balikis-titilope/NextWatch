import { isAccessTokenExpired } from "./jwt";

function fakeJwt(payload: object): string {
  const base64url = (input: string) =>
    Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe("isAccessTokenExpired", () => {
  test("returns false for a token that expires well in the future", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

    expect(isAccessTokenExpired(token)).toBe(false);
  });

  test("returns true for a token that already expired", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 });

    expect(isAccessTokenExpired(token)).toBe(true);
  });

  test("returns true for a token expiring within the safety margin", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 10 });

    expect(isAccessTokenExpired(token)).toBe(true);
  });

  test("returns true for a malformed token", () => {
    expect(isAccessTokenExpired("not-a-jwt")).toBe(true);
  });

  test("returns true when the payload has no exp claim", () => {
    const token = fakeJwt({ sub: "user-1" });

    expect(isAccessTokenExpired(token)).toBe(true);
  });
});
