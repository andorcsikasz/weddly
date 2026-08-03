// The directory's contact book is the asset, and until this landed one
// unauthenticated `GET /api/suppliers` handed it over whole: 1022 listings, 503
// email addresses and 538 phone numbers in a single response, no session, no
// quota. These tests pin the shape that replaced it.
//
//   1. The catalogue says WHETHER a listing has a contact, never what it is.
//   2. The PHONE comes from `/api/suppliers/:id/contact`, one listing per
//      request, session required.
//   3. That endpoint and the detail endpoint draw on ONE per-user quota, so
//      alternating between them buys nothing.
//   4. An anonymous visitor gets a masked teaser on the public page and no way
//      to ask for more.
//   5. The EMAIL has no door at all — no list, no detail, no contact endpoint,
//      signed in or not (owner rule, 2026-07-31). Couples write through the
//      inquiry flow, which delivers to the address without publishing it.
//
// A regression here is silent and expensive: nothing errors, the pages keep
// working, and the contact book is simply public again.

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import type { DirectorySupplier, SupplierContact } from "@shared/suppliers";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { DIRECTORY } from "../../src/domain/suppliers_data";

/** A curated listing that publishes BOTH an email and a phone, so the
 *  assertions are about hiding real values rather than about empty fields.
 *
 *  Read off the static catalogue rather than seeded: a curated entry's contact
 *  lives in `suppliers_data.ts`, and `resolveSupplierBase` reads it from there,
 *  so writing to the `listings` row would leave the test asserting against a
 *  value the endpoint never looks at. */
function contactableListing(): { id: string; email: string; phone: string } {
  const entry = DIRECTORY.find((s) => s.contact_email && s.contact_phone);
  if (!entry) throw new Error("no curated entry publishes both an email and a phone");
  return {
    id: entry.id,
    email: entry.contact_email as string,
    phone: entry.contact_phone as string,
  };
}

beforeEach(() => {
  wipeAll();
});

