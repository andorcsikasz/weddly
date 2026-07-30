// Planner reviews — the 5-star rating a couple leaves on a planner ACCOUNT.
//
// Planners share the supplier review stack through a `planner:{id}` subject
// (shared/planner_reviews.ts), so most of what is asserted here is that the
// sharing is real: one aggregate table, one moderation queue, one composer.
// What is genuinely planner-specific gets its own tests — the existence check
// on the subject, and the accepted client link standing in for engagement
// proof.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { plannerReviewSubjectId } from "@shared/planner_reviews";
import type { SupplierReview } from "@shared/suppliers";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import { db, now } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** A listable planner account (the directory needs business name + city). */
async function makePlanner(email: string): Promise<number> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  expect(reg.status).toBe(201);
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;
  db.prepare("UPDATE users SET business_name = ?, planner_city = ? WHERE id = ?").run(
    "Nagy Weddings",
    "Budapest",
    userId,
  );
  return userId;
}

function link(plannerUserId: number, coupleId: number, status = "active"): void {
  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, ?, ?)",
  ).run(plannerUserId, coupleId, status, now());
}

function postReview(
  plannerUserId: number,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: SupplierReview & { detail?: { code?: string } } }> {
  return req(`POST` as const, `/api/planners/${plannerUserId}/reviews`, body, { token });
}

function listReviews(plannerUserId: number, token: string) {
  return req<{
    items: SupplierReview[];
    can_review: boolean;
    already_reviewed: boolean;
    summary: { avg_rating: number | null; reviews_count: number };
  }>("GET", `/api/planners/${plannerUserId}/reviews`, undefined, { token });
}

