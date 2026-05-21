// Growth-instrumentation recorder. Feeds the funnel behind the founder's
// 60-day commitment metric. Decided in 2026-05-21 multi-agent debate (path D
// synthesis): measure existing surfaces BEFORE shipping new features so the
// microsite roll-out has a baseline to compare against.
//
// Anonymous-tolerant: a guest hitting /rsvp/<slug>/<code> doesn't carry a
// user_id but still counts. All writes are best-effort — a logged failure
// never blocks the user-facing handler (analytics must not break login).
//
// Privacy: we store a hashed user-agent (16-hex SHA-256 prefix) and a
// truncated Referer rather than raw values, so the table can't be used to
// re-identify guests across weddings.

import { createHash } from "node:crypto";
import { db, now } from "../db";
import type { GrowthEvent, GrowthEventAggregate, GrowthEventKind } from "@shared/growth";

const REFERRER_MAX_LEN = 500;
const UA_HASH_PREFIX_LEN = 16;

function truncateReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  return referrer.length > REFERRER_MAX_LEN ? referrer.slice(0, REFERRER_MAX_LEN) : referrer;
}

function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return createHash("sha256").update(ua).digest("hex").slice(0, UA_HASH_PREFIX_LEN);
}

export interface RecordEventOptions {
  /** Couple workspace involved, when resolvable. */
  couple_id?: number | null;
  /** Authenticated user, when present. */
  user_id?: number | null;
  /** Household the event ties to (RSVP page view, checkin). */
  household_id?: number | null;
  /** HTTP Referer header from the calling request. */
  referrer?: string | null;
  /** User-Agent header from the calling request. */
  user_agent?: string | null;
  /** Per-event extras serialised to `payload_json`. */
  payload?: Record<string, unknown> | null;
}

const insertStmt = db.prepare(
  `INSERT INTO growth_events
    (kind, couple_id, user_id, household_id, referrer, user_agent_hash, payload_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

/** Single-row insert. Swallows DB errors after a console.warn so analytics
 *  outages never propagate to the user flow. */
export function recordGrowthEvent(kind: GrowthEventKind, opts: RecordEventOptions = {}): void {
  try {
    insertStmt.run(
      kind,
      opts.couple_id ?? null,
      opts.user_id ?? null,
      opts.household_id ?? null,
      truncateReferrer(opts.referrer ?? null),
      hashUserAgent(opts.user_agent ?? null),
      opts.payload ? JSON.stringify(opts.payload) : null,
      now(),
    );
  } catch (e) {
    console.warn("growth_events.insert_failed", { kind, err: String(e) });
  }
}

/** Sugar for the common case: a route handler with a `Request` already in
 *  scope. Pulls Referer + User-Agent off the headers so each call site
 *  doesn't repeat the boilerplate. */
export function recordGrowthEventFromRequest(
  kind: GrowthEventKind,
  req: Request,
  extras: Omit<RecordEventOptions, "referrer" | "user_agent"> = {},
): void {
  recordGrowthEvent(kind, {
    ...extras,
    referrer: req.headers.get("referer"),
    user_agent: req.headers.get("user-agent"),
  });
}

interface RowShape {
  id: number;
  kind: string;
  couple_id: number | null;
  user_id: number | null;
  household_id: number | null;
  referrer: string | null;
  user_agent_hash: string | null;
  payload_json: string | null;
  created_at: number;
}

function toGrowthEvent(row: RowShape): GrowthEvent {
  return {
    id: row.id,
    kind: row.kind as GrowthEventKind,
    couple_id: row.couple_id,
    user_id: row.user_id,
    household_id: row.household_id,
    referrer: row.referrer,
    user_agent_hash: row.user_agent_hash,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : null,
    created_at: row.created_at,
  };
}

/** Aggregate by kind for the admin growth dashboard. One GROUP BY pass with
 *  CASE-WHEN sums so we don't N+1 across kinds. */
export function aggregateGrowthEvents(): GrowthEventAggregate[] {
  const ts = now();
  const dayMs = 24 * 60 * 60 * 1000;
  const window24 = ts - dayMs;
  const window7d = ts - dayMs * 7;

  const rows = db
    .prepare(
      `SELECT
         kind,
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

  return rows.map((r) => ({
    kind: r.kind as GrowthEventKind,
    total: r.total,
    last_24h: r.last_24h,
    last_7d: r.last_7d,
    last_event_at: r.last_event_at,
  }));
}

/** Latest events for the admin debug pane — moderator can confirm hooks
 *  fire without grepping logs. Hard-capped at 500 to avoid runaway pulls. */
export function listRecentGrowthEvents(limit = 100): GrowthEvent[] {
  const capped = Math.max(1, Math.min(limit, 500));
  const rows = db
    .prepare("SELECT * FROM growth_events ORDER BY id DESC LIMIT ?")
    .all(capped) as RowShape[];
  return rows.map(toGrowthEvent);
}
