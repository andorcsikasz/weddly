// Public, unauthenticated vendor page — the shareable surface for people
// outside Weddly. Covers the aggregate endpoint `GET /api/public/vendors/:id`
// (no auth, curated public subset: published reviews only, public Q&A only,
// no admin-only comments_count) and the per-vendor SSR og:card meta that makes
// a shared link preview show the vendor name instead of the brand strapline.

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { addListingPhoto, createVendorListing } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { HU_HOST, lookupVendorPageMeta, renderIndexHtml } from "../../src/lib/seo_ssr";

async function registerAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

const curatedSupplierId = (): string => {
  const first = DIRECTORY[0];
  if (!first) throw new Error("DIRECTORY is empty — no curated supplier to test against");
  return first.id;
};

beforeEach(() => {
  wipeAll();
});

interface PublicPayload {
  detail: {
    id: string;
    name: string;
    comments_count?: number;
    bookable: boolean;
    reviews_summary: { reviews_count: number };
  };
  reviews: Array<{ id: number; published?: boolean; rating: number }>;
  comments: Array<{ id: number; visibility: string; body: string }>;
  availability: {
    unavailable_dates: string[];
    partial_dates: string[];
    next_available: string | null;
    bookable: boolean;
  };
}

describe("GET /api/public/vendors/:id — no auth", () => {
  test("returns detail + reviews + comments + availability with NO token", async () => {
    const sid = curatedSupplierId();
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.id).toBe(sid);
    expect(Array.isArray(r.data.reviews)).toBe(true);
    expect(Array.isArray(r.data.comments)).toBe(true);
    expect(r.data.availability.unavailable_dates).toEqual([]);
    expect(typeof r.data.availability.bookable).toBe("boolean");
  });

  test("never leaks the admin-only comments_count on the public detail", async () => {
    const sid = curatedSupplierId();
    // Seed an admin_internal comment so a count would be > 0 if it leaked.
    const adminToken = await registerAdmin();
    await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "internal triage note", visibility: "admin_internal" },
      { token: adminToken },
    );
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.comments_count).toBeUndefined();
  });

  test("returns published reviews only — drafts stay hidden", async () => {
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

    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.reviews.length).toBe(1);
    expect(r.data.reviews[0]?.rating).toBe(5);
  });

  test("returns the public Q&A tier only — admin_internal + vendor_only hidden", async () => {
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

    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.comments.length).toBe(1);
    expect(r.data.comments[0]?.visibility).toBe("public");
  });

  test("unknown id → 404", async () => {
    const r = await req("GET", "/api/public/vendors/this-vendor-does-not-exist");
    expect(r.status).toBe(404);
  });

  test("a signed-in couple can also read it (token is optional, not required)", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req<PublicPayload>(
      "GET",
      `/api/public/vendors/${encodeURIComponent(sid)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.detail.comments_count).toBeUndefined();
  });
});

// Pinned minimal SSR template — the renderer only cares about the SEO_HEAD
// markers + the <html lang> attr it rewrites.
const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

describe("per-vendor SSR og:card meta (/vendors/:id)", () => {
  test("lookupVendorPageMeta resolves a curated id but NOT /vendors or /vendors/signup", () => {
    const sid = curatedSupplierId();
    const name = DIRECTORY.find((d) => d.id === sid)?.name ?? "";
    const meta = lookupVendorPageMeta(`/vendors/${sid}`);
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe(name);
    // The static routes must never resolve as a vendor id.
    expect(lookupVendorPageMeta("/vendors")).toBeNull();
    expect(lookupVendorPageMeta("/vendors/signup")).toBeNull();
    expect(lookupVendorPageMeta("/vendors/this-id-does-not-exist")).toBeNull();
  });

  test("renderIndexHtml injects the vendor name + city into <title> and og:title", () => {
    const sid = curatedSupplierId();
    const base = DIRECTORY.find((d) => d.id === sid);
    const name = base?.name ?? "";
    const city = base?.city ?? "";
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: `/vendors/${sid}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain(`<title>${name} · ${city}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${name} · ${city}" />`);
  });

  // A claimed vendor (id `v{N}`) with no dedicated hero. Returns its `v{N}` id.
  async function seedClaimedVendorNoHero(email: string, name: string): Promise<string> {
    const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
      email,
      password: "supersafe123",
      full_name: "Vendor Owner",
    });
    await verifyUserEmail(email);
    const userId = reg.data.user.id;
    db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
    const account = createVendorAccount({
      ownerUserId: userId,
      displayName: name,
      contactEmail: email,
      onboardingDone: false,
    });
    createVendorListing({
      vendorAccountId: account.id,
      category: "photo_video",
      name,
      city: "Budapest",
      contactEmail: email,
    });
    initVendorBilling(account.id, "HUF");
    return `v${account.id}`;
  }

  test("og:image falls back to the vendor's first gallery photo when there's no hero", async () => {
    const id = await seedClaimedVendorNoHero("gallery@weddly.test", "Nagy Gergely Videography");
    // Vendor uploaded portfolio photos but never set a dedicated hero.
    const photoUrl = `/uploads/listings/${id}/1.webp`;
    addListingPhoto(id, photoUrl);
    addListingPhoto(id, `/uploads/listings/${id}/2.webp`);

    const meta = lookupVendorPageMeta(`/vendors/${id}`);
    expect(meta?.heroImageUrl).toBe(photoUrl); // first uploaded photo wins

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/vendors/${id}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    // The vendor's own photo becomes the share-card image (made absolute), NOT
    // the brand og.png.
    expect(html).toContain(`<meta property="og:image" content="https://${HU_HOST}${photoUrl}" />`);
    expect(html).not.toContain(`<meta property="og:image" content="https://${HU_HOST}/og.png" />`);
  });

  test("og:image falls back to the brand og.png when the vendor has no photos at all", async () => {
    const id = await seedClaimedVendorNoHero("nopics@weddly.test", "No Pics Studio");

    const meta = lookupVendorPageMeta(`/vendors/${id}`);
    expect(meta?.heroImageUrl).toBeNull();

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/vendors/${id}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain(`<meta property="og:image" content="https://${HU_HOST}/og.png" />`);
  });
});
