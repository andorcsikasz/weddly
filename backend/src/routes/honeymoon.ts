// Honeymoon-page server endpoints. Today it's just the flight estimate —
// other honeymoon state (destination, dates) lives on the couples row and is
// read/written through /api/couples. Keeping the estimate behind its own
// route lets us cache + refresh independently and skip the network entirely
// when Amadeus credentials aren't set.

import { extname } from "node:path";
import { storage, keyFromUploadUrl } from "../lib/storage";
import { type CoupleRow, getCoupleForUser, toCouple } from "../domain/couples";
import { getFlightEstimate } from "../domain/honeymoon_flights";
import { buildKonzinfoInfo } from "../domain/konzinfo";
import { db } from "../db";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";

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
// Max width we ask Commons for. The honeymoon hero renders this edge to edge
// at full page width, so the old 1280 cap was visibly soft on a retina laptop.
// 1920 is the last step before the payload jumps without the crop gaining.
const MAX_WIDTH = 1920;
// The hero crops to a wide band. A portrait shot loses its subject in that
// crop and a small one upscales to mush, so both are only accepted when the
// page has nothing better to offer.
const MIN_HERO_WIDTH = 900;
const MIN_HERO_RATIO = 1.15;
// Upstream calls are the cost here, so a page contributes at most this many
// file titles to the one batched Commons lookup.
const MAX_TITLES_PER_PAGE = 8;
// How many rungs of the breadcrumb we walk. What gets dropped is the middle,
// never the head or the tail — see photoCandidates.
const MAX_CANDIDATES = 5;
// Metadata calls are small and we make several, so they fail fast.
const UPSTREAM_TIMEOUT_MS = 6_000;
// The image itself gets far longer. Commons renders a 1920px thumbnail ON
// DEMAND the first time anyone asks for one, and a 6000x4000 original takes
// well over six seconds to come back — which silently dropped Rome and
// Santorini while leaving the already-popular Bali and Paris working.
const DOWNLOAD_TIMEOUT_MS = 25_000;

// Patterns in filenames that mean the file is NOT a travel photo.
// Includes audio/video extensions, historical/cartographic content, satellite
// imagery, OSM renders, administrative graphics, and non-image media.
// `montage` / `collage` are the Wikipedia city-article lead image — a grid of
// six small photos with hairlines between them. It is the correct picture of
// the place and a terrible one to run full-bleed behind a headline.
const NON_PHOTO_RE =
  /marker|locator|location|_map[._]|\.svg\b|seal|flag|emblem|coat_of_arms|coat-of-arms|logo|atlas|chart|portolan|ESA|satellite|aerial|OSM|montage|collage|\.ogg\b|\.wav\b|\.mp3\b|\.mp4\b|\.webm\b|\.ogv\b/i;

// Photo file extensions we accept (excludes SVG, audio, video, etc.)
const PHOTO_EXT_RE = /\.(jpe?g|png|webp)$/i;

function cityKey(city: string): string {
  return city.toLowerCase().trim();
}

function citySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract a bare filename (e.g. "Funchal_Pico.jpg") from a Wikimedia thumb
 *  URL. Returns null when the URL doesn't match the expected path shape. */
