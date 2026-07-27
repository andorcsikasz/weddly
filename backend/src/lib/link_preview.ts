// Server-side link unfurler for wishlist items. The couple pastes a product
// URL and we pull its og:image (+ title) so the row/card can show a thumbnail.
//
// This fetches a COUPLE-SUPPLIED URL server-side, so SSRF is the central
// concern: we refuse non-http(s) schemes, refuse hosts that resolve to
// private / loopback / link-local / reserved IP ranges, follow only a few
// redirects (re-validating the host at every hop), cap the response body, and
// time out fast. The parser is a pure function so it can be unit-tested
// without a network. Failures are soft — the endpoint returns nulls rather
// than erroring, so a dead link never blocks saving the item.

import type { WishlistLinkPreview } from "@shared/wishlist";
import { isPublicHost } from "./ssrf";

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
// 1 MiB is plenty to reach the <head> of any real product page; we also stop
// reading as soon as </head> shows up (see readCappedHtml).
const MAX_BODY_BYTES = 1024 * 1024;
const PREVIEW_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Validate the URL scheme/host, then DNS-resolve and confirm every address is
 *  publicly routable. Returns the parsed URL or throws so the caller can map
 *  to a soft null result. The address/host blocking lives in lib/ssrf.ts, the
 *  single source of truth shared with supplier enrichment. */
async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported scheme");
  }
  if (!(await isPublicHost(url.hostname))) throw new Error("blocked host");
  return url;
}

/** Read at most MAX_BODY_BYTES of the response, stopping early once we've seen
 *  </head> (everything we parse lives in the head). */
async function readCappedHtml(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      html += decoder.decode(value, { stream: true });
      const headEnd = html.toLowerCase().indexOf("</head>");
      if (headEnd !== -1) {
        html = html.slice(0, headEnd + 7);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return html;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/** Scan all `<script type="application/ld+json">` blocks and return the first
 *  image URL found in any node's `image` field. Handles strings, arrays of
 *  strings, ImageObject `{ url }` shapes, and `@graph`-wrapped documents. */
function extractJsonLdImage(html: string): string | null {
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] ?? "";
    let ld: unknown;
    try {
      ld = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes: unknown[] =
      ld !== null &&
      typeof ld === "object" &&
      Array.isArray((ld as Record<string, unknown>)["@graph"])
        ? ((ld as Record<string, unknown>)["@graph"] as unknown[])
        : [ld];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const img = (node as Record<string, unknown>).image;
      if (typeof img === "string" && img) return img;
      if (Array.isArray(img) && img.length > 0) {
        const first: unknown = img[0];
        if (typeof first === "string" && first) return first;
        if (first && typeof first === "object") {
          const u = (first as Record<string, unknown>).url;
          if (typeof u === "string" && u) return u;
        }
      }
      if (img && typeof img === "object" && !Array.isArray(img)) {
        const u = (img as Record<string, unknown>).url;
        if (typeof u === "string" && u) return u;
      }
    }
  }
  return null;
}

/** Old-school `<link rel="image_src" href="...">` fallback. Some older
 *  storefronts and blogging platforms still use this instead of og:image. */
function extractLinkRelImageSrc(html: string): string | null {
  const m = html.match(/<link\b[^>]*\brel\s*=\s*["']image_src["'][^>]*>/i);
  if (!m?.[0]) return null;
  const href = m[0].match(/\bhref\s*=\s*["']([^"']*)["']/i);
  return href?.[1]?.trim() ?? null;
}

/** Pull the value of a `<meta>` tag matching any of the given property/name
 *  tokens, regardless of attribute order. Pure + exported for tests. */
function metaContent(html: string, keys: string[]): string | null {
  // Match every <meta ...> tag, then inspect its attributes — robust to the
  // property/content attribute ordering varying between sites.
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const keyMatch = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
    if (!keyMatch?.[1]) continue;
    if (!keys.includes(keyMatch[1].toLowerCase())) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (contentMatch?.[1]) return decodeEntities(contentMatch[1].trim());
  }
  return null;
}

/** Extract the preview image + title from page HTML, resolving a relative
 *  image against `baseUrl`. Pure — no network. Exported for unit tests. */
export function extractLinkPreview(html: string, baseUrl: string): WishlistLinkPreview {
  const rawImage =
    metaContent(html, ["og:image", "og:image:url", "og:image:secure_url"]) ??
    metaContent(html, ["twitter:image", "twitter:image:src"]) ??
    extractJsonLdImage(html) ??
    extractLinkRelImageSrc(html);
  let image_url: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        image_url = resolved.toString();
      }
    } catch {
      image_url = null;
    }
  }

  let title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null);
  if (title) title = decodeEntities(title).slice(0, 200);

  return { image_url, title };
}

