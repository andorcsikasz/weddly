// Subscription billing endpoints: Stripe-hosted Checkout + Billing Portal, the
// couple's billing status, and the webhook that drives the state machine.
//
// The payment UI is entirely Stripe-hosted (see CLAUDE.md decision) — we only
// mint redirect URLs and react to webhook events. No card data touches us.

import type Stripe from "stripe";
import { type BillingStatusResponse, FOUNDING_CAP, MONTHLY_PRICE } from "@shared/billing";
import type { Currency } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import {
  applySubscriptionState,
  foundingSlotsUsed,
  getCoupleByStripeCustomer,
  priceIdForCurrency,
  setStripeCustomerId,
  stripe,
} from "../domain/billing";
import { getCoupleForUser, toCoupleBilling } from "../domain/couples";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { getUserById } from "../domain/users";
import {
  type Ctx,
  HttpError,
  json,
  requireAuth,
  requireVerifiedAuth,
  type Router,
} from "../lib/http";

function normaliseCurrency(raw: string | null): Currency {
  return raw === "EUR" || raw === "USD" || raw === "HUF" ? raw : "HUF";
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

// ── GET /api/billing/status ─────────────────────────────────────────────────
function handleStatus(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const currency = normaliseCurrency(couple.currency);
  const body: BillingStatusResponse = {
    enabled: STRIPE_ENABLED,
    billing: toCoupleBilling(couple),
    currency,
    price: MONTHLY_PRICE[currency],
    founding_spots_left: Math.max(0, FOUNDING_CAP - foundingSlotsUsed()),
    has_partner: couple.partner_b_id != null,
  };
  return json(body);
}

// ── POST /api/billing/checkout ──────────────────────────────────────────────
async function handleCheckout(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const user = getUserById(userId);
  const currency = normaliseCurrency(couple.currency);

  // Reuse the couple's Stripe customer across re-subscribes so payment history
  // and the portal stay on one record.
  let customerId = couple.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: user?.email ?? undefined,
      name: couple.display_name,
      metadata: { couple_id: String(couple.id) },
    });
    customerId = customer.id;
    setStripeCustomerId(couple.id, customerId);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForCurrency(currency), quantity: 1 }],
    // Stamp the couple id on BOTH the session and the subscription so the
    // webhook can resolve the couple from either object.
    subscription_data: { metadata: { couple_id: String(couple.id) } },
    client_reference_id: String(couple.id),
    metadata: { couple_id: String(couple.id) },
    allow_promotion_codes: true,
    success_url: `${CONFIG.frontendBaseUrl}/app/settings/billing?checkout=success`,
    cancel_url: `${CONFIG.frontendBaseUrl}/app/settings/billing?checkout=cancel`,
  });
  // Top-of-funnel signal: the couple reached the Stripe pay screen. Recorded
  // after the session mints so a Stripe hiccup doesn't inflate the count.
  recordGrowthEventFromRequest("checkout.started", ctx.req, {
    couple_id: couple.id,
    user_id: userId,
  });
  return json({ url: session.url });
}

// ── POST /api/billing/portal ────────────────────────────────────────────────
async function handlePortal(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  if (!couple.stripe_customer_id) {
    throw new HttpError(400, "No subscription to manage", { code: "no_customer" });
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: couple.stripe_customer_id,
    return_url: `${CONFIG.frontendBaseUrl}/app/settings/billing`,
  });
  return json({ url: session.url });
}

// ── POST /api/billing/webhook ───────────────────────────────────────────────
function resolveCoupleId(sub: Stripe.Subscription): number | null {
  const fromMeta = Number(sub.metadata?.couple_id);
  if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  if (sub.customer) {
    const couple = getCoupleByStripeCustomer(String(sub.customer));
    if (couple) return couple.id;
  }
  return null;
}

async function handleWebhook(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED || !CONFIG.stripeWebhookSecret) {
    throw new HttpError(503, "Billing webhook not configured");
  }
  const sig = ctx.req.headers.get("stripe-signature");
  if (!sig) throw new HttpError(400, "Missing stripe-signature header");
  const raw = await ctx.req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, sig, CONFIG.stripeWebhookSecret);
  } catch {
    throw new HttpError(400, "Invalid webhook signature");
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const coupleId = Number(s.metadata?.couple_id ?? s.client_reference_id);
      if (Number.isInteger(coupleId) && coupleId > 0) {
        if (s.customer) setStripeCustomerId(coupleId, String(s.customer));
        if (s.subscription) {
          const sub = await stripe().subscriptions.retrieve(String(s.subscription));
          applySubscriptionState(coupleId, {
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
      const coupleId = resolveCoupleId(sub);
      if (coupleId) {
        applySubscriptionState(coupleId, {
          subscriptionId: sub.id,
          stripeStatus: sub.status,
          currentPeriodEnd: periodEndMs(sub),
        });
      }
      break;
    }
    default:
      // Ignore the long tail of event types — we only act on the lifecycle ones.
      break;
  }
  return json({ received: true });
}

export function registerBillingRoutes(router: Router) {
  router.get("/api/billing/status", handleStatus, true);
  router.post("/api/billing/checkout", handleCheckout, true);
  router.post("/api/billing/portal", handlePortal, true);
  // Public: authenticated by the Stripe signature, not a session bearer.
  router.post("/api/billing/webhook", handleWebhook, false);
}