function filenameFromThumbUrl(url: string): string | null {
  // Shape: …/thumb/<hash>/<filename>/<Npx-filename>[?query]
  const m = url.match(/\/thumb\/[^/]+\/[^/]+\/([^/?#]+)\/\d+px-/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function isTravelPhoto(title: string): boolean {
  return PHOTO_EXT_RE.test(title) && !NON_PHOTO_RE.test(title);
}

/** Drop the wiki namespace prefix. Media-list titles arrive LOCALISED — `File:`
 *  on English wikis, `Fájl:` on Hungarian, `Archivo:` on Spanish — while
 *  Commons only answers to `File:`. Without this the non-English media lists
 *  resolved to nothing at all, because every title went out as the nonsense
 *  `File:Fájl:Trajansmärkte_Forum.jpg`. */
function bareFileName(title: string): string {
  return title.replace(/^[^:/]{1,32}:/, "").trim();
}

/** Commons page titles compare loosely — underscores are spaces and the
 *  namespace prefix varies by wiki — so both sides of the lookup map go
 *  through this. */
function commonsKey(title: string): string {
  return bareFileName(title).replace(/_/g, " ").toLowerCase();
}

type CommonsImage = { url: string; width: number; height: number };

/** A hero shot is cropped to a wide band, so a portrait or a postage stamp is
 *  the wrong picture even when it is the right subject. */
function isHeroWorthy(img: CommonsImage): boolean {
  if (img.width < MIN_HERO_WIDTH) return false;
  if (img.height <= 0) return true;
  return img.width >= img.height * MIN_HERO_RATIO;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: WIKI_UA,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Resolve many Commons file titles in ONE imageinfo call. The API takes up to
 *  50 titles per request, and the round trip is the expensive part of this
 *  whole endpoint, so we never ask for them one at a time. Returns the
 *  thumbnail at up to MAX_WIDTH (or the original when it is already smaller)
 *  keyed by commonsKey(title). */
async function commonsImages(titles: string[]): Promise<Map<string, CommonsImage>> {
  const out = new Map<string, CommonsImage>();
  const wanted = titles.slice(0, 50).map((t) => `File:${bareFileName(t)}`);
  if (wanted.length === 0) return out;
  const params = new URLSearchParams({
    action: "query",
    titles: wanted.join("|"),
    prop: "imageinfo",
    iiprop: "url|size",
    iiurlwidth: String(MAX_WIDTH),
    format: "json",
  });
  const data = await fetchJson<{
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: {
            thumburl?: string;
            url?: string;
            thumbwidth?: number;
            thumbheight?: number;
            width?: number;
            height?: number;
          }[];
        }
      >;
    };
  }>(`https://commons.wikimedia.org/w/api.php?${params}`);
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const ii = page.imageinfo?.[0];
    const url = ii?.thumburl ?? ii?.url;
    if (!page.title || !ii || !url) continue;
    out.set(commonsKey(page.title), {
      url,
      // thumbwidth/height describe the rendition we'd actually serve; the raw
      // width/height are the fallback when the original was under MAX_WIDTH.
      width: ii.thumbwidth ?? ii.width ?? 0,
      height: ii.thumbheight ?? ii.height ?? 0,
    });
  }
  return out;
}

/** Ordered file titles worth trying for `place` on one wiki host: the page
 *  summary's own lead image first (an editor picked it, so it is the postcard
 *  shot), then whatever else the article carries. */
async function wikiFileTitles(host: string, place: string): Promise<string[]> {
  const slug = encodeURIComponent(place);
  const [summary, media] = await Promise.all([
    fetchJson<{ thumbnail?: { source: string } }>(
      `https://${host}/api/rest_v1/page/summary/${slug}`,
    ),
    fetchJson<{ items?: { title?: string; srcset?: { src: string }[] }[] }>(
      `https://${host}/api/rest_v1/page/media-list/${slug}`,
    ),
  ]);

  const titles: string[] = [];
  const lead = summary?.thumbnail?.source ? filenameFromThumbUrl(summary.thumbnail.source) : null;
  if (lead && isTravelPhoto(lead)) titles.push(lead);
  for (const item of media?.items ?? []) {
    const title = item.title ?? "";
    if (!isTravelPhoto(title)) continue;
    if (!item.srcset?.length) continue;
    titles.push(title);
    if (titles.length >= MAX_TITLES_PER_PAGE) break;
  }
  return titles;
}

/** Wiki hosts to ask, best source first. Wikivoyage is a travel wiki, so its
 *  lead image is a scenic one by construction; Wikipedia is the fallback.
 *  The couple's own language goes first because the destination string was
 *  saved in it — an `hu` couple has "Róma, Olaszország" on the row, and
 *  en.wikipedia has never heard of either. */
function wikiHosts(lang: string): string[] {
  const hosts = [`${lang}.wikivoyage.org`, `${lang}.wikipedia.org`];
  if (lang !== "en") hosts.push("en.wikivoyage.org", "en.wikipedia.org");
  return hosts;
}

/** Best available tourist photo for one place name, or null when no wiki we
 *  ask has an article for it. Every host is queried in parallel and their
 *  titles resolved in a single batched Commons call, so this is two round
 *  trips regardless of how many hosts are in play. */
export async function resolveDestinationPhoto(place: string, lang: string): Promise<string | null> {
  const hosts = wikiHosts(lang);
  const perHost = await Promise.all(hosts.map((h) => wikiFileTitles(h, place)));
  // Host priority survives the flatten: every title from the first host comes
  // before the second host's, and within a host the lead image comes first.
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const titles of perHost) {
    for (const title of titles) {
      const key = commonsKey(title);
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(title);
    }
  }
  if (ordered.length === 0) return null;

  const images = await commonsImages(ordered);
  let fallback: string | null = null;
  for (const title of ordered) {
    const img = images.get(commonsKey(title));
    if (!img) continue;
    if (isHeroWorthy(img)) return img.url;
    // Keep the first thing that at least resolved. A portrait of the right
    // place still beats the empty gradient the page falls back to.
    fallback ??= img.url;
  }
  return fallback;
}

