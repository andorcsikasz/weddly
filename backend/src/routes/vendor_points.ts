// Weddly Points read API. `GET /api/vendor/points` returns the calling vendor's
// derived total, tier, perks and recent ledger entries.
//
// READ-ONLY on purpose (phase 1): nothing here awards, adjusts or recomputes.
// Points enter the system exclusively through the outbox → engine path
// (domain/vendor_points.ts), so there is no HTTP surface a client could use to
// pay itself.

import type { VendorPointsStatus } from "@shared/vendor_points";
import { type Ctx, json, type Router } from "../lib/http";
import { resolveVendorAccount } from "../domain/vendor_clients";
import { vendorPointsStatus } from "../domain/vendor_points";

async function handleGetPoints(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const status: VendorPointsStatus = vendorPointsStatus(account.id);
  return json(status);
}

export function registerVendorPointsRoutes(router: Router) {
  router.get("/api/vendor/points", handleGetPoints, true);
}
