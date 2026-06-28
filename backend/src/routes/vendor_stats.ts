// Vendor dashboard / stats API. GET /api/vendor/stats returns the VendorStats
// rollup for the calling vendor's account: inquiry counts, status breakdown,
// upcoming confirmed events, blocked-date count, listing completeness, tracked
// revenue, currency, and the billing snapshot. Basic counts are FREE; the
// advanced breakdowns are surfaced behind the PRO gate by the frontend.

import type { VendorStats } from "@shared/vendor_clients";
import { type Ctx, json, type Router } from "../lib/http";
import { buildVendorStats, resolveVendorAccount } from "../domain/vendor_clients";

async function handleGetStats(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const stats: VendorStats = buildVendorStats(account);
  return json(stats);
}

export function registerVendorStatsRoutes(router: Router) {
  router.get("/api/vendor/stats", handleGetStats, true);
}
