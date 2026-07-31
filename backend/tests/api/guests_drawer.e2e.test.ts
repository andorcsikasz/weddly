// Guest edit-drawer behaviours: the couple recording an RSVP on the guest's
// behalf stamps rsvp_responded_at; the Supplier type routes a guest into a
// single per-couple supplier household; a filled-in plus-one materialises as a
// real guest. See routes/guests.ts (handleCreate/handleUpdate) and
// domain/households.ts (getOrCreateSupplierHousehold).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req } from "../helpers";

interface GuestEnvelope {
  guest: {
    id: number;
    household_id: number | null;
    is_supplier: boolean;
    plus_one_name: string | null;
    rsvp_responded_at: number | null;
  };
}

describe("guest drawer: rsvp_responded_at stamping on couple edits", () => {
  test("PATCH to an answer stamps; later edits preserve it; pending clears it", async () => {
    const { token } = await bootstrapCouple("gd-rsvp@weddly.test");
    const created = await req<GuestEnvelope>("POST", "/api/guests", { full_name: "Al" }, { token });
    expect(created.status).toBe(201);
    expect(created.data.guest.rsvp_responded_at).toBeNull();
    const id = created.data.guest.id;

    const yes = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${id}`,
      { full_name: "Al", rsvp_status: "yes" },
      { token },
    );
    const firstTs = yes.data.guest.rsvp_responded_at;
    expect(firstTs).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 5));
    const maybe = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${id}`,
      { full_name: "Al", rsvp_status: "maybe" },
      { token },
    );
    expect(maybe.data.guest.rsvp_responded_at).toBe(firstTs as number);

    const pending = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${id}`,
      { full_name: "Al", rsvp_status: "pending" },
      { token },
    );
    expect(pending.data.guest.rsvp_responded_at).toBeNull();
  });

  test("creating a guest already answered stamps immediately", async () => {
    const { token } = await bootstrapCouple("gd-rsvp2@weddly.test");
    const created = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Bo", rsvp_status: "yes" },
      { token },
    );
    expect(created.data.guest.rsvp_responded_at).toBeGreaterThan(0);
  });
});

describe("guest drawer: supplier type → supplier household", () => {
  test("first supplier creates a flagged household; a second reuses it; unflagging moves out", async () => {
    const { token, coupleId } = await bootstrapCouple("gd-sup@weddly.test");

    const dj = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "DJ Nova", is_supplier: true },
      { token },
    );
    const hhId = dj.data.guest.household_id;
    expect(hhId).not.toBeNull();
    const flag = db
      .prepare("SELECT is_supplier_household FROM households WHERE id = ?")
      .get(hhId) as { is_supplier_household: number };
    expect(flag.is_supplier_household).toBe(1);

    const photog = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Photo Co", is_supplier: true },
      { token },
    );
    expect(photog.data.guest.household_id).toBe(hhId as number);

    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM households WHERE couple_id = ? AND is_supplier_household = 1",
      )
      .get(coupleId) as { n: number };
    expect(count.n).toBe(1);

    const unflag = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${dj.data.guest.id}`,
      { full_name: "DJ Nova", is_supplier: false },
      { token },
    );
    expect(unflag.data.guest.is_supplier).toBe(false);
    expect(unflag.data.guest.household_id).toBeNull();
  });
});

describe("guest drawer: supplier household members are sure participants", () => {
  // A member added straight INTO the Szolgáltatók/Suppliers household (via that
  // card's "Add a member", i.e. household_id without the supplier toggle) is a
  // booked vendor: the backend flags is_supplier and defaults RSVP to "yes".
  interface SupplierGuestEnvelope {
    guest: {
      id: number;
      household_id: number | null;
      is_supplier: boolean;
      rsvp_status: string;
      rsvp_responded_at: number | null;
    };
  }

  async function supplierHouseholdId(token: string): Promise<number> {
    // Seed the couple's single supplier household by adding one supplier.
    const seed = await req<SupplierGuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Seed DJ", is_supplier: true },
      { token },
    );
    const id = seed.data.guest.household_id;
    expect(id).not.toBeNull();
    return id as number;
  }

  test("is_supplier=true defaults RSVP to yes and stamps responded_at", async () => {
    const { token } = await bootstrapCouple("gd-sup-yes@weddly.test");
    const r = await req<SupplierGuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "DJ Sure", is_supplier: true },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.is_supplier).toBe(true);
    expect(r.data.guest.rsvp_status).toBe("yes");
    expect(r.data.guest.rsvp_responded_at).not.toBeNull();
  });

  test("member added by household_id into the supplier group is flagged + RSVP yes", async () => {
    const { token } = await bootstrapCouple("gd-sup-hh@weddly.test");
    const hhId = await supplierHouseholdId(token);
    // No is_supplier toggle, no rsvp_status — exactly what the "Add a member"
    // button on the Suppliers card sends for a plain new member.
    const r = await req<SupplierGuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Florist Fi", household_id: hhId },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.household_id).toBe(hhId);
    expect(r.data.guest.is_supplier).toBe(true);
    expect(r.data.guest.rsvp_status).toBe("yes");
    expect(r.data.guest.rsvp_responded_at).not.toBeNull();
  });

  test("an explicit rsvp_status into the supplier group is respected", async () => {
    const { token } = await bootstrapCouple("gd-sup-explicit@weddly.test");
    const hhId = await supplierHouseholdId(token);
    const r = await req<SupplierGuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Cant Come", household_id: hhId, rsvp_status: "no" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.is_supplier).toBe(true); // flag is still authoritative
    expect(r.data.guest.rsvp_status).toBe("no"); // but the chosen status wins
  });
});

