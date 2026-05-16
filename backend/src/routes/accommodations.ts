// Accommodation CRUD + guest assignment. Couple-scoped via getCoupleForUser.
// Assignment endpoints flip `guests.accommodation_id`; null in the body
// unassigns. Mirrors the shape of the existing seating routes for symmetry.

import type { UpsertAccommodationInput } from "@shared/types";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteAccommodation,
  getAccommodationScoped,
  insertAccommodation,
  listAccommodations,
  parseAccommodationCreate,
  parseAccommodationPatch,
  toAccommodation,
  updateAccommodation,
} from "../domain/accommodations";
import { getGuestByIdScoped } from "../domain/guests";
import { getUserById } from "../domain/users";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ accommodations: listAccommodations(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertAccommodationInput>>(ctx.req);
  const parsed = parseAccommodationCreate(body);
  const row = insertAccommodation(couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation.create",
    target_kind: "accommodation",
    target_id: row.id,
    after: { name: parsed.name, capacity: parsed.capacity },
  });

  return json({ accommodation: toAccommodation(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getAccommodationScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Accommodation not found");

  const body = await readJson<Partial<UpsertAccommodationInput>>(ctx.req);
  const parsed = parseAccommodationPatch(body, existing);
  const row = updateAccommodation(id, couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation.update",
    target_kind: "accommodation",
    target_id: id,
    before: { name: existing.name },
    after: { name: parsed.name },
  });

  return json({ accommodation: toAccommodation(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getAccommodationScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Accommodation not found");

  deleteAccommodation(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation.delete",
    target_kind: "accommodation",
    target_id: id,
    before: { name: existing.name },
  });

  return json({ ok: true });
}

interface AssignBody {
  guest_id?: unknown;
  // null/undefined accommodation_id = unassign
  accommodation_id?: unknown;
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
  if (body.accommodation_id !== null && body.accommodation_id !== undefined) {
    const n = Number(body.accommodation_id);
    if (!Number.isFinite(n)) throw new HttpError(400, "Invalid accommodation_id");
    const accommodation = getAccommodationScoped(n, couple.id);
    if (!accommodation) throw new HttpError(404, "Accommodation not found");
    targetId = accommodation.id;
  }

  db.prepare(
    "UPDATE guests SET accommodation_id = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(targetId, now(), guestId, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: targetId === null ? "accommodation.unassign" : "accommodation.assign",
    target_kind: "guest",
    target_id: guestId,
    before: { accommodation_id: guest.accommodation_id },
    after: { accommodation_id: targetId },
  });

  return json({ ok: true });
}

export function registerAccommodationRoutes(router: Router) {
  router.get("/api/accommodations", handleList, true);
  router.post("/api/accommodations", handleCreate, true);
  router.patch("/api/accommodations/:id", handleUpdate, true);
  router.delete("/api/accommodations/:id", handleDelete, true);
  router.post("/api/accommodations/assign", handleAssign, true);
}
