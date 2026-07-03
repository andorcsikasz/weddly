// Vendor billing API: the freemium money path.
//
//   GET  /api/vendor/billing          : status + derived plan + feature flags
//   POST /api/vendor/billing/setup    : Stripe Checkout in SETUP mode: save a
//                                       card, no charge. Completing it (via the
//                                       webhook) flips the vendor into the
//                                       lead_window (3 free inquiries).
//   POST /api/vendor/billing/checkout : classic subscription Checkout for a
//                                       lapsed / canceled vendor to (re)join.
//   POST /api/vendor/billing/portal   : Stripe Billing Portal redirect.
//   POST /api/vendor/billing/webhook  : SEPARATE endpoint + signing secret
//                                       (STRIPE_VENDOR_WEBHOOK_SECRET), mirrors
//                                       the planner webhook.
//
// The 3rd free lead stamps billing_starts_at (start of next month) in the
// domain layer; ensureVendorScheduledSubscription then creates the real Stripe
// subscription with trial_end = that date, so the first charge lands exactly
// when the copy promised. It's idempotent and re-attempted from the status
// read, so a transient Stripe failure heals on the next billing-page visit.

import type Stripe from "stripe";
import {
  type VendorBilling,
  type VendorBillingStatus,
  VENDOR_FREE_LEAD_CREDITS,
  vendorCurrencyForLocale,
  vendorPrice,
} from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { vendorFeatureFlags, vendorPlanFromEntitlement } from "@shared/vendor_plan";
import type { Currency } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import { claimStripeEvent, stripe } from "../domain/billing";
import { getUserById } from "../domain/users";
import { getVendorAccountById } from "../domain/vendor_accounts";
import {
  applyVendorSubscriptionState,
  getVendorByStripeCustomer,
  getVendorSub,
  markVendorCardOnFile,
  setVendorStripeCustomerId,
  toVendorBilling,
  vendorFoundingSpotsLeft,
  type VendorSubRow,
} from "../domain/vendor_billing";
import { resolveVendorAccount } from "../domain/vendor_clients";
import { log } from "../lib/logger";
import { type Ctx, HttpError, json, type Router } from "../lib/http";

/** The vendor's pinned display currency (fallback: owner locale). */
function vendorCurrency(sub: VendorSubRow | null, ownerUserId: number): Currency {
  if (sub?.currency === "HUF" || sub?.currency === "EUR" || sub?.currency === "USD") {
    return sub.currency;
  }
  return vendorCurrencyForLocale(getUserById(ownerUserId)?.locale);
}

/** The Stripe Price id for the vendor monthly plan in this currency. */
function vendorPriceId(currency: Currency): string {
  const id = currency === "HUF" ? CONFIG.stripePriceVendorHuf : CONFIG.stripePriceVendorEur;
  if (!id) {
    throw new HttpError(503, "Vendor billing is not configured", { code: "billing_disabled" });
  }
  return id;
}

/** Stripe moved `current_period_end` onto subscription items in recent API
 *  versions; read defensively from both spots. Returns epoch ms. */
function periodEndMs(sub: Stripe.Subscription): number | null {
  const s = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const secs = s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;
  return secs ? secs * 1000 : null;
}

/** Reuse the vendor's Stripe customer across setup/checkout so the saved card,
 *  payment history, and the portal stay on one record. */
async function ensureStripeCustomer(vendorAccountId: number): Promise<string> {
  const sub = getVendorSub(vendorAccountId);
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;
  const account = getVendorAccountById(vendorAccountId);
  const owner = account ? getUserById(account.owner_user_id) : null;
  const customer = await stripe().customers.create({
    email: account?.contact_email ?? owner?.email ?? undefined,
    name: account?.display_name ?? undefined,
    metadata: { vendor_account_id: String(vendorAccountId) },
  });
  setVendorStripeCustomerId(vendorAccountId, customer.id);
  return customer.id;
}

/** Create the scheduled Stripe subscription once the free leads are spent:
 *  billing_starts_at is stamped, a card is on file, and no subscription exists
 *  yet. trial_end = billing_starts_at makes Stripe charge exactly on the
 *  promised "next month" date. Idempotent; failures are logged and retried on
 *  the next billing status read. */
