// Read-only analytics surfaces for the admin dashboard. Three orthogonal
// endpoints — money (budget + actuals), activity (signups, DAU, audit
// rollup), picks (supplier-pick distribution). Each is a single GET that
// returns the aggregated view in one round-trip; no per-row drilldown.

import type { BudgetCategory, UnixMs } from "./types";
import type { CoupleStatus } from "./types";
import type { SupplierCategory } from "./suppliers";

/** Audience filter shared by every couple-/user-shaped analytics lens (all
 *  but the demo lens, which is itself the demo view, and traffic, which is
 *  external GA4 data). The baseline — every flag false — is "real users
 *  only"; each flag adds one cohort back. See backend
 *  domain/analytics_audience.ts for the cohort definitions. Purged tombstones
 *  are always excluded. */
export interface AnalyticsAudience {
  includeAdmins: boolean;
  includeTest: boolean;
  includeDemos: boolean;
  includeArchived: boolean;
  includeDeleting: boolean;
}

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
   *  consistently regardless of admin locale. All the fields above are
   *  REAL traffic — demo workspaces (`couples.is_demo`, `…@demo.weddly.local`
   *  users) are excluded so the headlines aren't inflated by the landing's
   *  "Try the demo" seeds. */
  signups_daily: Array<{ date: string; count: number }>;
  /** Demo-only mirror of the headline counts, rendered as a small "demo: N"
   *  note under each real figure. Same windows + funnel stages, but counted
   *  over the demo users/couples that the fields above deliberately omit. */
  demo: {
    signups: { last_24h: number; last_7d: number; last_30d: number; total: number };
    active_users: { last_24h: number; last_7d: number; last_30d: number };
    onboarding_funnel: { registered: number; verified: number; onboarded: number };
    /** Live demo couples (`is_demo = 1`) regardless of status. */
    couples_total: number;
  };
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

// ─── /api/admin/analytics/engagement ─────────────────────────────────────

export interface AdminEngagementAnalytics {
  /** Session stats derived from `audit_log` rows for the past 30 days.
   *  Two adjacent rows from the same actor count as one session as long
   *  as they're within `SESSION_GAP_MINUTES` (default 30). Distribution
   *  is in minutes (integer). Sessions shorter than the gap (single-row
   *  bursts) count as 1-minute sessions so the median doesn't collapse
   *  to zero. */
  session_duration_minutes: AdminAnalyticsStats;
  /** Total distinct sessions inferred from audit_log gaps. Same window. */
  total_sessions: number;
  /** Distinct users who triggered at least one audit row in the window. */
  active_users_30d: number;
  /** D+1 / D+7 / D+30 retention: of users who signed up on day 0, the
   *  fraction still seen N days later (any audit_log activity OR
   *  last_seen_at >= signup+N). Cohort = users registered ≥30 days ago
   *  so the D+30 bucket has settled data. Returns null when the cohort
   *  is empty (no users old enough). */
  retention: {
    cohort_size: number;
    d1: number | null;
    d7: number | null;
    d30: number | null;
  };
  /** 24×7 weekday-by-hour matrix of audit_log activity over the past
   *  30 days. `matrix[dow][hour]` — dow is 0..6 with 0=Monday (so the
   *  chart's row order matches the typical European week display).
   *  Hour is 0..23 in UTC. Values are absolute counts. */
  time_of_day: {
    matrix: number[][];
    max: number;
  };
  /** Top 8 most-used "features" over the past 30 days. Features are
   *  derived from `audit_log.action` prefixes (e.g. "guest.", "budget.",
   *  "schedule.", "supplier.") so the rollup stays stable as new
   *  individual actions land. The frontend renders these as a small
   *  horizontal bar list. */
  top_features: Array<{ feature: string; count: number; users: number }>;
  /** Top 10 most active users over the past 30 days, ranked by audit_log
   *  event count. Demo users (email ending in `@demo.weddly.local`) are
   *  excluded — they show up in the dedicated demo analytics surface. */
  top_users: Array<{
    user_id: number;
    full_name: string;
    email: string;
    event_count: number;
    last_seen_at: UnixMs | null;
  }>;
}

// ─── /api/admin/analytics/demo ───────────────────────────────────────────

