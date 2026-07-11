// Vendor self-serve availability — a claimed vendor blocks/unblocks the days
// they're already booked, and couples see those on the public busy calendar.
//
// Pairs with backend/src/routes/vendor_availability.ts. Bootstraps a real
// vendor the same way vendor_listing.e2e.test.ts does: community submit →
// verify → admin approve → claim start/verify/complete.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorAvailabilityView } from "@shared/listings";
import type { SupplierAvailability } from "@shared/suppliers";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<{ listingId: string }> {
  const { token } = await bootstrapCouple(ownerEmail);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name,
      city: "Budapest",
      address: null,
      website: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${name} — original blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;
  const numericId = Number(publicId.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as { token: string } | undefined;
  expect(vtok).toBeTruthy();
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  const approve = await req(
    "POST",
    `/api/admin/suppliers/${numericId}/approve`,
    {},
    { token: adminToken },
  );
  expect(approve.status).toBe(200);
  return { listingId: publicId };
}

async function claimListing(
  listingId: string,
  contactEmail: string,
  fullName: string,
): Promise<{ vendorToken: string; listingId: string }> {
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as ClaimRow | undefined;
  expect(claim).toBeTruthy();
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: fullName,
  });
  expect(complete.status).toBe(201);
  return { vendorToken: complete.data.token, listingId };
}

/** Bootstrap a claimed vendor and return their session token + listing id. */
async function bootstrapVendor(slug: string): Promise<{ vendorToken: string; listingId: string }> {
  const { listingId } = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    `vendor-${slug}@weddly.test`,
    `${slug} Studio`,
  );
  return claimListing(listingId, `vendor-${slug}@weddly.test`, `Vendor ${slug}`);
}

describe("vendor availability — GET/POST/DELETE /api/vendor/availability/me", () => {
  test("fresh vendor starts with no blocked dates", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("avail-empty");
    const r = await req<VendorAvailabilityView>("GET", "/api/vendor/availability/me", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.blocked_dates).toEqual([]);
    // A claimed vendor with nothing booked is free today.
    expect(r.data.next_available).not.toBeNull();
  });

  test("block then unblock a future date round-trips", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("avail-rt");

    const block = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-06-15", reason: "Already booked" },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);
    expect(block.data.blocked_dates).toContain("2030-06-15");

    // Idempotent: re-blocking the same day doesn't duplicate it.
    const again = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-06-15" },
      { token: vendorToken },
    );
    expect(again.status).toBe(201);
    expect(again.data.blocked_dates.filter((d) => d === "2030-06-15").length).toBe(1);

    const unblock = await req<VendorAvailabilityView>(
      "DELETE",
      "/api/vendor/availability/me?date=2030-06-15",
      undefined,
      { token: vendorToken },
    );
    expect(unblock.status).toBe(200);
    expect(unblock.data.blocked_dates).not.toContain("2030-06-15");
  });

  test("a vendor's blocked date surfaces on the public busy calendar", async () => {
    wipeAll();
    const { vendorToken, listingId } = await bootstrapVendor("avail-public");
    await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-07-04" },
      { token: vendorToken },
    );

    // A couple reads the public availability endpoint and sees the block.
    const { token: coupleToken } = await bootstrapCouple("couple-sees@weddly.test");
    const pub = await req<SupplierAvailability>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(pub.status).toBe(200);
    expect(pub.data.bookable).toBe(true);
    expect(pub.data.unavailable_dates).toContain("2030-07-04");
  });

  test("partial-hour block: off the couple busy calendar but flagged as partial", async () => {
    wipeAll();
    const { vendorToken, listingId } = await bootstrapVendor("avail-partial");

    const block = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-08-05", hours: [9, 10, 11, 12] },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);
    // The vendor view carries the hour detail...
    expect(block.data.blocked_days.find((d) => d.date === "2030-08-05")?.hours).toEqual([
      9, 10, 11, 12,
    ]);
    // ...and the date still shows in the flat blocked_dates list (chip surfaces).
    expect(block.data.blocked_dates).toContain("2030-08-05");

    // Couples: a partial day is NOT fully booked — it lands in partial_dates,
    // stays off unavailable_dates, and the listing stays bookable.
    const { token: coupleToken } = await bootstrapCouple("couple-partial@weddly.test");
    const pub = await req<SupplierAvailability>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(pub.status).toBe(200);
    expect(pub.data.bookable).toBe(true);
    expect(pub.data.unavailable_dates).not.toContain("2030-08-05");
    expect(pub.data.partial_dates).toContain("2030-08-05");
  });

  test("re-blocking a day upserts between whole-day and partial", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("avail-upsert");

    // Whole day first → hours is null.
    const full = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-09-04" },
      { token: vendorToken },
    );
    expect(full.data.blocked_days.find((d) => d.date === "2030-09-04")?.hours).toBeNull();

    // Re-block the same day with hours → switches to partial, no duplicate row.
    const partial = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-09-04", hours: [14, 15] },
      { token: vendorToken },
    );
    expect(partial.data.blocked_days.filter((d) => d.date === "2030-09-04").length).toBe(1);
    expect(partial.data.blocked_days.find((d) => d.date === "2030-09-04")?.hours).toEqual([14, 15]);

    // Empty hours → back to a whole-day block.
    const backToFull = await req<VendorAvailabilityView>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-09-04", hours: [] },
      { token: vendorToken },
    );
    expect(backToFull.data.blocked_days.find((d) => d.date === "2030-09-04")?.hours).toBeNull();
  });

  test("rejects out-of-range or non-integer hours", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("avail-badhours");

    for (const hours of [[24], [-1], [9.5], ["x"], "nope"]) {
      const r = await req(
        "POST",
        "/api/vendor/availability/me",
        { date: "2030-10-01", hours },
        { token: vendorToken },
      );
      expect(r.status).toBe(400);
    }
  });

  test("rejects a past date and a malformed date", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("avail-bad");

    const past = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "2020-01-01" },
      { token: vendorToken },
    );
    expect(past.status).toBe(400);

    const bad = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "not-a-date" },
      { token: vendorToken },
    );
    expect(bad.status).toBe(400);
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anon = await req("GET", "/api/vendor/availability/me");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor@weddly.test");
    const couple = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-06-15" },
      { token },
    );
    expect(couple.status).toBe(403);
    expect(couple.data.detail?.code).toBe("vendor_role_required");
  });
});