describe("the catalogue never carries contact values", () => {
  test("an anonymous list response has no email or phone on any row", async () => {
    const r = await req<{ suppliers: DirectorySupplier[] }>("GET", "/api/suppliers?country=all");
    expect(r.status).toBe(200);
    expect(r.data.suppliers.length).toBeGreaterThan(0);

    const leaked = r.data.suppliers.filter(
      (s) => s.contact_email !== null || s.contact_phone !== null || s.contact_phone_alt,
    );
    expect(leaked.map((s) => s.id)).toEqual([]);
  });

  test("a signed-in list response is no more generous than the anonymous one", async () => {
    const { token } = await bootstrapCouple("catalogue-scope@test.test");
    const r = await req<{ suppliers: DirectorySupplier[] }>(
      "GET",
      "/api/suppliers?country=all",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    const leaked = r.data.suppliers.filter(
      (s) => s.contact_email !== null || s.contact_phone !== null,
    );
    expect(leaked.map((s) => s.id)).toEqual([]);
  });

  test("the flags still say a contact exists, so the UI can offer to call", async () => {
    const seeded = contactableListing();
    const r = await req<{ suppliers: DirectorySupplier[] }>("GET", "/api/suppliers?country=all");
    const row = r.data.suppliers.find((s) => s.id === seeded.id);
    expect(row).toBeDefined();
    expect(row?.has_contact_email).toBe(true);
    expect(row?.has_contact_phone).toBe(true);
    expect(row?.contact_email).toBeNull();
    expect(row?.contact_phone).toBeNull();
  });
});

describe("the contact endpoint is the only way to the phone", () => {
  test("anonymous callers are refused", async () => {
    const seeded = contactableListing();
    const r = await req("GET", `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`);
    expect(r.status).toBe(401);
  });

  test("a signed-in couple gets the phone, one listing at a time, and never the email", async () => {
    const seeded = contactableListing();
    const { token } = await bootstrapCouple("contact-reveal@test.test");
    const r = await req<SupplierContact>(
      "GET",
      `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.contact_phone).toBe(seeded.phone);
    // The mailbox has no reveal at all. Signing in used to buy it; it now buys
    // the phone and nothing else, so the address book cannot be walked one
    // rate-limited request at a time either.
    expect(r.data.contact_email).toBeNull();
  });

  test("an unknown listing is a 404, not an empty contact", async () => {
    const { token } = await bootstrapCouple("contact-404@test.test");
    const r = await req("GET", "/api/suppliers/no-such-listing-at-all/contact", undefined, {
      token,
    });
    expect(r.status).toBe(404);
  });
});

describe("a vendor's email address has no door at all", () => {
  /** Every couple-facing read of one listing, in the order a curious user would
   *  try them. Each must come back without the address anywhere in the body —
   *  not masked, not nested, not on a related object. */
  async function bodiesFor(id: string, token: string): Promise<string[]> {
    const paths = [
      `/api/suppliers/${encodeURIComponent(id)}`,
      `/api/suppliers/${encodeURIComponent(id)}/contact`,
      `/api/public/vendors/${encodeURIComponent(id)}`,
      "/api/suppliers?country=all",
    ];
    const out: string[] = [];
    for (const path of paths) {
      const signedIn = await req("GET", path, undefined, { token });
      const anonymous = await req("GET", path);
      out.push(JSON.stringify(signedIn.data), JSON.stringify(anonymous.data));
    }
    return out;
  }

  test("no couple-facing read of a listing contains its email, signed in or not", async () => {
    const seeded = contactableListing();
    const { token } = await bootstrapCouple("email-never@test.test");

    for (const body of await bodiesFor(seeded.id, token)) {
      expect(body).not.toContain(seeded.email);
      // Nor the masked teaser it used to carry: two real characters plus the
      // domain is still enough to guess a mailbox at a small business.
      expect(body).not.toContain(seeded.email.slice(seeded.email.indexOf("@")));
    }
  });

  test("the flag still says the channel is deliverable", async () => {
    const seeded = contactableListing();
    const { token } = await bootstrapCouple("email-flag@test.test");
    const r = await req<DirectorySupplier>(
      "GET",
      `/api/suppliers/${encodeURIComponent(seeded.id)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    // "There is a mailbox here" is what lets the UI offer to write; the
    // characters stay on the server, which is the whole distinction.
    expect(r.data.has_contact_email).toBe(true);
    expect(r.data.contact_email).toBeNull();
  });

  /** The four reads above were closed on 2026-07-31 and the outreach inbox was
   *  not, so writing to a vendor was itself the door: the sent-history payload
   *  echoed `supplier_email` back for every recipient, five per campaign, for as
   *  many campaigns as a couple cared to send. The address is still stored (it
   *  is the record of where the mail went) and still mailed server-side; it just
   *  no longer travels to the client. */
  describe("and writing to a vendor is not a door either", () => {
    async function sendCampaignTo(id: string, token: string): Promise<unknown> {
      const r = await req<{ id: number }>(
        "POST",
        "/api/outreach/campaigns",
        {
          subject: "Are you free on 14 June 2027?",
          body_template: "We are getting married on 14 June 2027. Do you have the date?",
          supplier_ids: [id],
        },
        { token },
      );
      expect(r.status).toBe(201);
      return r.data;
    }

    test("neither the send response nor the sent history carries the address", async () => {
      const seeded = contactableListing();
      const { token } = await bootstrapCouple("outreach-no-door@test.test");

      const created = await sendCampaignTo(seeded.id, token);
      const list = await req("GET", "/api/outreach/campaigns", undefined, { token });
      const detail = await req(
        "GET",
        `/api/outreach/campaigns/${(created as { id: number }).id}`,
        undefined,
        { token },
      );

      for (const body of [created, list.data, detail.data]) {
        expect(JSON.stringify(body)).not.toContain(seeded.email);
      }
    });

    test("the recipient row still says WHERE it landed", async () => {
      const seeded = contactableListing();
      const { token } = await bootstrapCouple("outreach-delivery@test.test");
      const created = (await sendCampaignTo(seeded.id, token)) as {
        messages: Array<{ delivery: string; supplier_name: string }>;
      };
      // Losing the address must not cost the couple the one fact they can act
      // on: an unclaimed curated listing was mailed and nothing more.
      expect(created.messages[0]?.delivery).toBe("email_only");
      expect(created.messages[0]?.supplier_name).toBeTruthy();
    });
  });
});

describe("one quota covers both doors to a contact", () => {
  test("detail reads spend the same allowance as contact reads", async () => {
    const seeded = contactableListing();
    const { token } = await bootstrapCouple("contact-quota@test.test");

    // Drain the bucket through the DETAIL endpoint...
    let sawLimit = false;
    for (let i = 0; i < 70; i++) {
      const r = await req("GET", `/api/suppliers/${encodeURIComponent(seeded.id)}`, undefined, {
        token,
      });
      if (r.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);

    // ...and the contact endpoint is out too, because the allowance is shared.
    // Alternating between the two used to be the cheap way around a per-endpoint
    // limit.
    const after = await req(
      "GET",
      `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`,
      undefined,
      { token },
    );
    expect(after.status).toBe(429);
  });

  test("a second couple is unaffected: the quota is per user, not global", async () => {
    const seeded = contactableListing();
    const { token: heavy } = await bootstrapCouple("quota-heavy@test.test");
    for (let i = 0; i < 70; i++) {
      const r = await req("GET", `/api/suppliers/${encodeURIComponent(seeded.id)}`, undefined, {
        token: heavy,
      });
      if (r.status === 429) break;
    }

    const { token: fresh } = await bootstrapCouple("quota-fresh@test.test");
    const r = await req<SupplierContact>(
      "GET",
      `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`,
      undefined,
      { token: fresh },
    );
    expect(r.status).toBe(200);
    expect(r.data.contact_phone).toBe(seeded.phone);
  });
});