/** Fetch a couple-supplied product URL and return its preview metadata. Never
 *  throws for the caller: any failure (blocked host, timeout, non-OK, parse
 *  miss) resolves to `{ image_url: null, title: null }`. */
export async function fetchLinkPreview(rawUrl: string): Promise<WishlistLinkPreview> {
  const empty: WishlistLinkPreview = { image_url: null, title: null };
  let current: string;
  try {
    current = (await assertSafeUrl(rawUrl)).toString();
  } catch {
    return empty;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so each hop's host is re-validated against the
    // SSRF guard (a 302 to http://169.254.169.254/ must not slip through).
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": PREVIEW_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return empty;
        const next = await assertSafeUrl(new URL(location, current).toString());
        current = next.toString();
        continue;
      }

      if (!res.ok) return empty;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) return empty;
      const html = await readCappedHtml(res);
      return extractLinkPreview(html, current);
    }
    return empty; // too many redirects
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Body images ────────────────────────────────────────────────────────────
//
// Small venue sites routinely ship no og:image at all (measured on the July
// 2026 Maps batch: 0 of 30 Hungarian venue homepages had one), so a directory
// that only reads the head leaves those listings with a placeholder card
// forever. The photos ARE on the page, in the slider and the gallery strip;
// this reads them out of the body so the hero backfill has something to try.
//
// Everything here is a CANDIDATE, never a decision: the caller downloads them
// in order and lets its own quality gate throw out the logos and badges that
// slip past the filename filter.

/** Filenames that are never a hero, whatever their size. Cheap pre-filter so
 *  the caller doesn't spend a download on an obvious logo or spacer. */
const JUNK_IMAGE_RE =
  /(logo|favicon|icon|sprite|placeholder|spacer|avatar|banner|button|arrow|badge|pixel|loader|spinner|watermark|cookie)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp)(?:[?#]|$)/i;
/** Enough to find a real photo without turning one listing into a crawl. */
const MAX_IMAGE_CANDIDATES = 12;

/** Pull plausible photo URLs out of page HTML, in document order, resolved
 *  against `baseUrl`. Reads `<img src>`, the lazy-loading `data-src` variants,
 *  the first entry of a `srcset`, and inline `background-image:url(…)`, which
 *  between them cover the sliders these sites are built on. Pure, no network,
 *  exported for tests. */
export function extractBodyImageCandidates(html: string, baseUrl: string): string[] {
  const raw: string[] = [];
  const push = (v: string | undefined | null) => {
    const s = (v ?? "").trim();
    if (s) raw.push(s);
  };
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    push(tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]);
    push(tag.match(/\bdata-(?:src|lazy-src|original)\s*=\s*["']([^"']+)["']/i)?.[1]);
    // srcset is "url 320w, url 640w" — the first URL is enough, the quality
    // gate cares about the pixels it actually downloads.
    push(tag.match(/\b(?:data-)?srcset\s*=\s*["']([^"',\s]+)/i)?.[1]);
  }
  for (const m of html.matchAll(/background-image\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
    push(m[2]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (candidate.startsWith("data:")) continue;
    let resolved: URL;
    try {
      resolved = new URL(decodeEntities(candidate), baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    const url = resolved.toString();
    if (!IMAGE_EXT_RE.test(resolved.pathname)) continue;
    if (JUNK_IMAGE_RE.test(resolved.pathname)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_IMAGE_CANDIDATES) break;
  }
  return out;
}

/** Fetch a page and return its body photo candidates. Same SSRF guard, timeout
 *  and redirect handling as `fetchLinkPreview`; the only difference is that it
 *  reads past `</head>`, since that is where the photos live. Never throws:
 *  any failure resolves to an empty list. */
export async function fetchPageImageCandidates(rawUrl: string): Promise<string[]> {
  let current: string;
  try {
    current = (await assertSafeUrl(rawUrl)).toString();
  } catch {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": PREVIEW_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return [];
        current = (await assertSafeUrl(new URL(location, current).toString())).toString();
        continue;
      }
      if (!res.ok) return [];
      if (!(res.headers.get("content-type") ?? "").includes("html")) return [];
      return extractBodyImageCandidates(await readCappedBody(res), current);
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Whole-body twin of `readCappedHtml`: same byte cap, no early `</head>` exit. */
async function readCappedBody(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return html;
}
