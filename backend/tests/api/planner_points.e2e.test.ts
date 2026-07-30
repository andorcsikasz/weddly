// Weddly Points, planner side: the append-only ledger, the outbox → engine
// path, the derived tier, the directory perks, and the read-only
// GET /api/planner/points surface.
//
// What this suite guards (major-change rule: new endpoint + new schema + new
// state machine):
//   - the ledger is IDEMPOTENT. A re-delivered event, a replayed engine pass and
//     the boot backfill must all collapse onto one row per occurrence, because
//     the total, the tier and the rank are nothing but a replay of it.
//   - points never depend on a star VALUE, and a DRAFT review pays nothing: it
//     is visible to nobody but its admin author, so it earned nothing.
//   - the engine RE-READS what it pays for, so a link that isn't active and an
//     invitation that isn't accepted pay nothing however the event was written.
//   - caps hold under replay, since a cap evaluated anywhere but the ledger is a
//     cap a retry can launder past.
//   - the perks are ENFORCED: the tier boost moves a planner up the couple-facing
//     directory but never above a human's `verified` decision, and the badge
//     field is null until a tier actually earns one.
//   - the HTTP surface is read-only and planner-scoped (401 anon, 403 couple).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_PLANNER_INVITE_POINTS_PER_MONTH,
  PLANNER_EARNABLE_EVENTS,
  PLANNER_POINTS_BY_EVENT,
  PLANNER_PROFILE_MILESTONES,
  PLANNER_TIERS,
  type PlannerPointsStatus,
  plannerNextTierForPoints,
  plannerTierForPoints,
  plannerTierProgress,
} from "@shared/planner_points";
import { plannerReviewSubjectId } from "@shared/planner_reviews";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import { db, now } from "../../src/db";
import { createPlannerInvitation } from "../../src/domain/planner_invitations";
import {
  adjustPlannerPoints,
  backfillPlannerPoints,
  emitPlannerEvent,
  plannerPointsStatus,
  plannerPointsTotal,
  plannerRank,
  processPlannerEventOutbox,
} from "../../src/domain/planner_points";
import { createReview } from "../../src/domain/reviews";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** A listable planner account plus its session. The directory needs a business
 *  name + city, which is also two of the seven checklist steps (29%, i.e. past
 *  the first milestone), so every test that cares states the expected total. */
async function makePlanner(
  email: string,
  full_name = "Eszter Nagy",
): Promise<{ userId: number; token: string }> {
  const reg = await registerAndVerify({ email, password: "supersafe123", full_name });
  expect(reg.status).toBe(201);
  db.prepare(
    `UPDATE users
        SET user_type = 'planner', couple_id = NULL,
            business_name = ?, planner_city = 'Budapest'
      WHERE LOWER(email) = ?`,
  ).run(`${full_name} Weddings`, email.toLowerCase());
  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;
  return { userId, token: reg.data.token };
}

/** Points the planner holds for one rule: the assertion that matters when a rule
 *  is supposed to have fired exactly once. */
function pointsFor(plannerUserId: number, eventType: string): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(points), 0) AS total FROM planner_points_ledger WHERE planner_user_id = ? AND event_type = ?",
      )
      .get(plannerUserId, eventType) as { total: number }
  ).total;
}

/** A review ON a planner, written straight through the domain so the suite can
 *  choose `published` (the composer routes always publish). */
function reviewPlanner(
  plannerUserId: number,
  authorUserId: number,
  rating: 1 | 2 | 3 | 4 | 5,
  published = true,
): number {
  return createReview({
    supplierId: plannerReviewSubjectId(plannerUserId),
    authorUserId,
    coupleId: null,
    authorKind: published ? "couple" : "admin",
    visitorId: null,
    rating,
    body: `rated ${rating}`,
    tags: [],
    amountPaid: null,
    amountCurrency: null,
    amountNote: null,
    published,
    verified: false,
    flagged: false,
  }).id;
}

function linkClient(plannerUserId: number, coupleId: number, status = "active"): void {
  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, ?, 'couple', ?)",
  ).run(plannerUserId, coupleId, status, now());
}