describe("guest drawer: plus-one materialises a real guest", () => {
  test("filling plus_one_name spawns a sibling guest and clears the carrier; no dup on re-save", async () => {
    const { token } = await bootstrapCouple("gd-plus@weddly.test");
    const cara = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Cara", plus_one_name: "Dan" },
      { token },
    );
    expect(cara.data.guest.plus_one_name).toBeNull();
    const hh = cara.data.guest.household_id;

    const list = await req<{
      guests: {
        full_name: string;
        household_id: number | null;
        is_plus_one: boolean;
        plus_one_of: number | null;
      }[];
    }>("GET", "/api/guests", undefined, { token });
    const dan = list.data.guests.filter((g) => g.full_name === "Dan");
    expect(dan).toHaveLength(1);
    expect(dan[0]?.household_id).toBe(hh);
    expect(dan[0]?.is_plus_one).toBe(true);
    // The +1 hangs off its host so the guest list can nest it underneath.
    expect(dan[0]?.plus_one_of).toBe(cara.data.guest.id);

    // Re-saving the parent without a plus-one must not spawn another Dan.
    await req("PATCH", `/api/guests/${cara.data.guest.id}`, { full_name: "Cara" }, { token });
    const after = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(after.data.guests.filter((g) => g.full_name === "Dan")).toHaveLength(1);
  });
});

describe("guest drawer: explicit +1 type assigned to a host", () => {
  interface FullGuest {
    guest: {
      id: number;
      household_id: number | null;
      is_supplier: boolean;
      is_plus_one: boolean;
      plus_one_of: number | null;
      kind: string;
    };
  }

  test("creating a +1 with plus_one_of links it and inherits the host's household", async () => {
    const { token } = await bootstrapCouple("gd-p1-type@weddly.test");
    const host = await req<FullGuest>(
      "POST",
      "/api/guests",
      { full_name: "Host Hanna", new_household_label: "Hanna ház" },
      { token },
    );
    const hostId = host.data.guest.id;
    const hostHh = host.data.guest.household_id;

    const plusOne = await req<FullGuest>(
      "POST",
      "/api/guests",
      // A household picker value is sent too — the +1 branch must ignore it and
      // follow the host's household instead.
      { full_name: "Companion Cili", plus_one_of: hostId, kind: "baby" },
      { token },
    );
    expect(plusOne.status).toBe(201);
    expect(plusOne.data.guest.is_plus_one).toBe(true);
    expect(plusOne.data.guest.plus_one_of).toBe(hostId);
    expect(plusOne.data.guest.household_id).toBe(hostHh);
    // A +1 is always a plain adult, never a supplier.
    expect(plusOne.data.guest.kind).toBe("adult");
    expect(plusOne.data.guest.is_supplier).toBe(false);
  });

  test("a +1 cannot host another +1, be its own host, or hang off a supplier", async () => {
    const { token } = await bootstrapCouple("gd-p1-guard@weddly.test");
    const host = await req<FullGuest>("POST", "/api/guests", { full_name: "Aliz" }, { token });
    const p1 = await req<FullGuest>(
      "POST",
      "/api/guests",
      { full_name: "Bence", plus_one_of: host.data.guest.id },
      { token },
    );
    expect(p1.status).toBe(201);

    // Chain: assigning a +1 onto an existing +1 is rejected.
    const chain = await req(
      "POST",
      "/api/guests",
      { full_name: "C", plus_one_of: p1.data.guest.id },
      { token },
    );
    expect(chain.status).toBe(400);

    // Unknown host id is rejected.
    const ghost = await req(
      "POST",
      "/api/guests",
      { full_name: "D", plus_one_of: 999999 },
      { token },
    );
    expect(ghost.status).toBe(400);

    // A supplier can't host a +1.
    const sup = await req<FullGuest>(
      "POST",
      "/api/guests",
      { full_name: "DJ", is_supplier: true },
      { token },
    );
    const onSupplier = await req(
      "POST",
      "/api/guests",
      { full_name: "E", plus_one_of: sup.data.guest.id },
      { token },
    );
    expect(onSupplier.status).toBe(400);
  });

  test("detaching a +1 (plus_one_of: null) turns it back into a standalone guest", async () => {
    const { token } = await bootstrapCouple("gd-p1-detach@weddly.test");
    const host = await req<FullGuest>("POST", "/api/guests", { full_name: "Host" }, { token });
    const p1 = await req<FullGuest>(
      "POST",
      "/api/guests",
      { full_name: "Plus", plus_one_of: host.data.guest.id },
      { token },
    );
    expect(p1.data.guest.is_plus_one).toBe(true);

    const detached = await req<FullGuest>(
      "PATCH",
      `/api/guests/${p1.data.guest.id}`,
      { full_name: "Plus", plus_one_of: null },
      { token },
    );
    expect(detached.data.guest.is_plus_one).toBe(false);
    expect(detached.data.guest.plus_one_of).toBeNull();
  });

  test("a guest that already hosts a +1 cannot itself be turned into one", async () => {
    const { token } = await bootstrapCouple("gd-p1-nochain@weddly.test");
    const host = await req<FullGuest>("POST", "/api/guests", { full_name: "Host" }, { token });
    const other = await req<FullGuest>("POST", "/api/guests", { full_name: "Other" }, { token });
    // Host now hosts a +1.
    await req(
      "POST",
      "/api/guests",
      { full_name: "Plus", plus_one_of: host.data.guest.id },
      {
        token,
      },
    );
    // Turning the host into Other's +1 would orphan its own +1 — rejected.
    const becomes = await req(
      "PATCH",
      `/api/guests/${host.data.guest.id}`,
      { full_name: "Host", plus_one_of: other.data.guest.id },
      { token },
    );
    expect(becomes.status).toBe(400);
  });
});
