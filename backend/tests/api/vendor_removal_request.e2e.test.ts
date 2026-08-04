// A business asked, in writing, to be taken off Weddly entirely.
//
// Two things had to be true for this to be one action rather than two, and the
// suite asserts both because before it they lived in different tables behind
// different admin buttons: an admin who hid a listing left the ADDRESS live for
// the next campaign, and an admin who suppressed an address left the CARD on
// the public directory. Half of either is worse than neither, because it reads
// to the business as being ignored.
//
// The third thing is the one that is easy to get backwards: the confirmation
// mail is `transactional`, and it has to be, because recording the removal is
// what writes the address tombstone and `sendKind` gates every
// non-transactional mail on exactly that tombstone. Any other category and the
// mail suppresses itself, so the business never hears that we acted.
//
// Pairs with domain/vendor_removal.ts, domain/emails/optouts.ts and
// routes/admin_suppliers.ts (handleRemovalRequest).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { isOptedOut } from "../../src/domain/emails/optouts";
import { isCuratedPubliclyVisible } from "../../src/domain/curated_overrides";
import { registerAndVerify, req, wipeAll } from "../helpers";

const ADMIN_EMAIL = "admin@test.test";
const ADMIN_PASSWORD = "supersafe123";

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  return login.data.token;
}

/** A curated slug with a real contact address, resolved from the live
 *  DIRECTORY rather than hardcoded, so re-editing the data file cannot quietly
 *  turn this suite into a no-op against an id that stopped existing. */
function someCuratedWithEmail(): { id: string; email: string } {
  const entry = DIRECTORY.find(
    (s) => typeof s.contact_email === "string" && s.contact_email !== "",
  );
  if (!entry) throw new Error("no curated entry with a contact email");
  return { id: entry.id, email: entry.contact_email as string };
}

function lastMail(to: string): { kind: string; status: string; from_email: string } | undefined {
  return db
    .prepare("SELECT kind, status, from_email FROM email_log WHERE to_email = ? ORDER BY id DESC")
    .get(to.toLowerCase()) as { kind: string; status: string; from_email: string } | undefined;
}

describe("a business that asks to be removed comes off the site AND the mailing list", () => {
  test("one admin action tombstones the address and delists the curated card", async () => {
    wipeAll();
    const token = await adminToken();
    const { id, email } = someCuratedWithEmail();

    expect(isOptedOut(email)).toBe(false);
    expect(isCuratedPubliclyVisible(id)).toBe(true);

    const r = await req<{ ok: true; mail: string; removal: { email: string } }>(
      "POST",
      "/api/admin/suppliers/removal-request",
      { listing_id: id, via: "email", note: "Asked by personal email" },
      { token },
    );
    expect(r.status).toBe(200);

    // 1. No further cold outreach, ever. The tombstone is what every campaign
    //    and `sendKind` itself consult, so this one row closes all of them.
    expect(isOptedOut(email)).toBe(true);

    // 2. No visibility on the site.
    expect(isCuratedPubliclyVisible(id)).toBe(false);

    // 3. The record of WHY, which is what separates this from an ordinary hide
    //    a later admin might casually reverse.
    const row = db.prepare("SELECT * FROM vendor_removal_requests WHERE listing_id = ?").get(id) as
      | { email: string; requested_via: string; note: string; mail_sent_at: number | null }
      | undefined;
    expect(row?.email).toBe(email.toLowerCase());
    expect(row?.requested_via).toBe("email");
    expect(row?.note).toBe("Asked by personal email");
  });

  test("the confirmation still reaches them, despite the tombstone it just wrote", async () => {
    wipeAll();
    const token = await adminToken();
    const { id, email } = someCuratedWithEmail();

    const r = await req<{ mail: string }>(
      "POST",
      "/api/admin/suppliers/removal-request",
      { listing_id: id, via: "email" },
      { token },
    );
    expect(r.status).toBe(200);

    // This is the whole reason the kind is transactional. A lifecycle or
    // outreach classification would have it skipped by its own suppression, and
    // the business would be removed in silence.
    expect(r.data.mail).not.toBe("skipped_opt_out");

    const mail = lastMail(email);
    expect(mail?.kind).toBe("vendor_removal_confirmed");
    expect(mail?.status).not.toBe("skipped_opt_out");

    // And it leaves from a mailbox that can hear their reply: they wrote to a
    // person, so a noreply@ sender would be answering a letter from behind a
    // door that does not open.
    expect(mail?.from_email).toContain("hello@");

    // `mail_sent_at` tracks DELIVERY, not intent, so it is stamped exactly when
    // the send reported `sent` and left null otherwise. The test environment
    // has no mail provider, so the honest answer here is null, and asserting
    // the RELATIONSHIP rather than a fixed value is what makes this hold in
    // both environments. Null is also what lets the admin UI say "removed, not
    // yet confirmed to them" instead of claiming a mail that never left.
    const stamped = db
      .prepare("SELECT mail_sent_at FROM vendor_removal_requests WHERE listing_id = ?")
      .get(id) as { mail_sent_at: number | null } | undefined;
    expect(stamped?.mail_sent_at === null).toBe(r.data.mail !== "sent");
  });

  test("the removed card is gone from the public directory and its own page", async () => {
    wipeAll();
    const token = await adminToken();
    const { id } = someCuratedWithEmail();

    const before = await req<{ vendors: Array<{ id: string }> }>(
      "GET",
      "/api/public/vendors?limit=100",
    );
    expect(before.status).toBe(200);

    await req(
      "POST",
      "/api/admin/suppliers/removal-request",
      { listing_id: id, via: "email" },
      { token },
    );

    const after = await req<{ vendors: Array<{ id: string }> }>(
      "GET",
      "/api/public/vendors?limit=100",
    );
    expect(after.data.vendors.some((v) => v.id === id)).toBe(false);

    // The detail page has to go too. A directory that no longer lists them
    // while the card still answers on a direct link is not a removal.
    const detail = await req("GET", `/api/public/vendors/${id}`);
    expect(detail.status).toBeGreaterThanOrEqual(400);
  });

  test("a non-admin cannot flag anyone, and an unknown listing 404s", async () => {
    wipeAll();
    const { id } = someCuratedWithEmail();
    const outsider = await registerAndVerify({
      email: "nosy@weddly.test",
      password: "supersafe123",
      full_name: "Nosy Parker",
    });

    const denied = await req(
      "POST",
      "/api/admin/suppliers/removal-request",
      { listing_id: id, via: "email" },
      { token: outsider.data.token },
    );
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(isOptedOut(someCuratedWithEmail().email)).toBe(false);

    const token = await adminToken();
    const missing = await req(
      "POST",
      "/api/admin/suppliers/removal-request",
      { listing_id: "no-such-listing-anywhere", via: "email" },
      { token },
    );
    expect(missing.status).toBe(404);
  });
});
