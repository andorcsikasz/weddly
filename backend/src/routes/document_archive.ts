// Saved download archive — list past exports, re-download a saved one.
// Each row is created automatically by the existing export endpoints
// (JSON, seating PDF, place cards PDF, guest CSV) via recordExport().

import { getCoupleForUser } from "../domain/couples";
import { deleteExport, getExport, listExports } from "../domain/exports";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ exports: listExports(couple.id) });
}

function handleDownload(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");
  const row = getExport(id, couple.id);
  if (!row) throw new HttpError(404, "Export not found");
  return new Response(row.body, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Disposition": `attachment; filename="${row.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");
  const removed = deleteExport(id, couple.id);
  if (!removed) throw new HttpError(404, "Export not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "export.delete",
    target_kind: "data_export",
    target_id: id,
  });
  return json({ ok: true });
}

export function registerDocumentArchiveRoutes(router: Router) {
  router.get("/api/exports", handleList, true);
  router.get("/api/exports/:id/download", handleDownload, true);
  router.delete("/api/exports/:id", handleDelete, true);
}
