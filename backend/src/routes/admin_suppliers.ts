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
import { CONFIG } from "../config";
import { sendKind } from "../domain/emails";
import { enrichSupplier } from "../domain/supplier_enrich";
import { listDirectoryForAdmin, parseDirectoryFilters } from "../domain/supplier_views";
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

  // Admin-triggered: force overwrite. The auto-enrich on submit only fills
  // blanks, but moderators hitting this button explicitly want to refresh
  // the row — usually because the first pass scraped junk.
  const filled = await enrichSupplier(id, { force: true });

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

  // Close the verify → moderation → live loop. The recipient last heard from
  // us when they clicked the verify link; without this, they have no signal
  // that moderation actually approved them. Fire-and-forget, guest target.
  if (after.contact_email) {
    void sendKind(
      "community_supplier_published",
      {
        supplierName: after.name,
        listingUrl: CONFIG.frontendBaseUrl,
      },
      { user: null, guest: { email: after.contact_email, full_name: after.name } },
    );
  }

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

// ── Directory view: full curated + community list with visit analytics ─────

function handleDirectory(ctx: Ctx): Response {
  requireAdmin(ctx);
  const filters = parseDirectoryFilters(ctx.url.searchParams);
  const rows = listDirectoryForAdmin(filters);
  return json({ suppliers: rows, filters });
}

/** RFC 4180 CSV cell: wrap in quotes and double internal quotes whenever the
 *  value contains a comma, quote, or line break. Bare numbers/empties pass
 *  through unquoted to keep the file diff-friendly. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.length === 0) return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDate(unixMs: number | null): string {
  if (unixMs === null || !Number.isFinite(unixMs)) return "";
  return new Date(unixMs).toISOString();
}

function handleDirectoryCsv(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const filters = parseDirectoryFilters(ctx.url.searchParams);
  const rows = listDirectoryForAdmin(filters);

  const headers = [
    "id",
    "source",
    "status",
    "category",
    "name",
    "city",
    "address",
    "website",
    "contact_email",
    "contact_phone",
    "price_band",
    "submitter_email",
    "created_at",
    "views_total",
    "views_30d",
    "views_7d",
    "website_clicks_total",
    "website_clicks_30d",
    "phone_clicks_total",
    "last_event_at",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.source),
        csvCell(r.status),
        csvCell(r.category),
        csvCell(r.name),
        csvCell(r.city),
        csvCell(r.address),
        csvCell(r.website),
        csvCell(r.contact_email),
        csvCell(r.contact_phone),
        csvCell(r.price_band),
        csvCell(r.submitter_email),
        csvCell(isoDate(r.created_at)),
        csvCell(r.analytics.views_total),
        csvCell(r.analytics.views_30d),
        csvCell(r.analytics.views_7d),
        csvCell(r.analytics.website_clicks_total),
        csvCell(r.analytics.website_clicks_30d),
        csvCell(r.analytics.phone_clicks_total),
        csvCell(isoDate(r.analytics.last_event_at)),
      ].join(","),
    );
  }
  // UTF-8 BOM + CRLF so Excel opens Hungarian accents correctly. Same trick
  // the guest CSV export uses (routes/guests.ts).
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const body = new TextEncoder().encode(csv);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `weddly-suppliers-${stamp}.csv`;

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.directory.csv_export",
    target_kind: "supplier_directory",
    target_id: null,
    after: { count: rows.length, filters },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function registerAdminSupplierRoutes(router: Router) {
  router.get("/api/admin/suppliers", handleList, true);
  router.get("/api/admin/suppliers/directory", handleDirectory, true);
  router.get("/api/admin/suppliers/directory.csv", handleDirectoryCsv, true);
  router.get("/api/admin/suppliers/:id/reports", handleListReports, true);
  router.post("/api/admin/suppliers/:id/approve", handleApprove, true);
  router.post("/api/admin/suppliers/:id/enrich", handleEnrich, true);
  router.post("/api/admin/suppliers/:id/hide", handleHide, true);
  router.post("/api/admin/suppliers/:id/unhide", handleUnhide, true);
  router.post("/api/admin/suppliers/:id/reports/dismiss", handleDismissReports, true);
  router.patch("/api/admin/suppliers/:id/notes", handleUpdateNotes, true);
  router.delete("/api/admin/suppliers/:id", handleDelete, true);
}
