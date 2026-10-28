import { backdropUrl, castPhotoUrl, languageLabel, posterUrl, providerLogoUrl } from "./config";

describe("TMDB image URL helpers (spec 0005 AC-12)", () => {
  test("posterUrl prefixes a poster_path with the poster size bucket", () => {
    expect(posterUrl("/abc123.jpg")).toBe("https://image.tmdb.org/t/p/w342/abc123.jpg");
  });

  test("backdropUrl prefixes a backdrop_path with the backdrop size bucket", () => {
    expect(backdropUrl("/backdrop.jpg")).toBe("https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  });

  test("castPhotoUrl prefixes a profile_path with the cast photo size bucket", () => {
    expect(castPhotoUrl("/face.jpg")).toBe("https://image.tmdb.org/t/p/w185/face.jpg");
  });

  test("providerLogoUrl prefixes a logo_path with the provider logo size bucket", () => {
    expect(providerLogoUrl("/logo.jpg")).toBe("https://image.tmdb.org/t/p/w92/logo.jpg");
  });

  test.each([
    ["posterUrl", posterUrl],
    ["backdropUrl", backdropUrl],
    ["castPhotoUrl", castPhotoUrl],
    ["providerLogoUrl", providerLogoUrl],
  ])("%s returns undefined for null", (_name, fn) => {
    expect(fn(null)).toBeUndefined();
  });

  test.each([
    ["posterUrl", posterUrl],
    ["backdropUrl", backdropUrl],
    ["castPhotoUrl", castPhotoUrl],
    ["providerLogoUrl", providerLogoUrl],
  ])("%s returns undefined for undefined", (_name, fn) => {
    expect(fn(undefined)).toBeUndefined();
  });

  test.each([
    ["posterUrl", posterUrl],
    ["backdropUrl", backdropUrl],
    ["castPhotoUrl", castPhotoUrl],
    ["providerLogoUrl", providerLogoUrl],
  ])("%s returns undefined for an empty string", (_name, fn) => {
    expect(fn("")).toBeUndefined();
  });

  test("each image type resolves to a distinct TMDB size bucket", () => {
    const path = "/same-path.jpg";
    const urls = new Set([
      posterUrl(path),
      backdropUrl(path),
      castPhotoUrl(path),
      providerLogoUrl(path),
    ]);
    expect(urls.size).toBe(4);
  });
});

describe("languageLabel", () => {
  test("reverse-looks-up a known ISO code to its human-readable label", () => {
    expect(languageLabel("ko")).toBe("Korean");
  });

  test("falls back to the raw code when it isn't in the known options", () => {
    expect(languageLabel("xx")).toBe("xx");
  });
});
