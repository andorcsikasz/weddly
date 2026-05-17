// Read-only analytics surfaces for the admin dashboard. Three orthogonal
// endpoints — money (budget + actuals), activity (signups, DAU, audit
// rollup), picks (supplier-pick distribution). Each is a single GET that
// returns the aggregated view in one round-trip; no per-row drilldown.

import type { BudgetCategory } from "./types";
import type { CoupleStatus } from "./types";
import type { SupplierCategory } from "./suppliers";

/** Quartile distribution used by every "money" rollup. Compute from a
 *  sorted ascending array of values:
 *   - count: number of contributing rows
 *   - sum:   integer Forint (or whatever unit the caller documents)
 *   - avg:   sum / count, rounded to nearest integer
 *   - median, p25, p75: SQLite-side linear interpolation between adjacent
 *     ordered rows
 *
 *  All values are integer Forint when the caller's docstring says so. */
export interface AdminAnalyticsStats {
  count: number;
  sum: number;
  avg: number;
  median: number;
  p25: number;
  p75: number;
}

// ─── /api/admin/analytics/money ──────────────────────────────────────────

export interface AdminMoneyAnalytics {
  /** Couples with at least one of (budget_ceiling_huf, budget_lines row).
   *  Drives the "/ {n} pár" denominator on the dashboard so the admin can
   *  tell "32 couples set a budget" from "13 of those filled in actuals". */
  couples_with_budget: number;
  /** Couples that have filled in at least one `budget_lines.actual_huf`. */
  couples_with_actuals: number;
  /** Distribution of `couples.budget_ceiling_huf` across all couples that
   *  set one. Use as the "what did couples plan to spend" headline. */
  budget_ceiling_huf: AdminAnalyticsStats;
  /** Sum of `budget_lines.planned_huf` per couple, then stats across
   *  couples. The headline planned-spend number is `avg`. */
  planned_huf: AdminAnalyticsStats;
  /** Same shape as planned, but over `actual_huf`. */
  actual_huf: AdminAnalyticsStats;
  /** Per-budget-category averages. `couples_with_data` is the denominator
   *  for the category — categories with 0 are still returned with zeros so
   *  the UI can render the full 11-row table without conditional gaps. */
  per_category: Array<{
    category: BudgetCategory;
    avg_planned: number;
    avg_actual: number;
    couples_with_data: number;
  }>;
  /** Right-anchored histogram of `budget_ceiling_huf` for a quick visual.
   *  Each bucket is inclusive on the upper bound; `bucket_max_huf=0` means
   *  "no budget set". Buckets are chosen by the server to fit HU 2026
   *  market expectations (1M / 3M / 5M / 10M / 20M / 30M+ HUF). */
  budget_histogram: Array<{ bucket_max_huf: number; count: number }>;
}

// ─── /api/admin/analytics/activity ───────────────────────────────────────

export interface AdminActivityAnalytics {
  /** Signups, bucketed by window. `total` is the all-time number,
   *  excluding @purged.local tombstones. */
  signups: { last_24h: number; last_7d: number; last_30d: number; total: number };
  /** Distinct users whose `last_seen_at` falls within the window. */
  active_users: { last_24h: number; last_7d: number; last_30d: number };
  /** Funnel stages: registered → verified email → onboarded a couple.
   *  Percentages are 0..1 floats for the UI to format. */
  onboarding_funnel: {
    registered: number;
    verified: number;
    onboarded: number;
    pct_verified: number;
    pct_onboarded: number;
  };
  /** Couples in each status — same counts the user directory shows but
   *  rolled up. `deleting` is included even though the directory hides
   *  it; admins should be able to see the residue size at a glance. */
  couples_by_status: Record<CoupleStatus, number>;
  /** Last 30 days, action counts from `audit_log`. Top 12 by frequency,
   *  newest-first ties broken by action name. */
  top_actions: Array<{ action: string; count: number }>;
  /** Newest-last array of `{date, count}` for daily signups over the
   *  last 14 days. Dates are YYYY-MM-DD in UTC so the chart aligns
   *  consistently regardless of admin locale. */
  signups_daily: Array<{ date: string; count: number }>;
}

// ─── /api/admin/analytics/picks ──────────────────────────────────────────

export interface AdminPicksAnalytics {
  /** Total rows in `couple_picks` (across all categories + couples). */
  total_picks: number;
  /** Distribution of pick count per couple (couples with 0 picks are
   *  excluded so the median doesn't get dragged to 0). */
  picks_per_couple: AdminAnalyticsStats;
  /** Top 20 supplier ids by pick frequency, newest-tie-broken on supplier
   *  id. `source` distinguishes curated/community/DIY so the UI can render
   *  a small badge next to each row. */
  top_picks: Array<{
    supplier_id: string;
    category: SupplierCategory;
    pick_count: number;
    source: "curated" | "community" | "diy";
    display_name: string;
  }>;
  /** Per-category pick saturation: how many couples have a pick in this
   *  category vs how many don't. `coverage_pct` is 0..1 (picked / total
   *  couples that have at least one pick anywhere). */
  category_coverage: Array<{
    category: SupplierCategory;
    picked: number;
    missing: number;
    coverage_pct: number;
  }>;
  /** Aggregate breakdown of where the picks point. */
  source_breakdown: { curated: number; community: number; diy: number };
}
