// Vendor dashboard / stats — GET /api/vendor/stats.
//
// Pairs with backend/src/routes/vendor_stats.ts + buildVendorStats in
// backend/src/domain/vendor_clients.ts. Bootstraps a real claimed vendor the
// same way vendor_availability.e2e.test.ts does (community submit → verify →
// admin approve → claim start/verify/complete), then drives bookings through
// the admin inquiry endpoints to assert the rollup: inquiry counts, status
// breakdown, upcoming confirmed events, blocked-date count, listing
// completeness, tracked revenue (sum of recorded deposits), and the profile-view
// counters the vendor's own funnel is built on.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorStats } from "@shared/vendor_clients";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
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
  category = "photography",
): Promise<{ listingId: string }> {
  const { token } = await bootstrapCouple(ownerEmail);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category,
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

/** Bootstrap a claimed vendor and return their session token + listing id.
 *  Defaults to a photography listing; pass a category to exercise the
 *  category-dependent parts of the payload (the capacity checklist step). */
async function bootstrapVendor(
  slug: string,
  category = "photography",
): Promise<{ vendorToken: string; listingId: string }> {
  const { listingId } = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    `vendor-${slug}@weddly.test`,
    `${slug} Studio`,
    category,
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
    expect(r.data.reviews_recent).toBe(0);
    expect(r.data.revenue_tracked).toBe(0);
    // The bootstrap card has blurb + contact_email + price_band filled, but no
    // hero image, no gallery and no packages. This is a PHOTOGRAPHY listing, so
    // the capacity step is dropped entirely (a photographer has no guest
    // capacity) and the denominator is 6, not 7: 3 of 6 steps = 50%.
    expect(r.data.listing_completeness).toBe(50);
    // The checklist is the source the percent is derived from, so it must agree.
    expect(r.data.listing_steps.map((s) => s.key)).toEqual([
      "cover",
      "gallery",
      "description",
      "contact",
      "pricing",
      "packages",
    ]);
    expect(r.data.listing_steps.filter((s) => s.done).map((s) => s.key)).toEqual([
      "description",
      "contact",
      "pricing",
    ]);
    expect(["HUF", "EUR"]).toContain(r.data.currency);
    expect(r.data.billing).toBeTruthy();
    expect(r.data.currency).toBe(r.data.billing.currency);
  });

  test("capacity is a checklist step only for categories that have a guest count", async () => {
    wipeAll();
    const venue = await bootstrapVendor("stats-venue", "venue");
    const venueStats = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: venue.vendorToken,
    });
    expect(venueStats.status).toBe(200);
    // Same filled fields as the photographer above, but a venue DOES have a
    // capacity, so the step is present and unfinished: 3 of 7 = 43%.
    expect(venueStats.data.listing_steps.map((s) => s.key)).toContain("capacity");
    expect(venueStats.data.listing_steps).toHaveLength(7);
    expect(venueStats.data.listing_completeness).toBe(43);

    // A caterer serves N guests, so it keeps the step too.
    wipeAll();
    const caterer = await bootstrapVendor("stats-catering", "catering");
    const catererStats = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: caterer.vendorToken,
    });
    expect(catererStats.data.listing_steps.map((s) => s.key)).toContain("capacity");

    // A florist does not, and must be able to reach 100% without it.
    wipeAll();
    const florist = await bootstrapVendor("stats-florist", "florist");
    const floristStats = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: florist.vendorToken,
    });
    expect(floristStats.data.listing_steps.map((s) => s.key)).not.toContain("capacity");
    expect(floristStats.data.listing_steps).toHaveLength(6);
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

  test("reviews_recent counts only published, undeleted reviews from the last 30 days", async () => {
    wipeAll();
    const { vendorToken, listingId } = await bootstrapVendor("stats-reviews");
    await bootstrapCouple("reviewer-stats@weddly.test");
    // supplier_reviews.author_user_id is a real FK, so grab the couple owner's
    // row rather than inventing an id.
    const author = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("reviewer-stats@weddly.test") as { id: number } | undefined;
    if (!author) throw new Error("expected the couple owner to exist");
    const userId = author.id;

    // Reviews are written straight to the table: the public POST path enforces
    // one-per-couple-per-supplier plus moderation, and this test is about the
    // ROLLUP, not that gate. Four rows, only the first of which should count.
    const nowMs = Date.now();
    const thirtyOneDaysAgo = nowMs - 31 * 86_400_000;
    const insert = db.prepare(
      `INSERT INTO supplier_reviews
         (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(listingId, userId, 5, "recent + published", 1, nowMs, nowMs, null);
    insert.run(listingId, userId, 4, "unpublished", 0, nowMs, nowMs, null);
    insert.run(listingId, userId, 3, "too old", 1, thirtyOneDaysAgo, thirtyOneDaysAgo, null);
    insert.run(listingId, userId, 2, "soft-deleted", 1, nowMs, nowMs, nowMs);

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.reviews_recent).toBe(1);
  });

  test("views count profile opens only, scoped to the vendor's own listings", async () => {
    wipeAll();
    const mine = await bootstrapVendor("stats-views");
    // A second claimed listing nobody should be credited for.
    const { listingId: otherListing } = await makeApprovedListing(
      "owner-stats-views-other@weddly.test",
      "vendor-stats-views-other@weddly.test",
      "Other Studio",
    );

    // Two profile opens on my listing, plus the noise that must NOT count:
    // a directory-list impression, and a view on someone else's card.
    const ingest = await req<{ recorded: number }>("POST", "/api/suppliers/events", {
      events: [
        { supplier_id: mine.listingId, type: "view" },
        { supplier_id: mine.listingId, type: "view" },
        { supplier_id: mine.listingId, type: "impression" },
        { supplier_id: mine.listingId, type: "impression" },
        { supplier_id: otherListing, type: "view" },
      ],
    });
    expect(ingest.status).toBe(200);
    expect(ingest.data.recorded).toBe(5);

    // One more view, backdated past both trailing windows. Written straight to
    // the table because the ingest always stamps "now".
    db.prepare(
      `INSERT INTO supplier_events (supplier_id, event_type, user_id, couple_id, created_at)
       VALUES (?, 'view', NULL, NULL, ?)`,
    ).run(mine.listingId, Date.now() - 40 * 86_400_000);

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: mine.vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.views_total).toBe(3);
    expect(r.data.views_30d).toBe(2);
    expect(r.data.views_7d).toBe(2);
  });

  test("the vendor's own visits to their own listing never count", async () => {
    wipeAll();
    const mine = await bootstrapVendor("stats-selfview");
    const other = await makeApprovedListing(
      "owner-stats-selfview-other@weddly.test",
      "vendor-stats-selfview-other@weddly.test",
      "Rival Studio",
    );

    // What the preview link does: the vendor opens their live page while
    // signed in, so the ingest carries their token.
    const self = await req<{ recorded: number }>(
      "POST",
      "/api/suppliers/events",
      {
        events: [
          { supplier_id: mine.listingId, type: "view" },
          { supplier_id: mine.listingId, type: "website_click" },
          // Someone else's card in the same batch still counts: only the
          // vendor's OWN listings are suppressed, not their whole session.
          { supplier_id: other.listingId, type: "view" },
        ],
      },
      { token: mine.vendorToken },
    );
    expect(self.status).toBe(200);
    expect(self.data.recorded).toBe(1);

    // A visitor viewing the same listing is unaffected.
    const visitor = await req<{ recorded: number }>("POST", "/api/suppliers/events", {
      events: [{ supplier_id: mine.listingId, type: "view" }],
    });
    expect(visitor.data.recorded).toBe(1);

    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: mine.vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.views_total).toBe(1);
    expect(r.data.views_30d).toBe(1);
  });

  test("a vendor with no events at all reports zero views", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("stats-views-empty");
    const r = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.views_total).toBe(0);
    expect(r.data.views_30d).toBe(0);
    expect(r.data.views_7d).toBe(0);
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
