import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";

/** Client-side navigation wrapped in a View Transition: the page being left
 *  fades out while the next one rises in, instead of a hard cut.
 *
 *  `load` is the target route's lazy chunk (the same `import()` its
 *  `lazyWithReload` uses, so Vite hands back the one module). It is awaited
 *  BEFORE the transition starts, because a snapshot taken while the route is
 *  still fetching would crossfade into the loading spinner. After the
 *  navigation commits, React's lazy wrapper still suspends for a tick, so the
 *  update callback also waits for the route's loader to leave the DOM (capped,
 *  so a slow page can never hold the screen frozen).
 *
 *  Falls back to a plain navigate where the API is missing or the visitor asked
 *  for reduced motion. */
export async function navigateWithTransition(
  navigate: NavigateFunction,
  to: string,
  load?: () => Promise<unknown>,
): Promise<void> {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof document === "undefined" || !document.startViewTransition || reduced) {
    navigate(to);
    return;
  }
  try {
    await load?.();
  } catch {
    // The route's own lazy wrapper handles a failed chunk; just go.
    navigate(to);
    return;
  }
  const root = document.documentElement;
  root.classList.add("page-vt");
  const vt = document.startViewTransition(async () => {
    flushSync(() => navigate(to));
    await routeSettled();
    // The app's ScrollToTop runs in an effect that can land after the new
    // snapshot is taken, which would capture the next page still scrolled to
    // where the landing was. Reset it here, inside the update.
    if (!to.includes("#")) window.scrollTo(0, 0);
  });
  vt.finished.finally(() => root.classList.remove("page-vt"));
}

/** Resolves once no route loader is mounted, or after `maxMs`. Polls on
 *  timers rather than rAF, since rendering is paused while a view transition
 *  waits on its update callback. */
function routeSettled(maxMs = 600): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!document.querySelector("[data-route-loader]") || performance.now() - start > maxMs) {
        resolve();
        return;
      }
      setTimeout(tick, 16);
    };
    setTimeout(tick, 0);
  });
}