/** Demo-platform usage rollup. Kept separate from the regular surfaces
 *  because demo workspaces are intentionally short-lived (a background
 *  sweep purges idle ones) and would skew signups / retention if mixed
 *  in with real users. */
export interface AdminDemoAnalytics {
  /** Demo workspaces alive in the DB right now (excludes purged rows).
   *  Demo couples are flagged via `couples.is_demo = 1`. */
  total_demos: number;
  /** New demo workspaces created over each window. `last_24h` is the
   *  freshness signal admins look at first. */
  new_demos: { last_24h: number; last_7d: number; last_30d: number };
  /** Newest-last `{date, count}` array for daily demo creations over the
   *  last 14 days. Same shape as the activity surface's `signups_daily`
   *  so the frontend reuses the same chart component. */
  demos_daily: Array<{ date: string; count: number }>;
  /** Demo workspaces with at least one audit_log row in the last 24h —
   *  a "live demos" signal admins use to spot organic load before it
   *  shows up in registration numbers. */
  active_demos_24h: number;
  /** Mean audit_log event count across demo workspaces. Rounded to the
   *  nearest integer; 0 when there are no demos. */
  avg_events_per_demo: number;
  /** Total audit events from demo workspaces over the last 30 days.
   *  Compare against the regular `engagement.total_sessions` for a
   *  real-vs-demo traffic split. */
  total_demo_events_30d: number;
  /** Total demos served ever — live workspaces + every purged snapshot
   *  from `demo_usage`. Survives the continuous 4h sweep so the "how
   *  many people tried it" number doesn't reset as demos are reaped. */
  total_demos_served: number;
  /** Mean lifetime (seconds) across purged demos — proxy for how long
   *  visitors actually spent in the trial before abandoning it. 0 when
   *  no demos have been purged yet. */
  avg_lifetime_seconds: number;
  /** Top features tried across BOTH live demos and historic snapshots,
   *  ordered by event count. Same shape as the engagement endpoint's
   *  `top_features` so the frontend can reuse its bar-list component. */
  top_features: Array<{ feature: string; count: number; demos: number }>;
}

// ─── /api/admin/analytics/growth-funnel ─────────────────────────────────────
//
// Consumer view for the `growth_events` table. The table has been collecting
// rows since P2.B but until P6b nothing read from it — this endpoint flips
// that into a 7-day funnel ratio so the founder can answer "of the people
// who signed up, how many got far enough to share their wedding site, and
// how many guests actually opened it?".

/** One row in the conversion funnel. `count_7d` is the raw event count in
 *  the trailing 7-day window; `conversion_from_prev` is `count_7d` divided
 *  by the previous step's `count_7d`, clamped to 0..1, null on step 0 and
 *  whenever the previous step has zero events (avoids divide-by-zero
 *  flicker on a fresh deploy). */
export interface AdminGrowthFunnelStep {
  /** GrowthEventKind from shared/growth.ts. Typed as string to keep this
   *  module free of cross-shared imports — the front-end maps to a label. */
  kind: string;
  count_7d: number;
  count_24h: number;
  /** total / prev_total, 0..1. Null for the first step + null when prev=0. */
  conversion_from_prev: number | null;
}

export interface AdminGrowthFunnelAnalytics {
  /** Funnel in order: signup.completed → couple.created → wedding_site.view
   *  → rsvp.page.view → rsvp.submitted. Missing kinds (never recorded yet)
   *  surface as zero counts so the dashboard still renders a row. */
  steps: AdminGrowthFunnelStep[];
  /** Top-N attributed referrers from `signup.from_referrer` events in the
   *  last 7 days. Reads `payload.referrer` (a curated allowlist value, not
   *  a raw URL). Empty list when nothing's attributed yet. */
  referrers_7d: Array<{ source: string; count: number }>;
  /** Couples created in last 7d that haven't recorded a `wedding_site.view`
   *  yet — the highest-leverage outreach list for "you've got a workspace,
   *  here's how to share it". Just the couple_ids; admin tools resolve them
   *  to display_names via the existing /api/admin/couples endpoint. */
  stalled_couple_ids: number[];
  /** Same-shape per-kind aggregate as `aggregateGrowthEvents()` so the
   *  admin debug pane can show every recorded kind, not just the funnel. */
  kinds: Array<{
    kind: string;
    total: number;
    last_24h: number;
    last_7d: number;
    last_event_at: number | null;
  }>;
}

