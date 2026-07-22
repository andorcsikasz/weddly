// Phase 3 verified reviews: a couple with engagement proof (cost-plan row or
// category pick) earns the "Verified" badge. Since reviews opened to any
// verified email, a couple WITHOUT proof can still post — the review just
// goes live unbadged. Own-review edit/delete works, and the moderation lever
// (published) remains admin-only. (The open community/visitor paths — flagging,
// visitor tokens — are covered in supplier_reviews_open.e2e.test.ts.)

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import type { ReviewListResponse, SupplierReview } from "@shared/suppliers";
import { CUSTOM_REVIEW_TAG_MAX_CHARS, MAX_REVIEW_TAGS } from "@shared/suppliers";
import { db, now } from "../../src/db";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const supplierId = (): string => {
  const first = DIRECTORY[0];
  if (!first) throw new Error("DIRECTORY is empty — no curated supplier to test against");
  return first.id;
};

async function registerAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

function addCostRow(coupleId: number, sid: string): void {
  const ts = now();
  db.prepare(
    `INSERT INTO couple_supplier_costs (couple_id, supplier_id, planned_huf, actual_huf, created_at, updated_at)
     VALUES (?, ?, 100000, 0, ?, ?)`,
  ).run(coupleId, sid, ts, ts);
}

function addPickRow(coupleId: number, sid: string): void {
  db.prepare(
    `INSERT INTO couple_picks (couple_id, category, supplier_id, picked_at)
     VALUES (?, 'photo_video', ?, ?)`,
  ).run(coupleId, sid, now());
}

function reviewsUrl(sid: string): string {
  return `/api/suppliers/${encodeURIComponent(sid)}/reviews`;
}

beforeEach(() => {
  wipeAll();
});

describe("verified couple reviews (Phase 3)", () => {
  test("no engagement proof → open review allowed but unverified (no badge)", async () => {
    const { token } = await bootstrapCouple("noproof@test.test");
    const sid = supplierId();

    const list = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, { token });
    expect(list.status).toBe(200);
    // Reviews are open to any verified user now — the composer opens even
    // without engagement proof; the review just won't carry the Verified badge.
    expect(list.data.can_review).toBe(true);
    expect(list.data.already_reviewed).toBe(false);

    const r = await req<SupplierReview>("POST", reviewsUrl(sid), { rating: 5 }, { token });
    expect(r.status).toBe(201);
    expect(r.data.editorial).toBe(false);
    expect(r.data.verified).toBe(false);
  });

  test("cost-plan row unlocks a live, non-editorial review", async () => {
    const { token, coupleId } = await bootstrapCouple("cost@test.test");
    const sid = supplierId();
    addCostRow(coupleId, sid);

    const list = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, { token });
    expect(list.data.can_review).toBe(true);

    const create = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 4, body: "Rugalmasak es pontosak voltak.", tags: [] },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.editorial).toBe(false);
    // Couple reviews go live immediately — the engagement gate IS the moderation.
    expect(create.data.published).toBe(true);

    const after = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, { token });
    expect(after.data.items.map((i) => i.id)).toContain(create.data.id);
    expect(after.data.items.find((i) => i.id === create.data.id)?.own).toBe(true);
    expect(after.data.can_review).toBe(false);
    expect(after.data.already_reviewed).toBe(true);
  });

  test("category pick also counts as engagement proof", async () => {
    const { token, coupleId } = await bootstrapCouple("pick@test.test");
    const sid = supplierId();
    addPickRow(coupleId, sid);

    const create = await req<SupplierReview>("POST", reviewsUrl(sid), { rating: 5 }, { token });
    expect(create.status).toBe(201);
  });

  test("one review per couple per supplier (409 on the second)", async () => {
    const { token, coupleId } = await bootstrapCouple("dupe@test.test");
    const sid = supplierId();
    addCostRow(coupleId, sid);

    const first = await req("POST", reviewsUrl(sid), { rating: 5 }, { token });
    expect(first.status).toBe(201);
    const second = await req("POST", reviewsUrl(sid), { rating: 1 }, { token });
    expect(second.status).toBe(409);
  });

  test("own review is editable/deletable; foreign review is not; published stays admin-only", async () => {
    const a = await bootstrapCouple("author@test.test");
    const sid = supplierId();
    addCostRow(a.coupleId, sid);
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 3, body: "Ok" },
      { token: a.token },
    );
    expect(created.status).toBe(201);
    const reviewId = created.data.id;

    // Author edits rating/body — fine.
    const edit = await req<SupplierReview>(
      "PATCH",
      `/api/reviews/${reviewId}`,
      { rating: 4, body: "Jobb, mint elsore tunt." },
      { token: a.token },
    );
    expect(edit.status).toBe(200);
    expect(edit.data.rating).toBe(4);

    // Author may NOT touch the moderation lever.
    const unpublish = await req(
      "PATCH",
      `/api/reviews/${reviewId}`,
      { published: false },
      { token: a.token },
    );
    expect(unpublish.status).toBe(403);

    // A different couple can't edit or delete it.
    const b = await bootstrapCouple("other@test.test");
    const foreignEdit = await req(
      "PATCH",
      `/api/reviews/${reviewId}`,
      { rating: 1 },
      { token: b.token },
    );
    expect(foreignEdit.status).toBe(403);
    const foreignDelete = await req("DELETE", `/api/reviews/${reviewId}`, undefined, {
      token: b.token,
    });
    expect(foreignDelete.status).toBe(403);

    // Author deletes their own.
    const del = await req("DELETE", `/api/reviews/${reviewId}`, undefined, { token: a.token });
    expect(del.status).toBe(200);
    // Slot frees up: the couple may review again after deleting.
    const again = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, {
      token: a.token,
    });
    expect(again.data.already_reviewed).toBe(false);
    expect(again.data.can_review).toBe(true);
  });

  test("admin keeps editorial powers: draft create, publish toggle, delete any", async () => {
    const adminToken = await registerAdmin();
    const couple = await bootstrapCouple("couple2@test.test");
    const sid = supplierId();
    addCostRow(couple.coupleId, sid);
    const coupleReview = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 2 },
      { token: couple.token },
    );
    expect(coupleReview.status).toBe(201);

    const draft = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, body: "Editorial take", published: false },
      { token: adminToken },
    );
    expect(draft.status).toBe(201);
    expect(draft.data.editorial).toBe(true);
    expect(draft.data.published).toBe(false);

    const publish = await req<SupplierReview>(
      "PATCH",
      `/api/reviews/${draft.data.id}`,
      { published: true },
      { token: adminToken },
    );
    expect(publish.status).toBe(200);
    expect(publish.data.published).toBe(true);

    const delForeign = await req("DELETE", `/api/reviews/${coupleReview.data.id}`, undefined, {
      token: adminToken,
    });
    expect(delForeign.status).toBe(200);
  });
});

