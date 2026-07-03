// Locale-aware formatters. HUF currency display, number grouping (e.g. HU
// uses "1 234 567", EN uses "1,234,567"), date display, and renderers for
// the structured goal types (WeddingDateGoal / GuestCountGoal / BudgetGoal).

import type {
  BudgetGoal,
  Currency,
  GuestCountGoal,
  WeddingDateGoal,
  WeddingSeason,
} from "@shared/types";

type Locale = "hu" | "en";

/** The single BCP-47 tag every date/number formatter on the platform uses for
 *  a given UI locale: HU → `hu-HU`, everything else → `en-GB`. English surfaces
 *  format with en-GB platform-wide (day-month-year ordering, 24h clock, "8 June
 *  2026") — NEVER en-US — so a date reads identically no matter which screen
 *  renders it. Always derive Intl/`toLocale*` locale args from this, never inline
 *  the ternary, so the convention can never drift back to en-US in new code. */
export function intlLocale(locale: Locale): "hu-HU" | "en-GB" {
  return locale === "hu" ? "hu-HU" : "en-GB";
}

/** Best-guess currency for a UI locale. HU → HUF, anything else → EUR. Used
 *  by public surfaces (landing pricing, the budget try-it widget, feedback
 *  value slider) that need to read as native to the visitor BEFORE they sign
 *  up and pick a couple-level currency. After signup, prefer
 *  `couple.currency` over this — the couple may have explicitly chosen USD. */
export function localeCurrency(locale: Locale): Currency {
  return locale === "hu" ? "HUF" : "EUR";
}

const MONEY = (locale: Locale, currency: Currency) =>
  new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    // `narrowSymbol` forces the glyph (€ / $ / Ft) instead of the ISO code.
    // hu-HU defaults EUR to the literal "EUR" text — we want the € sign in
    // Hungarian too, matching how en-GB already renders it.
    currencyDisplay: "narrowSymbol",
    // HUF / EUR / USD are all whole-unit currencies for our purposes — we
    // store and edit as integers. Drop the trailing .00 so 5 000 € reads
    // as cleanly as 5 000 Ft.
    maximumFractionDigits: 0,
  });

const NUMBER = (locale: Locale) =>
  new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 });

// Memoise formatter instances — `new Intl.NumberFormat` per call is enough
// CPU to show up under flame-graph in the budget table.
const moneyCache = new Map<string, Intl.NumberFormat>();
function moneyFmt(locale: Locale, currency: Currency): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  let f = moneyCache.get(key);
  if (!f) {
    f = MONEY(locale, currency);
    moneyCache.set(key, f);
  }
  return f;
}

const numFmt = NUMBER("hu");
const numFmtEn = NUMBER("en");

/** Format an integer amount in the couple's currency. The amount is taken
 *  AS-IS in the currency's base unit — no conversion, the column names
 *  (e.g. `planned_huf`) are historic and semantically hold whatever the
 *  couple picked. */
export function formatMoney(
  amount: number,
  currency: Currency = "HUF",
  locale: Locale = "hu",
): string {
  return moneyFmt(locale, currency).format(Math.round(amount));
}

/** Legacy alias — kept so the audit-diff rendering (which has to deal with
 *  before/after values that pre-date the couple's currency switch) keeps
 *  reading as HUF. Prefer `formatMoney(amount, couple.currency, locale)`
 *  for everything user-facing. */
export function formatHuf(amount: number, locale: Locale = "hu"): string {
  return formatMoney(amount, "HUF", locale);
}

const COMPACT = (locale: Locale) =>
  new Intl.NumberFormat(intlLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  });

const compactHu = COMPACT("hu");
const compactEn = COMPACT("en");

/** Compact, symbol-less amount for tight UI spots: "132k", "2,8 M". Currency
 *  is opaque here; the caller pairs it with a visible symbol elsewhere.
 *  HU never compacts below a million: hu-HU renders thousands as "215 E"
 *  (ezer), which reads as a typo to most people, and the full grouped figure
 *  is short enough anyway. Compact only earns its keep at "1,6 M". */
export function formatHufCompact(amount: number, locale: Locale = "hu"): string {
  const n = Math.round(amount);
  if (locale !== "en" && Math.abs(n) < 1_000_000) return numFmt.format(n);
  const fmt = locale === "en" ? compactEn : compactHu;
  return fmt.format(n);
}

/** Just the symbol (`Ft` / `€` / `$`) for the given currency + locale. Used
 *  by compact KPI tiles that pair the number with a unit string outside
 *  the formatter ("132k Ft", "2.8M €"). */
export function currencySymbol(currency: Currency, locale: Locale = "hu"): string {
  // currencyDisplay: "narrowSymbol" picks `$` over `US$` etc. when the
  // locale would otherwise prefix the code.
  const parts = new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).formatToParts(0);
  const symbol = parts.find((p) => p.type === "currency")?.value;
  return symbol ?? currency;
}

/** Plain integer with locale grouping (e.g. "1 234" in HU, "1,234" in EN). */
export function formatNumber(n: number, locale: Locale = "hu"): string {
  return (locale === "en" ? numFmtEn : numFmt).format(Math.round(n));
}

/** "1 234 – 5 678" style. Returns empty string if either bound is missing. */
export function formatNumberRange(
  min: number | null,
  max: number | null,
  locale: Locale = "hu",
): string {
  if (min === null || max === null) return "";
  if (min === max) return formatNumber(min, locale);
  return `${formatNumber(min, locale)}–${formatNumber(max, locale)}`;
}

/** Same as formatNumberRange but with currency symbols. Accepts an optional
 *  currency so callers that have the couple's preference can override the
 *  default HUF formatting. */
