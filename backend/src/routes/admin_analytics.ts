// Read-only analytics rollups for /app/admin/analytics. Orthogonal endpoints —
// money / activity / picks / engagement / demo / growth-funnel / traffic — each
// returning one fully-aggregated payload so the dashboard can render in a single
// round-trip. All but `traffic` aggregate our own SQLite; `traffic` pulls live
// numbers from the Google Analytics 4 Data API (see lib/ga4.ts). Gated by the
// same ADMIN_EMAILS allowlist as the rest of /api/admin/*.

import type {
  AcquisitionDimensionRow,
  AdminAcquisitionAnalytics,
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminCampaignAnalytics,
  AdminDemoAnalytics,
  AdminDemoKind,
  AdminDemoTypeStats,
  AdminEngagementAnalytics,
  AdminGrowthFunnelAnalytics,
  AdminGrowthFunnelStep,
  AdminGuestAnalytics,
  AdminHoneymoonAnalytics,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
  AdminPlannerAnalytics,
  AdminTrafficAnalytics,
  AdminTrafficTotals,
  AdminUserAnalytics,
  AdminWeddingAnalytics,
  CampaignFamily,
  CampaignFamilyStats,
  CampaignRowStats,
  WeddingSeason,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { CONFIG } from "../config";
import { db } from "../db";
import {
  type AnalyticsAudience,
  coupleAudienceSql,
  parseAudience,
  userAudienceSql,
} from "../domain/analytics_audience";
import { listActiveCommunitySuppliers } from "../domain/community_suppliers";
import { DIRECTORY } from "../domain/suppliers_data";
import { channelFromUtm } from "../domain/signup_meta";
import { requireAdmin } from "../domain/users";
import {
  type Ga4ReportResponse,
  isGa4Configured,
  runGa4RealtimeReport,
  runGa4Report,
} from "../lib/ga4";
import { type Ctx, json, type Router } from "../lib/http";
import { log } from "../lib/logger";

// All known BudgetCategory values. Keep in sync with shared/types.ts —
// inlining as a const tuple keeps the per-category iteration order stable
// for the response shape regardless of how the underlying data lands.
const BUDGET_CATEGORIES: readonly BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
];

// All known SupplierCategory values. Mirrors shared/suppliers.ts; same
// reasoning as BUDGET_CATEGORIES — the UI needs every row even when picks
// are empty so the table doesn't develop gaps.
const SUPPLIER_CATEGORIES: readonly SupplierCategory[] = SUPPLIER_GROUPS.flatMap(
  (g) => g.categories,
);

// All known CoupleStatus values. Listed explicitly so the response always
// surfaces a zero row for statuses the DB hasn't seen yet — the admin UI
// renders the full four-row table regardless of population.
const COUPLE_STATUSES: readonly CoupleStatus[] = ["active", "paused", "deleting", "archived"];

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_STATS: AdminAnalyticsStats = {
  count: 0,
  sum: 0,
  avg: 0,
  median: 0,
  p25: 0,
  p75: 0,
};

/** Quartile + headline distribution helper. Sorts the input copy ascending,
 *  computes median / p25 / p75 via linear interpolation between adjacent
 *  ordered samples, and rounds the mean to the nearest integer (all values
 *  on the analytics surface are integer Forint). Empty input → all-zeros so
 *  callers don't have to guard against division-by-zero. */
function quantiles(values: number[]): AdminAnalyticsStats {
  if (values.length === 0) return { ...EMPTY_STATS };
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / count);
  const pick = (q: number): number => {
    if (count === 1) return sorted[0] ?? 0;
    const pos = q * (count - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const loVal = sorted[lo] ?? 0;
    const hiVal = sorted[hi] ?? loVal;
    if (lo === hi) return loVal;
    const frac = pos - lo;
    return Math.round(loVal + (hiVal - loVal) * frac);
  };
  return {
    count,
    sum,
    avg,
    median: pick(0.5),
    p25: pick(0.25),
    p75: pick(0.75),
  };
}

// ─── /api/admin/analytics/money ──────────────────────────────────────────

function moneyAnalytics(audience: AnalyticsAudience): AdminMoneyAnalytics {
  // Active universe: every couple the audience filter admits. The baseline
  // excludes demo / admin / test / archived / deleting; toggles add them back.
  const couples = db
    .prepare(
      `SELECT id, budget_ceiling_huf FROM couples WHERE ${coupleAudienceSql("couples", audience)}`,
    )
    .all() as { id: number; budget_ceiling_huf: number | null }[];

  const coupleIds = new Set(couples.map((c) => c.id));

  // Per-couple budget totals + per-category buckets, grouped server-side.
  // We pull only `budget_lines` rows whose couple_id is part of the active
  // universe — anything else is residue we ignore.
  const lineRows = db
    .prepare("SELECT couple_id, category, planned_huf, actual_huf FROM budget_lines")
    .all() as { couple_id: number; category: string; planned_huf: number; actual_huf: number }[];

  const plannedByCouple = new Map<number, number>();
  const actualByCouple = new Map<number, number>();
  const hasActualByCouple = new Set<number>();
  const hasLineByCouple = new Set<number>();
  // Per-category accumulator. Key = BudgetCategory string; value tracks
  // running sums + the set of couples that have at least one row in that
  // category (denominator for couples_with_data).
  const perCat = new Map<
    string,
    { planned_sum: number; actual_sum: number; couples: Set<number> }
  >();

  for (const line of lineRows) {
    if (!coupleIds.has(line.couple_id)) continue;
    hasLineByCouple.add(line.couple_id);
    plannedByCouple.set(
      line.couple_id,
      (plannedByCouple.get(line.couple_id) ?? 0) + line.planned_huf,
    );
    actualByCouple.set(line.couple_id, (actualByCouple.get(line.couple_id) ?? 0) + line.actual_huf);
    if (line.actual_huf > 0) hasActualByCouple.add(line.couple_id);

    let bucket = perCat.get(line.category);
    if (!bucket) {
      bucket = { planned_sum: 0, actual_sum: 0, couples: new Set() };
      perCat.set(line.category, bucket);
    }
    bucket.planned_sum += line.planned_huf;
    bucket.actual_sum += line.actual_huf;
    bucket.couples.add(line.couple_id);
  }

  // couples_with_budget = ceiling set OR ≥1 budget_lines row. A couple with
  // a single zero-planned line still counts — they engaged with the budget
  // module even if no number landed yet.
  let couplesWithBudget = 0;
  const ceilingValues: number[] = [];
  for (const c of couples) {
    const hasCeiling = c.budget_ceiling_huf !== null && c.budget_ceiling_huf !== undefined;
    if (hasCeiling || hasLineByCouple.has(c.id)) couplesWithBudget += 1;
    if (hasCeiling && c.budget_ceiling_huf !== null) {
      ceilingValues.push(c.budget_ceiling_huf);
    }
  }

  const plannedValues = couples
    .map((c) => plannedByCouple.get(c.id))
    .filter((v): v is number => v !== undefined);
  const actualValues = couples
    .map((c) => actualByCouple.get(c.id))
    .filter((v): v is number => v !== undefined);

  const perCategory = BUDGET_CATEGORIES.map((category) => {
    const bucket = perCat.get(category);
    if (!bucket || bucket.couples.size === 0) {
      return {
        category,
        avg_planned: 0,
        avg_actual: 0,
        couples_with_data: 0,
      };
    }
    const n = bucket.couples.size;
    return {
      category,
      avg_planned: Math.round(bucket.planned_sum / n),
      avg_actual: Math.round(bucket.actual_sum / n),
      couples_with_data: n,
    };
  });

  // Right-anchored histograms. Each bucket carries the inclusive upper bound
  // in HUF; the trailing 30M bucket catches the open-ended high tail. Zero
  // is the "not given" pseudo-bucket. Two parallel views over the same
  // couples:
  //  - budget_histogram bins the top-level `budget_ceiling_huf`.
  //  - cost_histogram bins the SUM of per-line `planned_huf` (the couple's
  //    total planned wedding cost), so couples who skipped the ceiling but
  //    filled in per-category amounts still land in a real bucket.
  const BUCKET_MAX_HUF = [1_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000];
  const makeHistogram = () => [
    { bucket_max_huf: 0, count: 0 },
    ...BUCKET_MAX_HUF.map((b) => ({ bucket_max_huf: b, count: 0 })),
  ];
  // Place one HUF amount into `histogram`. Missing / non-positive values land
  // in the `bucket_max_huf=0` "not given" pseudo-bucket; everything else falls
  // into the first bucket whose inclusive upper bound it clears, or the 30M+
  // open-ended tail.
  const place = (
    histogram: Array<{ bucket_max_huf: number; count: number }>,
    huf: number | null | undefined,
  ) => {
    if (huf === null || huf === undefined || huf <= 0) {
      const row = histogram[0];
      if (row) row.count += 1;
      return;
    }
    for (let i = 0; i < BUCKET_MAX_HUF.length - 1; i += 1) {
      const max = BUCKET_MAX_HUF[i];
      if (max !== undefined && huf <= max) {
        const row = histogram[i + 1];
        if (row) row.count += 1;
        return;
      }
    }
    const row = histogram[histogram.length - 1];
    if (row) row.count += 1;
  };

  const histogram = makeHistogram();
  const costHistogram = makeHistogram();
  for (const c of couples) {
    place(histogram, c.budget_ceiling_huf);
    place(costHistogram, plannedByCouple.get(c.id) ?? 0);
  }

  return {
    couples_with_budget: couplesWithBudget,
    couples_with_actuals: hasActualByCouple.size,
    budget_ceiling_huf: quantiles(ceilingValues),
    planned_huf: quantiles(plannedValues),
    actual_huf: quantiles(actualValues),
    per_category: perCategory,
    budget_histogram: histogram,
    cost_histogram: costHistogram,
  };
}