describe("planner points: tier maths (pure)", () => {
  test("a fresh planner sits in the floor tier, not in nothing", () => {
    const tier = plannerTierForPoints(0);
    expect(tier.key).toBe("blue");
    expect(tier.min_points).toBe(0);
  });

  test("thresholds promote exactly at min_points, and the top rung fills the ring", () => {
    const gold = PLANNER_TIERS.find((t) => t.key === "gold");
    expect(gold).toBeTruthy();
    if (!gold) return;
    expect(plannerTierForPoints(gold.min_points - 1).key).toBe("blue");
    expect(plannerTierForPoints(gold.min_points).key).toBe("gold");

    const top = PLANNER_TIERS[PLANNER_TIERS.length - 1];
    if (!top) return;
    expect(plannerNextTierForPoints(top.min_points)).toBeNull();
    expect(plannerTierProgress(top.min_points)).toBe(1);
  });

  // The reason the thresholds are what they are. A tier table is easy to edit and
  // its consequences are invisible until a planner has spent a year not arriving
  // anywhere, so the calibration from the PLANNER_TIERS doc block is asserted
  // rather than left in a comment.
  test("a working planner reaches the top tier inside two wedding seasons", () => {
    const oneTime =
      PLANNER_PROFILE_MILESTONES.length * PLANNER_POINTS_BY_EVENT.profile_completeness +
      PLANNER_POINTS_BY_EVENT.first_review;
    const perMonth =
      PLANNER_POINTS_BY_EVENT.client_linked + PLANNER_POINTS_BY_EVENT.review_collected;
    const top = PLANNER_TIERS[PLANNER_TIERS.length - 1];
    expect(top).toBeTruthy();
    if (!top) return;
    const monthsToTop = (top.min_points - oneTime) / perMonth;
    expect(monthsToTop).toBeLessThanOrEqual(24);
    // And not a participation sticker either: a top rung reached in one season
    // makes every perk below it stop meaning anything.
    expect(monthsToTop).toBeGreaterThan(12);
  });

  test("every rung above the floor is worth more than the one below it", () => {
    for (let i = 1; i < PLANNER_TIERS.length; i++) {
      const below = PLANNER_TIERS[i - 1];
      const here = PLANNER_TIERS[i];
      if (!below || !here) continue;
      expect(here.min_points).toBeGreaterThan(below.min_points);
      expect(here.perks.directory_boost).toBeGreaterThan(below.perks.directory_boost);
    }
  });

  test("everything the rulebook advertises is a rule that pays", () => {
    for (const event of PLANNER_EARNABLE_EVENTS) {
      expect(PLANNER_POINTS_BY_EVENT[event]).toBeGreaterThan(0);
    }
    expect(PLANNER_EARNABLE_EVENTS as readonly string[]).not.toContain("admin_adjustment");
  });
});

