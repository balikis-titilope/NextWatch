import { parseNoindex, parseSiteUrl } from "./siteConfig";

describe("parseSiteUrl (spec 0014 rule 5)", () => {
  test("returns undefined when unset or blank", () => {
    expect(parseSiteUrl(undefined)).toBeUndefined();
    expect(parseSiteUrl("  ")).toBeUndefined();
  });

  test("returns the bare origin without a trailing slash", () => {
    expect(parseSiteUrl("https://nextwatch-web.example.workers.dev/")).toBe(
      "https://nextwatch-web.example.workers.dev",
    );
    expect(parseSiteUrl("https://nextwatch-web.example.workers.dev")).toBe(
      "https://nextwatch-web.example.workers.dev",
    );
  });

  test.each([
    "not a url",
    "http://example.com",
    "https://example.com/app",
    "https://example.com/?a=1",
  ])("throws on %s", (value) => {
    expect(() => parseSiteUrl(value)).toThrow(/EXPO_PUBLIC_SITE_URL/);
  });
});

describe("parseNoindex (spec 0014 rule 5)", () => {
  test("is off when unset, blank or 0", () => {
    expect(parseNoindex(undefined)).toBe(false);
    expect(parseNoindex("")).toBe(false);
    expect(parseNoindex("0")).toBe(false);
  });

  test("is on for 1", () => {
    expect(parseNoindex("1")).toBe(true);
  });

  test("throws on anything else", () => {
    expect(() => parseNoindex("true")).toThrow(/EXPO_PUBLIC_NOINDEX/);
  });
});
