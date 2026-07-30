// The planner-side Weddly Points engine: the ONLY module that writes
// `planner_points_ledger`.
//
// Structurally the twin of `domain/vendor_points.ts`, for the same reason the
// tables are twins: a planner is not a `vendor_accounts` row, so the vendor
// engine had nowhere to put one. Everything else is the same discipline.
//
// Feature code never awards points. A route that does something interesting
// calls `emitPlannerEvent(...)`, which appends one row to `planner_event_outbox`
// inside that feature's own transaction. The worker drains the outbox and applies
// the rules below, so the invitations code stays invitations code and "what an
// accepted client is worth" has exactly one home.
//
// The design assumes the engine WILL be re-run:
//
//   • Every award carries a `dedupe_key` naming the OCCURRENCE, not the attempt
//     ("client:88"). A UNIQUE index turns a double delivery, a manual replay and
//     the boot backfill into the same single row.
//   • The backfill therefore replays what every existing planner would have
//     earned had the engine always run, and is safe on every boot.
//   • Caps are evaluated at award time against the ledger itself, so a replay
//     can never launder past one.
//
// Every rule also RE-READS the thing it is paying for rather than trusting the
// outbox payload: an event only records that something was true when it was
// written, and a link revoked ten seconds later must not still pay.

import {
  MAX_PLANNER_CLIENT_POINTS_PER_MONTH,
  MAX_PLANNER_INVITE_POINTS_PER_MONTH,
  MAX_PLANNER_REVIEW_POINTS_PER_MONTH,
  PLANNER_POINTS_BY_EVENT,
  PLANNER_PROFILE_MILESTONES,
  PLANNER_TIERS,
  type PlannerPointsEntry,
  type PlannerPointsEvent,
  type PlannerPointsStatus,
  type PlannerRank,
  type PlannerTierKey,
  plannerChecklistCompleteness,
  plannerNextTierForPoints,
  plannerPerksForTier,
  plannerTierForPoints,
  plannerTierProgress,
} from "@shared/planner_points";
import { plannerReviewSubjectId } from "@shared/planner_reviews";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { PLANNER_DIRECTORY_VISIBLE_SQL, plannerChecklistForUser } from "./planner_profile";

/** Domain events the outbox carries. Named after what HAPPENED, never after what
 *  it should pay: a producer that knows the reward is a producer that will
 *  eventually disagree with the engine. */
export type PlannerDomainEvent =
  | "review.created"
  | "client.linked"
  | "invite.accepted"
  | "profile.updated";

const RECENT_LIMIT = 20;
/** How many outbox rows one worker pass drains. Small: the queue is idle most of
 *  the time and a burst is fine to spread over a few ticks. */
const BATCH = 200;
/** After this many failed attempts an event is parked (processed_at set, with
 *  last_error kept) so one poisonous row can't block the queue forever. */
const MAX_ATTEMPTS = 5;

// ── Producer side ──────────────────────────────────────────────────────────

/** Record that something happened to a planner. Cheap, synchronous and safe to
 *  call inside the caller's transaction: one INSERT, and it never computes
 *  points. */
export function emitPlannerEvent(
  plannerUserId: number | null | undefined,
  event: PlannerDomainEvent,
  payload?: Record<string, unknown>,
): void {
  if (!plannerUserId) return; // nobody to credit
  db.prepare(
    `INSERT INTO planner_event_outbox (planner_user_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(plannerUserId, event, payload ? JSON.stringify(payload) : null, now());
}

// ── Ledger writes (engine-internal) ────────────────────────────────────────

/** Append one award. Returns true if it landed, false if this occurrence was
 *  already paid (dedupe) or the rule's monthly cap is spent. */
function award(
  plannerUserId: number,
  eventType: PlannerPointsEvent,
  dedupeKey: string,
  points = PLANNER_POINTS_BY_EVENT[eventType],
  atMs = now(),
): boolean {
  if (points === 0) return false;
  if (!withinCap(plannerUserId, eventType, points, atMs)) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO planner_points_ledger
         (planner_user_id, event_type, points, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(plannerUserId, eventType, points, dedupeKey, atMs);
  return info.changes > 0;
}

/** Monthly ceilings, checked against the ledger so a replay can't slip past
 *  them. Only the farmable rules are capped: profile milestones cap themselves
 *  (there are four, ever) and an admin correction is a human decision. */
function withinCap(
  plannerUserId: number,
  eventType: PlannerPointsEvent,
  points: number,
  atMs: number,
): boolean {
  const cap =
    eventType === "review_collected"
      ? MAX_PLANNER_REVIEW_POINTS_PER_MONTH
      : eventType === "client_linked"
        ? MAX_PLANNER_CLIENT_POINTS_PER_MONTH
        : eventType === "couple_invited"
          ? MAX_PLANNER_INVITE_POINTS_PER_MONTH
          : null;
  if (cap === null) return true;
  const at = new Date(atMs);
  const monthStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS total
         FROM planner_points_ledger
        WHERE planner_user_id = ? AND event_type = ? AND created_at >= ?`,
    )
    .get(plannerUserId, eventType, monthStart) as { total: number };
  return row.total + points <= cap;
}

