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

import type { SupplierCategory } from "@shared/suppliers";
import { getCoupleForUser } from "../domain/couples";
import * as picksDomain from "../domain/couple_picks";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "wedding_planner",
  "venue",
  "accommodation",
  "tent_pavilion",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "sound_tech",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "nails",
  "rings",
  "stationery",
  "wedding_website",
  "transport",
]);

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
  return json({ picks: picksDomain.listPicksForCouple(couple.id) });
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

export function registerCouplePickRoutes(router: Router) {
  router.get("/api/picks", handleList, true);
  router.put("/api/picks/:category", handleUpsert, true);
  router.delete("/api/picks/:category", handleRemove, true);
}
