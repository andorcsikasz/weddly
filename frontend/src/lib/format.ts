// Locale-aware formatters. HUF currency display, number grouping (e.g. HU
// uses "1 234 567", EN uses "1,234,567"), date display, and renderers for
// the structured goal types (WeddingDateGoal / GuestCountGoal / BudgetGoal).

import type { BudgetGoal, GuestCountGoal, WeddingDateGoal, WeddingSeason } from "@shared/types";

type Locale = "hu" | "en";

const HUF = (locale: Locale) =>
  new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  });

const NUMBER = (locale: Locale) =>
  new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-GB", { maximumFractionDigits: 0 });

const hufFmt = HUF("hu");
const hufFmtEn = HUF("en");
const numFmt = NUMBER("hu");
const numFmtEn = NUMBER("en");

/** Format an integer Forint amount with the locale's grouping convention. */
export function formatHuf(amount: number, locale: Locale = "hu"): string {
  return (locale === "en" ? hufFmtEn : hufFmt).format(Math.round(amount));
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

/** Same as formatNumberRange but for HUF currency. */
export function formatHufRange(
  min: number | null,
  max: number | null,
  locale: Locale = "hu",
): string {
  if (min === null || max === null) return "";
  if (min === max) return formatHuf(min, locale);
  return `${formatHuf(min, locale)} – ${formatHuf(max, locale)}`;
}

export function formatDate(ymd: string | null, locale: Locale = "hu"): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const MONTH_FORMATTER = (locale: Locale) =>
  new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", { month: "long", year: "numeric" });

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
  if (goal.kind === "exact" && goal.exact_date) return formatDate(goal.exact_date, ctx.locale);
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
    return ctx.t("goal.count_exact", { n: formatNumber(goal.exact, ctx.locale) });
  }
  if (goal.kind === "range" && goal.min !== null && goal.max !== null) {
    return ctx.t("goal.count_range", {
      min: formatNumber(goal.min, ctx.locale),
      max: formatNumber(goal.max, ctx.locale),
    });
  }
  return ctx.t("goal.count_tbd");
}

export function formatBudgetGoal(goal: BudgetGoal, ctx: GoalText): string {
  if (goal.kind === "tbd") return ctx.t("goal.budget_tbd");
  if (goal.kind === "exact" && goal.exact_huf !== null)
    return formatHuf(goal.exact_huf, ctx.locale);
  if (goal.kind === "range" && goal.min_huf !== null && goal.max_huf !== null) {
    return formatHufRange(goal.min_huf, goal.max_huf, ctx.locale);
  }
  return ctx.t("goal.budget_tbd");
}

export const SEASON_KEYS: WeddingSeason[] = ["spring", "summer", "fall", "winter"];