export async function ensureVendorScheduledSubscription(vendorAccountId: number): Promise<void> {
  if (!STRIPE_ENABLED) return;
  const sub = getVendorSub(vendorAccountId);
  if (
    !sub ||
    sub.subscription_status !== "lead_window" ||
    sub.billing_starts_at === null ||
    sub.stripe_subscription_id !== null ||
    sub.card_on_file !== 1
  ) {
    return;
  }
  try {
    const customerId = sub.stripe_customer_id ?? (await ensureStripeCustomer(vendorAccountId));
    const currency = vendorCurrency(sub, getVendorAccountById(vendorAccountId)?.owner_user_id ?? 0);
    // Stripe wants trial_end comfortably in the future; when the 3rd lead
    // lands moments before the month boundary, nudge the anchor forward
    // rather than fail the creation.
    const trialEndMs = Math.max(sub.billing_starts_at, Date.now() + 1000 * 60 * 60);
    const created = await stripe().subscriptions.create({
      customer: customerId,
      items: [{ price: vendorPriceId(currency), quantity: 1 }],
      trial_end: Math.floor(trialEndMs / 1000),
      metadata: { vendor_account_id: String(vendorAccountId) },
    });
    applyVendorSubscriptionState(vendorAccountId, {
      subscriptionId: created.id,
      stripeStatus: created.status,
      currentPeriodEnd: periodEndMs(created),
    });
  } catch (err) {
    log.warn("vendor_billing.schedule_subscription_failed", {
      vendorAccountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── GET /api/vendor/billing ─────────────────────────────────────────────────
/** A vendor with no sub row yet (claim-flow account, pre-billing) is FREE and
 *  unentitled, deliberately NOT lazily granted, so reading this page never
 *  spends a founding slot. */
function noSubBilling(currency: Currency): VendorBilling {
  return {
    subscription_status: "none",
    trial_ends_at: null,
    founding_until: null,
    is_founding_member: false,
    current_period_end: null,
    card_on_file: false,
    lead_credits_used: 0,
    lead_credits_total: VENDOR_FREE_LEAD_CREDITS,
    billing_starts_at: null,
    currency,
    entitled: false,
    reason: "none",
  };
}

async function handleGetBilling(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  // Retry seam: heal a missed/failed scheduled-subscription creation.
  await ensureVendorScheduledSubscription(account.id);
  const fresh = getVendorSub(account.id);
  const currency = vendorCurrency(fresh, account.owner_user_id);
  const billing: VendorBilling = fresh ? toVendorBilling(fresh) : noSubBilling(currency);
  const plan: VendorPlan = vendorPlanFromEntitlement(billing.entitled);
  const features: VendorFeatureFlags = vendorFeatureFlags(plan);
  const status: VendorBillingStatus & { plan: VendorPlan; features: VendorFeatureFlags } = {
    enabled: STRIPE_ENABLED,
    billing,
    currency,
    price: vendorPrice(currency),
    founding_spots_left: vendorFoundingSpotsLeft(),
    plan,
    features,
  };
  return json(status);
}

// ── POST /api/vendor/billing/setup ──────────────────────────────────────────
/** Card collection, no charge: Stripe Checkout in setup mode. The webhook's
 *  checkout.session.completed flips the vendor into the lead window. */
async function handleSetup(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED) {
    throw new HttpError(503, "Vendor billing is not configured", { code: "billing_disabled" });
  }
  const account = resolveVendorAccount(ctx);
  const sub = getVendorSub(account.id);
  if (sub && (sub.subscription_status === "active" || sub.subscription_status === "past_due")) {
    throw new HttpError(400, "Already subscribed, manage the card in the billing portal", {
      code: "already_subscribed",
    });
  }
  const customerId = await ensureStripeCustomer(account.id);
  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    client_reference_id: String(account.id),
    metadata: { vendor_account_id: String(account.id) },
    success_url: `${CONFIG.frontendBaseUrl}/vendor/billing?setup=success`,
    cancel_url: `${CONFIG.frontendBaseUrl}/vendor/billing?setup=cancel`,
  });
  return json({ url: session.url });
}

// ── POST /api/vendor/billing/checkout ───────────────────────────────────────
/** Direct subscription Checkout: the recovery path for a lapsed / canceled /
 *  leads-exhausted vendor who wants PRO back immediately (charges now, no
 *  free-lead window). */
async function handleCheckout(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED) {
    throw new HttpError(503, "Vendor billing is not configured", { code: "billing_disabled" });
  }
  const account = resolveVendorAccount(ctx);
  const sub = getVendorSub(account.id);
  if (sub && (sub.subscription_status === "active" || sub.subscription_status === "past_due")) {
    throw new HttpError(400, "Already subscribed", { code: "already_subscribed" });
  }
  const currency = vendorCurrency(sub, account.owner_user_id);
  const customerId = await ensureStripeCustomer(account.id);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: vendorPriceId(currency), quantity: 1 }],
    subscription_data: { metadata: { vendor_account_id: String(account.id) } },
    client_reference_id: String(account.id),
    metadata: { vendor_account_id: String(account.id) },
    allow_promotion_codes: true,
    success_url: `${CONFIG.frontendBaseUrl}/vendor/billing?checkout=success`,
    cancel_url: `${CONFIG.frontendBaseUrl}/vendor/billing?checkout=cancel`,
  });
  return json({ url: session.url });
}

