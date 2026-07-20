// Reactive media query. Subscribes, so a rotated phone or a resized window is
// picked up instead of being frozen at whatever was true on mount.
//
// The design page previously sampled `matchMedia("(min-width: 1024px)")` once
// with no listener, which meant a couple who rotated their tablet kept the
// layout decision made in the other orientation until they navigated away.

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (ev: MediaQueryListEvent) => setMatches(ev.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