describe("planner points: profile milestones", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("milestones land as the checklist fills, and a replay pays nothing twice", async () => {
    const planner = await makePlanner("pp-milestones@weddly.test");
    const step = PLANNER_POINTS_BY_EVENT.profile_completeness;

    // Business name + city = 2 of 7 = 29%: past the 25% rung, nothing above it.
    emitPlannerEvent(planner.userId, "profile.updated");
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(step);

    // Bio + styles = 4 of 7 = 57%. Through the route, so the emit site is
    // covered as well as the rule.
    const patch = await req(
      "PATCH",
      "/api/planner/profile",
      { planner_bio: "Ten years of calm weddings.", planner_styles: ["boho", "classic"] },
      { token: planner.token },
    );
    expect(patch.status).toBe(200);
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(2 * step);

    // A photo + a price package = 6 of 7 = 86%.
    db.prepare(
      "INSERT INTO planner_portfolio (planner_user_id, title, description, image_url, sort_order, created_at) VALUES (?, 'A wedding', '', '/uploads/x.jpg', 1, ?)",
    ).run(planner.userId, now());
    const pkg = await req(
      "POST",
      "/api/planner/profile/packages",
      { name: "Full service" },
      { token: planner.token },
    );
    expect(pkg.status).toBe(201);
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(3 * step);

    // The availability note completes it: 7 of 7 = 100%.
    await req(
      "PATCH",
      "/api/planner/profile",
      { planner_availability: "2027 Q3 is open" },
      { token: planner.token },
    );
    processPlannerEventOutbox();
    const finished = PLANNER_PROFILE_MILESTONES.length * step;
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(finished);

    // Every replay path collapses onto the same four rows.
    emitPlannerEvent(planner.userId, "profile.updated");
    processPlannerEventOutbox();
    backfillPlannerPoints();
    backfillPlannerPoints();
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(finished);
    const dupes = db
      .prepare(
        "SELECT dedupe_key, COUNT(*) AS n FROM planner_points_ledger WHERE planner_user_id = ? GROUP BY dedupe_key HAVING n > 1",
      )
      .all(planner.userId);
    expect(dupes).toEqual([]);
  });

  test("a milestone is permanent: deleting the package doesn't claw it back", async () => {
    const planner = await makePlanner("pp-permanent@weddly.test");
    db.prepare(
      "INSERT INTO planner_portfolio (planner_user_id, title, description, image_url, sort_order, created_at) VALUES (?, 'A wedding', '', '/uploads/x.jpg', 1, ?)",
    ).run(planner.userId, now());
    db.prepare(
      "INSERT INTO planner_packages (planner_user_id, name, created_at, updated_at) VALUES (?, 'Full service', ?, ?)",
    ).run(planner.userId, now(), now());
    await req(
      "PATCH",
      "/api/planner/profile",
      { planner_bio: "Bio", planner_styles: ["boho"], planner_availability: "open" },
      { token: planner.token },
    );
    processPlannerEventOutbox();
    const peak = pointsFor(planner.userId, "profile_completeness");
    expect(peak).toBe(
      PLANNER_PROFILE_MILESTONES.length * PLANNER_POINTS_BY_EVENT.profile_completeness,
    );

    // The photo goes: 100% back down to 86%, which is below the rung that paid.
    db.prepare("DELETE FROM planner_portfolio WHERE planner_user_id = ?").run(planner.userId);
    emitPlannerEvent(planner.userId, "profile.updated");
    processPlannerEventOutbox();
    backfillPlannerPoints();
    expect(pointsFor(planner.userId, "profile_completeness")).toBe(peak);
  });
});