// ── POST /api/vendor/billing/portal ─────────────────────────────────────────
async function handlePortal(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED) {
    throw new HttpError(503, "Vendor billing is not configured", { code: "billing_disabled" });
  }
  const account = resolveVendorAccount(ctx);
  const sub = getVendorSub(account.id);
  if (!sub?.stripe_customer_id) {
    throw new HttpError(400, "No billing account to manage", { code: "no_customer" });
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${CONFIG.frontendBaseUrl}/vendor/billing`,
  });
  return json({ url: session.url });
}

// ── POST /api/vendor/billing/webhook ────────────────────────────────────────
function resolveVendorId(obj: {
  metadata?: Stripe.Metadata | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
}): number | null {
  const fromMeta = Number(obj.metadata?.vendor_account_id);
  if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  if (obj.customer) return getVendorByStripeCustomer(String(obj.customer));
  return null;
}

/** Setup-mode Checkout completed: make the saved card the customer's default
 *  for invoices, then open the lead window. */
async function applyCardSetup(vendorAccountId: number, s: Stripe.Checkout.Session): Promise<void> {
  if (s.setup_intent) {
    const intent = await stripe().setupIntents.retrieve(String(s.setup_intent));
    if (intent.payment_method && s.customer) {
      await stripe().customers.update(String(s.customer), {
        invoice_settings: { default_payment_method: String(intent.payment_method) },
      });
    }
  }
  markVendorCardOnFile(vendorAccountId);
}

async function handleWebhook(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED || !CONFIG.stripeVendorWebhookSecret) {
    throw new HttpError(503, "Vendor billing webhook not configured");
  }
  const sig = ctx.req.headers.get("stripe-signature");
  if (!sig) throw new HttpError(400, "Missing stripe-signature header");
  const raw = await ctx.req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, sig, CONFIG.stripeVendorWebhookSecret);
  } catch {
    throw new HttpError(400, "Invalid webhook signature");
  }

  // Idempotency: Stripe delivers at-least-once. Claim the event id AFTER the
  // signature check and skip if already processed (shared global ledger).
  if (!claimStripeEvent(event.id, event.type)) {
    return json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const vendorId = Number(s.metadata?.vendor_account_id ?? s.client_reference_id);
      if (Number.isInteger(vendorId) && vendorId > 0) {
        if (s.customer) setVendorStripeCustomerId(vendorId, String(s.customer));
        if (s.mode === "setup") {
          await applyCardSetup(vendorId, s);
        } else if (s.subscription) {
          const sub = await stripe().subscriptions.retrieve(String(s.subscription));
          applyVendorSubscriptionState(vendorId, {
            subscriptionId: sub.id,
            stripeStatus: sub.status,
            currentPeriodEnd: periodEndMs(sub),
          });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const vendorId = resolveVendorId(sub);
      if (vendorId) {
        applyVendorSubscriptionState(vendorId, {
          subscriptionId: sub.id,
          stripeStatus: sub.status,
          currentPeriodEnd: periodEndMs(sub),
        });
      }
      break;
    }
    default:
      break;
  }
  return json({ received: true });
}

export function registerVendorBillingRoutes(router: Router) {
  router.get("/api/vendor/billing", handleGetBilling, true);
  router.post("/api/vendor/billing/setup", handleSetup, true);
  router.post("/api/vendor/billing/checkout", handleCheckout, true);
  router.post("/api/vendor/billing/portal", handlePortal, true);
  // Public: authenticated by the Stripe signature, not a session bearer.
  router.post("/api/vendor/billing/webhook", handleWebhook, false);
}
