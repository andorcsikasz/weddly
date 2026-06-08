// Live status fetcher for the Konzinfo (Hungarian MFA Consular Service)
// per-country advisory pages. Given a couple's honeymoon destination we resolve
// the official country page (shared/konzinfo.ts) and scrape three values off it:
// the last-modified date, the "still valid today" date, and the security rating.
//
// Everything here is best-effort. The Konzinfo markup can change, the foreign
// host can be slow/unreachable, and the security wording is free text — so a
// parse miss or a network failure NEVER throws: it returns null and the UI falls
// back to the static official link. Results are cached in-process for 12 h so we
// don't hammer a government site on every honeymoon page view (and so the block
// stays snappy). The link list + parsed status are explicitly NOT treated as
// permanent — see shared/konzinfo.ts and the re-scrape script.

import {
  type KonzinfoCountry,
  type KonzinfoInfo,
  type KonzinfoLiveStatus,
  KONZINFO_INDEX_URL,
  matchKonzinfoCountry,
} from "@shared/konzinfo";
import { log as logger } from "../lib/logger";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface CacheEntry {
  status: KonzinfoLiveStatus | null;
  expiresAt: number;
}
const statusCache = new Map<string, CacheEntry>();

const EMPTY_STATUS: KonzinfoLiveStatus = {
  last_modified: null,
  valid_today: null,
  safety_category: null,
  safety_modified: null,
};

/** Strip HTML tags to plain text + collapse whitespace, so label/value pairs
 *  that live in adjacent elements ("Utolsó módosítás dátuma" <div> "2026.05.27.")
 *  read as one string the date regexes can scan. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DATE = "(\\d{4}\\.\\d{2}\\.\\d{2})";

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m?.[1] ?? null;
}

/** Pull the security rating off the page. Primary: the `<strong>` the advice
 *  text wraps the rating in ("...besorolását tekintve a <strong>zöld, (IV.)
 *  kategóriába</strong>..."). Fallback: a colour + roman-numeral scan of the
 *  plain text. Normalises the trailing case ("kategóriába" → "kategória"). */
function parseSafetyCategory(html: string, text: string): string | null {
  const strong = /biztons[aá]gi besorol[\s\S]{0,160}?<strong>\s*([^<]+?)\s*<\/strong>/i.exec(html);
  let raw = strong?.[1] ?? null;
  if (!raw) {
    const fallback =
      /(z[öo]ld|s[áa]rga|narancss[áa]rga|narancs|piros)[,\s(]*\(?\s*(I{1,3}V?|IV)\.?\)?/i.exec(
        text,
      );
    raw = fallback ? `${fallback[1]}, (${fallback[2]}.)` : null;
  }
  if (!raw) return null;
  return raw
    .replace(/kategóri[aá]b[ae].*$/i, "kategória")
    .replace(/kategóri[aá].*$/i, "kategória")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the three live values off a country page's HTML. Exported so tests can
 *  verify extraction against a saved snapshot without hitting the foreign host
 *  (whose TLS chain isn't always buildable in CI). */
export function parseKonzinfoStatus(html: string): KonzinfoLiveStatus {
  const text = htmlToText(html);
  return {
    last_modified: firstMatch(text, new RegExp(`Utolsó módosítás dátuma\\s*${DATE}`, "i")),
    valid_today: firstMatch(text, new RegExp(`napon is érvényes\\s*${DATE}`, "i")),
    safety_modified: firstMatch(
      text,
      new RegExp(`Biztonsági besorolás utolsó módosítása\\s*${DATE}`, "i"),
    ),
    safety_category: parseSafetyCategory(html, text),
  };
}

/** Fetch + parse one country page's live status, with a 12 h in-process cache.
 *  Returns null on any network/HTTP/parse failure (the caller renders the
 *  static link regardless). A successful-but-empty parse is cached as
 *  EMPTY_STATUS so a markup change doesn't re-hammer the source every view. */
export async function fetchKonzinfoStatus(slug: string): Promise<KonzinfoLiveStatus | null> {
  const cached = statusCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.status;

  let status: KonzinfoLiveStatus | null = null;
  try {
    const res = await fetch(`${KONZINFO_INDEX_URL}/${slug}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "WeddlyHoneymoonBot/1.0 (+https://weddly.hu)" },
    });
    if (res.ok) {
      status = parseKonzinfoStatus(await res.text());
    } else {
      logger.warn("konzinfo.fetch_non_ok", { slug, http_status: res.status });
    }
  } catch (err) {
    // Network error, timeout, or — notably — a TLS trust failure on the
    // government host. All non-fatal: the block degrades to the static link.
    logger.warn("konzinfo.fetch_failed", { slug, error: String(err) });
    status = null;
  }

  statusCache.set(slug, { status: status ?? EMPTY_STATUS, expiresAt: Date.now() + CACHE_TTL_MS });
  return status;
}

/** Resolve a destination to its official country page + live status. Always
 *  returns a payload (never throws): when no country matches, `matched` is null
 *  and the UI shows the generic country-picker index. */
export async function buildKonzinfoInfo(destination: string | null): Promise<KonzinfoInfo> {
  const matched: KonzinfoCountry | null = matchKonzinfoCountry(destination);
  const status = matched ? await fetchKonzinfoStatus(matched.slug) : null;
  return {
    destination: destination ?? null,
    matched,
    status,
    index_url: KONZINFO_INDEX_URL,
  };
}

/** Test seam — drop the in-process cache so e2e runs don't bleed between cases. */
export function _clearKonzinfoCacheForTests(): void {
  statusCache.clear();
}
