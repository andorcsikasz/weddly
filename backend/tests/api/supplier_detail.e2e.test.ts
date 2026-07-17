// Admin-only supplier detail page — reviews, Q&A comments, booking inquiry,
// and the tracked /r/supplier/:id redirect. v1 is admin-write/admin-read; the
// guards live on the routes themselves so the same tests double as the
// Phase 3 baseline (downgrading requireAdmin → requireAuth is the only thing
// expected to change).

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { DIRECTORY } from "../../src/domain/suppliers_data";

async function registerAdmin(): Promise<string> {
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

/** Fresh state every test — supplier_reviews unique constraint on
 *  (supplier_id, couple_id) makes per-test isolation cheap. */
beforeEach(() => {
  wipeAll();
});

const curatedSupplierId = (): string => {
  const first = DIRECTORY[0];
  if (!first) throw new Error("DIRECTORY is empty — no curated supplier to test against");
  return first.id;
};

describe("supplier reviews (admin v1)", () => {
  test("non-admin gets 403 on review write", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const r = await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(curatedSupplierId())}/reviews`,
      { rating: 5, body: null, tags: [], published: true },
      { token },
    );
    expect(r.status).toBe(403);
  });

  test("admin can create a published review with tags", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const create = await req<{ id: number; rating: number; tags: string[]; editorial: boolean }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      { rating: 4, body: "Solid choice.", tags: ["parking", "english_speaking"], published: true },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.rating).toBe(4);
    expect(create.data.tags.sort()).toEqual(["english_speaking", "parking"]);
    // Admin author has no couple → couple_id NULL → editorial flag set.
    expect(create.data.editorial).toBe(true);

    const list = await req<{
      items: Array<{ id: number; published: boolean }>;
      summary: { avg_rating: number | null; reviews_count: number };
    }>("GET", `/api/suppliers/${encodeURIComponent(sid)}/reviews`, undefined, { token });
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(1);
    // Cold-start gate: avg is null below 3 published reviews.
    expect(list.data.summary.avg_rating).toBeNull();
    expect(list.data.summary.reviews_count).toBe(1);
  });

  test("aggregate avg_rating populates once threshold of 3 published reviews is reached", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();

    // Need 3 published reviews from distinct couples (or with NULL couple_id).
    // Admin author = NULL couple_id, so the partial unique index doesn't bite
    // when we insert directly under different author_user_ids. We bypass the
    // API to seed two extra admin-style rows (no second admin user exists in
    // the test env).
    const now = Date.now();
    const stmt = db.prepare(
      `INSERT INTO supplier_reviews
         (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, 1, ?, ?)`,
    );
    const adminUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("admin@test.test") as { id: number }
    ).id;
    stmt.run(sid, adminUserId, 5, now, now);
    stmt.run(sid, adminUserId, 3, now, now);

    // One more through the API to trigger the recompute.
    const create = await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      {
        rating: 4,
        body: null,
        tags: [],
        published: true,
      },
      { token },
    );
    expect(create.status).toBe(201);

    const list = await req<{ summary: { avg_rating: number | null; reviews_count: number } }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      undefined,
      { token },
    );
    expect(list.data.summary.reviews_count).toBe(3);
    expect(list.data.summary.avg_rating).toBeCloseTo(4, 5);
  });

  test("soft delete excludes the review from aggregates but keeps the row", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const create = await req<{ id: number }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      { rating: 5, body: null, tags: [], published: true },
      { token },
    );
    const reviewId = create.data.id;

    const del = await req("DELETE", `/api/reviews/${reviewId}`, undefined, { token });
    expect(del.status).toBe(200);

    const row = db.prepare("SELECT deleted_at FROM supplier_reviews WHERE id = ?").get(reviewId) as
      | { deleted_at: number | null }
      | undefined;
    expect(row?.deleted_at).not.toBeNull();

    const list = await req<{ items: unknown[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      undefined,
      { token },
    );
    expect(list.data.items.length).toBe(0);
  });
});

describe("supplier comments (admin v1)", () => {
  test("admin creates a top-level admin_internal comment by default", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const create = await req<{ id: number; visibility: string; parent_id: number | null }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "Triage: called Friday, mailbox full." },
      { token },
    );
    expect(create.status).toBe(201);
    expect(create.data.visibility).toBe("admin_internal");
    expect(create.data.parent_id).toBeNull();
  });

  test("rejects a reply to a reply (only one level of threading)", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const top = await req<{ id: number }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "Top" },
      { token },
    );
    const reply = await req<{ id: number }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "Mid", parent_id: top.data.id },
      { token },
    );
    expect(reply.status).toBe(201);

    const replyOfReply = await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "Deep", parent_id: reply.data.id },
      { token },
    );
    expect(replyOfReply.status).toBe(400);
  });
});

describe("supplier bookings (admin v1)", () => {
  test("createBooking rejects an unclaimed curated supplier (claimed-vendors-only)", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const { coupleId } = await bootstrapCouple("couple@test.test");
    const r = await req<{ error: string; detail?: { code?: string } }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/bookings`,
      { event_date: "2027-06-12", couple_id: coupleId },
      { token },
    );
    // 409 with code 'booking_unavailable' — the v1 contract.
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("booking_unavailable");
  });

  test("availability response signals unclaimed via bookable=false", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const r = await req<{
      bookable: boolean;
      unavailable_dates: string[];
      next_available: string | null;
    }>("GET", `/api/suppliers/${encodeURIComponent(sid)}/availability`, undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.bookable).toBe(false);
    expect(r.data.unavailable_dates).toEqual([]);
    expect(r.data.next_available).toBeNull();
  });
});

