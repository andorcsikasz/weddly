// Read-only analytics rollups for /app/admin/analytics. Orthogonal endpoints —
// money / activity / picks / engagement / demo / growth-funnel / traffic — each
// returning one fully-aggregated payload so the dashboard can render in a single
// round-trip. All but `traffic` aggregate our own SQLite; `traffic` pulls live
// numbers from the Google Analytics 4 Data API (see lib/ga4.ts). Gated by the
// same ADMIN_EMAILS allowlist as the rest of /api/admin/*.

import type {
  AdminActivityAnalytics,
  AdminAnalyticsStats,
  AdminDemoAnalytics,
  AdminEngagementAnalytics,
  AdminGrowthFunnelAnalytics,
  AdminGrowthFunnelStep,
  AdminMoneyAnalytics,
  AdminPicksAnalytics,
  AdminTrafficAnalytics,
  AdminTrafficTotals,
} from "@shared/admin_analytics";
import type { BudgetCategory, CoupleStatus } from "@shared/types";
import type { SupplierCategory } from "@shared/suppliers";
import { CONFIG } from "../config";
import { db } from "../db";
import { listActiveCommunitySuppliers } from "../domain/community_suppliers";
import { DIRECTORY } from "../domain/suppliers_data";
import { requireAdmin } from "../domain/users";
import { type Ga4ReportResponse, isGa4Configured, runGa4Report } from "../lib/ga4";
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
  // Demo workspaces are seeded by the landing "Try the demo" button under
  // `demo-…@demo.weddly.local` users (couples.is_demo = 1). They'd otherwise
  // inflate every headline — a demo signs up verified + onboarded in one
  // shot. So the headline numbers are REAL (non-demo) traffic, and we
  // surface a parallel `demo` breakdown the UI renders as a small note.
  const NOT_DEMO = "email NOT LIKE '%@demo.weddly.local'";
  const IS_DEMO = "email LIKE '%@demo.weddly.local'";
  const REAL = `${NOT_PURGED} AND ${NOT_DEMO}`;
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
  const registered = totalSignups;
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
  const since14 = now - 14 * DAY_MS;
  const dailyRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n
         FROM users
        WHERE ${REAL} AND created_at >= ?
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
      last_24h: countSince(REAL, w24h),
      last_7d: countSince(REAL, w7d),
      last_30d: countSince(REAL, w30d),
      total: totalSignups,
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

