// Web export for Cloudflare. Cloudflare Workers Builds sets WORKERS_CI_BRANCH;
// any branch other than main is a preview, which must not be indexed and has
// no canonical address. Locally the variable is unset and nothing changes.
const { spawnSync } = require("child_process");
const fs = require("fs");

const branch = process.env.WORKERS_CI_BRANCH;
const env = { ...process.env };
if (branch && branch !== "main") {
  env.EXPO_PUBLIC_NOINDEX = "1";
  env.EXPO_PUBLIC_SITE_URL = "";
}

// Check the two web build variables before the slow export. A bad value makes
// app/+html.tsx throw during static rendering, and Expo reports only a blank
// "Failed to statically export route:", hiding the real message. lib/siteConfig
// has no imports, so Node can load it directly. Only its own EXPO_PUBLIC_ errors
// stop the build; any other load problem is left for the export to report.
try {
  const { parseSiteUrl, parseNoindex } = require("../lib/siteConfig.ts");
  parseSiteUrl(env.EXPO_PUBLIC_SITE_URL);
  parseNoindex(env.EXPO_PUBLIC_NOINDEX);
} catch (error) {
  if (error && /^EXPO_PUBLIC_/.test(error.message)) {
    console.error(`\nBad web build setting: ${error.message}`);
    console.error("Fix the variable in Cloudflare (Settings, Build variables) or in mobile/.env.");
    process.exit(1);
  }
}

// Output is captured so a failure can print the real error: Metro's progress
// bars otherwise bury it in the Cloudflare build log.
const result = spawnSync("npx expo export --platform web", {
  shell: true,
  encoding: "utf8",
  env,
  maxBuffer: 256 * 1024 * 1024,
});
const lines = `${result.stdout}\n${result.stderr}`
  .split("\n")
  .filter((line) => !/[░-▓]/.test(line));
console.log(lines.join("\n"));
if (result.status !== 0) {
  console.error(`\nexpo export failed (exit ${result.status}, signal ${result.signal}).`);
  process.exit(result.status || 1);
}
fs.copyFileSync("dist/+not-found.html", "dist/404.html");
