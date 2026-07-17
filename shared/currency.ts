// The couple-facing money model: which currencies exist, how they're stored,
// and which subset we can actually charge in. shared/types.ts re-exports
// `Currency` + `CURRENCIES` from here, so both import paths work and existing
// `from "@shared/types"` imports keep resolving.

/** Display currency for the couple's money fields. Stored amounts are
 *  integers in this currency's base unit — switching the value here does
 *  NOT retro-convert past entries, it only flips the symbol/format.
 *
 *  DISPLAY only: what the couple budgets in, not what we charge them. The
 *  subscription settles in `BillingCurrency` below, a narrow subset — a PLN
 *  workspace is billed the EUR price. */
export type Currency =
  | "EUR"
  | "HUF"
  | "GBP"
  | "CHF"
  | "PLN"
  | "CZK"
  | "SEK"
  | "NOK"
  | "DKK"
  | "RON"
  | "JPY"
  | "USD";

/** Currencies Stripe is wired for. The couple's DISPLAY currency (`Currency`)
 *  is a superset: a workspace can budget in złoty while the subscription is
 *  charged in EUR. Keeping this narrow is what lets the price maps in
 *  billing.ts / planner_billing.ts / vendor_billing.ts stay exhaustive
 *  `Record`s instead of degrading to a runtime `?? EUR` lookup on 12 keys. */
export type BillingCurrency = "HUF" | "EUR" | "USD";

/** Map a display currency onto the currency we bill it in. HU workspaces are
 *  charged in forint, USD stays USD (it predates the European expansion and
 *  has live rows), everything else settles in EUR. */
export function toBillingCurrency(currency: Currency): BillingCurrency {
  if (currency === "HUF" || currency === "USD") return currency;
  return "EUR";
}

/** Currencies whose amounts are stored as WHOLE units rather than hundredths.
 *  JPY has no minor unit at all; forint officially does but was demonetised in
 *  2008 and the platform has always stored/edited whole forint (see the
 *  `planned_huf` column names). Everything else is cents/pence/grosze/øre. */
const ZERO_DECIMAL: ReadonlySet<Currency> = new Set<Currency>(["HUF", "JPY"]);

/** How many stored minor units make one displayed unit. Callers converting
 *  between a user-typed figure and `*_amount_minor` columns must go through
 *  this — a hardcoded `100` silently inflates every JPY amount 100×. */
export function minorUnitFactor(currency: Currency): 1 | 100 {
  return ZERO_DECIMAL.has(currency) ? 1 : 100;
}

export interface CurrencyMeta {
  code: Currency;
  /** Fallback glyph. Prefer `currencySymbol()` in frontend/src/lib/format.ts,
   *  which asks Intl for the locale-correct narrow symbol; this is here for
   *  the backend + tests, which have no locale in hand. */
  symbol: string;
  /** English display name. The HU name lives in the locale files under
   *  `currency.name_<code>`. */
  name: string;
  /** Rough units per 1 EUR, used ONLY to scale budget slider bounds and
   *  placeholder amounts into a figure the visitor recognises. NOT an FX rate:
   *  never use it for money math — see backend/src/lib/fx.ts for live quotes.
   *  Deliberately stale-tolerant; 20% drift just nudges a slider default. */
  unitsPerEur: number;
}

/** Every currency a couple can pick, in droplist order: the two home markets
 *  first, then the rest of the European continent roughly by economy size,
 *  then JPY, then legacy USD last. `CURRENCIES` in types.ts is derived from
 *  this, so adding a currency means adding exactly one row here. */
export const CURRENCY_META: readonly CurrencyMeta[] = [
  { code: "EUR", symbol: "€", name: "Euro", unitsPerEur: 1 },
  { code: "HUF", symbol: "Ft", name: "Hungarian forint", unitsPerEur: 400 },
  { code: "GBP", symbol: "£", name: "British pound", unitsPerEur: 0.85 },
  { code: "CHF", symbol: "CHF", name: "Swiss franc", unitsPerEur: 0.95 },
  { code: "PLN", symbol: "zł", name: "Polish złoty", unitsPerEur: 4.3 },
  { code: "CZK", symbol: "Kč", name: "Czech koruna", unitsPerEur: 25 },
  { code: "SEK", symbol: "kr", name: "Swedish krona", unitsPerEur: 11.5 },
  { code: "NOK", symbol: "kr", name: "Norwegian krone", unitsPerEur: 11.5 },
  { code: "DKK", symbol: "kr", name: "Danish krone", unitsPerEur: 7.45 },
  { code: "RON", symbol: "lei", name: "Romanian leu", unitsPerEur: 5 },
  { code: "JPY", symbol: "¥", name: "Japanese yen", unitsPerEur: 165 },
  { code: "USD", symbol: "$", name: "US dollar", unitsPerEur: 1.1 },
];

export function currencyMeta(currency: Currency): CurrencyMeta {
  return CURRENCY_META.find((m) => m.code === currency) ?? CURRENCY_META[0]!;
}

/** Scale an EUR figure into `currency`, rounded to `sigDigits` significant
 *  digits so it reads like a number a person chose ("2 500 000 Ft", not
 *  "2 483 217 Ft"). Presentation only — budget slider bounds, placeholder
 *  amounts. Never for money the user owes or owns. */
export function scaleFromEur(eurAmount: number, currency: Currency, sigDigits = 2): number {
  const raw = eurAmount * currencyMeta(currency).unitsPerEur;
  if (raw <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(raw) - (sigDigits - 1));
  return Math.round(raw / magnitude) * magnitude;
}

/** Droplist order. Derived from CURRENCY_META so adding a currency means
 *  adding exactly one row there. */
export const CURRENCIES: readonly Currency[] = CURRENCY_META.map((m) => m.code);

/** Boundary guard for anything that accepts a currency off the wire or out of
 *  a DB column. Replaces the hand-maintained VALID_CURRENCIES sets that used
 *  to drift from the union. */
export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && CURRENCIES.includes(value as Currency);
}
