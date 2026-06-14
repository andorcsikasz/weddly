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

/** Wikipedia thumbnail for the honeymoon destination city. Accepts a
 *  `?destination=` query param (the raw destination string; this handler
 *  extracts the first comma-segment as the article title). Always returns
 *  `{ photo_url: string | null }` — never errors. */
async function handleDestinationPhoto(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const destination = ctx.url.searchParams.get("destination");
  if (!destination) return json({ photo_url: null });
  const city = (destination.split(",")[0] ?? destination).trim();
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`,
      { headers: { "User-Agent": "Weddly/1.0 (https://weddly.co)" } },
    );
    if (!r.ok) return json({ photo_url: null });
    const data = (await r.json()) as { thumbnail?: { source: string } };
    const src = data?.thumbnail?.source ?? null;
    if (!src) return json({ photo_url: null });
    // Upscale: Wikimedia Commons thumbnails embed the width in the URL path;
    // replacing it with 800px gives a sharper cover photo without fetching the
    // full-resolution original (which can be tens of MB).
    return json({ photo_url: src.replace(/\/\d+px-/, "/800px-") });
  } catch {
    return json({ photo_url: null });
  }
}

export function registerHoneymoonRoutes(router: Router) {
  router.get("/api/honeymoon/flight-estimate", handleFlightEstimate, true);
  router.get("/api/honeymoon/konzinfo", handleKonzinfo, true);
  router.get("/api/honeymoon/destination-photo", handleDestinationPhoto, true);
}
