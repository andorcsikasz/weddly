// /api/wishlist — couple-facing gift-registry CRUD. Mirrors the schedule
// aggregate: requireAuth + couple scoping, If-Match optimistic concurrency on
// PATCH, audit-log rows on create/update/delete, hand-written boundary
// validation. The guest-side embed + interest toggle are exercised in
// public_wedding.e2e.test.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import type { WishlistContributorsResult, WishlistItem } from "@shared/wishlist";

function auditCount(coupleId: number, action: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = ?")
    .get(coupleId, action) as { n: number };
  return row.n;
}

describe("/api/wishlist — CRUD lifecycle", () => {
  test("create → list → stale If-Match 409 → correct If-Match 200 → delete", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("wishlist-crud@weddly.test");

    // Empty to start.
    const empty = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token,
    });
    expect(empty.status).toBe(200);
    expect(empty.data.items.length).toBe(0);

    // Create.
    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      {
        title: "Espresso machine",
        description: "We'd love a good one",
        kind: "group_gift",
        target_amount_minor: 250000,
        url: "https://shop.example/espresso",
      },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.title).toBe("Espresso machine");
    expect(created.data.item.kind).toBe("gift");
    expect(created.data.item.target_amount_minor).toBe(250000);
    expect(created.data.item.url).toBe("https://shop.example/espresso");
    expect(auditCount(coupleId, "wishlist.item_create")).toBe(1);

    const itemId = created.data.item.id;
    const firstUpdatedAt = created.data.item.updated_at;

    // List shows the one item.
    const listed = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token,
    });
    expect(listed.data.items.length).toBe(1);
    expect(listed.data.items[0]!.id).toBe(itemId);

    // Stale If-Match → 409.
    const stale = await req(
      "PATCH",
      `/api/wishlist/${itemId}`,
      { title: "Espresso machine (deluxe)" },
      { token, headers: { "If-Match": String(firstUpdatedAt - 1) } },
    );
    expect(stale.status).toBe(409);

    // Correct If-Match → 200.
    const ok = await req<{ item: WishlistItem }>(
      "PATCH",
      `/api/wishlist/${itemId}`,
      { title: "Espresso machine (deluxe)" },
      { token, headers: { "If-Match": String(firstUpdatedAt) } },
    );
    expect(ok.status).toBe(200);
    expect(ok.data.item.title).toBe("Espresso machine (deluxe)");
    expect(auditCount(coupleId, "wishlist.item_update")).toBe(1);

    // Delete.
    const del = await req("DELETE", `/api/wishlist/${itemId}`, undefined, { token });
    expect(del.status).toBe(200);
    expect(auditCount(coupleId, "wishlist.item_delete")).toBe(1);

    const afterDelete = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token,
    });
    expect(afterDelete.data.items.length).toBe(0);
  });

  test("items list ordered by sort_order ASC, id ASC", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-order@weddly.test");
    await req("POST", "/api/wishlist", { title: "B", sort_order: 10 }, { token });
    await req("POST", "/api/wishlist", { title: "A", sort_order: 0 }, { token });
    await req("POST", "/api/wishlist", { title: "C", sort_order: 0 }, { token });
    const listed = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token,
    });
    // sort_order 0 rows first (A then C by id), then sort_order 10 (B).
    expect(listed.data.items.map((i) => i.title)).toEqual(["A", "C", "B"]);
  });
});

describe("/api/wishlist — couple scoping", () => {
  test("couple B gets 404 on couple A's item (PATCH + DELETE)", async () => {
    wipeAll();
    const a = await bootstrapCouple("wishlist-scope-a@weddly.test");
    const b = await bootstrapCouple("wishlist-scope-b@weddly.test");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "A's gift" },
      { token: a.token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // B cannot see it in their own list.
    const bList = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token: b.token,
    });
    expect(bList.data.items.length).toBe(0);

    // B cannot PATCH it.
    const bPatch = await req(
      "PATCH",
      `/api/wishlist/${itemId}`,
      { title: "hijack" },
      { token: b.token },
    );
    expect(bPatch.status).toBe(404);

    // B cannot DELETE it.
    const bDelete = await req("DELETE", `/api/wishlist/${itemId}`, undefined, { token: b.token });
    expect(bDelete.status).toBe(404);

    // A's item is untouched.
    const aList = await req<{ items: WishlistItem[] }>("GET", "/api/wishlist", undefined, {
      token: a.token,
    });
    expect(aList.data.items.length).toBe(1);
    expect(aList.data.items[0]!.title).toBe("A's gift");
  });
});

