// The Weddly Points engine: the ONLY module that writes `vendor_points_ledger`.
//
// Feature code never awards points. A route that does something interesting
// calls `emitVendorEvent(...)` (or `emitVendorEventForSupplier(...)` when all it
// holds is a supplier id), which appends one row to `vendor_event_outbox` inside
// that feature's own transaction. The worker drains the outbox and applies the
// rules below. That separation is the whole point: reviews code stays reviews
// code, and "what a review is worth" has exactly one home.
//
// Everything about the design assumes the engine will be re-run:
//
//   • Every award carries a `dedupe_key` describing the OCCURRENCE, not the
//     attempt ("review:412"). A UNIQUE index turns a double delivery, a manual
//     replay and the retroactive backfill into the same single row.
//   • The backfill is therefore safe to run on every boot. It walks existing
//     reviews, bookings and profiles and awards what they would have earned had
//     the engine always existed.
//   • Caps are evaluated at award time against the ledger itself (rolling
//     calendar month), so replaying can never launder past a cap.
//
// Read side: totals and tiers are derived by summing the ledger. There is no
// stored counter to drift.

import {
  FAST_REPLY_HOURS,
  MAX_BOOKING_POINTS_PER_MONTH,
  MAX_REFERRAL_POINTS_PER_MONTH,
  MAX_REVIEW_POINTS_PER_MONTH,
  POINTS_BY_EVENT,
  PROFILE_MILESTONES,
  type VendorCategoryRank,
  type VendorPointsEntry,
  type VendorPointsEvent,
  type VendorPointsStatus,
  type VendorTierFacts,
  perksForTier,
  vendorNextTierFor,
  vendorTierFor,
  vendorTierProgress,
} from "@shared/vendor_points";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { listingCompleteness } from "./listings";
import { CLAIMED_DIRECTORY_FROM, getListingByVendorAccountId, getListingById } from "./listings";

/** Domain events the outbox carries. Named after what HAPPENED, never after
 *  what it should pay: a producer that knows the reward is a producer that
 *  will eventually disagree with the engine. */
export type VendorDomainEvent =
  | "review.created"
  | "booking.confirmed"
  | "booking.responded"
  | "profile.updated"
  | "referral.activated";

const RECENT_LIMIT = 20;
/** How many outbox rows one worker pass drains. Small: the queue is idle most
 *  of the time and a burst is fine to spread over a few ticks. */
const BATCH = 200;
/** After this many failed attempts an event is parked (processed_at set with
 *  last_error kept) so one poisonous row can't block the queue forever. */
const MAX_ATTEMPTS = 5;

// ── Producer side ──────────────────────────────────────────────────────────

/** Record that something happened to a vendor. Cheap, synchronous, and safe to
 *  call inside the caller's transaction: it is one INSERT into the outbox and
 *  it never computes points. */
