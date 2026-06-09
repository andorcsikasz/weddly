// Invite-state cascade: when a host guest's invited/delivered flags change,
// its materialized +1s inherit the same state (single check = invited, double
// check = delivered). A plain edit that doesn't touch the invite flags must
// leave a +1's own state alone.
//
// Pairs with backend/src/routes/guests.ts handleUpdate (cascade after the
// main UPDATE) and frontend onCycleInviteState (optimistic mirror).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

function inviteState(id: number): {
  invited_at: number | null;
  invitation_delivered_at: number | null;
} {
  return db
    .prepare("SELECT invited_at, invitation_delivered_at FROM guests WHERE id = ?")
    .get(id) as { invited_at: number | null; invitation_delivered_at: number | null };
}

describe("invite state cascades to materialized +1s", () => {
  test("host invited/delivered/cleared mirrors onto its +1; plain edits don't", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("invite-cascade@weddly.test");

    const host = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Béla" },
      { token },
    );
    expect(host.status).toBe(201);
    const hostId = host.data.guest.id;

    const plus = await req<{
      guest: { id: number; is_plus_one: boolean; plus_one_of: number | null };
    }>("POST", "/api/guests", { full_name: "Tamás", plus_one_of: hostId }, { token });
    expect(plus.status).toBe(201);
    const plusId = plus.data.guest.id;
    expect(plus.data.guest.plus_one_of).toBe(hostId);

    const patchHost = (body: Record<string, unknown>) =>
      req("PATCH", `/api/guests/${hostId}`, { full_name: "Béla", ...body }, { token });

    // Host → invited: +1 inherits invited (single check), not delivered.
    expect((await patchHost({ invited: true, delivered: false })).status).toBe(200);
    let s = inviteState(plusId);
    expect(s.invited_at).not.toBeNull();
    expect(s.invitation_delivered_at).toBeNull();

    // Host → delivered: +1 inherits delivered (double check) + invited.
    expect((await patchHost({ invited: true, delivered: true })).status).toBe(200);
    s = inviteState(plusId);
    expect(s.invited_at).not.toBeNull();
    expect(s.invitation_delivered_at).not.toBeNull();

    // Host → not invited: +1 cleared (both timestamps gone).
    expect((await patchHost({ invited: false, delivered: false })).status).toBe(200);
    s = inviteState(plusId);
    expect(s.invited_at).toBeNull();
    expect(s.invitation_delivered_at).toBeNull();

    // Invite the +1 on its own, then a plain host edit (no invite flags) must
    // NOT disturb the +1's state.
    expect(
      (
        await req(
          "PATCH",
          `/api/guests/${plusId}`,
          { full_name: "Tamás", plus_one_of: hostId, invited: true },
          { token },
        )
      ).status,
    ).toBe(200);
    expect(inviteState(plusId).invited_at).not.toBeNull();
    expect((await patchHost({})).status).toBe(200); // rename only, no invite flags
    expect(inviteState(plusId).invited_at).not.toBeNull(); // untouched
  });

  test("deleting a host cascade-deletes its +1 (no 500, +1 removed too)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("delete-host@weddly.test");

    const host = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Host" },
      { token },
    );
    expect(host.status).toBe(201);
    const hostId = host.data.guest.id;

    const plus = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Plus", plus_one_of: hostId },
      { token },
    );
    expect(plus.status).toBe(201);
    const plusId = plus.data.guest.id;

    // Bare DELETE used to throw FOREIGN KEY constraint failed → 500 because
    // guests.plus_one_of is a self-FK with no ON DELETE. Now it deletes the +1s
    // first, then the host, in one transaction.
    const del = await req("DELETE", `/api/guests/${hostId}`, undefined, { token });
    expect(del.status).toBe(200);

    // Host is gone, and so is its +1.
    const hostRow = db.prepare("SELECT id FROM guests WHERE id = ?").get(hostId);
    expect(hostRow == null).toBe(true);
    const plusRow = db.prepare("SELECT id FROM guests WHERE id = ?").get(plusId);
    expect(plusRow == null).toBe(true);

    // And no dangling pointer remains anywhere.
    const dangling = db.prepare("SELECT id FROM guests WHERE plus_one_of = ?").all(hostId);
    expect(dangling).toEqual([]);
  });
});
