// Company lookup & auto-fill for business profiles (planner onboarding +
// settings + vendor signup). Thin layer over lib/company_lookup: the factory
// decides which countries have a free official registry source; everything
// else reports available:false and the frontend falls back to manual entry.
//
// Lookups fire only on an explicit user search (compliance rule) and are
// rate-limited per IP. Signed-in callers get the normal onboarding-session
// bucket; anonymous callers (the vendor signup form runs pre-account) get a
// much stingier one so the endpoints can't be farmed as an open registry
// proxy; that anon burst still covers one signup's worth of searches.

import { getFreeProvider, lookupAvailability } from "../lib/company_lookup";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import {
  type BucketConfig,
  COMPANY_LOOKUP_BUCKET,
  COMPANY_LOOKUP_ANON_BUCKET,
  rateLimit,
} from "../lib/rate_limit";

function countryParam(ctx: Ctx): string {
  const raw = new URL(ctx.req.url).searchParams.get("country") ?? "";
  if (!/^[A-Za-z]{2}$/.test(raw)) throw new HttpError(400, "country must be ISO 3166-1 alpha-2");
  return raw.toUpperCase();
}

/** Separate anon bucket key so a burst of anonymous farming can't starve a
 *  signed-in planner mid-onboarding from the same NAT'd office IP. */
function lookupBucket(ctx: Ctx): { key: string; config: BucketConfig } {
  return ctx.userId
    ? { key: "company_lookup:search", config: COMPANY_LOOKUP_BUCKET }
    : { key: "company_lookup:anon", config: COMPANY_LOOKUP_ANON_BUCKET };
}

// Availability is a pure in-process factory check (static per-country config,
// no upstream call), so it stays unthrottled; throttling it would eat the
// search budget of a user flipping through the country picker.
function handleAvailability(ctx: Ctx): Response {
  return json(lookupAvailability(countryParam(ctx)));
}

async function handleSearch(ctx: Ctx): Promise<Response> {
  const bucket = lookupBucket(ctx);
  rateLimit(ctx.clientIp, bucket.key, bucket.config);
  const country = countryParam(ctx);
  const q = (new URL(ctx.req.url).searchParams.get("q") ?? "").trim();
  if (!q) throw new HttpError(400, "q required");
  if (q.length > 120) throw new HttpError(400, "q too long");

  const provider = getFreeProvider(country);
  if (!provider) throw new HttpError(404, "no free lookup source for this country");

  const results = await provider.search(q);
  if (results === null) throw new HttpError(502, "company lookup temporarily unavailable");
  return json({ results });
}

async function handleGetCompany(ctx: Ctx): Promise<Response> {
  const bucket = lookupBucket(ctx);
  rateLimit(ctx.clientIp, bucket.key, bucket.config);
  const country = countryParam(ctx);
  const id = (ctx.params.id ?? "").trim();
  if (!id || id.length > 40) throw new HttpError(400, "invalid company id");

  const provider = getFreeProvider(country);
  if (!provider) throw new HttpError(404, "no free lookup source for this country");

  const company = await provider.getCompany(id);
  if (!company) throw new HttpError(404, "company not found");
  return json({ company });
}

export function registerCompanyLookupRoutes(router: Router) {
  // Anonymous-allowed (requireAuth=false) since the vendor signup form runs
  // pre-account; ctx.userId still resolves for signed-in callers, which is
  // what routes the request into the right rate bucket.
  router.get("/api/company-lookup/availability", handleAvailability);
  router.get("/api/company-lookup/search", handleSearch);
  router.get("/api/company-lookup/company/:id", handleGetCompany);
}
