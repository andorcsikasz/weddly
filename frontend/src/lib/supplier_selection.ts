// Per-couple "this is our pick" supplier selection. One choice per
// SupplierCategory — picking a new card replaces the previous selection in
// the same category. DIY entries auto-claim the slot when created.
//
// Storage is server-side via `picksApi` so both partners + every device see
// the same picks. An in-memory cache mirrors the latest `picks.list()` result
// (and any local mutations) so synchronous `readSelection(...)` keeps the
// existing consumer contract — the page renders an empty pick state on the
// first ~50ms before the hydration round-trip resolves, then re-renders via
// `subscribeSelection`.
//
// Cross-tab sync rides the existing BroadcastChannel("weddly") channel — a
// pick mutation in tab A publishes `picks:changed`, tab B refetches and fires
// its subscribers.

import type { SupplierCategory } from "@shared/suppliers";
import { picksApi } from "./endpoints";
import { publish, subscribe } from "./sync";

const LS_PREFIX = "weddly.suppliers.selected.";

export type SelectionMap = Partial<Record<SupplierCategory, string>>;

function lsKey(coupleId: number): string {
  return `${LS_PREFIX}${coupleId}`;
}

const VALID_CATEGORIES: readonly SupplierCategory[] = [
  "venue",
  "accommodation",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "stationery",
  "transport",
];

function isCategory(s: string): s is SupplierCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(s);
}

// In-memory cache, keyed by couple id. Populated by `hydrate(coupleId)` and
// kept in sync by every mutation. Reads return an empty map until hydration
// resolves — consumers already handle "no picks yet" rendering.
const cache = new Map<number, SelectionMap>();
const listeners = new Map<number, Set<(next: SelectionMap) => void>>();
// Couple ids whose hydration is already underway (or done) so we don't
// double-fetch on every reader.
const hydrated = new Set<number>();
// Cross-tab listener installed lazily — single channel, fan-out to every
// known couple's subscriber set.
let crossTabInstalled = false;

function emit(coupleId: number) {
  const subs = listeners.get(coupleId);
  if (!subs || subs.size === 0) return;
  const snapshot = cache.get(coupleId) ?? {};
  for (const cb of subs) {
    try {
      cb(snapshot);
    } catch {
      // listener crash shouldn't break fan-out to the rest.
    }
  }
}