export function emitVendorEvent(
  vendorAccountId: number | null | undefined,
  event: VendorDomainEvent,
  payload?: Record<string, unknown>,
): void {
  if (!vendorAccountId) return; // unclaimed listing: nobody to credit
  db.prepare(
    `INSERT INTO vendor_event_outbox (vendor_account_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(vendorAccountId, event, payload ? JSON.stringify(payload) : null, now());
}

/** Same, for callers that only hold a directory/supplier id. Resolves the owner
 *  through `listings`; an unclaimed listing simply emits nothing. */
export function emitVendorEventForSupplier(
  supplierId: string,
  event: VendorDomainEvent,
  payload?: Record<string, unknown>,
): void {
  const listing = getListingById(supplierId);
  emitVendorEvent(listing?.vendor_account_id ?? null, event, payload);
}

// ── Ledger writes (engine-internal) ────────────────────────────────────────

/** Append one award. Returns true if it landed, false if this occurrence was
 *  already paid (dedupe) or the rule's monthly cap is spent. */
function award(
  vendorAccountId: number,
  eventType: VendorPointsEvent,
  dedupeKey: string,
  points = POINTS_BY_EVENT[eventType],
  atMs = now(),
): boolean {
  if (points === 0) return false;
  if (!withinCap(vendorAccountId, eventType, points, atMs)) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO vendor_points_ledger
         (vendor_account_id, event_type, points, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(vendorAccountId, eventType, points, dedupeKey, atMs);
  return info.changes > 0;
}

/** Monthly ceilings, checked against the ledger so a replay can't slip past
 *  them. Only the farmable rules are capped; profile milestones cap themselves
 *  (there are four, ever) and a fast reply is worth too little to be worth
 *  manufacturing. */
function withinCap(
  vendorAccountId: number,
  eventType: VendorPointsEvent,
  points: number,
  atMs: number,
): boolean {
  const cap =
    eventType === "referral_activated"
      ? MAX_REFERRAL_POINTS_PER_MONTH
      : eventType === "review_collected"
        ? MAX_REVIEW_POINTS_PER_MONTH
        : eventType === "booking_confirmed"
          ? MAX_BOOKING_POINTS_PER_MONTH
          : null;
  if (cap === null) return true;
  const monthStart = Date.UTC(
    new Date(atMs).getUTCFullYear(),
    new Date(atMs).getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  );
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS total
         FROM vendor_points_ledger
        WHERE vendor_account_id = ? AND event_type = ? AND created_at >= ?`,
    )
    .get(vendorAccountId, eventType, monthStart) as { total: number };
  return row.total + points <= cap;
}

/** Admin correction. The only way a human writes the ledger, and it is still an
 *  append: a negative row, never an UPDATE. */
