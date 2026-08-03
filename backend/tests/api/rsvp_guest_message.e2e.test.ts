// The guest's own free-text message on the public RSVP
// (`households.guest_message`).
//
// Until this existed the only box a guest could type into on the whole form
// was "Song request", so anyone with something to say had to put it there.
// The cases below pin the three things that are easy to get wrong later:
// the message is echoed back so a re-open edits rather than blanks it, an
// ABSENT key leaves it alone while an EMPTY one clears it, and it never
// collides with `households.notes`, which belongs to the couple.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, bootstrapCouple } from "../helpers";
import { GUEST_MESSAGE_MAX } from "@shared/rsvp";
import { buildEmail } from "../../src/domain/emails/templates";
import { db } from "../../src/db";

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

async function firstHousehold(
  token: string,
): Promise<{ id: number; code: string; notes: string | null; guest_message: string | null }> {
  const list = await req<{
    households: { id: number; code: string; notes: string | null; guest_message: string | null }[];
  }>("GET", "/api/households", undefined, { token });
  return list.data.households[0]!;
}

/** One couple, one guest, ready to RSVP. Returns everything the public
 *  submit needs plus the token for reading the couple side back. */
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
  return { token, slug, code: hh.code, householdId: hh.id, guestId: g.data.guest.id };
}

function submit(slug: string, code: string, guestId: number, extra: Record<string, unknown> = {}) {
  return req<{ rsvp: { guest_message: string | null } }>("POST", "/api/rsvp/checkin", {
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
      },
    ],
    ...extra,
  });
}

describe("rsvp guest message", () => {
  test("a guest's message is stored and echoed back on the public view", async () => {
    const { token, slug, code, guestId } = await setup("gm-basic@weddly.test");

    const r = await submit(slug, code, guestId, {
      guest_message: "We are arriving late, the train gets in at 19:00. Congratulations!",
    });
    expect(r.status).toBe(200);
    // Echoed in the submit response, so the form the guest is looking at
    // already shows what was saved.
    expect(r.data.rsvp.guest_message).toBe(
      "We are arriving late, the train gets in at 19:00. Congratulations!",
    );

    // And on a fresh lookup, which is what a re-open actually calls: without
    // this the box would render empty and the next submit would blank it.
    const view = await req<{ rsvp: { guest_message: string | null } }>(
      "GET",
      `/api/rsvp/lookup?couple=${slug}&code=${code}`,
    );
    expect(view.status).toBe(200);
    expect(view.data.rsvp.guest_message).toContain("arriving late");

    // The couple reads it on their own household card.
    const hh = await firstHousehold(token);
    expect(hh.guest_message).toContain("arriving late");
  });

  test("an absent key leaves an existing message alone; an empty one clears it", async () => {
    const { slug, code, guestId, token } = await setup("gm-absent@weddly.test");

    await submit(slug, code, guestId, { guest_message: "Bringing the dog, hope that is fine" });
    expect((await firstHousehold(token)).guest_message).toContain("dog");

    // An older client, or any resubmit that simply doesn't carry the field,
    // must not erase what the couple has already read.
    const silent = await submit(slug, code, guestId);
    expect(silent.status).toBe(200);
    expect(silent.data.rsvp.guest_message).toContain("dog");
    expect((await firstHousehold(token)).guest_message).toContain("dog");

    // An emptied box is a deliberate delete and stores NULL, not "".
    const cleared = await submit(slug, code, guestId, { guest_message: "   " });
    expect(cleared.status).toBe(200);
    expect(cleared.data.rsvp.guest_message).toBeNull();
    expect((await firstHousehold(token)).guest_message).toBeNull();
  });

  test("the guest's message never touches the couple's own household notes", async () => {
    const { token, slug, code, guestId, householdId } = await setup("gm-notes@weddly.test");

    const patched = await req(
      "PATCH",
      `/api/households/${householdId}`,
      { notes: "Seat them away from uncle Béla" },
      { token },
    );
    expect(patched.status).toBe(200);

    await submit(slug, code, guestId, { guest_message: "Can we bring our own cake?" });

    const hh = await firstHousehold(token);
    // Two columns, two authors. Reusing `notes` would have let whoever RSVP'd
    // last overwrite the couple's private seating note.
    expect(hh.notes).toBe("Seat them away from uncle Béla");
    expect(hh.guest_message).toBe("Can we bring our own cake?");
  });

  test("an over-long message is truncated rather than rejected", async () => {
    const { slug, code, guestId } = await setup("gm-long@weddly.test");

    // A guest mid-sentence should never see a 400 for writing too much; the
    // textarea caps them long before this, so this is the non-browser path.
    const r = await submit(slug, code, guestId, { guest_message: "x".repeat(9000) });
    expect(r.status).toBe(200);
    expect(r.data.rsvp.guest_message?.length).toBe(GUEST_MESSAGE_MAX);
  });

  test("a household that never wrote anything reads back null, not empty string", async () => {
    const { slug, code, guestId, token } = await setup("gm-null@weddly.test");

    const r = await submit(slug, code, guestId);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.guest_message).toBeNull();
    expect((await firstHousehold(token)).guest_message).toBeNull();
  });
});

