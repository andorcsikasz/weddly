// Admin financial planner: live billing metrics + an assumption-driven revenue
// forecast. The backend serves the live base (current cohorts, MRR, founding
// expiry schedule); the projection math below is pure so the admin page can
// re-run it live as the operator drags the assumption sliders.

import type { SubscriptionStatus } from "./billing";
import type { BillingCurrency } from "./currency";

/** Display-only HUF→EUR rate used to combine the two-currency MRR into one
 *  headline figure. Not a live FX feed — it just keeps the dashboard legible.
 *  1 990 Ft ≈ 5 € → ~398; rounded to 400. */
export const HUF_PER_EUR = 400;

/** Live EUR-based FX quote for the planner's rate strip + the HU tax
 *  conversion. Fetched server-side (real-time market mid), so the browser
 *  isn't tied to a once-a-day reference rate. null when the upstream is
 *  unreachable — callers fall back to a static rate. */
export interface FxRates {
  base: "EUR";
  /** Units of each currency per 1 EUR (live market mid). */
  rates: { HUF: number; USD: number; CNY: number };
  /** Unix ms of the upstream quote. */
  as_of: number;
  /** Upstream source label (e.g. "yahoo"). */
  source: string;
}

export interface CurrencyMrr {
  /** The currency we CHARGE in, not the couple's display currency — the two
   *  diverged when the picker grew past HUF/EUR/USD. Display currencies that
   *  settle on EUR (PLN, JPY, …) are summed into the EUR row. */
  currency: BillingCurrency;
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
  /** Global read-only paywall switch. False = freeze deferred, nobody is
   *  locked out yet (the default until the founder flips it on). */
  billing_enforcement_on: boolean;
  /** True once the founding cohort is full (total non-demo couples >= 200),
   *  i.e. the freeze is ready to be turned on. Drives the admin go-live signal. */
  enforcement_ready: boolean;
  /** Distinct couples who started the payment process (reached the Stripe
   *  Checkout screen) at least once — top of the paid-conversion funnel.
   *  Counted from `checkout.started` growth events. */
  checkout_started_couples: number;
  /** Total checkout starts including repeat attempts by the same couple. */
  checkout_started_total: number;
}

/** Stripe connection + config health for the admin planner. Surfaces what we
 *  can even before billing is wired up (which env vars are present), and once
 *  a key is set, whether a live API ping actually succeeds. Never carries
 *  secret values — only booleans + the (non-secret) account facts Stripe
 *  returns. */
export interface StripeHealth {
  /** True when a Stripe secret key is configured (STRIPE_ENABLED). */
  enabled: boolean;
  /** Key mode from the `sk_live_` / `sk_test_` prefix. null when no key set;
   *  "unknown" for an unrecognised prefix. */
  mode: "live" | "test" | "unknown" | null;
  /** Which billing env vars are present — booleans only, never the values. */
  config: {
    secretKey: boolean;
    webhookSecret: boolean;
    priceEur: boolean;
    priceHuf: boolean;
  };
  /** Live API reachability. null when billing is disabled (nothing to ping). */
  connection: {
    ok: boolean;
    /** acct_… id of the account the key belongs to (safe to show). */
    accountId: string | null;
    chargesEnabled: boolean | null;
    payoutsEnabled: boolean | null;
    country: string | null;
    defaultCurrency: string | null;
    /** Failure reason when ok=false. */
    error: string | null;
  } | null;
  /** When the check ran (unix ms). */
  checkedAt: number;
}

/** Editable forecast assumptions, all surfaced as sliders on the page. */
export interface ForecastAssumptions {
  months: number;
  /** New couples signing up per month going forward. */
  newCouplesPerMonth: number;
  /** % of new couples that become paying after their trial. */
  trialToPaidPct: number;
  /** Typical subscription length in months (2–12). Drives both natural
   *  lifecycle churn (1/avgCycleMonths per month) and founding conversion
   *  probability (avgCycleMonths/12 — longer planners are more likely to
   *  continue paying when their founding window closes). */
  avgCycleMonths: number;
  /** % of paying subscribers lost each month from involuntary/voluntary churn
   *  on top of natural lifecycle completion. */
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
  const cycle = Math.max(2, assumptions.avgCycleMonths);
  // Natural lifecycle churn: 1/cycle per month (wedding happened, planning done).
  const naturalChurn = 1 / cycle;
  const involuntaryChurn = clampPct(assumptions.monthlyChurnPct) / 100;
  const effectiveChurn = Math.min(1, naturalChurn + involuntaryChurn);
  const trialConv = clampPct(assumptions.trialToPaidPct) / 100;
  // Founding conv: couples with longer planning horizons are more likely to
  // continue paying (avgCycleMonths/12, capped at 1).
  const foundingConv = Math.min(1, cycle / 12);
  const arpu = base.arpuEur > 0 ? base.arpuEur : 0;

