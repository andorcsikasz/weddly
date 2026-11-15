// The couple's last-used filter set on /app/vendors, persisted per ACCOUNT so a
// new device opens the directory the way it was left. Single source for the
// allowlist: the server refuses anything outside it, the page reads through the
// same parser, so a hand-edited value can never reach a query string unchecked.

/** The URL keys the directory understands and the only ones we remember. Each
 *  one is a plain param on /app/vendors, so a restored set is just a URL. */
export const VENDOR_FILTER_KEYS = [
  "group",
  "cat",
  "city",
  "sort",
  "verified",
  "guests",
  "seats_min",
  "seats_max",
  "price",
] as const;

export type VendorFilterKey = (typeof VENDOR_FILTER_KEYS)[number];

export interface VendorFilterPrefs {
  /** The "Remember my filters" switch. False keeps `filters` null: the couple
   *  opted out, so nothing is written and nothing is restored. */
  remember: boolean;
  filters: Partial<Record<VendorFilterKey, string>> | null;
}

const VALUE_MAX = 64;
/** Letters (accents included, so "Székesfehérvár" survives), digits, space and
 *  a few separators. Nothing that could be markup or a path. */
const VALUE_RE = /^[\p{L}\p{N} ._-]+$/u;

/** Keep only allowlisted keys with short, plain values. Anything else is
 *  dropped silently, so a stale client can't fail to save. */
export function sanitizeVendorFilters(raw: unknown): Partial<Record<VendorFilterKey, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<VendorFilterKey, string>> = {};
  for (const key of VENDOR_FILTER_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "" || trimmed.length > VALUE_MAX || !VALUE_RE.test(trimmed)) continue;
    out[key] = trimmed;
  }
  return out;
}

/** Tolerant reader for the stored column: a malformed value reads as "nothing
 *  remembered" rather than failing `/api/auth/me`. */
export function parseVendorFilterPrefs(raw: string | null | undefined): VendorFilterPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as { remember?: unknown; filters?: unknown };
    const remember = p.remember === true;
    if (!remember) return { remember: false, filters: null };
    const filters = sanitizeVendorFilters(p.filters);
    return { remember: true, filters: Object.keys(filters).length > 0 ? filters : {} };
  } catch {
    return null;
  }
}