describe("free-text review tags (+1)", () => {
  // Reads come back sorted by tag (the (review_id, tag) primary key), so these
  // assert set membership, not order.
  test("accepts a mix of controlled and free-text tags, stored verbatim", async () => {
    const { token } = await bootstrapCouple("customtag@test.test");
    const sid = supplierId();
    const create = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, tags: ["professional", "great with pets", "budget-friendly"] },
      { token },
    );
    expect(create.status).toBe(201);
    expect([...create.data.tags].sort()).toEqual(
      ["budget-friendly", "great with pets", "professional"].sort(),
    );

    // Round-trips through the read path (loadTagsForReviews keeps free text).
    const list = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, { token });
    const roundTripped = list.data.items.find((i) => i.id === create.data.id)?.tags ?? [];
    expect([...roundTripped].sort()).toEqual(
      ["budget-friendly", "great with pets", "professional"].sort(),
    );
  });

  test("free text matching the vocabulary folds onto the controlled tag (dedup)", async () => {
    const { token } = await bootstrapCouple("foldtag@test.test");
    const sid = supplierId();
    const create = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 4, tags: ["professional", "Professional", "english speaking"] },
      { token },
    );
    expect(create.status).toBe(201);
    expect([...create.data.tags].sort()).toEqual(["english_speaking", "professional"]);
  });

  test("rejects a malformed free-text tag with 400", async () => {
    const { token } = await bootstrapCouple("badtag@test.test");
    const sid = supplierId();
    const badChars = await req(
      "POST",
      reviewsUrl(sid),
      { rating: 3, tags: ["<script>"] },
      { token },
    );
    expect(badChars.status).toBe(400);
    const tooLong = await req(
      "POST",
      reviewsUrl(sid),
      { rating: 3, tags: ["x".repeat(CUSTOM_REVIEW_TAG_MAX_CHARS + 1)] },
      { token },
    );
    expect(tooLong.status).toBe(400);
  });

  test("total tags (controlled + free-text) capped at MAX_REVIEW_TAGS", async () => {
    const { token } = await bootstrapCouple("captag@test.test");
    const sid = supplierId();
    const create = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      {
        rating: 5,
        tags: ["professional", "friendly", "reliable", "punctual", "creative", "one extra"],
      },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.tags).toHaveLength(MAX_REVIEW_TAGS);
    expect(create.data.tags).not.toContain("one extra");
  });
});