  const out: ForecastPoint[] = [];
  let subs = base.subscribers;
  for (let m = 1; m <= assumptions.months; m++) {
    // Apply combined churn on the existing base.
    subs = subs * (1 - effectiveChurn);
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

// ── Egy előfizetés bontása (per-subscription unit economics) ────────────────
// A bruttó, ÁFÁ-s magyar fogyasztói árból mennyi marad a cégben, illetve
// magánszemélyként osztalék után. Tájékoztató becslés, NEM adótanácsadás —
// leegyszerűsített, a szocho-felső­korlátot és a tényleges költségelszámolást
// elhanyagolja. A díj- és adókulcsok forrása a Stripe magyar árlistája + a
// 2024-es magyar adókulcsok.

/** Magyar általános ÁFA-kulcs. A bruttó ár ÁFÁ-t tartalmaz, így a kivont ÁFA
 *  = bruttó × 27/127. */
export const HU_VAT_RATE = 0.27;
/** Stripe online kártyadíj, EEA kártya: 1,5% + 85 Ft a bruttóra. (UK kártya
 *  2,5% + 85 Ft — itt az EEA-val, a tipikus esettel számolunk.) */
export const STRIPE_EEA_PCT = 0.015;
export const STRIPE_FIXED_HUF = 85;
/** Stripe Billing előfizetés-kezelési díj: a bruttó forgalom 0,7%-a. */
export const STRIPE_BILLING_PCT = 0.007;
/** Helyi iparűzési adó (HIPA) felső kulcsa a nettó árbevételre. */
export const HU_HIPA_RATE = 0.02;
/** Társasági adó (TAO) a nyereségre. */
export const HU_TAO_RATE = 0.09;
/** Osztalékadó: SZJA 15% + szocho 13% (a szocho éves felső korlátját
 *  elhanyagolva — felette az effektív kulcs ~15%-ra csökken). */
export const HU_DIVIDEND_RATE = 0.28;

export interface SubscriptionUnitEconomics {
  /** Amit a vásárló fizet (bruttó, ÁFÁ-s). */
  grossHuf: number;
  /** Ebből ÁFA (27%, a bruttóból visszaszámolva). */
  vatHuf: number;
  /** Nettó árbevétel ÁFA nélkül. */
  netRevenueHuf: number;
  /** Stripe kártyadíj (1,5% + 85 Ft a bruttóra). */
  stripeCardHuf: number;
  /** Stripe Billing díj (0,7% a bruttóra). */
  stripeBillingHuf: number;
  /** Nettó árbevétel a Stripe-díjak után, magyar adók előtt. */
  afterStripeHuf: number;
  /** HIPA (2% a nettó árbevételre). */
  hipaHuf: number;
  /** TAO (9% a Stripe utáni nyereségre). */
  taoHuf: number;
  /** Cégben maradó összeg adózás után (osztalék nélkül). */
  inCompanyHuf: number;
  /** Osztalékadó, ha magánszemélyként kiveszik (SZJA 15% + szocho 13%). */
  dividendTaxHuf: number;
  /** Magánszemélyként kézben maradó összeg, osztalék után. */
  inHandHuf: number;
}

/** Egy darab bruttó (ÁFÁ-s) havi előfizetés teljes lebontása forintban.
 *  Minden tétel egész Ft-ra kerekítve, hogy a táblázat összeadódjon. Pure —
 *  a kliens élőben újraszámolja, ahogy az operátor másik árat ír be. */
export function subscriptionUnitEconomics(grossHuf: number): SubscriptionUnitEconomics {
  const gross = Math.max(0, Math.round(grossHuf));
  const vat = Math.round((gross * HU_VAT_RATE) / (1 + HU_VAT_RATE));
  const netRevenue = gross - vat;
  const stripeCard = gross > 0 ? Math.round(gross * STRIPE_EEA_PCT + STRIPE_FIXED_HUF) : 0;
  const stripeBilling = Math.round(gross * STRIPE_BILLING_PCT);
  const afterStripe = netRevenue - stripeCard - stripeBilling;
  const hipa = Math.round(netRevenue * HU_HIPA_RATE);
  // A TAO alapja a Stripe utáni eredmény (a HIPA-t a táblázat külön sorként
  // vonja le — a kerekített tételek így adódnak össze a felhasználó modelljével).
  const tao = Math.round(afterStripe * HU_TAO_RATE);
  const inCompany = afterStripe - hipa - tao;
  const dividendTax = Math.round(inCompany * HU_DIVIDEND_RATE);
  const inHand = inCompany - dividendTax;
  return {
    grossHuf: gross,
    vatHuf: vat,
    netRevenueHuf: netRevenue,
    stripeCardHuf: stripeCard,
    stripeBillingHuf: stripeBilling,
    afterStripeHuf: afterStripe,
    hipaHuf: hipa,
    taoHuf: tao,
    inCompanyHuf: inCompany,
    dividendTaxHuf: dividendTax,
    inHandHuf: inHand,
  };
}
