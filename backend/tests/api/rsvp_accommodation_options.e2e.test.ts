// Guests choosing between the lodgings the couple published, rather than
// ticking a bare "I need a room".
//
// The data model was always most of the way there: `accommodations` is a
// couple-managed table and `guests.accommodation_id` FKs into it. The RSVP
// simply never asked, so the couple collected a pile of booleans and then
// chased every guest by hand. What these cases pin is the half that is easy
// to get wrong: the option list is opt-in per lodging, it leaks none of the
// couple's working data, and the id on an UNAUTHENTICATED submit is verified
// rather than trusted.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, bootstrapCouple } from "../helpers";

interface OptionView {
  id: number;
  name: string;
  address: string | null;
  price_huf: number | null;
  link: string | null;
}
interface RsvpView {
  accommodation_options: OptionView[];
  currency: string;
  members: { id: number; accommodation_needed: boolean; accommodation_id: number | null }[];
}

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

async function addLodging(
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: number; offer_on_rsvp: boolean }> {
  const r = await req<{ accommodation: { id: number; offer_on_rsvp: boolean } }>(
    "POST",
    "/api/accommodations",
    body,
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.accommodation;
}

/** A couple, one guest, and the household asked the accommodation question. */
async function setup(email: string) {
  wipeAll();
  const { token } = await bootstrapCouple(email);
  const g = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name: "Anna Kovács" },
    { token },
  );
  expect(g.status).toBe(201);
  const slug = await getSlug(token);
  const hh = await firstHousehold(token);
  const on = await req(
    "PATCH",
    `/api/households/${hh.id}`,
    { rsvp_offers_accommodation: true },
    { token },
  );
  expect(on.status).toBe(200);
  return { token, slug, code: hh.code, guestId: g.data.guest.id };
}

function submit(slug: string, code: string, guestId: number, member: Record<string, unknown> = {}) {
  return req<{ rsvp: RsvpView }>("POST", "/api/rsvp/checkin", {
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
        ...member,
      },
    ],
  });
}

function lookup(slug: string, code: string) {
  return req<{ rsvp: RsvpView }>("GET", `/api/rsvp/lookup?couple=${slug}&code=${code}`);
}

