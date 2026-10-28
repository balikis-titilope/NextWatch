const { dark, light, hexToRgbTriplet } = require("./colors.cjs");

describe("hexToRgbTriplet", () => {
  test("converts a hex color with a leading # to a space separated RGB triplet", () => {
    expect(hexToRgbTriplet("#1A1612")).toBe("26 22 18");
  });

  test("handles hex values without the leading #", () => {
    expect(hexToRgbTriplet("FFFFFF")).toBe("255 255 255");
  });

  test("converts pure black and pure white correctly", () => {
    expect(hexToRgbTriplet("#000000")).toBe("0 0 0");
    expect(hexToRgbTriplet("#FFFFFF")).toBe("255 255 255");
  });

  test("is case insensitive", () => {
    expect(hexToRgbTriplet("#e8502e")).toBe(hexToRgbTriplet("#E8502E"));
  });
});

describe("dark and light palettes", () => {
  test("define the exact same set of token keys", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  test("every token in both palettes is a valid 6 digit hex color", () => {
    for (const value of [...Object.values(dark), ...Object.values(light)]) {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test("dark and light use different values for the same token (themes are not accidentally identical)", () => {
    for (const key of Object.keys(dark)) {
      expect(dark[key]).not.toBe(light[key]);
    }
  });
});
