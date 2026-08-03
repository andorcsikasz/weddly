// Revenue Pulse API, GET /api/vendor/revenue.
//
// PRO only, and deliberately under the EXISTING `payment_tracking` feature
// rather than a new flag: this is the same money the payment schedule tracks,
// read forwards instead of backwards, so a vendor who can see one can see the
// other and there is one thing to buy rather than two. `requireVendorPro` is
// the server gate; the frontend reads `features.payment_tracking` off the
// billing snapshot so the two agree by construction.
//
// FREE gets a 403 with the ordinary `vendor_pro_required` code and the UI
// renders NOTHING at all rather than a locked teaser. The clients list is
// deliberately useful on FREE, and a paywall bar pinned to the top of it would
// undo the one promise the free tier makes.
//
// Read-only: no body, no query, nothing to validate.

import type { VendorRevenuePulseView } from "@shared/vendor_revenue";
import { type Ctx, json, type Router } from "../lib/http";
import { requireVendorPro, resolveVendorAccount } from "../domain/vendor_clients";
import { buildVendorRevenuePulse } from "../domain/vendor_revenue";

async function handleGetRevenuePulse(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const pulse: VendorRevenuePulseView = buildVendorRevenuePulse(account);
  return json(pulse);
}

export function registerVendorRevenueRoutes(router: Router) {
  router.get("/api/vendor/revenue", handleGetRevenuePulse, true);
}
