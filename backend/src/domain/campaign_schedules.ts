// The campaign plan: standing recipes that compose the next campaign of each
// family so an operator's whole job is pressing Run.
//
// Why this exists. The four campaign consoles can target, pace, track and
// remind — but every campaign still had to be composed by hand (slug, segment,
// cap, "is now a good time?"), and the result was predictable: the claim-invite
// campaign was built in July and never started, the review campaign ran once.
// A schedule turns "should I run one?" into "here is one, ready, since Tuesday".
//
// Three rules keep repetition from becoming spam:
//   1. COOLDOWN. Every family's own targeting only excludes addresses THIS
//      campaign already wrote to, so a second campaign would re-mail everyone
//      who ignored the first. Before a prepared campaign can send, we copy a
//      'skipped' tombstone into it for every address the same family mailed
//      inside the recipe's cooldown window — which turns the family's existing
//      per-campaign exclusion into a cross-campaign one, with no change to any
//      targeting query.
//   2. MIN TARGETS. A campaign for four addresses is not worth a launch, so a
//      thin segment waits for the next tick instead and the queue keeps growing.
//   3. ONE IN FLIGHT. A schedule never builds the next campaign while the one
//      it built last is still paused-and-unrun or mid-send. Otherwise a
//      forgotten plan quietly stacks up five campaigns splitting one audience.
//
// The scheduler NEVER sends. It creates paused campaigns; the existing hourly
// sweeps do the sending once something is running. `auto_start` is the operator
// saying "and launch it too" — still their decision, made once.

import {
  CAMPAIGN_SCHEDULE_DAY_MS,
  CAMPAIGN_SCHEDULE_KINDS,
  CAMPAIGN_SCHEDULE_MAX_DAILY_CAP,
  CAMPAIGN_SCHEDULE_MAX_INTERVAL_DAYS,
  CAMPAIGN_SCHEDULE_RECIPES,
  type CampaignPlanView,
  type CampaignSchedule,
  type CampaignScheduleKind,
  type CampaignSchedulePrepared,
  type CampaignScheduleView,
  type UpdateCampaignScheduleInput,
} from "@shared/campaign_schedules";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import {
  eligibleCampaignEmails as claimEligibleEmails,
  campaignStats as claimStats,
  createCampaign as createClaimCampaign,
  getCampaignRow as getClaimCampaignRow,
  updateCampaign as updateClaimCampaign,
} from "./vendor_campaign";
import {
  eligibleOrphanEmails,
  campaignStats as onboardingStats,
  createCampaign as createOnboardingCampaign,
  getCampaignRow as getOnboardingCampaignRow,
  syncTargets as syncOnboardingTargets,
  updateCampaign as updateOnboardingCampaign,
} from "./onboarding_campaign";
import {
  eligibleCampaignEmails as reviewEligibleEmails,
  campaignStats as reviewStats,
  createCampaign as createReviewCampaign,
  getCampaignRow as getReviewCampaignRow,
  updateCampaign as updateReviewCampaign,
} from "./vendor_review_campaign";

// ── Per-family adapter ──────────────────────────────────────────────────────
// Everything the scheduler needs to know about a campaign family, in one
// object. Adding a fifth family is one entry here plus one in the shared recipe
// map; nothing else in this file is kind-aware.

interface KindAdapter {
  /** The family's campaign table, for the slug-collision check. */
  campaignsTable: string;
  /** Addresses a brand-new campaign of this family would write to. */
  eligibleEmails(): string[];
  /** Addresses this family mailed at or after `cutoff`. */
  recentlyMailed(cutoff: number): Set<string>;
  create(slug: string, dailyCap: number, actorUserId: number | null): number;
  /** Copy 'skipped' tombstones for cooled-down addresses into the new campaign
   *  so the family's own per-campaign exclusion suppresses them. */
  seedCooldownSkips(campaignId: number, cutoff: number, ts: number): number;
  /** Post-create step for families whose targets are snapshotted, not live. */
  afterPrepare?(campaignId: number): void;
  view(campaignId: number): CampaignSchedulePrepared | null;
  setRunning(campaignId: number): void;
}

