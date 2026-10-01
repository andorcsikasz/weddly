// /app/guests (one "invited" toggle, legacy invited_at / delivered) and the
// invited view (/app/guests?invited=1, online + in-person channels) show ONE
// invite state. Whichever side writes, the other side agrees: invited exactly
// when a channel is set, delivered exactly when in person is.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";

interface G {
  id: number;
  invited_at: number | null;
  invitation_delivered_at: number | null;
  invited_online_at: number | null;
  invited_physical_at: number | null;
}

async function addGuest(token: string, body: Record<string, unknown> = {}): Promise<G> {
  const r = await req<{ guest: G }>(
    "POST",
    "/api/guests",
    { full_name: "Sync Guest", ...body },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.guest;
}

async function patch(token: string, g: G, body: Record<string, unknown>): Promise<G> {
  const r = await req<{ guest: G }>(
    "PATCH",
    `/api/guests/${g.id}`,
    { full_name: "Sync Guest", ...body },
    { token },
  );
  expect(r.status).toBe(200);
  return r.data.guest;
}

describe("guest list and invited view stay in sync", () => {
  test("inviting on the guest list adds the online channel; un-inviting clears every channel", async () => {
    const { token } = await bootstrapCouple("invsync-a@weddly.test");
    let g = await addGuest(token);
    g = await patch(token, g, { invited: true });
    expect(g.invited_at).not.toBeNull();
    expect(g.invited_online_at).not.toBeNull();
    expect(g.invited_physical_at).toBeNull();

    g = await patch(token, g, { invited_physical: true });
    g = await patch(token, g, { invited: false });
    expect(g.invited_at).toBeNull();
    expect(g.invited_online_at).toBeNull();
    expect(g.invited_physical_at).toBeNull();
    expect(g.invitation_delivered_at).toBeNull();
  });

  test("removing the last channel in the invited view un-invites on the guest list", async () => {
    const { token } = await bootstrapCouple("invsync-b@weddly.test");
    let g = await addGuest(token);
    g = await patch(token, g, { invited_online: true });
    expect(g.invited_at).not.toBeNull();

    g = await patch(token, g, { invited_physical: true });
    expect(g.invitation_delivered_at).not.toBeNull();

    g = await patch(token, g, { invited_physical: false });
    expect(g.invitation_delivered_at).toBeNull();
    expect(g.invited_at).not.toBeNull();

    g = await patch(token, g, { invited_online: false });
    expect(g.invited_at).toBeNull();
  });

  test("delivered on the guest list is the in-person channel", async () => {
    const { token } = await bootstrapCouple("invsync-c@weddly.test");
    let g = await addGuest(token);
    g = await patch(token, g, { invited: true, delivered: true });
    expect(g.invited_physical_at).not.toBeNull();
    g = await patch(token, g, { delivered: false });
    expect(g.invited_physical_at).toBeNull();
    expect(g.invited_online_at).not.toBeNull();
    expect(g.invited_at).not.toBeNull();
  });

  test("a guest created as invited lands in the invited view too", async () => {
    const { token } = await bootstrapCouple("invsync-d@weddly.test");
    const g = await addGuest(token, { invited: true });
    expect(g.invited_online_at).not.toBeNull();
    const d = await addGuest(token, { full_name: "Card Guest", delivered: true });
    expect(d.invited_physical_at).not.toBeNull();
    expect(d.invited_at).not.toBeNull();
  });

  test("an edit that says nothing about invites changes nothing", async () => {
    const { token } = await bootstrapCouple("invsync-e@weddly.test");
    let g = await addGuest(token);
    g = await patch(token, g, { invited_physical: true });
    const before = { ...g };
    g = await patch(token, g, { notes: "vegetarian" });
    expect(g.invited_at).toBe(before.invited_at);
    expect(g.invited_physical_at).toBe(before.invited_physical_at);
    expect(g.invited_online_at).toBeNull();
  });
});