function handleMoney(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(moneyAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/activity ───────────────────────────────────────

function activityAnalytics(audience: AnalyticsAudience): AdminActivityAnalytics {
  const now = Date.now();
  const w24h = now - DAY_MS;
  const w7d = now - 7 * DAY_MS;
  const w30d = now - 30 * DAY_MS;
  // Previous-period boundaries for the signups "vs prev" delta: the 7d window
  // before the current 7d ([14d, 7d)) and the 30d before the current 30d
  // ([60d, 30d)). Only signups (discrete created_at events) get this — active
  // users are keyed on a single last_seen_at point, so a windowed previous
  // count there would silently undercount users active in both windows.
  const w14d = now - 14 * DAY_MS;
  const w60d = now - 60 * DAY_MS;

  // Purged tombstones use `…@purged.local` for the email — exclude so the
  // signup count doesn't keep ticking up every time someone deletes their
  // account.
  const NOT_PURGED = "email NOT LIKE '%@purged.local'";
  // Demo workspaces are seeded by the landing "Try the demo" button under
  // `demo-…@demo.weddly.local` users (couples.is_demo = 1). They'd otherwise
  // inflate every headline — a demo signs up verified + onboarded in one
  // shot. So the headline numbers are REAL (non-demo) traffic, and we
  // surface a parallel `demo` breakdown the UI renders as a small note.
  const IS_DEMO = "email LIKE '%@demo.weddly.local'";
  // Headline traffic obeys the audience filter (real-only by default). The
  // DEMO cohort is always surfaced separately as a small "demo: N" note,
  // independent of the filter, so we keep its own predicate.
  const REAL = userAudienceSql("users", audience);
  const DEMO = `${NOT_PURGED} AND ${IS_DEMO}`;

  const countSince = (cond: string, since: number): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE ${cond} AND created_at >= ?`)
        .get(since) as {
        n: number;
      }
    ).n;
  const totalCount = (cond: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${cond}`).get() as { n: number }).n;
  const activeSince = (cond: string, since: number): number =>
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT id) AS n FROM users WHERE ${cond} AND last_seen_at IS NOT NULL AND last_seen_at >= ?`,
        )
        .get(since) as { n: number }
    ).n;
  const verifiedCount = (cond: string): number =>
    (
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${cond} AND verified_email = 1`).get() as {
        n: number;
      }
    ).n;
  const onboardedCount = (cond: string): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE ${cond} AND couple_id IS NOT NULL`)
        .get() as { n: number }
    ).n;

  const totalSignups = totalCount(REAL);
  // Signups that haven't clicked their verify link yet are NOT in `users` —
  // they wait in `pending_signups` (see domain/pending_signups.ts). Counting
  // only the users table would pin pct_verified at ~100%, because a couples
  // account is now born verified: the click is what creates it. Adding the
  // pending rows back is what keeps "how many actually confirm?" answerable.
  const pendingSignups = (
    db.prepare("SELECT COUNT(*) AS n FROM pending_signups").get() as { n: number }
  ).n;
  const registered = totalSignups + pendingSignups;
  const verified = verifiedCount(REAL);
  const onboarded = onboardedCount(REAL);

  // Demo-only breakdown (same windows + predicates, IS_DEMO) for the UI's
  // small "demo: N" notes under each real headline.
  const demoCouplesTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 1").get() as { n: number }
  ).n;

  // Initialise every CoupleStatus to 0 — the GROUP BY only surfaces rows we
  // have, so without this scaffold the UI couldn't render a fixed table.
  const couplesByStatus: Record<CoupleStatus, number> = {
    active: 0,
    paused: 0,
    deleting: 0,
    archived: 0,
  };
  const statusRows = db
    .prepare("SELECT status, COUNT(*) AS n FROM couples WHERE is_demo = 0 GROUP BY status")
    .all() as { status: string; n: number }[];
  for (const r of statusRows) {
    if ((COUPLE_STATUSES as readonly string[]).includes(r.status)) {
      couplesByStatus[r.status as CoupleStatus] = r.n;
    }
  }

  // Top audit actions in the last 30 days. Tie-break on action ASC so the
  // listing is deterministic across calls (otherwise SQLite returns
  // arbitrary insertion order when COUNT collides).
  const topActions = db
    .prepare(
      `SELECT action, COUNT(*) AS n
         FROM audit_log
        WHERE created_at >= ?
        GROUP BY action
        ORDER BY n DESC, action ASC
        LIMIT 12`,
    )
    .all(w30d) as { action: string; n: number }[];

  // Daily signup counts for the last 14 days. Pull per-day counts from
  // SQLite (bucketed by UTC midnight) into a Map, then walk the calendar
  // window in order so zero-days surface as `{ date, count: 0 }` and the
  // x-axis stays uniform.
  // Account KIND, split three ways and mutually exclusive so the series sum to
  // the total: a planner is `user_type='planner'`, a vendor is `role='vendor'`
  // that isn't also a planner, and a couple is everything else — the same
  // partition the Felhasználók / Szervezők / Szolgáltatók pages list under.
  const IS_PLANNER = "user_type = 'planner'";
  const IS_VENDOR = "role = 'vendor' AND user_type != 'planner'";
  const IS_COUPLE = `NOT (${IS_PLANNER}) AND NOT (${IS_VENDOR})`;

  /** The four headline windows for one account kind, always ANDed with the
   *  active audience filter so a kind split can never show accounts the rest
   *  of the page is hiding. */
  const kindWindows = (kind: string) => ({
    last_24h: countSince(`${REAL} AND (${kind})`, w24h),
    last_7d: countSince(`${REAL} AND (${kind})`, w7d),
    last_30d: countSince(`${REAL} AND (${kind})`, w30d),
    total: totalCount(`${REAL} AND (${kind})`),
  });

  const since14 = now - 14 * DAY_MS;
  const dailyRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d,
              COUNT(*) AS n,
              SUM(CASE WHEN ${IS_PLANNER} THEN 1 ELSE 0 END) AS planners,
              SUM(CASE WHEN ${IS_VENDOR} THEN 1 ELSE 0 END) AS vendors
         FROM users
        WHERE ${REAL} AND created_at >= ?
        GROUP BY d`,
    )
    .all(since14) as { d: string; n: number; planners: number; vendors: number }[];
  const dailyMap = new Map(dailyRows.map((r) => [r.d, r]));

  const signupsDaily: { date: string; count: number; planners: number; vendors: number }[] = [];
  // Walk oldest → newest. Date arithmetic stays in UTC so the dashboard's
  // x-axis lines up regardless of the admin's local timezone.
  const startMs = now - 13 * DAY_MS;
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(startMs + i * DAY_MS);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const row = dailyMap.get(iso);
    signupsDaily.push({
      date: iso,
      count: row?.n ?? 0,
      planners: row?.planners ?? 0,
      vendors: row?.vendors ?? 0,
    });
  }

  return {
    signups: {
      last_24h: countSince(REAL, w24h),
      last_7d: countSince(REAL, w7d),
      last_30d: countSince(REAL, w30d),
      total: totalSignups,
      prev_7d: countSince(REAL, w14d) - countSince(REAL, w7d),
      prev_30d: countSince(REAL, w60d) - countSince(REAL, w30d),
    },
    active_users: {
      last_24h: activeSince(REAL, w24h),
      last_7d: activeSince(REAL, w7d),
      last_30d: activeSince(REAL, w30d),
    },
    onboarding_funnel: {
      registered,
      verified,
      onboarded,
      pct_verified: registered === 0 ? 0 : verified / registered,
      pct_onboarded: registered === 0 ? 0 : onboarded / registered,
    },
    couples_by_status: couplesByStatus,
    top_actions: topActions.map((r) => ({ action: r.action, count: r.n })),
    signups_daily: signupsDaily,
    signups_by_kind: {
      couples: kindWindows(IS_COUPLE),
      planners: kindWindows(IS_PLANNER),
      vendors: kindWindows(IS_VENDOR),
    },
    demo: {
      signups: {
        last_24h: countSince(DEMO, w24h),
        last_7d: countSince(DEMO, w7d),
        last_30d: countSince(DEMO, w30d),
        total: totalCount(DEMO),
      },
      active_users: {
        last_24h: activeSince(DEMO, w24h),
        last_7d: activeSince(DEMO, w7d),
        last_30d: activeSince(DEMO, w30d),
      },
      onboarding_funnel: {
        registered: totalCount(DEMO),
        verified: verifiedCount(DEMO),
        onboarded: onboardedCount(DEMO),
      },
      couples_total: demoCouplesTotal,
    },
  };
}

