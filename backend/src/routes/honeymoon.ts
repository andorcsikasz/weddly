// Honeymoon-page server endpoints. Today it's just the flight estimate —
// other honeymoon state (destination, dates) lives on the couples row and is
// read/written through /api/couples. Keeping the estimate behind its own
// route lets us cache + refresh independently and skip the network entirely
// when Amadeus credentials aren't set.

import { getCoupleForUser } from "../domain/couples";
import { getFlightEstimate } from "../domain/honeymoon_flights";
import { buildKonzinfoInfo } from "../domain/konzinfo";
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

// Filename patterns that indicate a non-photo (map, marker, seal, flag …).
const NON_PHOTO_RE =
  /marker|locator|location|_map[._]|\.svg\b|seal|flag|emblem|coat_of_arms|coat-of-arms|logo/i;

/** Try to resolve a Wikimedia thumbnail URL to a photo-suitable variant.
 *  Returns the 800px upscaled URL when Wikimedia serves it (200), otherwise
 *  the original URL — ensures we never hand the browser a 400. */
async function wikimediaPhoto(src: string): Promise<string> {
  const upscaled = src.replace(/\/\d+px-/, "/800px-");
  const probe = await fetch(upscaled, { method: "HEAD" }).catch(() => null);
  return probe?.ok ? upscaled : src;
}

/** Pick the first travel-photo-looking image from the Wikipedia media list.
 *  Skips SVGs, maps, seals, flags, logos, and coats of arms. */
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
      // Pick the largest srcset entry (last in the array).
      const src = item.srcset?.at(-1)?.src;
      if (!src) continue;
      // Normalise protocol-relative URLs.
      const abs = src.startsWith("//") ? `https:${src}` : src;
      return wikimediaPhoto(abs);
    }
  } catch {
    // fall through
  }
  return null;
}

/** Wikipedia thumbnail for the honeymoon destination city. Accepts a
 *  `?destination=` query param (the raw destination string; this handler
 *  extracts the first comma-segment as the article title). When the page
 *  summary thumbnail is a map/marker/SVG it falls back to the article media
 *  list and picks the first real travel photo. Always returns
 *  `{ photo_url: string | null }` — never errors. */
async function handleDestinationPhoto(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const destination = ctx.url.searchParams.get("destination");
  if (!destination) return json({ photo_url: null });
  const city = (destination.split(",")[0] ?? destination).trim();
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`,
      { headers: WIKI_UA },
    );
    if (!r.ok) return json({ photo_url: null });
    const data = (await r.json()) as { thumbnail?: { source: string } };
    const src = data?.thumbnail?.source ?? null;

    // If there is no thumbnail, or it looks like a map/marker/SVG, try the
    // media-list to find an actual scenic photo.
    if (!src || NON_PHOTO_RE.test(src)) {
      const fallback = await mediaListPhoto(city);
      return json({ photo_url: fallback });
    }

    return json({ photo_url: await wikimediaPhoto(src) });
  } catch {
    return json({ photo_url: null });
  }
}

export function registerHoneymoonRoutes(router: Router) {
  router.get("/api/honeymoon/flight-estimate", handleFlightEstimate, true);
  router.get("/api/honeymoon/konzinfo", handleKonzinfo, true);
  router.get("/api/honeymoon/destination-photo", handleDestinationPhoto, true);
}