function readLocalStorage(coupleId: number): SelectionMap {
  try {
    const raw = localStorage.getItem(lsKey(coupleId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: SelectionMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isCategory(k) && typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function clearLocalStorage(coupleId: number): void {
  try {
    localStorage.removeItem(lsKey(coupleId));
  } catch {
    // ignore — private mode / quota
  }
}

/** Fire-and-forget migration: ship any leftover localStorage entries to the
 *  server, then clear the local key. Runs once per couple id per session. */
async function migrateLegacyLocal(coupleId: number): Promise<void> {
  const legacy = readLocalStorage(coupleId);
  const entries = Object.entries(legacy) as [SupplierCategory, string][];
  if (entries.length === 0) return;
  try {
    // Run sequentially so the server-side "single pick per category" rule
    // produces a deterministic final state if the same category was written
    // twice locally (shouldn't happen, but be tidy).
    for (const [cat, supplierId] of entries) {
      await picksApi.set(cat, supplierId);
    }
    clearLocalStorage(coupleId);
  } catch {
    // Leave the localStorage entry alone — next hydration will retry.
  }
}

async function fetchAndPopulate(coupleId: number): Promise<void> {
  try {
    const r = await picksApi.list();
    const next: SelectionMap = {};
    for (const p of r.picks) {
      if (isCategory(p.category)) next[p.category] = p.supplier_id;
    }
    cache.set(coupleId, next);
    emit(coupleId);
  } catch {
    // Most common failure is 401 (anonymous). Leave the cache as-is —
    // consumers see an empty pick map, which matches the rendered state
    // before login.
  }
}

function ensureCrossTabListener() {
  if (crossTabInstalled) return;
  crossTabInstalled = true;
  subscribe("picks:changed", () => {
    // Re-hydrate every couple we know about. In practice there's only one
    // active couple per session, but iterate defensively.
    for (const coupleId of listeners.keys()) {
      void fetchAndPopulate(coupleId);
    }
    for (const coupleId of cache.keys()) {
      if (!listeners.has(coupleId)) void fetchAndPopulate(coupleId);
    }
  });
}

function hydrate(coupleId: number): void {
  if (hydrated.has(coupleId)) return;
  hydrated.add(coupleId);
  ensureCrossTabListener();
  // Kick the migration first so the server is current before we list. The
  // promise chain serializes: migrate → fetch → emit. If migration found
  // nothing it resolves immediately.
  void migrateLegacyLocal(coupleId).then(() => fetchAndPopulate(coupleId));
}

/** Read the current cached selection for the couple. Triggers a one-shot
 *  hydration on the first call — initial reads may return `{}` until the
 *  network round-trip lands and `subscribeSelection` callbacks fire. */
export function readSelection(coupleId: number): SelectionMap {
  hydrate(coupleId);
  return cache.get(coupleId) ?? {};
}

/** Set the selection for a category. Pass `null` to clear it. Returns the
 *  resulting map so the caller can mirror into React state in one go. The
 *  cache is updated optimistically; a server failure rolls the cache back
 *  to whatever the next `picksApi.list()` returns. */
export function setSelection(
  coupleId: number,
  category: SupplierCategory,
  supplierId: string | null,
): SelectionMap {
  ensureCrossTabListener();
  const cur = cache.get(coupleId) ?? {};
  const next: SelectionMap = { ...cur };
  if (supplierId === null) delete next[category];
  else next[category] = supplierId;
  cache.set(coupleId, next);
  emit(coupleId);
  // Fire the network request without blocking the UI. On error we re-fetch
  // so the cache converges back to the server's view.
  void (async () => {
    try {
      if (supplierId === null) {
        await picksApi.clear(category);
      } else {
        await picksApi.set(category, supplierId);
      }
      publish("picks:changed");
    } catch {
      void fetchAndPopulate(coupleId);
    }
  })();
  return next;
}

/** Drop every selection that points at this supplier id. Called when a DIY
 *  entry is deleted — its category should free up too. */
export function unselectById(coupleId: number, supplierId: string): SelectionMap {
  ensureCrossTabListener();
  const cur = cache.get(coupleId) ?? {};
  const next: SelectionMap = {};
  const cleared: SupplierCategory[] = [];
  for (const [cat, id] of Object.entries(cur) as [SupplierCategory, string][]) {
    if (id === supplierId) {
      cleared.push(cat);
      continue;
    }
    next[cat] = id;
  }
  if (cleared.length === 0) return cur;
  cache.set(coupleId, next);
  emit(coupleId);
  void (async () => {
    try {
      for (const cat of cleared) {
        await picksApi.clear(cat);
      }
      publish("picks:changed");
    } catch {
      void fetchAndPopulate(coupleId);
    }
  })();
  return next;
}

/** Subscribe to selection changes. The callback fires on every cache update —
 *  same-tab mutations, hydration completion, and cross-tab BroadcastChannel
 *  pings from a partner's device. Returns an unsubscribe function.
 *
 *  If the cache is already populated when the subscriber registers (e.g. the
 *  hydration round-trip resolved before the consumer's effect ran), the cb
 *  is fired once via a microtask so the consumer doesn't get stuck with the
 *  empty-map initial value that `readSelection` returned synchronously. */
export function subscribeSelection(coupleId: number, cb: (next: SelectionMap) => void): () => void {
  hydrate(coupleId);
  let bucket = listeners.get(coupleId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(coupleId, bucket);
  }
  bucket.add(cb);
  const cached = cache.get(coupleId);
  if (cached !== undefined) {
    // Microtask, not synchronous — keeps subscribe() side-effect-free during
    // React render and lets the consumer's `readSelection` initial value
    // settle first.
    queueMicrotask(() => {
      // Re-check membership in case the consumer unsubscribed before the
      // microtask flushed.
      if (!listeners.get(coupleId)?.has(cb)) return;
      try {
        cb(cached);
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
