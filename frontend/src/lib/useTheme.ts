// Shared warm-dark mode hook. The preference lives in
// `localStorage["weddly.theme"]` so toggling in any shell (landing, couple
// /app, planner, vendor) carries into the others. The class goes on <html>
// so portals (Toasts, Dialogs, maps) inherit it automatically.
//
// We deliberately do NOT remove the `dark` class on unmount; that would
// strip the preference when navigating between shells; the next shell
// re-applies it on its own mount.
//
// `defaultTheme` is the shell's fallback when the user has never expressed a
// preference: "light" for the public marketing pages (warm paper aesthetic),
// "dark" for the authenticated workspaces.
//
// A user-initiated switch is a circle spreading up from the bottom edge
// (View Transitions API: the new theme's snapshot is clipped to a growing
// circle anchored at bottom centre). Browsers without the API, and
// reduced-motion users, get the instant swap they always had. The CSS side
// lives under `html.theme-vt` in index.css.

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

const THEME_KEY = "weddly.theme";
const REVEAL_MS = 650;

export type Theme = "dark" | "light";

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

function applyThemeClass(theme: Theme): void {
  if (theme === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
}

export function useTheme(defaultTheme: Theme): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return defaultTheme;
  });
  useEffect(() => {
    applyThemeClass(theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* localStorage blocked, the user's choice just won't persist */
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    const doc = document as ViewTransitionDoc;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof doc.startViewTransition !== "function" || reduced) {
      setThemeState(next);
      return;
    }
    const root = document.documentElement;
    root.classList.add("theme-vt");
    const transition = doc.startViewTransition(() => {
      applyThemeClass(next);
      flushSync(() => setThemeState(next));
    });
    transition.ready
      .then(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        // Farthest viewport corner from the bottom-centre origin.
        const radius = Math.hypot(w / 2, h);
        root.animate(
          {
            clipPath: [`circle(0px at 50% 100%)`, `circle(${radius}px at 50% 100%)`],
          },
          {
            duration: REVEAL_MS,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* transition skipped, the theme has already been applied */
      });
    transition.finished.finally(() => root.classList.remove("theme-vt"));
  }, []);

  return [theme, setTheme];
}