/** Place names worth trying for a destination breadcrumb, most specific first.
 *
 *  Nominatim hands back the whole chain — "Chiesa di San Girolamo dei Croati,
 *  Via Tomacelli, Campo Marzio, Municipio Roma I, Róma, Lazio, Olaszország" —
 *  and a single church has no travel photo while the city, the region and the
 *  country all do. Segments carrying digits are house numbers and postcodes,
 *  never places, so they go.
 *
 *  What survives the trim is the HEAD plus the TAIL, never a prefix: the head
 *  is what the couple actually picked (usually the city, in which case the
 *  ladder ends on rung one), and the tail is city → county → region → country.
 *  The dead weight is the middle — streets and city districts, which no wiki
 *  has a picture of. Capping from the front instead spent the whole budget on
 *  exactly that middle and threw away Rome. */
export function photoCandidates(destination: string): string[] {
  const all: string[] = [];
  const seen = new Set<string>();
  for (const raw of destination.split(",")) {
    const seg = raw.trim();
    if (!seg || /\d/.test(seg)) continue;
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(seg);
  }
  if (all.length === 0) {
    const whole = destination.trim();
    return whole ? [whole] : [];
  }
  if (all.length <= MAX_CANDIDATES) return all;
  const tail = all.slice(-(MAX_CANDIDATES - 1));
  return tail.includes(all[0]!) ? tail : [all[0]!, ...tail];
}

const DEST_PHOTO_DIR = "destination-photos";
/** A destination we found nothing for is remembered as a miss for this long.
 *  Without it, every page load for a couple whose destination is a church or
 *  a hamlet re-walks the whole ladder against Wikimedia. */
const MISS_TTL_SEC = 30 * 24 * 60 * 60;

type PhotoCacheRow = { local_path: string; matched: string | null; fetched_at: number };

function readPhotoCache(key: string): PhotoCacheRow | null {
  return (
    db
      .query<PhotoCacheRow, [string]>(
        "SELECT local_path, matched, fetched_at FROM destination_photo_cache WHERE city = ?",
      )
      .get(key) ?? null
  );
}

function writePhotoCache(key: string, localPath: string, matched: string | null): void {
  db.run(
    `INSERT OR REPLACE INTO destination_photo_cache (city, local_path, matched, fetched_at)
     VALUES (?, ?, ?, strftime('%s','now'))`,
    [key, localPath, matched],
  );
}

/** Download `remoteUrl` to `uploads/destination-photos/<slug>.<ext>` and
 *  return the public `/uploads/…` path, or null on any error. Keyed by the
 *  place the photo is actually of, so every couple honeymooning in Rome
 *  shares one file. */
