// Read-only analytics rollups for /app/admin/analytics. Three orthogonal
// endpoints — money / activity / picks — each returning one fully-aggregated
// payload so the dashboard can render in a single round-trip. Gated by the
// same ADMIN_EMAILS allowlist as the rest of /api/admin/*.

import type {
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import { db } from "../db";
import { listActiveCommunitySuppliers } from "../domain/community_suppliers";
import { DIRECTORY } from "../domain/suppliers_data";
import { requireAdmin } from "../domain/users";
import { type Ctx, json, type Router } from "../lib/http";

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
const SUPPLIER_CATEGORIES: readonly SupplierCategory[] = [
  "venue",
  "accommodation",
  "tent_pavilion",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "sound_tech",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "nails",
  "rings",
  "stationery",
  "wedding_website",
  "transport",
];

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

function moneyAnalytics(): AdminMoneyAnalytics {
  // Active universe: every couple that is NOT in the `deleting` tombstone
  // state. Purged couples have their PII scrubbed but rows linger; they'd
  // otherwise drag the averages toward zero.
  const couples = db
    .prepare("SELECT id, budget_ceiling_huf FROM couples WHERE status NOT IN ('deleting')")
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

  // Right-anchored histogram. Each bucket carries the inclusive upper bound
  // in HUF; the trailing 30M bucket catches the open-ended high tail. Zero
  // is the "no budget set" pseudo-bucket.
  const BUCKET_MAX_HUF = [1_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000];
  const histogram = [
    { bucket_max_huf: 0, count: 0 },
    ...BUCKET_MAX_HUF.map((b) => ({ bucket_max_huf: b, count: 0 })),
  ];
  for (const c of couples) {
    if (c.budget_ceiling_huf === null || c.budget_ceiling_huf === undefined) {
      const row = histogram[0];
      if (row) row.count += 1;
      continue;
    }
    let placed = false;
    for (let i = 0; i < BUCKET_MAX_HUF.length - 1; i += 1) {
      const max = BUCKET_MAX_HUF[i];
      if (max !== undefined && c.budget_ceiling_huf <= max) {
        const row = histogram[i + 1];
        if (row) row.count += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // 30M+ open-ended tail.
      const row = histogram[histogram.length - 1];
      if (row) row.count += 1;
    }
  }

  return {
    couples_with_budget: couplesWithBudget,
    couples_with_actuals: hasActualByCouple.size,
    budget_ceiling_huf: quantiles(ceilingValues),
    planned_huf: quantiles(plannedValues),
    actual_huf: quantiles(actualValues),
    per_category: perCategory,
    budget_histogram: histogram,
  };
}

function handleMoney(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(moneyAnalytics());
}

// ─── /api/admin/analytics/activity ───────────────────────────────────────

function activityAnalytics(): AdminActivityAnalytics {
  const now = Date.now();
  const w24h = now - DAY_MS;
  const w7d = now - 7 * DAY_MS;
  const w30d = now - 30 * DAY_MS;

  // Purged tombstones use `…@purged.local` for the email — exclude so the
  // signup count doesn't keep ticking up every time someone deletes their
  // account.
  const NOT_PURGED = "email NOT LIKE '%@purged.local'";

  const countSince = (since: number): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE ${NOT_PURGED} AND created_at >= ?`)
        .get(since) as { n: number }
    ).n;
  const totalSignups = (
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${NOT_PURGED}`).get() as { n: number }
  ).n;

  const activeSince = (since: number): number =>
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT id) AS n FROM users WHERE ${NOT_PURGED} AND last_seen_at IS NOT NULL AND last_seen_at >= ?`,
        )
        .get(since) as { n: number }
    ).n;

  const registered = totalSignups;
  const verified = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE ${NOT_PURGED} AND verified_email = 1`)
      .get() as { n: number }
  ).n;
  const onboarded = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE ${NOT_PURGED} AND couple_id IS NOT NULL`)
      .get() as { n: number }
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
    .prepare("SELECT status, COUNT(*) AS n FROM couples GROUP BY status")
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
  const since14 = now - 14 * DAY_MS;
  const dailyRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n
         FROM users
        WHERE ${NOT_PURGED} AND created_at >= ?
        GROUP BY d`,
    )
    .all(since14) as { d: string; n: number }[];
  const dailyMap = new Map(dailyRows.map((r) => [r.d, r.n]));

  const signupsDaily: { date: string; count: number }[] = [];
  // Walk oldest → newest. Date arithmetic stays in UTC so the dashboard's
  // x-axis lines up regardless of the admin's local timezone.
  const startMs = now - 13 * DAY_MS;
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(startMs + i * DAY_MS);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    signupsDaily.push({ date: iso, count: dailyMap.get(iso) ?? 0 });
  }

  return {
    signups: {
      last_24h: countSince(w24h),
      last_7d: countSince(w7d),
      last_30d: countSince(w30d),
      total: totalSignups,
    },
    active_users: {
      last_24h: activeSince(w24h),
      last_7d: activeSince(w7d),
      last_30d: activeSince(w30d),
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
  };
}

function handleActivity(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(activityAnalytics());
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

function picksAnalytics(): AdminPicksAnalytics {
  const totalPicks = (db.prepare("SELECT COUNT(*) AS n FROM couple_picks").get() as { n: number })
    .n;

  // Per-couple pick counts. Couples with zero picks are intentionally
  // excluded so the median doesn't get dragged to 0 — the analytics
  // surface documents this behaviour.
  const perCoupleRows = db
    .prepare("SELECT couple_id, COUNT(*) AS n FROM couple_picks GROUP BY couple_id")
    .all() as { couple_id: number; n: number }[];
  const picksPerCouple = quantiles(perCoupleRows.map((r) => r.n));

  // Top picks. Tie-broken on supplier_id ASC for a stable response shape.
  const topRows = db
    .prepare(
      `SELECT supplier_id, category, COUNT(*) AS n
         FROM couple_picks
        GROUP BY supplier_id, category
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
    .prepare("SELECT couple_id, category, supplier_id FROM couple_picks")
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

  return {
    total_picks: totalPicks,
    picks_per_couple: picksPerCouple,
    top_picks: topPicks,
    category_coverage: categoryCoverage,
    source_breakdown: sourceBreakdown,
  };
}

function handlePicks(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(picksAnalytics());
}

export function registerAdminAnalyticsRoutes(router: Router) {
  router.get("/api/admin/analytics/money", handleMoney, true);
  router.get("/api/admin/analytics/activity", handleActivity, true);
  router.get("/api/admin/analytics/picks", handlePicks, true);
}