export function adjustVendorPoints(
  vendorAccountId: number,
  points: number,
  reason: string,
): boolean {
  return award(vendorAccountId, "admin_adjustment", `admin:${reason}:${now()}`, points);
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Profile completeness in 25% steps. Milestones are permanent: a vendor who
 *  crosses 75% and later deletes a photo keeps the points, because clawing them
 *  back would make the number jitter for a change the vendor made on purpose. */
function applyProfileMilestones(vendorAccountId: number, atMs = now()): number {
  const listing = getListingByVendorAccountId(vendorAccountId);
  if (!listing) return 0;
  const pct = listingCompleteness(listing);
  let awarded = 0;
  for (const milestone of PROFILE_MILESTONES) {
    if (
      pct >= milestone &&
      award(vendorAccountId, "profile_completeness", `profile:${milestone}`, undefined, atMs)
    ) {
      awarded += 1;
    }
  }
  return awarded;
}

/** A collected review. Value-blind: the rating never reaches this function. */
function applyReview(vendorAccountId: number, reviewId: number, atMs: number): void {
  const isFirst =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM vendor_points_ledger
            WHERE vendor_account_id = ? AND event_type = 'first_review'`,
        )
        .get(vendorAccountId) as { n: number }
    ).n === 0;
  if (isFirst) award(vendorAccountId, "first_review", `first_review:${reviewId}`, undefined, atMs);
  award(vendorAccountId, "review_collected", `review:${reviewId}`, undefined, atMs);
}

/** A booking the vendor answered inside the window. `first_response_at` is
 *  written server-side on the vendor's own status change, so this can't be
 *  self-reported. */
function applyFastReply(vendorAccountId: number, bookingId: number): void {
  const row = db
    .prepare("SELECT created_at, first_response_at FROM supplier_bookings WHERE id = ?")
    .get(bookingId) as { created_at: number; first_response_at: number | null } | undefined;
  if (!row?.first_response_at) return;
  const hours = (row.first_response_at - row.created_at) / 3_600_000;
  if (hours < 0 || hours > FAST_REPLY_HOURS) return;
  award(vendorAccountId, "fast_reply", `fast_reply:${bookingId}`, undefined, row.first_response_at);
}

/** An inquiry that became a wedding: the couple confirmed the booking.
 *
 *  This rule replaced `repeat_booking`, which paid only when a couple who had
 *  already booked this vendor booked them AGAIN. For a wedding supplier that is
 *  close to a rule that never fires — the customer marries once — so the
 *  rulebook was advertising 40 points nobody could earn, and the biggest thing a
 *  vendor can do on Weddly (actually close the business the marketplace sent
 *  them) paid nothing at all. It is now the most valuable repeatable rule in the
 *  table, capped monthly because it is also the most worth faking.
 *
 *  Keyed by booking id, so re-confirming a booking that was cancelled and
 *  revived pays once. `status` is re-read here rather than trusted from the
 *  event: the outbox row only says the booking was confirmed at the time it was
 *  written. */
function applyBookingConfirmed(vendorAccountId: number, bookingId: number): void {
  const booking = db
    .prepare("SELECT status, created_at FROM supplier_bookings WHERE id = ?")
    .get(bookingId) as { status: string; created_at: number } | undefined;
  if (booking?.status !== "confirmed") return;
  award(
    vendorAccountId,
    "booking_confirmed",
    `booking_confirmed:${bookingId}`,
    undefined,
    booking.created_at,
  );
}

// ── Worker side ────────────────────────────────────────────────────────────

interface OutboxRow {
  id: number;
  vendor_account_id: number;
  event_type: string;
  payload_json: string | null;
  created_at: number;
  attempts: number;
}

/** Apply one event. Pure dispatch: every rule lives above, nothing here knows a
 *  point value. */
function applyEvent(row: OutboxRow): void {
  const payload = (row.payload_json ? JSON.parse(row.payload_json) : {}) as Record<string, unknown>;
  const vendorId = row.vendor_account_id;
  switch (row.event_type as VendorDomainEvent) {
    case "review.created": {
      const reviewId = Number(payload.review_id);
      if (Number.isFinite(reviewId)) applyReview(vendorId, reviewId, row.created_at);
      break;
    }
    case "booking.responded": {
      const bookingId = Number(payload.booking_id);
      if (Number.isFinite(bookingId)) applyFastReply(vendorId, bookingId);
      break;
    }
    case "booking.confirmed": {
      const bookingId = Number(payload.booking_id);
      if (Number.isFinite(bookingId)) applyBookingConfirmed(vendorId, bookingId);
      break;
    }
    case "profile.updated":
      applyProfileMilestones(vendorId, row.created_at);
      break;
    case "referral.activated": {
      // Phase 3 writes the referral row; the engine only pays for it. Keyed by
      // the referred account so one activation can never pay twice.
      const referredId = Number(payload.referred_vendor_account_id);
      if (Number.isFinite(referredId)) {
        award(vendorId, "referral_activated", `referral:${referredId}`, undefined, row.created_at);
      }
      break;
    }
    default:
      // Unknown event: mark processed rather than retry forever. A typo in a
      // producer shouldn't stall the queue.
      break;
  }
}

/** Drain up to BATCH pending events. Returns how many were consumed. Safe to
 *  call concurrently with itself: each row is marked processed in the same
 *  transaction that applies it. */
export function processVendorEventOutbox(limit = BATCH): number {
  const rows = db
    .prepare(
      `SELECT id, vendor_account_id, event_type, payload_json, created_at, attempts
         FROM vendor_event_outbox
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
        db.prepare("UPDATE vendor_event_outbox SET processed_at = ? WHERE id = ?").run(
          now(),
          row.id,
        );
      })();
      done += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      const parked = attempts >= MAX_ATTEMPTS;
      db.prepare(
        `UPDATE vendor_event_outbox
            SET attempts = ?, last_error = ?, processed_at = ?
          WHERE id = ?`,
      ).run(attempts, String(e).slice(0, 500), parked ? now() : null, row.id);
      log.warn("vendor_points: event failed", { id: row.id, attempts, error: String(e) });
    }
  }
  return done;
}

