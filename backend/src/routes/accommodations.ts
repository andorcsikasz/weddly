// Accommodation CRUD + guest assignment. Couple-scoped via getCoupleForUser.
// Assignment endpoints flip `guests.accommodation_id`; null in the body
// unassigns. Mirrors the shape of the existing seating routes for symmetry.

import type { UpsertAccommodationInput, UpsertAccommodationRoomInput } from "@shared/types";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteAccommodation,
  deleteRoom,
  getAccommodationScoped,
  getRoomScoped,
  insertAccommodation,
  insertRoom,
  listAccommodations,
  listRoomsForCouple,
  parseAccommodationCreate,
  parseAccommodationPatch,
  parseRoomCreate,
  parseRoomPatch,
  toAccommodation,
  toAccommodationRoom,
  updateAccommodation,
  updateRoom,
} from "../domain/accommodations";
import { getGuestByIdScoped } from "../domain/guests";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ accommodations: listAccommodations(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
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
  const userId = requireAuth(ctx);
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
  const userId = requireAuth(ctx);
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
  const userId = requireAuth(ctx);
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

  // Accommodation-level assignment clears any specific room placement — the
  // guest is "at this lodging" without a room, or fully unassigned (null).
  db.prepare(
    "UPDATE guests SET accommodation_id = ?, accommodation_room_id = NULL, updated_at = ? WHERE id = ? AND couple_id = ?",
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

// ── Rooms ─────────────────────────────────────────────────────────────────

function handleRoomList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ rooms: listRoomsForCouple(couple.id) });
}

async function handleRoomCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertAccommodationRoomInput>>(ctx.req);
  const accommodationId = Number(body.accommodation_id);
  if (!Number.isFinite(accommodationId)) throw new HttpError(400, "accommodation_id required");
  const parent = getAccommodationScoped(accommodationId, couple.id);
  if (!parent) throw new HttpError(404, "Accommodation not found");

  const parsed = parseRoomCreate(body);
  const row = insertRoom(couple.id, parent.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation_room.create",
    target_kind: "accommodation_room",
    target_id: row.id,
    after: { accommodation_id: parent.id, name: parsed.name, capacity: parsed.capacity },
  });

  return json({ room: toAccommodationRoom(row) }, { status: 201 });
}

async function handleRoomUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getRoomScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Room not found");

  const body = await readJson<Partial<UpsertAccommodationRoomInput>>(ctx.req);
  const parsed = parseRoomPatch(body, existing);
  const row = updateRoom(id, couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation_room.update",
    target_kind: "accommodation_room",
    target_id: id,
    before: { name: existing.name, capacity: existing.capacity },
    after: { name: parsed.name, capacity: parsed.capacity },
  });

  return json({ room: toAccommodationRoom(row) });
}

function handleRoomDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getRoomScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Room not found");

  deleteRoom(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "accommodation_room.delete",
    target_kind: "accommodation_room",
    target_id: id,
    before: { name: existing.name },
  });

  return json({ ok: true });
}

interface RoomAssignBody {
  guest_id?: unknown;
  // null/undefined room_id = unassign
  room_id?: unknown;
}

async function handleRoomAssign(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<RoomAssignBody>(ctx.req);
  const guestId = Number(body.guest_id);
  if (!Number.isFinite(guestId)) throw new HttpError(400, "guest_id required");

  const guest = getGuestByIdScoped(guestId, couple.id);
  if (!guest) throw new HttpError(404, "Guest not found");

  let roomId: number | null = null;
  let accommodationId: number | null = null;
  if (body.room_id !== null && body.room_id !== undefined) {
    const n = Number(body.room_id);
    if (!Number.isFinite(n)) throw new HttpError(400, "Invalid room_id");
    const room = getRoomScoped(n, couple.id);
    if (!room) throw new HttpError(404, "Room not found");
    roomId = room.id;
    accommodationId = room.accommodation_id;
  }

  // Keep accommodation_id in sync with the room's parent so exports / queries
  // that only read the accommodation keep working.
  db.prepare(
    "UPDATE guests SET accommodation_id = ?, accommodation_room_id = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(accommodationId, roomId, now(), guestId, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: roomId === null ? "accommodation_room.unassign" : "accommodation_room.assign",
    target_kind: "guest",
    target_id: guestId,
    before: { accommodation_room_id: guest.accommodation_room_id },
    after: { accommodation_room_id: roomId, accommodation_id: accommodationId },
  });

  return json({ ok: true });
}

export function registerAccommodationRoutes(router: Router) {
  router.get("/api/accommodations", handleList, true);
  router.post("/api/accommodations", handleCreate, true);
  router.patch("/api/accommodations/:id", handleUpdate, true);
  router.delete("/api/accommodations/:id", handleDelete, true);
  router.post("/api/accommodations/assign", handleAssign, true);

  router.get("/api/accommodation-rooms", handleRoomList, true);
  router.post("/api/accommodation-rooms", handleRoomCreate, true);
  router.patch("/api/accommodation-rooms/:id", handleRoomUpdate, true);
  router.delete("/api/accommodation-rooms/:id", handleRoomDelete, true);
  router.post("/api/accommodation-rooms/assign", handleRoomAssign, true);
}
