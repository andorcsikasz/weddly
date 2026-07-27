// Weddly Points phase 1: the append-only ledger, the outbox → engine path, the
// derived tier, and the read-only GET /api/vendor/points surface.
//
// What this suite is really guarding (major-change rule: new endpoint + new
// schema + new state machine):
//   - the ledger is IDEMPOTENT. Re-delivering an event, re-running the backfill
//     and replaying the engine must all collapse onto one row per occurrence,
//     because everything downstream (tier, perks, quests) is a replay of it.
//   - points NEVER depend on the star value. A 1-star and a 5-star review are
//     worth exactly the same, which is what keeps the system from paying for
//     review manipulation.
//   - caps hold even under replay, since a cap evaluated anywhere but the
//     ledger is a cap a retry can launder past.
//   - tier maths: floor tier at 0 points, thresholds, and a full ring at the top.
//   - the HTTP surface is read-only and vendor-scoped (401 anon, 403 couple).
//
// Vendors are bootstrapped through the production claim flow (community
// supplier → verify → admin approve → claim → complete), the same path
// vendor_billing.e2e.test.ts uses, so the account/listing wiring is real.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  EARNABLE_EVENTS,
  MAX_REVIEW_POINTS_PER_MONTH,
  POINTS_BY_EVENT,
  VENDOR_TIERS,
  type VendorPointsStatus,
  nextTierForPoints,
  tierForPoints,
  tierProgress,
} from "@shared/vendor_points";
import { db, now } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { createReview } from "../../src/domain/reviews";
import {
  backfillVendorPoints,
  emitVendorEvent,
  processVendorEventOutbox,
  vendorPointsStatus,
  vendorPointsTotal,
} from "../../src/domain/vendor_points";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

