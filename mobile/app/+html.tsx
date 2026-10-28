import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";
import { NOINDEX } from "../lib/siteConfig";

// Runs before first paint (spec 0011): picks the stored manual theme, else
// the OS setting, and sets the "dark" class NativeWind's darkMode: "class"
// reads. The static export itself is dark (the class below), matching the
// design, and this script flips it to light when needed.
const THEME_SCRIPT = `try{var p=localStorage.getItem('nextwatch_theme_preference');var d=p?p==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* Preview builds only (spec 0014 rule 5): keep preview addresses out of search. */}
        {NOINDEX ? <meta name="robots" content="noindex, nofollow" /> : null}
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
