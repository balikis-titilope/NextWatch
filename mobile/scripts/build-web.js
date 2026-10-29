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