async function adminToken(): Promise<string> {
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

/** community supplier → verified → approved → claimed vendor account. */
async function bootstrapVendor(seed: string): Promise<{
  token: string;
  accountId: number;
  listingId: string;
}> {
  const contactEmail = `${seed}@vendor.test`;
  const { token: coupleToken } = await bootstrapCouple(`${seed}-owner@test.test`);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name: `${seed} Studio`,
      city: "Budapest",
      address: null,
      website: `https://${seed}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${seed} blurb`,
      price_band: 3,
    },
    { token: coupleToken },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;

  createVerificationToken(Number(publicId.slice(1)));
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(Number(publicId.slice(1))) as { token: string };
  await req("POST", `/api/suppliers/community/verify/${vtok.token}`, {});
  const approve = await req(
    "POST",
    `/api/admin/suppliers/${Number(publicId.slice(1))}/approve`,
    {},
    { token: await adminToken() },
  );
  expect(approve.status).toBe(200);

  await req("POST", "/api/vendor/claim/start", {
    listing_id: publicId,
    claimant_email: contactEmail,
  });
  const claim = db
    .prepare("SELECT token FROM listing_claims WHERE listing_id = ? ORDER BY id DESC LIMIT 1")
    .get(publicId) as { token: string };
  await req("POST", `/api/vendor/claim/verify/${claim.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim.token,
    password: "vendorpass123",
    full_name: "Vendor Owner",
  });
  expect(complete.status).toBe(201);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(publicId) as { id: number };
  return { token: complete.data.token, accountId: acct.id, listingId: publicId };
}

/** A couple session plus its user id: `bootstrapCouple` hands back the token
 *  and couple id, but a review needs the author's user row. */
async function bootstrapAuthor(email: string): Promise<{ token: string; userId: number }> {
  const { token } = await bootstrapCouple(email);
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
  return { token, userId: row.id };
}

/** Points the vendor holds for one event type: the assertion that actually
 *  matters when a rule is supposed to have fired exactly once. */
function pointsFor(accountId: number, eventType: string): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(points), 0) AS total FROM vendor_points_ledger WHERE vendor_account_id = ? AND event_type = ?",
      )
      .get(accountId, eventType) as { total: number }
  ).total;
}

describe("Weddly Points: tier maths (pure)", () => {
  test("a fresh vendor sits in the floor tier, not in nothing", () => {
    const tier = tierForPoints(0);
    expect(tier.key).toBe("blue");
    expect(tier.min_points).toBe(0);
  });

  test("thresholds promote exactly at min_points", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    expect(gold).toBeTruthy();
    if (!gold) return;
    expect(tierForPoints(gold.min_points - 1).key).toBe("blue");
    expect(tierForPoints(gold.min_points).key).toBe("gold");
  });

  test("the top tier renders a full ring and no next tier", () => {
    const top = VENDOR_TIERS[VENDOR_TIERS.length - 1];
    expect(top).toBeTruthy();
    if (!top) return;
    expect(nextTierForPoints(top.min_points)).toBeNull();
    expect(tierProgress(top.min_points)).toBe(1);
  });

  test("progress is a 0..1 fraction of the gap to the next tier", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    expect(tierProgress(0)).toBe(0);
    expect(tierProgress(gold.min_points / 2)).toBeCloseTo(0.5, 5);
  });
});

describe("Weddly Points: ledger + engine", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a collected review is worth the same at 1 star as at 5", async () => {
    const one = await bootstrapVendor("onestar");
    const five = await bootstrapVendor("fivestar");
    const author = await bootstrapAuthor("reviewer@test.test");

    createReview({
      supplierId: one.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 1,
      body: "one star",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    createReview({
      supplierId: five.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 5,
      body: "five stars",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    processVendorEventOutbox();

    expect(pointsFor(one.accountId, "review_collected")).toBe(
      pointsFor(five.accountId, "review_collected"),
    );
    expect(pointsFor(one.accountId, "review_collected")).toBe(POINTS_BY_EVENT.review_collected);
    // …and the very first review pays its own bonus on top, once.
    expect(pointsFor(one.accountId, "first_review")).toBe(POINTS_BY_EVENT.first_review);
  });

  test("re-delivering the same event awards nothing twice", async () => {
    const v = await bootstrapVendor("dedupe");
    const author = await bootstrapAuthor("dedupe-reviewer@test.test");
    createReview({
      supplierId: v.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 4,
      body: "good",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    processVendorEventOutbox();
    const afterFirst = vendorPointsTotal(v.accountId);
    expect(afterFirst).toBeGreaterThan(0);

    // Same occurrence, delivered again (retry, replay, whatever).
    const reviewId = (
      db.prepare("SELECT id FROM supplier_reviews ORDER BY id DESC LIMIT 1").get() as { id: number }
    ).id;
    emitVendorEvent(v.accountId, "review.created", { review_id: reviewId });
    emitVendorEvent(v.accountId, "review.created", { review_id: reviewId });
    processVendorEventOutbox();

    expect(vendorPointsTotal(v.accountId)).toBe(afterFirst);
  });

  test("the backfill is safe to run repeatedly", async () => {
    const v = await bootstrapVendor("backfill");
    const author = await bootstrapAuthor("backfill-reviewer@test.test");
    createReview({
      supplierId: v.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 5,
      body: "great",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    processVendorEventOutbox();

    // The first backfill may legitimately ADD points the live event path never
    // emitted (an older account whose profile predates the engine). What must
    // never happen is a second pass paying for the same occurrences again.
    backfillVendorPoints();
    const afterFirstBackfill = vendorPointsTotal(v.accountId);
    expect(afterFirstBackfill).toBeGreaterThan(0);

    backfillVendorPoints();
    backfillVendorPoints();
    expect(vendorPointsTotal(v.accountId)).toBe(afterFirstBackfill);

    // And the ledger holds one row per occurrence, not one per replay.
    const rows = db
      .prepare(
        "SELECT dedupe_key, COUNT(*) AS n FROM vendor_points_ledger WHERE vendor_account_id = ? GROUP BY dedupe_key HAVING n > 1",
      )
      .all(v.accountId);
    expect(rows).toEqual([]);
  });

  test("review points stop at the monthly cap, and a replay can't launder past it", async () => {
    const v = await bootstrapVendor("cap");
    // Award straight through the engine by emitting one event per fake review id.
    // Reviews themselves are rate-limited elsewhere; this exercises the ledger cap.
    const ids: number[] = [];
    const author = await bootstrapAuthor("cap-reviewer@test.test");
    for (let i = 0; i < 15; i++) {
      const r = createReview({
        supplierId: v.listingId,
        authorUserId: author.userId,
        coupleId: null,
        authorKind: "couple",
        visitorId: null,
        rating: 5,
        body: `review ${i}`,
        amountPaid: null,
        amountCurrency: null,
        amountNote: null,
        published: true,
        verified: true,
        flagged: false,
        tags: [],
      });
      ids.push(r.id);
    }
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "review_collected")).toBe(MAX_REVIEW_POINTS_PER_MONTH);

    // Replay every event: still capped.
    for (const id of ids) emitVendorEvent(v.accountId, "review.created", { review_id: id });
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "review_collected")).toBe(MAX_REVIEW_POINTS_PER_MONTH);
  });

  test("an unknown event is consumed, not retried forever", async () => {
    const v = await bootstrapVendor("unknown");
    db.prepare(
      "INSERT INTO vendor_event_outbox (vendor_account_id, event_type, payload_json, created_at) VALUES (?, 'nonsense.happened', NULL, ?)",
    ).run(v.accountId, now());
    processVendorEventOutbox();
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS n FROM vendor_event_outbox WHERE processed_at IS NULL AND vendor_account_id = ?",
      )
      .get(v.accountId) as { n: number };
    expect(pending.n).toBe(0);
  });

  test("the ledger is append-only: an admin correction is a new negative row", async () => {
    const v = await bootstrapVendor("adjust");
    const { adjustVendorPoints } = await import("../../src/domain/vendor_points");
    adjustVendorPoints(v.accountId, 100, "goodwill");
    adjustVendorPoints(v.accountId, -40, "clawback");
    const rows = db
      .prepare(
        "SELECT points FROM vendor_points_ledger WHERE vendor_account_id = ? AND event_type = 'admin_adjustment' ORDER BY id",
      )
      .all(v.accountId) as { points: number }[];
    expect(rows.map((r) => r.points)).toEqual([100, -40]);
    expect(vendorPointsTotal(v.accountId)).toBe(60);
  });
});

describe("GET /api/vendor/points", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("returns the derived status for the calling vendor", async () => {
    const v = await bootstrapVendor("status");
    const r = await req<VendorPointsStatus>("GET", "/api/vendor/points", undefined, {
      token: v.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.tier).toBe("blue");
    expect(r.data.next_tier).toBe("gold");
    expect(r.data.points_to_next).toBeGreaterThan(0);
    expect(r.data.progress).toBeGreaterThanOrEqual(0);
    expect(r.data.perks).toBeTruthy();
    // Mirrors the server-side derivation exactly: no second implementation.
    expect(r.data.points).toBe(vendorPointsStatus(v.accountId).points);
  });

  test("earned_by_event breaks the total down per rule, zeros included", async () => {
    const v = await bootstrapVendor("breakdown");
    const author = await bootstrapAuthor("breakdown-reviewer@test.test");
    createReview({
      supplierId: v.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 3,
      body: "fine",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    processVendorEventOutbox();

    const r = await req<VendorPointsStatus>("GET", "/api/vendor/points", undefined, {
      token: v.token,
    });
    expect(r.status).toBe(200);
    const byEvent = r.data.earned_by_event;

    // Every rule the UI can render has a key, so the panel never branches on
    // undefined for a vendor who hasn't earned that one yet.
    for (const event of Object.keys(POINTS_BY_EVENT)) {
      expect(typeof byEvent[event as keyof typeof byEvent]).toBe("number");
    }
    expect(byEvent.first_review).toBe(POINTS_BY_EVENT.first_review);
    expect(byEvent.review_collected).toBe(POINTS_BY_EVENT.review_collected);
    expect(byEvent.repeat_booking).toBe(0);
    // The breakdown IS the total: a vendor adding up the panel must land on the
    // hero number, or the panel is lying about where the points came from.
    const summed = Object.values(byEvent).reduce((a, b) => a + b, 0);
    expect(summed).toBe(r.data.points);
  });

  test("everything EARNABLE_EVENTS advertises is a rule that pays", async () => {
    // The panel renders `+POINTS_BY_EVENT[event]` next to each line, so a rule
    // worth 0 (or one the engine never awards) would advertise nothing.
    for (const event of EARNABLE_EVENTS) {
      expect(POINTS_BY_EVENT[event]).toBeGreaterThan(0);
    }
    expect(EARNABLE_EVENTS).not.toContain("admin_adjustment");
  });

  test("401 for anonymous, 403 for a couple-role user", async () => {
    await bootstrapVendor("guard");
    const anon = await req("GET", "/api/vendor/points");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor@test.test");
    const couple = await req("GET", "/api/vendor/points", undefined, { token });
    expect(couple.status).toBe(403);
  });
});
