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

import { useEffect, useState } from "react";

const THEME_KEY = "weddly.theme";

export type Theme = "dark" | "light";

export function useTheme(defaultTheme: Theme): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return defaultTheme;
  });
  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* localStorage blocked, the user's choice just won't persist */
    }
  }, [theme]);
  return [theme, setTheme];
}
