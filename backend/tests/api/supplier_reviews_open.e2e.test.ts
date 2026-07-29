// Open reviews: anyone with a verified email may review a supplier, and an
// email-verified VISITOR (no account, Google-attested here) may review from the
// public page. Low (1-2 star) open reviews are auto-published but FLAGGED for
// admin moderation. Engaged couples keep the "Verified" badge and never flag.
//
// The visitor identity + reserved system user come from the verified-visitor
// infra (domain/verified_visitors.ts, db.ts); this suite drives the review side.
//
// Registration is argon2 (seconds under load), so we register the fixtures ONCE
// in beforeAll and only reset the review + visitor tables between tests.

import "../setup";

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  AdminFlaggedReviewsResponse,
  ReviewListResponse,
  SupplierReview,
} from "@shared/suppliers";
import type { AuthSession } from "@shared/types";
import type { VisitorSession } from "@shared/verified_visitors";
import { db } from "../../src/db";
import { req, registerAndVerify, wipeAll } from "../helpers";

const importMint = () => import("../../src/lib/google_oauth");

const reviewsUrl = (sid: string) => `/api/suppliers/${encodeURIComponent(sid)}/reviews`;
const publicReviewsUrl = (sid: string) =>
  `/api/public/suppliers/${encodeURIComponent(sid)}/reviews`;

let adminToken = "";
let readerToken = ""; // a verified user with NO couple workspace
let coupleToken = "";
let coupleId = 0;

/** Verify a visitor through the Google one-tap path (E2E bypass), returning
 *  their device token + stored display name. */
async function googleVisitor(
  email: string,
  name = "Anna Kovács",
): Promise<{ id: number; token: string; display: string }> {
  const { mintTestBearer } = await importMint();
  const credential = mintTestBearer({ sub: `sub-${email}`, email, name, emailVerified: true });
  const res = await req<VisitorSession>("POST", "/api/visitors/verify/google", { credential });
  expect(res.status).toBe(201);
  return {
    id: res.data.visitor.id,
    token: res.data.token,
    display: res.data.visitor.full_name ?? "",
  };
}

function grantEngagementProof(cid: number, sid: string): void {
  const ts = Date.now();
  db.prepare(
    `INSERT INTO couple_supplier_costs (couple_id, supplier_id, planned_huf, actual_huf, created_at, updated_at)
     VALUES (?, ?, 100000, 0, ?, ?)`,
  ).run(cid, sid, ts, ts);
}

beforeAll(async () => {
  wipeAll();

  const admin = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (admin.status === 201) {
    adminToken = admin.data.token;
  } else {
    // Another suite in this run already created the admin — log in instead.
    const login = await req<AuthSession>("POST", "/api/auth/login", {
      email: "admin@test.test",
      password: "supersafe123",
    });
    adminToken = login.data.token;
  }

  const reader = await registerAndVerify({
    email: "reader-open@weddly.test",
    password: "supersafe123",
    full_name: "Béla Nagy",
  });
  readerToken = reader.data.token;

  const couple = await registerAndVerify({
    email: "couple-open@weddly.test",
    password: "supersafe123",
    full_name: "Owner",
  });
  coupleToken = couple.data.token;
  const ob = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mia & Lucas",
      wedding_date: "2026-09-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
    },
    { token: coupleToken },
  );
  coupleId = ob.data.couple.id;
}, 180_000);

beforeEach(() => {
  // Reset only the review + visitor state — keep the argon2-expensive fixtures.
  db.prepare("DELETE FROM supplier_review_tags").run();
  db.prepare("DELETE FROM supplier_reviews").run();
  db.prepare("DELETE FROM supplier_aggregates").run();
  db.prepare("DELETE FROM verified_visitor_sessions").run();
  db.prepare("DELETE FROM verified_visitors").run();
});

describe("open reviews — logged-in users", () => {
  test("a verified user with no couple can review; second attempt is a 409", async () => {
    const sid = "c-open-1";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5 },
      { token: readerToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.editorial).toBe(false);
    expect(created.data.verified).toBe(false);

    const list = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, {
      token: readerToken,
    });
    expect(list.data.items[0]?.author.display_name).toBe("Béla N.");
    expect(list.data.already_reviewed).toBe(true);
    expect(list.data.can_review).toBe(false);

    const dup = await req("POST", reviewsUrl(sid), { rating: 4 }, { token: readerToken });
    expect(dup.status).toBe(409);
  });

  test("a couple WITHOUT engagement proof can now review; a low rating is flagged", async () => {
    const sid = "c-open-2";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 2 },
      { token: coupleToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.verified).toBe(false);

    const row = db
      .prepare("SELECT flagged FROM supplier_reviews WHERE id = ?")
      .get(created.data.id) as {
      flagged: number;
    };
    expect(row.flagged).toBe(1);
  });

  test("a couple WITH engagement proof is verified and never flagged", async () => {
    const sid = "c-open-3";
    grantEngagementProof(coupleId, sid);
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 1 },
      { token: coupleToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.verified).toBe(true);

    const row = db
      .prepare("SELECT flagged FROM supplier_reviews WHERE id = ?")
      .get(created.data.id) as {
      flagged: number;
    };
    expect(row.flagged).toBe(0);
  });
});

