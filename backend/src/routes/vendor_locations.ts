// Category × city SEO landing pages — public, read-only lookup that resolves
// a URL's category + city slug into the real category, exact city string and
// country the frontend needs to call the existing `/api/public/vendors`
// catalogue with. See shared/vendor_locations.ts for the slug vocabulary and
// domain/vendor_locations.ts for how a combo is counted and cached.

import { resolveCategoryCityCombo } from "../domain/vendor_locations";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

function handleResolve(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "public.vendor_locations", { capacity: 60, refillRate: 1 });
  const categorySlug = ctx.params.category_slug?.trim() ?? "";
  const citySlug = ctx.params.city_slug?.trim() ?? "";
  const combo = resolveCategoryCityCombo(categorySlug, citySlug);
  if (!combo) throw new HttpError(404, "Unknown category/city combination");
  return json({
    category: combo.category,
    city: combo.cityDisplay,
    country: combo.country,
    count: combo.count,
  });
}

export function registerVendorLocationRoutes(router: Router) {
  router.get("/api/public/vendor-locations/:category_slug/:city_slug", handleResolve);
}