describe("planner reviews", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("a couple rates a planner and the review comes back on the list", async () => {
    const plannerId = await makePlanner("pr-planner@weddly.test");
    const { token } = await bootstrapCouple("pr-couple@weddly.test");

    const r = await postReview(plannerId, token, {
      rating: 5,
      body: "Calm, organised, answered everything.",
    });
    expect(r.status).toBe(201);
    expect(r.data.rating).toBe(5);

    const list = await listReviews(plannerId, token);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]?.body).toBe("Calm, organised, answered everything.");
    expect(list.data.already_reviewed).toBe(true);
    expect(list.data.can_review).toBe(false);
  });

  test("the row is keyed on the planner subject, not on a bare id", async () => {
    const plannerId = await makePlanner("pr-key@weddly.test");
    const { token } = await bootstrapCouple("pr-key-couple@weddly.test");
    await postReview(plannerId, token, { rating: 4 });

    const row = db
      .prepare("SELECT supplier_id FROM supplier_reviews ORDER BY id DESC LIMIT 1")
      .get() as { supplier_id: string };
    expect(row.supplier_id).toBe(plannerReviewSubjectId(plannerId));
    // A supplier whose id happens to be the planner's number sees nothing.
    const bare = await req<{ items: SupplierReview[] }>(
      "GET",
      `/api/suppliers/${plannerId}/reviews`,
      undefined,
      { token },
    );
    expect(bare.data.items).toHaveLength(0);
  });

  test("an unknown planner 404s instead of seeding an aggregate", async () => {
    const { token } = await bootstrapCouple("pr-404@weddly.test");
    const r = await postReview(999_999, token, { rating: 5 });
    expect(r.status).toBe(404);
    const n = db.prepare("SELECT COUNT(*) AS n FROM supplier_aggregates").get() as { n: number };
    expect(n.n).toBe(0);
  });

  test("a couple id is not a planner id", async () => {
    // The couple's own user id must not be reviewable as a planner: the subject
    // resolver checks user_type, not just that the row exists.
    const { token } = await bootstrapCouple("pr-notplanner@weddly.test");
    const own = db
      .prepare("SELECT id FROM users WHERE LOWER(email) = 'pr-notplanner@weddly.test'")
      .get() as { id: number };
    const r = await postReview(own.id, token, { rating: 5 });
    expect(r.status).toBe(404);
  });

  describe("engagement proof is the accepted client link", () => {
    test("a linked couple's review is verified, and a low rating is not flagged", async () => {
      const plannerId = await makePlanner("pr-linked@weddly.test");
      const { token, coupleId } = await bootstrapCouple("pr-linked-couple@weddly.test");
      link(plannerId, coupleId);

      const r = await postReview(plannerId, token, { rating: 1, body: "Not for us." });
      expect(r.status).toBe(201);
      const row = db
        .prepare("SELECT verified, flagged FROM supplier_reviews WHERE id = ?")
        .get(r.data.id) as { verified: number; flagged: number };
      expect(row.verified).toBe(1);
      expect(row.flagged).toBe(0);
    });

    test("an unlinked couple's low rating goes live but lands in the queue", async () => {
      const plannerId = await makePlanner("pr-unlinked@weddly.test");
      const { token } = await bootstrapCouple("pr-unlinked-couple@weddly.test");

      const r = await postReview(plannerId, token, { rating: 2, body: "Hmm." });
      expect(r.status).toBe(201);
      const row = db
        .prepare("SELECT verified, flagged, published FROM supplier_reviews WHERE id = ?")
        .get(r.data.id) as { verified: number; flagged: number; published: number };
      expect(row.verified).toBe(0);
      expect(row.flagged).toBe(1);
      // Flagged is for moderation, never a hidden review.
      expect(row.published).toBe(1);
    });

    test("a PENDING link is not proof — only an accepted one", async () => {
      const plannerId = await makePlanner("pr-pending@weddly.test");
      const { token, coupleId } = await bootstrapCouple("pr-pending-couple@weddly.test");
      link(plannerId, coupleId, "pending");

      const r = await postReview(plannerId, token, { rating: 5 });
      const row = db
        .prepare("SELECT verified FROM supplier_reviews WHERE id = ?")
        .get(r.data.id) as { verified: number };
      expect(row.verified).toBe(0);
    });
  });

  test("one review per couple per planner", async () => {
    const plannerId = await makePlanner("pr-dupe@weddly.test");
    const { token } = await bootstrapCouple("pr-dupe-couple@weddly.test");
    expect((await postReview(plannerId, token, { rating: 5 })).status).toBe(201);

    const second = await postReview(plannerId, token, { rating: 4 });
    expect(second.status).toBe(409);
    expect(second.data.detail?.code).toBe("already_reviewed");
  });

  test("the average reaches the card and the detail only above the cold-start floor", async () => {
    const plannerId = await makePlanner("pr-agg@weddly.test");
    const couples = [];
    for (let i = 0; i < 3; i++) {
      couples.push(await bootstrapCouple(`pr-agg-${i}@weddly.test`));
    }
    const viewer = couples[0]!;

    // Two reviews: counted, but no average yet.
    await postReview(plannerId, couples[0]!.token, { rating: 5 });
    await postReview(plannerId, couples[1]!.token, { rating: 4 });
    let detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${plannerId}`,
      undefined,
      { token: viewer.token },
    );
    expect(detail.data.reviews_count).toBe(2);
    expect(detail.data.rating).toBeNull();

    // The third crosses the floor.
    await postReview(plannerId, couples[2]!.token, { rating: 3 });
    detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${plannerId}`,
      undefined,
      { token: viewer.token },
    );
    expect(detail.data.reviews_count).toBe(3);
    expect(detail.data.rating).toBeCloseTo(4, 5);
    expect(detail.data.reviews_summary.histogram[4]).toBe(1); // one 5-star

    // And the same numbers ride the directory card, from the joined aggregate.
    const dir = await req<{ planners: PlannerDirectoryEntry[] }>(
      "GET",
      "/api/couples/planner-directory",
      undefined,
      { token: viewer.token },
    );
    const card = dir.data.planners.find((p) => p.planner_user_id === plannerId);
    expect(card?.rating).toBeCloseTo(4, 5);
    expect(card?.reviews_count).toBe(3);
  });

  test("the admin moderation queue can name the planner a flagged review is about", async () => {
    const plannerId = await makePlanner("pr-queue@weddly.test");
    const { token } = await bootstrapCouple("pr-queue-couple@weddly.test");
    await postReview(plannerId, token, { rating: 1, body: "No." });

    const admin = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Admin",
    });
    const q = await req<{ items: Array<{ supplier_id: string; supplier_name: string | null }> }>(
      "GET",
      "/api/admin/reviews/flagged",
      undefined,
      { token: admin.data.token },
    );
    expect(q.status).toBe(200);
    const item = q.data.items.find((i) => i.supplier_id === plannerReviewSubjectId(plannerId));
    // Without the planner join this row would arrive with a null name, asking a
    // moderator to judge a 1-star review of a business it cannot name.
    expect(item?.supplier_name).toBe("Nagy Weddings");
  });
});
