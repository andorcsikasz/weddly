// React.lazy wrapper for page/component chunks. A rejected dynamic import in
// production almost always means a deploy rotated the hashed asset names under
// a session that still holds the old index.html: the old chunk URL now 404s
// (or serves index.html, which never satisfies the import), so the user lands
// on the error boundary and every retry re-requests the same dead URL. One
// hard reload fetches the fresh index.html with the new hashes. The
// sessionStorage latch (60s TTL) keeps a genuinely broken build from
// reload-looping: the second failure inside the window falls through to the
// error boundary instead.

import { type ComponentType, type LazyExoticComponent, lazy } from "react";

const RELOAD_LATCH_KEY = "weddly.chunkReloadAt";
const RELOAD_LATCH_TTL_MS = 60_000;

function recentlyReloaded(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_LATCH_KEY) ?? 0);
    return Date.now() - at < RELOAD_LATCH_TTL_MS;
  } catch {
    return true; // no storage → don't risk a reload loop
  }
}

// biome-ignore lint/suspicious/noExplicitAny: mirrors React.lazy's own constraint
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err) => {
      if (typeof window !== "undefined" && !recentlyReloaded()) {
        try {
          window.sessionStorage.setItem(RELOAD_LATCH_KEY, String(Date.now()));
        } catch {
          /* fall through to the reload anyway; worst case the boundary catches round 2 */
        }
        window.location.reload();
        // Keep the Suspense fallback up while the reload happens instead of
        // flashing the error boundary.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }),
  );
}
