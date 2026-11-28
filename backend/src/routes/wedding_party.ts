// Wedding party CRUD (best man, bridesmaids, konferanszié, ...). Couple-scoped,
// mirrors transfers.ts. Every write lands in the audit log.

import type { UpsertWeddingPartyInput } from "@shared/types";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteWeddingPartyMember,
  getWeddingPartyScoped,
  insertWeddingPartyMember,
  listWeddingParty,
  parseWeddingPartyCreate,
  parseWeddingPartyPatch,
  resolveGuestLinkForWrite,
  toWeddingPartyMember,
  updateWeddingPartyMember,
} from "../domain/wedding_party";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function requireCouple(ctx: Ctx): { userId: number; coupleId: number } {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, coupleId: couple.id };
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  const { coupleId } = requireCouple(ctx);
  return json({ members: listWeddingParty(coupleId) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const body = await readJson<Partial<UpsertWeddingPartyInput>>(ctx.req);
  const link = resolveGuestLinkForWrite(coupleId, body.guest_id, null);
  const parsed = parseWeddingPartyCreate(body, link);
  const row = insertWeddingPartyMember(coupleId, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "wedding_party.create",
    target_kind: "wedding_party_member",
    target_id: row.id,
    after: { role: parsed.role, status: parsed.status, guest_id: parsed.guest_id },
  });

  return json({ member: toWeddingPartyMember(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const id = parseId(ctx.params.id);

  const existing = getWeddingPartyScoped(id, coupleId);
  if (!existing) throw new HttpError(404, "Wedding party member not found");

  const body = await readJson<Partial<UpsertWeddingPartyInput>>(ctx.req);
  const link = resolveGuestLinkForWrite(coupleId, body.guest_id, existing.guest_id);
  const parsed = parseWeddingPartyPatch(body, existing, link);
  const row = updateWeddingPartyMember(id, coupleId, existing, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "wedding_party.update",
    target_kind: "wedding_party_member",
    target_id: id,
    before: { role: existing.role, status: existing.status, guest_id: existing.guest_id },
    after: { role: parsed.role, status: parsed.status, guest_id: parsed.guest_id },
  });

  return json({ member: toWeddingPartyMember(row) });
}

function handleDelete(ctx: Ctx): Response {
  const { userId, coupleId } = requireCouple(ctx);
  const id = parseId(ctx.params.id);

  const existing = getWeddingPartyScoped(id, coupleId);
  if (!existing) throw new HttpError(404, "Wedding party member not found");

  deleteWeddingPartyMember(id, coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "wedding_party.delete",
    target_kind: "wedding_party_member",
    target_id: id,
    before: { role: existing.role, status: existing.status },
  });

  return json({ ok: true });
}

export function registerWeddingPartyRoutes(router: Router) {
  router.get("/api/wedding-party", handleList, true);
  router.post("/api/wedding-party", handleCreate, true);
  router.patch("/api/wedding-party/:id", handleUpdate, true);
  router.delete("/api/wedding-party/:id", handleDelete, true);
}
