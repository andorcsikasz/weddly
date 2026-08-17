// Subscription billing endpoints: Stripe-hosted Checkout + Billing Portal, the
// couple's billing status, and the webhook that drives the state machine.
//
// The payment UI is entirely Stripe-hosted (see CLAUDE.md decision) — we only
// mint redirect URLs and react to webhook events. No card data touches us.

import type Stripe from "stripe";
import {
  type BillingStatusResponse,
  FOUNDING_CAP,
  monthlyPrice,
  type PaymentMethodResponse,
} from "@shared/billing";
import { isCurrency } from "@shared/currency";
import { COUPLE_SUBSCRIPTION_TERMS_VERSION } from "@shared/legal";
import type { Currency } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import {
  applySubscriptionState,
  claimStripeEvent,
  foundingSlotsUsed,
  getCoupleByStripeCustomer,
  guestPageAddonPriceId,
  markGuestPagePrepaid,
  priceIdForCurrency,
  releaseStripeEvent,
  setStripeCustomerId,
  stripe,
} from "../domain/billing";
import { billingAnchorRow, getCoupleForUser, toCoupleBilling } from "../domain/couples";
import { hasAcceptedCurrentVersion, recordConsent } from "../domain/consents";
import { activateFilmAlbum } from "../domain/film";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { getUserById } from "../domain/users";
import { paymentProductAvailable, requirePaymentLaunch } from "../domain/payment_launch";
import { addAuditLog } from "../lib/audit";
import {
  type Ctx,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireVerifiedAuth,
  type Router,
} from "../lib/http";

function normaliseCurrency(raw: string | null): Currency {
  return isCurrency(raw) ? raw : "HUF";
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
    checkout_enabled: paymentProductAvailable("couple_subscriptions"),
    guest_page_addon_checkout_enabled: paymentProductAvailable("guest_page_addon"),
    billing: toCoupleBilling(couple),
    currency,
    price: monthlyPrice(currency),
    founding_spots_left: Math.max(0, FOUNDING_CAP - foundingSlotsUsed()),
    has_partner: couple.partner_b_id != null,
    subscription_terms_accepted: hasAcceptedCurrentVersion(
      userId,
      "couple_subscription_terms",
      COUPLE_SUBSCRIPTION_TERMS_VERSION,
    ),
    subscription_terms_version: COUPLE_SUBSCRIPTION_TERMS_VERSION,
  };
  return json(body);
}

// ── POST /api/billing/checkout ──────────────────────────────────────────────
async function handleCheckout(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const workspace = getCoupleForUser(userId);
  if (!workspace) throw new HttpError(400, "No couple workspace yet");
  // Multi-workspace owners share one billing anchor. Checkout, customer reuse,
  // and the duplicate guard must all resolve against that same row or a
  // secondary wedding could create a second subscription for the same owner.
  const couple = billingAnchorRow(workspace);
  const status = couple.subscription_status;
  const hasLiveStripeSubscription =
    couple.stripe_subscription_id !== null && status !== "canceled" && status !== "none";
  if (status === "active" || status === "past_due" || hasLiveStripeSubscription) {
    throw new HttpError(409, "Already subscribed; manage the existing subscription", {
      code: "already_subscribed",
    });
  }
  requirePaymentLaunch("couple_subscriptions");
  if (
    !hasAcceptedCurrentVersion(
      userId,
      "couple_subscription_terms",
      COUPLE_SUBSCRIPTION_TERMS_VERSION,
    )
  ) {
    const body = await readJson<{ terms_version?: unknown }>(ctx.req);
    if (body.terms_version !== COUPLE_SUBSCRIPTION_TERMS_VERSION) {
      throw new HttpError(400, "Subscription terms must be accepted to continue", {
        code: "terms_not_accepted",
        terms_version: COUPLE_SUBSCRIPTION_TERMS_VERSION,
      });
    }
    recordConsent({
      subjectUserId: userId,
      subjectKind: "user",
      subjectRef: null,
      document: "couple_subscription_terms",
      version: COUPLE_SUBSCRIPTION_TERMS_VERSION,
      ip: ctx.clientIp,
      userAgent: ctx.req.headers.get("user-agent"),
    });
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "couple.subscription_terms_accepted",
      target_kind: "couple",
      target_id: couple.id,
      after: { subscription_terms_version: COUPLE_SUBSCRIPTION_TERMS_VERSION },
    });
  }
  const user = getUserById(userId);
  const currency = normaliseCurrency(couple.currency);

  // Reuse the couple's Stripe customer across re-subscribes so payment history
  // and the portal stay on one record.
  let customerId = couple.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create(
      {
        email: user?.email ?? undefined,
        name: couple.display_name,
        metadata: { couple_id: String(couple.id) },
      },
      { idempotencyKey: `couple-customer-${couple.id}` },
    );
    customerId = customer.id;
    setStripeCustomerId(couple.id, customerId);
  }

  const session = await stripe().checkout.sessions.create(
    {
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
    },
    {
      idempotencyKey: `couple-checkout-${couple.id}-${couple.subscription_status}-${couple.stripe_subscription_id ?? "none"}`,
    },
  );
  // Top-of-funnel signal: the couple reached the Stripe pay screen. Recorded
  // after the session mints so a Stripe hiccup doesn't inflate the count.
  recordGrowthEventFromRequest("checkout.started", ctx.req, {
    couple_id: couple.id,
    user_id: userId,
  });
  return json({ url: session.url });
}

