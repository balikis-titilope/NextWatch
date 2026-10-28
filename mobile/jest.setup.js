/* global jest */
// AsyncStorage's native module isn't available under Jest -- its own
// package ships a manual mock for this (see its docs), used here so any
// test that imports lib/themePreference.ts (or app/_layout.tsx, which
// reads it on launch) doesn't hit a native-module error.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
