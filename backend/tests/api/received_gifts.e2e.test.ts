// Received-gifts ledger, couple-private CRUD. Covers create (with + without a
// guest allocation), the all-empty-row rejection, guest scoping (a cross-couple
// guest_id is refused), optimistic-concurrency on PATCH, and delete. There is
// deliberately no guest-side surface to test (unlike wishlist).

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import type { ReceivedGift } from "@shared/received_gifts";

/** Create a guest on the couple, return its id. */
async function createGuest(token: string, full_name: string): Promise<number> {
  const r = await req<{ guest: { id: number } }>("POST", "/api/guests", { full_name }, { token });
  if (r.status !== 201) throw new Error(`guest create failed: ${r.status}`);
  return r.data.guest.id;
}

describe("/api/received-gifts CRUD", () => {
  test("list is empty for a fresh couple", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-empty@weddly.test");
    const r = await req<{ items: ReceivedGift[] }>("GET", "/api/received-gifts", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.items).toEqual([]);
  });

  test("create with guest allocation + name + note, then list reflects it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-create@weddly.test");
    const guestId = await createGuest(token, "Kovács család");

    const c = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { guest_id: guestId, title: "Mosógép", note: "Köszönőlevél elküldve" },
      { token },
    );
    expect(c.status).toBe(201);
    expect(c.data.item.guest_id).toBe(guestId);
    expect(c.data.item.title).toBe("Mosógép");
    expect(c.data.item.note).toBe("Köszönőlevél elküldve");

    const list = await req<{ items: ReceivedGift[] }>("GET", "/api/received-gifts", undefined, {
      token,
    });
    expect(list.data.items.length).toBe(1);
    expect(list.data.items[0]!.title).toBe("Mosógép");
  });

  test("create with only a name (no guest) is allowed", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-nameonly@weddly.test");
    const c = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { title: "Kávéfőző" },
      { token },
    );
    expect(c.status).toBe(201);
    expect(c.data.item.guest_id).toBeNull();
    expect(c.data.item.title).toBe("Kávéfőző");
  });

  test("all-empty row is rejected with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-empty-row@weddly.test");
    const r = await req("POST", "/api/received-gifts", { title: "   ", note: "" }, { token });
    expect(r.status).toBe(400);
  });

  test("a guest from another couple cannot be allocated", async () => {
    wipeAll();
    const a = await bootstrapCouple("rg-couple-a@weddly.test");
    const b = await bootstrapCouple("rg-couple-b@weddly.test");
    const bGuest = await createGuest(b.token, "B's guest");

    // Couple A tries to allocate couple B's guest → 400 (cross-couple leak guard).
    const r = await req(
      "POST",
      "/api/received-gifts",
      { guest_id: bGuest, title: "Borszett" },
      { token: a.token },
    );
    expect(r.status).toBe(400);
  });

  test("patch updates fields; stale If-Match returns 409", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-patch@weddly.test");
    const c = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { title: "Régi név" },
      { token },
    );
    const id = c.data.item.id;
    const staleStamp = c.data.item.updated_at;

    const u = await req<{ item: ReceivedGift }>(
      "PATCH",
      `/api/received-gifts/${id}`,
      { title: "Új név", note: "köszi" },
      { token, headers: { "If-Match": String(staleStamp) } },
    );
    expect(u.status).toBe(200);
    expect(u.data.item.title).toBe("Új név");
    expect(u.data.item.note).toBe("köszi");

    // The first PATCH bumped updated_at, so re-using the original stamp is stale.
    const conflict = await req(
      "PATCH",
      `/api/received-gifts/${id}`,
      { title: "Még újabb" },
      { token, headers: { "If-Match": String(staleStamp) } },
    );
    expect(conflict.status).toBe(409);
  });

  test("delete removes the row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rg-delete@weddly.test");
    const c = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { title: "Törlendő" },
      { token },
    );
    const del = await req("DELETE", `/api/received-gifts/${c.data.item.id}`, undefined, { token });
    expect(del.status).toBe(200);

    const list = await req<{ items: ReceivedGift[] }>("GET", "/api/received-gifts", undefined, {
      token,
    });
    expect(list.data.items).toEqual([]);
  });

  test("another couple cannot see or mutate this couple's gifts", async () => {
    wipeAll();
    const a = await bootstrapCouple("rg-scope-a@weddly.test");
    const b = await bootstrapCouple("rg-scope-b@weddly.test");
    const c = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { title: "A titka" },
      { token: a.token },
    );

    // B's list is empty; B's PATCH/DELETE on A's id 404s (couple-scoped).
    const bList = await req<{ items: ReceivedGift[] }>("GET", "/api/received-gifts", undefined, {
      token: b.token,
    });
    expect(bList.data.items).toEqual([]);
    const bPatch = await req(
      "PATCH",
      `/api/received-gifts/${c.data.item.id}`,
      { title: "hack" },
      { token: b.token },
    );
    expect(bPatch.status).toBe(404);
  });
});