/** Admin correction. The only way a human writes the ledger, and it is still an
 *  append: a negative row, never an UPDATE. */
export function adjustPlannerPoints(
  plannerUserId: number,
  points: number,
  reason: string,
): boolean {
  return award(plannerUserId, "admin_adjustment", `admin:${reason}:${now()}`, points);
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Public-profile completeness in 25% steps, measured over the SAME checklist
 *  `GET /api/planner/profile` returns (`plannerChecklistForUser`), so the ring
 *  and the payout can never tell two stories.
 *
 *  Milestones are permanent: a planner who crosses 75% and later deletes a photo
 *  keeps the points. Clawing them back would make the number jitter for a change
 *  the planner made on purpose, and a progress bar that goes backwards reads as a
 *  punishment for editing your own page. */
function applyProfileMilestones(plannerUserId: number, atMs = now()): number {
  const checklist = plannerChecklistForUser(plannerUserId);
  if (!checklist) return 0;
  const pct = plannerChecklistCompleteness(checklist);
  let awarded = 0;
  for (const milestone of PLANNER_PROFILE_MILESTONES) {
    if (
      pct >= milestone &&
      award(plannerUserId, "profile_completeness", `profile:${milestone}`, undefined, atMs)
    ) {
      awarded += 1;
    }
  }
  return awarded;
}

/** A collected review. Value-blind by rule 2: `rating` is deliberately not even
 *  SELECTed here, so there is no way for a star value to leak into a payout.
 *
 *  What IS re-read is `published` (and the soft-delete tombstone), because an
 *  unpublished draft is a review nobody but its author can see, and the vendor
 *  side's backfill has always treated drafts as unearned. The subject is checked
 *  too: `supplier_reviews.supplier_id` is bare TEXT, so an event carrying the
 *  wrong id must not credit this planner for somebody else's review. */
function applyReview(plannerUserId: number, reviewId: number, atMs: number): void {
  const review = db
    .prepare("SELECT supplier_id, published, deleted_at FROM supplier_reviews WHERE id = ?")
    .get(reviewId) as
    | { supplier_id: string; published: number; deleted_at: number | null }
    | undefined;
  if (!review) return;
  if (review.published !== 1 || review.deleted_at !== null) return;
  if (review.supplier_id !== plannerReviewSubjectId(plannerUserId)) return;

  const isFirst =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM planner_points_ledger
            WHERE planner_user_id = ? AND event_type = 'first_review'`,
        )
        .get(plannerUserId) as { n: number }
    ).n === 0;
  if (isFirst) award(plannerUserId, "first_review", `first_review:${reviewId}`, undefined, atMs);
  award(plannerUserId, "review_collected", `review:${reviewId}`, undefined, atMs);
}

/** A couple accepted the link: the planner's equivalent of a confirmed booking,
 *  and the most valuable repeatable rule in the table.
 *
 *  Keyed by couple, so a link that was revoked and re-established pays once.
 *  `status` is re-read rather than trusted from the event (the outbox row only
 *  says the link WAS active when it was written), and a demo workspace is
 *  excluded outright: `is_demo` rows are seeded by the planner's own demo button
 *  and reaped days later, so paying for them would be paying for a button. */
function applyClientLinked(plannerUserId: number, coupleId: number): void {
  const link = db
    .prepare(
      `SELECT pc.created_at
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
        WHERE pc.planner_user_id = ? AND pc.couple_id = ?
          AND pc.status = 'active' AND c.is_demo = 0`,
    )
    .get(plannerUserId, coupleId) as { created_at: number } | undefined;
  if (!link) return;
  award(plannerUserId, "client_linked", `client:${coupleId}`, undefined, link.created_at);
}

/** A couple the planner invited by email signed up and onboarded. Paid on top of
 *  `client_linked` on purpose: bringing a NEW couple to Weddly is worth something
 *  separate from linking one who was already here.
 *
 *  Keyed by invitation, and re-read with the planner id in the WHERE so a
 *  mis-addressed event can't credit an invitation somebody else sent. */
function applyCoupleInvited(plannerUserId: number, invitationId: number): void {
  const invite = db
    .prepare(
      `SELECT accepted_at, created_at FROM planner_invitations
        WHERE id = ? AND planner_user_id = ? AND status = 'accepted'`,
    )
    .get(invitationId, plannerUserId) as
    | { accepted_at: number | null; created_at: number }
    | undefined;
  if (!invite) return;
  award(
    plannerUserId,
    "couple_invited",
    `invite:${invitationId}`,
    undefined,
    invite.accepted_at ?? invite.created_at,
  );
}

// ── Worker side ────────────────────────────────────────────────────────────

interface OutboxRow {
  id: number;
  planner_user_id: number;
  event_type: string;
  payload_json: string | null;
  created_at: number;
  attempts: number;
}

/** Apply one event. Pure dispatch: every rule lives above, nothing here knows a
 *  point value. */
function applyEvent(row: OutboxRow): void {
  const payload = (row.payload_json ? JSON.parse(row.payload_json) : {}) as Record<string, unknown>;
  const plannerId = row.planner_user_id;
  switch (row.event_type as PlannerDomainEvent) {
    case "review.created": {
      const reviewId = Number(payload.review_id);
      if (Number.isFinite(reviewId)) applyReview(plannerId, reviewId, row.created_at);
      break;
    }
    case "client.linked": {
      const coupleId = Number(payload.couple_id);
      if (Number.isFinite(coupleId)) applyClientLinked(plannerId, coupleId);
      break;
    }
    case "invite.accepted": {
      const invitationId = Number(payload.invitation_id);
      if (Number.isFinite(invitationId)) applyCoupleInvited(plannerId, invitationId);
      break;
    }
    case "profile.updated":
      applyProfileMilestones(plannerId, row.created_at);
      break;
    default:
      // Unknown event: mark processed rather than retry forever. A typo in a
      // producer shouldn't stall the queue behind it.
      break;
  }
}

/** Drain up to BATCH pending events. Returns how many were consumed. Safe to
 *  call concurrently with itself: each row is marked processed in the same
 *  transaction that applies it. */
export function processPlannerEventOutbox(limit = BATCH): number {
  const rows = db
    .prepare(
      `SELECT id, planner_user_id, event_type, payload_json, created_at, attempts
         FROM planner_event_outbox
        WHERE processed_at IS NULL
        ORDER BY id
        LIMIT ?`,
    )
    .all(limit) as OutboxRow[];
  let done = 0;
  for (const row of rows) {
    try {
      db.transaction(() => {
        applyEvent(row);
        db.prepare("UPDATE planner_event_outbox SET processed_at = ? WHERE id = ?").run(
          now(),
          row.id,
        );
      })();
      done += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      const parked = attempts >= MAX_ATTEMPTS;
      db.prepare(
        `UPDATE planner_event_outbox
            SET attempts = ?, last_error = ?, processed_at = ?
          WHERE id = ?`,
      ).run(attempts, String(e).slice(0, 500), parked ? now() : null, row.id);
      log.warn("planner_points: event failed", { id: row.id, attempts, error: String(e) });
    }
  }
  return done;
}

// ── Retroactive backfill ───────────────────────────────────────────────────

/** Replay the points every planner WOULD have earned had the engine always run:
 *  profile milestones, published reviews on their `planner:{id}` subject, active
 *  client links and accepted email invitations. Idempotent through `dedupe_key`,
 *  so it is safe on every boot and cheap once it has nothing new to add.
 *
 *  The four rules it replays are exactly the four the live path emits, which is
 *  what makes "the engine shipped late" indistinguishable from "the engine was
 *  always there" for an existing planner. */
export function backfillPlannerPoints(): { planners: number; awarded: number } {
  const planners = db.prepare("SELECT id FROM users WHERE user_type = 'planner'").all() as {
    id: number;
  }[];
  let awarded = 0;
  for (const planner of planners) {
    awarded += applyProfileMilestones(planner.id);

    const reviews = db
      .prepare(
        `SELECT id FROM supplier_reviews
          WHERE supplier_id = ? AND published = 1 AND deleted_at IS NULL
          ORDER BY created_at ASC`,
      )
      .all(plannerReviewSubjectId(planner.id)) as { id: number }[];
    for (const r of reviews) {
      awarded += countedAward(planner.id, () => applyReview(planner.id, r.id, now()));
    }

    const links = db
      .prepare(
        `SELECT pc.couple_id AS couple_id
           FROM planner_clients pc
           JOIN couples c ON c.id = pc.couple_id
          WHERE pc.planner_user_id = ? AND pc.status = 'active' AND c.is_demo = 0
          ORDER BY pc.created_at ASC`,
      )
      .all(planner.id) as { couple_id: number }[];
    for (const l of links) {
      awarded += countedAward(planner.id, () => applyClientLinked(planner.id, l.couple_id));
    }

    const invites = db
      .prepare(
        `SELECT id FROM planner_invitations
          WHERE planner_user_id = ? AND status = 'accepted'
          ORDER BY COALESCE(accepted_at, created_at) ASC`,
      )
      .all(planner.id) as { id: number }[];
    for (const inv of invites) {
      awarded += countedAward(planner.id, () => applyCoupleInvited(planner.id, inv.id));
    }
  }
  if (awarded > 0) log.info("planner_points.backfill", { planners: planners.length, awarded });
  return { planners: planners.length, awarded };
}

/** How many ledger rows a rule added. The rules return void (they may award one
 *  row or two), so the backfill counts the difference instead of asking them. */
function countedAward(plannerUserId: number, run: () => void): number {
  const before = ledgerCount(plannerUserId);
  run();
  return ledgerCount(plannerUserId) - before;
}

function ledgerCount(plannerUserId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM planner_points_ledger WHERE planner_user_id = ?")
      .get(plannerUserId) as { n: number }
  ).n;
}

// ── Read side ──────────────────────────────────────────────────────────────

export function plannerPointsTotal(plannerUserId: number): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(points), 0) AS total FROM planner_points_ledger WHERE planner_user_id = ?",
      )
      .get(plannerUserId) as { total: number }
  ).total;
}

/** Lifetime points per rule, every key present. Derived like everything else:
 *  one GROUP BY over the ledger, no stored counter. */
function pointsByEvent(plannerUserId: number): Record<PlannerPointsEvent, number> {
  const totals = Object.fromEntries(
    (Object.keys(PLANNER_POINTS_BY_EVENT) as PlannerPointsEvent[]).map((key) => [key, 0]),
  ) as Record<PlannerPointsEvent, number>;
  const rows = db
    .prepare(
      `SELECT event_type, COALESCE(SUM(points), 0) AS total
         FROM planner_points_ledger
        WHERE planner_user_id = ?
        GROUP BY event_type`,
    )
    .all(plannerUserId) as { event_type: PlannerPointsEvent; total: number }[];
  // A row whose event_type predates (or postdates) this build is ignored rather
  // than added as a key the shared type doesn't declare.
  for (const row of rows) {
    if (row.event_type in totals) totals[row.event_type] = row.total;
  }
  return totals;
}

/** The tier a directory card may WEAR, or null when the tier earned no badge.
 *  Null rather than `"blue"` so the card renders a badge only when there is one
 *  to render: every planner is in blue, and a badge everyone has is chrome. */
export function plannerBadgeTierForPoints(points: number): PlannerTierKey | null {
  const tier = plannerTierForPoints(points);
  return tier.perks.profile_badge ? tier.key : null;
}

// ── Directory ranking perk (`directory_boost`) ─────────────────────────────
//
// The couple-facing directory needs each planner's ledger total to sort by, so
// the engine hands the query the two fragments rather than letting a route
// hand-roll SQL against a table it doesn't own.

/** Per-planner ledger sum as a JOIN over a `users u` alias. One grouped pass
 *  instead of a correlated subquery per sort rung. */
export const PLANNER_POINTS_SUM_JOIN = `
  LEFT JOIN (SELECT planner_user_id, SUM(points) AS points
               FROM planner_points_ledger GROUP BY planner_user_id) pp
    ON pp.planner_user_id = u.id`;

/** The tier's `directory_boost` for the joined total, as a sort expression.
 *  Generated from PLANNER_TIERS (descending, so the first matching rung wins),
 *  which is what keeps the perk table the only place a boost is defined. The
 *  interpolated values are integers from that table, never input. */
export const PLANNER_DIRECTORY_BOOST_SQL = (() => {
  const rungs = [...PLANNER_TIERS]
    .filter((t) => t.perks.directory_boost > 0)
    .sort((a, b) => b.min_points - a.min_points)
    .map((t) => `WHEN COALESCE(pp.points, 0) >= ${t.min_points} THEN ${t.perks.directory_boost}`);
  return rungs.length === 0 ? "0" : `(CASE ${rungs.join(" ")} ELSE 0 END)`;
})();

/** The planner's place among the planners a couple can ACTUALLY find.
 *
 *  The pool is the directory's own visibility predicate
 *  (`PLANNER_DIRECTORY_VISIBLE_SQL`), not "every planner user": a place counted
 *  against profiles no couple can reach is a place against nobody. It is scoped
 *  to the planner's own `planner_country` when they have set one, because a
 *  planner in Hungary measured against every planner in Europe learns nothing;
 *  a planner who never said where they work is ranked globally rather than
 *  dropped.
 *
 *  Ties share a place (`1 + how many are strictly ahead`), and the pool is
 *  ranked in JS over a small result set rather than in SQL: a country holds tens
 *  of listable planners, not thousands, and the JS is the version a reader can
 *  check.
 *
 *  Returns null when the ranking would say nothing: a planner outside the
 *  directory pool, or a pool of one, where "1st of 1" is a fact about the market
 *  rather than about the planner. */
export function plannerRank(plannerUserId: number): PlannerRank | null {
  const me = db.prepare("SELECT planner_country FROM users WHERE id = ?").get(plannerUserId) as
    | { planner_country: string | null }
    | undefined;
  if (!me) return null;
  const country = me.planner_country?.trim() || null;
  const params: string[] = country ? [country] : [];
  const pool = db
    .prepare(
      `SELECT u.id AS id, COALESCE(pp.points, 0) AS points
         FROM users u
         ${PLANNER_POINTS_SUM_JOIN}
        WHERE ${PLANNER_DIRECTORY_VISIBLE_SQL}
          ${country ? "AND u.planner_country = ?" : ""}`,
    )
    .all(...params) as { id: number; points: number }[];
  if (pool.length < 2) return null;

  const mine = pool.find((row) => row.id === plannerUserId);
  if (!mine) return null; // thin profile / suspended / dormant: no standing to show
  const ahead = pool.filter((row) => row.points > mine.points);
  const nearest = ahead.reduce<number | null>(
    (best, row) => (best === null || row.points < best ? row.points : best),
    null,
  );
  return {
    country,
    rank: ahead.length + 1,
    total: pool.length,
    points_to_climb: nearest === null ? null : nearest - mine.points,
  };
}

/** Everything the planner's points panel needs, all derived. */
export function plannerPointsStatus(plannerUserId: number): PlannerPointsStatus {
  const points = plannerPointsTotal(plannerUserId);
  const tier = plannerTierForPoints(points);
  const next = plannerNextTierForPoints(points);
  const recent = db
    .prepare(
      `SELECT id, event_type, points, created_at
         FROM planner_points_ledger
        WHERE planner_user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(plannerUserId, RECENT_LIMIT) as PlannerPointsEntry[];
  return {
    points,
    tier: tier.key,
    perks: plannerPerksForTier(tier.key),
    next_tier: next?.key ?? null,
    points_to_next: next ? Math.max(0, next.min_points - points) : 0,
    progress: plannerTierProgress(points),
    recent,
    earned_by_event: pointsByEvent(plannerUserId),
    rank: plannerRank(plannerUserId),
  };
}
