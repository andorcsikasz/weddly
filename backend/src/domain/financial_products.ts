// Financial planner rollups for every revenue line that is not the couple
// subscription: vendor and planner subscriptions, the camera (film) unlock and
// the planner-managed guest-page add-on. Read-only. Each figure answers two
// questions: what the product earns now, and what it currently OWES its
// customers (free windows promised, free leads owed, paid service not yet
// delivered), because the second is the part that does not show up in Stripe.

import {
  type AdminProductsOverview,
  type CameraProductOverview,
  type CurrencyMrr,
  type FoundingExpiryBucket,
  HU_VAT_RATE,
  HUF_PER_EUR,
  type OneOffProductOverview,
  type PlannerProductOverview,
  type VendorProductOverview,
} from "@shared/admin_financial_planner";
import { GUEST_PAGE_ADDON_PRICE } from "@shared/billing";
import { type BillingCurrency, isCurrency, toBillingCurrency } from "@shared/currency";
import { PLANNER_FOUNDING_CAP, PLANNER_TIER_PRICE } from "@shared/planner_billing";
import { FILM_TIER_PRICE_EUR_CENTS, type PlannerPlan } from "@shared/types";
import {
  VENDOR_EARLY_CAP,
  VENDOR_FOUNDING_CAP,
  VENDOR_FREE_LEAD_CREDITS,
  VENDOR_MONTHLY_PRICE,
} from "@shared/vendor_billing";
import { db } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;

function toEur(amount: number, currency: BillingCurrency): number {
  return currency === "HUF" ? amount / HUF_PER_EUR : amount;
}

function billingCurrencyOf(raw: string | null): BillingCurrency {
  return toBillingCurrency(raw && isCurrency(raw) ? raw : "EUR");
}

/** Monthly-equivalent revenue of one paying row. An annual subscriber pays
 *  nine months' price once a year, so a twelfth of that is what they add to
 *  MRR; counting them at the monthly price would overstate it by a third. */
function monthlyShare(monthlyPrice: number, interval: string | null): number {
  return interval === "year" ? (monthlyPrice * 9) / 12 : monthlyPrice;
}

function addMrr(
  acc: Map<BillingCurrency, { subscribers: number; mrr: number }>,
  currency: BillingCurrency,
  amount: number,
) {
  const row = acc.get(currency) ?? { subscribers: 0, mrr: 0 };
  row.subscribers += 1;
  row.mrr += amount;
  acc.set(currency, row);
}

function mrrRows(acc: Map<BillingCurrency, { subscribers: number; mrr: number }>): CurrencyMrr[] {
  return [...acc].map(([currency, r]) => ({
    currency,
    subscribers: r.subscribers,
    mrr: Math.round(r.mrr),
  }));
}

function sumEur(rows: CurrencyMrr[]): number {
  return Math.round(rows.reduce((a, r) => a + toEur(r.mrr, r.currency), 0));
}

