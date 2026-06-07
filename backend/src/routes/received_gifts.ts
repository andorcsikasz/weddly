// Received-gifts ledger CRUD. Couple-scoped, every endpoint goes through
// requireAuth + getCoupleForUser. PATCH honours `If-Match: <updated_at>` for
// optimistic concurrency, matching wishlist / schedule. Private data: there is
// NO guest-side surface (unlike wishlist, which has a confirmed-tier embed in
// public_wedding.ts). Create + delete are audited; the auto-saving grid bumps
// updates on every blur, so those are intentionally not logged (feed noise).

import type { UpsertReceivedGiftInput } from "@shared/received_gifts";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteReceivedGift,
  getReceivedGiftScoped,
  insertReceivedGift,
  listReceivedGifts,
  parseCreate,
  parsePatch,
  toReceivedGift,
  updateReceivedGift,
} from "../domain/received_gifts";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ items: listReceivedGifts(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertReceivedGiftInput>>(ctx.req);
  const parsed = parseCreate(body, couple.id);
  const row = insertReceivedGift(couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "received_gift.create",
    target_kind: "received_gift",
    target_id: row.id,
    after: { title: parsed.title, guest_id: parsed.guest_id },
  });

  return json({ item: toReceivedGift(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getReceivedGiftScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Received gift not found");

  // Optimistic-concurrency guard: clients send the last-seen updated_at as
  // If-Match; a mid-air collision returns 409. Same shape as wishlist.
  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(existing.updated_at)) {
      throw new HttpError(409, "Stale received gift, reload before saving", {
        code: "stale",
        current_updated_at: existing.updated_at,
      });
    }
  }

  const body = await readJson<Partial<UpsertReceivedGiftInput>>(ctx.req);
  const parsed = parsePatch(body, existing, couple.id);
  const row = updateReceivedGift(id, couple.id, parsed);
  return json({ item: toReceivedGift(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getReceivedGiftScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Received gift not found");

  deleteReceivedGift(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "received_gift.delete",
    target_kind: "received_gift",
    target_id: id,
    before: { title: existing.title, guest_id: existing.guest_id },
  });

  return json({ ok: true });
}

export function registerReceivedGiftsRoutes(router: Router) {
  router.get("/api/received-gifts", handleList, true);
  router.post("/api/received-gifts", handleCreate, true);
  router.patch("/api/received-gifts/:id", handleUpdate, true);
  router.delete("/api/received-gifts/:id", handleDelete, true);
}
