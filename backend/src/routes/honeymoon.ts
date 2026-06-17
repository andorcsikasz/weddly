// Honeymoon-page server endpoints. Today it's just the flight estimate —
// other honeymoon state (destination, dates) lives on the couples row and is
// read/written through /api/couples. Keeping the estimate behind its own
// route lets us cache + refresh independently and skip the network entirely
// when Amadeus credentials aren't set.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { CONFIG } from "../config";
import { getCoupleForUser } from "../domain/couples";
import { getFlightEstimate } from "../domain/honeymoon_flights";
import { buildKonzinfoInfo } from "../domain/konzinfo";
import { db } from "../db";
import { type Ctx, json, requireAuth, type Router } from "../lib/http";

async function handleFlightEstimate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) return json({ estimate: null });
  const estimate = await getFlightEstimate(couple);
  return json({ estimate });
}

/** Official Hungarian consular travel advice for the couple's honeymoon
 *  destination. Reads the destination off the couple row (an optional
 *  `?destination=` query overrides it for previews); resolves the official
 *  Konzinfo country page + scrapes its live status. Never errors — an
 *  unresolved destination still returns the generic country-picker link. */
async function handleKonzinfo(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  const override = ctx.url.searchParams.get("destination");
  const destination = override ?? couple?.honeymoon_destination ?? null;
  return json(await buildKonzinfoInfo(destination));
}

const WIKI_UA = { "User-Agent": "Weddly/1.0 (https://weddly.co)" };
// Max width we ask Commons for. Capped at 1280 — covers any HiDPI display at
// the component's max render width; going higher inflates download size.
const MAX_WIDTH = 1280;

// Filename patterns that indicate a non-photo (map, marker, seal, flag …).
const NON_PHOTO_RE =
  /marker|locator|location|_map[._]|\.svg\b|seal|flag|emblem|coat_of_arms|coat-of-arms|logo/i;

function cityKey(city: string): string {
  return city.toLowerCase().trim();
}

function citySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract a bare filename (e.g. "Bali_panorama.jpg") from a Wikimedia thumb
 *  URL. Returns null when the URL doesn't match the expected path shape. */
function filenameFromThumbUrl(url: string): string | null {
  // Shape: …/thumb/<hash>/<filename>/<Npx-filename>
  const m = url.match(/\/thumb\/[^/]+\/[^/]+\/([^/?#]+)\/\d+px-/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** Query the Wikimedia Commons imageinfo API for the best-quality URL at up to
 *  MAX_WIDTH pixels. If the original is smaller than MAX_WIDTH it returns the
 *  original (no upscaling). Returns null on any error. */
async function commonsImageUrl(fileTitle: string): Promise<string | null> {
  try {
    const title = fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`;
    const params = new URLSearchParams({
      action: "query",
      titles: title,
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: String(MAX_WIDTH),
      format: "json",
    });
    const r = await fetch(
      `https://commons.wikimedia.org/w/api.php?${params}`,
      { headers: WIKI_UA },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string }[] }> };
    };
    const pages = data.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const ii = page.imageinfo?.[0];
      // thumburl is set when the original exceeds MAX_WIDTH; url is the
      // original itself when it's already smaller.
      return ii?.thumburl ?? ii?.url ?? null;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Pick the first travel-photo-looking File title from the Wikipedia media
 *  list, then resolve it to the best available URL via Commons imageinfo. */
async function mediaListPhoto(city: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(city)}`,
      { headers: WIKI_UA },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      items?: { title?: string; srcset?: { src: string }[] }[];
    };
    for (const item of data.items ?? []) {
      const title = item.title ?? "";
      if (NON_PHOTO_RE.test(title)) continue;
      if (!item.srcset?.length) continue;
      return commonsImageUrl(title);
    }
  } catch {
    // fall through
  }
  return null;
}

/** Resolve the best-quality photo URL for a city name. Uses the Wikipedia page
 *  summary thumbnail when it looks like a real photo, otherwise falls back to
 *  the article media list. All URLs are resolved via Commons imageinfo to get
 *  the highest available resolution up to MAX_WIDTH. */
async function resolveWikimediaUrl(city: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`,
      { headers: WIKI_UA },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as { thumbnail?: { source: string } };
    const src = data?.thumbnail?.source ?? null;
    if (!src || NON_PHOTO_RE.test(src)) return mediaListPhoto(city);
    const filename = filenameFromThumbUrl(src);
    if (!filename) return mediaListPhoto(city);
    return (await commonsImageUrl(filename)) ?? mediaListPhoto(city);
  } catch {
    return null;
  }
}

const DEST_PHOTO_DIR = "destination-photos";

/** Download `remoteUrl` to `uploads/destination-photos/<slug>.<ext>` and
 *  return the public `/uploads/…` path, or null on any error. */
async function downloadAndCache(
  city: string,
  remoteUrl: string,
): Promise<string | null> {
  try {
    const dir = join(CONFIG.uploadsDir, DEST_PHOTO_DIR);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const res = await fetch(remoteUrl);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();

    // Derive extension from the remote URL (strip query string first).
    const rawExt = extname(remoteUrl.split("?")[0] ?? "").toLowerCase();
    const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(rawExt)
      ? rawExt
      : ".jpg";

    const filename = `${citySlug(city)}${ext}`;
    const filePath = join(dir, filename);
    await writeFile(filePath, new Uint8Array(buf));

    const localPath = `/uploads/${DEST_PHOTO_DIR}/${filename}`;
    db.run(
      `INSERT OR REPLACE INTO destination_photo_cache (city, local_path, fetched_at)
       VALUES (?, ?, strftime('%s','now'))`,
      [cityKey(city), localPath],
    );
    return localPath;
  } catch {
    return null;
  }
}

/** Wikipedia cover photo for the honeymoon destination. Downloads and caches
 *  the image locally on first request so subsequent loads are served from our
 *  own uploads volume rather than Wikimedia. Always returns
 *  `{ photo_url: string | null }` — never errors. */
async function handleDestinationPhoto(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const destination = ctx.url.searchParams.get("destination");
  if (!destination) return json({ photo_url: null });
  const city = (destination.split(",")[0] ?? destination).trim();
  const key = cityKey(city);

  // Check local cache first.
  const cached = db
    .query<{ local_path: string }, [string]>(
      "SELECT local_path FROM destination_photo_cache WHERE city = ?",
    )
    .get(key);

  if (cached) {
    // Verify the file still exists (could be lost after a data migration).
    const onDisk = join(CONFIG.uploadsDir, cached.local_path.replace(/^\/uploads\//, ""));
    if (existsSync(onDisk)) return json({ photo_url: cached.local_path });
    // File missing — evict stale cache entry and re-fetch below.
    db.run("DELETE FROM destination_photo_cache WHERE city = ?", [key]);
  }

  // Resolve from Wikipedia and download.
  const remoteUrl = await resolveWikimediaUrl(city);
  if (!remoteUrl) return json({ photo_url: null });
  const localPath = await downloadAndCache(city, remoteUrl);
  return json({ photo_url: localPath });
}

export function registerHoneymoonRoutes(router: Router) {
  router.get("/api/honeymoon/flight-estimate", handleFlightEstimate, true);
  router.get("/api/honeymoon/konzinfo", handleKonzinfo, true);
  router.get("/api/honeymoon/destination-photo", handleDestinationPhoto, true);
}
