// A household the server names itself is "<guest>'s family", in the language
// of whoever added the guest, not the guest's bare name: a party labelled
// "Andor Csíkász" reads as one person and is wrong the moment a second member
// joins. A label the couple typed is always kept as typed.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req } from "../helpers";

interface GuestEnvelope {
  guest: { id: number; household_id: number | null };
}

function labelOf(hhId: number): string {
  return (db.prepare("SELECT label FROM households WHERE id = ?").get(hhId) as { label: string })
    .label;
}

async function addGuest(token: string, body: Record<string, unknown>): Promise<number> {
  const r = await req<GuestEnvelope>("POST", "/api/guests", body, { token });
  expect(r.status).toBe(201);
  return r.data.guest.household_id as number;
}

describe("auto-named household label", () => {
  test("names an unnamed household after the guest's family, EN by default", async () => {
    const { token } = await bootstrapCouple("hh-family-en@weddly.test");
    const hh = await addGuest(token, { full_name: "Andor Csíkász" });
    expect(labelOf(hh)).toBe("Andor Csíkász's family");
  });

  test("follows the adding user's UI locale", async () => {
    const { token } = await bootstrapCouple("hh-family-hu@weddly.test");
    db.prepare("UPDATE users SET locale = 'hu' WHERE email = ?").run("hh-family-hu@weddly.test");
    const hh = await addGuest(token, { full_name: "Csíkász Andor" });
    expect(labelOf(hh)).toBe("Csíkász Andor családja");

    const r = await req<{ created: number }>(
      "POST",
      "/api/guests/bulk",
      { guests: [{ full_name: "Kovács Anna" }] },
      { token },
    );
    expect(r.status).toBe(201);
    const row = db
      .prepare(
        "SELECT h.label AS label FROM guests g JOIN households h ON h.id = g.household_id WHERE g.full_name = ?",
      )
      .get("Kovács Anna") as { label: string };
    expect(row.label).toBe("Kovács Anna családja");
  });

  test("keeps a label the couple typed", async () => {
    const { token } = await bootstrapCouple("hh-family-typed@weddly.test");
    const hh = await addGuest(token, { full_name: "Mia Rossi", new_household_label: "The Rossis" });
    expect(labelOf(hh)).toBe("The Rossis");
  });
});
