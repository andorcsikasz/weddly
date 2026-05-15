// Moodboard — fetches a public Pinterest board's RSS feed and normalises it
// into a `MoodboardPin[]`. The browser can't hit Pinterest directly (CORS)
// and Pinterest's old widget script is unreliable, so the backend proxies
// the feed itself. Errors are typed via the `code` field on HttpError.extra
// so the frontend can show a specific message (private board, missing board,
// empty board) instead of a generic failure.

import type { MoodboardPin } from "@shared/types";
import { HttpError } from "../lib/http";

const FETCH_TIMEOUT_MS = 8000;
const PIN_USER_AGENT = "Mozilla/5.0 (compatible; Weddly/1.0; +https://weddly.xyz)";

/** Parsed `<user>/<board>` segments from a Pinterest board URL.
 *  `null` means the URL didn't look like a board link at all. */
function parseBoardUrl(raw: string): { user: string; slug: string } | null {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const user = parts[0];
    const slug = parts[1];
    if (!user || !slug) return null;
    // Reserved Pinterest paths that aren't boards — guard so /pin/123/ or
    // /search/?q=... don't slip through as "user=pin, board=123".
    if (["pin", "search", "ideas", "today", "settings"].includes(user)) return null;
    return { user, slug };
  } catch {
    return null;
  }
}

/** Fetches the public RSS feed for `https://www.pinterest.com/<user>/<board>/`
 *  and returns every pin the feed yields. Throws `HttpError` with an
 *  `extra.code` set to one of:
 *    - "invalid_url"   — link didn't parse as a Pinterest board URL
 *    - "not_found"     — board doesn't exist (404)
 *    - "private"       — board is secret or otherwise non-public (redirect /
 *                        HTML login page instead of RSS)
 *    - "empty"         — feed parsed but had zero items
 *    - "fetch_failed"  — network timeout / unexpected upstream status
 */
export async function fetchPinterestBoardPins(rawUrl: string): Promise<MoodboardPin[]> {
  const board = parseBoardUrl(rawUrl);
  if (!board) {
    throw new HttpError(400, "Invalid Pinterest board URL", { code: "invalid_url" });
  }
  const rssUrl = `https://www.pinterest.com/${encodeURIComponent(board.user)}/${encodeURIComponent(board.slug)}.rss`;

  let res: Response;
  try {
    res = await fetch(rssUrl, {
      headers: {
        "User-Agent": PIN_USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      // Pinterest 302s missing/private boards to a login page; catching the
      // redirect ourselves lets us distinguish "private" from "found + RSS".
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, "Pinterest fetch failed", { code: "fetch_failed" });
  }

  if (res.status === 404) {
    throw new HttpError(404, "Board not found", { code: "not_found" });
  }
  if (res.status >= 300 && res.status < 400) {
    // Redirect to /login or to a profile path — board isn't publicly readable.
    throw new HttpError(403, "Board is not public", { code: "private" });
  }
  if (!res.ok) {
    throw new HttpError(502, "Pinterest returned an unexpected status", {
      code: "fetch_failed",
      upstream_status: res.status,
    });
  }

  const body = await res.text();
  // Some private boards reply 200 with the signed-out HTML shell instead of
  // RSS. Treat anything that isn't XML as a private board.
  const looksLikeRss = body.includes("<rss") || /<\?xml\b/.test(body);
  if (!looksLikeRss) {
    throw new HttpError(403, "Board is not public", { code: "private" });
  }

  const pins = parseRssItems(body);
  if (pins.length === 0) {
    throw new HttpError(404, "Board has no pins", { code: "empty" });
  }
  return pins;
}

function parseRssItems(xml: string): MoodboardPin[] {
  const pins: MoodboardPin[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let match = itemRe.exec(xml);
  while (match) {
    const block = match[1] ?? "";
    const link = readTag(block, "link");
    const title = readTag(block, "title");
    const description = readTag(block, "description");
    const decoded = decodeEntities(description);
    const imgSrc = decoded.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
    if (imgSrc && link) {
      pins.push({
        image_url: upgradePinimgSize(imgSrc),
        link_url: link,
        title: title ? title : null,
      });
    }
    match = itemRe.exec(xml);
  }
  return pins;
}

function readTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  if (!m) return "";
  // Tags may be CDATA-wrapped; strip wrappers and trim whitespace.
  return (m[1] ?? "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Pinterest serves the same image at multiple sizes — `/236x/`, `/474x/`,
 *  `/736x/`, `/originals/`. The RSS feed emits the smallest variant; we lift
 *  it to 736px so the moodboard grid stays sharp without forcing originals
 *  (which can be megabytes each). */
function upgradePinimgSize(url: string): string {
  return url.replace(/(\/\/i\.pinimg\.com\/)(\d+x|originals)(\/)/i, "$1736x$3");
}