// ── Retroactive backfill ───────────────────────────────────────────────────

/** Replay the points every vendor WOULD have earned had the engine always run.
 *  Idempotent through `dedupe_key`, so it is safe on every boot and cheap once
 *  it has nothing new to add.
 *
 *  Deliberately does NOT award `fast_reply` for historic inquiries: nothing
 *  recorded a first-response time before the column existed, and inventing one
 *  from `updated_at` (which every later edit moves) would hand out points for a
 *  reply speed nobody measured. */
export function backfillVendorPoints(): { vendors: number; awarded: number } {
  const accounts = db.prepare("SELECT id FROM vendor_accounts").all() as { id: number }[];
  let awarded = 0;
  for (const account of accounts) {
    const listing = getListingByVendorAccountId(account.id);
    awarded += applyProfileMilestones(account.id);

    if (listing) {
      const reviews = db
        .prepare(
          `SELECT id, created_at FROM supplier_reviews
            WHERE supplier_id = ? AND published = 1 AND deleted_at IS NULL
            ORDER BY created_at ASC`,
        )
        .all(listing.id) as { id: number; created_at: number }[];
      for (const r of reviews) {
        const before = ledgerCount(account.id);
        applyReview(account.id, r.id, r.created_at);
        awarded += ledgerCount(account.id) - before;
      }
    }

    const confirmed = db
      .prepare(
        `SELECT id FROM supplier_bookings
          WHERE vendor_account_id = ? AND status = 'confirmed'
          ORDER BY created_at ASC`,
      )
      .all(account.id) as { id: number }[];
    for (const b of confirmed) {
      const before = ledgerCount(account.id);
      applyBookingConfirmed(account.id, b.id);
      awarded += ledgerCount(account.id) - before;
    }
  }
  if (awarded > 0) log.info("vendor_points.backfill", { vendors: accounts.length, awarded });
  return { vendors: accounts.length, awarded };
}

function ledgerCount(vendorAccountId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM vendor_points_ledger WHERE vendor_account_id = ?")
      .get(vendorAccountId) as { n: number }
  ).n;
}

// ── Read side ──────────────────────────────────────────────────────────────

export function vendorPointsTotal(vendorAccountId: number): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(points), 0) AS total FROM vendor_points_ledger WHERE vendor_account_id = ?",
      )
      .get(vendorAccountId) as { total: number }
  ).total;
}

/** Lifetime points per rule, every key present. Derived like everything else:
 *  one GROUP BY over the ledger, no stored counter. */
function pointsByEvent(vendorAccountId: number): Record<VendorPointsEvent, number> {
  const totals = Object.fromEntries(
    (Object.keys(POINTS_BY_EVENT) as VendorPointsEvent[]).map((key) => [key, 0]),
  ) as Record<VendorPointsEvent, number>;
  const rows = db
    .prepare(
      `SELECT event_type, COALESCE(SUM(points), 0) AS total
         FROM vendor_points_ledger
        WHERE vendor_account_id = ?
        GROUP BY event_type`,
    )
    .all(vendorAccountId) as { event_type: VendorPointsEvent; total: number }[];
  // A row whose event_type predates (or postdates) this build is ignored rather
  // than added as a key the shared type doesn't declare.
  for (const row of rows) {
    if (row.event_type in totals) totals[row.event_type] = row.total;
  }
  return totals;
}

/** The vendor's place among the other vendors in their own category.
 *
 *  The pool is the PUBLIC directory pool (`CLAIMED_DIRECTORY_FROM`: active
 *  listing, active owner, no demo rows) rather than "every vendor_accounts row
 *  with this category", because a place counted against listings no couple can
 *  reach is a place against nobody. Unclaimed curated/community entries are out
 *  by construction: they have no account, so they have no points to be ranked
 *  by.
 *
 *  Ties share a place (`1 + how many are strictly ahead`), and the whole pool is
 *  read into memory rather than ranked in SQL: a category holds tens of claimed
 *  vendors, not thousands, and the JS is the version a reader can check.
 *
 *  Returns null when the ranking would say nothing: no listing, a listing that
 *  isn't live, or a category this vendor is alone in. */