describe("tracked website redirect", () => {
  // Direct fetch (not the `req` helper) so we can keep the 302 instead of
  // letting fetch auto-follow.
  const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

  test("/r/supplier/:id 302s to the listing website for a curated entry", async () => {
    const sid = curatedSupplierId();
    const target = DIRECTORY.find((d) => d.id === sid)?.website ?? null;
    expect(target).not.toBeNull();
    const res = await fetch(`${BASE}/r/supplier/${encodeURIComponent(sid)}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")?.startsWith("http")).toBe(true);
  });

  test("/r/supplier/:id returns 404 when the supplier is unknown", async () => {
    const res = await fetch(`${BASE}/r/supplier/this-supplier-does-not-exist`, {
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/suppliers/:supplier_id detail endpoint", () => {
  test("admin viewer gets reviews_summary, comments_count, next_available, bookable", async () => {
    const token = await registerAdmin();
    const sid = curatedSupplierId();
    const r = await req<{
      id: string;
      reviews_summary: { reviews_count: number };
      comments_count?: number;
      next_available?: string | null;
      bookable: boolean;
    }>("GET", `/api/suppliers/${encodeURIComponent(sid)}`, undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(sid);
    expect(r.data.reviews_summary.reviews_count).toBe(0);
    // Admin-only fields are present (even if 0/null).
    expect(r.data.comments_count).toBeDefined();
    expect(r.data.bookable).toBe(false);
  });

  test("non-admin viewer gets reviews_summary + next_available but no comments_count", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req<{
      reviews_summary: { reviews_count: number };
      comments_count?: number;
      next_available?: string | null;
      bookable: boolean;
    }>("GET", `/api/suppliers/${encodeURIComponent(sid)}`, undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.reviews_summary.reviews_count).toBe(0);
    // comments_count stays admin-only — a moderation signal, not couple-facing.
    expect(r.data.comments_count).toBeUndefined();
    // next_available is now public (feeds the shortlist comparison dialog).
    // The key is present even for an unclaimed curated supplier, where it's null.
    expect("next_available" in r.data).toBe(true);
    expect(r.data.next_available).toBeNull();
  });
});

// The detail page is now couple-facing: reads are open to any authed viewer
// but role-scoped, while every write + the operational bookings list stay
// admin-only. These lock in that a couple can never see internal/admin notes,
// vendor-only notes, or unpublished review drafts.
describe("supplier detail opened to couples (role-scoped reads)", () => {
  test("couple sees only public comments — admin_internal and vendor_only are hidden", async () => {
    const adminToken = await registerAdmin();
    const sid = curatedSupplierId();
    for (const visibility of ["admin_internal", "public", "vendor_only"] as const) {
      const c = await req(
        "POST",
        `/api/suppliers/${encodeURIComponent(sid)}/comments`,
        { body: `${visibility} note`, visibility },
        { token: adminToken },
      );
      expect(c.status).toBe(201);
    }

    const { token } = await bootstrapCouple("couple@test.test");
    const list = await req<{ items: Array<{ visibility: string }> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(1);
    expect(list.data.items[0]?.visibility).toBe("public");

    // Admin still sees every tier.
    const adminList = await req<{ items: unknown[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      undefined,
      { token: adminToken },
    );
    expect(adminList.data.items.length).toBe(3);
  });

  test("couple sees only published reviews — drafts are hidden", async () => {
    const adminToken = await registerAdmin();
    const sid = curatedSupplierId();
    const now = Date.now();
    const adminUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("admin@test.test") as { id: number }
    ).id;
    const stmt = db.prepare(
      `INSERT INTO supplier_reviews
         (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    stmt.run(sid, adminUserId, 5, "published one", 1, now, now);
    stmt.run(sid, adminUserId, 2, "draft one", 0, now, now);

    const { token } = await bootstrapCouple("couple@test.test");
    const list = await req<{ items: Array<{ published: boolean }> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(1);
    expect(list.data.items[0]?.published).toBe(true);

    // Admin sees both the published row and the draft.
    const adminList = await req<{ items: unknown[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/reviews`,
      undefined,
      { token: adminToken },
    );
    expect(adminList.data.items.length).toBe(2);
  });

  test("couple can read availability (200)", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req<{ bookable: boolean }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(sid)}/availability`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(typeof r.data.bookable).toBe("boolean");
  });

  test("couple still gets 403 on comment write (writes stay admin-only)", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "can I ask something?", visibility: "public" },
      { token },
    );
    expect(r.status).toBe(403);
  });

  test("couple still gets 403 on the per-supplier bookings list (operational view)", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req("GET", `/api/suppliers/${encodeURIComponent(sid)}/bookings`, undefined, {
      token,
    });
    expect(r.status).toBe(403);
  });
});