/** One address per row, whatever the family. */
function distinctEmails(table: string, cutoff: number): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT email FROM ${table} WHERE sent_at IS NOT NULL AND sent_at >= ?`)
    .all(cutoff) as Array<{ email: string }>;
  return new Set(rows.map((r) => r.email));
}

const ADAPTERS: Record<CampaignScheduleKind, KindAdapter> = {
  vendor_claim: {
    campaignsTable: "vendor_claim_campaigns",
    eligibleEmails: claimEligibleEmails,
    recentlyMailed: (cutoff) => distinctEmails("vendor_claim_campaign_sends", cutoff),
    create: (slug, dailyCap, actor) =>
      createClaimCampaign({ slug, daily_cap: dailyCap, country: null }, actor).id,
    seedCooldownSkips: (campaignId, cutoff, ts) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO vendor_claim_campaign_sends
             (campaign_id, listing_id, email, locale, country, category, status, created_at)
           SELECT ?, s.listing_id, s.email, s.locale, s.country, s.category, 'skipped', ?
             FROM vendor_claim_campaign_sends s
            WHERE s.campaign_id != ? AND s.sent_at IS NOT NULL AND s.sent_at >= ?
            GROUP BY s.email`,
        )
        .run(campaignId, ts, campaignId, cutoff).changes,
    view: (id) => {
      const row = getClaimCampaignRow(id);
      if (!row) return null;
      const stats = claimStats(row);
      return {
        id: row.id,
        slug: row.slug,
        status: row.status === "running" || row.status === "done" ? row.status : "paused",
        remaining: stats.remaining,
        sent: stats.sent,
        created_at: row.created_at,
        started_at: row.started_at ?? null,
      };
    },
    setRunning: (id) => {
      updateClaimCampaign(id, { status: "running" });
    },
  },

  vendor_review: {
    campaignsTable: "vendor_review_campaigns",
    eligibleEmails: reviewEligibleEmails,
    recentlyMailed: (cutoff) => distinctEmails("vendor_review_campaign_sends", cutoff),
    create: (slug, dailyCap, actor) =>
      createReviewCampaign({ slug, daily_cap: dailyCap, country: null }, actor).id,
    seedCooldownSkips: (campaignId, cutoff, ts) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO vendor_review_campaign_sends
             (campaign_id, vendor_account_id, listing_id, email, locale, country, review_url, status, created_at)
           SELECT ?, s.vendor_account_id, s.listing_id, s.email, s.locale, s.country, s.review_url, 'skipped', ?
             FROM vendor_review_campaign_sends s
            WHERE s.campaign_id != ? AND s.sent_at IS NOT NULL AND s.sent_at >= ?
            GROUP BY s.email`,
        )
        .run(campaignId, ts, campaignId, cutoff).changes,
    view: (id) => {
      const row = getReviewCampaignRow(id);
      if (!row) return null;
      const stats = reviewStats(row);
      return {
        id: row.id,
        slug: row.slug,
        status: row.status === "running" || row.status === "done" ? row.status : "paused",
        remaining: stats.remaining,
        sent: stats.sent,
        created_at: row.created_at,
        started_at: row.started_at ?? null,
      };
    },
    setRunning: (id) => {
      updateReviewCampaign(id, { status: "running" });
    },
  },

  onboarding: {
    campaignsTable: "onboarding_campaigns",
    eligibleEmails: eligibleOrphanEmails,
    recentlyMailed: (cutoff) => distinctEmails("onboarding_campaign_sends", cutoff),
    create: (slug, dailyCap, actor) =>
      createOnboardingCampaign({ slug, daily_cap: dailyCap }, actor).id,
    seedCooldownSkips: (campaignId, cutoff, ts) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO onboarding_campaign_sends
             (campaign_id, user_id, name, email, locale, status, created_at)
           SELECT ?, s.user_id, s.name, s.email, s.locale, 'skipped', ?
             FROM onboarding_campaign_sends s
            WHERE s.campaign_id != ? AND s.sent_at IS NOT NULL AND s.sent_at >= ?
            GROUP BY s.email`,
        )
        .run(campaignId, ts, campaignId, cutoff).changes,
    // Orphans are snapshotted into send rows rather than re-queried at send
    // time, so the campaign is empty until we sync. Runs AFTER the cooldown
    // tombstones so the sync's INSERT OR IGNORE steps over them.
    afterPrepare: (campaignId) => {
      syncOnboardingTargets(campaignId);
    },
    view: (id) => {
      const row = getOnboardingCampaignRow(id);
      if (!row) return null;
      const stats = onboardingStats(row);
      return {
        id: row.id,
        slug: row.slug,
        status: row.status === "running" || row.status === "done" ? row.status : "paused",
        remaining: stats.queued,
        sent: stats.sent,
        created_at: row.created_at,
        started_at: row.started_at ?? null,
      };
    },
    setRunning: (id) => {
      updateOnboardingCampaign(id, { status: "running" });
    },
  },
};

