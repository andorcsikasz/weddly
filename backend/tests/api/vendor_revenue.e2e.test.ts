// Revenue Pulse: the forward-looking half of a vendor's money.
//
// Two suites in one file on purpose. The ARITHMETIC is a pure function over
// flat facts (`shared/vendor_revenue.ts`), so it is asserted directly with no
// database, no server and no clock: that is where every invariant worth having
// lives, and a test that needs a claimed vendor to prove that 20% of 2000 is
// 400 is a test nobody will keep passing. The ENDPOINT suite then proves the
// gathering half wires the real columns to that function and that the PRO gate
// bites, which is all the HTTP layer actually does.
//
// Pairs with backend/src/routes/vendor_revenue.ts +
// backend/src/domain/vendor_revenue.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  bootstrapCouple,
  enableBillingEnforcement,
  registerAndVerify,
  req,
  wipeAll,
} from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorRevenueFact, VendorRevenuePulseView } from "@shared/vendor_revenue";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import {
  isPipelineStatus,
  isRevenuePulseEmpty,
  PIPELINE_PROBABILITY,
  REVENUE_TRAILING_DAYS,
  vendorRevenuePulse,
} from "@shared/vendor_revenue";

// ── The pure module ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** A fixed noon so nothing here depends on when the suite runs. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function isoInDays(days: number): string {
  return new Date(NOW + days * DAY_MS).toISOString().slice(0, 10);
}

/** A confirmed booking a week from now, with nothing recorded on it. Every case
 *  below overrides only the fields it is about. */
function fact(over: Partial<VendorRevenueFact> = {}): VendorRevenueFact {
  return {
    status: "confirmed",
    contract_value: null,
    deposit_paid: null,
    event_date: isoInDays(7),
    created_at: NOW - DAY_MS,
    ...over,
  };
}

