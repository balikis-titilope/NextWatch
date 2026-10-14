/** @type {import('tailwindcss').Config} */

function withOpacityVar(name) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        "bg-primary": withOpacityVar("--color-bg-primary"),
        "bg-secondary": withOpacityVar("--color-bg-secondary"),
        "bg-tertiary": withOpacityVar("--color-bg-tertiary"),
        "text-primary": withOpacityVar("--color-text-primary"),
        "text-secondary": withOpacityVar("--color-text-secondary"),
        "text-disabled": withOpacityVar("--color-text-disabled"),
        "accent-primary": withOpacityVar("--color-accent-primary"),
        "accent-hover": withOpacityVar("--color-accent-hover"),
        gold: withOpacityVar("--color-gold"),
        success: withOpacityVar("--color-success"),
        trust: withOpacityVar("--color-trust"),
        error: withOpacityVar("--color-error"),
        divider: withOpacityVar("--color-divider"),
      },
      // Type scale from design.md §3. `text-*` carries size + line height
      // (Tailwind's own pairing); `font-*` carries the font family, since
      // family and size/line-height are separate Tailwind theme namespaces.
      // The family names match the weights loaded via useFonts in
      // app/_layout.tsx exactly — no other weights are loaded.
      // Web-only system fallbacks (spec 0011): the landing page renders
      // before Inter/Playfair finish loading. Native takes the first entry
      // only, so these never change native text.
      fontFamily: {
        // Hero headline only (HeroCarousel): the elegant film-credits serif.
        hero: ["CormorantGaramond_700Bold", "Georgia", "serif"],
        "display-xl": ["PlayfairDisplay_700Bold", "Georgia", "serif"],
        "display-lg": ["PlayfairDisplay_700Bold", "Georgia", "serif"],
        "display-md": ["PlayfairDisplay_600SemiBold", "Georgia", "serif"],
        "body-lg": ["Jost_400Regular", "ui-sans-serif", "system-ui", "sans-serif"],
        "body-md": ["Jost_400Regular", "ui-sans-serif", "system-ui", "sans-serif"],
        "body-sm": ["Jost_400Regular", "ui-sans-serif", "system-ui", "sans-serif"],
        label: ["Jost_600SemiBold", "ui-sans-serif", "system-ui", "sans-serif"],
        caption: ["Jost_400Regular", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["32px", { lineHeight: "40px" }],
        "display-lg": ["24px", { lineHeight: "32px" }],
        "display-md": ["20px", { lineHeight: "28px" }],
        "body-lg": ["16px", { lineHeight: "24px" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "body-sm": ["12px", { lineHeight: "16px" }],
        label: ["14px", { lineHeight: "20px" }],
        caption: ["11px", { lineHeight: "14px" }],
      },
    },
  },
  plugins: [],
};
