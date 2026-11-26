// Per-category supplier picks API. CRUD against couple_picks, scoped by the
// authenticated user's couple. Loop C₁ moves these from per-device
// localStorage to the server so partner A and partner B always see the same
// "this is our pick" highlighted card.
//
// `supplier_id` is the public string id from the directory — curated slug,
// "c{N}" community id, or a DIY hex. We intentionally do NOT validate that
// the supplier still exists at upsert time: curated slugs can change, the
// admin can hide a community submission, etc., and we want to preserve the
// couple's historical choice rather than reject a pick the user already made.

import { isSentinelPick } from "@shared/picks";
import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import * as suppliersDomain from "../domain/couple_suppliers";
import { getCoupleForUser } from "../domain/couples";
import * as picksDomain from "../domain/couple_picks";
import { syncCoupleVenueFromPick } from "../domain/venue_sync";
import { resolveSupplierBase } from "../domain/resolve_supplier";
import { picksTableForCouple } from "../domain/picks_table";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

// Derived from the single taxonomy source so it can never drift from the enum.
const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set(
  SUPPLIER_GROUPS.flatMap((g) => g.categories),
);

const MAX_SUPPLIER_ID_LENGTH = 80;

function parseCategoryParam(raw: string | undefined): SupplierCategory {
  if (!raw) throw new HttpError(400, "category required");
  if (!VALID_CATEGORIES.has(raw as SupplierCategory)) {
    throw new HttpError(400, "Invalid category");
  }
  return raw as SupplierCategory;
}

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
  return json({
    picks: picksDomain.listPicksForCouple(couple.id),
    extras: picksDomain.listExtrasForCouple(couple.id),
  });
}

/** Add a supplier beside the category's primary pick. Refused where there is no
 *  primary to add beside (the first pick is a plain upsert), for venue (one
 *  place to hold the wedding), for a sentinel, and for the primary itself. */
async function handleAddExtra(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const category = parseCategoryParam(ctx.params.category);
  if (category === "venue") {
    throw new HttpError(400, "A venue is a single pick", { code: "venue_single_pick" });
  }
  const body = await readJson<{ supplier_id?: unknown }>(ctx.req);
  const supplierId = parseSupplierId(body.supplier_id);
  if (isSentinelPick(supplierId)) {
    throw new HttpError(400, "Not a supplier", { code: "bad_supplier" });
  }
  const primary = picksDomain.getPick(couple.id, category);
  if (!primary) {
    throw new HttpError(409, "Pick a supplier first", { code: "no_primary_pick" });
  }
  if (primary.supplier_id === supplierId) {
    throw new HttpError(409, "Already the main pick", { code: "already_primary" });
  }

  const extra = picksDomain.addExtra(couple.id, category, supplierId, userId);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "pick.extra_add",
    target_kind: "couple_pick",
    target_id: null,
    before: null,
    after: { category, supplier_id: supplierId },
  });
  return json({ extra });
}

function handleRemoveExtra(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const category = parseCategoryParam(ctx.params.category);
  const supplierId = parseSupplierId(ctx.params.supplierId);
  const removed = picksDomain.removeExtra(couple.id, category, supplierId);
  if (removed) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "pick.extra_remove",
      target_kind: "couple_pick",
      target_id: null,
      before: { category, supplier_id: supplierId },
      after: null,
    });
  }
  return json({ ok: true });
}

async function handleUpsert(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const category = parseCategoryParam(ctx.params.category);
  const body = await readJson<{ supplier_id?: unknown }>(ctx.req);
  const supplierId = parseSupplierId(body.supplier_id);

  const before = picksDomain.getPick(couple.id, category);
  const pick = picksDomain.upsertPick(couple.id, category, supplierId, userId);
  // The venue pick has a denormalized copy on the couple row (Kulcsinfó, the
  // public guest page, the run sheet all read it) — see venue_sync.ts. Every
  // pick-toggle in the app funnels through this route, so this is the one
  // place that keeps the copy from going stale no matter which surface picked.
  if (category === "venue") syncCoupleVenueFromPick(couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "pick.upsert",
    target_kind: "couple_pick",
    target_id: null,
    before: before
      ? { category: before.category, supplier_id: before.supplier_id }
      : { category, supplier_id: null },
    after: { category: pick.category, supplier_id: pick.supplier_id },
  });

  return json({ pick });
}