// ── Rows ────────────────────────────────────────────────────────────────────

interface ScheduleRow {
  id: number;
  kind: string;
  enabled: number;
  interval_days: number;
  daily_cap: number;
  auto_start: number;
  last_prepared_at: number | null;
  next_due_at: number;
  last_campaign_id: number | null;
  created_at: number;
  updated_at: number;
}

function isKind(raw: string): raw is CampaignScheduleKind {
  return (CAMPAIGN_SCHEDULE_KINDS as readonly string[]).includes(raw);
}

function toSchedule(row: ScheduleRow): CampaignSchedule {
  return {
    id: row.id,
    kind: isKind(row.kind) ? row.kind : "vendor_claim",
    enabled: row.enabled === 1,
    interval_days: row.interval_days,
    daily_cap: row.daily_cap,
    auto_start: row.auto_start === 1,
    last_prepared_at: row.last_prepared_at,
    next_due_at: row.next_due_at,
    last_campaign_id: row.last_campaign_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getRow(id: number): ScheduleRow | null {
  return (
    (db.prepare("SELECT * FROM campaign_schedules WHERE id = ?").get(id) as
      | ScheduleRow
      | undefined) ?? null
  );
}

function allRows(): ScheduleRow[] {
  return db.prepare("SELECT * FROM campaign_schedules ORDER BY id ASC").all() as ScheduleRow[];
}

/** Create the missing schedule rows from the shared recipes. Runs at boot, so a
 *  fresh deploy already has a plan waiting rather than an empty page with a
 *  "create one" button — which is the whole point of the feature. Idempotent:
 *  an existing row keeps whatever the operator tuned it to. */
export function ensureDefaultSchedules(ts: number = now()): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO campaign_schedules
       (kind, enabled, interval_days, daily_cap, auto_start, next_due_at, created_at, updated_at)
     VALUES (?, 1, ?, ?, 0, ?, ?, ?)`,
  );
  let created = 0;
  for (const kind of CAMPAIGN_SCHEDULE_KINDS) {
    const recipe = CAMPAIGN_SCHEDULE_RECIPES[kind];
    // Due immediately: the first sweep after boot composes the first round.
    const res = insert.run(kind, recipe.interval_days, recipe.daily_cap, ts, ts, ts);
    if (res.changes === 1) created++;
  }
  return created;
}

// ── Reach ───────────────────────────────────────────────────────────────────

/** What a campaign built right now would actually reach, and how many eligible
 *  addresses the cooldown is holding back. Both come off the same pass so the
 *  console can explain a small number instead of just showing it. */
function reachOf(kind: CampaignScheduleKind, ts: number): { reach: number; cooling: number } {
  const adapter = ADAPTERS[kind];
  const recipe = CAMPAIGN_SCHEDULE_RECIPES[kind];
  const cutoff = ts - recipe.cooldown_days * CAMPAIGN_SCHEDULE_DAY_MS;
  const recent = adapter.recentlyMailed(cutoff);
  let reach = 0;
  let cooling = 0;
  for (const email of adapter.eligibleEmails()) {
    if (recent.has(email)) cooling++;
    else reach++;
  }
  return { reach, cooling };
}

// ── Views ───────────────────────────────────────────────────────────────────

function toView(row: ScheduleRow, ts: number): CampaignScheduleView {
  const schedule = toSchedule(row);
  const adapter = ADAPTERS[schedule.kind];
  const { reach, cooling } = reachOf(schedule.kind, ts);
  return {
    schedule,
    recipe: CAMPAIGN_SCHEDULE_RECIPES[schedule.kind],
    reach,
    cooling_down: cooling,
    prepared: row.last_campaign_id == null ? null : adapter.view(row.last_campaign_id),
  };
}

export function listPlan(ts: number = now()): CampaignPlanView {
  return { items: allRows().map((row) => toView(row, ts)) };
}

export function getScheduleView(id: number, ts: number = now()): CampaignScheduleView {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Schedule not found");
  return toView(row, ts);
}

// ── Update ──────────────────────────────────────────────────────────────────

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "boolean") throw new HttpError(400, "expected a boolean");
  return raw;
}

function parseInt1(raw: unknown, fallback: number, max: number, label: string): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new HttpError(400, `${label} must be an integer 1..${max}`);
  }
  return n;
}

/** Patch the operator knobs. Changing the interval re-bases the NEXT due date
 *  off the last preparation (or now, if it has never run), so shortening the
 *  loop takes effect immediately instead of after the old, longer wait. */
export function updateSchedule(
  id: number,
  patch: UpdateCampaignScheduleInput,
  ts: number = now(),
): CampaignScheduleView {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Schedule not found");

  const enabled = parseBool(patch.enabled, row.enabled === 1);
  const autoStart = parseBool(patch.auto_start, row.auto_start === 1);
  const intervalDays = parseInt1(
    patch.interval_days,
    row.interval_days,
    CAMPAIGN_SCHEDULE_MAX_INTERVAL_DAYS,
    "interval_days",
  );
  const dailyCap = parseInt1(
    patch.daily_cap,
    row.daily_cap,
    CAMPAIGN_SCHEDULE_MAX_DAILY_CAP,
    "daily_cap",
  );

  const nextDue =
    intervalDays === row.interval_days
      ? row.next_due_at
      : (row.last_prepared_at ?? ts) + intervalDays * CAMPAIGN_SCHEDULE_DAY_MS;

  db.prepare(
    `UPDATE campaign_schedules
        SET enabled = ?, interval_days = ?, daily_cap = ?, auto_start = ?, next_due_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(enabled ? 1 : 0, intervalDays, dailyCap, autoStart ? 1 : 0, nextDue, ts, id);

  return getScheduleView(id, ts);
}

// ── Prepare ─────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `claim-invite-2026-08-14`, with a `-2` suffix if that handle is taken. Dated
 *  rather than numbered so a campaign's name says when it went out. */
function nextSlug(kind: CampaignScheduleKind, ts: number): string {
  const recipe = CAMPAIGN_SCHEDULE_RECIPES[kind];
  const d = new Date(ts);
  const base = `${recipe.slug_prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const table = ADAPTERS[kind].campaignsTable;
  const taken = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`);
  if (!taken.get(base)) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.get(candidate)) return candidate;
  }
  // 49 campaigns of one family in one day is not a real scenario; fail loudly
  // rather than silently reusing a handle.
  throw new HttpError(409, "Could not find a free campaign slug for today");
}

