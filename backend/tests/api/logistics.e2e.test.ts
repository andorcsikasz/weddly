// Logistics: accommodation rooms (the optional subdivision of an accommodation)
// plus the guest-assignment side effects. The flat accommodation/transfer CRUD
// has smoke coverage elsewhere; this file focuses on the rooms feature added
// alongside the Uber-style LogisticsPage redesign:
//   • room CRUD scoped to the couple + its parent accommodation
//   • assigning a guest to a room keeps guests.accommodation_id in lock-step
//   • accommodation-level assign clears any specific room
//   • deleting a room / its parent accommodation unassigns the right guests
//   • cross-couple isolation on every room route

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

interface GuestRow {
  id: number;
  accommodation_id: number | null;
  accommodation_room_id: number | null;
}

async function makeAccommodation(token: string, name = "Villa Rosa"): Promise<number> {
  const res = await req<{ accommodation: { id: number } }>(
    "POST",
    "/api/accommodations",
    { name, capacity: 4 },
    { token },
  );
  expect(res.status).toBe(201);
  return res.data.accommodation.id;
}

async function makeGuest(token: string, full_name = "Guest"): Promise<number> {
  const res = await req<{ guest: { id: number } }>("POST", "/api/guests", { full_name }, { token });
  expect(res.status).toBe(201);
  return res.data.guest.id;
}

async function getGuest(token: string, id: number): Promise<GuestRow> {
  const list = await req<{ guests: GuestRow[] }>("GET", "/api/guests", undefined, { token });
  const g = list.data.guests.find((x) => x.id === id);
  if (!g) throw new Error(`guest ${id} not found`);
  return g;
}

