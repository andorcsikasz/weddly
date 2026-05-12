// Admin moderation for community-submitted suppliers. Gate every handler
// with requireAdmin() — that checks auth + ADMIN_EMAILS allowlist.

import {
  approveSupplier,
  deleteCommunitySupplier,
  dismissReportsForSupplier,
  getCommunitySupplierById,
  getCommunitySupplierWithEmail,
  listAllForAdmin,
  listOpenReportsForSupplier,
  openReportCountsForAll,
  setStatus,
  toAdminView,
  updateAdminNotes,
} from "../domain/community_suppliers";
import { enrichSupplier } from "../domain/supplier_enrich";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

interface HideBody {
  reason?: unknown;
}

interface NotesBody {
  notes?: unknown;
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  const counts = openReportCountsForAll();
  return json({
    suppliers: listAllForAdmin().map((row) => toAdminView(row, counts.get(row.id) ?? 0)),
  });
}

function handleListReports(ctx: Ctx): Response {
  requireAdmin(ctx);
  const id = parseId(ctx);
  if (!getCommunitySupplierById(id)) throw new HttpError(404, "Supplier not found");
  return json({ reports: listOpenReportsForSupplier(id) });
}

function handleDismissReports(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  if (!getCommunitySupplierById(id)) throw new HttpError(404, "Supplier not found");
  const dismissed = dismissReportsForSupplier(id, admin.id);
  if (dismissed > 0) {
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "supplier.community.reports.dismiss",
      target_kind: "community_supplier",
      target_id: id,
      after: { dismissed },
    });
  }
  return json({ ok: true, dismissed });
}

async function handleHide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const body = await readJson<HideBody>(ctx.req).catch(() => ({}) as HideBody);
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  setStatus(id, "hidden", admin.id, reason);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.hide",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status },
    after: { status: "hidden", hide_reason: reason },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleEnrich(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const filled = await enrichSupplier(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.enrich",
    target_kind: "community_supplier",
    target_id: id,
    after: { fields_filled: filled },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0), fields_filled: filled });
}

function handleApprove(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");
  if (before.status !== "awaiting_review") {
    throw new HttpError(
      409,
      `Cannot approve from status="${before.status}" — only "awaiting_review" rows are approvable.`,
    );
  }

  approveSupplier(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.approve",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status },
    after: { status: "active" },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleUnhide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  setStatus(id, "active", null, null);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.unhide",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status, hide_reason: before.hide_reason },
    after: { status: "active" },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleUpdateNotes(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const body = await readJson<NotesBody>(ctx.req).catch(() => ({}) as NotesBody);
  if (typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string");
  }

  updateAdminNotes(id, body.notes);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.notes.update",
    target_kind: "community_supplier",
    target_id: id,
    before: { admin_notes_length: before.admin_notes?.length ?? 0 },
    after: { admin_notes_length: body.notes.length },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

function handleDelete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  deleteCommunitySupplier(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.delete",
    target_kind: "community_supplier",
    target_id: id,
    before,
  });

  return json({ ok: true });
}

export function registerAdminSupplierRoutes(router: Router) {
  router.get("/api/admin/suppliers", handleList, true);
  router.get("/api/admin/suppliers/:id/reports", handleListReports, true);
  router.post("/api/admin/suppliers/:id/approve", handleApprove, true);
  router.post("/api/admin/suppliers/:id/enrich", handleEnrich, true);
  router.post("/api/admin/suppliers/:id/hide", handleHide, true);
  router.post("/api/admin/suppliers/:id/unhide", handleUnhide, true);
  router.post("/api/admin/suppliers/:id/reports/dismiss", handleDismissReports, true);
  router.patch("/api/admin/suppliers/:id/notes", handleUpdateNotes, true);
  router.delete("/api/admin/suppliers/:id", handleDelete, true);
}
