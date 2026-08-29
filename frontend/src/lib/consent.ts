// First-party statistics consent gate — replaces the third-party Cookiebot
// CMP (its account's domain authorization lapsed and its trial expired,
// permanently blocking the banner from ever rendering on tryweddly.com).
//
// The SSR head (backend/src/lib/seo_ssr.ts) and the static Clarity snippet in
// index.html both emit their analytics loaders as inert
// `<script type="text/plain" data-cookieconsent="statistics">` tags — that
// markup convention is unchanged. What used to flip them to real, executing
// scripts was Cookiebot's uc.js; `activateGatedScripts` below is the whole of
// that mechanism, reimplemented in ~15 lines with no third-party dependency.

const STORAGE_KEY = "weddly.consent_statistics";

/** true = granted, false = declined, null = no decision recorded yet. */
export function getStatisticsConsent(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "granted") return true;
    if (raw === "declined") return false;
    return null;
  } catch {
    // Private browsing / storage blocked: treat as "no decision", so the
    // banner asks every visit rather than silently assuming consent.
    return null;
  }
}

/** Walks the DOM for every inert, consent-gated analytics loader and turns it
 *  into a real, executing script. Idempotent — a tag already swapped for a
 *  live `<script>` no longer matches the `type="text/plain"` selector, so a
 *  second call is a no-op. Cloning attributes (not just `src`) preserves
 *  `async`/`defer`/`data-domain` etc. on the tags that carry them. */
function activateGatedScripts(): void {
  const inert = document.querySelectorAll<HTMLScriptElement>(
    'script[type="text/plain"][data-cookieconsent~="statistics"]',
  );
  for (const old of inert) {
    const live = document.createElement("script");
    for (const attr of Array.from(old.attributes)) {
      if (attr.name === "type") continue;
      live.setAttribute(attr.name, attr.value);
    }
    if (!old.src) live.textContent = old.textContent;
    old.replaceWith(live);
  }
}

/** Record the visitor's choice and, if granted, immediately activate the
 *  gated scripts for the rest of this page load. */
export function setStatisticsConsent(granted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, granted ? "granted" : "declined");
  } catch {
    // Storage blocked: the choice still takes effect for this page load
    // (below), it just won't be remembered on the next visit.
  }
  if (granted) activateGatedScripts();
}

/** Applies a previously-stored "granted" decision on a fresh page load
 *  (every navigation re-renders the SSR head with fresh inert tags). No-op
 *  when the stored decision is "declined" or absent. */
export function applyStoredConsent(): void {
  if (getStatisticsConsent() === true) activateGatedScripts();
}

/** Clears the stored decision so the banner asks again. Used by the "review
 *  cookie choices" link on the Privacy page — mirrors what `Cookiebot.renew()`
 *  used to do. A reload is the simplest correct way to put already-activated
 *  scripts back behind the gate. */
export function reopenConsentBanner(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
  window.location.reload();
}