describe("planner points: reviews", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a collected review is worth the same at 1 star as at 5, and the first one pays a bonus", async () => {
    const one = await makePlanner("pp-onestar@weddly.test", "One Star");
    const five = await makePlanner("pp-fivestar@weddly.test", "Five Star");
    const author = await bootstrapCouple("pp-reviewer@weddly.test");
    const authorId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("pp-reviewer@weddly.test") as {
        id: number;
      }
    ).id;

    reviewPlanner(one.userId, authorId, 1);
    reviewPlanner(five.userId, authorId, 5);
    processPlannerEventOutbox();

    expect(pointsFor(one.userId, "review_collected")).toBe(
      pointsFor(five.userId, "review_collected"),
    );
    expect(pointsFor(one.userId, "review_collected")).toBe(
      PLANNER_POINTS_BY_EVENT.review_collected,
    );
    expect(pointsFor(one.userId, "first_review")).toBe(PLANNER_POINTS_BY_EVENT.first_review);
    expect(author.coupleId).toBeGreaterThan(0);
  });

  test("re-delivering the review event awards nothing twice, and the second review is not a first", async () => {
    const planner = await makePlanner("pp-dedupe@weddly.test");
    const author = await bootstrapCouple("pp-dedupe-author@weddly.test");
    const authorId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("pp-dedupe-author@weddly.test") as {
        id: number;
      }
    ).id;
    expect(author.coupleId).toBeGreaterThan(0);

    const first = reviewPlanner(planner.userId, authorId, 4);
    processPlannerEventOutbox();
    const afterFirst = plannerPointsTotal(planner.userId);
    expect(afterFirst).toBeGreaterThan(0);

    // Same occurrence, delivered twice more (retry, replay, whatever).
    emitPlannerEvent(planner.userId, "review.created", { review_id: first });
    emitPlannerEvent(planner.userId, "review.created", { review_id: first });
    processPlannerEventOutbox();
    expect(plannerPointsTotal(planner.userId)).toBe(afterFirst);

    // A second review pays the collection rule only: `first_review` is once ever.
    reviewPlanner(planner.userId, authorId, 5);
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "first_review")).toBe(PLANNER_POINTS_BY_EVENT.first_review);
    expect(pointsFor(planner.userId, "review_collected")).toBe(
      2 * PLANNER_POINTS_BY_EVENT.review_collected,
    );
  });

  test("a draft review pays nothing: nobody but its author can see it", async () => {
    const planner = await makePlanner("pp-draft@weddly.test");
    const author = await bootstrapCouple("pp-draft-author@weddly.test");
    const authorId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("pp-draft-author@weddly.test") as {
        id: number;
      }
    ).id;
    expect(author.coupleId).toBeGreaterThan(0);

    const draft = reviewPlanner(planner.userId, authorId, 5, false);
    // Even a hand-forged event doesn't get past the re-read.
    emitPlannerEvent(planner.userId, "review.created", { review_id: draft });
    processPlannerEventOutbox();
    backfillPlannerPoints();
    expect(pointsFor(planner.userId, "review_collected")).toBe(0);
    expect(pointsFor(planner.userId, "first_review")).toBe(0);
  });

  test("an event naming somebody else's review credits nobody", async () => {
    const mine = await makePlanner("pp-subject-a@weddly.test", "Subject A");
    const theirs = await makePlanner("pp-subject-b@weddly.test", "Subject B");
    const author = await bootstrapCouple("pp-subject-author@weddly.test");
    const authorId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("pp-subject-author@weddly.test") as {
        id: number;
      }
    ).id;
    expect(author.coupleId).toBeGreaterThan(0);

    const theirReview = reviewPlanner(theirs.userId, authorId, 5);
    emitPlannerEvent(mine.userId, "review.created", { review_id: theirReview });
    processPlannerEventOutbox();
    expect(pointsFor(mine.userId, "review_collected")).toBe(0);
    expect(pointsFor(theirs.userId, "review_collected")).toBe(
      PLANNER_POINTS_BY_EVENT.review_collected,
    );
  });
});

