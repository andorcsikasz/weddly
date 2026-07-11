// Vendor dashboard / stats — GET /api/vendor/stats.
//
// Pairs with backend/src/routes/vendor_stats.ts + buildVendorStats in
// backend/src/domain/vendor_clients.ts. Bootstraps a real claimed vendor the
// same way vendor_availability.e2e.test.ts does (community submit → verify →
// admin approve → claim start/verify/complete), then drives bookings through
// the admin inquiry endpoints to assert the rollup: inquiry counts, status
// breakdown, upcoming confirmed events, blocked-date count, listing
// completeness, and tracked revenue (sum of recorded deposits).

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorStats } from "@shared/vendor_clients";

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

/** Create a Weddly-sourced inquiry (booking) against the vendor's listing via
 *  the admin endpoint, returning the new booking id. */
async function createInquiry(
  adminToken: string,
  listingId: string,
  coupleId: number,
  eventDate: string,
): Promise<number> {
  const r = await req<{ id: number }>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

describe("vendor stats — GET /api/vendor/stats", () => {
  test("fresh vendor: zeroed counts, partial listing completeness, billing present", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("stats-empty");

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.inquiries_total).toBe(0);
    expect(r.data.inquiries_30d).toBe(0);
    expect(r.data.by_status).toEqual({});
    expect(r.data.upcoming).toEqual([]);
    expect(r.data.inquiries_by_day).toEqual([]);
    expect(r.data.blocked_dates_count).toBe(0);
    expect(r.data.revenue_tracked).toBe(0);
    // The bootstrap card has blurb + contact_email + price_band filled, but no
    // capacity and no hero image: 3 of 5 buckets = 60%.
    expect(r.data.listing_completeness).toBe(60);
    expect(["HUF", "EUR"]).toContain(r.data.currency);
    expect(r.data.billing).toBeTruthy();
    expect(r.data.currency).toBe(r.data.billing.currency);
  });

  test("bookings roll up into counts, status breakdown, upcoming, and tracked revenue", async () => {
    wipeAll();
    const { vendorToken, listingId } = await bootstrapVendor("stats-roll");
    const adminToken = await registerAdminAndGetToken();
    const { coupleId } = await bootstrapCouple("couple-stats@weddly.test");

    // Two future inquiries; confirm the first, leave the second requested.
    const confirmedId = await createInquiry(adminToken, listingId, coupleId, "2030-06-15");
    await createInquiry(adminToken, listingId, coupleId, "2031-01-01");

    const patch = await req(
      "PATCH",
      `/api/bookings/${confirmedId}`,
      { status: "confirmed" },
      { token: adminToken },
    );
    expect(patch.status).toBe(200);

    // Record a deposit on the confirmed client via the FREE vendor-clients
    // PATCH surface — tracked revenue sums recorded deposits.
    const clientPatch = await req(
      "PATCH",
      `/api/vendor/clients/${confirmedId}`,
      { contract_value: 200_000, deposit_paid: 50_000 },
      { token: vendorToken },
    );
    expect(clientPatch.status).toBe(200);

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.inquiries_total).toBe(2);
    expect(r.data.inquiries_30d).toBe(2);
    expect(r.data.by_status).toEqual({ confirmed: 1, requested: 1 });
    expect(r.data.revenue_tracked).toBe(50_000);

    // Both inquiries were created "now", so the daily series carries a single
    // bucket for today (UTC) with count 2.
    const today = new Date().toISOString().slice(0, 10);
    expect(r.data.inquiries_by_day).toEqual([{ date: today, count: 2 }]);

    // Only the confirmed future booking is "upcoming".
    expect(r.data.upcoming.length).toBe(1);
    expect(r.data.upcoming[0]?.id).toBe(confirmedId);
    expect(r.data.upcoming[0]?.event_date).toBe("2030-06-15");
    expect(r.data.upcoming[0]?.couple_display_name).toBe("Mia & Lucas");
  });

  test("blocked dates feed blocked_dates_count", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("stats-blocked");

    const block = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "2030-07-04" },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.blocked_dates_count).toBe(1);
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anon = await req("GET", "/api/vendor/stats");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-stats@weddly.test");
    const couple = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/stats",
      undefined,
      {
        token,
      },
    );
    expect(couple.status).toBe(403);
    expect(couple.data.detail?.code).toBe("vendor_role_required");
  });
});