// ─── /api/admin/analytics/honeymoon ──────────────────────────────────────
//
// Aggregates the honeymoon trip fields couples fill in on /app/honeymoon
// (`honeymoon_destination`, `honeymoon_start_date`, `honeymoon_end_date`,
// `honeymoon_origin_iata`). The headline the founder asked for is "most
// popular honeymoon destination". Demo + `deleting` couples are excluded so
// the seeds don't dominate the leaderboard.

export interface AdminHoneymoonAnalytics {
  /** Real couples (non-demo, not `deleting`) — the denominator for adoption. */
  total_couples: number;
  /** Couples with a non-empty `honeymoon_destination`. */
  couples_with_destination: number;
  /** Couples with BOTH start + end dates set (drives `trip_nights`). */
  couples_with_dates: number;
  /** `couples_with_destination / total_couples`, 0..1. */
  adoption_pct: number;
  /** Most popular destinations by couple count. Grouped case-insensitively on
   *  the trimmed text; the most frequently-typed original spelling becomes the
   *  display label. Top 12, ties broken alphabetically. */
  top_destinations: Array<{ destination: string; count: number }>;
  /** Most popular departure airports (`honeymoon_origin_iata`, upper-cased) by
   *  couple count. Top 10. */
  top_origins: Array<{ iata: string; count: number }>;
  /** Trip length in nights (`end - start`) across couples with both dates set
   *  and `end >= start`. Integer nights. */
  trip_nights: AdminAnalyticsStats;
  /** Departure seasonality — `honeymoon_start_date` bucketed by calendar month.
   *  Always 12 rows (`month` 1..12) so the bar row never develops gaps. */
  start_month: Array<{ month: number; count: number }>;
}

// ─── /api/admin/analytics/weddings ───────────────────────────────────────
//
// "What do the weddings themselves look like?" — date seasonality, day-of-week
// preference, planning lead time, guest-count ambition, and the locale / style
// distribution of the couples. All over the real (non-demo, non-`deleting`)
// universe.

export type WeddingSeason = "spring" | "summer" | "autumn" | "winter";

export interface AdminWeddingAnalytics {
  /** Real couples in the universe. */
  total_couples: number;
  /** Couples with a parseable `wedding_date`. */
  couples_with_date: number;
  /** Weddings per calendar month (1..12) across couples with a parseable date.
   *  Always 12 rows. */
  wedding_month: Array<{ month: number; count: number }>;
  /** Weddings per ISO weekday (1=Mon .. 7=Sun). Always 7 rows — Saturday
   *  dominance is the expected shape. */
  wedding_weekday: Array<{ weekday: number; count: number }>;
  /** Weddings per meteorological (N-hemisphere) season. */
  wedding_season: Array<{ season: WeddingSeason; count: number }>;
  /** Lead time in days between `created_at` (signup) and `wedding_date`, across
   *  couples with a parseable future-or-past date. Negative values (date set in
   *  the past) are excluded. */
  lead_time_days: AdminAnalyticsStats;
  /** Effective guest-count target — `COALESCE(target_guest_count,
   *  target_guest_count_max, target_guest_count_min)` — across couples that set
   *  one. */
  guest_count_target: AdminAnalyticsStats;
  /** Couple display-currency split (`couples.currency`). */
  by_currency: Array<{ currency: string; count: number }>;
  /** Couple country split (`couples.country`). */
  by_country: Array<{ country: string; count: number }>;
  /** UI-locale split over real, non-purged users (`users.locale`). `unknown`
   *  collects rows with a null/empty locale (pre-capture signups). */
  by_locale: Array<{ locale: string; count: number }>;
  /** Most-used wedding style tags (`couples.style_tags_json`) by couple count.
   *  Top 12. */
  top_style_tags: Array<{ tag: string; count: number }>;
}

// ─── /api/admin/analytics/guests ─────────────────────────────────────────
//
// Guest-list shape across the real universe — RSVP funnel, dietary load,
// plus-one + accommodation demand. Guests belong to couples; rows owned by
// demo / `deleting` couples are excluded.

