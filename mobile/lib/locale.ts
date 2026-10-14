import * as Localization from "expo-localization";

// Spec 0005 AC-11: the device's own region, captured automatically at
// signup with no user prompt -- ISO 3166-1 alpha-2 (e.g. "US", "NG"),
// matching what the backend stores on users.country. undefined when the
// device doesn't report one (some web/CI environments), left for the
// backend's NG-then-US fallback to handle.
export function getDeviceCountry(): string | undefined {
  return Localization.getLocales()[0]?.regionCode ?? undefined;
}
