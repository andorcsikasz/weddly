// Admin financial planner: live billing metrics + an assumption-driven revenue
// forecast. The backend serves the live base (current cohorts, MRR, founding
// expiry schedule); the projection math below is pure so the admin page can
// re-run it live as the operator drags the assumption sliders.

import type { SubscriptionStatus } from "./billing";
import type { Currency } from "./types";

/** Display-only HUF→EUR rate used to combine the two-currency MRR into one
 *  headline figure. Not a live FX feed — it just keeps the dashboard legible.
 *  1 990 Ft ≈ 5 € → ~398; rounded to 400. */
export const HUF_PER_EUR = 400;

export interface CurrencyMrr {
  currency: Currency;
  /** Paying subscribers (active + past_due) billed in this currency. */
  subscribers: number;
  /** Monthly recurring revenue in this currency's own units. */
  mrr: number;
}

/** How many founding members' free window ends in a given calendar month. */
export interface FoundingExpiryBucket {
  /** "YYYY-MM". */
  month: string;
  count: number;
}

export interface AdminFinancialPlannerOverview {
  generated_at: number;
  /** Live couple counts per subscription state (non-demo only). */
  counts: Record<SubscriptionStatus, number>;
  total_couples: number;
  /** Founding members whose window is still live. */
  founding_active: number;
  founding_spots_left: number;
  /** Couples currently in the 14-day trial (forecast conversion pool). */
  trialing: number;
  /** Paying subscribers (active + past_due) and their MRR, per currency. */
  mrr_by_currency: CurrencyMrr[];
  paying_subscribers: number;
  /** Combined MRR / ARR in EUR (HUF converted at HUF_PER_EUR). */
  mrr_eur_total: number;
  arr_eur_total: number;
  /** Blended revenue per paying user in EUR (falls back to the EUR price). */
  arpu_eur: number;
  /** Upcoming founding-window expiries by month — the 18-month cohort
   *  converting to paid (or churning) lands here. Chronological. */
  founding_expiry: FoundingExpiryBucket[];
  price_eur: number;
  price_huf: number;
  huf_per_eur: number;
}

/** Editable forecast assumptions, all surfaced as sliders on the page. */
export interface ForecastAssumptions {
  months: number;
  /** New couples signing up per month going forward. */
  newCouplesPerMonth: number;
  /** % of new couples that become paying after their trial. */
  trialToPaidPct: number;
  /** % of founding members who convert to paid when their window ends. */
  foundingToPaidPct: number;
  /** % of paying subscribers lost each month. */
  monthlyChurnPct: number;
}

export interface ForecastPoint {
  /** Month offset from now (1-based). */
  month: number;
  subscribers: number;
  /** MRR in EUR. */
  mrr: number;
}

/** Pure revenue projection. `foundingExpiryByOffset[i]` = founding members whose
 *  window ends i months from now (offset 0 = this month). ARPU is in EUR. */
export function projectRevenue(
  base: { subscribers: number; arpuEur: number },
  assumptions: ForecastAssumptions,
  foundingExpiryByOffset: number[],
): ForecastPoint[] {
  const churn = clampPct(assumptions.monthlyChurnPct) / 100;
  const trialConv = clampPct(assumptions.trialToPaidPct) / 100;
  const foundingConv = clampPct(assumptions.foundingToPaidPct) / 100;
  const arpu = base.arpuEur > 0 ? base.arpuEur : 0;

  const out: ForecastPoint[] = [];
  let subs = base.subscribers;
  for (let m = 1; m <= assumptions.months; m++) {
    // Churn first on the existing base.
    subs = subs * (1 - churn);
    // New couples that convert after their trial.
    subs += assumptions.newCouplesPerMonth * trialConv;
    // Founding members whose free window ends this month, converting to paid.
    const expiring = foundingExpiryByOffset[m - 1] ?? 0;
    subs += expiring * foundingConv;
    const rounded = Math.max(0, Math.round(subs));
    out.push({ month: m, subscribers: rounded, mrr: Math.round(rounded * arpu) });
  }
  return out;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}
