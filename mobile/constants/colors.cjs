// Single source of truth for color tokens (design.md §2.2/§2.3).
// tailwind.config.js reads the RGB triplets below; hooks/useTheme.ts re-exports
// the hex values for non-className uses (gradients, status bar, icon colors).
// CommonJS so tailwind.config.js (CJS) and TypeScript can both import it without
// keeping two copies in sync by hand.

const dark = {
  "bg-primary": "#1A1612",
  "bg-secondary": "#252018",
  "bg-tertiary": "#2E2820",
  "text-primary": "#F2EDE4",
  "text-secondary": "#A89F94",
  "text-disabled": "#5C554E",
  "accent-primary": "#E8502E",
  "accent-hover": "#C43E20",
  gold: "#F0C040",
  success: "#27AE60",
  trust: "#2980B9",
  error: "#E74C3C",
  divider: "#3A3228",
};

const light = {
  "bg-primary": "#F5F0E8",
  "bg-secondary": "#EDE8DF",
  "bg-tertiary": "#E0D9CE",
  "text-primary": "#1A1612",
  "text-secondary": "#5C4F43",
  "text-disabled": "#A89F94",
  "accent-primary": "#C43E20",
  "accent-hover": "#A33318",
  gold: "#D4A017",
  success: "#1E8449",
  trust: "#1A6B99",
  error: "#C0392B",
  divider: "#D4CEC4",
};

function hexToRgbTriplet(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

module.exports = { dark, light, hexToRgbTriplet };