describe("/api/wishlist — boundary validation", () => {
  test("missing title → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-no-title@weddly.test");
    const r = await req("POST", "/api/wishlist", { description: "no title" }, { token });
    expect(r.status).toBe(400);
  });

  test("over-length title / description / url → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-overlen@weddly.test");

    const longTitle = await req("POST", "/api/wishlist", { title: "x".repeat(201) }, { token });
    expect(longTitle.status).toBe(400);

    const longDesc = await req(
      "POST",
      "/api/wishlist",
      { title: "ok", description: "y".repeat(2001) },
      { token },
    );
    expect(longDesc.status).toBe(400);

    const longUrl = await req(
      "POST",
      "/api/wishlist",
      { title: "ok", url: `https://e.example/${"z".repeat(2050)}` },
      { token },
    );
    expect(longUrl.status).toBe(400);
  });

  test("non-http url (data: / javascript: / malformed) → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-bad-url@weddly.test");
    for (const url of ["data:text/html,x", "javascript:alert(1)", "not a url", "ftp://x.example"]) {
      const r = await req("POST", "/api/wishlist", { title: "ok", url }, { token });
      expect(r.status).toBe(400);
    }
  });

  test("bad kind → 400; negative target_amount_minor → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-bad-kind@weddly.test");
    const badKind = await req(
      "POST",
      "/api/wishlist",
      { title: "ok", kind: "nonsense" },
      { token },
    );
    expect(badKind.status).toBe(400);

    const negAmount = await req(
      "POST",
      "/api/wishlist",
      { title: "ok", target_amount_minor: -5 },
      { token },
    );
    expect(negAmount.status).toBe(400);
  });

  test("per-item currency: defaults null, accepts an override, rejects junk, clears via patch", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-currency@weddly.test");

    // No currency sent → null (inherit the couple's display currency).
    const inherited = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Inherits", target_amount_minor: 200000 },
      { token },
    );
    expect(inherited.status).toBe(201);
    expect(inherited.data.item.currency).toBeNull();

    // Explicit override is stored and echoed back.
    const eur = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Priced abroad", target_amount_minor: 50000, currency: "EUR" },
      { token },
    );
    expect(eur.status).toBe(201);
    expect(eur.data.item.currency).toBe("EUR");

    // Junk currency → 400.
    const bad = await req("POST", "/api/wishlist", { title: "ok", currency: "GBP" }, { token });
    expect(bad.status).toBe(400);

    // PATCH currency: null clears the override back to inheriting.
    const cleared = await req<{ item: WishlistItem }>(
      "PATCH",
      `/api/wishlist/${eur.data.item.id}`,
      { currency: null },
      { token, headers: { "If-Match": String(eur.data.item.updated_at) } },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.item.currency).toBeNull();
  });

  test("explicit image_url is stored; a bad image_url → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-image@weddly.test");

    // A client-supplied (e.g. editor-prefetched) image_url is persisted as-is,
    // and the server does NOT clobber it with an auto-fetch.
    const ok = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Toaster", image_url: "https://cdn.example/toaster.jpg" },
      { token },
    );
    expect(ok.status).toBe(201);
    expect(ok.data.item.image_url).toBe("https://cdn.example/toaster.jpg");

    const bad = await req(
      "POST",
      "/api/wishlist",
      { title: "Toaster", image_url: "data:image/png;base64,AAAA" },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("unauthenticated request → 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/wishlist");
    expect(r.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group gift coordination — notification_email + contributor list
//
// All tests use the same public-wedding / household / RSVP scaffold:
//   1. bootstrapCouple — creates the couple and returns a bearer token
//   2. publish the couple (is_public, wishlist_published)
//   3. create a household + guest via the couple-facing API
//   4. set the guest's RSVP to yes via POST /api/rsvp/checkin (confirmed tier)
//   5. create a wishlist item
//   6. toggle interest via POST /api/public/wedding/:slug/:code/wishlist/:id/interest
//
// RESEND_API_KEY is empty in setup.ts, so sendGroupGiftNotification silently
// no-ops. The toggle must still return 200 (never propagate email errors).
// ─────────────────────────────────────────────────────────────────────────────

/** Helper: pull the slug for a couple from the DB. */
function getSlug(coupleId: number): string {
  const row = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
    | { slug: string }
    | undefined;
  if (!row) throw new Error(`no slug for couple ${coupleId}`);
  return row.slug;
}

/** Helper: create a household + one guest via the couple API, then RSVP the
 *  guest yes so the household is at the confirmed tier. Returns the code. */
async function confirmedHousehold(
  token: string,
  slug: string,
  label: string,
): Promise<{ householdId: number; code: string }> {
  const hh = await req<{ household: { id: number; code: string } }>(
    "POST",
    "/api/households",
    { label },
    { token },
  );
  if (hh.status !== 201) throw new Error(`household create failed: ${hh.status}`);
  const g = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name: `${label} guest`, household_id: hh.data.household.id },
    { token },
  );
  if (g.status !== 201) throw new Error(`guest create failed: ${g.status}`);
  const checkin = await req("POST", "/api/rsvp/checkin", {
    couple_slug: slug,
    household_code: hh.data.household.code,
    members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
  });
  if (checkin.status !== 200) throw new Error(`checkin failed: ${checkin.status}`);
  return { householdId: hh.data.household.id, code: hh.data.household.code };
}

