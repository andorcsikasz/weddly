// Vendor billing API. GET /api/vendor/billing returns the billing snapshot
// (reused from shared/vendor_billing.ts), the derived FREE/PRO plan, and the
// per-feature flag map so the frontend can render the upgrade CTA + gate
// premium surfaces. Vendor Stripe checkout is not wired here — this exposes the
// plan / founding / trial status + upgrade messaging only. No Stripe code is
// invented; a future webhook funnels through domain/vendor_billing.ts.

import type { VendorBilling } from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { vendorFeatureFlags, vendorPlanFromEntitlement } from "@shared/vendor_plan";
import { type Ctx, json, type Router } from "../lib/http";
import { resolveVendorAccount } from "../domain/vendor_clients";
import { getVendorSub, toVendorBilling } from "../domain/vendor_billing";

async function handleGetBilling(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const sub = getVendorSub(account.id);
  const billing: VendorBilling = sub
    ? toVendorBilling(sub)
    : {
        subscription_status: "trialing",
        trial_ends_at: null,
        founding_until: null,
        is_founding_member: false,
        current_period_end: null,
        currency: "EUR",
        entitled: false,
        reason: "none",
      };
  const plan: VendorPlan = vendorPlanFromEntitlement(billing.entitled);
  const features: VendorFeatureFlags = vendorFeatureFlags(plan);
  return json({ billing, plan, features });
}

export function registerVendorBillingRoutes(router: Router) {
  router.get("/api/vendor/billing", handleGetBilling, true);
}