function expiryBuckets(untils: number[]): FoundingExpiryBucket[] {
  const byMonth = new Map<string, number>();
  for (const ms of untils) {
    const month = new Date(ms).toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  return [...byMonth]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

interface SubRow {
  subscription_status: string;
  founding_until: number | null;
  currency: string | null;
  billing_interval: string | null;
}

const isPaying = (s: string) => s === "active" || s === "past_due";

// ── Vendors ────────────────────────────────────────────────────────────────

function vendorsOverview(nowMs: number): VendorProductOverview {
  const rows = db
    .prepare(
      `SELECT subscription_status, founding_until, currency, billing_interval,
              is_founding_member, is_early_member, lead_credits_used, billing_starts_at
         FROM vendor_subscriptions`,
    )
    .all() as Array<
    SubRow & {
      is_founding_member: number;
      is_early_member: number;
      lead_credits_used: number;
      billing_starts_at: number | null;
    }
  >;

  const counts: Record<string, number> = {};
  const mrr = new Map<BillingCurrency, { subscribers: number; mrr: number }>();
  let annual = 0;
  let foundingActive = 0;
  let earlyActive = 0;
  let foundingValue = 0;
  const untils: number[] = [];
  let leadWindow = 0;
  let creditsOwed = 0;
  let scheduled = 0;
  let scheduledMrr = 0;

  for (const r of rows) {
    counts[r.subscription_status] = (counts[r.subscription_status] ?? 0) + 1;
    const currency = billingCurrencyOf(r.currency);
    const price = VENDOR_MONTHLY_PRICE[currency];
    if (isPaying(r.subscription_status)) {
      addMrr(mrr, currency, monthlyShare(price, r.billing_interval));
      if (r.billing_interval === "year") annual++;
    }
    if (
      r.subscription_status === "founding" &&
      r.founding_until !== null &&
      r.founding_until > nowMs
    ) {
      foundingActive++;
      if (r.is_early_member === 1) earlyActive++;
      foundingValue += toEur(price, currency);
      untils.push(r.founding_until);
    }
    if (r.subscription_status === "lead_window") {
      leadWindow++;
      if (r.billing_starts_at !== null && r.billing_starts_at > nowMs) {
        scheduled++;
        scheduledMrr += toEur(price, currency);
      } else if (r.billing_starts_at === null) {
        creditsOwed += Math.max(0, VENDOR_FREE_LEAD_CREDITS - r.lead_credits_used);
      }
    }
  }

  const foundingUsed = rows.filter((r) => r.is_founding_member === 1).length;
  const earlyUsed = rows.filter((r) => r.is_early_member === 1).length;
  const mrrByCurrency = mrrRows(mrr);
  return {
    counts,
    total: rows.length,
    paying: mrrByCurrency.reduce((a, r) => a + r.subscribers, 0),
    annual,
    mrr_by_currency: mrrByCurrency,
    mrr_eur: sumEur(mrrByCurrency),
    founding_active: foundingActive,
    // The next free rung a new vendor would get: founding first, then early.
    founding_spots_left:
      Math.max(0, VENDOR_FOUNDING_CAP - foundingUsed) + Math.max(0, VENDOR_EARLY_CAP - earlyUsed),
    founding_value_eur: Math.round(foundingValue),
    founding_expiry: expiryBuckets(untils),
    trialing: counts.trialing ?? 0,
    list_price_eur: VENDOR_MONTHLY_PRICE.EUR,
    early_active: earlyActive,
    lead_window: leadWindow,
    lead_credits_owed: creditsOwed,
    billing_scheduled: scheduled,
    billing_scheduled_mrr_eur: Math.round(scheduledMrr),
  };
}

// ── Planners ───────────────────────────────────────────────────────────────

/** `users.planner_plan` still holds the pre-rename values on old rows. */
function plannerTier(raw: string | null): PlannerPlan {
  if (raw === "pro") return "pro";
  if (raw === "premium" || raw === "unlimited") return "premium";
  return "starter";
}

function plannersOverview(nowMs: number): PlannerProductOverview {
  const rows = db
    .prepare(
      `SELECT ps.subscription_status, ps.founding_until, ps.currency, ps.billing_interval,
              ps.is_founding_member, u.planner_plan
         FROM planner_subscriptions ps
         JOIN users u ON u.id = ps.user_id`,
    )
    .all() as Array<SubRow & { is_founding_member: number; planner_plan: string | null }>;

  const counts: Record<string, number> = {};
  const mrr = new Map<BillingCurrency, { subscribers: number; mrr: number }>();
  const payingByTier: Record<PlannerPlan, number> = { starter: 0, pro: 0, premium: 0 };
  let annual = 0;
  let foundingActive = 0;
  let foundingValue = 0;
  const untils: number[] = [];

  for (const r of rows) {
    counts[r.subscription_status] = (counts[r.subscription_status] ?? 0) + 1;
    const currency = billingCurrencyOf(r.currency);
    const tier = plannerTier(r.planner_plan);
    const price = PLANNER_TIER_PRICE[tier][currency];
    if (isPaying(r.subscription_status)) {
      addMrr(mrr, currency, monthlyShare(price, r.billing_interval));
      payingByTier[tier]++;
      if (r.billing_interval === "year") annual++;
    }
    if (
      r.subscription_status === "founding" &&
      r.founding_until !== null &&
      r.founding_until > nowMs
    ) {
      foundingActive++;
      foundingValue += toEur(price, currency);
      untils.push(r.founding_until);
    }
  }

  const foundingUsed = rows.filter((r) => r.is_founding_member === 1).length;
  const mrrByCurrency = mrrRows(mrr);
  return {
    counts,
    total: rows.length,
    paying: mrrByCurrency.reduce((a, r) => a + r.subscribers, 0),
    annual,
    mrr_by_currency: mrrByCurrency,
    mrr_eur: sumEur(mrrByCurrency),
    founding_active: foundingActive,
    founding_spots_left: Math.max(0, PLANNER_FOUNDING_CAP - foundingUsed),
    founding_value_eur: Math.round(foundingValue),
    founding_expiry: expiryBuckets(untils),
    trialing: counts.trialing ?? 0,
    // The entry tier: a forecast should not assume planners buy up.
    list_price_eur: PLANNER_TIER_PRICE.starter.EUR,
    paying_by_tier: payingByTier,
  };
}

// ── Camera (film unlock) ───────────────────────────────────────────────────

function cameraOverview(nowMs: number): CameraProductOverview {
  const since = nowMs - 30 * DAY_MS;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS albums,
              SUM(CASE WHEN pa.paid_at IS NOT NULL THEN 1 ELSE 0 END) AS sold,
              SUM(CASE WHEN pa.paid_at >= ? THEN 1 ELSE 0 END) AS sold_30d,
              SUM(CASE WHEN pa.paid_at IS NOT NULL
                        AND (pa.event_ends_at IS NULL OR pa.event_ends_at > ?)
                       THEN 1 ELSE 0 END) AS owed
         FROM photo_albums pa
         JOIN couples c ON c.id = pa.couple_id
        WHERE c.is_demo = 0`,
    )
    .get(since, nowMs) as {
    albums: number;
    sold: number | null;
    sold_30d: number | null;
    owed: number | null;
  };
  const uploads = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM photo_uploads pu
         JOIN photo_albums pa ON pa.id = pu.album_id
         JOIN couples c ON c.id = pa.couple_id
        WHERE c.is_demo = 0`,
    )
    .get() as { n: number };
  const unitEur = FILM_TIER_PRICE_EUR_CENTS.paid / 100;
  const sold = row.sold ?? 0;
  const sold30 = row.sold_30d ?? 0;
  return {
    sold,
    sold_last_30d: sold30,
    revenue_eur: Math.round(sold * unitEur),
    revenue_last_30d_eur: Math.round(sold30 * unitEur),
    owed: row.owed ?? 0,
    unit_price_eur: unitEur,
    albums_total: row.albums,
    uploads_total: uploads.n,
  };
}

// ── Guest-page add-on ──────────────────────────────────────────────────────

function guestPageAddonOverview(nowMs: number): OneOffProductOverview {
  const since = nowMs - 30 * DAY_MS;
  const rows = db
    .prepare(
      `SELECT currency, guest_page_addon, guest_page_prepaid_at
         FROM couples
        WHERE is_demo = 0 AND guest_page_prepaid = 1`,
    )
    .all() as Array<{
    currency: string | null;
    guest_page_addon: number;
    guest_page_prepaid_at: number | null;
  }>;
  let revenue = 0;
  let revenue30 = 0;
  let sold30 = 0;
  let owed = 0;
  for (const r of rows) {
    // The checkout charges the HUF price to HUF couples and the EUR price to
    // everyone else (guestPageAddonPriceId).
    const eur =
      r.currency === "HUF" ? GUEST_PAGE_ADDON_PRICE.HUF / HUF_PER_EUR : GUEST_PAGE_ADDON_PRICE.EUR;
    revenue += eur;
    if (r.guest_page_prepaid_at !== null && r.guest_page_prepaid_at >= since) {
      sold30++;
      revenue30 += eur;
    }
    if (r.guest_page_addon !== 1) owed++;
  }
  return {
    sold: rows.length,
    sold_last_30d: sold30,
    revenue_eur: Math.round(revenue),
    revenue_last_30d_eur: Math.round(revenue30),
    owed,
    unit_price_eur: GUEST_PAGE_ADDON_PRICE.EUR,
  };
}

// ── All products ───────────────────────────────────────────────────────────

/** `coupleMrrEur` / `coupleFoundingValueEur` come from the couple overview so
 *  the totals and the couple KPIs are the same numbers. */
export function productsOverview(
  nowMs: number,
  couple: { mrrEur: number; foundingValueEur: number },
): AdminProductsOverview {
  const vendors = vendorsOverview(nowMs);
  const planners = plannersOverview(nowMs);
  const camera = cameraOverview(nowMs);
  const guestPageAddon = guestPageAddonOverview(nowMs);
  const totalMrr = couple.mrrEur + vendors.mrr_eur + planners.mrr_eur;
  const oneOff30 = camera.revenue_last_30d_eur + guestPageAddon.revenue_last_30d_eur;
  return {
    vendors,
    planners,
    camera,
    guest_page_addon: guestPageAddon,
    total_mrr_eur: totalMrr,
    one_off_last_30d_eur: oneOff30,
    total_founding_value_eur:
      couple.foundingValueEur + vendors.founding_value_eur + planners.founding_value_eur,
    vat_embedded_eur: Math.round(((totalMrr + oneOff30) * HU_VAT_RATE) / (1 + HU_VAT_RATE)),
  };
}
