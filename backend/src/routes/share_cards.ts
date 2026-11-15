// Link-preview images. Chat apps fetch these with no session, so they are
// public, and they are the `og:image` of an RSVP invite and of a venue page.
//
//   GET /api/share-cards/rsvp/:code   the invite card for a guest code
//   GET /api/share-cards/vendor/:id   the venue card for a public vendor id
//
// The RSVP card shares the RSVP lookup's rate bucket on purpose: a valid code
// answers 200 and an invalid one 404, so an unthrottled card route would be a
// faster code oracle than the lookup it sits beside.

import {
  cachedCard,
  renderRsvpCard,
  renderVendorCard,
  rsvpCardSource,
  vendorCardSource,
} from "../domain/share_card";
import { type Ctx, HttpError, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { RSVP_BUCKET } from "./rsvp";

const VENDOR_BUCKET = { capacity: 60, refillRate: 1 };

function jpegResponse(jpeg: Buffer): Response {
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // The URL carries `?v=<hash>` from the fields it draws, so a changed
      // card is a new URL and a day of caching is safe.
      "Cache-Control": "public, max-age=86400",
    },
  });
}

async function handleRsvpCard(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "rsvp:get", RSVP_BUCKET);
  const code = (ctx.params.code ?? "").trim();
  if (!code || code.length > 32) throw new HttpError(404, "Not found");
  const src = await rsvpCardSource(code);
  if (!src) throw new HttpError(404, "Not found");
  const jpeg = await cachedCard(`rsvp:${code.toUpperCase()}:${src.version}`, () =>
    renderRsvpCard(src),
  );
  return jpegResponse(jpeg);
}

async function handleVendorCard(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "share_card:vendor", VENDOR_BUCKET);
  const id = (ctx.params.id ?? "").trim();
  if (!id || id.length > 120) throw new HttpError(404, "Not found");
  const src = await vendorCardSource(id);
  if (!src) throw new HttpError(404, "Not found");
  const jpeg = await cachedCard(`vendor:${id}:${src.version}`, () => renderVendorCard(src));
  return jpegResponse(jpeg);
}

export function registerShareCardRoutes(router: Router) {
  router.get("/api/share-cards/rsvp/:code", handleRsvpCard);
  router.get("/api/share-cards/vendor/:id", handleVendorCard);
}
