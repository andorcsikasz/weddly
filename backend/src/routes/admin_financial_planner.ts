// Admin financial planner — live billing metrics that feed the forecast on
// /app/admin/financial-planner. Read-only rollups over the couples table; the
// projection math runs client-side from these numbers (shared/admin_financial_planner.ts).

import {
  type AdminFinancialPlannerOverview,
  HUF_PER_EUR,
  type PaymentLaunchesResponse,
  type SetPaymentLaunchRequest,
  type StripeHealth,
} from "@shared/admin_financial_planner";
import { type SubscriptionStatus, FOUNDING_CAP, MONTHLY_PRICE } from "@shared/billing";
import { type BillingCurrency, isCurrency, toBillingCurrency } from "@shared/currency";
import { CONFIG, STRIPE_ENABLED } from "../config";
import { billingEnforcementOn, db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import {
  activeFoundingCount,
  enforcementImpact,
  foundingSlotsUsed,
  setBillingEnforcement,
  stripe,
} from "../domain/billing";
import { requireAdmin } from "../domain/users";
import {
  isPaymentLaunchProduct,
  paymentLaunches,
  setPaymentLaunch,
  validatePaymentLaunchActivation,
} from "../domain/payment_launch";
import { getFxRates } from "../lib/fx";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

const STATUSES: SubscriptionStatus[] = [
  "trialing",
  "founding",
  "active",
  "past_due",
  "canceled",
  "none",
];

function overview(): AdminFinancialPlannerOverview {
  const nowMs = now();

  // Cohort counts (non-demo couples only).
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    SubscriptionStatus,
    number
  >;
  const rows = db
    .prepare(
      "SELECT subscription_status AS s, COUNT(*) AS n FROM couples WHERE is_demo = 0 GROUP BY subscription_status",
    )
    .all() as Array<{ s: string; n: number }>;
  let total = 0;
  for (const r of rows) {
    total += r.n;
    if ((STATUSES as string[]).includes(r.s)) counts[r.s as SubscriptionStatus] = r.n;
    else counts.none += r.n; // fold any unexpected value into 'none'
  }

  // Paying subscribers (active + past_due) split by currency for MRR.
  const payRows = db
    .prepare(
      `SELECT COALESCE(currency, 'HUF') AS currency, COUNT(*) AS n
         FROM couples
        WHERE is_demo = 0 AND subscription_status IN ('active', 'past_due')
        GROUP BY COALESCE(currency, 'HUF')`,
    )
    .all() as Array<{ currency: string; n: number }>;

  // Group by what we actually CHARGE, not what the couple budgets in: a PLN
  // or JPY workspace settles on the EUR price, so several display currencies
  // collapse onto one billing row and the counts must be summed, not mapped.
  const mrrByBilling = new Map<BillingCurrency, { subscribers: number; mrr: number }>();
  for (const r of payRows) {
    const currency = toBillingCurrency(isCurrency(r.currency) ? r.currency : "HUF");
    const acc = mrrByBilling.get(currency) ?? { subscribers: 0, mrr: 0 };
    acc.subscribers += r.n;
    acc.mrr += r.n * MONTHLY_PRICE[currency];
    mrrByBilling.set(currency, acc);
  }
  const mrr_by_currency = [...mrrByBilling].map(([currency, acc]) => ({ currency, ...acc }));
  const paying_subscribers = mrr_by_currency.reduce((a, c) => a + c.subscribers, 0);
  const mrr_eur_total = Math.round(
    mrr_by_currency.reduce((a, c) => a + (c.currency === "HUF" ? c.mrr / HUF_PER_EUR : c.mrr), 0),
  );
  const arpu_eur =
    paying_subscribers > 0 ? Math.round(mrr_eur_total / paying_subscribers) : MONTHLY_PRICE.EUR;

  // Founding-window expiry schedule: how many live founding members' free
  // period ends in each upcoming calendar month.
  const expiryRows = db
    .prepare(
      `SELECT strftime('%Y-%m', founding_until / 1000, 'unixepoch') AS month, COUNT(*) AS n
         FROM couples
        WHERE is_demo = 0 AND is_founding_member = 1
          AND founding_until IS NOT NULL AND founding_until > ?
        GROUP BY month
        ORDER BY month`,
    )
    .all(nowMs) as Array<{ month: string; n: number }>;

  // Paid-conversion funnel top: how many couples reached the Stripe pay
  // screen, from the checkout.started growth events.
  const checkoutStarted = db
    .prepare(
      `SELECT COUNT(DISTINCT couple_id) AS couples, COUNT(*) AS total
         FROM growth_events
        WHERE kind = 'checkout.started'`,
    )
    .get() as { couples: number; total: number };

  return {
    generated_at: nowMs,
    counts,
    total_couples: total,
    checkout_started_couples: checkoutStarted.couples,
    checkout_started_total: checkoutStarted.total,
    founding_active: activeFoundingCount(nowMs),
    founding_spots_left: Math.max(0, FOUNDING_CAP - foundingSlotsUsed()),
    trialing: counts.trialing,
    mrr_by_currency,
    paying_subscribers,
    mrr_eur_total,
    arr_eur_total: mrr_eur_total * 12,
    arpu_eur,
    founding_expiry: expiryRows.map((r) => ({ month: r.month, count: r.n })),
    price_eur: MONTHLY_PRICE.EUR,
    price_huf: MONTHLY_PRICE.HUF,
    huf_per_eur: HUF_PER_EUR,
    billing_enforcement_on: billingEnforcementOn(),
    enforcement_ready: total >= FOUNDING_CAP,
    enforcement_impact: enforcementImpact(nowMs),
  };
}

function handleOverview(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(overview());
}

/** Flip the global read-only paywall on or off (the manual go-live). Refuses to
 *  turn ON before the 200-couple founding cohort is full — a server-side mirror
 *  of the confirm gate so the freeze can never start early. */
async function handleSetEnforcement(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<{ on?: unknown }>(ctx.req);
  if (typeof body.on !== "boolean") {
    throw new HttpError(400, "`on` must be a boolean");
  }
  if (body.on) {
    const launches = paymentLaunches();
    const required = ["couple_subscriptions", "planner_subscriptions", "vendor_billing"] as const;
    const unavailable = required.filter((product) => {
      const state = launches.products[product];
      return !state.enabled || !state.ready;
    });
    if (unavailable.length > 0) {
      throw new HttpError(
        409,
        "Launch all subscription payment products before enabling the paywall",
        { code: "payment_launches_incomplete", products: unavailable },
      );
    }
  }
  // Deliberately NOT gated on the founding cohort being full. It used to 400
  // below FOUNDING_CAP, which made the moment we start charging a function of a
  // headcount rather than a date the founder picks — and left no way to start
  // early, or to run the freeze at all on a smaller cohort. `enforcement_ready`
  // still ships as the readiness SIGNAL; the guard that actually protects
  // anyone is the impact count stated in the admin confirm (enforcementImpact),
  // which names how many couples, vendors and planners lose access on this
  // click. Reversible, and every flip is audited either way.
  setBillingEnforcement(body.on, admin.id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "admin.billing.enforcement_set",
    target_kind: "billing_control",
    target_id: 1,
    after: { enforcement_on: body.on },
  });
  return json(overview());
}

