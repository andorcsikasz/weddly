// Transfer CRUD + guest assignment. Couple-scoped; mirrors accommodations.ts.

import type { UpsertTransferInput } from "@shared/types";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { getGuestByIdScoped } from "../domain/guests";
import {
  deleteTransfer,
  getTransferScoped,
  insertTransfer,
  listTransfers,
  parseTransferCreate,
  parseTransferPatch,
  toTransfer,
  updateTransfer,
} from "../domain/transfers";
import { getUserById } from "../domain/users";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ transfers: listTransfers(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertTransferInput>>(ctx.req);
  const parsed = parseTransferCreate(body);
  const row = insertTransfer(couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "transfer.create",
    target_kind: "transfer",
    target_id: row.id,
    after: { label: parsed.label, capacity: parsed.capacity },
  });

  return json({ transfer: toTransfer(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getTransferScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Transfer not found");

  const body = await readJson<Partial<UpsertTransferInput>>(ctx.req);
  const parsed = parseTransferPatch(body, existing);
  const row = updateTransfer(id, couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "transfer.update",
    target_kind: "transfer",
    target_id: id,
    before: { label: existing.label },
    after: { label: parsed.label },
  });

  return json({ transfer: toTransfer(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getTransferScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Transfer not found");

  deleteTransfer(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "transfer.delete",
    target_kind: "transfer",
    target_id: id,
    before: { label: existing.label },
  });

  return json({ ok: true });
}

interface AssignBody {
  guest_id?: unknown;
  transfer_id?: unknown;
}

async function handleAssign(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<AssignBody>(ctx.req);
  const guestId = Number(body.guest_id);
  if (!Number.isFinite(guestId)) throw new HttpError(400, "guest_id required");

  const guest = getGuestByIdScoped(guestId, couple.id);
  if (!guest) throw new HttpError(404, "Guest not found");

  let targetId: number | null = null;
  if (body.transfer_id !== null && body.transfer_id !== undefined) {
    const n = Number(body.transfer_id);
    if (!Number.isFinite(n)) throw new HttpError(400, "Invalid transfer_id");
    const transfer = getTransferScoped(n, couple.id);
    if (!transfer) throw new HttpError(404, "Transfer not found");
    targetId = transfer.id;
  }

  db.prepare(
    "UPDATE guests SET transfer_id = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(targetId, now(), guestId, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: targetId === null ? "transfer.unassign" : "transfer.assign",
    target_kind: "guest",
    target_id: guestId,
    before: { transfer_id: guest.transfer_id },
    after: { transfer_id: targetId },
  });

  return json({ ok: true });
}

export function registerTransferRoutes(router: Router) {
  router.get("/api/transfers", handleList, true);
  router.post("/api/transfers", handleCreate, true);
  router.patch("/api/transfers/:id", handleUpdate, true);
  router.delete("/api/transfers/:id", handleDelete, true);
  router.post("/api/transfers/assign", handleAssign, true);
}
