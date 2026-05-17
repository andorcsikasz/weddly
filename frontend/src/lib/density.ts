// Density preference — flips an `html.density-comfortable` class that the
// CSS in index.css uses to bump the smallest utility-text classes one notch.
// Persisted via localStorage so the choice carries across reloads, and applied
// before React mounts (see main.tsx) to avoid a first-paint flicker.
//
// The two modes:
//   • compact      — current design defaults (no class on <html>).
//   • comfortable  — older relatives / outdoor day-of users; bumps the
//                    `text-[10px]` and `text-[11px]` labels to readable sizes.

import { useCallback, useEffect, useState } from "react";

export type Density = "compact" | "comfortable";

const STORAGE_KEY = "weddly.density";

export function getStoredDensity(): Density {
  if (typeof window === "undefined") return "compact";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

/** Add/remove the marker class on <html>. Called by `setStoredDensity` and by
 *  the early-paint bootstrap in main.tsx so the class is on before React
 *  mounts and the first frame doesn't flash the wrong density. */
export function applyDensity(d: Density): void {
  if (typeof document === "undefined") return;
  const cls = "density-comfortable";
  if (d === "comfortable") document.documentElement.classList.add(cls);
  else document.documentElement.classList.remove(cls);
}

export function setStoredDensity(d: Density): void {
  applyDensity(d);
  try {
    window.localStorage.setItem(STORAGE_KEY, d);
  } catch {
    /* localStorage blocked — the class is applied, just not persisted */
  }
}

/** Reactive hook — returns the current density and a setter that updates
 *  localStorage + the DOM class. Components in different parts of the tree
 *  stay in sync via the storage event we dispatch on write (works because
 *  the standard "storage" event only fires on *other* tabs, so we trigger
 *  our own listeners with a manual dispatch on the local window). */
export function useDensity(): readonly [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() => getStoredDensity());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setDensity(getStoredDensity());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const update = useCallback((d: Density) => {
    setStoredDensity(d);
    setDensity(d);
    // Notify same-window listeners — the native storage event only fires
    // cross-tab, not within the tab that did the write.
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: d }));
    } catch {
      /* StorageEvent constructor unsupported (rare) — same-tab listeners
       * will miss this change but their next remount picks up the value */
    }
  }, []);
  return [density, update] as const;
}
