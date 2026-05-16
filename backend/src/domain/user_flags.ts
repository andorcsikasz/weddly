// Admin moderation flags. An admin flags a user with a reason; the system
// emails the user, gives them 7 days to reply, and the hourly purge sweep
// deletes the account if the flag isn't resolved before the deadline.
//
// All writes are funnelled through the helpers in this module so the audit
// log + email side-effects stay in one place. The route layer just calls
// these and emits the audit row.

import { db, now } from "../db";

/** Grace window after flagging. Defaults to 7 days; exposed so tests can
 *  override via setUserFlagWindowMsForTest (e.g. simulate the deadline
 *  expiring without sleeping). */
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
let windowMs = DEFAULT_WINDOW_MS;

export function setUserFlagWindowMsForTest(ms: number | null): void {
  windowMs = ms ?? DEFAULT_WINDOW_MS;
}

export interface UserFlagRow {
  id: number;
  user_id: number;
  flagged_by_user_id: number | null;
  reason: string;
  scheduled_delete_at: number;
  resolved_at: number | null;
  resolved_by_user_id: number | null;
  resolution_note: string | null;
  created_at: number;
}

/** Insert a flag and return the row. Caller is responsible for the email
 *  send and audit-log entry — keeps this helper side-effect-free except
 *  for the DB write. Throws if the user already has an unresolved flag
 *  (the UI prevents this, but a stray double-click shouldn't stack flags). */
export function createUserFlag(input: {
  user_id: number;
  flagged_by_user_id: number | null;
  reason: string;
}): UserFlagRow {
  const ts = now();
  const existing = getActiveFlagForUser(input.user_id);
  if (existing) {
    throw new Error("User already has an active flag");
  }
  const result = db
    .prepare(
      `INSERT INTO user_flags
         (user_id, flagged_by_user_id, reason, scheduled_delete_at, resolved_at, resolved_by_user_id, resolution_note, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    )
    .run(input.user_id, input.flagged_by_user_id, input.reason, ts + windowMs, ts);
  const id = Number(result.lastInsertRowid);
  return getFlagById(id) as UserFlagRow;
}

/** Mark the user's active flag resolved. Returns the resolved row, or null
 *  if there was nothing to resolve (idempotent). */
export function resolveActiveFlagForUser(input: {
  user_id: number;
  resolved_by_user_id: number | null;
  note: string;
}): UserFlagRow | null {
  const active = getActiveFlagForUser(input.user_id);
  if (!active) return null;
  const ts = now();
  db.prepare(
    `UPDATE user_flags
        SET resolved_at = ?, resolved_by_user_id = ?, resolution_note = ?
      WHERE id = ?`,
  ).run(ts, input.resolved_by_user_id, input.note, active.id);
  return getFlagById(active.id);
}

export function getFlagById(id: number): UserFlagRow | null {
  const row = db.prepare("SELECT * FROM user_flags WHERE id = ?").get(id) as
    | UserFlagRow
    | undefined;
  return row ?? null;
}

/** The single open flag for a user (if any). NULL when no flag exists or
 *  every flag has been resolved. Multiple historical flags are allowed —
 *  this picks the unresolved one. */
export function getActiveFlagForUser(userId: number): UserFlagRow | null {
  const row = db
    .prepare(
      "SELECT * FROM user_flags WHERE user_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId) as UserFlagRow | undefined;
  return row ?? null;
}

/** Map of user_id → active flag, for the admin directory list. Avoids N+1
 *  reads when rendering the page (one query per listing). */
export function activeFlagsByUserId(): Map<number, UserFlagRow> {
  const rows = db
    .prepare("SELECT * FROM user_flags WHERE resolved_at IS NULL ORDER BY created_at DESC")
    .all() as UserFlagRow[];
  const out = new Map<number, UserFlagRow>();
  for (const r of rows) {
    if (!out.has(r.user_id)) out.set(r.user_id, r);
  }
  return out;
}

/** All flags whose deadline has passed and that haven't been resolved.
 *  Worker hands each one to the purge sweep. */
export function listFlagsDueForPurge(): UserFlagRow[] {
  return db
    .prepare(
      "SELECT * FROM user_flags WHERE resolved_at IS NULL AND scheduled_delete_at <= ? ORDER BY scheduled_delete_at ASC",
    )
    .all(now()) as UserFlagRow[];
}

/** Mark a flag resolved with a system-generated note. Used by the purge
 *  worker to close out a flag at the moment of auto-deletion so it
 *  doesn't fire again on the next sweep. */
export function markFlagPurged(flagId: number): void {
  const ts = now();
  db.prepare(
    `UPDATE user_flags
        SET resolved_at = ?, resolution_note = 'auto-purged at deadline'
      WHERE id = ?`,
  ).run(ts, flagId);
}
