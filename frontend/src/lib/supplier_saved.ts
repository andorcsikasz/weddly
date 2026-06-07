// Per-couple supplier shortlist (the "saved" star on /app/suppliers). Unlike
// the per-category pick (one supplier per category, see supplier_selection.ts),
// the shortlist holds many suppliers — a couple saves several photographers to
// compare them side by side.
//
// Storage is server-side via `savedApi` so both partners + every device share
// one shortlist. An in-memory cache mirrors the latest `savedApi.list()` result
// (plus local mutations) so synchronous `readSaved(...)` keeps the page's
// existing render contract — it shows an empty shortlist for the first ~50ms,
// then re-renders via `subscribeSaved` once hydration resolves.
//
// Cross-tab sync rides the shared BroadcastChannel("weddly"): a save/unsave in
// tab A publishes `saved:changed`, tab B refetches and fires its subscribers.
//
// Legacy migration: "saved" used to live in a single global localStorage key
// (`weddly.suppliers.saved`, not couple-scoped). On first hydration we ship any
// leftover ids up to the current couple's server list, then clear the key.

import { savedApi } from "./endpoints";
import { publish, subscribe } from "./sync";

const LEGACY_LS_KEY = "weddly.suppliers.saved";

// In-memory cache keyed by couple id. Populated by `hydrate(coupleId)` and kept
// current by every mutation. Reads return an empty set until hydration lands —
// the page already renders a "nothing saved yet" state in that window.
const cache = new Map<number, Set<string>>();
const listeners = new Map<number, Set<(next: Set<string>) => void>>();
const hydrated = new Set<number>();
let crossTabInstalled = false;

function emit(coupleId: number) {
  const subs = listeners.get(coupleId);
  if (!subs || subs.size === 0) return;
  const snapshot = new Set(cache.get(coupleId) ?? []);
  for (const cb of subs) {
    try {
      cb(snapshot);
    } catch {
      // one listener crashing shouldn't break fan-out to the rest.
    }
  }
}

function readLegacyLocal(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // ignore — private mode / malformed
  }
  return [];
}

function clearLegacyLocal(): void {
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    // ignore
  }
}

/** Fire-and-forget migration: push any leftover localStorage ids to the server,
 *  then clear the global key. Runs once per couple id per session. */
async function migrateLegacyLocal(): Promise<void> {
  const legacy = readLegacyLocal();
  if (legacy.length === 0) return;
  try {
    for (const supplierId of legacy) {
      await savedApi.add(supplierId);
    }
    clearLegacyLocal();
  } catch {
    // Leave the key alone — the next hydration retries.
  }
}

async function fetchAndPopulate(coupleId: number): Promise<void> {
  try {
    const r = await savedApi.list();
    cache.set(coupleId, new Set(r.saved.map((s) => s.supplier_id)));
    emit(coupleId);
  } catch {
    // Most common failure is 401 (anonymous). Leave the cache as-is — the
    // empty set matches the pre-login rendered state.
  }
}

function ensureCrossTabListener() {
  if (crossTabInstalled) return;
  crossTabInstalled = true;
  subscribe("saved:changed", () => {
    for (const coupleId of listeners.keys()) void fetchAndPopulate(coupleId);
    for (const coupleId of cache.keys()) {
      if (!listeners.has(coupleId)) void fetchAndPopulate(coupleId);
    }
  });
}

function hydrate(coupleId: number): void {
  if (hydrated.has(coupleId)) return;
  hydrated.add(coupleId);
  ensureCrossTabListener();
  // migrate → fetch → emit. Migration resolves immediately when there's
  // nothing local to move.
  void migrateLegacyLocal().then(() => fetchAndPopulate(coupleId));
}

/** Read the current cached shortlist for the couple. Triggers a one-shot
 *  hydration on the first call — initial reads may return an empty set until
 *  the round-trip lands and `subscribeSaved` callbacks fire. */
export function readSaved(coupleId: number): Set<string> {
  hydrate(coupleId);
  return new Set(cache.get(coupleId) ?? []);
}

/** Toggle a supplier on the shortlist. `saved=true` adds, `false` removes.
 *  Updates the cache optimistically and returns the resulting set so the caller
 *  can mirror into React state in one go. A server failure re-fetches so the
 *  cache converges back to the server's view. */
export function setSaved(coupleId: number, supplierId: string, saved: boolean): Set<string> {
  ensureCrossTabListener();
  const cur = cache.get(coupleId) ?? new Set<string>();
  const next = new Set(cur);
  if (saved) next.add(supplierId);
  else next.delete(supplierId);
  cache.set(coupleId, next);
  emit(coupleId);
  void (async () => {
    try {
      if (saved) await savedApi.add(supplierId);
      else await savedApi.remove(supplierId);
      publish("saved:changed");
    } catch {
      void fetchAndPopulate(coupleId);
    }
  })();
  return new Set(next);
}

/** Subscribe to shortlist changes. Fires on every cache update — same-tab
 *  mutations, hydration completion, and cross-tab pings from a partner's
 *  device. Returns an unsubscribe function. Mirrors subscribeSelection's
 *  microtask catch-up so a subscriber that registers after hydration still
 *  receives the current set. */
export function subscribeSaved(coupleId: number, cb: (next: Set<string>) => void): () => void {
  hydrate(coupleId);
  let bucket = listeners.get(coupleId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(coupleId, bucket);
  }
  bucket.add(cb);
  const cached = cache.get(coupleId);
  if (cached !== undefined) {
    queueMicrotask(() => {
      if (!listeners.get(coupleId)?.has(cb)) return;
      try {
        cb(new Set(cached));
      } catch {
        // listener crash shouldn't break the lib
      }
    });
  }
  return () => {
    const cur = listeners.get(coupleId);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) listeners.delete(coupleId);
  };
}
