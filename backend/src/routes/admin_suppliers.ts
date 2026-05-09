// Admin moderation for community-submitted suppliers. Gate every handler
// with requireAdmin() — that checks auth + ADMIN_EMAILS allowlist.

import {
  deleteCommunitySupplier,
  getCommunitySupplierById,
  getCommunitySupplierWithEmail,
  listAllForAdmin,
  setStatus,
  toAdminView,
} from "../domain/community_suppliers";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

interface HideBody {
  reason?: unknown;
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ suppliers: listAllForAdmin().map(toAdminView) });
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
  return json({ supplier: toAdminView(after) });
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
  return json({ supplier: toAdminView(after) });
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
  router.post("/api/admin/suppliers/:id/hide", handleHide, true);
  router.post("/api/admin/suppliers/:id/unhide", handleUnhide, true);
  router.delete("/api/admin/suppliers/:id", handleDelete, true);
}