describe("revenue pulse: the arithmetic (no database)", () => {
  test("an empty book is empty, not a wall of zeroes pretending to be analysis", () => {
    const p = vendorRevenuePulse([], NOW);
    expect(p.booked).toBe(0);
    expect(p.pipeline).toBe(0);
    expect(p.weighted).toBe(0);
    expect(p.average_booking_value).toBeNull();
    expect(p.win_rate).toBeNull();
    expect(isRevenuePulseEmpty(p)).toBe(true);
  });

  test("pipeline counts only OPEN leads that have a recorded value", () => {
    const p = vendorRevenuePulse(
      [
        fact({ status: "requested", contract_value: 2000 }),
        fact({ status: "vendor_seen", contract_value: 1000 }),
        // Confirmed is won, not pipeline.
        fact({ status: "confirmed", contract_value: 5000 }),
      ],
      NOW,
    );
    expect(p.pipeline).toBe(3000);
    expect(p.booked).toBe(5000);
    expect(p.pipeline_unpriced).toBe(0);
  });

  test("a lead with no recorded value is EXCLUDED and counted, never guessed at", () => {
    const p = vendorRevenuePulse(
      [
        fact({ status: "requested", contract_value: 2000 }),
        fact({ status: "requested", contract_value: null }),
        fact({ status: "vendor_seen", contract_value: null }),
      ],
      NOW,
    );
    // The two unpriced leads contribute NOTHING to the money, not an average
    // and not a band midpoint. They are reported as a count instead, which is
    // what makes the 2000 readable rather than quietly understated.
    expect(p.pipeline).toBe(2000);
    expect(p.pipeline_unpriced).toBe(2);
    // The same honesty on the won side.
    const withUnpricedBooking = vendorRevenuePulse(
      [fact({ status: "confirmed", contract_value: null, deposit_paid: 400 })],
      NOW,
    );
    expect(withUnpricedBooking.booked).toBe(0);
    expect(withUnpricedBooking.booked_unpriced).toBe(1);
    expect(withUnpricedBooking.collected).toBe(400);
  });

  test("weighted is strictly below pipeline, and is the named constants applied", () => {
    const facts = [
      fact({ status: "requested", contract_value: 2000 }),
      fact({ status: "vendor_seen", contract_value: 1000 }),
    ];
    const p = vendorRevenuePulse(facts, NOW);
    const expected = Math.round(
      2000 * (PIPELINE_PROBABILITY.requested ?? 0) + 1000 * (PIPELINE_PROBABILITY.vendor_seen ?? 0),
    );
    expect(p.weighted).toBe(expected);
    expect(p.weighted).toBeLessThan(p.pipeline);
    // Every probability is a real discount, or "weighted" would be a second
    // name for "pipeline" and the estimate badge would be a lie.
    for (const value of Object.values(PIPELINE_PROBABILITY)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
    // An opened lead is worth more than an untouched one: the vendor has been
    // in the conversation.
    expect(PIPELINE_PROBABILITY.vendor_seen ?? 0).toBeGreaterThan(
      PIPELINE_PROBABILITY.requested ?? 0,
    );
    // The probability map IS the definition of "open", so the two can't drift.
    expect(isPipelineStatus("requested")).toBe(true);
    expect(isPipelineStatus("confirmed")).toBe(false);
    expect(isPipelineStatus("declined")).toBe(false);
  });

  test("archived statuses contribute nothing to any figure", () => {
    for (const status of ["declined", "cancelled", "expired"]) {
      const p = vendorRevenuePulse(
        [fact({ status, contract_value: 9000, deposit_paid: 3000, event_date: isoInDays(5) })],
        NOW,
      );
      expect(p.booked).toBe(0);
      expect(p.pipeline).toBe(0);
      expect(p.weighted).toBe(0);
      // Not to `collected` either: a deposit on a dead booking was very likely
      // refunded, and it is certainly not part of a live book of business.
      expect(p.collected).toBe(0);
      expect(p.outstanding).toBe(0);
      expect(p.upcoming_30).toBe(0);
      expect(p.pipeline_unpriced).toBe(0);
      expect(p.booked_unpriced).toBe(0);
      // It IS a decided lead, so it still counts against the win rate.
      expect(p.decided_count).toBe(1);
      expect(p.win_rate).toBe(0);
    }
  });

  test("an unknown status is not an invitation to guess at money", () => {
    const p = vendorRevenuePulse([fact({ status: "negotiating", contract_value: 4000 })], NOW);
    expect(p.pipeline).toBe(0);
    expect(p.booked).toBe(0);
    expect(p.pipeline_unpriced).toBe(0);
    expect(p.decided_count).toBe(0);
  });

  test("collected matches the recorded deposits, and outstanding is the rest", () => {
    const p = vendorRevenuePulse(
      [
        fact({ status: "confirmed", contract_value: 3000, deposit_paid: 1000 }),
        fact({ status: "confirmed", contract_value: 2000, deposit_paid: 500 }),
        fact({ status: "confirmed", contract_value: 1000, deposit_paid: null }),
      ],
      NOW,
    );
    expect(p.booked).toBe(6000);
    expect(p.collected).toBe(1500);
    expect(p.outstanding).toBe(4500);
  });

  test("outstanding never goes negative when a deposit overshoots the contract", () => {
    const p = vendorRevenuePulse(
      [fact({ status: "confirmed", contract_value: 1000, deposit_paid: 1400 })],
      NOW,
    );
    expect(p.collected).toBe(1400);
    // A vendor who typed the deposit wrong (or never updated the contract) is
    // not owed money backwards.
    expect(p.outstanding).toBe(0);
  });

  test("the 30/60/90 windows slice by EVENT date, and they nest", () => {
    const p = vendorRevenuePulse(
      [
        fact({ status: "confirmed", contract_value: 1000, event_date: isoInDays(10) }),
        fact({ status: "confirmed", contract_value: 2000, event_date: isoInDays(45) }),
        fact({ status: "confirmed", contract_value: 4000, event_date: isoInDays(80) }),
        // Past the horizon entirely.
        fact({ status: "confirmed", contract_value: 8000, event_date: isoInDays(200) }),
        // A date that has gone is not "upcoming"; it is a collection problem,
        // which is the attention queue's job and not the forecast's.
        fact({ status: "confirmed", contract_value: 500, event_date: isoInDays(-5) }),
      ],
      NOW,
    );
    expect(p.upcoming_30).toBe(1000);
    // NESTED, not disjoint: 60 contains everything 30 has.
    expect(p.upcoming_60).toBe(3000);
    expect(p.upcoming_90).toBe(7000);
    expect(p.booked).toBe(15_500);
  });

  test("only the BALANCE lands: a booking paid in full lands nothing", () => {
    const p = vendorRevenuePulse(
      [
        fact({
          status: "confirmed",
          contract_value: 2000,
          deposit_paid: 800,
          event_date: isoInDays(10),
        }),
        fact({
          status: "confirmed",
          contract_value: 3000,
          deposit_paid: 3000,
          event_date: isoInDays(12),
        }),
      ],
      NOW,
    );
    expect(p.upcoming_30).toBe(1200);
  });

  test("average booking value and win rate are trailing, and null rather than zero", () => {
    const old = NOW - (REVENUE_TRAILING_DAYS + 10) * DAY_MS;
    const p = vendorRevenuePulse(
      [
        fact({ status: "confirmed", contract_value: 2000 }),
        fact({ status: "confirmed", contract_value: 4000 }),
        fact({ status: "declined", contract_value: 5000 }),
        // Outside the window: neither the average nor the rate may see it.
        fact({ status: "confirmed", contract_value: 100_000, created_at: old }),
        fact({ status: "declined", created_at: old }),
        // Still open, so it is undecided and belongs on NEITHER side of the
        // rate: a busy inbox this week must not push a vendor's win rate down.
        fact({ status: "requested", contract_value: 7000 }),
      ],
      NOW,
    );
    expect(p.average_booking_value).toBe(3000);
    expect(p.decided_count).toBe(3);
    expect(p.win_rate).toBe(67);

    // Nothing decided at all is an UNKNOWN rate, not a 0% one, and an unpriced
    // book has an unknown average rather than an average of zero.
    const undecided = vendorRevenuePulse([fact({ status: "requested" })], NOW);
    expect(undecided.win_rate).toBeNull();
    expect(undecided.average_booking_value).toBeNull();
    expect(undecided.decided_count).toBe(0);
  });

  test("money stays a whole unit of the currency", () => {
    // 333 * 0.2 = 66.6 and 777 * 0.35 = 271.95: the sum is rounded ONCE at the
    // end, so the drift is a single unit at most however many leads there are.
    const p = vendorRevenuePulse(
      [
        fact({ status: "requested", contract_value: 333 }),
        fact({ status: "vendor_seen", contract_value: 777 }),
      ],
      NOW,
    );
    expect(Number.isInteger(p.weighted)).toBe(true);
    expect(p.weighted).toBe(Math.round(333 * 0.2 + 777 * 0.35));
  });
});

// ── The endpoint ────────────────────────────────────────────────────────────

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
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
      blurb: `${name}, original blurb`,
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
    .get(numericId) as ClaimRow | undefined;
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

/** Bootstrap a claimed vendor: session token, listing id, vendor account id.
 *  The account id is read off the claimed listing rather than inferred from the
 *  slug, since the two only coincide on a clean database. */
async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const contactEmail = `vendor-${slug}@weddly.test`;
  const { listingId } = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    contactEmail,
    `${slug} Studio`,
  );
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
    full_name: `Vendor ${slug}`,
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
    highlighted_terms_accepted: true,
  });
  expect(complete.status).toBe(201);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