async function downloadAndCache(place: string, remoteUrl: string): Promise<string | null> {
  try {
    // WIKI_UA matters as much here as on the metadata calls: Wikimedia
    // rate-limits User-Agent-less traffic to upload.wikimedia.org with a 429,
    // which this function used to swallow as a plain "no photo".
    const res = await fetch(remoteUrl, {
      headers: WIKI_UA,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();

    // Derive extension from the remote URL (strip query string first).
    const rawExt = extname(remoteUrl.split("?")[0] ?? "").toLowerCase();
    const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(rawExt) ? rawExt : ".jpg";

    const filename = `${citySlug(place)}${ext}`;
    const key = `${DEST_PHOTO_DIR}/${filename}`;
    await storage.write(key, new Uint8Array(buf));

    const localPath = `/uploads/${key}`;
    writePhotoCache(cityKey(place), localPath, place);
    return localPath;
  } catch {
    return null;
  }
}

/** Wikivoyage / Wikipedia cover photo for the honeymoon destination.
 *
 *  The saved destination is a Nominatim breadcrumb, and its first segment is
 *  often a venue rather than a place ("Chiesa di San Girolamo dei Croati"),
 *  which no travel wiki has a photo of. So we walk the breadcrumb outward —
 *  venue → city → region → country — and keep the first rung that resolves.
 *  `matched` tells the caller which one that was, so the page can caption the
 *  picture honestly rather than labelling a shot of Rome with a church name.
 *
 *  Both the winning rung AND the full destination string are cached, so the
 *  next load is a single row read rather than a re-walk. Misses are cached
 *  too, with a TTL, for the same reason. Never errors. */
async function handleDestinationPhoto(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const destination = ctx.url.searchParams.get("destination");
  if (!destination?.trim()) return json({ photo_url: null, matched: null });
  // Only the languages the app itself ships. Anything else, including a
  // locale with no wiki worth asking, falls back to English.
  const rawLang = ctx.url.searchParams.get("lang") ?? "";
  const lang = rawLang === "hu" || rawLang === "es" ? rawLang : "en";
  const fullKey = cityKey(destination);

  const cached = readPhotoCache(fullKey);
  if (cached) {
    if (cached.local_path === "") {
      // Remembered miss — stay quiet until the TTL lapses.
      const age = Math.floor(Date.now() / 1000) - cached.fetched_at;
      if (age < MISS_TTL_SEC) return json({ photo_url: null, matched: null });
      db.run("DELETE FROM destination_photo_cache WHERE city = ?", [fullKey]);
    } else {
      // Verify the object still exists (could be lost after a data migration).
      const cachedKey = keyFromUploadUrl(cached.local_path);
      if (cachedKey && (await storage.exists(cachedKey)))
        return json({ photo_url: cached.local_path, matched: cached.matched });
      // File missing — evict stale cache entry and re-fetch below.
      db.run("DELETE FROM destination_photo_cache WHERE city = ?", [fullKey]);
    }
  }

  for (const candidate of photoCandidates(destination)) {
    const key = cityKey(candidate);
    const hit = key === fullKey ? null : readPhotoCache(key);
    if (hit && hit.local_path !== "") {
      const hitKey = keyFromUploadUrl(hit.local_path);
      if (hitKey && (await storage.exists(hitKey))) {
        writePhotoCache(fullKey, hit.local_path, candidate);
        return json({ photo_url: hit.local_path, matched: candidate });
      }
      db.run("DELETE FROM destination_photo_cache WHERE city = ?", [key]);
    }

    const remoteUrl = await resolveDestinationPhoto(candidate, lang);
    if (!remoteUrl) continue;
    const localPath = await downloadAndCache(candidate, remoteUrl);
    if (!localPath) continue;
    writePhotoCache(fullKey, localPath, candidate);
    return json({ photo_url: localPath, matched: candidate });
  }

  writePhotoCache(fullKey, "", null);
  return json({ photo_url: null, matched: null });
}

const MAX_HONEYMOON_COVER_BYTES = 4 * 1024 * 1024;
const SUPPORTED_COVER_MIMES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function handleUploadHoneymoonCover(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple");

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const raw = form.get("file");
  if (!(raw instanceof File))
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  if (raw.size <= 0) throw new HttpError(400, "Empty file", { code: "empty_file" });
  if (raw.size > MAX_HONEYMOON_COVER_BYTES)
    throw new HttpError(413, "File too large (max 4 MB)", { code: "file_too_large" });

  const ext = SUPPORTED_COVER_MIMES[raw.type];
  if (!ext)
    throw new HttpError(415, `Unsupported image type: ${raw.type || "unknown"}`, {
      code: "unsupported_type",
    });

  // Remove any previous cover stored under a different extension.
  for (const e of ["jpg", "png", "webp"] as const) {
    if (e === ext) continue;
    await storage.delete(`couples/${couple.id}/honeymoon-cover.${e}`);
  }

  const key = `couples/${couple.id}/honeymoon-cover.${ext}`;
  await storage.write(key, raw);

  const publicPath = `/uploads/${key}`;
  db.run("UPDATE couples SET honeymoon_cover_path = ? WHERE id = ?", [publicPath, couple.id]);

  const updated = db
    .query<CoupleRow, [number]>("SELECT * FROM couples WHERE id = ?")
    .get(couple.id);
  if (!updated) throw new HttpError(500, "Couple disappeared after update");
  return json({ couple: toCouple(updated) });
}

async function handleDeleteHoneymoonCover(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple");

  if (couple.honeymoon_cover_path) {
    const k = keyFromUploadUrl(couple.honeymoon_cover_path);
    if (k) await storage.delete(k);
    db.run("UPDATE couples SET honeymoon_cover_path = NULL WHERE id = ?", [couple.id]);
  }

  return json({ ok: true });
}

export function registerHoneymoonRoutes(router: Router) {
  router.get("/api/honeymoon/flight-estimate", handleFlightEstimate, true);
  router.get("/api/honeymoon/konzinfo", handleKonzinfo, true);
  router.get("/api/honeymoon/destination-photo", handleDestinationPhoto, true);
  router.post("/api/honeymoon/cover", handleUploadHoneymoonCover, true);
  router.delete("/api/honeymoon/cover", handleDeleteHoneymoonCover, true);
}
