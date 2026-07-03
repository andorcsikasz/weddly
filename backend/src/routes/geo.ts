// Address autocomplete for vendor signup + the vendor listing editor. Thin
// proxy over lib/address_suggest (Photon/OSM, free, no key): the browser
// never talks to the upstream, our per-IP rate limit applies, and the
// suggestion shape stays ours (shared/geo.ts) if the geocoder ever changes.
//
// Anonymous-allowed like company_lookup: the vendor signup form runs
// pre-account. Signed-in callers get a roomier bucket via ctx.userId.

import { suggestAddresses } from "../lib/address_suggest";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { ADDRESS_SUGGEST_ANON_BUCKET, ADDRESS_SUGGEST_BUCKET, rateLimit } from "../lib/rate_limit";

const MIN_QUERY_LEN = 3;
const MAX_QUERY_LEN = 200;

async function handleAddressSuggest(ctx: Ctx): Promise<Response> {
  if (ctx.userId) {
    rateLimit(ctx.clientIp, "geo_suggest", ADDRESS_SUGGEST_BUCKET);
  } else {
    rateLimit(ctx.clientIp, "geo_suggest:anon", ADDRESS_SUGGEST_ANON_BUCKET);
  }
  const params = new URL(ctx.req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (q.length > MAX_QUERY_LEN) throw new HttpError(400, "q too long");
  // Sub-minimum queries are a normal part of typing, not an error. Answer
  // them locally with an empty list instead of burning an upstream call.
  if (q.length < MIN_QUERY_LEN) return json({ suggestions: [] });
  const lang = params.get("lang") === "hu" ? "hu" : "en";

  const suggestions = await suggestAddresses(q, lang);
  if (suggestions === null) {
    throw new HttpError(502, "address suggestions temporarily unavailable");
  }
  return json({ suggestions });
}

export function registerGeoRoutes(router: Router) {
  router.get("/api/geo/address-suggest", handleAddressSuggest);
}
