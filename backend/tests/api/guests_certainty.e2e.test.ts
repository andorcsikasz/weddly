// GuestCertainty — the couple's own confidence that a guest makes the final
// cut, independent of the guest's own rsvp_status. See shared/types.ts
// (GuestCertainty), domain/guests.ts (isGuestCertainty / toGuest) and
// routes/guests.ts (parseUpsert's certainty branch).

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface GuestEnvelope {
  guest: { id: number; full_name: string; certainty: string };
}

describe("guest certainty: defaults and round-trip", () => {
  test("a guest created with no opinion defaults to definite", async () => {
    const { token } = await bootstrapCouple("gc-default@weddly.test");
    const created = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Ari" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.guest.certainty).toBe("definite");
  });

  test("a valid value round-trips through create and update", async () => {
    const { token } = await bootstrapCouple("gc-roundtrip@weddly.test");
    const created = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Beti", certainty: "unlikely" },
      { token },
    );
    expect(created.data.guest.certainty).toBe("unlikely");
    const id = created.data.guest.id;

    const updated = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${id}`,
      { full_name: "Beti", certainty: "likely" },
      { token },
    );
    expect(updated.data.guest.certainty).toBe("likely");

    // A PATCH that says nothing about certainty leaves it alone — same merge-
    // against-existing contract every other field on this endpoint follows.
    const untouched = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${id}`,
      { full_name: "Beti Kovács" },
      { token },
    );
    expect(untouched.data.guest.certainty).toBe("likely");
  });

  test("an unrecognised value falls back to definite rather than 400ing", async () => {
    const { token } = await bootstrapCouple("gc-garbage@weddly.test");
    const created = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Cili", certainty: "extremely-maybe" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.guest.certainty).toBe("definite");
  });

  test("certainty survives a full guest-list read", async () => {
    const { token } = await bootstrapCouple("gc-list@weddly.test");
    await req("POST", "/api/guests", { full_name: "Deni", certainty: "unsure" }, { token });
    const list = await req<{ guests: { full_name: string; certainty: string }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const deni = list.data.guests.find((g) => g.full_name === "Deni");
    expect(deni?.certainty).toBe("unsure");
  });
});

describe("guest certainty: CSV export", () => {
  test("the exported column reflects each guest's own value", async () => {
    const { token } = await bootstrapCouple("gc-csv@weddly.test");
    await req("POST", "/api/guests", { full_name: "Emi", certainty: "unlikely" }, { token });
    const r = await fetch(`${BASE}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const text = (await r.text()).replace(/^﻿/, "");
    const headerLine = text.split("\r\n")[0]!;
    expect(headerLine.split(",")).toContain("certainty");
    expect(text).toContain("unlikely");
  });
});

// Certainty is household-canonical (triggers in db.ts): a household is invited
// or cut as one unit, so every path that changes or adds a member has to land
// on one value for the whole household.
describe("guest certainty: one value per household", () => {
  interface G {
    id: number;
    full_name: string;
    certainty: string;
    household_id: number | null;
  }
  async function list(token: string): Promise<G[]> {
    const r = await req<{ guests: G[] }>("GET", "/api/guests", undefined, { token });
    return r.data.guests;
  }

  test("changing one member's certainty changes every member's", async () => {
    const { token } = await bootstrapCouple("gc-hh-spread@weddly.test");
    const a = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", household_id: null, new_household_label: "Kovács család" },
      { token },
    );
    const hh = a.data.guest.household_id;
    expect(hh).not.toBeNull();
    await req("POST", "/api/guests", { full_name: "Márk", household_id: hh }, { token });

    await req("PATCH", `/api/guests/${a.data.guest.id}`, { certainty: "unsure" }, { token });
    const members = (await list(token)).filter((g) => g.household_id === hh);
    expect(members).toHaveLength(2);
    expect(members.every((g) => g.certainty === "unsure")).toBe(true);
  });

  test("a guest joining a household takes the household's value", async () => {
    const { token } = await bootstrapCouple("gc-hh-join@weddly.test");
    const a = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      {
        full_name: "Bella",
        certainty: "unlikely",
        household_id: null,
        new_household_label: "Nagy család",
      },
      { token },
    );
    const hh = a.data.guest.household_id;
    const b = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      { full_name: "Bence", household_id: hh },
      { token },
    );
    expect(b.data.guest.certainty).toBe("unlikely");
  });

  test("moving a guest into another household adopts that household's value", async () => {
    const { token } = await bootstrapCouple("gc-hh-move@weddly.test");
    const a = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      { full_name: "Csilla", certainty: "likely", household_id: null, new_household_label: "A" },
      { token },
    );
    const b = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      { full_name: "Dani", household_id: null, new_household_label: "B" },
      { token },
    );
    expect(b.data.guest.certainty).toBe("definite");
    const moved = await req<{ guest: G }>(
      "PATCH",
      `/api/guests/${b.data.guest.id}`,
      { household_id: a.data.guest.household_id },
      { token },
    );
    expect(moved.data.guest.certainty).toBe("likely");
    // And the household it joined did not flip to the newcomer's old value.
    const csilla = (await list(token)).find((g) => g.id === a.data.guest.id);
    expect(csilla?.certainty).toBe("likely");
  });

  test("a materialised +1 inherits its host household's value", async () => {
    const { token } = await bootstrapCouple("gc-hh-plusone@weddly.test");
    const host = await req<{ guest: G }>(
      "POST",
      "/api/guests",
      { full_name: "Emese", certainty: "unsure" },
      { token },
    );
    await req(
      "PATCH",
      `/api/guests/${host.data.guest.id}`,
      { plus_one_name: "Emese kísérője" },
      { token },
    );
    const plusOne = (await list(token)).find((g) => g.full_name === "Emese kísérője");
    expect(plusOne?.certainty).toBe("unsure");
  });
});