export type PrepareSkipReason = "disabled" | "not_due" | "in_flight" | "too_few_targets";

export interface PrepareResult {
  prepared: boolean;
  reason: PrepareSkipReason | null;
  campaign_id: number | null;
  reach: number;
  cooling_down: number;
  suppressed: number;
}

/** Build the next campaign for one schedule.
 *
 *  `force` is the operator pressing "Prepare now": it overrides the due date
 *  and the repeat switch (a one-off from a paused plan is a legitimate ask) but
 *  NOT the in-flight guard or the minimum audience, which exist to protect the
 *  recipients rather than to enforce a cadence. */
export function prepareSchedule(
  id: number,
  opts: { force?: boolean; actorUserId?: number | null; ts?: number } = {},
): PrepareResult {
  const ts = opts.ts ?? now();
  const force = opts.force === true;
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Schedule not found");
  const kind = isKind(row.kind) ? row.kind : null;
  if (!kind) throw new HttpError(500, `Unknown campaign schedule kind: ${row.kind}`);
  const adapter = ADAPTERS[kind];
  const recipe = CAMPAIGN_SCHEDULE_RECIPES[kind];

  const skip = (reason: PrepareSkipReason): PrepareResult => ({
    prepared: false,
    reason,
    campaign_id: null,
    reach: 0,
    cooling_down: 0,
    suppressed: 0,
  });

  if (!force && row.enabled !== 1) return skip("disabled");
  if (!force && row.next_due_at > ts) return skip("not_due");

  // One in flight: anything the schedule built that has not retired yet is
  // still this family's current campaign, whether it is waiting for a click or
  // draining. Building on top of it would split the audience across two paced
  // queues and double the hourly send rate.
  if (row.last_campaign_id != null) {
    const previous = adapter.view(row.last_campaign_id);
    if (previous && previous.status !== "done") return skip("in_flight");
  }

  const { reach, cooling } = reachOf(kind, ts);
  if (reach < recipe.min_targets) {
    return { ...skip("too_few_targets"), reach, cooling_down: cooling };
  }

  const cutoff = ts - recipe.cooldown_days * CAMPAIGN_SCHEDULE_DAY_MS;
  const campaignId = adapter.create(nextSlug(kind, ts), row.daily_cap, opts.actorUserId ?? null);
  const suppressed = adapter.seedCooldownSkips(campaignId, cutoff, ts);
  adapter.afterPrepare?.(campaignId);
  if (row.auto_start === 1) adapter.setRunning(campaignId);

  db.prepare(
    `UPDATE campaign_schedules
        SET last_prepared_at = ?, next_due_at = ?, last_campaign_id = ?, updated_at = ?
      WHERE id = ?`,
  ).run(ts, ts + row.interval_days * CAMPAIGN_SCHEDULE_DAY_MS, campaignId, ts, id);

  addAuditLog({
    actor_user_id: opts.actorUserId ?? null,
    couple_id: null,
    action: "campaign_schedule.prepare",
    target_kind: "campaign_schedule",
    target_id: id,
    after: {
      kind,
      campaign_id: campaignId,
      reach,
      suppressed,
      auto_start: row.auto_start === 1,
    },
  });

  return {
    prepared: true,
    reason: null,
    campaign_id: campaignId,
    reach,
    cooling_down: cooling,
    suppressed,
  };
}

