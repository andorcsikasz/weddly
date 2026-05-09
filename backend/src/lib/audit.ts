// Append-only audit log. Never UPDATE or DELETE these rows.

import { db, now } from "../db";

export function addAuditLog(input: {
  actor_user_id: number | null;
  couple_id: number | null;
  action: string;
  target_kind: string;
  target_id: number | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}) {
  db.prepare(
    `INSERT INTO audit_log
      (actor_user_id, couple_id, action, target_kind, target_id, before_json, after_json, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.actor_user_id,
    input.couple_id,
    input.action,
    input.target_kind,
    input.target_id,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.note ?? null,
    now(),
  );
}
