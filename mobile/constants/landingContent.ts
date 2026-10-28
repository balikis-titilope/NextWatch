// Copy for the web landing page (spec 0011), taken from the supplied design.
// Kept out of the components so wording changes never touch layout code.

export const LANDING_TITLE = "NextWatch: your next favorite film";
export const LANDING_DESCRIPTION =
  "The discovery engine for true cinephiles. Rate a few films, get a short list matched to your taste and mood, and stop scrolling.";

export type NavSection = "top" | "features" | "how";

export const NAV_LINKS: { label: string; section: NavSection }[] = [
  { label: "Discover", section: "top" },
  { label: "Features", section: "features" },
  { label: "How It Works", section: "how" },
];

export const HERO = {
  headline: "Your Next Favorite Film is One Tap Away.",
  body: "The intelligent discovery engine for true cinephiles. Stop endlessly scrolling and start watching what moves you.",
  cta: "Start Rating Now",
};

export const CALLOUT = {
  heading: "Tired of scrolling for 45 minutes?",
  body: "NextWatch tells you what to watch in seconds. Our intelligent engine cuts through the noise so you can spend less time searching and more time experiencing great cinema.",
};

export const DIFFERENCE = {
  heading: "Discover the Difference",
  subheading: "A tailored cinematic journey, built for you.",
  moodTitle: "Mood Discovery",
  moodBody:
    '"How are you feeling?" We match films to your current emotional state, moving beyond rigid genres to find exactly what you need right now.',
  moodChips: ["Melancholic", "Triumphant", "Gloomy"],
  matchTitle: "Smart Matches",
  matchBody: "Predicted scores based on your unique cinematic DNA.",
  matchExample: "4.2 match",
  tasteTitle: "Built on Your Taste",
  tasteBody:
    "Our custom rating engine learns from every interaction. We don't care what the critics think; we care what you will love.",
};

export const GLOBAL_CINEMA = {
  heading: "Global Cinematic DNA",
  body: "We don't just know Hollywood. From the vibrant energy of Nollywood and the epic scales of Bollywood to the emotional depth of K-dramas, NextWatch understands the nuances of global cinema.",
  regions: ["K-Dramas", "Bollywood", "Nollywood", "European Arthouse"],
};

export const HOW_IT_WORKS = {
  heading: "How it Works",
  subheading: "Three steps to your next obsession.",
  steps: [
    { title: "Rate", body: "Rate movies you've seen to build your profile." },
    { title: "Match", body: "Our AI learns your unique cinematic taste." },
    { title: "Watch", body: "Discover and enjoy your next favorite film." },
  ],
};

export const FAQ = {
  heading: "Frequently asked questions",
  items: [
    {
      question: "Is NextWatch free to use?",
      answer: "Yes! Our core discovery engine and rating system are completely free for all users.",
    },
    {
      question: "What regions are supported?",
      answer:
        "NextWatch supports global cinema, with deep catalogs for Hollywood, Bollywood, Nollywood, K-Dramas, and European Arthouse.",
    },
    {
      question: "How accurate are the matches?",
      answer:
        "Our engine learns from every rating. The more you use it, the more uncannily accurate your personalized score becomes.",
    },
  ],
};

export const FOOTER = {
  features: "Features",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  contact: "Contact",
  copyright: "© 2026 NextWatch. Cinematic Discovery.",
};