describe("open reviews — verified visitors (Google)", () => {
  test("google-verify returns a device token and the stored display name", async () => {
    const v = await googleVisitor("anna@example.com", "Anna Kovács");
    expect(v.token.length).toBeGreaterThan(10);
    expect(v.display).toBe("Anna Kovács");
  });

  test("emailVerified:false is rejected at verify", async () => {
    const { mintTestBearer } = await importMint();
    const credential = mintTestBearer({
      sub: "sub-unv",
      email: "unv@example.com",
      name: "U V",
      emailVerified: false,
    });
    const res = await req("POST", "/api/visitors/verify/google", { credential });
    expect(res.status).toBe(400);
  });

  test("a visitor review (rating 5) is live and shows the shortened author name", async () => {
    const v = await googleVisitor("vis5@example.com", "Anna Kovács");
    const sid = "c-vis-5";
    const created = await req<SupplierReview>(
      "POST",
      publicReviewsUrl(sid),
      { rating: 5, body: "Remek volt", tags: ["professional"] },
      { headers: { "X-Visitor-Token": v.token } },
    );
    expect(created.status).toBe(201);
    expect(created.data.verified).toBe(false);

    const list = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, {
      token: readerToken,
    });
    expect(list.data.items[0]?.author.display_name).toBe("Anna K.");

    const row = db
      .prepare("SELECT flagged FROM supplier_reviews WHERE id = ?")
      .get(created.data.id) as {
      flagged: number;
    };
    expect(row.flagged).toBe(0);
  });

  test("a visitor review (rating 1) is flagged and shows in the admin queue; admin can unflag", async () => {
    const v = await googleVisitor("vis1@example.com", "Cintia Tóth");
    const sid = "c-vis-1";
    const created = await req<SupplierReview>(
      "POST",
      publicReviewsUrl(sid),
      { rating: 1, body: "Csalódás" },
      { headers: { "X-Visitor-Token": v.token } },
    );
    expect(created.status).toBe(201);

    const queue = await req<AdminFlaggedReviewsResponse>(
      "GET",
      "/api/admin/reviews/flagged",
      undefined,
      {
        token: adminToken,
      },
    );
    expect(queue.status).toBe(200);
    const found = queue.data.items.find((r) => r.id === created.data.id);
    expect(found).toBeDefined();
    expect(found?.author_kind).toBe("visitor");
    expect(found?.author_display_name).toBe("Cintia T.");

    const unflag = await req("POST", `/api/admin/reviews/${created.data.id}/unflag`, undefined, {
      token: adminToken,
    });
    expect(unflag.status).toBe(200);
    const after = await req<AdminFlaggedReviewsResponse>(
      "GET",
      "/api/admin/reviews/flagged",
      undefined,
      {
        token: adminToken,
      },
    );
    expect(after.data.items.find((r) => r.id === created.data.id)).toBeUndefined();
  });

  test("one review per visitor per supplier (second is a 409)", async () => {
    const v = await googleVisitor("dupe@example.com");
    const sid = "c-vis-dup";
    const first = await req(
      "POST",
      publicReviewsUrl(sid),
      { rating: 4 },
      { headers: { "X-Visitor-Token": v.token } },
    );
    expect(first.status).toBe(201);
    const second = await req(
      "POST",
      publicReviewsUrl(sid),
      { rating: 3 },
      { headers: { "X-Visitor-Token": v.token } },
    );
    expect(second.status).toBe(409);
  });

  test("missing or garbage visitor token is rejected", async () => {
    const sid = "c-vis-noauth";
    const none = await req("POST", publicReviewsUrl(sid), { rating: 5 });
    expect(none.status).toBe(401);
    const garbage = await req(
      "POST",
      publicReviewsUrl(sid),
      { rating: 5 },
      { headers: { "X-Visitor-Token": "not-a-real-token" } },
    );
    expect(garbage.status).toBe(401);
  });
});

