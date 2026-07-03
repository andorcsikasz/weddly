// Vendor freemium plan contract. A vendor is either on the FREE tier (no
// active subscription / lapsed founding-or-trial window) or the PRO tier
// (an entitled subscription). The plan is DERIVED from the existing vendor
// billing entitlement — never stored separately — so the soft paywall and
// the read-only billing gate (domain/vendor_billing.ts) can never disagree.
//
// FREE always works: edit listing/profile, see the inquiry count + a basic
// client list. PRO unlocks the full client CRM detail, payment tracking +
// schedule, advanced stats, and the respond/status workflow. The UI shows a
// graceful upgrade prompt for a locked feature; it must never break.

/** The two vendor tiers. Derived from billing entitlement, not stored. */
export type VendorPlan = "free" | "pro";

/** Premium feature keys gated behind the PRO tier. Everything not listed here
 *  (listing edit, inquiry count, basic client list) is always available. */
export type VendorFeature =
  | "client_crm_detail"
  | "payment_tracking"
  | "advanced_stats"
  | "response_workflow"
  /** Receiving direct inquiries (booking requests) from couples. On FREE the
   *  public listing stays visible but its inquiry CTA is off. */
  | "direct_messages"
  /** The self-serve availability calendar (blocked dates + the public busy
   *  calendar / next-free date derived from it). */
  | "calendar_availability";

/** Per-feature minimum plan. A feature with `minPlan: "free"` is always on;
 *  the premium features require `"pro"`. Kept as a map (not a bare set)
 *  so a future "lite tier" can slot a third plan in without touching callers. */
export const VENDOR_FEATURES: Record<VendorFeature, { minPlan: VendorPlan }> = {
  client_crm_detail: { minPlan: "pro" },
  payment_tracking: { minPlan: "pro" },
  advanced_stats: { minPlan: "pro" },
  response_workflow: { minPlan: "pro" },
  direct_messages: { minPlan: "pro" },
  calendar_availability: { minPlan: "pro" },
};

/** True when `plan` may use `feature`. PRO unlocks everything; FREE only the
 *  features whose `minPlan` is "free". The single gate both backend route
 *  guards and frontend upgrade-prompt logic call. */
export function isVendorFeatureEnabled(plan: VendorPlan, feature: VendorFeature): boolean {
  const required = VENDOR_FEATURES[feature].minPlan;
  if (required === "free") return true;
  return plan === "pro";
}

/** Map an entitlement snapshot to the active plan: entitled => "pro",
 *  lapsed / none => "free". The single derivation point — callers pass the
 *  computed `billing.entitled` so there's no second source of truth. */
export function vendorPlanFromEntitlement(entitled: boolean): VendorPlan {
  return entitled ? "pro" : "free";
}

/** Materialised per-feature on/off map for a plan. Shipped to the frontend on
 *  the billing response so a component can read `features.payment_tracking`
 *  without re-deriving the gate. */
export type VendorFeatureFlags = Record<VendorFeature, boolean>;

/** Build the full flag map for a plan. */
export function vendorFeatureFlags(plan: VendorPlan): VendorFeatureFlags {
  return {
    client_crm_detail: isVendorFeatureEnabled(plan, "client_crm_detail"),
    payment_tracking: isVendorFeatureEnabled(plan, "payment_tracking"),
    advanced_stats: isVendorFeatureEnabled(plan, "advanced_stats"),
    response_workflow: isVendorFeatureEnabled(plan, "response_workflow"),
    direct_messages: isVendorFeatureEnabled(plan, "direct_messages"),
    calendar_availability: isVendorFeatureEnabled(plan, "calendar_availability"),
  };
}
