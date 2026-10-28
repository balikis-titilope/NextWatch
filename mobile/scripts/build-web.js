// Web export for Cloudflare. Cloudflare Workers Builds sets WORKERS_CI_BRANCH;
// any branch other than main is a preview, which must not be indexed and has
// no canonical address. Locally the variable is unset and nothing changes.
const { execSync } = require("child_process");
const fs = require("fs");

const branch = process.env.WORKERS_CI_BRANCH;
const env = { ...process.env };
if (branch && branch !== "main") {
  env.EXPO_PUBLIC_NOINDEX = "1";
  env.EXPO_PUBLIC_SITE_URL = "";
}

execSync("npx expo export --platform web", { stdio: "inherit", env });
fs.copyFileSync("dist/+not-found.html", "dist/404.html");