describe("planner points: client links + invitations", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("an accepted client pays once, and re-processing pays nothing", async () => {
    const planner = await makePlanner("pp-client@weddly.test");
    const couple = await bootstrapCouple("pp-client-couple@weddly.test");
    linkClient(planner.userId, couple.coupleId);

    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "client_linked")).toBe(PLANNER_POINTS_BY_EVENT.client_linked);

    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    processPlannerEventOutbox();
    backfillPlannerPoints();
    expect(pointsFor(planner.userId, "client_linked")).toBe(PLANNER_POINTS_BY_EVENT.client_linked);
  });

  test("the engine re-reads the link, so a pending or revoked one pays nothing", async () => {
    const planner = await makePlanner("pp-pending@weddly.test");
    const couple = await bootstrapCouple("pp-pending-couple@weddly.test");
    // Consent not given yet: a pending link grants no access and earns nothing.
    linkClient(planner.userId, couple.coupleId, "pending");
    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "client_linked")).toBe(0);

    // Accepted, then revoked before the worker got to the queue.
    db.prepare(
      "UPDATE planner_clients SET status = 'active' WHERE planner_user_id = ? AND couple_id = ?",
    ).run(planner.userId, couple.coupleId);
    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    db.prepare("DELETE FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?").run(
      planner.userId,
      couple.coupleId,
    );
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "client_linked")).toBe(0);
  });

  test("the couple accepting a planner's request is what fires the award", async () => {
    // The whole route path, because this is the emit site that matters most: the
    // points are the planner's, and the person clicking is the couple.
    const planner = await makePlanner("pp-accept@weddly.test");
    const couple = await bootstrapCouple("pp-accept-couple@weddly.test");
    db.prepare(
      "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, 'pending', 'planner', ?)",
    ).run(planner.userId, couple.coupleId, now());

    const accept = await req(
      "POST",
      `/api/couples/planners/${planner.userId}/accept`,
      {},
      { token: couple.token },
    );
    expect(accept.status).toBe(200);
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "client_linked")).toBe(PLANNER_POINTS_BY_EVENT.client_linked);
  });

  test("an accepted email invitation pays, an unaccepted one doesn't", async () => {
    const planner = await makePlanner("pp-invite@weddly.test");
    const open = createPlannerInvitation(planner.userId, "still-thinking@weddly.test");
    const taken = createPlannerInvitation(planner.userId, "signed-up@weddly.test");
    db.prepare(
      "UPDATE planner_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
    ).run(now(), taken.id);

    emitPlannerEvent(planner.userId, "invite.accepted", { invitation_id: open.id });
    emitPlannerEvent(planner.userId, "invite.accepted", { invitation_id: taken.id });
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "couple_invited")).toBe(
      PLANNER_POINTS_BY_EVENT.couple_invited,
    );
  });

  test("invitation points stop at the monthly cap, and a replay can't launder past it", async () => {
    const planner = await makePlanner("pp-cap@weddly.test");
    const wanted =
      2 * Math.ceil(MAX_PLANNER_INVITE_POINTS_PER_MONTH / PLANNER_POINTS_BY_EVENT.couple_invited);
    const ids: number[] = [];
    for (let i = 0; i < wanted; i++) {
      const inv = createPlannerInvitation(planner.userId, `capped-${i}@weddly.test`);
      db.prepare(
        "UPDATE planner_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?",
      ).run(now(), inv.id);
      ids.push(inv.id);
      emitPlannerEvent(planner.userId, "invite.accepted", { invitation_id: inv.id });
    }
    processPlannerEventOutbox();
    expect(pointsFor(planner.userId, "couple_invited")).toBe(MAX_PLANNER_INVITE_POINTS_PER_MONTH);

    // Replay every event, plus the backfill: still capped.
    for (const id of ids)
      emitPlannerEvent(planner.userId, "invite.accepted", { invitation_id: id });
    processPlannerEventOutbox();
    backfillPlannerPoints();
    expect(pointsFor(planner.userId, "couple_invited")).toBe(MAX_PLANNER_INVITE_POINTS_PER_MONTH);
  });
});

describe("planner points: ledger mechanics", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("an unknown event is consumed, not retried forever", async () => {
    const planner = await makePlanner("pp-unknown@weddly.test");
    db.prepare(
      "INSERT INTO planner_event_outbox (planner_user_id, event_type, payload_json, created_at) VALUES (?, 'nonsense.happened', NULL, ?)",
    ).run(planner.userId, now());
    processPlannerEventOutbox();
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS n FROM planner_event_outbox WHERE processed_at IS NULL AND planner_user_id = ?",
      )
      .get(planner.userId) as { n: number };
    expect(pending.n).toBe(0);
  });

  test("the ledger is append-only: an admin correction is a new negative row", async () => {
    const planner = await makePlanner("pp-adjust@weddly.test");
    const before = plannerPointsTotal(planner.userId);
    adjustPlannerPoints(planner.userId, 100, "goodwill");
    adjustPlannerPoints(planner.userId, -40, "clawback");
    const rows = db
      .prepare(
        "SELECT points FROM planner_points_ledger WHERE planner_user_id = ? AND event_type = 'admin_adjustment' ORDER BY id",
      )
      .all(planner.userId) as { points: number }[];
    expect(rows.map((r) => r.points)).toEqual([100, -40]);
    expect(plannerPointsTotal(planner.userId)).toBe(before + 60);
  });
});

