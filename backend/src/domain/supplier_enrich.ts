// Best-effort enrichment of a community-supplier submission from its
// website / Google Maps URL. Runs in the background after the row is
// inserted (so the submit response stays fast) and again when an admin
// clicks "Re-enrich". Only fills fields the submitter left blank — we
// never overwrite human input.
//
// Security notes:
//   - Only http(s) URLs are fetched.
//   - Hostnames are name-based; raw-IP and localhost hostnames are refused
//     (no SSRF into 127.x / 10.x / 169.254.x / metadata services).
//   - 5s timeout, 1 MB body cap.

import { db, now } from "../db";
import { log } from "../lib/logger";

export interface EnrichmentResult {
  blurb: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Decimal degrees, WGS-84. Only populated when both lat AND lng are
   *  recovered (e.g. Google Maps URL with @lat,lng,zoom). */
  lat: number | null;
  lng: number | null;
}

const EMPTY: EnrichmentResult = {
  blurb: null,
  phone: null,
  email: null,
  address: null,
  lat: null,
  lng: null,
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1_000_000;

/** Hosts we refuse to fetch — defence in depth on top of the IP-literal block.
 *  Adding a single explicit denylist is cheaper than the full RFC-1918 sweep
 *  via DNS resolution and covers the cases we actually care about (localhost,
 *  metadata services, .local mDNS, common reserved TLDs). */
const HOST_DENYLIST = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "169.254.169.254", // AWS / GCP / Azure metadata IPv4
]);

function isIpLiteral(host: string): boolean {
  // Simple IPv4 or bracketed IPv6 check — we just need to refuse them all.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return false;
}

function isFetchableUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  if (HOST_DENYLIST.has(host)) return null;
  if (isIpLiteral(host)) return null;
  // Hostnames must contain a dot (no `.local`, no bare hostnames pointing
  // at services on the same LAN) and not end in `.local`/`.localhost`.
  if (!host.includes(".")) return null;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return null;
  return u;
}

function isGoogleMaps(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return (
    h === "maps.google.com" ||
    h === "www.google.com" ||
    h === "google.com" ||
    h === "maps.app.goo.gl" ||
    h === "goo.gl" ||
    h.endsWith(".google.com")
  );
}

/** Pulls @lat,lng,zoom from a Maps URL path. Both coords required to count. */
function extractMapsCoords(u: URL): { lat: number; lng: number } | null {
  const m = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Maps `/place/<name>/` segment → human label (URL-decoded, plus → space). */
function extractMapsPlace(u: URL): string | null {
  const m = u.pathname.match(/\/place\/([^/]+)/);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]).replace(/\+/g, " ").trim() || null;
  } catch {
    return null;
  }
}

// Cap on the redirect chain length. Real sites rarely chain more than 1–2
// hops (canonical → www → https). Three keeps us generous without enabling
// long bounce trains an SSRF probe might rely on.
const MAX_REDIRECTS = 3;

async function fetchHtml(initial: URL): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so every hop is re-validated through
    // `isFetchableUrl`. With `redirect: "follow"` a benign-looking public
    // site can 302 us into the cloud-metadata IP or any RFC-1918 target;
    // re-running the gate per hop is the SSRF mitigation.
    let current: URL = initial;
    let res: Response | null = null;
    for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          // Some sites refuse default fetch UA; identify ourselves explicitly.
          "User-Agent": "WeddlyEnrichBot/1.0 (+https://weddly.hu)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      if (!loc) break;
      // Resolve relative redirects against the current URL.
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return null;
      }
      const checked = isFetchableUrl(next.toString());
      if (!checked) return null;
      current = checked;
      // Cancel the redirect response body so the connection releases cleanly.
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
    }
    if (!res) return null;
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore — best-effort */
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls `<meta property="X" content="Y">` value (HTML, single-line regex).
 *  We only care about a handful of well-known og/meta tags so a tiny regex
 *  is enough — no need to drag in cheerio. */
