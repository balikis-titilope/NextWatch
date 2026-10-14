import fs from "fs";
import path from "path";
import { dark, light, hexToRgbTriplet } from "../constants/colors.cjs";

// Guards against constants/colors.cjs (source of truth) and global.css
// (the CSS variables Tailwind actually reads) silently drifting apart,
// since nothing else re-derives global.css from colors.cjs automatically.
describe("color token sync: colors.cjs vs global.css", () => {
  const css = fs.readFileSync(path.join(__dirname, "../global.css"), "utf8");

  function readBlock(selector: string): Record<string, string> {
    const match = css.match(new RegExp(`${selector}\\s*{([^}]*)}`));
    if (!match) throw new Error(`Selector ${selector} not found in global.css`);
    const vars: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const decl = line.match(/--color-([\w-]+):\s*([\d\s]+);/);
      if (decl) vars[decl[1]] = decl[2].trim().replace(/\s+/g, " ");
    }
    return vars;
  }

  const rootVars = readBlock(":root");
  const darkVars = readBlock("\\.dark:root");

  it.each(Object.entries(light))("light token %s matches :root", (token, hex) => {
    expect(rootVars[token]).toBe(hexToRgbTriplet(hex));
  });

  it.each(Object.entries(dark))("dark token %s matches .dark", (token, hex) => {
    expect(darkVars[token]).toBe(hexToRgbTriplet(hex));
  });

  it("has no tokens in global.css that colors.cjs doesn't define", () => {
    expect(Object.keys(rootVars).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(darkVars).sort()).toEqual(Object.keys(dark).sort());
  });
});
