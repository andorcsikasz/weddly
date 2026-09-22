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