/** Launch the campaign a schedule prepared. This is the one button the whole
 *  feature exists to leave the operator. */
export function runPreparedCampaign(id: number, actorUserId: number | null): CampaignScheduleView {
  const row = getRow(id);
  if (!row) throw new HttpError(404, "Schedule not found");
  const kind = isKind(row.kind) ? row.kind : null;
  if (!kind) throw new HttpError(500, `Unknown campaign schedule kind: ${row.kind}`);
  if (row.last_campaign_id == null) throw new HttpError(409, "Nothing prepared yet");
  const adapter = ADAPTERS[kind];
  const prepared = adapter.view(row.last_campaign_id);
  if (!prepared) throw new HttpError(409, "The prepared campaign is gone");
  if (prepared.status === "done") throw new HttpError(409, "That campaign has already finished");
  adapter.setRunning(prepared.id);
  addAuditLog({
    actor_user_id: actorUserId,
    couple_id: null,
    action: "campaign_schedule.run",
    target_kind: "campaign_schedule",
    target_id: id,
    after: { kind, campaign_id: prepared.id, slug: prepared.slug },
  });
  return getScheduleView(id);
}

// ── The sweep hook ──────────────────────────────────────────────────────────

/** Prepare every due schedule. Called by the hourly campaign sweep and once at
 *  boot. Sends nothing, so it is safe to run as often as the worker ticks. */
export function prepareDueSchedules(ts: number = now()): { prepared: number } {
  let prepared = 0;
  for (const row of allRows()) {
    if (row.enabled !== 1 || row.next_due_at > ts) continue;
    try {
      const result = prepareSchedule(row.id, { ts, actorUserId: null });
      if (result.prepared) {
        prepared++;
        log.info("campaign_schedule.prepared", {
          kind: row.kind,
          campaign_id: result.campaign_id,
          reach: result.reach,
          suppressed: result.suppressed,
        });
      }
    } catch (e) {
      // One broken family must not stop the others; the console still shows the
      // schedule as due, which is the honest state.
      log.warn("campaign_schedule.prepare_failed", {
        kind: row.kind,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { prepared };
}