function engagementAnalytics(): AdminEngagementAnalytics {
  const now = Date.now();
  const windowStart = now - 30 * DAY_MS;

  // Pull the 30-day audit window in one shot, pre-sorted by actor + time so
  // the JS-side session walker is a single linear pass. Anonymous rows
  // (actor_user_id IS NULL — system tasks, RSVP submissions, etc.) are
  // excluded; sessions are inherently a per-user concept.
  const auditRows = db
    .prepare(
      `SELECT actor_user_id, action, created_at FROM audit_log
        WHERE created_at >= ? AND actor_user_id IS NOT NULL
        ORDER BY actor_user_id ASC, created_at ASC`,
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
      `SELECT id, created_at, last_seen_at FROM users
        WHERE status = 'active' AND email NOT LIKE '%@purged.local' AND created_at <= ?`,
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
        `SELECT actor_user_id, created_at FROM audit_log
          WHERE actor_user_id IS NOT NULL
          ORDER BY actor_user_id ASC, created_at ASC`,
      )
      .all() as { actor_user_id: number; created_at: number }[];
    for (const r of auditAll) {
      const arr = auditByUser.get(r.actor_user_id);
      if (arr) arr.push(r.created_at);
      else auditByUser.set(r.actor_user_id, [r.created_at]);
    }
  }

  let d1Hits = 0;
  let d7Hits = 0;
  let d30Hits = 0;
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
  }

  const cohortSize = cohortRows.length;
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const retention =
    cohortSize === 0
      ? { cohort_size: 0, d1: null, d7: null, d30: null }
      : {
          cohort_size: cohortSize,
          d1: round3(d1Hits / cohortSize),
          d7: round3(d7Hits / cohortSize),
          d30: round3(d30Hits / cohortSize),
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
  // Demo users (email ending in @demo.weddly.local) are excluded — they
  // get their own surface so the leaderboard reflects real engagement.
  const eventsByUser = new Map<number, number>();
  for (const row of auditRows) {
    eventsByUser.set(row.actor_user_id, (eventsByUser.get(row.actor_user_id) ?? 0) + 1);
  }
  const topUserIds = [...eventsByUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25) // hydrate a few extra so the demo filter doesn't underfill
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
      if (u.email.endsWith("@demo.weddly.local")) return null;
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

  // Demo couples — flagged via is_demo. Live rows only; purged tombstones
  // sit in status='deleting' and the background sweep drops them entirely.
  const demoRows = db
    .prepare(`SELECT id, created_at FROM couples WHERE is_demo = 1 AND status != 'deleting'`)
    .all() as { id: number; created_at: number }[];

  const totalDemos = demoRows.length;
  let new24h = 0;
  let new7d = 0;
  let new30d = 0;
  for (const r of demoRows) {
    if (r.created_at >= cutoff24h) new24h += 1;
    if (r.created_at >= cutoff7d) new7d += 1;
    if (r.created_at >= cutoff30d) new30d += 1;
  }

  // 14-day daily creation series. Same UTC YYYY-MM-DD bucketing as the
  // activity surface's signups_daily so the frontend can reuse the chart.
  const isoDay = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const days: Array<{ date: string; count: number }> = [];
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(todayUtc.getTime() - i * DAY_MS);
    days.push({ date: isoDay(d), count: 0 });
  }
  const dateIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const r of demoRows) {
    const d = new Date(r.created_at);
    d.setUTCHours(0, 0, 0, 0);
    const key = isoDay(d);
    const idx = dateIndex.get(key);
    if (idx !== undefined) {
      const bucket = days[idx];
      if (bucket) bucket.count += 1;
    }
  }

  // active_demos_24h + total_demo_events_30d + avg_events_per_demo. One
  // SELECT joining audit_log → users → couples filtered by is_demo. We
  // do this with a sub-query on couple ids to keep the planner happy.
  const demoIds = demoRows.map((r) => r.id);
  let activeDemos24h = 0;
  let totalDemoEvents30d = 0;
  let avgEventsPerDemo = 0;
  if (demoIds.length > 0) {
    const placeholders = demoIds.map(() => "?").join(",");
    const auditDemoRows = db
      .prepare(
        `SELECT u.couple_id AS couple_id, a.created_at AS created_at FROM audit_log a
          JOIN users u ON u.id = a.actor_user_id
          WHERE u.couple_id IN (${placeholders})
            AND a.created_at >= ?`,
      )
      .all(...demoIds, cutoff30d) as { couple_id: number; created_at: number }[];

    totalDemoEvents30d = auditDemoRows.length;
    const eventsPerDemo = new Map<number, number>();
    const recentDemos = new Set<number>();
    for (const r of auditDemoRows) {
      eventsPerDemo.set(r.couple_id, (eventsPerDemo.get(r.couple_id) ?? 0) + 1);
      if (r.created_at >= cutoff24h) recentDemos.add(r.couple_id);
    }
    activeDemos24h = recentDemos.size;
    if (eventsPerDemo.size > 0) {
      const sum = [...eventsPerDemo.values()].reduce((acc, n) => acc + n, 0);
      avgEventsPerDemo = Math.round(sum / demoIds.length);
    }
  }

  // ─── Historic snapshots + cross-source feature aggregate. ─────────────
  // `demo_usage` rows are written by the continuous purge sweep right
  // before each demo workspace is hard-deleted — one row per ever-purged
  // demo with lifetime + feature counts. We blend them with live audit
  // data so the "what did visitors try?" signal survives the 4h reaper.
  const featureTotals = new Map<string, { count: number; demos: Set<string | number> }>();
  const bump = (feature: string, n: number, demoKey: string | number): void => {
    let bucket = featureTotals.get(feature);
    if (!bucket) {
      bucket = { count: 0, demos: new Set() };
      featureTotals.set(feature, bucket);
    }
    bucket.count += n;
    bucket.demos.add(demoKey);
  };

  // Live demos — per-action counts from audit_log, grouped by couple.
  if (demoIds.length > 0) {
    const placeholders = demoIds.map(() => "?").join(",");
    const liveByAction = db
      .prepare(
        `SELECT couple_id, action, COUNT(*) AS n FROM audit_log
          WHERE couple_id IN (${placeholders})
          GROUP BY couple_id, action`,
      )
      .all(...demoIds) as { couple_id: number; action: string; n: number }[];
    for (const r of liveByAction) {
      const dot = r.action.indexOf(".");
      const feature = dot === -1 ? r.action : r.action.slice(0, dot);
      bump(feature, r.n, `live:${r.couple_id}`);
    }
  }

  // Historic snapshots — feature counts are pre-aggregated as JSON.
  const usageRows = db
    .prepare("SELECT source_couple_id, lifetime_seconds, feature_counts_json FROM demo_usage")
    .all() as {
    source_couple_id: number;
    lifetime_seconds: number;
    feature_counts_json: string;
  }[];
  for (const u of usageRows) {
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(u.feature_counts_json) as Record<string, number>;
    } catch {
      counts = {};
    }
    for (const [feature, n] of Object.entries(counts)) {
      bump(feature, n, `hist:${u.source_couple_id}`);
    }
  }

  const topFeatures = [...featureTotals.entries()]
    .map(([feature, b]) => ({ feature, count: b.count, demos: b.demos.size }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
    .slice(0, 12);

  const totalDemosServed = totalDemos + usageRows.length;
  const avgLifetimeSeconds =
    usageRows.length === 0
      ? 0
      : Math.round(usageRows.reduce((s, u) => s + u.lifetime_seconds, 0) / usageRows.length);

  return {
    total_demos: totalDemos,
    new_demos: { last_24h: new24h, last_7d: new7d, last_30d: new30d },
    demos_daily: days,
    active_demos_24h: activeDemos24h,
    avg_events_per_demo: avgEventsPerDemo,
    total_demo_events_30d: totalDemoEvents30d,
    total_demos_served: totalDemosServed,
    avg_lifetime_seconds: avgLifetimeSeconds,
    top_features: topFeatures,
  };
}

function handleDemo(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(demoAnalytics());
}

function handleEngagement(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(engagementAnalytics());
}

// ─── /api/admin/analytics/growth-funnel ────────────────────────────────────
//
// Read-side consumer for the growth_events table (P6b). Computes the funnel
// the founder's 60-day commitment metric is built on:
//   signup.completed → couple.created → wedding_site.view
//                    → rsvp.page.view → rsvp.submitted
// Plus: top 7d attributed referrers, and the "stalled couple" outreach list
// (couples that created a workspace but haven't gotten a single site view yet).

/** Funnel order — keep aligned with the dashboard column layout. */
const GROWTH_FUNNEL_KINDS = [
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
    active_users_daily: [],
    top_pages: [],
    channels: [],
    countries: [],
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

async function fetchTrafficFromGa4(now: number): Promise<AdminTrafficAnalytics> {
  const range7 = [{ startDate: "7daysAgo", endDate: "today" }];
  const range28 = [{ startDate: "28daysAgo", endDate: "today" }];

  // Six independent reports, one shared access token, all in flight at once.
  const [t7, t28, daily, pages, channels, countries] = await Promise.all([
    runGa4Report({ dateRanges: range7, metrics: TRAFFIC_METRICS }),
    runGa4Report({ dateRanges: range28, metrics: TRAFFIC_METRICS }),
    runGa4Report({
      dateRanges: [{ startDate: "13daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    runGa4Report({
      dateRanges: range7,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
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
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }),
  ]);

  // Zero-fill the 14-day daily window so the chart x-axis stays uniform even
  // on days GA4 reports no traffic.
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const daysScaffold: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    daysScaffold.push({ date: isoDayUtc(new Date(today.getTime() - i * DAY_MS)), count: 0 });
  }
  const dayIndex = new Map(daysScaffold.map((d, i) => [d.date, i]));
  for (const row of daily.rows ?? []) {
    // GA4's `date` dimension comes back as "YYYYMMDD".
    const raw = row.dimensionValues[0]?.value ?? "";
    const iso = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const idx = dayIndex.get(iso);
    if (idx !== undefined) {
      const bucket = daysScaffold[idx];
      if (bucket) bucket.count = Math.round(ga4Num(row.metricValues[0]?.value));
    }
  }

  const payload: AdminTrafficAnalytics = {
    configured: true,
    error: null,
    property_id: CONFIG.ga4PropertyId,
    totals_7d: totalsFromReport(t7),
    totals_28d: totalsFromReport(t28),
    active_users_daily: daysScaffold,
    top_pages: (pages.rows ?? []).map((r) => ({
      path: r.dimensionValues[0]?.value ?? "",
      views: Math.round(ga4Num(r.metricValues[0]?.value)),
      users: Math.round(ga4Num(r.metricValues[1]?.value)),
    })),
    channels: (channels.rows ?? []).map((r) => ({
      channel: r.dimensionValues[0]?.value ?? "",
      sessions: Math.round(ga4Num(r.metricValues[0]?.value)),
    })),
    countries: (countries.rows ?? []).map((r) => ({
      country: r.dimensionValues[0]?.value ?? "",
      users: Math.round(ga4Num(r.metricValues[0]?.value)),
    })),
    generated_at: now,
  };
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

export function registerAdminAnalyticsRoutes(router: Router) {
  router.get("/api/admin/analytics/money", handleMoney, true);
  router.get("/api/admin/analytics/activity", handleActivity, true);
  router.get("/api/admin/analytics/picks", handlePicks, true);
  router.get("/api/admin/analytics/engagement", handleEngagement, true);
  router.get("/api/admin/analytics/demo", handleDemo, true);
  router.get("/api/admin/analytics/growth-funnel", handleGrowthFunnel, true);
  router.get("/api/admin/analytics/traffic", handleTraffic, true);
}
