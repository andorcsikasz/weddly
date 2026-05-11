// Per-couple "this is our pick" supplier selection. One choice per
// SupplierCategory — picking a new card replaces the previous selection in
// the same category. DIY entries auto-claim the slot when created.
//
// Stored in localStorage keyed by couple id (so a single device can carry
// multiple workspaces' picks in test) and serialized as a category → id map.
// Subscribe to cross-tab changes via the storage event so partner B's pick
// shows up live in partner A's open suppliers tab.

import type { SupplierCategory } from "@shared/suppliers";

const LS_PREFIX = "weddly.suppliers.selected.";

export type SelectionMap = Partial<Record<SupplierCategory, string>>;

function key(coupleId: number): string {
  return `${LS_PREFIX}${coupleId}`;
}

function isCategory(s: string): s is SupplierCategory {
  return [
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
  ].includes(s);
}

function parseMap(raw: string | null): SelectionMap {
  if (!raw) return {};
  try {
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

export function readSelection(coupleId: number): SelectionMap {
  try {
    return parseMap(localStorage.getItem(key(coupleId)));
  } catch {
    return {};
  }
}

function writeRaw(coupleId: number, map: SelectionMap): void {
  try {
    localStorage.setItem(key(coupleId), JSON.stringify(map));
  } catch {
    // Quota / private mode — silent. Same-tab state still works.
  }
}

/** Set the selection for a category. Pass `null` to clear it. Returns the
 *  resulting map so the caller can mirror into React state in one go. */
export function setSelection(
  coupleId: number,
  category: SupplierCategory,
  supplierId: string | null,
): SelectionMap {
  const cur = readSelection(coupleId);
  const next: SelectionMap = { ...cur };
  if (supplierId === null) delete next[category];
  else next[category] = supplierId;
  writeRaw(coupleId, next);
  return next;
}

/** Drop every selection that points at this supplier id. Called when a DIY
 *  entry is deleted — its category should free up too. */
export function unselectById(coupleId: number, supplierId: string): SelectionMap {
  const cur = readSelection(coupleId);
  const next: SelectionMap = {};
  let changed = false;
  for (const [cat, id] of Object.entries(cur) as [SupplierCategory, string][]) {
    if (id === supplierId) {
      changed = true;
      continue;
    }
    next[cat] = id;
  }
  if (changed) writeRaw(coupleId, next);
  return next;
}

export function subscribeSelection(coupleId: number, cb: (next: SelectionMap) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const targetKey = key(coupleId);
  const handler = (e: StorageEvent) => {
    if (e.key !== targetKey) return;
    cb(parseMap(e.newValue));
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