export interface AdminGuestAnalytics {
  /** Real couples that have at least one guest row. */
  couples_with_guests: number;
  /** Total guest rows in the real universe. */
  total_guests: number;
  /** Guests per couple across couples with ≥1 guest (zero-guest couples are
   *  excluded so the median isn't dragged to 0). */
  guests_per_couple: AdminAnalyticsStats;
  /** RSVP status split across every guest row. */
  rsvp_breakdown: { pending: number; yes: number; no: number; maybe: number };
  /** `(yes + no + maybe) / total` — fraction of invited guests who replied. */
  response_rate: number;
  /** `yes / (yes + no)` — of guests who gave a definite answer, the fraction
   *  attending. Excludes pending + maybe. */
  acceptance_rate: number;
  /** Guest-kind split. */
  kind_breakdown: { adult: number; child: number; baby: number };
  /** Guests carrying a non-empty `plus_one_name`. */
  plus_one_count: number;
  /** Guests with `accommodation_needed = 1`. */
  accommodation_needed_count: number;
  /** Guests with a non-empty `song_request`. */
  song_request_count: number;
  /** Heuristic keyword scan of the free-text `dietary` field (HU + EN terms).
   *  A single note can hit more than one bucket. `other_text` counts non-empty
   *  notes that matched no keyword. */
  dietary: {
    gluten: number;
    lactose: number;
    nut: number;
    vegetarian: number;
    vegan: number;
    other_text: number;
  };
  /** Guests with any non-empty `dietary` note (denominator for `dietary`). */
  guests_with_dietary: number;
}

// ─── Traffic (Google Analytics 4) ──────────────────────────────────────────
//
// Unlike the other six rollups, these numbers don't come from our SQLite —
// they're pulled live from the GA4 Data API (backed by the GTM container on
// the landing). The endpoint degrades gracefully: when GA4 isn't wired up
// (no service account / property id) it returns `configured: false` and the
// dashboard renders a one-card setup hint instead of a wall of zeros.

/** Headline totals for one date window. Counts are whole numbers; the two
 *  rate/seconds fields are derived GA4 metrics. */
export interface AdminTrafficTotals {
  /** GA4 `activeUsers` — distinct people, the closest analogue to "visitors". */
  active_users: number;
  /** GA4 `sessions`. */
  sessions: number;
  /** GA4 `screenPageViews`. */
  page_views: number;
  /** GA4 `engagementRate`, 0..1. */
  engagement_rate: number;
  /** GA4 `averageSessionDuration`, in seconds (rounded). */
  avg_session_seconds: number;
}

export interface AdminTrafficAnalytics {
  /** False when the GA4 Data API isn't configured (missing property id or
   *  service-account credentials). All the arrays below are empty and the
   *  totals are zero in that case — the UI shows a setup card. */
  configured: boolean;
  /** Non-null when GA4 IS configured but the Data API call failed (API not
   *  enabled, service account lacks Viewer, wrong property id, network). Carries
   *  the raw Google error so the admin surface can show the actual cause — this
   *  endpoint is admin-only, so leaking the message is fine and useful. Null on
   *  success and when unconfigured (that's the `configured:false` setup state). */
  error: string | null;
  /** The numeric GA4 property id the report was run against ("" when
   *  unconfigured). Surfaced in the section's "source" line. */
  property_id: string;
  /** Trailing 7- and 28-day headline totals. */
  totals_7d: AdminTrafficTotals;
  totals_28d: AdminTrafficTotals;
  /** Daily active users for the last 14 days (UTC `YYYY-MM-DD`), zero-filled
   *  so the area chart shares the exact shape of `signups_daily`. */
  active_users_daily: Array<{ date: string; count: number }>;
  /** Most-viewed page paths over the last 7 days. */
  top_pages: Array<{ path: string; views: number; users: number }>;
  /** GA4 default channel grouping (Organic Search, Direct, Referral, …) by
   *  sessions over the last 7 days. */
  channels: Array<{ channel: string; sessions: number }>;
  /** Top countries by active users over the last 7 days. */
  countries: Array<{ country: string; users: number }>;
  /** When the report was generated (unix ms) — drives the "as of" line. */
  generated_at: number;
}