export function formatMoneyRange(
  min: number | null,
  max: number | null,
  currency: Currency = "HUF",
  locale: Locale = "hu",
): string {
  if (min === null || max === null) return "";
  if (min === max) return formatMoney(min, currency, locale);
  return `${formatMoney(min, currency, locale)} – ${formatMoney(max, currency, locale)}`;
}

/** Legacy alias — HUF-only. See `formatHuf` for the rationale. */
export function formatHufRange(
  min: number | null,
  max: number | null,
  locale: Locale = "hu",
): string {
  return formatMoneyRange(min, max, "HUF", locale);
}

/** Today's date in `YYYY-MM-DD`. Use as the `min` attribute on every date
 *  input the couple uses to plan the future (wedding date, task due dates,
 *  honeymoon window, …) — picking a past date is always nonsense for these. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Pick the later of two `YYYY-MM-DD` strings. Used to compose a `min`
 *  attribute that's the stricter of "today" and "the start date". */
export function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Render a millisecond timestamp as "{date} HH:MM" in the user's local
 *  timezone. Both the date portion and the time portion are read from
 *  LOCAL Date fields — a previous version sliced `toISOString()` for the
 *  date (UTC) while reading `getHours()` (local), which made a 00:30 CET
 *  event render as "yesterday 00:30" because UTC was the previous day. */
export function formatTimestamp(ms: number, locale: Locale = "hu"): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateStr = formatDate(`${yyyy}-${mo}-${dd}`, locale);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dateStr} ${hh}:${mm}`;
}

/** True when `ymd` is a real, fully-specified `YYYY-MM-DD` date with a
 *  sensible 4-digit year. A native `<input type="date">` can emit a partial
 *  value like "0002-01-01" while the user is still typing the year ("2") —
 *  a valid ISO string but nonsense as a wedding date. Use this to gate both
 *  input acceptance and display so a half-typed date never sticks. */
export function isPlausibleDateIso(ymd: string | null | undefined): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const year = Number(ymd.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  const d = new Date(`${ymd}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

export function formatDate(ymd: string | null, locale: Locale = "hu"): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Long date for a millisecond timestamp (e.g. an `created_at`), read from the
 *  user's LOCAL timezone. The couple-facing companion to `formatDate`, which
 *  takes a `YYYY-MM-DD` string. Use this instead of re-deriving an
 *  `Intl.DateTimeFormat` in each component so every screen renders the same
 *  "2026. június 8." / "8 June 2026". */
export function formatDateMs(ms: number, locale: Locale = "hu"): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return formatDate(`${yyyy}-${mo}-${dd}`, locale);
}

const MONTH_FORMATTER = (locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric" });

const monthFmt = MONTH_FORMATTER("hu");
const monthFmtEn = MONTH_FORMATTER("en");

/**
 * Render "June 2027" / "2027 június" from a year+month pair. Day-of-month
 * doesn't matter — Intl needs a full date object so we pin it to the 1st.
 */
export function formatYearMonth(year: number, month: number, locale: Locale = "hu"): string {
  const d = new Date(Date.UTC(year, Math.max(0, month - 1), 1));
  return (locale === "en" ? monthFmtEn : monthFmt).format(d);
}

export interface GoalText {
  /** Lookup function for season/kind/tbd labels. Pass `t` from useT(). */
  t: (path: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
}

/**
 * Human-readable wedding date for dashboards / settings / emails. The TBD /
 * range copy comes from i18n; the year/month label uses Intl.
 */
export function formatWeddingDateGoal(goal: WeddingDateGoal, ctx: GoalText): string {
  if (goal.kind === "tbd") return ctx.t("goal.date_tbd");
  if (goal.kind === "exact" && isPlausibleDateIso(goal.exact_date))
    return formatDate(goal.exact_date, ctx.locale);
  if (goal.kind === "month" && goal.target_year && goal.target_month) {
    return formatYearMonth(goal.target_year, goal.target_month, ctx.locale);
  }
  if (goal.kind === "season" && goal.target_year && goal.target_season) {
    return ctx.t("goal.date_season", {
      season: ctx.t(`season.${goal.target_season}`),
      year: goal.target_year,
    });
  }
  if (goal.kind === "year" && goal.target_year) {
    return String(goal.target_year);
  }
  return ctx.t("goal.date_tbd");
}

export function formatGuestCountGoal(goal: GuestCountGoal, ctx: GoalText): string {
  if (goal.kind === "tbd") return ctx.t("goal.count_tbd");
  if (goal.kind === "exact" && goal.exact !== null) {
    return ctx.t("goal.count_exact", {
      n: formatNumber(goal.exact, ctx.locale),
      count: goal.exact,
    });
  }
  if (goal.kind === "range" && goal.min !== null && goal.max !== null) {
    return ctx.t("goal.count_range", {
      min: formatNumber(goal.min, ctx.locale),
      max: formatNumber(goal.max, ctx.locale),
    });
  }
  return ctx.t("goal.count_tbd");
}

export function formatBudgetGoal(
  goal: BudgetGoal,
  ctx: GoalText,
  currency: Currency = "HUF",
): string {
  if (goal.kind === "tbd") return ctx.t("goal.budget_tbd");
  if (goal.kind === "exact" && goal.exact_huf !== null)
    return formatMoney(goal.exact_huf, currency, ctx.locale);
  if (goal.kind === "range" && goal.min_huf !== null && goal.max_huf !== null) {
    return formatMoneyRange(goal.min_huf, goal.max_huf, currency, ctx.locale);
  }
  return ctx.t("goal.budget_tbd");
}

export const SEASON_KEYS: WeddingSeason[] = ["spring", "summer", "fall", "winter"];