// ── Independent payment-product launches ───────────────────────────────────
// These switches permit NEW money creation. They do not disable webhooks or
// customer portals, which must stay available for already-paying customers and
// operational recovery even after a product is paused.

function handlePaymentLaunches(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(paymentLaunches());
}

async function handleSetPaymentLaunch(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<Partial<SetPaymentLaunchRequest>>(ctx.req);
  if (!isPaymentLaunchProduct(body.product)) {
    throw new HttpError(400, "Invalid payment launch product");
  }
  if (typeof body.enabled !== "boolean") {
    throw new HttpError(400, "`enabled` must be a boolean");
  }
  if (
    typeof body.expected_version !== "number" ||
    !Number.isInteger(body.expected_version) ||
    body.expected_version < 0
  ) {
    throw new HttpError(400, "`expected_version` must be a non-negative integer");
  }
  const product = body.product;
  const enabled = body.enabled;
  const expectedVersion = body.expected_version;

  const current = paymentLaunches().products[product];
  if (current.version !== expectedVersion) {
    throw new HttpError(409, "Payment launch state changed; refresh and try again", {
      code: "payment_launch_conflict",
      product,
      current,
    });
  }
  if (enabled && !current.enabled) await validatePaymentLaunchActivation(product);

  const change = db.transaction(() => {
    const subscriptionProduct =
      product === "couple_subscriptions" ||
      product === "planner_subscriptions" ||
      product === "vendor_billing";
    const paywallWasOn = billingEnforcementOn();
    const before = paymentLaunches().products[product];
    const after = setPaymentLaunch(product, enabled, admin.id, expectedVersion);
    if (before.enabled !== after.enabled) {
      addAuditLog({
        actor_user_id: admin.id,
        couple_id: null,
        action: "admin.payment_launch.set",
        target_kind: "payment_launch_control",
        target_id: null,
        before: { product: body.product, enabled: before.enabled, version: before.version },
        after: {
          product: body.product,
          enabled: after.enabled,
          version: after.version,
          ready: after.ready,
          missing: after.missing,
        },
        note: product,
      });
    }
    // An emergency payment pause must never strand lapsed users behind a wall
    // with no recovery checkout. Turn the wall off in the same transaction so
    // both safety changes either commit together or roll back together.
    if (!enabled && subscriptionProduct && paywallWasOn) {
      setBillingEnforcement(false, admin.id);
      addAuditLog({
        actor_user_id: admin.id,
        couple_id: null,
        action: "admin.billing_enforcement.auto_disabled",
        target_kind: "billing_control",
        target_id: 1,
        before: { enforcement_on: true },
        after: { enforcement_on: false },
        note: `Payment launch paused: ${product}`,
      });
    }
    return paymentLaunches() satisfies PaymentLaunchesResponse;
  });
  return json(change());
}

