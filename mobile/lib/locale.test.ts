import * as Localization from "expo-localization";
import { getDeviceCountry } from "./locale";

jest.mock("expo-localization", () => ({
  getLocales: jest.fn(),
}));

describe("getDeviceCountry", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns the first locale's regionCode (spec 0005 AC-11)", () => {
    (Localization.getLocales as jest.Mock).mockReturnValue([
      { languageTag: "en-US", regionCode: "US" },
      { languageTag: "fr-FR", regionCode: "FR" },
    ]);

    expect(getDeviceCountry()).toBe("US");
  });

  test("returns undefined when the first locale has a null regionCode", () => {
    (Localization.getLocales as jest.Mock).mockReturnValue([
      { languageTag: "en", regionCode: null },
    ]);

    expect(getDeviceCountry()).toBeUndefined();
  });

  test("returns undefined when there are no locales at all", () => {
    (Localization.getLocales as jest.Mock).mockReturnValue([]);

    expect(getDeviceCountry()).toBeUndefined();
  });
});
