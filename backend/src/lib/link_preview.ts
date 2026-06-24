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

import { lookup } from "node:dns/promises";
import type { WishlistLinkPreview } from "@shared/wishlist";

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
// 1 MiB is plenty to reach the <head> of any real product page; we also stop
// reading as soon as </head> shows up (see readCappedHtml).
const MAX_BODY_BYTES = 1024 * 1024;
const PREVIEW_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Reserved / non-routable IPv4 ranges we refuse to fetch from. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a dotted-quad — let the caller treat it as "not an IPv4 literal".
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved (224+)
  return false;
}

/** Reserved IPv6 ranges (loopback, link-local, unique-local, and v4-mapped
 *  forms that would otherwise sneak a private v4 through). */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // v4-mapped (::ffff:a.b.c.d) — extract the embedded v4 and re-check.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;
  return false;
}

function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/** A hostname that's never legitimate for an external product link. */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  return false;
}

/** Validate the URL scheme/host, then DNS-resolve and confirm every address is
 *  publicly routable. Returns the parsed URL or throws so the caller can map
 *  to a soft null result. */
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
  const host = url.hostname;
  if (!host || isBlockedHostname(host)) throw new Error("blocked host");

  // Literal IP in the host — check directly (DNS lookup of a literal just
  // echoes it back, but we short-circuit to be explicit).
  const literal = host.replace(/^\[|\]$/g, ""); // strip [..] for IPv6 literals
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) {
    if (isBlockedIp(literal)) throw new Error("blocked ip");
    return url;
  }

  // Hostname — resolve and refuse if ANY answer is non-routable. Checking
  // before the fetch closes the obvious cases; it isn't a full guarantee
  // against DNS-rebinding but is the standard mitigation at this layer.
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("dns failure");
  }
  if (addrs.length === 0) throw new Error("no address");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error("blocked resolved ip");
  }
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
