// Density preference — flips a class on <html> that the CSS in index.css
// uses to bump the smallest utility-text classes one (or two) notches up.
// Persisted via localStorage so the choice carries across reloads, and
// applied before React mounts (see main.tsx) so the first paint never
// flashes the wrong density.
//
// The three modes (in increasing size):
//   • compact      — original day-1 sizing, max info-density. No class on <html>.
//   • default      — middle ground. `html.density-default` adds +1px on
//                    the tightest utility labels.
//   • comfortable  — older relatives / outdoor day-of users.
//                    `html.density-comfortable` bumps the same labels +2px.
//
// `default` is the resting value for new visitors — the original day-1
// compact sizing was tight enough that one in three usability sessions
// flagged the 10px labels as unreadable. Existing localStorage values
// (`"compact"` / `"comfortable"`) keep working unchanged; the new middle
// value lands the first time a user touches the slider.

import { useCallback, useEffect, useState } from "react";

export type Density = "compact" | "default" | "comfortable";

const STORAGE_KEY = "weddly.density";
const VALID: ReadonlySet<Density> = new Set(["compact", "default", "comfortable"]);

export function getStoredDensity(): Density {
  if (typeof window === "undefined") return "default";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && VALID.has(raw as Density)) return raw as Density;
    return "default";
  } catch {
    return "default";
  }
}

/** Add/remove the marker class on <html>. Called by `setStoredDensity` and
 *  by the early-paint bootstrap in main.tsx so the class is on before
 *  React mounts and the first frame doesn't flash the wrong density. The
 *  two non-compact classes are mutually exclusive — apply at most one. */
export function applyDensity(d: Density): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.remove("density-default", "density-comfortable");
  if (d === "default") el.classList.add("density-default");
  else if (d === "comfortable") el.classList.add("density-comfortable");
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
