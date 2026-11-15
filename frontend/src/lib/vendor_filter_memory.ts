// Client side of "the directory opens the way I left it". The account copy
// (`users.vendor_filters`) is the truth; this localStorage mirror covers the
// window before /me has loaded and a write that could not land. Every storage
// touch is wrapped: Safari private mode and locked-down embeds throw on access,
// and a filter memory must never be the thing that breaks the page.

import {
  sanitizeVendorFilters,
  VENDOR_FILTER_KEYS,
  type VendorFilterKey,
  type VendorFilterPrefs,
} from "@shared/vendor_filters";

const STORAGE_KEY = "weddly.vendors.filters";

/** Any of these in the URL means the couple is looking at a deliberate link
 *  (a shared URL, a search, a saved-set chip). Restoring over it would
 *  silently change what they asked for, so restore only on a bare visit. */
const EXPLICIT_PARAMS = ["q", "saved", "picked", "country", "date", "view", "compare"] as const;

/** Filter keys currently on the URL, as a plain object. */
export function pickVendorFilters(
  params: URLSearchParams,
): Partial<Record<VendorFilterKey, string>> {
  const out: Partial<Record<VendorFilterKey, string>> = {};
  for (const key of VENDOR_FILTER_KEYS) {
    const v = params.get(key);
    if (v) out[key] = v;
  }
  return out;
}

/** A bare visit: no remembered-filter key and no deliberate link either. */
export function isBareVisit(params: URLSearchParams): boolean {
  for (const key of [...VENDOR_FILTER_KEYS, ...EXPLICIT_PARAMS]) {
    if (params.has(key)) return false;
  }
  return true;
}

export function readLocalVendorFilters(): VendorFilterPrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { remember?: unknown; filters?: unknown };
    if (parsed.remember !== true) return { remember: false, filters: null };
    return { remember: true, filters: sanitizeVendorFilters(parsed.filters) };
  } catch {
    return null;
  }
}

export function writeLocalVendorFilters(prefs: VendorFilterPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or a blocked store: the account copy still holds it.
  }
}