function handleRemove(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const category = parseCategoryParam(ctx.params.category);
  const before = picksDomain.getPick(couple.id, category);
  const removed = picksDomain.removePick(couple.id, category);
  if (category === "venue") syncCoupleVenueFromPick(couple.id);

  // Audit only when we actually cleared something — silent no-op on a
  // double DELETE keeps the UI's clear-button idempotent without spamming
  // the activity feed.
  if (removed && before) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "pick.remove",
      target_kind: "couple_pick",
      target_id: null,
      before: { category: before.category, supplier_id: before.supplier_id },
      after: { category, supplier_id: null },
    });
  }

  return json({ ok: true });
}

/** Most suppliers one bulk request may carry. A cap, not a target: a couple
 *  adding a shortlist of a dozen vendors is the case this serves. */
const MAX_BULK_PICKS = 60;

/** The category a supplier id belongs to: a directory listing's, or a
 *  "do it myself" card's. Null when neither knows the id. */
function categoryOfSupplier(coupleId: number, supplierId: string): string | null {
  if (isSentinelPick(supplierId)) return null;
  const listed = resolveSupplierBase(supplierId);
  if (listed) return listed.category;
  return suppliersDomain.getById(supplierId, coupleId)?.category ?? null;
}

/** Add many suppliers to the couple's list in one go. Each id becomes the
 *  category's primary when the category has none, or an extra beside it.
 *  Venue keeps one place, so a second venue is reported, not added. A result
 *  per id says what happened, so the client can explain a partial success. */
async function handleBulkPicks(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<{ supplier_ids?: unknown }>(ctx.req);
  if (!Array.isArray(body.supplier_ids)) {
    throw new HttpError(400, "supplier_ids must be an array");
  }
  if (body.supplier_ids.length > MAX_BULK_PICKS) {
    throw new HttpError(400, `At most ${MAX_BULK_PICKS} suppliers at once`, {
      code: "too_many",
    });
  }
  const ids = [...new Set(body.supplier_ids.map((raw) => parseSupplierId(raw)))];

  const results: Array<{
    supplier_id: string;
    category: string | null;
    status: "primary" | "extra" | "already" | "venue_single" | "unknown";
  }> = [];
  for (const supplierId of ids) {
    const category = categoryOfSupplier(couple.id, supplierId);
    if (!category) {
      results.push({ supplier_id: supplierId, category: null, status: "unknown" });
      continue;
    }
    const primary = picksDomain.getPick(couple.id, category);
    if (primary?.supplier_id === supplierId) {
      results.push({ supplier_id: supplierId, category, status: "already" });
      continue;
    }
    if (!primary) {
      picksDomain.upsertPick(couple.id, category, supplierId, userId);
      if (category === "venue") syncCoupleVenueFromPick(couple.id);
      results.push({ supplier_id: supplierId, category, status: "primary" });
    } else if (category === "venue") {
      results.push({ supplier_id: supplierId, category, status: "venue_single" });
      continue;
    } else if (picksDomain.getExtra(couple.id, category, supplierId)) {
      results.push({ supplier_id: supplierId, category, status: "already" });
      continue;
    } else {
      picksDomain.addExtra(couple.id, category, supplierId, userId);
      results.push({ supplier_id: supplierId, category, status: "extra" });
    }
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "pick.bulk_add",
      target_kind: "couple_pick",
      target_id: null,
      before: null,
      after: { category, supplier_id: supplierId },
    });
  }
  return json({ results });
}

/** The picks as a comparison table: price for the couple's date and headcount,
 *  planned note, and what each venue provides. Couple-scoped, read-only. */
function handleTable(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json(picksTableForCouple(couple));
}

export function registerCouplePickRoutes(router: Router) {
  router.get("/api/picks/table", handleTable, true);
  router.post("/api/picks/bulk", handleBulkPicks, true);
  router.get("/api/picks", handleList, true);
  router.put("/api/picks/:category", handleUpsert, true);
  router.delete("/api/picks/:category", handleRemove, true);
  router.post("/api/picks/:category/extras", handleAddExtra, true);
  router.delete("/api/picks/:category/extras/:supplierId", handleRemoveExtra, true);
}
