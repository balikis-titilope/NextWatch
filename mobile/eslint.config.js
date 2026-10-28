// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");
const prettierConfig = require("eslint-config-prettier");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/**", ".agents/**", ".claude/**", ".expo/**"],
  },
  {
    files: ["**/*.test.{js,jsx,ts,tsx}", "**/__tests__/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: globals.jest,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/telemetry.ts", "**/*.test.{ts,tsx}", "**/__mocks__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: ["@sentry/react-native", "posthog-react-native"] },
      ],
    },
  },
  prettierConfig,
]);
