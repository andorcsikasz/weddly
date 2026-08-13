// A guest-supplied contact email on the public RSVP check-in (`guests.email`),
// so the couple can reach them with wedding updates after they've answered.
//
// The column already existed (the admin guest list has always been able to
// set it), so this is purely a new WRITE path plus the echo-back contract
// every other per-member field on this form already follows: the value is
// always sent on submit, seeded from whatever the server already had, so a
// guest who doesn't touch the box can't accidentally blank an address the
// couple entered by hand.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, bootstrapCouple } from "../helpers";

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

async function firstHousehold(token: string): Promise<{ id: number; code: string }> {
  const list = await req<{ households: { id: number; code: string }[] }>(
    "GET",
    "/api/households",
    undefined,
    { token },
  );
  return list.data.households[0]!;
}

async function guestEmail(token: string, guestId: number): Promise<string | null> {
  const list = await req<{ guests: { id: number; email: string | null }[] }>(
    "GET",
    "/api/guests",
    undefined,
    { token },
  );
  return list.data.guests.find((g) => g.id === guestId)?.email ?? null;
}

async function setup(email: string, guestEmailOnCreate?: string) {
  wipeAll();
  const { token } = await bootstrapCouple(email);
  const g = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name: "Anna Kovács", email: guestEmailOnCreate },
    { token },
  );
  expect(g.status).toBe(201);
  const slug = await getSlug(token);
  const hh = await firstHousehold(token);
  return { token, slug, code: hh.code, guestId: g.data.guest.id };
}

function submit(
  slug: string,
  code: string,
  guestId: number,
  memberExtra: Record<string, unknown> = {},
) {
  return req<{ rsvp: { members: { id: number; email: string | null }[] } }>(
    "POST",
    "/api/rsvp/checkin",
    {
      couple_slug: slug,
      household_code: code,
      members: [
        {
          guest_id: guestId,
          rsvp_status: "yes",
          meal_choice: null,
          dietary: null,
          accommodation_needed: false,
          song_request: null,
          ...memberExtra,
        },
      ],
    },
  );
}

describe("rsvp email", () => {
  test("a guest's email is stored, echoed back, and reaches the couple's guest list", async () => {
    const { token, slug, code, guestId } = await setup("rsvp-email-basic@weddly.test");

    const r = await submit(slug, code, guestId, { email: "anna.kovacs@example.com" });
    expect(r.status).toBe(200);
    const member = r.data.rsvp.members.find((m) => m.id === guestId);
    expect(member?.email).toBe("anna.kovacs@example.com");

    // The couple's own guest list is what reuses `guests.email` for invites —
    // this is the surface that makes the address actually useful to them.
    expect(await guestEmail(token, guestId)).toBe("anna.kovacs@example.com");

    // And a fresh lookup (the guest reopening the form) pre-fills it back.
    const view = await req<{ rsvp: { members: { id: number; email: string | null }[] } }>(
      "GET",
      `/api/rsvp/lookup?couple=${slug}&code=${code}`,
    );
    expect(view.data.rsvp.members.find((m) => m.id === guestId)?.email).toBe(
      "anna.kovacs@example.com",
    );
  });

  test("garbage input degrades to null instead of 400ing the submit", async () => {
    const { slug, code, guestId, token } = await setup("rsvp-email-garbage@weddly.test");

    const r = await submit(slug, code, guestId, { email: "not-an-email" });
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.find((m) => m.id === guestId)?.email).toBeNull();
    expect(await guestEmail(token, guestId)).toBeNull();
  });

  test("a resubmit that doesn't touch the field can't clobber an address the couple already entered", async () => {
    const { slug, code, guestId, token } = await setup(
      "rsvp-email-preserve@weddly.test",
      "from-admin@example.com",
    );
    expect(await guestEmail(token, guestId)).toBe("from-admin@example.com");

    // The form always sends the field, but seeded from what the server had —
    // this call models a guest who never touched the box.
    const r = await submit(slug, code, guestId, { email: "from-admin@example.com" });
    expect(r.status).toBe(200);
    expect(await guestEmail(token, guestId)).toBe("from-admin@example.com");
  });

  test("the guest can overwrite the couple-entered address with their own", async () => {
    const { slug, code, guestId, token } = await setup(
      "rsvp-email-overwrite@weddly.test",
      "old@example.com",
    );

    const r = await submit(slug, code, guestId, { email: "new@example.com" });
    expect(r.status).toBe(200);
    expect(await guestEmail(token, guestId)).toBe("new@example.com");
  });
});