// ─── The message has to reach the couple, not just the guest list ───────────
//
// A note nobody notices is the same as no note. The couple already gets an
// email when an RSVP lands, so the message rides that one; and a household
// that comes back later to write something without changing anyone's answer
// gets an email of its own, because otherwise nothing would reach them at all.

describe("rsvp guest message: notification", () => {
  test("the message is quoted in both RSVP emails", () => {
    const single = buildEmail(
      "rsvp_received_for_couple",
      {
        guestName: "Anna Kovács",
        rsvpStatus: "yes",
        guestPageUrl: "https://tryweddly.com/app/guests",
        guestMessage: "We are arriving late, the train gets in at 19:00",
      },
      { recipientName: "Flora" },
    );
    expect(single.rendered.text).toContain("the train gets in at 19:00");
    expect(single.rendered.html).toContain("the train gets in at 19:00");

    const household = buildEmail(
      "rsvp_received_household_for_couple",
      {
        householdLabel: "Kovács család",
        guests: [{ name: "Anna Kovács", rsvpStatus: "yes" }],
        guestPageUrl: "https://tryweddly.com/app/guests",
        guestMessage: "Can we bring our own cake?",
      },
      { recipientName: "Flora" },
    );
    expect(household.rendered.text).toContain("Can we bring our own cake?");
  });

  test("no message means no empty quote in the body", () => {
    const built = buildEmail(
      "rsvp_received_for_couple",
      {
        guestName: "Anna Kovács",
        rsvpStatus: "yes",
        guestPageUrl: "https://tryweddly.com/app/guests",
      },
      { recipientName: "Flora" },
    );
    expect(built.rendered.text).not.toContain("left a message");
    expect(built.rendered.text).not.toContain("Üzenetet is hagytak");
  });

  test("a message with no status change reads as a message, not as an RSVP", () => {
    // `guests: []` is the message-only shape. The subject helper's tally would
    // otherwise announce "all in" off an empty list, promising a wedding
    // nobody agreed to.
    const built = buildEmail(
      "rsvp_received_household_for_couple",
      {
        householdLabel: "Kovács család",
        guests: [],
        guestPageUrl: "https://tryweddly.com/app/guests",
        guestMessage: "Actually we will be there by 18:00",
      },
      { recipientName: "Flora" },
    );
    expect(built.subject).toContain("Kovács család");
    expect(built.subject).not.toContain("all in");
    expect(built.rendered.text).toContain("left you a message");
    expect(built.rendered.text).toContain("Actually we will be there by 18:00");
    expect(built.rendered.text).not.toContain("(0 guests)");
  });

  test("a message written with the RSVP notifies once, and a re-save does not renotify", async () => {
    const { token, slug, code, guestId } = await setup("gm-notify@weddly.test");

    await submit(slug, code, guestId, { guest_message: "Bringing the dog" });
    const first = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind LIKE 'rsvp_received%'")
      .get() as { n: number };
    expect(first.n).toBeGreaterThan(0);

    // Same message again, same statuses: nothing new is true, so nothing is
    // sent. Without the before/after comparison the couple would be mailed the
    // same sentence every time this family reopened the form.
    await submit(slug, code, guestId, { guest_message: "Bringing the dog" });
    const second = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind LIKE 'rsvp_received%'")
      .get() as { n: number };
    expect(second.n).toBe(first.n);
  });

  test("a later message with no status change still reaches the couple", async () => {
    const { token, slug, code, guestId } = await setup("gm-late@weddly.test");
    await submit(slug, code, guestId);
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind LIKE 'rsvp_received%'")
      .get() as { n: number };

    // They come back to say something. Nobody's answer moves.
    await submit(slug, code, guestId, { guest_message: "We will be there by 18:00" });
    const after = db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE kind LIKE 'rsvp_received%'")
      .get() as { n: number };
    expect(after.n).toBeGreaterThan(before.n);

    // And the bell says what actually happened rather than claiming an RSVP.
    const note = db
      .prepare("SELECT kind FROM couple_notifications ORDER BY id DESC LIMIT 1")
      .get() as { kind: string } | undefined;
    expect(note?.kind).toBe("rsvp_guest_message");
  });
});
