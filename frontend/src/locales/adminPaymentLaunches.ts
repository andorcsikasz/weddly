// The payment launch panel is an internal operator surface. DE/ES/HR keep the
// canonical English operational terms for now so every complete locale gets
// the same unambiguous safety wording; HU and EN carry native copy inline.
const ADMIN_PAYMENT_LAUNCH_FALLBACK = {
  fin_launch_title: "Payment product launches",
  fin_launch_note:
    "Launch or pause each checkout surface independently. Launch is available only after required Stripe configuration and product-specific checkout terms acceptance are implemented.",
  fin_launch_live_count: "{live} / {total} live",
  fin_launch_paywall_separate:
    "These controls only allow or block new payment sessions. Pausing does not change access, customer portals, existing renewals, or Checkout sessions already open. Global access enforcement is separate below.",
  fin_launch_loading: "Loading payment launch states",
  fin_launch_retry: "Retry",
  fin_launch_refresh: "Refresh states",
  fin_launch_load_error_title: "Launch states could not be loaded",
  fin_launch_load_error_body:
    "No payment switch can be changed until the current server state is known. Retry before taking action.",
  fin_launch_state_live: "Live",
  fin_launch_state_blocked: "Launch requested · blocked",
  fin_launch_state_off: "Off",
  fin_launch_ready: "Required environment present",
  fin_launch_not_ready: "Configuration incomplete",
  fin_launch_missing: "Missing:",
  fin_launch_last_changed: "Last changed {date}",
  fin_launch_revision: "Revision {version}",
  fin_launch_enable: "Launch",
  fin_launch_disable: "Pause new payments",
  fin_launch_fix_config: "Fix configuration first",
  fin_launch_updating: "Updating…",
  fin_launch_confirm_on_title: "Launch {product}?",
  fin_launch_confirm_on_body:
    "This immediately makes this product's checkout or billing path available. It does not enable the global read-only paywall.",
  fin_launch_confirm_off_title: "Pause {product}?",
  fin_launch_confirm_off_body:
    "This blocks new payment sessions. It does not change access, portals, existing renewals, or Checkout sessions already open.",
  fin_launch_disable_paywall_body:
    "Pausing this required subscription product while the global paywall is on also turns the paywall off, so customers are not trapped.",
  fin_launch_on_success: "{product} is now live.",
  fin_launch_off_success: "New payments for {product} are paused.",
  fin_launch_update_error:
    "The payment launch state could not be changed. Its readiness has been refreshed.",
  fin_launch_overview_refresh_error:
    "The product changed, but the global paywall status could not be refreshed. Reload before another change.",
  fin_launch_conflict:
    "Another admin changed this product. The latest state is shown; review it before trying again.",
  fin_launch_smoke_title: "Pre-launch smoke test",
  fin_launch_smoke_warning:
    "The badge only shows that required environment values exist. The server validates Stripe mode, account and price details when you launch; webhook delivery and fulfillment still need this smoke test.",
  fin_launch_smoke_account: "Use a non-admin test account for the selected customer type.",
  fin_launch_smoke_checkout:
    "Complete test-mode Checkout with 3DS and a decline. Confirm amount, currency and cadence.",
  fin_launch_smoke_webhook:
    "Confirm a 2xx webhook and the expected entitlement only after successful payment.",
  fin_launch_smoke_manage:
    "Test portal management for subscriptions and the refund/access policy for one-time products.",
  fin_launch_smoke_pause:
    "Pause again: new payments must stop while existing access, portals and renewals remain. Repeat one controlled live transaction before public launch.",
  fin_launch_product_couple_subscriptions: "Couple subscriptions",
  fin_launch_product_couple_subscriptions_note: "Recurring Checkout for couple workspaces.",
  fin_launch_product_planner_subscriptions: "Planner subscriptions",
  fin_launch_product_planner_subscriptions_note: "Recurring Essentials, Pro and Studio plans.",
  fin_launch_product_vendor_billing: "Vendor billing",
  fin_launch_product_vendor_billing_note:
    "Card setup, a free-lead allowance, then a separate explicit subscription checkout.",
  fin_launch_product_film_checkout: "Wedding film checkout",
  fin_launch_product_film_checkout_note: "One-time wedding film purchase and activation.",
  fin_launch_product_guest_page_addon: "Guest-page add-on",
  fin_launch_product_guest_page_addon_note: "One-time unlock for planner-managed couples.",
  fin_enforce_launch_prereq:
    "Launch couple, planner and vendor subscriptions with ready configuration before enabling the global paywall.",
} as const;

export const ADMIN_PAYMENT_LAUNCH_DE = ADMIN_PAYMENT_LAUNCH_FALLBACK;
export const ADMIN_PAYMENT_LAUNCH_ES = ADMIN_PAYMENT_LAUNCH_FALLBACK;
export const ADMIN_PAYMENT_LAUNCH_HR = ADMIN_PAYMENT_LAUNCH_FALLBACK;