describe("planner points: rank", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a pool of one says nothing, so it says null", async () => {
    const planner = await makePlanner("pp-alone@weddly.test");
    expect(plannerRank(planner.userId)).toBeNull();
  });

  test("a planner outside the directory pool has no standing", async () => {
    const planner = await makePlanner("pp-hidden@weddly.test", "Hidden");
    await makePlanner("pp-visible@weddly.test", "Visible");
    // Thin profile and not admin-verified: no couple can find them.
    db.prepare("UPDATE users SET business_name = NULL WHERE id = ?").run(planner.userId);
    expect(plannerRank(planner.userId)).toBeNull();
  });

  test("places are 1-based, gaps are what draws level, and a tie shares the place", async () => {
    const ahead = await makePlanner("pp-rank-ahead@weddly.test", "Ahead");
    const behind = await makePlanner("pp-rank-behind@weddly.test", "Behind");
    adjustPlannerPoints(ahead.userId, 120, "ahead");

    const leader = plannerRank(ahead.userId);
    const trailer = plannerRank(behind.userId);
    expect(leader?.rank).toBe(1);
    expect(leader?.total).toBe(2);
    // Neither planner set a country, so the pool is the whole directory.
    expect(leader?.country).toBeNull();
    expect(leader?.points_to_climb).toBeNull();
    expect(trailer?.rank).toBe(2);
    expect(trailer?.points_to_climb).toBe(
      plannerPointsTotal(ahead.userId) - plannerPointsTotal(behind.userId),
    );

    // Drawing level SHARES the place rather than breaking on an arbitrary column.
    adjustPlannerPoints(behind.userId, trailer?.points_to_climb ?? 0, "level");
    expect(plannerRank(behind.userId)?.rank).toBe(1);
    expect(plannerRank(ahead.userId)?.rank).toBe(1);
  });

  test("the pool is scoped to the planner's own country when they set one", async () => {
    const hu = await makePlanner("pp-hu@weddly.test", "Budapest One");
    const hu2 = await makePlanner("pp-hu2@weddly.test", "Budapest Two");
    const es = await makePlanner("pp-es@weddly.test", "Madrid One");
    db.prepare("UPDATE users SET planner_country = 'HU' WHERE id IN (?, ?)").run(
      hu.userId,
      hu2.userId,
    );
    db.prepare("UPDATE users SET planner_country = 'ES' WHERE id = ?").run(es.userId);

    const rank = plannerRank(hu.userId);
    expect(rank?.country).toBe("HU");
    expect(rank?.total).toBe(2);
    // One Spanish planner alone in their pool: 1st of 1 is a fact about the
    // market, not about the planner.
    expect(plannerRank(es.userId)).toBeNull();
  });
});