describe("logistics: accommodation rooms", () => {
  test("room CRUD is scoped to the couple + parent accommodation", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rooms-crud@weddly.test");
    const accId = await makeAccommodation(token);

    const create = await req<{ room: { id: number; capacity: number; name: string } }>(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "Hálószoba", capacity: 2 },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.room.name).toBe("Hálószoba");
    expect(create.data.room.capacity).toBe(2);
    const roomId = create.data.room.id;

    // Second room, default capacity.
    await req(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "Tetőtér" },
      {
        token,
      },
    );

    const list = await req<{ rooms: { id: number }[] }>(
      "GET",
      "/api/accommodation-rooms",
      undefined,
      { token },
    );
    expect(list.data.rooms.length).toBe(2);

    const patch = await req<{ room: { capacity: number } }>(
      "PATCH",
      `/api/accommodation-rooms/${roomId}`,
      { capacity: 3 },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.room.capacity).toBe(3);

    const del = await req("DELETE", `/api/accommodation-rooms/${roomId}`, undefined, { token });
    expect(del.status).toBe(200);
    const after = await req<{ rooms: unknown[] }>("GET", "/api/accommodation-rooms", undefined, {
      token,
    });
    expect(after.data.rooms.length).toBe(1);
  });

  test("room create rejects a missing/foreign accommodation and bad capacity", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rooms-validate@weddly.test");
    const accId = await makeAccommodation(token);

    const noParent = await req("POST", "/api/accommodation-rooms", { name: "X" }, { token });
    expect(noParent.status).toBe(400);

    const badCap = await req(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "X", capacity: 0 },
      { token },
    );
    expect(badCap.status).toBe(400);

    const noName = await req(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "   " },
      { token },
    );
    expect(noName.status).toBe(400);
  });

  test("assigning a guest to a room syncs accommodation_id; accommodation-level assign clears the room", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rooms-assign@weddly.test");
    const accId = await makeAccommodation(token);
    const room = await req<{ room: { id: number } }>(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "Hálószoba", capacity: 2 },
      { token },
    );
    const roomId = room.data.room.id;
    const guestId = await makeGuest(token, "Anna");

    const assign = await req(
      "POST",
      "/api/accommodation-rooms/assign",
      { guest_id: guestId, room_id: roomId },
      { token },
    );
    expect(assign.status).toBe(200);
    let g = await getGuest(token, guestId);
    expect(g.accommodation_room_id).toBe(roomId);
    expect(g.accommodation_id).toBe(accId); // synced to the room's parent

    // Accommodation-level assign (no room) clears the specific room.
    await req(
      "POST",
      "/api/accommodations/assign",
      { guest_id: guestId, accommodation_id: accId },
      { token },
    );
    g = await getGuest(token, guestId);
    expect(g.accommodation_id).toBe(accId);
    expect(g.accommodation_room_id).toBeNull();

    // room_id null fully unassigns.
    await req(
      "POST",
      "/api/accommodation-rooms/assign",
      { guest_id: guestId, room_id: null },
      { token },
    );
    g = await getGuest(token, guestId);
    expect(g.accommodation_id).toBeNull();
    expect(g.accommodation_room_id).toBeNull();
  });

  test("deleting a room unassigns its guests; deleting the accommodation cascades", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rooms-cascade@weddly.test");
    const accId = await makeAccommodation(token);
    const r1 = await req<{ room: { id: number } }>(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "A", capacity: 2 },
      { token },
    );
    const r2 = await req<{ room: { id: number } }>(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accId, name: "B", capacity: 2 },
      { token },
    );
    const g1 = await makeGuest(token, "G1");
    const g2 = await makeGuest(token, "G2");
    await req(
      "POST",
      "/api/accommodation-rooms/assign",
      { guest_id: g1, room_id: r1.data.room.id },
      { token },
    );
    await req(
      "POST",
      "/api/accommodation-rooms/assign",
      { guest_id: g2, room_id: r2.data.room.id },
      { token },
    );

    // Delete room A → g1 fully unassigned, g2 untouched.
    await req("DELETE", `/api/accommodation-rooms/${r1.data.room.id}`, undefined, { token });
    expect((await getGuest(token, g1)).accommodation_id).toBeNull();
    expect((await getGuest(token, g1)).accommodation_room_id).toBeNull();
    expect((await getGuest(token, g2)).accommodation_room_id).toBe(r2.data.room.id);

    // Delete the accommodation → room B cascades, g2 unassigned.
    await req("DELETE", `/api/accommodations/${accId}`, undefined, { token });
    const rooms = await req<{ rooms: unknown[] }>("GET", "/api/accommodation-rooms", undefined, {
      token,
    });
    expect(rooms.data.rooms.length).toBe(0);
    const g2After = await getGuest(token, g2);
    expect(g2After.accommodation_id).toBeNull();
    expect(g2After.accommodation_room_id).toBeNull();
  });

  test("rooms are isolated across couples", async () => {
    wipeAll();
    const { token: tokenA } = await bootstrapCouple("rooms-iso-a@weddly.test");
    const accA = await makeAccommodation(tokenA, "A's place");
    const roomA = await req<{ room: { id: number } }>(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accA, name: "A room", capacity: 2 },
      { token: tokenA },
    );

    const regB = await registerAndVerify({
      email: "rooms-iso-b@weddly.test",
      password: "supersafe123",
      full_name: "Bence",
    });
    expect(regB.status).toBe(201);
    await req(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "B & B",
        wedding_date: "2027-01-01",
        target_guest_count: 20,
        budget_ceiling_huf: 1_000_000,
        style_tags: [],
      },
      { token: regB.data.token },
    );
    const tokenB = regB.data.token;

    // B cannot see A's room, patch it, delete it, or build under A's accommodation.
    const listB = await req<{ rooms: unknown[] }>("GET", "/api/accommodation-rooms", undefined, {
      token: tokenB,
    });
    expect(listB.data.rooms.length).toBe(0);

    const buildUnderA = await req(
      "POST",
      "/api/accommodation-rooms",
      { accommodation_id: accA, name: "sneaky", capacity: 2 },
      { token: tokenB },
    );
    expect(buildUnderA.status).toBe(404);

    const patchA = await req(
      "PATCH",
      `/api/accommodation-rooms/${roomA.data.room.id}`,
      { capacity: 9 },
      { token: tokenB },
    );
    expect(patchA.status).toBe(404);

    const delA = await req("DELETE", `/api/accommodation-rooms/${roomA.data.room.id}`, undefined, {
      token: tokenB,
    });
    expect(delA.status).toBe(404);
  });
});