// ── POST /api/billing/guest-page-addon/checkout ─────────────────────────────
/** One-time 70%-off checkout for a planner-managed couple to buy back editing
 *  of their own guest page (vendégoldal). On success the webhook marks the
 *  couple `guest_page_prepaid`; the planner then switches the add-on on. */
async function handleGuestPageAddonCheckout(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const billing = toCoupleBilling(couple);
  if (!billing.planner_managed || billing.entitled) {
    throw new HttpError(409, "Guest-page add-on is only available in planner-managed viewer mode", {
      code: "addon_not_available",
    });
  }
  if (couple.guest_page_prepaid) {
    throw new HttpError(400, "Guest-page add-on is already paid", { code: "already_paid" });
  }
  requirePaymentLaunch("guest_page_addon");
  const currency = normaliseCurrency(couple.currency);
  const priceId = guestPageAddonPriceId(currency);
  const user = getUserById(userId);
  let customerId = couple.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create(
      {
        email: user?.email ?? undefined,
        name: couple.display_name,
        metadata: { couple_id: String(couple.id) },
      },
      { idempotencyKey: `couple-customer-${couple.id}` },
    );
    customerId = customer.id;
    setStripeCustomerId(couple.id, customerId);
  }
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(couple.id),
      metadata: { type: "guest_page_addon", couple_id: String(couple.id) },
      success_url: `${CONFIG.frontendBaseUrl}/app/guest-page?addon=success`,
      cancel_url: `${CONFIG.frontendBaseUrl}/app/guest-page?addon=cancel`,
    },
    { idempotencyKey: `guest-page-addon-checkout-${couple.id}-unpaid` },
  );
  return json({ url: session.url });
}

// ── POST /api/billing/portal ────────────────────────────────────────────────
async function handlePortal(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const workspace = getCoupleForUser(userId);
  if (!workspace) throw new HttpError(400, "No couple workspace yet");
  const couple = billingAnchorRow(workspace);
  if (!couple.stripe_customer_id) {
    throw new HttpError(400, "No subscription to manage", { code: "no_customer" });
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: couple.stripe_customer_id,
    return_url: `${CONFIG.frontendBaseUrl}/app/settings/billing`,
  });
  return json({ url: session.url });
}

// ── GET /api/billing/payment-method ─────────────────────────────────────────
/** Read-only brand/last-4/expiry of the card Stripe will charge, for the
 *  in-app "card on file" line. We fetch it from Stripe on demand and store
 *  nothing — the source of truth (and every mutation) stays in the portal.
 *  Returns `{ card: null }` (never an error) whenever there is nothing to show:
 *  Stripe off, no customer yet (trial/founding), or no attached card. */
