// Company lookup & auto-fill for business profiles (planner onboarding +
// settings). Thin layer over lib/company_lookup: the factory decides which
// countries have a free official registry source; everything else reports
// available:false and the frontend falls back to manual entry.
//
// Lookups fire only on an explicit user search (compliance rule), are
// rate-limited per IP, and auth-gated so the endpoints can't be farmed as an
// anonymous registry proxy.

import { getFreeProvider, lookupAvailability } from "../lib/company_lookup";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { COMPANY_LOOKUP_BUCKET, rateLimit } from "../lib/rate_limit";

function countryParam(ctx: Ctx): string {
  const raw = new URL(ctx.req.url).searchParams.get("country") ?? "";
  if (!/^[A-Za-z]{2}$/.test(raw)) throw new HttpError(400, "country must be ISO 3166-1 alpha-2");
  return raw.toUpperCase();
}

function handleAvailability(ctx: Ctx): Response {
  requireAuth(ctx);
  return json(lookupAvailability(countryParam(ctx)));
}

async function handleSearch(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  rateLimit(ctx.clientIp, "company_lookup:search", COMPANY_LOOKUP_BUCKET);
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
  requireAuth(ctx);
  rateLimit(ctx.clientIp, "company_lookup:search", COMPANY_LOOKUP_BUCKET);
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
  router.get("/api/company-lookup/availability", handleAvailability, true);
  router.get("/api/company-lookup/search", handleSearch, true);
  router.get("/api/company-lookup/company/:id", handleGetCompany, true);
}