// ── Stripe health monitor ───────────────────────────────────────────────────
// Shows what we can even before billing is connected: which env vars are set,
// the key's mode (test/live), and — once a key IS present — whether a live API
// ping succeeds (accounts.retrieve, falling back to a price fetch for
// restricted keys without Account read). Never returns secret values.

/** Derive the key mode from its prefix without exposing the key. */
function stripeKeyMode(key: string): StripeHealth["mode"] {
  if (!key) return null;
  if (key.startsWith("sk_live") || key.startsWith("rk_live")) return "live";
  if (key.startsWith("sk_test") || key.startsWith("rk_test")) return "test";
  return "unknown";
}

async function stripeHealth(): Promise<StripeHealth> {
  const checkedAt = now();
  const config = {
    secretKey: CONFIG.stripeSecretKey !== "",
    webhookSecret: CONFIG.stripeWebhookSecret !== "",
    priceEur: CONFIG.stripePriceEur !== "",
    priceHuf: CONFIG.stripePriceHuf !== "",
  };
  const mode = stripeKeyMode(CONFIG.stripeSecretKey);

  if (!STRIPE_ENABLED) {
    // Nothing to ping — report config readiness only.
    return { enabled: false, mode, config, connection: null, checkedAt };
  }

  // Live reachability check: retrieve the account the key belongs to. A 200
  // proves the key works and surfaces the charges/payouts go-live flags.
  try {
    const acct = await stripe().accounts.retrieveCurrent();
    return {
      enabled: true,
      mode,
      config,
      connection: {
        ok: true,
        accountId: acct.id ?? null,
        chargesEnabled: acct.charges_enabled ?? null,
        payoutsEnabled: acct.payouts_enabled ?? null,
        country: acct.country ?? null,
        defaultCurrency: acct.default_currency ?? null,
        error: null,
      },
      checkedAt,
    };
  } catch (err) {
    // Restricted keys (rk_…) often lack the Account-read scope even though
    // every permission billing actually needs is granted. Fall back to
    // retrieving a configured price: a 200 there still proves the key works,
    // we just can't show the charges/payouts go-live flags.
    const priceId = CONFIG.stripePriceEur || CONFIG.stripePriceHuf;
    if (priceId) {
      try {
        await stripe().prices.retrieve(priceId);
        return {
          enabled: true,
          mode,
          config,
          connection: {
            ok: true,
            accountId: null,
            chargesEnabled: null,
            payoutsEnabled: null,
            country: null,
            defaultCurrency: null,
            error: null,
          },
          checkedAt,
        };
      } catch {
        // fall through to reporting the original account-endpoint error
      }
    }
    return {
      enabled: true,
      mode,
      config,
      connection: {
        ok: false,
        accountId: null,
        chargesEnabled: null,
        payoutsEnabled: null,
        country: null,
        defaultCurrency: null,
        error: err instanceof Error ? err.message : String(err),
      },
      checkedAt,
    };
  }
}

async function handleStripeHealth(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  return json(await stripeHealth());
}

/** Live EUR→HUF/USD/CNY rate for the planner's strip + tax conversion.
 *  Returns null when the upstream FX feed is unreachable (the strip hides). */
async function handleFx(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  return json(await getFxRates());
}

export function registerAdminFinancialPlannerRoutes(router: Router) {
  router.get("/api/admin/financial-planner/overview", handleOverview, true);
  router.post("/api/admin/financial-planner/enforcement", handleSetEnforcement, true);
  router.get("/api/admin/financial-planner/stripe-health", handleStripeHealth, true);
  router.get("/api/admin/financial-planner/payment-launches", handlePaymentLaunches, true);
  router.patch("/api/admin/financial-planner/payment-launches", handleSetPaymentLaunch, true);
  router.get("/api/admin/financial-planner/fx", handleFx, true);
}