describe("group gift coordination", () => {
  test("stores notification_email when toggling interest", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-email-store@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );
    const slug = getSlug(coupleId);
    const { code } = await confirmedHousehold(token, slug, "Smith");

    // Create a gift item.
    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Espresso machine", kind: "gift", target_amount_minor: 200000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // Toggle interest WITH notification email.
    const toggle = await req(
      "POST",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/interest`,
      { pledged_amount_minor: 50000, notification_email: "guest@example.com" },
    );
    expect(toggle.status).toBe(200);

    // Verify the email was stored in the DB (never exposed in HTTP responses).
    const row = db
      .prepare(
        "SELECT notification_email FROM wishlist_interests WHERE item_id = ? AND notification_email IS NOT NULL",
      )
      .get(itemId) as { notification_email: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.notification_email).toBe("guest@example.com");
  });

  test("GET /contributors returns 403 when household has not pledged", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-unpledged@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );
    const slug = getSlug(coupleId);
    const { code } = await confirmedHousehold(token, slug, "Jones");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Camera", kind: "gift", target_amount_minor: 300000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // Household has NOT toggled interest — no pledge row exists.
    const r = await req(
      "GET",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/contributors`,
    );
    expect(r.status).toBe(403);
  });

  test("GET /contributors returns breakdown after pledging", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-pledged-list@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );
    const slug = getSlug(coupleId);
    const { code } = await confirmedHousehold(token, slug, "Taylor");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Stand mixer", kind: "gift", target_amount_minor: 150000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // Pledge first.
    const toggle = await req(
      "POST",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/interest`,
      { pledged_amount_minor: 75000 },
    );
    expect(toggle.status).toBe(200);

    // Now GET contributors — should return 200 with the pledger in the list.
    const r = await req<WishlistContributorsResult>(
      "GET",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/contributors`,
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.contributors)).toBe(true);
    expect(r.data.contributors.length).toBe(1);
    expect(r.data.contributors[0]!.label).toBe("Taylor");
    expect(r.data.contributors[0]!.pledged_amount_minor).toBe(75000);
    expect(r.data.total_pledged_minor).toBe(75000);
    expect(r.data.target_amount_minor).toBe(150000);
  });

  test("GET /contributors not accessible via couple API (404)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-couple-api@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Toaster", kind: "gift", target_amount_minor: 30000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // The couple-facing /api/wishlist surface has no contributors route.
    const r = await req("GET", `/api/wishlist/${itemId}/contributors`, undefined, { token });
    expect(r.status).toBe(404);
  });

  test("contributor breakdown computes pledged_pct correctly", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-pct@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );
    const slug = getSlug(coupleId);
    const { code } = await confirmedHousehold(token, slug, "Pct-fam");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Bicycle", kind: "gift", target_amount_minor: 200000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // Pledge exactly 25% of the target.
    const toggle = await req(
      "POST",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/interest`,
      { pledged_amount_minor: 50000 },
    );
    expect(toggle.status).toBe(200);

    const r = await req<WishlistContributorsResult>(
      "GET",
      `/api/public/wedding/${slug}/${code}/wishlist/${itemId}/contributors`,
    );
    expect(r.status).toBe(200);
    expect(r.data.contributors[0]!.pledged_pct).toBe(25);
    // remaining = 200000 - 50000 = 150000, remaining_pct = 75
    expect(r.data.remaining_minor).toBe(150000);
    expect(r.data.remaining_pct).toBe(75);
  });

  test("multiple pledgers each receive notification payload — second pledge sees both contributors", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("gg-multi@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1, wishlist_published = 1 WHERE id = ?").run(
      coupleId,
    );
    const slug = getSlug(coupleId);
    const { code: codeA } = await confirmedHousehold(token, slug, "Alpha");
    const { code: codeB } = await confirmedHousehold(token, slug, "Beta");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Wine fridge", kind: "gift", target_amount_minor: 400000 },
      { token },
    );
    expect(created.status).toBe(201);
    const itemId = created.data.item.id;

    // First household pledges.
    const firstToggle = await req(
      "POST",
      `/api/public/wedding/${slug}/${codeA}/wishlist/${itemId}/interest`,
      { pledged_amount_minor: 100000, notification_email: "alpha@example.com" },
    );
    expect(firstToggle.status).toBe(200);

    // Second household pledges — email notification to Alpha would fire here
    // but sendRawEmail silently swallows the RESEND_API_KEY="" error.
    const secondToggle = await req(
      "POST",
      `/api/public/wedding/${slug}/${codeB}/wishlist/${itemId}/interest`,
      { pledged_amount_minor: 80000, notification_email: "beta@example.com" },
    );
    expect(secondToggle.status).toBe(200);

    // Both contributors should appear in the list (visible to either pledger).
    const r = await req<WishlistContributorsResult>(
      "GET",
      `/api/public/wedding/${slug}/${codeB}/wishlist/${itemId}/contributors`,
    );
    expect(r.status).toBe(200);
    expect(r.data.contributors.length).toBe(2);
    const labels = r.data.contributors.map((c) => c.label);
    expect(labels).toContain("Alpha");
    expect(labels).toContain("Beta");
    expect(r.data.total_pledged_minor).toBe(180000);
  });
});
