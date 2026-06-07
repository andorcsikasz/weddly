// Couple shortlist API. CRUD against saved_suppliers, scoped by the
// authenticated user's couple. Moves the "saved" star off per-device
// localStorage so partner A and partner B share one shortlist — the same
// move couple_picks made, minus the per-category cap (a couple shortlists
// several suppliers in one category to compare them).
//
// `supplier_id` is the public string id from the directory (curated slug,
// "c{N}" community id, or DIY hex). As with couple_picks we do NOT validate
// that the supplier still exists at save time — curated slugs change and the
// admin can hide a community submission, but we preserve the couple's choice.

import { getCoupleForUser } from "../domain/couples";
import * as savedDomain from "../domain/saved_suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const MAX_SUPPLIER_ID_LENGTH = 80;

function parseSupplierId(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "supplier_id must be a string");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new HttpError(400, "supplier_id required");
  if (trimmed.length > MAX_SUPPLIER_ID_LENGTH) {
    throw new HttpError(400, `supplier_id too long (max ${MAX_SUPPLIER_ID_LENGTH})`);
  }
  return trimmed;
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ saved: savedDomain.listSavedForCouple(couple.id) });
}

async function handleAdd(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const supplierId = parseSupplierId(ctx.params.supplier_id);
  const added = savedDomain.addSaved(couple.id, supplierId, userId);

  // Audit only on a genuine add — re-saving an already-shortlisted supplier is
  // an idempotent no-op and shouldn't spam the activity feed.
  if (added) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "saved.add",
      target_kind: "saved_supplier",
      target_id: null,
      before: null,
      after: { supplier_id: supplierId },
    });
  }

  return json({ ok: true });
}

function handleRemove(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const supplierId = parseSupplierId(ctx.params.supplier_id);
  const removed = savedDomain.removeSaved(couple.id, supplierId);

  if (removed) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "saved.remove",
      target_kind: "saved_supplier",
      target_id: null,
      before: { supplier_id: supplierId },
      after: null,
    });
  }

  return json({ ok: true });
}

export function registerSavedSupplierRoutes(router: Router) {
  router.get("/api/saved-suppliers", handleList, true);
  router.put("/api/saved-suppliers/:supplier_id", handleAdd, true);
  router.delete("/api/saved-suppliers/:supplier_id", handleRemove, true);
}
