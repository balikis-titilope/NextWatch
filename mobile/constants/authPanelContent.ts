// Copy for the cinematic panel on the web auth screens (spec 0012): Log In,
// Sign Up, and the two password reset screens.
// Decoration only: short, well known film lines credited to their films.

export const AUTH_PANEL = {
  login: {
    headline: "Welcome back to the show.",
    body: "Your taste profile is right where you left it.",
  },
  signup: {
    headline: "Your next favorite film is waiting.",
    body: "Rate a few films you love and we do the rest.",
  },
  forgot: {
    headline: "Locked out? It happens.",
    body: "We'll send a code to get you back in.",
  },
  reset: {
    headline: "Almost back in the show.",
    body: "Enter your code and pick a new password.",
  },
};

export const AUTH_QUOTES: { line: string; film: string }[] = [
  { line: "Here's looking at you, kid.", film: "Casablanca" },
  { line: "May the Force be with you.", film: "Star Wars" },
  { line: "Why so serious?", film: "The Dark Knight" },
  { line: "I'll be back.", film: "The Terminator" },
  { line: "Just keep swimming.", film: "Finding Nemo" },
];

export const QUOTE_INTERVAL_MS = 6000;
