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
      guests: { full_name: string; household_id: number | null; is_plus_one: boolean }[];
    }>("GET", "/api/guests", undefined, { token });
    const dan = list.data.guests.filter((g) => g.full_name === "Dan");
    expect(dan).toHaveLength(1);
    expect(dan[0]?.household_id).toBe(hh);
    expect(dan[0]?.is_plus_one).toBe(true);

    // Re-saving the parent without a plus-one must not spawn another Dan.
    await req("PATCH", `/api/guests/${cara.data.guest.id}`, { full_name: "Cara" }, { token });
    const after = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(after.data.guests.filter((g) => g.full_name === "Dan")).toHaveLength(1);
  });
});
