// Vendor recurring weekly availability pattern + two-directional per-date
// exceptions.
//
// Before this, availability was a single flat list of blocked days and
// "available" was merely the absence of a block — so a vendor who only works
// weekends had to block ~200 weekdays a year by hand. There are now two layers:
// the weekly pattern (which weekdays they work at all) and per-date exceptions
// ON TOP, in both directions.
//
// Resolution order lives in shared/vendor_availability.ts and is asserted here
// through the real endpoints, including the couple-facing payload — the whole
// point is that the vendor calendar and the public busy calendar can't disagree.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { SupplierAvailability } from "@shared/suppliers";
import type { VendorAvailabilitySettings } from "@shared/vendor_availability";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function bootstrapVendor(slug: string): Promise<{
  vendorToken: string;
  listingId: string;
  accountId: number;
  /** A couple session, for reading the couple-facing availability payload. */
  coupleToken: string;
}> {
  const { token } = await bootstrapCouple(`owner-${slug}@weddly.test`);
  const contactEmail = `vendor-${slug}@weddly.test`;
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name: `${slug} Studio`,
      city: "Budapest",
      address: null,
      website: `https://${slug}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${slug} blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const numericId = Number(submit.data.supplier.id.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as ClaimRow | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: adminToken });
  const listingId = `c${numericId}`;

  await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as ClaimRow | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: `Vendor ${slug}`,
  });
  expect(complete.status).toBe(201);

  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  initVendorBilling(acct.id, "EUR");
  return { vendorToken: complete.data.token, listingId, accountId: acct.id, coupleToken: token };
}

function getPattern(token: string): Promise<{ status: number; data: VendorAvailabilitySettings }> {
  return req<VendorAvailabilitySettings>("GET", "/api/vendor/availability/me/pattern", undefined, {
    token,
  });
}

function putPattern(
  token: string,
  weekdays: number[] | null,
): Promise<{ status: number; data: VendorAvailabilitySettings }> {
  return req<VendorAvailabilitySettings>(
    "PUT",
    "/api/vendor/availability/me/pattern",
    { weekdays },
    { token },
  );
}

/** The couple-facing availability payload. Auth-required (couples browse it
 *  signed in), so it takes a session token. */
function publicAvailability(
  listingId: string,
  token: string,
): Promise<{ status: number; data: SupplierAvailability }> {
  return req<SupplierAvailability>(
    "GET",
    `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
    undefined,
    { token },
  );
}

describe("vendor availability — weekly pattern", () => {
  test("defaults to null (every day), preserving the pre-pattern behaviour", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-default");

    const r = await getPattern(vendorToken);
    expect(r.status).toBe(200);
    expect(r.data.weekdays).toBe(null);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.status).toBe(200);
    expect(pub.data.available_weekdays).toBe(null);
    // With no pattern and no blocks, the next free date is today.
    expect(pub.data.next_available).toBeTruthy();
  });

  test("round-trips a partial week and surfaces it on the public payload", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-weekend");

    // Fri/Sat/Sun only.
    const put = await putPattern(vendorToken, [5, 6, 7]);
    expect(put.status).toBe(200);
    expect(put.data.weekdays).toEqual([5, 6, 7]);

    expect((await getPattern(vendorToken)).data.weekdays).toEqual([5, 6, 7]);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.available_weekdays).toEqual([5, 6, 7]);
  });

  test("a full week, an empty set and junk all collapse to null", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("pat-collapse");

    // All seven days IS "every day" — stored as null so there's one
    // representation of the unrestricted case.
    expect((await putPattern(vendorToken, [1, 2, 3, 4, 5, 6, 7])).data.weekdays).toBe(null);
    // An empty set would mean "never available", which would silently hide the
    // listing from every search. Treated as unset instead.
    expect((await putPattern(vendorToken, [])).data.weekdays).toBe(null);
    // Out-of-range / non-integer values are filtered, not 400'd.
    const junk = await req<VendorAvailabilitySettings>(
      "PUT",
      "/api/vendor/availability/me/pattern",
      { weekdays: [0, 9, "x", 3.5, 6] },
      { token: vendorToken },
    );
    expect(junk.status).toBe(200);
    expect(junk.data.weekdays).toEqual([6]);
  });

  test("next_available skips weekdays outside the pattern", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-next");

    // Sundays only — whatever today is, the next free date must be a Sunday.
    await putPattern(vendorToken, [7]);
    const pub = await publicAvailability(listingId, coupleToken);
    const next = pub.data.next_available;
    expect(next).toBeTruthy();
    const weekday = new Date(`${next as string}T00:00:00Z`).getUTCDay();
    expect(weekday).toBe(0); // 0 = Sunday
  });

  test("an exceptional 'available' day overrides the pattern", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-exception");

    // Sundays only, then open one specific Monday.
    await putPattern(vendorToken, [7]);
    // 2030-06-03 is a Monday.
    const monday = "2030-06-03";
    expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);

    const open = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, available: true },
      { token: vendorToken },
    );
    expect(open.status).toBe(201);

    // It must NOT read as a block anywhere couples look.
    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.unavailable_dates).not.toContain(monday);
    expect(pub.data.partial_dates).not.toContain(monday);

    // And the row really is stored as the available direction.
    const row = db
      .prepare("SELECT is_available FROM vendor_unavailable_dates WHERE blocked_date = ? LIMIT 1")
      .get(monday) as { is_available: number } | undefined;
    expect(row?.is_available).toBe(1);
  });

  test("blocking still works on a pattern day, and the two directions replace each other", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-both");
    await putPattern(vendorToken, [7]);
    const monday = "2030-06-03";

    // Open it exceptionally...
    await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, available: true },
      { token: vendorToken },
    );
    // ...then block it again. The upsert must flip the direction, not stack.
    const block = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);

    const rows = db
      .prepare("SELECT is_available FROM vendor_unavailable_dates WHERE blocked_date = ?")
      .all(monday) as Array<{ is_available: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.is_available).toBe(0);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.unavailable_dates).toContain(monday);
  });

  test("pattern changes require a vendor session", async () => {
    wipeAll();
    const anon = await req("PUT", "/api/vendor/availability/me/pattern", { weekdays: [1] });
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-pattern@weddly.test");
    const couple = await req(
      "PUT",
      "/api/vendor/availability/me/pattern",
      { weekdays: [1] },
      { token },
    );
    expect(couple.status).toBe(403);
  });
});