function metaContent(html: string, key: string, attr: "name" | "property"): string | null {
  const re = new RegExp(
    `<meta[^>]*\\b${attr}=["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'][^>]*\\bcontent=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (!m || !m[1]) return null;
  return m[1].trim() || null;
}

function extractBlurb(html: string): string | null {
  const candidates = [
    metaContent(html, "og:description", "property"),
    metaContent(html, "description", "name"),
    metaContent(html, "twitter:description", "name"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const cleaned = c.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 8) return cleaned.slice(0, 280);
  }
  return null;
}

const PHONE_RE =
  /(\+?\d{1,3}[\s\-./]?(?:\(\d{1,4}\)[\s\-./]?)?\d{1,4}[\s\-./]?\d{1,4}[\s\-./]?\d{2,6})/g;

function extractPhone(html: string): string | null {
  // First pass: `tel:` anchors — high signal.
  const telMatch = html.match(/href=["']tel:([^"']+)["']/i);
  if (telMatch && telMatch[1]) {
    const raw = decodeHtmlEntities(telMatch[1]).trim();
    if (raw.replace(/\D/g, "").length >= 7) return raw;
  }
  // Second pass: scan the body text after stripping tags. Decode entities
  // first so phone digits split as `&#43;36 70 ...` reassemble correctly.
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const matches = text.match(PHONE_RE);
  if (!matches) return null;
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, "");
    // 9–14 digits keeps us in the "actual phone number" zone — rejects
    // dates, postcodes, and giant invoice IDs.
    if (digits.length >= 9 && digits.length <= 14) {
      return candidate.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/** Decode HTML numeric character entities (`&#NN;`, `&#xHH;`) and the four
 *  named entities we actually meet in scraped pages. Anti-scraping sites
 *  obfuscate emails as `&#104;ello@...` so the regex below misses them
 *  unless we decode first. We do NOT pull in a full entity table — only
 *  what shows up in `mailto:` and `tel:` payloads in practice. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function extractEmail(html: string): string | null {
  const mailto = html.match(/href=["']mailto:([^"'?]+)/i);
  if (mailto && mailto[1]) return decodeHtmlEntities(mailto[1]).trim().toLowerCase();
  const text = decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (m) {
    const e = m[0].toLowerCase();
    // Reject obvious sentinels (Sentry, no-reply, image-CDN encoded blobs).
    if (e.startsWith("sentry@") || e.includes("noreply") || e.includes("no-reply")) return null;
    return e;
  }
  return null;
}

/** Public entry point. Resolves to a partial enrichment — every field is
 *  best-effort and may be null. Never throws. */
export async function enrichFromUrl(rawUrl: string): Promise<EnrichmentResult> {
  const u = isFetchableUrl(rawUrl);
  if (!u) return EMPTY;

  const isMaps = isGoogleMaps(u);
  const mapsCoords = isMaps ? extractMapsCoords(u) : null;
  const mapsPlace = isMaps ? extractMapsPlace(u) : null;

  // For Maps URLs we don't try to fetch — Google serves a JS shell that
  // doesn't expose anything via plain HTTP. Coords + place from the URL is
  // already much better than nothing.
  if (isMaps) {
    return {
      ...EMPTY,
      address: mapsPlace,
      lat: mapsCoords?.lat ?? null,
      lng: mapsCoords?.lng ?? null,
    };
  }

  const html = await fetchHtml(u);
  if (!html) return EMPTY;
  return {
    blurb: extractBlurb(html),
    phone: extractPhone(html),
    email: extractEmail(html),
    address: null,
    lat: null,
    lng: null,
  };
}

interface CommunitySupplierEnrichable {
  id: number;
  website: string;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
}

/** Reads the supplier's website + address, enriches the four supported
 *  fields (blurb, phone, email, address), writes them back, and audit-logs.
 *  Idempotent. Returns the count of fields that were filled this run.
 *
 *  By default only MISSING fields are filled — the auto-enrich on submit
 *  must never clobber what the submitter typed. When the admin manually
 *  re-runs from the moderation page, pass `{ force: true }` so existing
 *  values get overwritten with the freshly scraped ones (the common case
 *  is fixing junk that landed during the initial scrape, e.g. an email
 *  the source site obfuscated with HTML entities). */
export async function enrichSupplier(
  supplierId: number,
  options: { force?: boolean } = {},
): Promise<number> {
  const force = options.force === true;
  const row = db
    .prepare(
      "SELECT id, website, address, contact_email, contact_phone, blurb FROM community_suppliers WHERE id = ?",
    )
    .get(supplierId) as CommunitySupplierEnrichable | undefined;
  if (!row) return 0;

  // Two sources, merged with website winning on overlaps because it's a
  // richer page than a Maps URL.
  const fromAddress = row.address ? await enrichFromUrl(row.address) : EMPTY;
  const fromWebsite = await enrichFromUrl(row.website);

  const merged: EnrichmentResult = {
    blurb: fromWebsite.blurb ?? fromAddress.blurb,
    phone: fromWebsite.phone ?? fromAddress.phone,
    email: fromWebsite.email ?? fromAddress.email,
    address: fromAddress.address ?? fromWebsite.address,
    lat: fromAddress.lat ?? fromWebsite.lat,
    lng: fromAddress.lng ?? fromWebsite.lng,
  };

  const updates: string[] = [];
  const params: (string | number)[] = [];
  const filled: Record<string, unknown> = {};

  // Auto-enrich (force=false) only fills blanks. Admin-triggered enrich
  // (force=true) overwrites whatever's there with the freshly scraped value
  // — useful for repairing junk that landed on the first auto-pass.
  const blurbBlank = (row.blurb ?? "").trim().length < 8;
  if ((force || blurbBlank) && merged.blurb) {
    updates.push("blurb = ?");
    params.push(merged.blurb);
    filled.blurb = merged.blurb;
  }
  if ((force || !row.contact_phone) && merged.phone) {
    updates.push("contact_phone = ?");
    params.push(merged.phone);
    filled.contact_phone = merged.phone;
  }
  if ((force || !row.contact_email) && merged.email) {
    updates.push("contact_email = ?");
    params.push(merged.email);
    filled.contact_email = merged.email;
  }
  // The "address" field doubles as the user's input slot for a Google Maps
  // URL (the submit modal accepts either). If they pasted a URL, we replace
  // it with the human-readable place name we extracted — but if they typed
  // a plain street address, we leave it alone (unless force=true).
  const addressLooksLikeUrl = !!row.address && /^https?:\/\//i.test(row.address);
  const shouldFillAddress = (force || !row.address || addressLooksLikeUrl) && !!merged.address;
  if (shouldFillAddress && merged.address) {
    updates.push("address = ?");
    params.push(merged.address);
    filled.address = merged.address;
  }

  if (updates.length === 0) return 0;

  updates.push("updated_at = ?");
  params.push(now());
  params.push(supplierId);
  db.prepare(`UPDATE community_suppliers SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  log.info("supplier.enrich.applied", { supplierId, filled: Object.keys(filled) });
  return updates.length - 1; // exclude updated_at
}