describe("planner points: directory perks", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("the tier badge is null until a tier earns one, on the card and on the detail", async () => {
    const gold = await makePlanner("pp-gold@weddly.test", "Gold");
    await makePlanner("pp-blue@weddly.test", "Blue");
    const goldTier = PLANNER_TIERS.find((t) => t.key === "gold");
    expect(goldTier).toBeTruthy();
    if (!goldTier) return;
    adjustPlannerPoints(gold.userId, goldTier.min_points, "promote");

    const couple = await bootstrapCouple("pp-perk-couple@weddly.test");
    const list = await req<{ planners: PlannerDirectoryEntry[] }>(
      "GET",
      "/api/couples/planner-directory",
      undefined,
      { token: couple.token },
    );
    expect(list.status).toBe(200);
    const cards = new Map(list.data.planners.map((p) => [p.planner_user_id, p]));
    expect(cards.get(gold.userId)?.tier).toBe("gold");
    // Blue's perk table says no badge, so the field is null rather than "blue".
    const blueCard = list.data.planners.find((p) => p.planner_user_id !== gold.userId);
    expect(blueCard?.tier).toBeNull();

    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${gold.userId}`,
      undefined,
      { token: couple.token },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.tier).toBe("gold");
  });

  test("the boost lifts a planner up the rail, but never above a verified one", async () => {
    const gold = await makePlanner("pp-boost-gold@weddly.test", "Boosted");
    const plain = await makePlanner("pp-boost-plain@weddly.test", "Plain");
    const goldTier = PLANNER_TIERS.find((t) => t.key === "gold");
    if (!goldTier) return;
    adjustPlannerPoints(gold.userId, goldTier.min_points, "promote");

    const couple = await bootstrapCouple("pp-boost-couple@weddly.test");
    const order = async (): Promise<number[]> => {
      const r = await req<{ planners: PlannerDirectoryEntry[] }>(
        "GET",
        "/api/couples/planner-directory",
        undefined,
        { token: couple.token },
      );
      expect(r.status).toBe(200);
      return r.data.planners.map((p) => p.planner_user_id);
    };

    expect((await order())[0]).toBe(gold.userId);

    // An admin's trust decision outranks any number of points: a verified
    // newcomer must not be buried by the ladder.
    db.prepare("UPDATE users SET planner_verified = 1 WHERE id = ?").run(plain.userId);
    expect((await order())[0]).toBe(plain.userId);
  });
});

describe("GET /api/planner/points", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("returns the derived status for the calling planner", async () => {
    const planner = await makePlanner("pp-status@weddly.test");
    // Nothing has been emitted for this planner yet: a fresh account reads zero
    // and sits in the floor tier.
    const r = await req<PlannerPointsStatus>("GET", "/api/planner/points", undefined, {
      token: planner.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.points).toBe(0);
    expect(r.data.tier).toBe("blue");
    expect(r.data.next_tier).toBe("gold");
    expect(r.data.points_to_next).toBeGreaterThan(0);
    expect(r.data.progress).toBe(0);
    expect(r.data.perks.profile_badge).toBe(false);
    expect(r.data.recent).toEqual([]);
    // A pool of one has no standing to report.
    expect(r.data.rank).toBeNull();
    // Mirrors the server-side derivation exactly: no second implementation.
    expect(r.data.points).toBe(plannerPointsStatus(planner.userId).points);
  });

  test("earned_by_event breaks the total down per rule, zeros included", async () => {
    const planner = await makePlanner("pp-breakdown@weddly.test");
    const couple = await bootstrapCouple("pp-breakdown-couple@weddly.test");
    linkClient(planner.userId, couple.coupleId);
    emitPlannerEvent(planner.userId, "client.linked", { couple_id: couple.coupleId });
    emitPlannerEvent(planner.userId, "profile.updated");
    processPlannerEventOutbox();

    const r = await req<PlannerPointsStatus>("GET", "/api/planner/points", undefined, {
      token: planner.token,
    });
    expect(r.status).toBe(200);
    const byEvent = r.data.earned_by_event;
    // Every rule the panel can render has a key, so the UI never branches on
    // undefined for a rule this planner hasn't earned yet.
    for (const event of Object.keys(PLANNER_POINTS_BY_EVENT)) {
      expect(typeof byEvent[event as keyof typeof byEvent]).toBe("number");
    }
    expect(byEvent.client_linked).toBe(PLANNER_POINTS_BY_EVENT.client_linked);
    expect(byEvent.couple_invited).toBe(0);
    // The breakdown IS the total: a planner adding up the panel must land on the
    // hero number, or the panel is lying about where the points came from.
    const summed = Object.values(byEvent).reduce((a, b) => a + b, 0);
    expect(summed).toBe(r.data.points);
    expect(r.data.recent.length).toBeGreaterThan(0);
  });

  test("the rank rides along on the HTTP status", async () => {
    const planner = await makePlanner("pp-rank-http@weddly.test", "Http One");
    await makePlanner("pp-rank-http-peer@weddly.test", "Http Two");
    const r = await req<PlannerPointsStatus>("GET", "/api/planner/points", undefined, {
      token: planner.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.rank?.total).toBe(2);
    expect(r.data.rank?.rank).toBeGreaterThanOrEqual(1);
  });

  test("401 for anonymous, 403 for a couple user", async () => {
    await makePlanner("pp-guard@weddly.test");
    const anon = await req("GET", "/api/planner/points");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("pp-not-a-planner@weddly.test");
    const couple = await req("GET", "/api/planner/points", undefined, { token });
    expect(couple.status).toBe(403);
  });

  test("no HTTP surface can write the ledger", async () => {
    const planner = await makePlanner("pp-readonly@weddly.test");
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const r = await req(method, "/api/planner/points", {}, { token: planner.token });
      expect(r.status).toBe(404);
    }
    expect(plannerPointsTotal(planner.userId)).toBe(0);
  });
});