async function handlePaymentMethod(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const workspace = getCoupleForUser(userId);
  if (!workspace) throw new HttpError(400, "No couple workspace yet");
  const couple = billingAnchorRow(workspace);
  const empty: PaymentMethodResponse = { card: null };
  if (!STRIPE_ENABLED || !couple.stripe_customer_id) return json(empty);

  try {
    const customer = await stripe().customers.retrieve(couple.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return json(empty);

    // Prefer the customer's default PM (what future invoices charge); fall back
    // to the newest attached card so a card saved at checkout still shows even
    // before Stripe stamps it as the invoice default.
    let pm = customer.invoice_settings?.default_payment_method as
      | Stripe.PaymentMethod
      | string
      | null
      | undefined;
    if (!pm || typeof pm === "string") {
      const cards = await stripe().paymentMethods.list({
        customer: couple.stripe_customer_id,
        type: "card",
        limit: 1,
      });
      pm = cards.data[0];
    }
    if (!pm || typeof pm === "string" || !pm.card) return json(empty);

    const c = pm.card;
    const payload: PaymentMethodResponse = {
      card: {
        brand: c.brand,
        last4: c.last4,
        exp_month: c.exp_month,
        exp_year: c.exp_year,
      },
    };
    return json(payload);
  } catch (e) {
    // A Stripe hiccup must not break the billing tab — degrade to "no card".
    ctx.log.warn("billing.payment_method_fetch_failed", { error: String(e) });
    return json(empty);
  }
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

  // Idempotency: Stripe delivers at-least-once (auto-retries + manual resend),
  // so a stale subscription.updated/deleted could re-apply old state and, e.g.,
  // flip a canceled couple back to active. Claim the event id AFTER the
  // signature check (so only genuine events can write) and skip if we've already
  // processed it. claimStripeEvent is INSERT OR IGNORE + changes(), atomic.
  if (!claimStripeEvent(event.id, event.type, "couple")) {
    return json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        // Guest-page add-on one-time payment (planner-managed couple buys back
        // editing of their own guest page). Marks the 30% prepayment so the
        // planner can switch the add-on on.
        if (s.metadata?.type === "guest_page_addon") {
          if (s.payment_status !== "paid") break;
          const coupleId = Number(s.metadata.couple_id ?? s.client_reference_id);
          if (Number.isInteger(coupleId) && coupleId > 0) markGuestPagePrepaid(coupleId);
          break;
        }

        // Film one-time payment — separate path from the subscription flow.
        if (s.metadata?.type === "film") {
          if (s.payment_status !== "paid") break;
          const albumId = Number(s.metadata.album_id);
          if (Number.isInteger(albumId) && albumId > 0) {
            const paymentIntentId = s.payment_intent ? String(s.payment_intent) : null;
            activateFilmAlbum(albumId, paymentIntentId);
          }
          break;
        }

        // Subscription flow (default).
        const coupleId = Number(s.metadata?.couple_id ?? s.client_reference_id);
        if (Number.isInteger(coupleId) && coupleId > 0) {
          if (s.customer) setStripeCustomerId(coupleId, String(s.customer));
          if (s.subscription) {
            const sub = await stripe().subscriptions.retrieve(String(s.subscription));
            applySubscriptionState(coupleId, {
              subscriptionId: sub.id,
              stripeStatus: sub.status,
              currentPeriodEnd: periodEndMs(sub),
              observedAt: event.created * 1000,
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
            observedAt: event.created * 1000,
          });
        }
        break;
      }
      default:
        // Ignore the long tail of event types — we only act on the lifecycle ones.
        break;
    }
  } catch (error) {
    releaseStripeEvent(event.id, "couple");
    throw error;
  }
  return json({ received: true });
}

export function registerBillingRoutes(router: Router) {
  router.get("/api/billing/status", handleStatus, true);
  router.post("/api/billing/checkout", handleCheckout, true);
  router.post("/api/billing/guest-page-addon/checkout", handleGuestPageAddonCheckout, true);
  router.post("/api/billing/portal", handlePortal, true);
  router.get("/api/billing/payment-method", handlePaymentMethod, true);
  // Public: authenticated by the Stripe signature, not a session bearer.
  router.post("/api/billing/webhook", handleWebhook, false);
}
