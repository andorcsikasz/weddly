// The directory's contact book is the asset, and until this landed one
// unauthenticated `GET /api/suppliers` handed it over whole: 1022 listings, 503
// email addresses and 538 phone numbers in a single response, no session, no
// quota. These tests pin the shape that replaced it.
//
//   1. The catalogue says WHETHER a listing has a contact, never what it is.
//   2. The value comes from `/api/suppliers/:id/contact`, one listing per
//      request, session required.
//   3. That endpoint and the detail endpoint draw on ONE per-user quota, so
//      alternating between them buys nothing.
//   4. An anonymous visitor gets a masked teaser on the public page and no way
//      to ask for more.
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

describe("the contact endpoint is the only way to the values", () => {
  test("anonymous callers are refused", async () => {
    const seeded = contactableListing();
    const r = await req("GET", `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`);
    expect(r.status).toBe(401);
  });

  test("a signed-in couple gets the real email and phone, one listing at a time", async () => {
    const seeded = contactableListing();
    const { token } = await bootstrapCouple("contact-reveal@test.test");
    const r = await req<SupplierContact>(
      "GET",
      `/api/suppliers/${encodeURIComponent(seeded.id)}/contact`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.contact_email).toBe(seeded.email);
    expect(r.data.contact_phone).toBe(seeded.phone);
  });

  test("an unknown listing is a 404, not an empty contact", async () => {
    const { token } = await bootstrapCouple("contact-404@test.test");
    const r = await req("GET", "/api/suppliers/no-such-listing-at-all/contact", undefined, {
      token,
    });
    expect(r.status).toBe(404);
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
    expect(r.data.contact_email).toBe(seeded.email);
  });
});