// Being staff is a role, not an identity: an admin who actually hired a
// supplier has to be able to say so under their own name, and that is the
// DEFAULT. The editorial voice is opt-in, because an omitted flag used to mean
// "Weddly editors, unpublished", i.e. a review visible to nobody but its author.
describe("an admin choosing their own voice", () => {
  test("as_editorial:false posts an ordinary, live review under their own name", async () => {
    const sid = "c-admin-self";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, body: "Best pizza in town", as_editorial: false },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.editorial).toBe(false);
    // Ordinary terms: live at once, no verified badge without engagement proof.
    expect(created.data.published).toBe(true);
    expect(created.data.verified).toBe(false);
    expect(created.data.author.display_name).not.toBe("Weddly editors");

    // And it dedups like anyone else's — one review per person per supplier.
    const dup = await req(
      "POST",
      reviewsUrl(sid),
      { rating: 4, as_editorial: false },
      { token: adminToken },
    );
    expect(dup.status).toBe(409);
  });

  test("a low own-name rating from an admin flags for moderation like any other", async () => {
    const sid = "c-admin-self-low";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 1, as_editorial: false },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    const row = db
      .prepare("SELECT flagged, author_kind FROM supplier_reviews WHERE id = ?")
      .get(created.data.id) as { flagged: number; author_kind: string };
    expect(row.flagged).toBe(1);
    expect(row.author_kind).not.toBe("admin");
  });

  // The regression that hid a real 5-star review from the vendor it was about:
  // every caller that doesn't mention the flag (RateVendorsPage's one-tap star,
  // any future client) must get an ordinary, LIVE review.
  test("omitting the flag posts an ordinary live review, not an editorial draft", async () => {
    const sid = "c-admin-default";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5 },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.editorial).toBe(false);
    expect(created.data.published).toBe(true);
    expect(created.data.author.display_name).not.toBe("Weddly editors");
  });

  test("as_editorial:true still opts into the editorial voice, live by default", async () => {
    const sid = "c-admin-editorial";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, body: "An editors' pick.", as_editorial: true },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.editorial).toBe(true);
    expect(created.data.author.display_name).toBe("Weddly editors");
    // Live unless the admin explicitly asks for a draft: an unpublished row has
    // no queue anywhere in admin, so a silent draft is a lost review.
    expect(created.data.published).toBe(true);
  });

  test("as_editorial:true with published:false still parks an explicit draft", async () => {
    const sid = "c-admin-editorial-draft";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, as_editorial: true, published: false },
      { token: adminToken },
    );
    expect(created.status).toBe(201);
    expect(created.data.editorial).toBe(true);
    expect(created.data.published).toBe(false);
  });

  // The reported bug, from the side that noticed it. An admin rated a supplier
  // 5 stars and the vendor's portal showed nothing, because the admin's own
  // read passes `includeUnpublished: true`, so the author saw their review
  // sitting right there (with a small "Draft" pill) while every other reader,
  // the vendor included, got an empty list. Two viewers, one endpoint, opposite
  // answers, no error anywhere.
  test("a review an admin writes is visible to everyone else, not just to them", async () => {
    const sid = "c-admin-visible-to-vendor";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(sid),
      { rating: 5, body: "They were wonderful on the day." },
      { token: adminToken },
    );
    expect(created.status).toBe(201);

    // `readerToken` is an ordinary verified user with no workspace, exactly the
    // privilege level /vendor/reviews reads at.
    const asReader = await req<ReviewListResponse>("GET", reviewsUrl(sid), undefined, {
      token: readerToken,
    });
    expect(asReader.status).toBe(200);
    expect(asReader.data.items.map((r) => r.id)).toContain(created.data.id);
    // And it counts, so the aggregate, the admin vendor row and the vendor's
    // notification bell all agree with the page.
    expect(asReader.data.summary.reviews_count).toBe(1);
  });
});

// Reviews are keyed by a bare TEXT `supplier_id` with no FK, so whatever string
// arrives becomes the key forever. The pretty share form is what every "collect
// reviews" link carries, which made this the likeliest way to lose one.
describe("supplier id canonicalisation", () => {
  test("a review posted to the pretty share id lands on the listing itself", async () => {
    const bare = "v4242";
    const pretty = "magyar-foto-v4242";
    const created = await req<SupplierReview>(
      "POST",
      reviewsUrl(pretty),
      { rating: 5, body: "Found them through their own link." },
      { token: readerToken },
    );
    expect(created.status).toBe(201);

    // Stored against the listing id, not the URL slug. Keyed raw, this review
    // was invisible to /vendor/reviews, to supplier_aggregates, to the admin
    // counters and to Weddly Points, while still showing on the page it was
    // written from: self-consistently lost.
    const row = db
      .prepare("SELECT supplier_id FROM supplier_reviews WHERE id = ?")
      .get(created.data.id) as { supplier_id: string };
    expect(row.supplier_id).toBe(bare);

    // Both spellings therefore read the same review.
    for (const id of [bare, pretty]) {
      const list = await req<ReviewListResponse>("GET", reviewsUrl(id), undefined, {
        token: readerToken,
      });
      expect(list.status).toBe(200);
      expect(list.data.items.map((r) => r.id)).toContain(created.data.id);
    }
  });

  test("one review per person per supplier survives the two spellings", async () => {
    await req("POST", reviewsUrl("v4343"), { rating: 5 }, { token: readerToken });
    // Without canonicalisation the pretty form was a different key, so the
    // partial unique index never fired and one person could rate twice.
    const dup = await req(
      "POST",
      reviewsUrl("studio-nev-v4343"),
      { rating: 1 },
      { token: readerToken },
    );
    expect(dup.status).toBe(409);
  });
});