function handleActivity(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(activityAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/picks ──────────────────────────────────────────

/** Classify a couple_picks.supplier_id into one of the three sources.
 *  - Community ids are the `c{N}` strings minted by community_suppliers.ts.
 *  - Curated ids are URL-slug strings from suppliers_data.ts (e.g.
 *    "etyeki-kuria"). We test set membership directly so a future curated
 *    slug that happens to begin with "c" doesn't mis-classify.
 *  - Everything else (16-char DIY hex, anything weird) is treated as DIY. */
function classifySource(
  supplierId: string,
  curatedIds: Set<string>,
): "curated" | "community" | "diy" {
  if (curatedIds.has(supplierId)) return "curated";
  if (/^c\d+$/.test(supplierId)) return "community";
  return "diy";
}

function picksAnalytics(audience: AnalyticsAudience): AdminPicksAnalytics {
  // Every pick query joins through to the owning couple so the audience
  // filter applies — without it, demo + admin picks inflate the volume.
  const COUPLE_OK = coupleAudienceSql("c", audience);
  const totalPicks = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM couple_picks p JOIN couples c ON c.id = p.couple_id WHERE ${COUPLE_OK}`,
      )
      .get() as { n: number }
  ).n;
  // Couple population in scope — the honest denominator for "how many couples
  // have engaged with picks at all", as opposed to category coverage which is
  // relative to couples that already made >=1 pick.
  const totalCouples = (
    db.prepare(`SELECT COUNT(*) AS n FROM couples c WHERE ${COUPLE_OK}`).get() as { n: number }
  ).n;

  // Per-couple pick counts. Couples with zero picks are intentionally
  // excluded so the median doesn't get dragged to 0 — the analytics
  // surface documents this behaviour.
  const perCoupleRows = db
    .prepare(
      `SELECT p.couple_id AS couple_id, COUNT(*) AS n
         FROM couple_picks p JOIN couples c ON c.id = p.couple_id
        WHERE ${COUPLE_OK}
        GROUP BY p.couple_id`,
    )
    .all() as { couple_id: number; n: number }[];
  const picksPerCouple = quantiles(perCoupleRows.map((r) => r.n));

  // Top picks. Tie-broken on supplier_id ASC for a stable response shape.
  const topRows = db
    .prepare(
      `SELECT p.supplier_id AS supplier_id, p.category AS category, COUNT(*) AS n
         FROM couple_picks p JOIN couples c ON c.id = p.couple_id
        WHERE ${COUPLE_OK}
        GROUP BY p.supplier_id, p.category
        ORDER BY n DESC, supplier_id ASC
        LIMIT 20`,
    )
    .all() as { supplier_id: string; category: string; n: number }[];

  // Build name lookups once. The curated map is keyed by slug; the
  // community map by the `c${row.id}` string the public API returns; the
  // DIY map by the random hex id (couple_suppliers.id is the PK).
  const curatedById = new Map(DIRECTORY.map((s) => [s.id, s.name]));
  const curatedIds = new Set(curatedById.keys());

  const communityRows = listActiveCommunitySuppliers();
  const communityById = new Map(communityRows.map((r) => [`c${r.id}`, r.name]));

  const diyRows = db.prepare("SELECT id, name FROM couple_suppliers").all() as {
    id: string;
    name: string;
  }[];
  const diyById = new Map(diyRows.map((r) => [r.id, r.name]));

  const topPicks = topRows.map((r) => {
    const source = classifySource(r.supplier_id, curatedIds);
    let displayName: string | undefined;
    if (source === "curated") displayName = curatedById.get(r.supplier_id);
    else if (source === "community") displayName = communityById.get(r.supplier_id);
    else displayName = diyById.get(r.supplier_id);
    return {
      supplier_id: r.supplier_id,
      category: r.category as SupplierCategory,
      pick_count: r.n,
      source,
      // Fall back to the raw id so the UI always has a renderable label,
      // even when the underlying supplier row has been deleted.
      display_name: displayName ?? r.supplier_id,
    };
  });

  // Category coverage. Denominator is "couples with at least one pick" —
  // couples that haven't engaged with picks at all don't appear in either
  // half of the picked/missing split.
  const allPicks = db
    .prepare(
      `SELECT p.couple_id AS couple_id, p.category AS category, p.supplier_id AS supplier_id
         FROM couple_picks p JOIN couples c ON c.id = p.couple_id
        WHERE ${COUPLE_OK}`,
    )
    .all() as { couple_id: number; category: string; supplier_id: string }[];
  const couplesWithAny = new Set(allPicks.map((p) => p.couple_id));
  const couplesByCategory = new Map<string, Set<number>>();
  for (const p of allPicks) {
    let set = couplesByCategory.get(p.category);
    if (!set) {
      set = new Set();
      couplesByCategory.set(p.category, set);
    }
    set.add(p.couple_id);
  }
  const denom = Math.max(1, couplesWithAny.size);
  const categoryCoverage = SUPPLIER_CATEGORIES.map((category) => {
    const picked = couplesByCategory.get(category)?.size ?? 0;
    return {
      category,
      picked,
      missing: couplesWithAny.size - picked,
      coverage_pct: picked / denom,
    };
  });

  // Source breakdown across every pick row (NOT distinct couples — the
  // dashboard wants raw pick volume by source).
  const sourceBreakdown = { curated: 0, community: 0, diy: 0 };
  for (const p of allPicks) {
    sourceBreakdown[classifySource(p.supplier_id, curatedIds)] += 1;
  }

  // Weekly pick volume over the last 12 Monday-anchored UTC weeks — a trend so
  // the dashboard can tell real growth from a flat or newly-launched feature.
  const PICK_TREND_WEEKS = 12;
  const weekMs = 7 * DAY_MS;
  const firstWeekStart = weekStartUtc(Date.now()) - (PICK_TREND_WEEKS - 1) * weekMs;
  const pickedAtRows = db
    .prepare(
      `SELECT p.picked_at AS picked_at
         FROM couple_picks p JOIN couples c ON c.id = p.couple_id
        WHERE ${COUPLE_OK} AND p.picked_at >= ?`,
    )
    .all(firstWeekStart) as { picked_at: number }[];
  const weekBins = new Array<number>(PICK_TREND_WEEKS).fill(0);
  for (const r of pickedAtRows) {
    const idx = Math.floor((r.picked_at - firstWeekStart) / weekMs);
    if (idx >= 0 && idx < PICK_TREND_WEEKS) {
      weekBins[idx] = (weekBins[idx] ?? 0) + 1;
    }
  }
  const picksWeekly = weekBins.map((count, i) => ({
    week_start: utcDateKey(firstWeekStart + i * weekMs),
    count,
  }));

  return {
    total_picks: totalPicks,
    total_couples: totalCouples,
    couples_with_any_pick: couplesWithAny.size,
    picks_per_couple: picksPerCouple,
    top_picks: topPicks,
    category_coverage: categoryCoverage,
    source_breakdown: sourceBreakdown,
    picks_weekly: picksWeekly,
  };
}

function handlePicks(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(picksAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/engagement ─────────────────────────────────────

// Two adjacent audit rows from the same actor count as the same session as
// long as they're within this many minutes apart. 30 is the de-facto
// industry default (matches GA, Mixpanel) and is documented in
// shared/admin_analytics.ts.
const SESSION_GAP_MINUTES = 30;
const MS_PER_MINUTE = 60 * 1000;
const SESSION_GAP_MS = SESSION_GAP_MINUTES * MS_PER_MINUTE;

const TOP_FEATURE_LIMIT = 8;
const TOP_USER_LIMIT = 10;

function engagementAnalytics(audience: AnalyticsAudience): AdminEngagementAnalytics {
  const now = Date.now();
  const windowStart = now - 30 * DAY_MS;
  const USER_OK = userAudienceSql("u", audience);

  // Pull the 30-day audit window in one shot, pre-sorted by actor + time so
  // the JS-side session walker is a single linear pass. Anonymous rows
  // (actor_user_id IS NULL — system tasks, RSVP submissions, etc.) are
  // excluded; sessions are inherently a per-user concept.
  const auditRows = db
    .prepare(
      `SELECT a.actor_user_id AS actor_user_id, a.action AS action, a.created_at AS created_at
         FROM audit_log a JOIN users u ON u.id = a.actor_user_id
        WHERE a.created_at >= ? AND a.actor_user_id IS NOT NULL AND ${USER_OK}
        ORDER BY a.actor_user_id ASC, a.created_at ASC`,
    )
    .all(windowStart) as { actor_user_id: number; action: string; created_at: number }[];

  // ─── Sessions: walk per-user, break on >30min gap. ─────────────────────
  const sessionDurations: number[] = [];
  const activeUsers = new Set<number>();
  let currentActor: number | null = null;
  let sessionStart = 0;
  let sessionLastSeen = 0;

  const flushSession = (): void => {
    if (currentActor === null) return;
    const elapsedMs = sessionLastSeen - sessionStart;
    // Single-row bursts count as 1-minute sessions so the median doesn't
    // collapse to zero (spec'd in shared/admin_analytics.ts).
    const minutes = Math.max(1, Math.round(elapsedMs / MS_PER_MINUTE));
    sessionDurations.push(minutes);
  };

  for (const row of auditRows) {
    activeUsers.add(row.actor_user_id);
    if (row.actor_user_id !== currentActor) {
      // New actor — close the previous session, start a fresh one.
      flushSession();
      currentActor = row.actor_user_id;
      sessionStart = row.created_at;
      sessionLastSeen = row.created_at;
      continue;
    }
    if (row.created_at - sessionLastSeen > SESSION_GAP_MS) {
      // Gap exceeded — flush the closed session and start a new one for the
      // same actor.
      flushSession();
      sessionStart = row.created_at;
      sessionLastSeen = row.created_at;
      continue;
    }
    sessionLastSeen = row.created_at;
  }
  flushSession();

  const sessionDurationMinutes = quantiles(sessionDurations);
  const totalSessions = sessionDurations.length;

  // ─── Retention: cohort = users registered ≥30d ago. ────────────────────
  const cohortCutoff = now - 30 * DAY_MS;
  const cohortRows = db
    .prepare(
      `SELECT u.id AS id, u.created_at AS created_at, u.last_seen_at AS last_seen_at FROM users u
        WHERE u.status = 'active' AND u.created_at <= ? AND ${USER_OK}`,
    )
    .all(cohortCutoff) as {
    id: number;
    created_at: number;
    last_seen_at: number | null;
  }[];

  // Pre-compute the earliest audit_log timestamp per user (across all time,
  // not just the 30-day analytics window). Retention asks "did this user
  // EVER come back N days after signup", so the activity window must be
  // unbounded on the late side.
  const auditByUser = new Map<number, number[]>();
  if (cohortRows.length > 0) {
    const auditAll = db
      .prepare(
        `SELECT a.actor_user_id AS actor_user_id, a.created_at AS created_at
           FROM audit_log a JOIN users u ON u.id = a.actor_user_id
          WHERE a.actor_user_id IS NOT NULL AND ${USER_OK}
          ORDER BY a.actor_user_id ASC, a.created_at ASC`,
      )
      .all() as { actor_user_id: number; created_at: number }[];
    for (const r of auditAll) {
      const arr = auditByUser.get(r.actor_user_id);
      if (arr) arr.push(r.created_at);
      else auditByUser.set(r.actor_user_id, [r.created_at]);
    }
  }

  // D+60 settles only for users old enough to have their 60-days-later boundary
  // in the past, so it runs over the >=60d subset of the cohort with its own
  // size (cohort60) rather than diluting the rate with users who can't qualify.
  const sixtyCutoff = now - 60 * DAY_MS;
  let d1Hits = 0;
  let d7Hits = 0;
  let d30Hits = 0;
  let d60Hits = 0;
  let cohort60 = 0;
  for (const u of cohortRows) {
    const audits = auditByUser.get(u.id) ?? [];
    const lastSeen = u.last_seen_at ?? 0;
    const t1 = u.created_at + 1 * DAY_MS;
    const t7 = u.created_at + 7 * DAY_MS;
    const t30 = u.created_at + 30 * DAY_MS;
    // Audits are sorted ASC per user, so the last element is the latest
    // activity timestamp. A user counts as "retained at D+N" if EITHER
    // their latest audit_log row is at/after that boundary OR their
    // last_seen_at has moved past it. last_seen_at is updated on every
    // authed request, so it captures lurkers who didn't mutate anything.
    const latestAudit = audits.length > 0 ? (audits[audits.length - 1] ?? 0) : 0;
    const hasAfter = (boundary: number): boolean => lastSeen >= boundary || latestAudit >= boundary;
    if (hasAfter(t1)) d1Hits += 1;
    if (hasAfter(t7)) d7Hits += 1;
    if (hasAfter(t30)) d30Hits += 1;
    if (u.created_at <= sixtyCutoff) {
      cohort60 += 1;
      if (hasAfter(u.created_at + 60 * DAY_MS)) d60Hits += 1;
    }
  }

  const cohortSize = cohortRows.length;
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const retention =
    cohortSize === 0
      ? { cohort_size: 0, d1: null, d7: null, d30: null, d60: null, cohort_size_d60: cohort60 }
      : {
          cohort_size: cohortSize,
          d1: round3(d1Hits / cohortSize),
          d7: round3(d7Hits / cohortSize),
          d30: round3(d30Hits / cohortSize),
          d60: cohort60 === 0 ? null : round3(d60Hits / cohort60),
          cohort_size_d60: cohort60,
        };

  // ─── Time-of-day matrix: 7 rows (Mon..Sun) × 24 cols (0..23 UTC). ──────
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let maxCell = 0;
  for (const row of auditRows) {
    const d = new Date(row.created_at);
    // JS getUTCDay: 0=Sun..6=Sat. Spec wants 0=Mon..6=Sun, so remap.
    const dow = (d.getUTCDay() + 6) % 7;
    const hour = d.getUTCHours();
    const rowMatrix = matrix[dow];
    if (!rowMatrix) continue;
    const cur = rowMatrix[hour] ?? 0;
    const next = cur + 1;
    rowMatrix[hour] = next;
    if (next > maxCell) maxCell = next;
  }

  // ─── Top features: action prefix before the first ".". ─────────────────
  const featureCounts = new Map<string, { count: number; users: Set<number> }>();
  for (const row of auditRows) {
    const dot = row.action.indexOf(".");
    const feature = dot === -1 ? row.action : row.action.slice(0, dot);
    let bucket = featureCounts.get(feature);
    if (!bucket) {
      bucket = { count: 0, users: new Set() };
      featureCounts.set(feature, bucket);
    }
    bucket.count += 1;
    bucket.users.add(row.actor_user_id);
  }
  const topFeatures = [...featureCounts.entries()]
    .map(([feature, b]) => ({ feature, count: b.count, users: b.users.size }))
    // Sort by count desc, tie-broken alphabetically for a stable response.
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
    .slice(0, TOP_FEATURE_LIMIT);

  // ─── Top users: per-actor event counts across the same 30d window. ─────
  // The audience filter already scoped `auditRows` (demo / admin / test are
  // dropped by default), so the leaderboard inherits it without a second
  // cohort check here.
  const eventsByUser = new Map<number, number>();
  for (const row of auditRows) {
    eventsByUser.set(row.actor_user_id, (eventsByUser.get(row.actor_user_id) ?? 0) + 1);
  }
  const topUserIds = [...eventsByUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_USER_LIMIT)
    .map(([id]) => id);
  const userRows =
    topUserIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, full_name, email, last_seen_at FROM users
              WHERE id IN (${topUserIds.map(() => "?").join(",")})`,
          )
          .all(...topUserIds) as {
          id: number;
          full_name: string;
          email: string;
          last_seen_at: number | null;
        }[]);
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const topUsers = topUserIds
    .map((id) => {
      const u = userMap.get(id);
      if (!u) return null;
      return {
        user_id: u.id,
        full_name: u.full_name,
        email: u.email,
        event_count: eventsByUser.get(id) ?? 0,
        last_seen_at: u.last_seen_at,
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)
    .slice(0, TOP_USER_LIMIT);

  return {
    session_duration_minutes: sessionDurationMinutes,
    total_sessions: totalSessions,
    active_users_30d: activeUsers.size,
    retention,
    time_of_day: { matrix, max: maxCell },
    top_features: topFeatures,
    top_users: topUsers,
  };
}

// ─── /api/admin/analytics/demo ──────────────────────────────────────────

function demoAnalytics(): AdminDemoAnalytics {
  const now = Date.now();
  const cutoff24h = now - 1 * DAY_MS;
  const cutoff7d = now - 7 * DAY_MS;
  const cutoff30d = now - 30 * DAY_MS;

  // 14-day daily bucketing. Same UTC YYYY-MM-DD scheme as the activity
  // surface's signups_daily so the frontend can reuse the chart.
  const isoDay = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const emptyDays = (): Array<{ date: string; count: number }> => {
    const days: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(todayUtc.getTime() - i * DAY_MS);
      days.push({ date: isoDay(d), count: 0 });
    }
    return days;
  };

  interface LiveRow {
    id: number;
    created_at: number;
  }
  interface EventRow {
    entity_id: number;
    created_at: number;
    action: string;
  }
  interface UsageRow {
    kind: string;
    source_id: number;
    created_at: number;
    lifetime_seconds: number;
    feature_counts_json: string;
  }

  // ─── The three cohorts, one per demo entry point. ──────────────────────
  // Couple demos are visitor-started workspaces (demo_kind='couple'; NULL
  // covers pre-column rows, which reap within one 4h sweep). The client
  // couples a planner/vendor demo seeds are demo_kind='*_client' props and
  // count NOWHERE — before the split they inflated every headline, since
  // one planner demo start seeds several is_demo couples.
  const coupleLive = db
    .prepare(
      `SELECT id, created_at FROM couples
        WHERE is_demo = 1 AND status != 'deleting'
          AND COALESCE(demo_kind, 'couple') = 'couple'`,
    )
    .all() as LiveRow[];
  const plannerLive = db
    .prepare(
      `SELECT id, created_at FROM users
        WHERE user_type = 'planner' AND email LIKE '%@demo.weddly.local'`,
    )
    .all() as LiveRow[];
  const vendorLive = db
    .prepare(
      `SELECT id, created_at FROM users
        WHERE role = 'vendor' AND email LIKE '%@demo.weddly.local'`,
    )
    .all() as LiveRow[];

  // Audit trail per cohort. Couple demos match on audit.couple_id (the
  // demo.start row is stamped with it); planner/vendor demos match on the
  // ACTOR, so actions a planner-demo visitor takes inside a seeded client
  // workspace land in the planner bucket, not the couple one.
  const eventsFor = (column: "couple_id" | "actor_user_id", ids: number[]): EventRow[] => {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    return db
      .prepare(
        `SELECT ${column} AS entity_id, created_at, action FROM audit_log
          WHERE ${column} IN (${placeholders})`,
      )
      .all(...ids) as EventRow[];
  };

  // Historic snapshots — one row per ever-purged demo, written by the
  // sweeps right before hard-delete. *_client rows are excluded the same
  // way their live couples are.
  const usageRows = db
    .prepare(
      `SELECT kind, source_couple_id AS source_id, created_at,
              lifetime_seconds, feature_counts_json
         FROM demo_usage`,
    )
    .all() as UsageRow[];

  const statsFor = (live: LiveRow[], events: EventRow[], usage: UsageRow[]): AdminDemoTypeStats => {
    // Starts (new_demos + demos_daily) blend live rows with purged
    // snapshots — demos reap after ~4h, so live rows alone would zero out
    // every day but today.
    let new24h = 0;
    let new7d = 0;
    let new30d = 0;
    const days = emptyDays();
    const dateIndex = new Map(days.map((d, i) => [d.date, i]));
    const starts = [...live.map((r) => r.created_at), ...usage.map((u) => u.created_at)];
    for (const ts of starts) {
      if (ts >= cutoff24h) new24h += 1;
      if (ts >= cutoff7d) new7d += 1;
      if (ts >= cutoff30d) new30d += 1;
      const d = new Date(ts);
      d.setUTCHours(0, 0, 0, 0);
      const idx = dateIndex.get(isoDay(d));
      if (idx !== undefined) {
        const bucket = days[idx];
        if (bucket) bucket.count += 1;
      }
    }

    const featureTotals = new Map<string, { count: number; demos: Set<string> }>();
    const bump = (feature: string, n: number, demoKey: string): void => {
      let bucket = featureTotals.get(feature);
      if (!bucket) {
        bucket = { count: 0, demos: new Set() };
        featureTotals.set(feature, bucket);
      }
      bucket.count += n;
      bucket.demos.add(demoKey);
    };

    let events30d = 0;
    const active = new Set<number>();
    for (const e of events) {
      if (e.created_at >= cutoff30d) events30d += 1;
      if (e.created_at >= cutoff24h) active.add(e.entity_id);
      const dot = e.action.indexOf(".");
      bump(dot === -1 ? e.action : e.action.slice(0, dot), 1, `live:${e.entity_id}`);
    }
    for (const u of usage) {
      let counts: Record<string, number> = {};
      try {
        counts = JSON.parse(u.feature_counts_json) as Record<string, number>;
      } catch {
        counts = {};
      }
      for (const [feature, n] of Object.entries(counts)) {
        bump(feature, n, `hist:${u.source_id}`);
      }
    }

    const topFeatures = [...featureTotals.entries()]
      .map(([feature, b]) => ({ feature, count: b.count, demos: b.demos.size }))
      .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
      .slice(0, 12);

    return {
      total: live.length,
      new_demos: { last_24h: new24h, last_7d: new7d, last_30d: new30d },
      demos_daily: days,
      active_24h: active.size,
      avg_events: live.length === 0 ? 0 : Math.round(events30d / live.length),
      events_30d: events30d,
      served_total: live.length + usage.length,
      avg_lifetime_seconds:
        usage.length === 0
          ? 0
          : Math.round(usage.reduce((s, u) => s + u.lifetime_seconds, 0) / usage.length),
      top_features: topFeatures,
    };
  };

  const byType: Record<AdminDemoKind, AdminDemoTypeStats> = {
    couple: statsFor(
      coupleLive,
      eventsFor(
        "couple_id",
        coupleLive.map((r) => r.id),
      ),
      usageRows.filter((u) => u.kind === "couple"),
    ),
    planner: statsFor(
      plannerLive,
      eventsFor(
        "actor_user_id",
        plannerLive.map((r) => r.id),
      ),
      usageRows.filter((u) => u.kind === "planner"),
    ),
    vendor: statsFor(
      vendorLive,
      eventsFor(
        "actor_user_id",
        vendorLive.map((r) => r.id),
      ),
      usageRows.filter((u) => u.kind === "vendor"),
    ),
  };

  // ─── Combined headline = sum of the three kinds. ───────────────────────
  const kinds = [byType.couple, byType.planner, byType.vendor];
  const sum = (pick: (k: AdminDemoTypeStats) => number): number =>
    kinds.reduce((acc, k) => acc + pick(k), 0);

  const totalDemos = sum((k) => k.total);
  const totalDemoEvents30d = sum((k) => k.events_30d);

  const combinedDays = emptyDays();
  for (const k of kinds) {
    k.demos_daily.forEach((d, i) => {
      const bucket = combinedDays[i];
      if (bucket) bucket.count += d.count;
    });
  }

  // Weighted lifetime mean — weights are each kind's purged-snapshot count.
  const lifetimeWeights = kinds.map((k) => k.served_total - k.total);
  const lifetimeWeightSum = lifetimeWeights.reduce((a, b) => a + b, 0);
  const avgLifetimeSeconds =
    lifetimeWeightSum === 0
      ? 0
      : Math.round(
          kinds.reduce((acc, k, i) => acc + k.avg_lifetime_seconds * (lifetimeWeights[i] ?? 0), 0) /
            lifetimeWeightSum,
        );

  // Cohorts are disjoint, so merged demo counts can simply add up.
  const mergedFeatures = new Map<string, { count: number; demos: number }>();
  for (const k of kinds) {
    for (const f of k.top_features) {
      const bucket = mergedFeatures.get(f.feature);
      if (bucket) {
        bucket.count += f.count;
        bucket.demos += f.demos;
      } else {
        mergedFeatures.set(f.feature, { count: f.count, demos: f.demos });
      }
    }
  }
  const topFeatures = [...mergedFeatures.entries()]
    .map(([feature, b]) => ({ feature, count: b.count, demos: b.demos }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
    .slice(0, 12);

  return {
    total_demos: totalDemos,
    new_demos: {
      last_24h: sum((k) => k.new_demos.last_24h),
      last_7d: sum((k) => k.new_demos.last_7d),
      last_30d: sum((k) => k.new_demos.last_30d),
    },
    demos_daily: combinedDays,
    active_demos_24h: sum((k) => k.active_24h),
    avg_events_per_demo: totalDemos === 0 ? 0 : Math.round(totalDemoEvents30d / totalDemos),
    total_demo_events_30d: totalDemoEvents30d,
    total_demos_served: sum((k) => k.served_total),
    avg_lifetime_seconds: avgLifetimeSeconds,
    top_features: topFeatures,
    by_type: byType,
  };
}

function handleDemo(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(demoAnalytics());
}

function handleEngagement(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(engagementAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/growth-funnel ────────────────────────────────────
//
// Read-side consumer for the growth_events table (P6b). Computes the funnel
// the founder's 60-day commitment metric is built on:
//   signup.started → signup.completed → couple.created → wedding_site.view
//                  → rsvp.page.view → rsvp.submitted
// Plus: top 7d attributed referrers, and the "stalled couple" outreach list
// (couples that created a workspace but haven't gotten a single site view yet).
//
// `signup.started` (register) → `signup.completed` (verify link clicked) is the
// email-confirmation drop-off. It's the first stage because it's now the widest
// point of the funnel: since the account is only minted at verify, everyone who
// never clicks is invisible past this step.

/** Funnel order — keep aligned with the dashboard column layout. */
const GROWTH_FUNNEL_KINDS = [
  "signup.started",
  "signup.completed",
  "couple.created",
  "wedding_site.view",
  "rsvp.page.view",
  "rsvp.submitted",
] as const;

function growthFunnelAnalytics(): AdminGrowthFunnelAnalytics {
  const nowTs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const window24 = nowTs - dayMs;
  const window7d = nowTs - 7 * dayMs;

  // Per-kind counts across (total, 24h, 7d). One pass over the table.
  const rows = db
    .prepare(
      `SELECT kind,
              COUNT(*) AS total,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_7d,
              MAX(created_at) AS last_event_at
         FROM growth_events
        GROUP BY kind`,
    )
    .all(window24, window7d) as Array<{
    kind: string;
    total: number;
    last_24h: number;
    last_7d: number;
    last_event_at: number | null;
  }>;
  const byKind = new Map(rows.map((r) => [r.kind, r] as const));

  // Build the funnel: each step's 7d count + conversion vs. the previous step.
  // Conversion null on step 0; null when prev=0 (avoids "NaN%" on a fresh deploy).
  const steps: AdminGrowthFunnelStep[] = GROWTH_FUNNEL_KINDS.map((kind, idx) => {
    const row = byKind.get(kind);
    const count_7d = row?.last_7d ?? 0;
    const count_24h = row?.last_24h ?? 0;
    let conversion_from_prev: number | null = null;
    if (idx > 0) {
      const prevKind = GROWTH_FUNNEL_KINDS[idx - 1];
      const prevCount = (prevKind && byKind.get(prevKind)?.last_7d) ?? 0;
      conversion_from_prev = prevCount > 0 ? Math.min(1, count_7d / prevCount) : null;
    }
    return { kind, count_7d, count_24h, conversion_from_prev };
  });

  // Top referrers from the last 7 days. `payload.referrer` is the curated
  // allow-list value (e.g. "rsvp" / "site" / "share"), not a raw URL.
  const refRows = db
    .prepare(
      `SELECT payload_json
         FROM growth_events
        WHERE kind = 'signup.from_referrer' AND created_at >= ?
          AND payload_json IS NOT NULL`,
    )
    .all(window7d) as Array<{ payload_json: string }>;
  const refCounts = new Map<string, number>();
  for (const r of refRows) {
    try {
      const p = JSON.parse(r.payload_json) as { referrer?: unknown };
      const src = typeof p.referrer === "string" && p.referrer.length > 0 ? p.referrer : null;
      if (!src) continue;
      refCounts.set(src, (refCounts.get(src) ?? 0) + 1);
    } catch {
      // ignore malformed legacy rows
    }
  }
  const referrers_7d = [...refCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // "Stalled" couples — created in last 7d, no wedding_site.view yet. The
  // sub-select pulls couple_ids with a recent `couple.created` row and
  // EXCEPT removes the ones with any wedding_site.view event ever. Caps at
  // 100 rows so the response stays small; admin tools paginate further.
  const stalledRows = db
    .prepare(
      `SELECT DISTINCT couple_id
         FROM growth_events
        WHERE kind = 'couple.created' AND created_at >= ? AND couple_id IS NOT NULL
        EXCEPT
       SELECT DISTINCT couple_id
         FROM growth_events
        WHERE kind = 'wedding_site.view' AND couple_id IS NOT NULL
        LIMIT 100`,
    )
    .all(window7d) as Array<{ couple_id: number }>;
  const stalled_couple_ids = stalledRows.map((r) => r.couple_id);

  const kinds = rows.map((r) => ({
    kind: r.kind,
    total: r.total,
    last_24h: r.last_24h,
    last_7d: r.last_7d,
    last_event_at: r.last_event_at,
  }));

  return { steps, referrers_7d, stalled_couple_ids, kinds };
}

function handleGrowthFunnel(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(growthFunnelAnalytics());
}

// ─── /api/admin/analytics/acquisition ───────────────────────────────────────
//
// Where signups come from, joined to the onboarding funnel. Reads the
// users.signup_country / device_type / locale / utm_* columns captured at
// registration, scoped by the audience filter. The headline is conversion BY
// dimension (signup → onboarded → active), so raw volume from a channel that
// never onboards can't masquerade as success.

const ACQUISITION_WINDOW_DAYS = 30;

interface AcqUserRow {
  created_at: number;
  signup_country: string | null;
  device_type: string | null;
  locale: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  couple_id: number | null;
  couple_status: string | null;
}

/** Accumulate signup/onboarded/active counts per dimension key. null keys are
 *  kept (they're meaningful: unknown country, untagged campaign). */
function rollupDimension(
  rows: AcqUserRow[],
  keyOf: (r: AcqUserRow) => string | null,
  opts: { skipNull?: boolean } = {},
): AcquisitionDimensionRow[] {
  const map = new Map<string | null, AcquisitionDimensionRow>();
  for (const r of rows) {
    const key = keyOf(r);
    if (opts.skipNull && key === null) continue;
    let row = map.get(key);
    if (!row) {
      row = { key, signups: 0, onboarded: 0, active: 0 };
      map.set(key, row);
    }
    row.signups += 1;
    if (r.couple_id !== null) row.onboarded += 1;
    if (r.couple_id !== null && r.couple_status === "active") row.active += 1;
  }
  // Sort by signups desc; the frontend re-sorts campaigns by activation quality.
  return [...map.values()].sort((a, b) => b.signups - a.signups);
}

function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Monday-00:00-UTC of the week containing `ms`, as epoch ms. Used to anchor
 *  weekly trend buckets so every week starts on the same weekday. */
function weekStartUtc(ms: number): number {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon .. 6=Sun
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - dow * DAY_MS;
}

/** "YYYY-MM" (UTC) for cohort bucketing. */
function monthKeyUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `n` calendar-month keys ending with the month containing `nowMs`,
 *  oldest first. Date.UTC normalises negative month indices across year ends. */
function lastNMonthKeys(n: number, nowMs: number): string[] {
  const d = new Date(nowMs);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    keys.push(monthKeyUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)));
  }
  return keys;
}

function acquisitionAnalytics(audience: AnalyticsAudience): AdminAcquisitionAnalytics {
  const now = Date.now();
  const since = now - ACQUISITION_WINDOW_DAYS * DAY_MS;
  const USER_OK = userAudienceSql("u", audience);

  const rows = db
    .prepare(
      `SELECT u.created_at AS created_at,
              u.signup_country AS signup_country,
              u.device_type AS device_type,
              u.locale AS locale,
              u.utm_source AS utm_source,
              u.utm_medium AS utm_medium,
              u.utm_campaign AS utm_campaign,
              u.couple_id AS couple_id,
              c.status AS couple_status
         FROM users u
         LEFT JOIN couples c ON c.id = u.couple_id
        WHERE u.created_at >= ? AND ${USER_OK}`,
    )
    .all(since) as AcqUserRow[];

  // Keep an unresolved country as null (→ "unknown" in the UI) rather than
  // defaulting it to HU: a null masquerading as HU defeats unknown_country, the
  // coverage line, and the GeoIP note below, and (post-international-expansion)
  // silently inflates the home market. by_locale/by_device already pass null.
  const by_country = rollupDimension(rows, (r) => r.signup_country);
  const by_channel = rollupDimension(rows, (r) => channelFromUtm(r.utm_source, r.utm_medium));
  const by_locale = rollupDimension(rows, (r) => r.locale);
  const by_device = rollupDimension(rows, (r) => r.device_type);
  const by_campaign = rollupDimension(rows, (r) => r.utm_campaign, { skipNull: true });

  const unknown_country = by_country.find((r) => r.key === null)?.signups ?? 0;

  // Country × locale cross-tab. Cap to the top 20 buckets so the response and
  // the table stay small; the long tail is rarely actionable.
  const clMap = new Map<string, { country: string | null; locale: string | null; count: number }>();
  for (const r of rows) {
    const k = `${r.signup_country ?? ""}|${r.locale ?? ""}`;
    let cell = clMap.get(k);
    if (!cell) {
      // Display value must match the grouping key: defaulting only the cell to
      // "HU" (while the key kept null as "") split one null-country bucket into a
      // second row visually identical to the real "HU" row. Keep null → unknown.
      cell = { country: r.signup_country, locale: r.locale, count: 0 };
      clMap.set(k, cell);
    }
    cell.count += 1;
  }
  const country_locale = [...clMap.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  // Channel mix over the last 14 days, one row per (UTC date, channel). Zero
  // buckets are omitted; the frontend fills the 14-day x-axis itself.
  const since14 = now - 13 * DAY_MS;
  const cdMap = new Map<string, { date: string; channel: string; count: number }>();
  for (const r of rows) {
    if (r.created_at < since14) continue;
    const date = utcDateKey(r.created_at);
    const channel = channelFromUtm(r.utm_source, r.utm_medium);
    const k = `${date}|${channel}`;
    let cell = cdMap.get(k);
    if (!cell) {
      cell = { date, channel, count: 0 };
      cdMap.set(k, cell);
    }
    cell.count += 1;
  }
  const channel_daily = [...cdMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    window_days: ACQUISITION_WINDOW_DAYS,
    total_signups: rows.length,
    unknown_country,
    by_country,
    by_channel,
    by_locale,
    by_device,
    by_campaign,
    country_locale,
    channel_daily,
  };
}

function handleAcquisition(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(acquisitionAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/traffic (Google Analytics 4) ──────────────────────
//
// The one rollup not backed by our own SQLite — it pulls live numbers from the
// GA4 Data API (the data GTM feeds Google from the landing). Because every
// admin page load would otherwise hit Google's quota, the assembled payload is
// memoised for a few minutes; the dashboard's manual refresh tolerates that
// staleness (GA4 itself lags 24-48h on first activation anyway).

const TRAFFIC_CACHE_TTL_MS = 5 * 60 * 1000;
let trafficCache: { payload: AdminTrafficAnalytics; expiresAt: number } | null = null;

const EMPTY_TRAFFIC_TOTALS: AdminTrafficTotals = {
  active_users: 0,
  sessions: 0,
  page_views: 0,
  engagement_rate: 0,
  avg_session_seconds: 0,
};

/** Headline metrics, in the fixed order we request them. */
const TRAFFIC_METRICS = [
  { name: "activeUsers" },
  { name: "sessions" },
  { name: "screenPageViews" },
  { name: "engagementRate" },
  { name: "averageSessionDuration" },
];

/** GA4 returns every metric as a string; coerce defensively. */
function ga4Num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** UTC `YYYY-MM-DD` for a Date — matches the activity/demo daily series so the
 *  frontend area chart is shared. */
function isoDayUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Read a single-row totals report (TRAFFIC_METRICS order) into a DTO. */
function totalsFromReport(report: Ga4ReportResponse): AdminTrafficTotals {
  const m = report.rows?.[0]?.metricValues ?? [];
  return {
    active_users: Math.round(ga4Num(m[0]?.value)),
    sessions: Math.round(ga4Num(m[1]?.value)),
    page_views: Math.round(ga4Num(m[2]?.value)),
    engagement_rate: round3(ga4Num(m[3]?.value)),
    avg_session_seconds: Math.round(ga4Num(m[4]?.value)),
  };
}

function emptyTraffic(
  configured: boolean,
  now: number,
  error: string | null,
): AdminTrafficAnalytics {
  return {
    configured,
    error,
    property_id: configured ? CONFIG.ga4PropertyId : "",
    totals_7d: { ...EMPTY_TRAFFIC_TOTALS },
    totals_28d: { ...EMPTY_TRAFFIC_TOTALS },
    totals_prev_7d: { ...EMPTY_TRAFFIC_TOTALS },
    new_vs_returning: { new_users: 0, returning_users: 0 },
    active_users_daily: [],
    top_pages: [],
    channels: [],
    first_touch_channels: [],
    events: [],
    countries: [],
    devices: [],
    realtime: { active_users: 0, by_country: [] },
    generated_at: now,
  };
}

async function trafficAnalytics(): Promise<AdminTrafficAnalytics> {
  const now = Date.now();
  if (!isGa4Configured()) return emptyTraffic(false, now, null);
  if (trafficCache && trafficCache.expiresAt > now) return trafficCache.payload;

  try {
    return await fetchTrafficFromGa4(now);
  } catch (err) {
    // Configured but the Data API call failed (API not enabled, missing
    // Viewer grant, wrong property id, quota, network). Surface the real
    // Google message to the admin UI instead of a blank section, and don't
    // cache the failure so the next refresh retries. Logged for the operator.
    const message = err instanceof Error ? err.message : String(err);
    log.warn("ga4.report_failed", { error: message });
    return emptyTraffic(true, now, message);
  }
}

/** The raw GA4 report responses that feed one traffic payload. Bundled so the
 *  pure mapping (`assembleTrafficPayload`) can be unit-tested with fixtures —
 *  the GA4 Data API is unreachable from the suite. */
export interface TrafficReports {
  t7: Ga4ReportResponse;
  t28: Ga4ReportResponse;
  tPrev7: Ga4ReportResponse;
  daily: Ga4ReportResponse;
  pages: Ga4ReportResponse;
  channels: Ga4ReportResponse;
  firstTouch: Ga4ReportResponse;
  events: Ga4ReportResponse;
  newReturning: Ga4ReportResponse;
  countries: Ga4ReportResponse;
  devices: Ga4ReportResponse;
  realtime: Ga4ReportResponse;
}

/** Map a set of GA4 report responses into the dashboard DTO. Pure — no network,
 *  no cache, no clock beyond the `now` it's handed — so the mapping (zero-fill,
 *  new/returning split, per-page engagement, realtime totals) is exercised
 *  directly by `admin_traffic.e2e.test.ts` with fixture rows. */
export function assembleTrafficPayload(now: number, r: TrafficReports): AdminTrafficAnalytics {
  // Zero-fill the 14-day daily window so the chart x-axis stays uniform even
  // on days GA4 reports no traffic.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const daysScaffold: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    daysScaffold.push({ date: isoDayUtc(new Date(today.getTime() - i * DAY_MS)), count: 0 });
  }
  const dayIndex = new Map(daysScaffold.map((d, i) => [d.date, i]));
  for (const row of r.daily.rows ?? []) {
    // GA4's `date` dimension comes back as "YYYYMMDD".
    const raw = row.dimensionValues[0]?.value ?? "";
    const iso = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const idx = dayIndex.get(iso);
    if (idx !== undefined) {
      const bucket = daysScaffold[idx];
      if (bucket) bucket.count = Math.round(ga4Num(row.metricValues[0]?.value));
    }
  }

  // Split active users into new vs returning. GA4 keys the dimension "new" /
  // "returning" (plus an occasional "(not set)" bucket we drop).
  let newUsers = 0;
  let returningUsers = 0;
  for (const row of r.newReturning.rows ?? []) {
    const key = (row.dimensionValues[0]?.value ?? "").toLowerCase();
    const v = Math.round(ga4Num(row.metricValues[0]?.value));
    if (key === "new") newUsers = v;
    else if (key === "returning") returningUsers = v;
  }

  const realtimeCountries = (r.realtime.rows ?? []).map((row) => ({
    country: row.dimensionValues[0]?.value ?? "",
    users: Math.round(ga4Num(row.metricValues[0]?.value)),
  }));

  return {
    configured: true,
    error: null,
    property_id: CONFIG.ga4PropertyId,
    totals_7d: totalsFromReport(r.t7),
    totals_28d: totalsFromReport(r.t28),
    totals_prev_7d: totalsFromReport(r.tPrev7),
    new_vs_returning: { new_users: newUsers, returning_users: returningUsers },
    active_users_daily: daysScaffold,
    top_pages: (r.pages.rows ?? []).map((row) => {
      const users = Math.round(ga4Num(row.metricValues[1]?.value));
      const engagementSeconds = ga4Num(row.metricValues[2]?.value);
      return {
        path: row.dimensionValues[0]?.value ?? "",
        views: Math.round(ga4Num(row.metricValues[0]?.value)),
        users,
        avg_engagement_seconds: users > 0 ? Math.round(engagementSeconds / users) : 0,
      };
    }),
    channels: (r.channels.rows ?? []).map((row) => ({
      channel: row.dimensionValues[0]?.value ?? "",
      sessions: Math.round(ga4Num(row.metricValues[0]?.value)),
    })),
    first_touch_channels: (r.firstTouch.rows ?? []).map((row) => ({
      channel: row.dimensionValues[0]?.value ?? "",
      users: Math.round(ga4Num(row.metricValues[0]?.value)),
    })),
    events: (r.events.rows ?? []).map((row) => ({
      name: row.dimensionValues[0]?.value ?? "",
      count: Math.round(ga4Num(row.metricValues[0]?.value)),
    })),
    countries: (r.countries.rows ?? []).map((row) => ({
      country: row.dimensionValues[0]?.value ?? "",
      users: Math.round(ga4Num(row.metricValues[0]?.value)),
    })),
    devices: (r.devices.rows ?? []).map((row) => ({
      device: row.dimensionValues[0]?.value ?? "",
      users: Math.round(ga4Num(row.metricValues[0]?.value)),
    })),
    realtime: {
      active_users: realtimeCountries.reduce((sum, c) => sum + c.users, 0),
      by_country: realtimeCountries,
    },
    generated_at: now,
  };
}

async function fetchTrafficFromGa4(now: number): Promise<AdminTrafficAnalytics> {
  const range7 = [{ startDate: "7daysAgo", endDate: "today" }];
  const range28 = [{ startDate: "28daysAgo", endDate: "today" }];
  // The 7-day window immediately before range7, for week-over-week deltas.
  const rangePrev7 = [{ startDate: "14daysAgo", endDate: "8daysAgo" }];

  // Independent reports, one shared access token, all in flight at once. The
  // realtime report hits a different API surface and degrades to empty on its
  // own (it may be unavailable while the standard reports succeed) rather than
  // failing the whole section.
  const [
    t7,
    t28,
    tPrev7,
    daily,
    pages,
    channels,
    firstTouch,
    events,
    newReturning,
    countries,
    devices,
    realtime,
  ] = await Promise.all([
    runGa4Report({ dateRanges: range7, metrics: TRAFFIC_METRICS }),
    runGa4Report({ dateRanges: range28, metrics: TRAFFIC_METRICS }),
    runGa4Report({ dateRanges: rangePrev7, metrics: TRAFFIC_METRICS }),
    runGa4Report({
      dateRanges: [{ startDate: "13daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "userEngagementDuration" },
      ],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "firstUserDefaultChannelGroup" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 10,
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 12,
    }),
    runGa4Report({
      dateRanges: range28,
      dimensions: [{ name: "newVsReturning" }],
      metrics: [{ name: "activeUsers" }],
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    }),
    runGa4RealtimeReport({
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }).catch((err) => {
      log.warn("ga4.realtime_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { rows: [] } as Ga4ReportResponse;
    }),
  ]);

  const payload = assembleTrafficPayload(now, {
    t7,
    t28,
    tPrev7,
    daily,
    pages,
    channels,
    firstTouch,
    events,
    newReturning,
    countries,
    devices,
    realtime,
  });
  trafficCache = { payload, expiresAt: now + TRAFFIC_CACHE_TTL_MS };
  return payload;
}

async function handleTraffic(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  // trafficAnalytics() never throws on a GA4 failure — it folds the cause into
  // the payload's `error` field so the admin UI can show exactly what Google
  // rejected (API disabled, no Viewer grant, wrong property id, …).
  return json(await trafficAnalytics());
}

// ─── Shared date helpers for the wedding / honeymoon rollups ─────────────

// Couple-shaped rollups below scope their universe via coupleAudienceSql()
// (domain/analytics_audience.ts) so the same cohort rules apply everywhere.

/** Parse a `YYYY-MM-DD` text date into UTC {year, month (1..12), day}. Returns
 *  null for null / malformed input so callers can filter fuzzy or empty dates
 *  out of the distributions. Only the leading date portion is read — a stored
 *  `YYYY-MM-DD` with trailing noise still parses. */
function parseIsoDate(raw: string | null): { year: number; month: number; day: number } | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** ISO weekday (1=Mon .. 7=Sun) for a parsed date. */
function isoWeekday(d: { year: number; month: number; day: number }): number {
  const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0=Sun
  return ((dow + 6) % 7) + 1;
}

/** Meteorological N-hemisphere season for a calendar month (1..12). */
function seasonForMonth(month: number): WeddingSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

// ─── /api/admin/analytics/honeymoon ──────────────────────────────────────

function honeymoonAnalytics(audience: AnalyticsAudience): AdminHoneymoonAnalytics {
  const couples = db
    .prepare(
      `SELECT honeymoon_destination, honeymoon_start_date, honeymoon_end_date, honeymoon_origin_iata
         FROM couples WHERE ${coupleAudienceSql("couples", audience)}`,
    )
    .all() as {
    honeymoon_destination: string | null;
    honeymoon_start_date: string | null;
    honeymoon_end_date: string | null;
    honeymoon_origin_iata: string | null;
  }[];

  const totalCouples = couples.length;

  // Destinations grouped case-insensitively. For each normalized key we keep a
  // tally of the original spellings so the display label is whatever couples
  // actually typed most often (e.g. "Bali" beats "bali").
  const destGroups = new Map<string, { count: number; spellings: Map<string, number> }>();
  const originCounts = new Map<string, number>();
  const tripNights: number[] = [];
  const startMonthCounts = new Array<number>(12).fill(0);
  let couplesWithDestination = 0;
  let couplesWithDates = 0;

  for (const c of couples) {
    const destRaw = c.honeymoon_destination?.trim();
    if (destRaw) {
      couplesWithDestination += 1;
      const key = destRaw.toLowerCase().replace(/\s+/g, " ");
      let group = destGroups.get(key);
      if (!group) {
        group = { count: 0, spellings: new Map() };
        destGroups.set(key, group);
      }
      group.count += 1;
      group.spellings.set(destRaw, (group.spellings.get(destRaw) ?? 0) + 1);
    }

    const iata = c.honeymoon_origin_iata?.trim().toUpperCase();
    if (iata) originCounts.set(iata, (originCounts.get(iata) ?? 0) + 1);

    const start = parseIsoDate(c.honeymoon_start_date);
    const end = parseIsoDate(c.honeymoon_end_date);
    if (start) {
      const idx = start.month - 1;
      startMonthCounts[idx] = (startMonthCounts[idx] ?? 0) + 1;
    }
    if (start && end) {
      const startMs = Date.UTC(start.year, start.month - 1, start.day);
      const endMs = Date.UTC(end.year, end.month - 1, end.day);
      const nights = Math.round((endMs - startMs) / DAY_MS);
      if (nights >= 0) {
        couplesWithDates += 1;
        tripNights.push(nights);
      }
    }
  }

  const topDestinations = [...destGroups.entries()]
    .map(([, group]) => {
      // Pick the most-frequent original spelling; alphabetical tie-break.
      let label = "";
      let best = -1;
      for (const [spelling, n] of group.spellings) {
        if (n > best || (n === best && spelling < label)) {
          best = n;
          label = spelling;
        }
      }
      return { destination: label, count: group.count };
    })
    .sort((a, b) => b.count - a.count || a.destination.localeCompare(b.destination))
    .slice(0, 12);

  const topOrigins = [...originCounts.entries()]
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count || a.iata.localeCompare(b.iata))
    .slice(0, 10);

  const startMonth = startMonthCounts.map((count, i) => ({ month: i + 1, count }));

  return {
    total_couples: totalCouples,
    couples_with_destination: couplesWithDestination,
    couples_with_dates: couplesWithDates,
    adoption_pct: totalCouples > 0 ? couplesWithDestination / totalCouples : 0,
    top_destinations: topDestinations,
    top_origins: topOrigins,
    trip_nights: quantiles(tripNights),
    start_month: startMonth,
  };
}

function handleHoneymoon(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(honeymoonAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/weddings ───────────────────────────────────────

function weddingAnalytics(audience: AnalyticsAudience): AdminWeddingAnalytics {
  const couples = db
    .prepare(
      `SELECT wedding_date, created_at, currency, country, style_tags_json,
              target_guest_count, target_guest_count_min, target_guest_count_max
         FROM couples WHERE ${coupleAudienceSql("couples", audience)}`,
    )
    .all() as {
    wedding_date: string | null;
    created_at: number;
    currency: string | null;
    country: string | null;
    style_tags_json: string | null;
    target_guest_count: number | null;
    target_guest_count_min: number | null;
    target_guest_count_max: number | null;
  }[];

  const totalCouples = couples.length;
  const monthCounts = new Array<number>(12).fill(0);
  const weekdayCounts = new Array<number>(7).fill(0);
  const seasonCounts: Record<WeddingSeason, number> = {
    spring: 0,
    summer: 0,
    autumn: 0,
    winter: 0,
  };
  const leadTimeDays: number[] = [];
  // Lead times grouped by the couple's registration month, for a planning-horizon
  // trend across cohorts (is the median moving as the audience changes?).
  const leadTimeByCohort = new Map<string, number[]>();
  const guestTargets: number[] = [];
  const currencyCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let couplesWithDate = 0;
  let couplesWithStyle = 0;

  for (const c of couples) {
    const d = parseIsoDate(c.wedding_date);
    if (d) {
      couplesWithDate += 1;
      const mi = d.month - 1;
      monthCounts[mi] = (monthCounts[mi] ?? 0) + 1;
      const wi = isoWeekday(d) - 1;
      weekdayCounts[wi] = (weekdayCounts[wi] ?? 0) + 1;
      seasonCounts[seasonForMonth(d.month)] += 1;
      // Lead time signup → wedding. Drop dates set in the past (negative) so
      // the median reflects forward planning, not back-dated test rows.
      const weddingMs = Date.UTC(d.year, d.month - 1, d.day);
      const days = Math.round((weddingMs - c.created_at) / DAY_MS);
      if (days >= 0) {
        leadTimeDays.push(days);
        const ck = monthKeyUtc(c.created_at);
        const arr = leadTimeByCohort.get(ck);
        if (arr) arr.push(days);
        else leadTimeByCohort.set(ck, [days]);
      }
    }

    const guests = c.target_guest_count ?? c.target_guest_count_max ?? c.target_guest_count_min;
    if (guests !== null && guests !== undefined && guests > 0) guestTargets.push(guests);

    const currency = (c.currency ?? "").trim().toUpperCase() || "HUF";
    currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);
    const country = (c.country ?? "").trim().toUpperCase() || "HU";
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);

    if (c.style_tags_json) {
      try {
        const tags = JSON.parse(c.style_tags_json) as unknown;
        if (Array.isArray(tags)) {
          let hasStyle = false;
          for (const raw of tags) {
            if (typeof raw !== "string") continue;
            const tag = raw.trim();
            if (tag) {
              tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
              hasStyle = true;
            }
          }
          if (hasStyle) couplesWithStyle += 1;
        }
      } catch {
        // Malformed JSON on a single row shouldn't sink the whole rollup.
      }
    }
  }

  // UI-locale split over real, non-purged users (locale lives on `users`, not
  // `couples`). Null / empty locales (pre-capture signups) collapse to
  // "unknown" so the row total reconciles with the user count.
  const localeRows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(LOWER(users.locale)), ''), 'unknown') AS locale, COUNT(*) AS n
         FROM users
        WHERE ${userAudienceSql("users", audience)}
        GROUP BY locale ORDER BY n DESC`,
    )
    .all() as { locale: string; n: number }[];

  const toSorted = (m: Map<string, number>, key: "currency" | "country") =>
    [...m.entries()]
      .map(
        ([k, count]) =>
          ({ [key]: k, count }) as { currency?: string; country?: string; count: number },
      )
      .sort((a, b) => b.count - a.count);

  return {
    total_couples: totalCouples,
    couples_with_date: couplesWithDate,
    couples_with_style: couplesWithStyle,
    wedding_month: monthCounts.map((count, i) => ({ month: i + 1, count })),
    wedding_weekday: weekdayCounts.map((count, i) => ({ weekday: i + 1, count })),
    wedding_season: (["spring", "summer", "autumn", "winter"] as const).map((season) => ({
      season,
      count: seasonCounts[season],
    })),
    lead_time_days: quantiles(leadTimeDays),
    lead_time_by_cohort: lastNMonthKeys(6, Date.now()).map((month) => {
      const arr = leadTimeByCohort.get(month) ?? [];
      return { month, median: arr.length > 0 ? quantiles(arr).median : 0, count: arr.length };
    }),
    guest_count_target: quantiles(guestTargets),
    by_currency: toSorted(currencyCounts, "currency") as Array<{ currency: string; count: number }>,
    by_country: toSorted(countryCounts, "country") as Array<{ country: string; count: number }>,
    by_locale: localeRows.map((r) => ({ locale: r.locale, count: r.n })),
    top_style_tags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 12),
  };
}

function handleWeddings(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(weddingAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/guests ─────────────────────────────────────────

function guestAnalytics(audience: AnalyticsAudience): AdminGuestAnalytics {
  // Restrict to guests owned by couples the audience admits. One join keeps
  // demo / admin / test / deleting residue out without a second round-trip.
  const guests = db
    .prepare(
      `SELECT g.couple_id, g.rsvp_status, g.kind, g.plus_one_name, g.accommodation_needed,
              g.song_request
         FROM guests g
         JOIN couples c ON c.id = g.couple_id
        WHERE ${coupleAudienceSql("c", audience)}`,
    )
    .all() as {
    couple_id: number;
    rsvp_status: string;
    kind: string;
    plus_one_name: string | null;
    accommodation_needed: number;
    song_request: string | null;
  }[];

  const totalGuests = guests.length;
  const perCouple = new Map<number, number>();
  const rsvp = { pending: 0, yes: 0, no: 0, maybe: 0 };
  const kindBreakdown = { adult: 0, child: 0, baby: 0 };
  let plusOne = 0;
  let accommodation = 0;
  let songRequests = 0;

  for (const g of guests) {
    perCouple.set(g.couple_id, (perCouple.get(g.couple_id) ?? 0) + 1);

    if (g.rsvp_status === "yes" || g.rsvp_status === "no" || g.rsvp_status === "maybe") {
      rsvp[g.rsvp_status] += 1;
    } else {
      rsvp.pending += 1;
    }

    if (g.kind === "child" || g.kind === "baby") kindBreakdown[g.kind] += 1;
    else kindBreakdown.adult += 1;

    if (g.plus_one_name?.trim()) plusOne += 1;
    if (g.accommodation_needed === 1) accommodation += 1;
    if (g.song_request?.trim()) songRequests += 1;
  }

  const answered = rsvp.yes + rsvp.no + rsvp.maybe;
  const definite = rsvp.yes + rsvp.no;

  return {
    couples_with_guests: perCouple.size,
    total_guests: totalGuests,
    guests_per_couple: quantiles([...perCouple.values()]),
    rsvp_breakdown: rsvp,
    response_rate: totalGuests > 0 ? answered / totalGuests : 0,
    acceptance_rate: definite > 0 ? rsvp.yes / definite : 0,
    kind_breakdown: kindBreakdown,
    plus_one_count: plusOne,
    accommodation_needed_count: accommodation,
    song_request_count: songRequests,
  };
}

function handleGuests(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(guestAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/planners ──────────────────────────────────────────
//
// The planner cohort had a roster (the admin Szervezők table) and no health
// check. Same three questions the couple side answers: where do they come from,
// are they getting value, and do they pay. Sources: `users`
// (user_type='planner'), `planner_waitlist`, `planner_clients`,
// `planner_subscriptions`.

const PLANNER_TIERS: readonly string[] = ["starter", "pro", "premium"];
const PLANNER_SIGNUP_WINDOW_DAYS = 30;

interface PlannerRow {
  id: number;
  created_at: number;
  status: string;
  password_set: number;
  planner_plan: string | null;
  planner_max_clients: number | null;
  client_count: number;
  pending_activation: number;
  sub_status: string | null;
  trial_ends_at: number | null;
  founding_until: number | null;
  sub_updated_at: number | null;
}

/** Zero-filled daily buckets for the last `days` UTC days, oldest first. */
function dailyBuckets(days: number, nowMs: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) out.set(utcDateKey(nowMs - i * DAY_MS), 0);
  return out;
}

function plannerAnalytics(audience: AnalyticsAudience): AdminPlannerAnalytics {
  const now = Date.now();
  const USER_OK = userAudienceSql("u", audience);

  const planners = db
    .prepare(
      `SELECT u.id, u.created_at, u.status, u.password_set,
              u.planner_plan, u.planner_max_clients,
              (SELECT COUNT(*) FROM planner_clients pc
                WHERE pc.planner_user_id = u.id AND pc.status = 'active') AS client_count,
              EXISTS(SELECT 1 FROM planner_activation_tokens pat
                WHERE pat.user_id = u.id AND pat.consumed_at IS NULL) AS pending_activation,
              ps.subscription_status AS sub_status,
              ps.trial_ends_at AS trial_ends_at,
              ps.founding_until AS founding_until,
              ps.updated_at AS sub_updated_at
         FROM users u
         LEFT JOIN planner_subscriptions ps ON ps.user_id = u.id
        WHERE u.user_type = 'planner' AND ${USER_OK}`,
    )
    .all() as PlannerRow[];

  let active = 0;
  let pendingRegistration = 0;
  let suspended = 0;
  let paying = 0;
  let inFreeWindow = 0;
  let freeWindowEnded = 0;
  let convertedAfterFree = 0;
  let withClient = 0;
  let activated = 0;
  const statusCensus = new Map<string, number>();
  const tierAgg = new Map<string, { planners: number; clients: number; capSum: number }>();
  const clientCounts: number[] = [];
  const daysToPaid: number[] = [];
  const signupBuckets = dailyBuckets(PLANNER_SIGNUP_WINDOW_DAYS, now);

  for (const p of planners) {
    const isActivated = p.password_set === 1 && p.pending_activation === 0;
    if (isActivated) activated += 1;
    else pendingRegistration += 1;
    if (p.status === "suspended") suspended += 1;
    else if (isActivated) active += 1;

    const status = p.sub_status ?? "none";
    statusCensus.set(status, (statusCensus.get(status) ?? 0) + 1);

    // A free window is open while the trial or the founding grant still runs.
    const freeEndsAt =
      status === "trialing" ? p.trial_ends_at : status === "founding" ? p.founding_until : null;
    const isPaying = status === "active" || status === "past_due";
    if (isPaying) paying += 1;
    if (freeEndsAt != null && freeEndsAt > now) inFreeWindow += 1;
    if (freeEndsAt != null && freeEndsAt <= now) freeWindowEnded += 1;
    // Conversion is only meaningful once the free ride is over: someone who is
    // paying today and once had a window that has since closed converted; a
    // planner still inside their window is neither a win nor a loss yet.
    if (isPaying && p.sub_updated_at != null) {
      convertedAfterFree += 1;
      freeWindowEnded += 1;
      daysToPaid.push(Math.max(0, Math.round((p.sub_updated_at - p.created_at) / DAY_MS)));
    }

    const plan = PLANNER_TIERS.includes(p.planner_plan ?? "")
      ? (p.planner_plan as string)
      : "starter";
    let tier = tierAgg.get(plan);
    if (!tier) {
      tier = { planners: 0, clients: 0, capSum: 0 };
      tierAgg.set(plan, tier);
    }
    tier.planners += 1;
    tier.clients += p.client_count;
    tier.capSum += p.planner_max_clients ?? 0;

    if (p.client_count > 0) {
      withClient += 1;
      clientCounts.push(p.client_count);
    }

    const key = utcDateKey(p.created_at);
    if (signupBuckets.has(key)) signupBuckets.set(key, (signupBuckets.get(key) ?? 0) + 1);
  }

  // Waitlist side of the funnel. Deduped by address: one person re-applying is
  // one applicant, not two, otherwise every later step reads as a worse
  // conversion than it is.
  const waitlist = db
    .prepare(
      `SELECT COUNT(DISTINCT lower(email)) AS applied,
              COUNT(DISTINCT CASE WHEN status = 'accepted' THEN lower(email) END) AS accepted
         FROM planner_waitlist`,
    )
    .get() as { applied: number; accepted: number };

  const acceptedWithAccount = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT lower(w.email)) AS n
           FROM planner_waitlist w
          WHERE w.status = 'accepted'
            AND EXISTS (SELECT 1 FROM users u
                         WHERE lower(u.email) = lower(w.email) AND u.user_type = 'planner')`,
      )
      .get() as { n: number }
  ).n;

  const applied = waitlist.applied;
  const step = (
    key: AdminPlannerAnalytics["funnel"][number]["key"],
    count: number,
  ): AdminPlannerAnalytics["funnel"][number] => ({
    key,
    count,
    pct_of_first: applied > 0 ? Math.round((count / applied) * 100) : 0,
  });

  const by_tier = PLANNER_TIERS.map((plan) => {
    const agg = tierAgg.get(plan) ?? { planners: 0, clients: 0, capSum: 0 };
    return {
      plan,
      planners: agg.planners,
      clients: agg.clients,
      // Per-tier cap as configured on the accounts themselves, not a constant:
      // an admin can raise one planner's ceiling and the utilisation has to
      // reflect the seat they actually have.
      cap: agg.planners > 0 ? Math.round(agg.capSum / agg.planners) : 0,
      utilisation: agg.capSum > 0 ? agg.clients / agg.capSum : null,
    };
  });

  return {
    total: planners.length,
    active,
    pending_registration: pendingRegistration,
    suspended,
    accepted_awaiting_account: Math.max(0, waitlist.accepted - acceptedWithAccount),
    funnel: [
      step("applied", applied),
      step("accepted", waitlist.accepted),
      step("account", acceptedWithAccount),
      step("activated", activated),
      step("with_client", withClient),
      step("paying", paying),
    ],
    by_tier,
    subscription_status: [...statusCensus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    in_free_window: inFreeWindow,
    paying,
    converted_after_free: convertedAfterFree,
    free_window_ended: freeWindowEnded,
    avg_days_to_paid_approx:
      daysToPaid.length > 0
        ? Math.round(daysToPaid.reduce((s, d) => s + d, 0) / daysToPaid.length)
        : null,
    signups_daily: [...signupBuckets.entries()].map(([date, count]) => ({ date, count })),
    clients_per_planner: quantiles(clientCounts),
  };
}

function handlePlanners(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(plannerAnalytics(parseAudience(ctx.url.searchParams)));
}

// ─── /api/admin/analytics/campaigns ─────────────────────────────────────────
//
// The four outreach families keep rich per-recipient state that only ever
// showed up inside their own console, one campaign at a time. This reads all
// four together so "which channel actually works" is answerable.
//
// Two things are deliberate. First, "converted" means something different per
// family (a claimed listing, a review that landed, a registration, a completed
// onboarding) and is never averaged into a single cross-family rate — the
// per-family table is the comparison surface. Second, `utm_signups` is a
// SECOND, independent conversion number for the families whose CTA lands on a
// signup page: it counts accounts whose captured `utm_campaign` is this
// campaign's slug, i.e. the same attribution the Csatorna model uses. Where
// both exist they should roughly agree; a gap is a measurement problem worth
// seeing rather than hiding behind one number.

const CAMPAIGN_WINDOW_DAYS = 30;

interface CampaignAggRow {
  id: number;
  slug: string;
  status: string;
  started_at: number | null;
  created_at: number;
  sent: number;
  opened: number;
  clicked: number;
  reminded: number;
  converted: number;
  failed: number;
}

/** Per-family aggregate SQL. Each yields one row per campaign with the same
 *  column names; only the conversion predicate differs now that all four
 *  families carry the same `opened_at` / `clicked_at` pair. Personal-invite has
 *  no reminder wave, so its `reminded` is a real 0 rather than a missing
 *  signal. */
const CAMPAIGN_AGG_SQL: Record<CampaignFamily, string> = {
  vendor_claim: `
    SELECT c.id, c.slug, c.status, c.started_at, c.created_at,
           SUM(CASE WHEN s.status = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
           SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
           SUM(CASE WHEN l.vendor_account_id IS NOT NULL THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM vendor_claim_campaigns c
      LEFT JOIN vendor_claim_campaign_sends s ON s.campaign_id = c.id
      LEFT JOIN listings l ON l.id = s.listing_id
     GROUP BY c.id`,
  vendor_review: `
    SELECT c.id, c.slug, c.status, c.started_at, c.created_at,
           SUM(CASE WHEN s.status = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
           SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM supplier_reviews r
                                  WHERE r.supplier_id = s.listing_id AND r.published = 1
                                    AND r.deleted_at IS NULL AND s.sent_at IS NOT NULL
                                    AND r.created_at > s.sent_at) THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM vendor_review_campaigns c
      LEFT JOIN vendor_review_campaign_sends s ON s.campaign_id = c.id
     GROUP BY c.id`,
  personal_invite: `
    SELECT c.id, c.slug, c.status, c.started_at, c.created_at,
           SUM(CASE WHEN s.status = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
           0 AS reminded,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM users u
                                  WHERE LOWER(TRIM(u.email)) = s.email) THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM personal_invite_campaigns c
      LEFT JOIN personal_invite_campaign_sends s ON s.campaign_id = c.id
     GROUP BY c.id`,
  onboarding: `
    SELECT c.id, c.slug, c.status, c.started_at, c.created_at,
           SUM(CASE WHEN s.status = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN s.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
           SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM users u
                                  WHERE u.id = s.user_id AND u.couple_id IS NOT NULL)
                    THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM onboarding_campaigns c
      LEFT JOIN onboarding_campaign_sends s ON s.campaign_id = c.id
     GROUP BY c.id`,
};

/** Sends per UTC day per family, for the shared daily series. Same shape for
 *  all four; the send table is the only difference. */
const CAMPAIGN_SENDS_TABLE: Record<CampaignFamily, string> = {
  vendor_claim: "vendor_claim_campaign_sends",
  vendor_review: "vendor_review_campaign_sends",
  personal_invite: "personal_invite_campaign_sends",
  onboarding: "onboarding_campaign_sends",
};

const CAMPAIGN_FAMILIES: readonly CampaignFamily[] = [
  "vendor_claim",
  "vendor_review",
  "personal_invite",
  "onboarding",
];

function campaignAnalytics(): AdminCampaignAnalytics {
  const now = Date.now();
  const campaigns: CampaignRowStats[] = [];
  const by_family: CampaignFamilyStats[] = [];

  // Signups tagged with a campaign slug, counted once and looked up per row.
  // Cheaper than a correlated subquery per campaign, and it keeps the
  // attribution rule in one place.
  const utmRows = db
    .prepare(
      `SELECT LOWER(utm_campaign) AS slug, COUNT(*) AS n
         FROM users
        WHERE utm_campaign IS NOT NULL AND TRIM(utm_campaign) <> ''
        GROUP BY LOWER(utm_campaign)`,
    )
    .all() as Array<{ slug: string; n: number }>;
  const utmBySlug = new Map(utmRows.map((r) => [r.slug, r.n]));

  for (const family of CAMPAIGN_FAMILIES) {
    let rows: CampaignAggRow[] = [];
    try {
      rows = db.prepare(CAMPAIGN_AGG_SQL[family]).all() as CampaignAggRow[];
    } catch (e) {
      // A family whose tables aren't there yet (fresh DB mid-migration) must
      // not take the whole dashboard down with it.
      log.warn("analytics.campaign_family_failed", {
        family,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const totals: CampaignFamilyStats = {
      family,
      campaigns: rows.length,
      sent: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
      failed: 0,
    };
    for (const r of rows) {
      totals.sent += r.sent ?? 0;
      totals.opened += r.opened ?? 0;
      totals.clicked += r.clicked ?? 0;
      totals.converted += r.converted ?? 0;
      totals.failed += r.failed ?? 0;
      campaigns.push({
        family,
        id: r.id,
        slug: r.slug,
        status: r.status,
        started_at: r.started_at,
        sent: r.sent ?? 0,
        opened: r.opened ?? 0,
        clicked: r.clicked ?? 0,
        reminded: r.reminded ?? 0,
        converted: r.converted ?? 0,
        failed: r.failed ?? 0,
        utm_signups: utmBySlug.get(r.slug.toLowerCase()) ?? 0,
      });
    }
    by_family.push(totals);
  }

  campaigns.sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0) || b.id - a.id);

  // Daily sends + conversions across every family. Conversions are dated by the
  // SEND (the only per-recipient timestamp we keep), so the two series answer
  // "of the mail that went out that day, how much of it worked".
  const sentBuckets = dailyBuckets(CAMPAIGN_WINDOW_DAYS, now);
  const convBuckets = dailyBuckets(CAMPAIGN_WINDOW_DAYS, now);
  const since = now - (CAMPAIGN_WINDOW_DAYS - 1) * DAY_MS;
  for (const family of CAMPAIGN_FAMILIES) {
    try {
      const rows = db
        .prepare(`SELECT sent_at FROM ${CAMPAIGN_SENDS_TABLE[family]} WHERE sent_at >= ?`)
        .all(since) as Array<{ sent_at: number }>;
      for (const r of rows) {
        const key = utcDateKey(r.sent_at);
        if (sentBuckets.has(key)) sentBuckets.set(key, (sentBuckets.get(key) ?? 0) + 1);
      }
    } catch {
      // Same tolerance as above.
    }
  }
  // Conversions per day, per family, reusing each family's own predicate.
  const CONVERTED_DAILY_SQL: Record<CampaignFamily, string> = {
    vendor_claim: `SELECT s.sent_at FROM vendor_claim_campaign_sends s
                     JOIN listings l ON l.id = s.listing_id
                    WHERE s.sent_at >= ? AND l.vendor_account_id IS NOT NULL`,
    vendor_review: `SELECT s.sent_at FROM vendor_review_campaign_sends s
                    WHERE s.sent_at >= ? AND EXISTS (
                      SELECT 1 FROM supplier_reviews r
                       WHERE r.supplier_id = s.listing_id AND r.published = 1
                         AND r.deleted_at IS NULL AND r.created_at > s.sent_at)`,
    personal_invite: `SELECT s.sent_at FROM personal_invite_campaign_sends s
                      WHERE s.sent_at >= ? AND EXISTS (
                        SELECT 1 FROM users u WHERE LOWER(TRIM(u.email)) = s.email)`,
    onboarding: `SELECT s.sent_at FROM onboarding_campaign_sends s
                 WHERE s.sent_at >= ? AND EXISTS (
                   SELECT 1 FROM users u WHERE u.id = s.user_id AND u.couple_id IS NOT NULL)`,
  };
  for (const family of CAMPAIGN_FAMILIES) {
    try {
      const rows = db.prepare(CONVERTED_DAILY_SQL[family]).all(since) as Array<{ sent_at: number }>;
      for (const r of rows) {
        const key = utcDateKey(r.sent_at);
        if (convBuckets.has(key)) convBuckets.set(key, (convBuckets.get(key) ?? 0) + 1);
      }
    } catch {
      // Same tolerance as above.
    }
  }

  const opted_out = (db.prepare("SELECT COUNT(*) AS n FROM email_optouts").get() as { n: number })
    .n;

  return {
    campaigns: campaigns.slice(0, 100),
    by_family,
    daily: [...sentBuckets.entries()].map(([date, sent]) => ({
      date,
      sent,
      converted: convBuckets.get(date) ?? 0,
    })),
    opted_out,
    window_days: CAMPAIGN_WINDOW_DAYS,
  };
}

function handleCampaigns(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(campaignAnalytics());
}

// ─── /api/admin/analytics/users ─────────────────────────────────────────────
//
// Account composition and lifecycle. The admin Users table already knows all of
// this per row; nothing turned it into a trend. The cohort counts (admins /
// test / demo) are computed WITHOUT the audience filter on purpose: their whole
// job is to show what the filter is holding back.

const RECENCY_WEEK_DAYS = 7;
const RECENCY_MONTH_DAYS = 30;
const RECENCY_DORMANT_DAYS = 90;
const USER_COHORT_MONTHS = 6;

function userAnalytics(audience: AnalyticsAudience): AdminUserAnalytics {
  const now = Date.now();
  const USER_OK = userAudienceSql("u", audience);
  const COUPLE_OK = coupleAudienceSql("c", audience);

  const users = db
    .prepare(
      `SELECT u.id, u.couple_id, u.last_seen_at, u.verified_email, u.role, u.user_type
         FROM users u
        WHERE ${USER_OK}`,
    )
    .all() as Array<{
    id: number;
    couple_id: number | null;
    last_seen_at: number | null;
    verified_email: number;
    role: string;
    user_type: string;
  }>;

  const recency = { week: 0, month: 0, dormant_30d: 0, dormant_90d: 0, never: 0 };
  let usersWithoutWorkspace = 0;
  for (const u of users) {
    if (u.couple_id === null && u.role !== "vendor" && u.user_type !== "planner") {
      usersWithoutWorkspace += 1;
    }
    const seen = u.last_seen_at;
    if (seen == null) {
      recency.never += 1;
      continue;
    }
    const ageDays = (now - seen) / DAY_MS;
    if (ageDays <= RECENCY_WEEK_DAYS) recency.week += 1;
    else if (ageDays <= RECENCY_MONTH_DAYS) recency.month += 1;
    else if (ageDays <= RECENCY_DORMANT_DAYS) recency.dormant_30d += 1;
    else recency.dormant_90d += 1;
  }

  // Workspaces, with the moment a second person joined. `couple_members` is the
  // membership record; the second member's created_at is when the pair formed,
  // which is what makes "time to pair" measurable at all.
  const workspaces = db
    .prepare(
      `SELECT c.id, c.created_at,
              (SELECT COUNT(*) FROM couple_members m WHERE m.couple_id = c.id) AS members,
              (SELECT MAX(m.created_at) FROM couple_members m WHERE m.couple_id = c.id) AS last_join,
              (SELECT MAX(u.last_seen_at) FROM couple_members m
                 JOIN users u ON u.id = m.user_id
                WHERE m.couple_id = c.id) AS last_seen
         FROM couples c
        WHERE ${COUPLE_OK}`,
    )
    .all() as Array<{
    id: number;
    created_at: number;
    members: number;
    last_join: number | null;
    last_seen: number | null;
  }>;

  let paired = 0;
  let solo = 0;
  const daysToPair: number[] = [];
  const cohortKeys = lastNMonthKeys(USER_COHORT_MONTHS, now);
  const cohorts = new Map<string, { workspaces: number; active_30d: number }>();
  for (const key of cohortKeys) cohorts.set(key, { workspaces: 0, active_30d: 0 });

  for (const w of workspaces) {
    if (w.members >= 2) {
      paired += 1;
      if (w.last_join != null) {
        daysToPair.push(Math.max(0, Math.round((w.last_join - w.created_at) / DAY_MS)));
      }
    } else {
      solo += 1;
    }
    const cohort = cohorts.get(monthKeyUtc(w.created_at));
    if (cohort) {
      cohort.workspaces += 1;
      if (w.last_seen != null && now - w.last_seen <= RECENCY_MONTH_DAYS * DAY_MS) {
        cohort.active_30d += 1;
      }
    }
  }

  const totalWorkspaces = paired + solo;
  const medianDaysToPair = daysToPair.length > 0 ? quantiles(daysToPair).median : null;

  // Cohort counts ignore the audience filter deliberately (see header).
  const adminList = CONFIG.adminEmails.map((e) => e.toLowerCase());
  const admins =
    adminList.length === 0
      ? 0
      : (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM users
                WHERE lower(email) IN (${adminList.map(() => "?").join(", ")})`,
            )
            .get(...adminList) as { n: number }
        ).n;
  const testAccounts = (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_beta_tester = 1").get() as { n: number }
  ).n;
  const demoAccounts = (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@demo.weddly.local'").get() as {
      n: number;
    }
  ).n;

  return {
    total_users: users.length,
    paired_workspaces: paired,
    solo_workspaces: solo,
    users_without_workspace: usersWithoutWorkspace,
    admins,
    test_accounts: testAccounts,
    demo_accounts: demoAccounts,
    paired_rate: totalWorkspaces > 0 ? paired / totalWorkspaces : 0,
    median_days_to_pair: medianDaysToPair,
    recency,
    cohorts: cohortKeys.map((month) => ({
      month,
      workspaces: cohorts.get(month)?.workspaces ?? 0,
      active_30d: cohorts.get(month)?.active_30d ?? 0,
    })),
  };
}

function handleUsers(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(userAnalytics(parseAudience(ctx.url.searchParams)));
}

export function registerAdminAnalyticsRoutes(router: Router) {
  router.get("/api/admin/analytics/money", handleMoney, true);
  router.get("/api/admin/analytics/activity", handleActivity, true);
  router.get("/api/admin/analytics/picks", handlePicks, true);
  router.get("/api/admin/analytics/engagement", handleEngagement, true);
  router.get("/api/admin/analytics/demo", handleDemo, true);
  router.get("/api/admin/analytics/growth-funnel", handleGrowthFunnel, true);
  router.get("/api/admin/analytics/acquisition", handleAcquisition, true);
  router.get("/api/admin/analytics/traffic", handleTraffic, true);
  router.get("/api/admin/analytics/honeymoon", handleHoneymoon, true);
  router.get("/api/admin/analytics/weddings", handleWeddings, true);
  router.get("/api/admin/analytics/guests", handleGuests, true);
  router.get("/api/admin/analytics/planners", handlePlanners, true);
  router.get("/api/admin/analytics/campaigns", handleCampaigns, true);
  router.get("/api/admin/analytics/users", handleUsers, true);
}
