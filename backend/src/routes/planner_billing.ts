// Planner subscription billing endpoints: Stripe-hosted Checkout + Billing
// Portal, the planner's billing status, and a SEPARATE webhook (its own signing
// secret) that drives the planner state machine.
//
// Mirrors routes/billing.ts (couples), but keyed on the planner user + tier. The
// payment UI is entirely Stripe-hosted — we only mint redirect URLs and react to
// webhook events.

import type Stripe from "stripe";
import {
  type PlannerBillingStatus,
  PLANNER_TIER_PRICE,
  plannerCurrencyForLocale,
} from "@shared/planner_billing";
import type { Currency, PlannerPlan } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import { db } from "../db";
import { claimStripeEvent, stripe } from "../domain/billing";
import { isPlannerPlan } from "../domain/planner";
import {
  applyPlannerSubscriptionState,
  getPlannerByStripeCustomer,
  getPlannerSub,
  getPlannerTier,
  initPlannerBilling,
  plannerFoundingSpotsLeft,
  priceIdForPlannerTier,
  setPlannerStripeCustomerId,
  toPlannerBilling,
} from "../domain/planner_billing";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function requirePlannerAuth(ctx: Ctx): number {
  const userId = requireAuth(ctx);
  const user = db.prepare("SELECT user_type FROM users WHERE id = ?").get(userId) as
    | { user_type: string }
    | undefined;
  if (!user || user.user_type !== "planner") {
    throw new HttpError(403, "Planner account required");
  }
  return userId;
}

/** The planner's display currency, pinned on the sub row (fallback: locale). */
function plannerCurrency(userId: number): Currency {
  const sub = getPlannerSub(userId);
  if (sub?.currency === "HUF" || sub?.currency === "EUR" || sub?.currency === "USD") {
    return sub.currency;
  }
  const user = getUserById(userId);
  return plannerCurrencyForLocale(user?.locale);
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

/** Resolve the planner tier a subscription is for, from its line item price id. */
function tierOfSubscription(sub: Stripe.Subscription): PlannerPlan | null {
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  for (const tier of ["starter", "pro", "premium"] as const) {
    const perTier = CONFIG.stripePricePlanner[tier];
    if (priceId === perTier.EUR || priceId === perTier.HUF) return tier;
  }
  return null;
}

// ── GET /api/planner/billing ────────────────────────────────────────────────
function handleStatus(ctx: Ctx): Response {
  const userId = requirePlannerAuth(ctx);
  // A planner should always have a sub row (granted at account creation); init
  // lazily so pre-existing sessions never 500 here.
  const sub = getPlannerSub(userId) ?? initPlannerBilling(userId);
  const currency = plannerCurrency(userId);
  const tier = getPlannerTier(userId);
  const prices: Record<PlannerPlan, number> = {
    starter: PLANNER_TIER_PRICE.starter[currency] ?? PLANNER_TIER_PRICE.starter.EUR,
    pro: PLANNER_TIER_PRICE.pro[currency] ?? PLANNER_TIER_PRICE.pro.EUR,
    premium: PLANNER_TIER_PRICE.premium[currency] ?? PLANNER_TIER_PRICE.premium.EUR,
  };
  const body: PlannerBillingStatus = {
    enabled: STRIPE_ENABLED,
    billing: toPlannerBilling(sub, tier),
    currency,
    prices,
    founding_spots_left: plannerFoundingSpotsLeft(),
  };
  return json(body);
}

// ── POST /api/planner/billing/checkout ──────────────────────────────────────
async function handleCheckout(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const body = await readJson<{ tier?: unknown }>(ctx.req);
  if (!isPlannerPlan(body.tier)) {
    throw new HttpError(400, "`tier` must be 'starter', 'pro', or 'premium'");
  }
  const tier = body.tier;
  const user = getUserById(userId);
  const currency = plannerCurrency(userId);
  const sub = getPlannerSub(userId) ?? initPlannerBilling(userId);

  // Reuse the planner's Stripe customer across re-subscribes so payment history
  // and the portal stay on one record.
  let customerId = sub.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: user?.email ?? undefined,
      name: user?.full_name ?? undefined,
      metadata: { planner_user_id: String(userId) },
    });
    customerId = customer.id;
    setPlannerStripeCustomerId(userId, customerId);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForPlannerTier(tier, currency), quantity: 1 }],
    // Stamp the planner id on BOTH the session and the subscription so the
    // webhook can resolve the planner from either object.
    subscription_data: { metadata: { planner_user_id: String(userId) } },
    client_reference_id: String(userId),
    metadata: { planner_user_id: String(userId) },
    allow_promotion_codes: true,
    success_url: `${CONFIG.frontendBaseUrl}/app/planner/billing?checkout=success`,
    cancel_url: `${CONFIG.frontendBaseUrl}/app/planner/billing?checkout=cancel`,
  });
  return json({ url: session.url });
}

// ── POST /api/planner/billing/portal ────────────────────────────────────────
async function handlePortal(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const sub = getPlannerSub(userId);
  if (!sub?.stripe_customer_id) {
    throw new HttpError(400, "No subscription to manage", { code: "no_customer" });
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${CONFIG.frontendBaseUrl}/app/planner/billing`,
  });
  return json({ url: session.url });
}

// ── POST /api/planner/billing/webhook ───────────────────────────────────────
function resolvePlannerId(sub: Stripe.Subscription): number | null {
  const fromMeta = Number(sub.metadata?.planner_user_id);
  if (Number.isInteger(fromMeta) && fromMeta > 0) return fromMeta;
  if (sub.customer) return getPlannerByStripeCustomer(String(sub.customer));
  return null;
}

async function handleWebhook(ctx: Ctx): Promise<Response> {
  if (!STRIPE_ENABLED || !CONFIG.stripePlannerWebhookSecret) {
    throw new HttpError(503, "Planner billing webhook not configured");
  }
  const sig = ctx.req.headers.get("stripe-signature");
  if (!sig) throw new HttpError(400, "Missing stripe-signature header");
  const raw = await ctx.req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      raw,
      sig,
      CONFIG.stripePlannerWebhookSecret,
    );
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
      const plannerId = Number(s.metadata?.planner_user_id ?? s.client_reference_id);
      if (Number.isInteger(plannerId) && plannerId > 0) {
        if (s.customer) setPlannerStripeCustomerId(plannerId, String(s.customer));
        if (s.subscription) {
          const sub = await stripe().subscriptions.retrieve(String(s.subscription));
          applyPlannerSubscriptionState(plannerId, {
            subscriptionId: sub.id,
            stripeStatus: sub.status,
            currentPeriodEnd: periodEndMs(sub),
            tier: tierOfSubscription(sub),
          });
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const plannerId = resolvePlannerId(sub);
      if (plannerId) {
        applyPlannerSubscriptionState(plannerId, {
          subscriptionId: sub.id,
          stripeStatus: sub.status,
          currentPeriodEnd: periodEndMs(sub),
          tier: tierOfSubscription(sub),
        });
      }
      break;
    }
    default:
      break;
  }
  return json({ received: true });
}

export function registerPlannerBillingRoutes(router: Router) {
  router.get("/api/planner/billing", handleStatus, true);
  router.post("/api/planner/billing/checkout", handleCheckout, true);
  router.post("/api/planner/billing/portal", handlePortal, true);
  // Public: authenticated by the Stripe signature, not a session bearer.
  router.post("/api/planner/billing/webhook", handleWebhook, false);
}
