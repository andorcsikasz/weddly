// GDPR Article 20 (data portability): a couple owns their data and can take it
// with them. Returns a single JSON blob covering the workspace + both users +
// guests + budget + seating + recent audit log. PDFs are downloaded separately
// via the existing /api/print/* endpoints.

import { db } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser, toCouple } from "../domain/couples";
import { recordExport } from "../domain/exports";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { toUser, type UserRow } from "../domain/users";

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

  // Round-2 expansion: pull every couple-scoped sidecar into the bundle so
  // GDPR Article 20 exports really do contain everything the couple owns.
  const households = rowsByCouple<Record<string, unknown>>("households", couple.id);
  const coupleInvites = rowsByCouple<Record<string, unknown>>("couple_invites", couple.id);
  const emailLog = rowsByCouple<Record<string, unknown>>("email_log", couple.id);
  const emailDispatches = rowsByCouple<Record<string, unknown>>("email_dispatches", couple.id);
  const dataExportsSummary = db
    .prepare(
      `SELECT id, kind, format, filename, content_type, byte_size, created_at
         FROM data_exports
         WHERE couple_id = ?
         ORDER BY created_at DESC, id DESC`,
    )
    .all(couple.id);
  const pauseRequests = rowsByCouple<Record<string, unknown>>("couple_pause_requests", couple.id);
  const supplierCosts = rowsByCouple<Record<string, unknown>>("couple_supplier_costs", couple.id);
  // Community suppliers submitted by either partner — joined via the
  // submitter_user_id rather than couple_id (the table doesn't have that
  // column). Only the rows authored by THIS couple's users are exported.
  const partnerUserIds = [couple.partner_a_id, couple.partner_b_id].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  const communitySuppliers = partnerUserIds.length
    ? (db
        .prepare(
          `SELECT * FROM community_suppliers WHERE submitter_user_id IN (${partnerUserIds
            .map(() => "?")
            .join(",")}) ORDER BY id ASC`,
        )
        .all(...partnerUserIds) as Record<string, unknown>[])
    : [];

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.export",
    target_kind: "couple",
    target_id: couple.id,
  });

  const payload = {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    couple: toCouple(couple),
    partners: {
      partner_a: partnerA ? toUser(partnerA) : null,
      partner_b: partnerB ? toUser(partnerB) : null,
    },
    guests,
    households,
    couple_invites: coupleInvites,
    budget: { lines: budgetLines, snapshots: budgetSnapshots },
    seating: { tables: seatingTables, assignments: seatAssignments, conflicts: seatingConflicts },
    supplier_costs: supplierCosts,
    community_suppliers: communitySuppliers,
    email_log: emailLog,
    email_dispatches: emailDispatches,
    couple_pause_requests: pauseRequests,
    data_exports: dataExportsSummary,
    audit_log_recent: auditEntries,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const body = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "json",
    format: null,
    filename: `weddly-export-${stamp}.json`,
    contentType: "application/json",
    body,
  });

  return json(payload);
}

export function registerExportRoutes(router: Router) {
  router.get("/api/couples/export", handleExport, true);
}
