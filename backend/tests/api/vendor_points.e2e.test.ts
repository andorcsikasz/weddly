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
  MAX_BOOKING_POINTS_PER_MONTH,
  MAX_REVIEW_POINTS_PER_MONTH,
  POINTS_BY_EVENT,
  PROFILE_MILESTONES,
  VENDOR_TIERS,
  type VendorPointsStatus,
  type VendorTierFacts,
  meetsTier,
  vendorNextTierFor,
  vendorTierFor,
  vendorTierGaps,
  vendorTierProgress,
} from "@shared/vendor_points";
import { db, now } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { createReview } from "../../src/domain/reviews";
import { updateBookingStatus } from "../../src/domain/supplier_bookings";
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
    full_name: "Ádám Nagy",
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

/** A pending inquiry against the vendor's listing. Inserted straight, not
 *  through `createBooking`: this suite is about what the ENGINE pays for, and
 *  the public booking route drags in the PRO entitlement gate and the lead-credit
 *  meter, neither of which has anything to say about points. */
function insertBooking(
  v: { accountId: number; listingId: string },
  coupleId: number,
  eventDate = "2027-05-01",
): number {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO supplier_bookings
         (supplier_id, couple_id, vendor_account_id, event_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?)`,
    )
    .run(v.listingId, coupleId, v.accountId, eventDate, ts, ts);
  return Number(info.lastInsertRowid);
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

/** Fill in every checklist step so `listingCompleteness` reaches 100, then let
 *  the engine notice. A tier above the floor wants a finished listing, and the
 *  bootstrapped community listing arrives with no cover, no gallery and no
 *  packages, so a test about the REVIEW gate has to clear the profile one first
 *  or it is really testing the profile gate by accident.
 *
 *  Deliberately goes through `emitVendorEvent` + the outbox rather than writing
 *  ledger rows by hand: the milestone rule is the thing being relied on here, so
 *  a test that forged its output would prove nothing about the gate. */
function completeListing(v: { accountId: number; listingId: string }): void {
  const ts = now();
  db.prepare(
    `UPDATE listings
        SET hero_image_url = 'https://example.test/hero.jpg',
            blurb_en = 'A complete listing',
            contact_phone = '+36 1 555 0100',
            price_band = 3,
            capacity_min = 20,
            capacity_max = 200,
            updated_at = ?
      WHERE id = ?`,
  ).run(ts, v.listingId);
  db.prepare(
    `INSERT INTO listing_photos (listing_id, url, position_y, created_at)
     VALUES (?, 'https://example.test/1.jpg', 50, ?)`,
  ).run(v.listingId, ts);
  db.prepare(
    `INSERT INTO listing_packages (listing_id, name, price_text, description, created_at, updated_at)
     VALUES (?, 'Full day', 'from 1000', NULL, ?, ?)`,
  ).run(v.listingId, ts, ts);
  emitVendorEvent(v.accountId, "profile.updated");
  processVendorEventOutbox();
}

/** A vendor who satisfies everything a rung asks for, and then some. */
function factsFor(tier: (typeof VENDOR_TIERS)[number]): VendorTierFacts {
  return {
    points: tier.min_points,
    reviews: tier.requires.min_reviews,
    profile_milestones: tier.requires.min_profile_milestones,
  };
}

describe("Weddly Points: tier maths (pure)", () => {
  test("a fresh vendor sits in the floor tier, not in nothing", () => {
    const tier = vendorTierFor({ points: 0, reviews: 0, profile_milestones: 0 });
    expect(tier.key).toBe("blue");
    expect(tier.min_points).toBe(0);
  });

  test("the floor tier asks for nothing, so nobody can fall out of the ladder", () => {
    const floor = VENDOR_TIERS[0];
    expect(floor).toBeTruthy();
    if (!floor) return;
    expect(floor.min_points).toBe(0);
    expect(floor.requires.min_reviews).toBe(0);
    expect(floor.requires.min_profile_milestones).toBe(0);
  });

  test("thresholds promote exactly at min_points once the requirements are met", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    expect(gold).toBeTruthy();
    if (!gold) return;
    const met = factsFor(gold);
    expect(vendorTierFor({ ...met, points: gold.min_points - 1 }).key).toBe("blue");
    expect(vendorTierFor(met).key).toBe("gold");
  });

  // The complaint this whole gate exists to answer: a vendor reached Gold with
  // 40 profile + 50 first review + 15 one review + 60 one booking = 165 points
  // and a single testimonial on the page.
  test("points alone do not buy Gold: five reviews is a floor, not a suggestion", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    expect(gold).toBeTruthy();
    if (!gold) return;
    expect(gold.requires.min_reviews).toBeGreaterThanOrEqual(5);

    // The exact vendor from the report: comfortably past the point floor.
    const reported: VendorTierFacts = {
      points: 165,
      reviews: 1,
      profile_milestones: PROFILE_MILESTONES.length,
    };
    expect(reported.points).toBeGreaterThan(gold.min_points);
    expect(vendorTierFor(reported).key).toBe("blue");

    // And no amount of points fixes it: fast replies and bookings are capped
    // per MONTH, not per lifetime, so a points-only ladder always has this hole.
    expect(vendorTierFor({ ...reported, points: 100_000 }).key).toBe("blue");

    // The fifth review promotes with no new points at all.
    const fifth = { ...reported, points: gold.min_points, reviews: 5 };
    expect(vendorTierFor(fifth).key).toBe("gold");
  });

  test("an unfinished listing holds a vendor at the floor whatever they earn", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    const facts = { ...factsFor(gold), profile_milestones: PROFILE_MILESTONES.length - 1 };
    expect(vendorTierFor(facts).key).toBe("blue");
  });

  // `vendorTierFor` stops at the first rung that fails rather than taking the
  // highest that passes. The two readings only agree while every requirement is
  // non-decreasing up the table, so that property is asserted rather than
  // assumed: a later edit that dips one rung's demand would silently let a
  // vendor skip a rung they do not hold.
  test("every requirement is non-decreasing up the ladder", () => {
    for (let i = 1; i < VENDOR_TIERS.length; i++) {
      const below = VENDOR_TIERS[i - 1];
      const here = VENDOR_TIERS[i];
      if (!below || !here) continue;
      expect(here.requires.min_reviews).toBeGreaterThanOrEqual(below.requires.min_reviews);
      expect(here.requires.min_profile_milestones).toBeGreaterThanOrEqual(
        below.requires.min_profile_milestones,
      );
    }
  });

  test("a rung asks for no more reviews than the rules can actually pay for", () => {
    // A gate above the monthly review cap would be a rung only a farm reaches.
    const perMonth = MAX_REVIEW_POINTS_PER_MONTH / POINTS_BY_EVENT.review_collected;
    for (const tier of VENDOR_TIERS) {
      expect(tier.requires.min_reviews).toBeLessThanOrEqual(perMonth * 24);
    }
  });

  test("the top tier renders a full ring and no next tier", () => {
    const top = VENDOR_TIERS[VENDOR_TIERS.length - 1];
    expect(top).toBeTruthy();
    if (!top) return;
    expect(vendorNextTierFor(factsFor(top))).toBeNull();
    expect(vendorTierProgress(factsFor(top))).toBe(1);
  });

  test("progress is the fraction of the requirement that is actually binding", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    expect(vendorTierProgress({ points: 0, reviews: 0, profile_milestones: 0 })).toBe(0);

    // Halfway on every axis reads as half.
    expect(
      vendorTierProgress({
        points: gold.min_points / 2,
        reviews: gold.requires.min_reviews / 2,
        profile_milestones: gold.requires.min_profile_milestones / 2,
      }),
    ).toBeCloseTo(0.5, 5);

    // The ring must never read nearly-full for a vendor who is four reviews
    // short: that is the old points-only lie moved into the arc.
    const pointsRich = {
      points: gold.min_points,
      reviews: 1,
      profile_milestones: gold.requires.min_profile_milestones,
    };
    expect(vendorTierProgress(pointsRich)).toBeCloseTo(1 / gold.requires.min_reviews, 5);
  });

  test("the gap list names every unmet requirement, with both numbers", () => {
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    const gaps = vendorTierGaps(
      { points: 165, reviews: 1, profile_milestones: PROFILE_MILESTONES.length },
      gold,
    );
    const reviews = gaps.find((g) => g.key === "reviews");
    expect(reviews).toEqual({
      key: "reviews",
      have: 1,
      need: gold.requires.min_reviews,
      met: false,
    });
    // Points are met here, and a met requirement stays listed rather than
    // vanishing: the list has to keep the shape of what the rung asks for.
    expect(gaps.find((g) => g.key === "points")?.met).toBe(true);
    expect(meetsTier({ points: 165, reviews: 1, profile_milestones: 4 }, gold)).toBe(false);
  });

  // The reason the thresholds are what they are. A tier table is easy to edit
  // and its consequences are invisible until a vendor has spent a year not
  // arriving anywhere, so the calibration is asserted rather than left in a
  // comment: raise the top rung past what the rules can actually pay and this
  // test says so on the spot.
  test("a committed vendor reaches the top tier inside two years", () => {
    // The modelled vendor, straight from the VENDOR_TIERS doc block: finishes
    // the profile once, lands a first review once, then every month collects
    // one review, answers three inquiries inside the day, and books a wedding
    // through Weddly every second month.
    const oneTime =
      PROFILE_MILESTONES.length * POINTS_BY_EVENT.profile_completeness +
      POINTS_BY_EVENT.first_review;
    const perMonth =
      POINTS_BY_EVENT.review_collected +
      3 * POINTS_BY_EVENT.fast_reply +
      0.5 * POINTS_BY_EVENT.booking_confirmed;
    // That vendor collects one review a month, and the first one is month 1.
    const reviewsPerMonth = 1;

    // A rung is reached when BOTH its points and its requirements are, so the
    // month is the later of the two. Modelling only the points is what let the
    // ladder read as well-calibrated while Gold arrived in month 1.
    const monthsFor = (tier: (typeof VENDOR_TIERS)[number]) =>
      Math.max((tier.min_points - oneTime) / perMonth, tier.requires.min_reviews / reviewsPerMonth);

    const top = VENDOR_TIERS[VENDOR_TIERS.length - 1];
    expect(top).toBeTruthy();
    if (!top) return;

    const monthsToTop = monthsFor(top);
    expect(monthsToTop).toBeLessThanOrEqual(24);
    // And not trivially reachable either: a top tier a vendor stumbles into in
    // a season is a participation sticker, and every perk below it stops
    // meaning anything.
    expect(monthsToTop).toBeGreaterThan(12);

    // Each rung lands inside the run-up to the one above it, so the ladder has
    // no dead year in the middle.
    const gold = VENDOR_TIERS[1];
    const platinum = VENDOR_TIERS[2];
    if (!gold || !platinum) return;
    expect(monthsFor(platinum)).toBeLessThanOrEqual(12);

    // Gold is the rung the gate exists for. It must take a real season of work
    // (never again month 1), and it must still arrive inside the first half of
    // year one, or the entry rung is a wall rather than a first step.
    expect(monthsFor(gold)).toBeGreaterThanOrEqual(4);
    expect(monthsFor(gold)).toBeLessThanOrEqual(6);
  });

  test("every rung above the floor is worth more than the one below it", () => {
    // Perks are the only reason to climb. A rung that gives no more than the
    // one under it is a rung nobody has a reason to reach.
    for (let i = 1; i < VENDOR_TIERS.length; i++) {
      const below = VENDOR_TIERS[i - 1];
      const here = VENDOR_TIERS[i];
      if (!below || !here) continue;
      expect(here.min_points).toBeGreaterThan(below.min_points);
      const sum = (t: typeof here) =>
        t.perks.search_boost + t.perks.extra_lead_credits + t.perks.subscription_discount_pct;
      expect(sum(here)).toBeGreaterThan(sum(below));
    }
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

  // The rule that replaced `repeat_booking`. A wedding is bought once, so
  // "the same couple books you again" paid practically nobody; what a vendor
  // can actually do is close the business Weddly sent them.
  test("a confirmed booking pays, an unanswered one doesn't, and it pays once", async () => {
    const v = await bootstrapVendor("booked");
    const { coupleId } = await bootstrapCouple("booked-couple@test.test");
    const bookingId = insertBooking(v, coupleId);

    // Still 'requested': the marketplace hasn't produced anything yet.
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "booking_confirmed")).toBe(0);

    updateBookingStatus(bookingId, "confirmed");
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "booking_confirmed")).toBe(POINTS_BY_EVENT.booking_confirmed);

    // Re-delivery, and a cancel/re-confirm round trip, both collapse onto the
    // one occurrence: the dedupe key is the booking, not the transition.
    emitVendorEvent(v.accountId, "booking.confirmed", { booking_id: bookingId });
    updateBookingStatus(bookingId, "cancelled");
    updateBookingStatus(bookingId, "confirmed");
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "booking_confirmed")).toBe(POINTS_BY_EVENT.booking_confirmed);
  });

  test("the engine re-reads the booking, so a confirmation that was undone pays nothing", async () => {
    const v = await bootstrapVendor("undone");
    const { coupleId } = await bootstrapCouple("undone-couple@test.test");
    const bookingId = insertBooking(v, coupleId);

    // Confirmed, then cancelled before the worker got to the queue. The outbox
    // row only records that it WAS confirmed; the status is the truth.
    updateBookingStatus(bookingId, "confirmed");
    updateBookingStatus(bookingId, "cancelled");
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "booking_confirmed")).toBe(0);
  });

  test("booking points stop at the monthly cap", async () => {
    const v = await bootstrapVendor("bookcap");
    const { coupleId } = await bootstrapCouple("bookcap-couple@test.test");
    // Twice the cap's worth of confirmations inside one month.
    const wanted = 2 * Math.ceil(MAX_BOOKING_POINTS_PER_MONTH / POINTS_BY_EVENT.booking_confirmed);
    for (let i = 0; i < wanted; i++) {
      updateBookingStatus(
        insertBooking(v, coupleId, `2027-05-${String(i + 1).padStart(2, "0")}`),
        "confirmed",
      );
    }
    processVendorEventOutbox();
    expect(pointsFor(v.accountId, "booking_confirmed")).toBe(MAX_BOOKING_POINTS_PER_MONTH);
  });

  test("the retired repeat-booking rule pays nothing and is off the rulebook", async () => {
    const v = await bootstrapVendor("legacy");
    const { coupleId } = await bootstrapCouple("legacy-couple@test.test");
    // Two confirmed bookings from the SAME couple on distinct dates: the old
    // rule's trigger, without violating the one-vendor/one-date invariant.
    updateBookingStatus(insertBooking(v, coupleId, "2027-05-01"), "confirmed");
    updateBookingStatus(insertBooking(v, coupleId, "2027-05-02"), "confirmed");
    processVendorEventOutbox();

    expect(pointsFor(v.accountId, "repeat_booking")).toBe(0);
    expect(POINTS_BY_EVENT.repeat_booking).toBe(0);
    expect(EARNABLE_EVENTS as readonly string[]).not.toContain("repeat_booking");
    // The type still carries it, so historic rows keep a home in the breakdown.
    expect(Object.keys(POINTS_BY_EVENT)).toContain("repeat_booking");
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

  test("the tier facts are counted off the ledger and ride on the DTO", async () => {
    const v = await bootstrapVendor("facts");
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    completeListing(v);

    // Points enough for Gold twice over, arriving as an admin correction so no
    // review is involved: exactly the shape of the vendor who complained.
    const { adjustVendorPoints } = await import("../../src/domain/vendor_points");
    adjustVendorPoints(v.accountId, gold.min_points * 2, "test");

    for (let i = 0; i < 4; i++) {
      const author = await bootstrapAuthor(`facts-reviewer-${i}@test.test`);
      createReview({
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
    }
    processVendorEventOutbox();

    const four = await req<VendorPointsStatus>("GET", "/api/vendor/points", undefined, {
      token: v.token,
    });
    expect(four.status).toBe(200);
    // Four reviews, points to spare, and still not Gold.
    expect(four.data.facts.reviews).toBe(4);
    expect(four.data.points).toBeGreaterThan(gold.min_points);
    expect(four.data.tier).toBe("blue");
    expect(four.data.next_tier).toBe("gold");
    // The points gap is spent, so the UI must not be told "0 points to Gold"
    // and left to render a sentence that has stopped meaning anything.
    expect(four.data.points_to_next).toBe(0);
    expect(four.data.progress).toBeLessThan(1);

    const author = await bootstrapAuthor("facts-reviewer-5@test.test");
    createReview({
      supplierId: v.listingId,
      authorUserId: author.userId,
      coupleId: null,
      authorKind: "couple",
      visitorId: null,
      rating: 1,
      body: "the fifth, and a bad one: the gate counts reviews, never stars",
      amountPaid: null,
      amountCurrency: null,
      amountNote: null,
      published: true,
      verified: true,
      flagged: false,
      tags: [],
    });
    processVendorEventOutbox();

    const five = await req<VendorPointsStatus>("GET", "/api/vendor/points", undefined, {
      token: v.token,
    });
    expect(five.data.facts.reviews).toBe(5);
    expect(five.data.tier).toBe("gold");
  });

  test("a deleted review never takes a tier back", async () => {
    // The gate counts LEDGER rows, not live reviews, so a tier can only ever go
    // up. A vendor demoted weeks later for a review its author removed would
    // have no way to understand it and nothing to do about it.
    const v = await bootstrapVendor("nodemote");
    const gold = VENDOR_TIERS.find((t) => t.key === "gold");
    if (!gold) return;
    completeListing(v);
    const { adjustVendorPoints } = await import("../../src/domain/vendor_points");
    adjustVendorPoints(v.accountId, gold.min_points, "test");
    for (let i = 0; i < 5; i++) {
      const author = await bootstrapAuthor(`nodemote-reviewer-${i}@test.test`);
      createReview({
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
    }
    processVendorEventOutbox();
    expect(vendorPointsStatus(v.accountId).tier).toBe("gold");

    db.prepare(
      "UPDATE supplier_reviews SET deleted_at = ?, published = 0 WHERE supplier_id = ?",
    ).run(now(), v.listingId);
    expect(vendorPointsStatus(v.accountId).facts.reviews).toBe(5);
    expect(vendorPointsStatus(v.accountId).tier).toBe("gold");
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

  test("the category rank places the vendor against the vendors couples can see", async () => {
    // Both bootstrap into `photography`, so they are each other's pool.
    const ahead = await bootstrapVendor("rank-ahead");
    const behind = await bootstrapVendor("rank-behind");
    const { adjustVendorPoints } = await import("../../src/domain/vendor_points");
    adjustVendorPoints(ahead.accountId, 120, "ahead");

    const leader = vendorPointsStatus(ahead.accountId).category_rank;
    const trailer = vendorPointsStatus(behind.accountId).category_rank;
    expect(leader?.rank).toBe(1);
    expect(leader?.total).toBe(2);
    expect(leader?.category).toBe("photography");
    // Nobody above the leader, so there is no gap to quote.
    expect(leader?.points_to_climb).toBeNull();
    expect(trailer?.rank).toBe(2);
    // The gap is what DRAWS LEVEL, and drawing level shares the place.
    expect(trailer?.points_to_climb).toBe(
      vendorPointsTotal(ahead.accountId) - vendorPointsTotal(behind.accountId),
    );

    // A tie shares the place rather than breaking on an arbitrary column.
    adjustVendorPoints(behind.accountId, trailer?.points_to_climb ?? 0, "level");
    expect(vendorPointsStatus(behind.accountId).category_rank?.rank).toBe(1);
    expect(vendorPointsStatus(ahead.accountId).category_rank?.rank).toBe(1);

    // A suspended owner is out of the public directory, so they are out of the
    // ranking too: a place counted against a listing no couple can reach is a
    // place against nobody.
    db.prepare(
      "UPDATE users SET status = 'suspended' WHERE id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)",
    ).run(ahead.accountId);
    expect(vendorPointsStatus(behind.accountId).category_rank).toBeNull();
  });

  test("the rank rides along on the HTTP status", async () => {
    const v = await bootstrapVendor("rank-http");
    await bootstrapVendor("rank-http-peer");
    const r = await req<VendorPointsStatus>("GET", "/api/vendor/points", undefined, {
      token: v.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.category_rank?.total).toBe(2);
    expect(r.data.category_rank?.rank).toBeGreaterThanOrEqual(1);
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
