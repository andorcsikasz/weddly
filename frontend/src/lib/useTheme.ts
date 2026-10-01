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
// A user-initiated switch is a circle spreading out from the moon / sun
// button that was pressed (View Transitions API: the new theme's snapshot is
// clipped to a growing circle centred on the toggle). The origin is the last
// pointer press, or the focused button for a keyboard toggle, or bottom
// centre when neither is known. Browsers without the API, and
// reduced-motion users, get the instant swap they always had. The CSS side
// lives under `html.theme-vt` in index.css.

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

const THEME_KEY = "weddly.theme";
const REVEAL_MS = 1000;

// Callers only pass the next theme, so the origin comes from the press that
// triggered the switch. Captured at the document level so no toggle button
// needs to know about the animation.
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPress = { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

function revealOrigin(): { x: number; y: number } {
  if (lastPress && Date.now() - lastPress.at < 1500) return lastPress;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight };
}

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
    const origin = revealOrigin();
    lastPress = null;
    root.classList.add("theme-vt");
    const transition = doc.startViewTransition(() => {
      applyThemeClass(next);
      flushSync(() => setThemeState(next));
    });
    transition.ready
      .then(() => {
        const { x, y } = origin;
        // Distance to the farthest viewport corner, so the circle covers it all.
        const radius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y),
        );
        root.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
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