describe("rsvp accommodation options", () => {
  test("only the lodgings the couple offered reach the public form", async () => {
    const { token, slug, code } = await setup("acc-offer@weddly.test");

    await addLodging(token, { name: "Hotel Panoráma", offer_on_rsvp: true });
    await addLodging(token, { name: "Nagyi háza" }); // private by default

    const view = await lookup(slug, code);
    expect(view.status).toBe(200);
    const names = view.data.rsvp.accommodation_options.map((o) => o.name);
    // Adding a lodging to the couple's own logistics board must never publish
    // it: `offer_on_rsvp` defaults to 0 and is the only thing that opts in.
    expect(names).toEqual(["Hotel Panoráma"]);
  });

  test("the option carries what you choose with, and none of the couple's working data", async () => {
    const { token, slug, code } = await setup("acc-fields@weddly.test");

    await addLodging(token, {
      name: "Hotel Panoráma",
      address: "Fő tér 1, Eger",
      price_huf: 24000,
      link: "https://panorama.example/book",
      contact: "+36 30 111 2222",
      notes: "Ask for the group rate, Béla knows",
      capacity: 4,
      offer_on_rsvp: true,
    });

    const opt = (await lookup(slug, code)).data.rsvp.accommodation_options[0]!;
    expect(opt.name).toBe("Hotel Panoráma");
    expect(opt.address).toBe("Fő tér 1, Eger");
    expect(opt.price_huf).toBe(24000);
    expect(opt.link).toBe("https://panorama.example/book");
    // The innkeeper's phone, the couple's private note and the capacity they
    // are still juggling are none of a guest's business.
    const leaked = JSON.stringify(opt);
    expect(leaked).not.toContain("111 2222");
    expect(leaked).not.toContain("Béla");
    expect(leaked).not.toContain("capacity");
  });

  test("picking a lodging stores it and implies the guest needs one", async () => {
    const { token, slug, code, guestId } = await setup("acc-pick@weddly.test");
    const lodging = await addLodging(token, { name: "Hotel Panoráma", offer_on_rsvp: true });

    // Note the body says accommodation_needed:false — picking a place IS
    // needing one, and the server must not record a guest with a room booked
    // that its own summary counts as needing nothing.
    const r = await submit(slug, code, guestId, { accommodation_id: lodging.id });
    expect(r.status).toBe(200);
    const member = r.data.rsvp.members.find((m) => m.id === guestId)!;
    expect(member.accommodation_id).toBe(lodging.id);
    expect(member.accommodation_needed).toBe(true);

    // And it lands on the column the couple's logistics board already draws,
    // so the guest shows up on that house card with no extra plumbing.
    const guests = await req<{ guests: { id: number; accommodation_id: number | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    expect(guests.data.guests.find((g) => g.id === guestId)?.accommodation_id).toBe(lodging.id);
  });

  test("choosing none clears a previous pick", async () => {
    const { token, slug, code, guestId } = await setup("acc-clear@weddly.test");
    const lodging = await addLodging(token, { name: "Hotel Panoráma", offer_on_rsvp: true });

    await submit(slug, code, guestId, { accommodation_id: lodging.id });
    // On a form that lists places, "none selected" is an answer, not a blank.
    const r = await submit(slug, code, guestId, { accommodation_id: null });
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.find((m) => m.id === guestId)?.accommodation_id).toBeNull();
  });

  test("a lodging the couple kept private cannot be picked", async () => {
    const { token, slug, code, guestId } = await setup("acc-private@weddly.test");
    const hidden = await addLodging(token, { name: "Nagyi háza" });

    // The submit endpoint is unauthenticated, so the id is checked, not
    // trusted. A guest must not park themselves somewhere deliberately
    // kept off the form.
    const r = await submit(slug, code, guestId, { accommodation_id: hidden.id });
    expect(r.status).toBe(400);
  });

  test("another couple's lodging cannot be picked", async () => {
    const { token, slug, code, guestId } = await setup("acc-tenant-a@weddly.test");
    await addLodging(token, { name: "Hotel Panoráma", offer_on_rsvp: true });

    // A second workspace, publishing its own lodging.
    const { token: otherToken } = await bootstrapCouple("acc-tenant-b@weddly.test");
    const theirs = await addLodging(otherToken, { name: "Their hotel", offer_on_rsvp: true });

    const r = await submit(slug, code, guestId, { accommodation_id: theirs.id });
    expect(r.status).toBe(400);
  });

  test("with nothing published the question stays the plain checkbox", async () => {
    const { slug, code, guestId } = await setup("acc-legacy@weddly.test");

    const view = await lookup(slug, code);
    expect(view.data.rsvp.accommodation_options).toEqual([]);

    // The pre-existing boolean path is untouched, which is what every couple
    // who never opens the logistics page keeps using.
    const r = await submit(slug, code, guestId, { accommodation_needed: true });
    expect(r.status).toBe(200);
    const member = r.data.rsvp.members.find((m) => m.id === guestId)!;
    expect(member.accommodation_needed).toBe(true);
    expect(member.accommodation_id).toBeNull();
  });

  test("options are hidden from a household that was never asked the question", async () => {
    const { token, slug, code } = await setup("acc-household-off@weddly.test");
    await addLodging(token, { name: "Hotel Panoráma", offer_on_rsvp: true });

    const hh = await firstHousehold(token);
    const off = await req(
      "PATCH",
      `/api/households/${hh.id}`,
      { rsvp_offers_accommodation: false },
      { token },
    );
    expect(off.status).toBe(200);

    // The per-household toggle is the gate; a locals-only party should not be
    // shown a hotel list just because the venue-block party is.
    const view = await lookup(slug, code);
    expect(view.data.rsvp.accommodation_options).toEqual([]);
  });
});