export function vendorCategoryRank(vendorAccountId: number): VendorCategoryRank | null {
  const listing = getListingByVendorAccountId(vendorAccountId);
  if (!listing) return null;
  // DISTINCT, not GROUP BY: a vendor holding two listings in one category must
  // count as one competitor, and the correlated total keeps the ledger sum from
  // fanning out across those rows.
  const pool = db
    .prepare(
      `SELECT DISTINCT l.vendor_account_id AS id,
              (SELECT COALESCE(SUM(g.points), 0)
                 FROM vendor_points_ledger g
                WHERE g.vendor_account_id = l.vendor_account_id) AS points
         ${CLAIMED_DIRECTORY_FROM} AND l.category = ?`,
    )
    .all(listing.category) as { id: number; points: number }[];
  if (pool.length < 2) return null;

  const mine = pool.find((row) => row.id === vendorAccountId);
  if (!mine) return null; // listing hidden / owner suspended: no standing to show
  const ahead = pool.filter((row) => row.points > mine.points);
  const nearest = ahead.reduce<number | null>(
    (best, row) => (best === null || row.points < best ? row.points : best),
    null,
  );
  return {
    category: listing.category,
    rank: ahead.length + 1,
    total: pool.length,
    points_to_climb: nearest === null ? null : nearest - mine.points,
  };
}

/** The three facts a tier is graded against, counted off the ledger in one
 *  pass. Deliberately NOT read from `supplier_reviews` / `listings`:
 *
 *    • The ledger is append-only, so every count here can only go up. A review
 *      its author deletes or moderation unpublishes, a photo taken down after
 *      the profile hit 100%: none of them can take a tier away weeks later, for
 *      a change the vendor may not even have made. Counting the live tables
 *      would make the badge silently losable, which is the one thing that would
 *      make vendors stop trusting it.
 *    • It is also the same table the total comes from, so the tier stays a pure
 *      replay of one source rather than a verdict joined across three.
 *
 *  `review_collected` is one row per review (the first review writes a
 *  `first_review` row too, which is a bonus and is NOT counted here, or the
 *  first review would count twice). */
export function vendorTierFacts(vendorAccountId: number): VendorTierFacts {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(points), 0) AS points,
              SUM(CASE WHEN event_type = 'review_collected' THEN 1 ELSE 0 END) AS reviews,
              SUM(CASE WHEN event_type = 'profile_completeness' THEN 1 ELSE 0 END) AS milestones
         FROM vendor_points_ledger
        WHERE vendor_account_id = ?`,
    )
    .get(vendorAccountId) as { points: number; reviews: number | null; milestones: number | null };
  return {
    points: row.points,
    reviews: row.reviews ?? 0,
    profile_milestones: row.milestones ?? 0,
  };
}

/** Everything the dashboard needs, all derived. */
export function vendorPointsStatus(vendorAccountId: number): VendorPointsStatus {
  const facts = vendorTierFacts(vendorAccountId);
  const points = facts.points;
  const tier = vendorTierFor(facts);
  const next = vendorNextTierFor(facts);
  const recent = db
    .prepare(
      `SELECT id, event_type, points, created_at
         FROM vendor_points_ledger
        WHERE vendor_account_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(vendorAccountId, RECENT_LIMIT) as VendorPointsEntry[];
  return {
    points,
    facts,
    tier: tier.key,
    perks: perksForTier(tier.key),
    next_tier: next?.key ?? null,
    points_to_next: next ? Math.max(0, next.min_points - points) : 0,
    progress: vendorTierProgress(facts),
    recent,
    earned_by_event: pointsByEvent(vendorAccountId),
    category_rank: vendorCategoryRank(vendorAccountId),
  };
}