/** Admin creates an inbound inquiry against a claimed listing, the only way a
 *  vendor gets a client. */
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

/** A bare 'YYYY-MM-DD' this many days from today. */
function dateInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Drop the vendor to FREE. Entitlement is DEFERRED by default in tests, so a
 *  paywall assertion needs the global switch on AND a lapsed subscription. */
function lapseToFree(accountId: number): void {
  db.prepare(
    "UPDATE vendor_subscriptions SET subscription_status = 'none', founding_until = NULL, is_founding_member = 0, is_early_member = 0 WHERE vendor_account_id = ?",
  ).run(accountId);
}

describe("revenue pulse: GET /api/vendor/revenue", () => {
  test("a vendor with no clients gets an empty, honest payload", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("rev-empty");
    const r = await req<VendorRevenuePulseView>("GET", "/api/vendor/revenue", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.booked).toBe(0);
    expect(r.data.pipeline).toBe(0);
    expect(r.data.weighted).toBe(0);
    expect(r.data.average_booking_value).toBeNull();
    expect(r.data.win_rate).toBeNull();
    expect(["HUF", "EUR"]).toContain(r.data.currency);
    expect(r.data.trailing_days).toBe(REVENUE_TRAILING_DAYS);
  });

  test("the real booking columns roll up into the pulse", async () => {
    wipeAll();
    const { vendorToken, listingId } = await bootstrapVendor("rev-roll");
    const adminToken = await registerAdminAndGetToken();
    const { coupleId } = await bootstrapCouple("couple-revenue@weddly.test");

    const confirmed = await createInquiry(adminToken, listingId, coupleId, dateInDays(45));
    const openPriced = await createInquiry(adminToken, listingId, coupleId, dateInDays(120));
    const openUnpriced = await createInquiry(adminToken, listingId, coupleId, dateInDays(150));
    const dead = await createInquiry(adminToken, listingId, coupleId, dateInDays(60));

    // Money and status go in through the ordinary vendor CRM surface, so this
    // asserts the same columns the vendor actually edits.
    const patch = async (id: number, body: Record<string, unknown>) => {
      const res = await req("PATCH", `/api/vendor/clients/${id}`, body, { token: vendorToken });
      expect(res.status).toBe(200);
    };
    await patch(confirmed, { status: "confirmed", contract_value: 3000, deposit_paid: 1000 });
    await patch(openPriced, { status: "vendor_seen", contract_value: 2000 });
    await patch(dead, { status: "declined", contract_value: 9000, deposit_paid: 500 });
    // `openUnpriced` is left exactly as it arrived: requested, no value.
    expect(openUnpriced).toBeGreaterThan(0);

    const r = await req<VendorRevenuePulseView>("GET", "/api/vendor/revenue", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.booked).toBe(3000);
    expect(r.data.collected).toBe(1000);
    expect(r.data.outstanding).toBe(2000);
    expect(r.data.pipeline).toBe(2000);
    expect(r.data.pipeline_unpriced).toBe(1);
    expect(r.data.booked_unpriced).toBe(0);
    expect(r.data.weighted).toBe(Math.round(2000 * (PIPELINE_PROBABILITY.vendor_seen ?? 0)));
    expect(r.data.weighted).toBeLessThan(r.data.pipeline);
    // The declined 9000 / 500 is invisible everywhere except the win rate.
    expect(r.data.win_rate).toBe(50);
    expect(r.data.decided_count).toBe(2);
    expect(r.data.average_booking_value).toBe(3000);
    // The confirmed event is 45 days out, so it lands in 60 and 90, not 30.
    expect(r.data.upcoming_30).toBe(0);
    expect(r.data.upcoming_60).toBe(2000);
    expect(r.data.upcoming_90).toBe(2000);
  });

  test("FREE gets 403, no locked teaser, nothing at all", async () => {
    wipeAll();
    enableBillingEnforcement();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("rev-free");
    const adminToken = await registerAdminAndGetToken();
    const { coupleId } = await bootstrapCouple("couple-revenue-free@weddly.test");
    // The inquiry lands while the activation grant is live, THEN the vendor
    // lapses: the basic client list stays free, the money surface does not.
    const bookingId = await createInquiry(adminToken, listingId, coupleId, dateInDays(30));
    lapseToFree(accountId);

    const r = await req<{ detail?: { code?: string } }>("GET", "/api/vendor/revenue", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("vendor_pro_required");

    // The clients list itself is deliberately still free, which is the whole
    // reason the pulse renders nothing there rather than a paywall bar.
    const list = await req<{ clients: { id: number }[] }>("GET", "/api/vendor/clients", undefined, {
      token: vendorToken,
    });
    expect(list.status).toBe(200);
    expect(list.data.clients.map((c) => c.id)).toContain(bookingId);
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anon = await req("GET", "/api/vendor/revenue");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-revenue@weddly.test");
    const couple = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/revenue",
      undefined,
      { token },
    );
    expect(couple.status).toBe(403);
    expect(couple.data.detail?.code).toBe("vendor_role_required");
  });
});
