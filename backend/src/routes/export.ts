// GDPR Article 20 (data portability): a couple owns their data and can take it
// with them. Returns a single JSON blob covering the workspace + both users +
// guests + budget + seating + recent audit log. PDFs are downloaded separately
// via the existing /api/print/* endpoints.

import { db } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser, toCouple } from "../lib/couples";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { toUser, type UserRow } from "../lib/users";

function rowsByCouple<T>(table: string, coupleId: number): T[] {
  return db
    .prepare(`SELECT * FROM ${table} WHERE couple_id = ? ORDER BY id ASC`)
    .all(coupleId) as T[];
}

function handleExport(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const partnerA = db.prepare("SELECT * FROM users WHERE id = ?").get(couple.partner_a_id) as
    | UserRow
    | undefined;
  const partnerB = couple.partner_b_id
    ? (db.prepare("SELECT * FROM users WHERE id = ?").get(couple.partner_b_id) as
        | UserRow
        | undefined)
    : undefined;

  const guests = rowsByCouple<Record<string, unknown>>("guests", couple.id);
  const budgetLines = rowsByCouple<Record<string, unknown>>("budget_lines", couple.id);
  const budgetSnapshots = rowsByCouple<Record<string, unknown>>("budget_snapshots", couple.id);
  const seatingTables = rowsByCouple<Record<string, unknown>>("seating_tables", couple.id);
  const seatingConflicts = rowsByCouple<Record<string, unknown>>("seating_conflicts", couple.id);
  const tableIds = (seatingTables as { id: number }[]).map((t) => t.id);
  const seatAssignments = tableIds.length
    ? (db
        .prepare(
          `SELECT * FROM seat_assignments WHERE table_id IN (${tableIds.map(() => "?").join(",")})`,
        )
        .all(...tableIds) as Record<string, unknown>[])
    : [];

  const auditEntries = db
    .prepare(
      "SELECT id, action, target_kind, target_id, after_json, note, created_at FROM audit_log WHERE couple_id = ? ORDER BY id DESC LIMIT 500",
    )
    .all(couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.export",
    target_kind: "couple",
    target_id: couple.id,
  });

  return json({
    schema_version: 1,
    exported_at: new Date().toISOString(),
    couple: toCouple(couple),
    partners: {
      partner_a: partnerA ? toUser(partnerA) : null,
      partner_b: partnerB ? toUser(partnerB) : null,
    },
    guests,
    budget: { lines: budgetLines, snapshots: budgetSnapshots },
    seating: { tables: seatingTables, assignments: seatAssignments, conflicts: seatingConflicts },
    audit_log_recent: auditEntries,
  });
}

export function registerExportRoutes(router: Router) {
  router.get("/api/couples/export", handleExport, true);
}
