// P2.D — vendor self-serve listing editor. Verifies:
//   - GET /api/vendor/listing/me returns the caller's claimed listing
//   - PATCH /api/vendor/listing/me applies partial updates, leaves untouched
//     fields alone, and writes an audit-log entry
//   - 401 for anon, 403 for couple-role users, 404 when no listing is linked
//   - Validation rejects empty city, oversize strings, bad price_band,
//     capacity range inversion
//   - name / category / status / source / vendor_account_id are NOT mutable
//     via this endpoint (admin moderation surfaces handle those)
//
// Pairs with backend/src/routes/vendor_listing.ts. Bootstraps a real vendor
// the same way the production flow does: claim flow start → verify → complete
// against a community-supplier listing that already carries a contact_email.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { Listing, VendorAccount, VendorListingView } from "@shared/listings";
import { MAX_LISTING_VIDEOS, parseVideoUrl } from "@shared/listing_videos";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

/** Walk a community supplier through submit → verify-email → admin approve so
 *  it has an `active` listing with a contact_email ready to be claimed. */
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
      blurb: `${name} — original blurb`,
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
    .get(numericId) as { token: string } | undefined;
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

/** Run the full claim flow against a prepared listing and return the vendor's
 *  session token plus the listing id they ended up owning. */
async function claimListing(
  listingId: string,
  contactEmail: string,
  fullName: string,
): Promise<{ vendorToken: string; listingId: string }> {
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
  const verify = await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  expect(verify.status).toBe(200);
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: fullName,
  });
  expect(complete.status).toBe(201);
  return { vendorToken: complete.data.token, listingId };
}

describe("P2.D vendor listing — GET /api/vendor/listing/me", () => {
  test("returns the listing + account for a freshly-claimed vendor", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-get-me@weddly.test",
      "vendor-get-me@weddly.test",
      "Get-Me Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-get-me@weddly.test",
      "Vendor Owner",
    );

    const r = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.listing.id).toBe(listingId);
    expect(r.data.listing.name).toBe("Get-Me Photo Studio");
    expect(r.data.listing.city).toBe("Budapest");
    expect(r.data.listing.price_band).toBe(3);
    expect(r.data.listing.vendor_account_id).not.toBeNull();
    expect(r.data.account.owner_user_id).toBeTruthy();
    expect(r.data.account.display_name).toBe("Get-Me Photo Studio");
  });

  test("anon → 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/vendor/listing/me");
    expect(r.status).toBe(401);
  });

  test("couple-role user → 403", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("not-vendor@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/listing/me",
      undefined,
      { token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("vendor_role_required");
  });
});

describe("P2.D vendor listing — PATCH /api/vendor/listing/me", () => {
  test("partial PATCH updates only the supplied fields", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-patch@weddly.test",
      "vendor-patch@weddly.test",
      "Patch Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-patch@weddly.test",
      "Vendor Owner",
    );

    const patch = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      {
        blurb_hu: "Új magyar leírás",
        blurb_en: "New English description",
        price_band: 4,
        capacity_min: 50,
        capacity_max: 200,
      },
      { token: vendorToken },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.listing.blurb_hu).toBe("Új magyar leírás");
    expect(patch.data.listing.blurb_en).toBe("New English description");
    expect(patch.data.listing.price_band).toBe(4);
    expect(patch.data.listing.capacity_min).toBe(50);
    expect(patch.data.listing.capacity_max).toBe(200);
    // Untouched fields stay put.
    expect(patch.data.listing.city).toBe("Budapest");
    expect(patch.data.listing.name).toBe("Patch Photo Studio");
  });

  test("explicit null clears a nullable field, empty string normalises to null", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-clear@weddly.test",
      "vendor-clear@weddly.test",
      "Clear Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-clear@weddly.test",
      "Vendor Owner",
    );

    const patch = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { website: null, contact_phone: "   ", blurb_en: "" },
      { token: vendorToken },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.listing.website).toBeNull();
    expect(patch.data.listing.contact_phone).toBeNull();
    expect(patch.data.listing.blurb_en).toBeNull();
  });

  test("name / category / status / source / vendor_account_id are NOT mutable here", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-immutable@weddly.test",
      "vendor-immutable@weddly.test",
      "Immutable Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-immutable@weddly.test",
      "Vendor Owner",
    );

    const patch = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      {
        // Every one of these is an admin-only / server-derived field; they
        // get silently ignored rather than 400'd so a generous client
        // sending the whole listing back doesn't break.
        name: "Hostile Rename",
        category: "venue",
        status: "hidden",
        source: "curated",
        vendor_account_id: 99,
        // A legitimate edit travels in the same body so we can confirm
        // the row is still PATCH-able alongside the ignored fields.
        blurb_hu: "Csak a leírás frissül",
      } as unknown as Record<string, unknown>,
      { token: vendorToken },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.listing.name).toBe("Immutable Photo Studio");
    expect(patch.data.listing.category).toBe("photography");
    expect(patch.data.listing.status).toBe("active");
    expect(patch.data.listing.source).toBe("community");
    expect(patch.data.listing.blurb_hu).toBe("Csak a leírás frissül");
  });

  test("city cannot be cleared (NOT NULL column on the listings table)", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-city@weddly.test",
      "vendor-city@weddly.test",
      "City-Required Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-city@weddly.test", "Vendor");

    const empty = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { city: "   " },
      {
        token: vendorToken,
      },
    );
    expect(empty.status).toBe(400);
  });

  test("bad price_band / oversize blurb / inverted capacity range → 400", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-val@weddly.test",
      "vendor-val@weddly.test",
      "Validation Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-val@weddly.test", "Vendor");

    const badBand = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 9 },
      { token: vendorToken },
    );
    expect(badBand.status).toBe(400);

    const longBlurb = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { blurb_hu: "x".repeat(2500) },
      { token: vendorToken },
    );
    expect(longBlurb.status).toBe(400);

    const inverted = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { capacity_min: 200, capacity_max: 50 },
      { token: vendorToken },
    );
    expect(inverted.status).toBe(400);
  });

  test("audit-log row gets written with the patched field list", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-audit@weddly.test",
      "vendor-audit@weddly.test",
      "Audit Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-audit@weddly.test", "Vendor");

    const before = db
      .prepare("SELECT COUNT(*) as n FROM audit_log WHERE action = 'vendor.listing_update'")
      .get() as { n: number };

    await req("PATCH", "/api/vendor/listing/me", { blurb_hu: "audited" }, { token: vendorToken });

    const after = db
      .prepare("SELECT COUNT(*) as n FROM audit_log WHERE action = 'vendor.listing_update'")
      .get() as { n: number };
    expect(after.n).toBe(before.n + 1);
    const latest = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE action = 'vendor.listing_update' ORDER BY id DESC LIMIT 1",
      )
      .get() as { after_json: string };
    const parsed = JSON.parse(latest.after_json) as { fields: string[] };
    expect(parsed.fields).toContain("blurb_hu");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hero-image upload + delete. Vendors can replace the monogram avatar on
// their /app/suppliers and /vendors card with a single uploaded photo.
// File lives under CONFIG.uploadsDir; the public URL goes through the
// `/uploads/*` static handler in server.ts.

const VENDOR_BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Build a minimal valid PNG blob for upload tests — just the PNG signature
 *  + IHDR/IEND chunks. The server doesn't decode the image; it only checks
 *  Content-Type + size, so this 67-byte payload satisfies every validation
 *  the route runs. */
function tinyPngBlob(): Blob {
  // 1x1 transparent PNG. Generated once + frozen so the test doesn't depend
  // on any image library.
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: "image/png" });
}

async function uploadHero(
  vendorToken: string,
  blob: Blob,
  filename = "hero.png",
): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, filename);
  return await fetch(`${VENDOR_BASE}/api/vendor/listing/me/hero`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vendorToken}`,
      "x-test-client-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: form,
  });
}

describe("P2.D vendor listing — POST /api/vendor/listing/me/hero", () => {
  test("uploads an image and exposes a cache-busted /uploads URL", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-hero@weddly.test",
      "vendor-hero@weddly.test",
      "Hero Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-hero@weddly.test",
      "Vendor Owner",
    );

    const res = await uploadHero(vendorToken, tinyPngBlob());
    expect(res.status).toBe(200);
    const body = (await res.json()) as VendorListingView;
    expect(body.listing.id).toBe(listingId);
    expect(body.listing.hero_image_url).toMatch(
      new RegExp(
        `^/uploads/listings/${listingId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/hero\\.png\\?v=\\d+$`,
      ),
    );
  });

  test("the uploaded URL surfaces on the public /api/suppliers card", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-public@weddly.test",
      "vendor-public@weddly.test",
      "Public Card Photo",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-public@weddly.test",
      "Vendor Owner",
    );
    const upload = await uploadHero(vendorToken, tinyPngBlob());
    expect(upload.status).toBe(200);
    const uploadBody = (await upload.json()) as VendorListingView;
    const expectedUrl = uploadBody.listing.hero_image_url;
    expect(expectedUrl).toBeTruthy();

    const list = await req<{ suppliers: Array<{ id: string; hero_image_url: string | null }> }>(
      "GET",
      "/api/suppliers",
    );
    expect(list.status).toBe(200);
    const card = list.data.suppliers.find((s) => s.id === listingId);
    expect(card).toBeDefined();
    expect(card?.hero_image_url).toBe(expectedUrl);
  });

  test("a second upload overwrites the URL with a fresh cache-bust timestamp", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-replace@weddly.test",
      "vendor-replace@weddly.test",
      "Replace Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-replace@weddly.test",
      "Vendor Owner",
    );
    const first = await uploadHero(vendorToken, tinyPngBlob());
    const firstBody = (await first.json()) as VendorListingView;
    // Sleep 5 ms so the `now()` cache-bust marker differs across the pair.
    await new Promise((r) => setTimeout(r, 5));
    const second = await uploadHero(vendorToken, tinyPngBlob());
    const secondBody = (await second.json()) as VendorListingView;
    expect(secondBody.listing.hero_image_url).not.toBe(firstBody.listing.hero_image_url);
    expect(secondBody.listing.hero_image_url).toMatch(
      /^\/uploads\/listings\/.+\/hero\.png\?v=\d+$/,
    );
  });

  test("anon → 401", async () => {
    wipeAll();
    const form = new FormData();
    form.append("file", tinyPngBlob(), "hero.png");
    const res = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/hero`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(401);
  });

  test("couple-role user → 403", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("not-vendor-hero@weddly.test");
    const form = new FormData();
    form.append("file", tinyPngBlob(), "hero.png");
    const res = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/hero`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(403);
  });

  test("missing file field → 400", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-nofile@weddly.test",
      "vendor-nofile@weddly.test",
      "NoFile Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-nofile@weddly.test",
      "Vendor Owner",
    );
    const form = new FormData();
    form.append("other", "x");
    const res = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/hero`, {
      method: "POST",
      headers: { Authorization: `Bearer ${vendorToken}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("unsupported MIME (text/plain) → 415", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-badmime@weddly.test",
      "vendor-badmime@weddly.test",
      "BadMime Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-badmime@weddly.test",
      "Vendor Owner",
    );
    const blob = new Blob(["not really an image"], { type: "text/plain" });
    const form = new FormData();
    form.append("file", blob, "evil.txt");
    const res = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/hero`, {
      method: "POST",
      headers: { Authorization: `Bearer ${vendorToken}` },
      body: form,
    });
    expect(res.status).toBe(415);
  });
});

describe("P2.D vendor listing — DELETE /api/vendor/listing/me/hero", () => {
  test("clears hero_image_url after a prior upload", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-del@weddly.test",
      "vendor-del@weddly.test",
      "Delete Photo Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-del@weddly.test", "Vendor Owner");
    const upload = await uploadHero(vendorToken, tinyPngBlob());
    expect(upload.status).toBe(200);

    const del = await req<VendorListingView>("DELETE", "/api/vendor/listing/me/hero", undefined, {
      token: vendorToken,
    });
    expect(del.status).toBe(200);
    expect(del.data.listing.hero_image_url).toBeNull();
  });

  test("idempotent: deleting when no hero exists is a no-op 200", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-noop@weddly.test",
      "vendor-noop@weddly.test",
      "NoOp Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-noop@weddly.test",
      "Vendor Owner",
    );
    const del = await req<VendorListingView>("DELETE", "/api/vendor/listing/me/hero", undefined, {
      token: vendorToken,
    });
    expect(del.status).toBe(200);
    expect(del.data.listing.hero_image_url).toBeNull();
  });
});

describe("vendor listing / POST /api/vendor/listing/me/visibility", () => {
  test("self-pause hides the public card, unpause restores it", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vis@weddly.test",
      "vendor-vis@weddly.test",
      "Visibility Photo Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-vis@weddly.test", "Vendor Owner");

    // Live before the pause.
    const before = await req<{ suppliers: Array<{ id: string }> }>("GET", "/api/suppliers");
    expect(before.data.suppliers.some((s) => s.id === listingId)).toBe(true);

    const pause = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: false },
      { token: vendorToken },
    );
    expect(pause.status).toBe(200);
    expect(pause.data.listing.status).toBe("hidden");

    // Gone from the public directory (the couple-facing read path, which
    // serves community rows from community_suppliers, not `listings`).
    const during = await req<{ suppliers: Array<{ id: string }> }>("GET", "/api/suppliers");
    expect(during.data.suppliers.some((s) => s.id === listingId)).toBe(false);

    const unpause = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: true },
      { token: vendorToken },
    );
    expect(unpause.status).toBe(200);
    expect(unpause.data.listing.status).toBe("active");

    const after = await req<{ suppliers: Array<{ id: string }> }>("GET", "/api/suppliers");
    expect(after.data.suppliers.some((s) => s.id === listingId)).toBe(true);
  });

  test("an admin-hidden listing cannot be re-published by its vendor", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vis-adm@weddly.test",
      "vendor-vis-adm@weddly.test",
      "Moderated Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-vis-adm@weddly.test",
      "Vendor Owner",
    );

    const adminToken = await registerAdminAndGetToken();
    const numericId = Number(listingId.slice(1));
    const hide = await req(
      "POST",
      `/api/admin/suppliers/${numericId}/hide`,
      { reason: "moderation test" },
      { token: adminToken },
    );
    expect(hide.status).toBe(200);

    const attempt = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: true },
      { token: vendorToken },
    );
    expect(attempt.status).toBe(409);
  });

  test("non-boolean `published` → 400; couple-role user → 403; anon → 401", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vis-bad@weddly.test",
      "vendor-vis-bad@weddly.test",
      "BadInput Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-vis-bad@weddly.test",
      "Vendor Owner",
    );

    const bad = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: "yes" },
      { token: vendorToken },
    );
    expect(bad.status).toBe(400);

    const couple = await bootstrapCouple("couple-vis@weddly.test");
    const forbidden = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: false },
      { token: couple.token },
    );
    expect(forbidden.status).toBe(403);

    const anon = await req("POST", "/api/vendor/listing/me/visibility", { published: false });
    expect(anon.status).toBe(401);
  });
});

describe("vendor listing price-band 30-day cooldown", () => {
  async function makeVendor(tag: string): Promise<{ vendorToken: string; listingId: string }> {
    const { listingId } = await makeApprovedListing(
      `owner-${tag}@weddly.test`,
      `vendor-${tag}@weddly.test`,
      `${tag} Photo Studio`,
    );
    return claimListing(listingId, `vendor-${tag}@weddly.test`, "Vendor Owner");
  }

  test("changing a published band stamps the anchor and locks further changes", async () => {
    wipeAll();
    const { vendorToken, listingId } = await makeVendor("cooldown-lock");

    // Claim-seeded band is 3 with no anchor, so the first change is free.
    const first = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 4 },
      { token: vendorToken },
    );
    expect(first.status).toBe(200);
    expect(first.data.listing.price_band).toBe(4);
    expect(first.data.listing.price_band_changed_at).not.toBeNull();

    // Second change inside the window → 409, band untouched.
    const second = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 5 },
      { token: vendorToken },
    );
    expect(second.status).toBe(409);

    // Withdrawing the price is also a change; same lock.
    const withdraw = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: null },
      { token: vendorToken },
    );
    expect(withdraw.status).toBe(409);

    const row = db.prepare("SELECT price_band FROM listings WHERE id = ?").get(listingId) as {
      price_band: number;
    };
    expect(row.price_band).toBe(4);
  });

  test("re-sending the current band is a no-op, not a change", async () => {
    wipeAll();
    const { vendorToken } = await makeVendor("cooldown-noop");

    const change = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 2 },
      { token: vendorToken },
    );
    expect(change.status).toBe(200);

    // Same band + an unrelated field: must not 409, unrelated field applies.
    const noop = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 2, blurb_en: "Still the same band" },
      { token: vendorToken },
    );
    expect(noop.status).toBe(200);
    expect(noop.data.listing.blurb_en).toBe("Still the same band");
  });

  test("publishing the first price never starts the clock", async () => {
    wipeAll();
    const { vendorToken, listingId } = await makeVendor("cooldown-first");
    // Simulate the signup-path listing that starts unpriced.
    db.prepare(
      "UPDATE listings SET price_band = NULL, price_band_changed_at = NULL WHERE id = ?",
    ).run(listingId);

    const publish = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 2 },
      { token: vendorToken },
    );
    expect(publish.status).toBe(200);
    expect(publish.data.listing.price_band_changed_at).toBeNull();

    // The first CHANGE of the published band is still free (misclick grace)…
    const adjust = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 3 },
      { token: vendorToken },
    );
    expect(adjust.status).toBe(200);
    expect(adjust.data.listing.price_band_changed_at).not.toBeNull();

    // …and from then on the cooldown holds.
    const blocked = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 4 },
      { token: vendorToken },
    );
    expect(blocked.status).toBe(409);
  });

  test("the band unlocks once 30 days have passed", async () => {
    wipeAll();
    const { vendorToken, listingId } = await makeVendor("cooldown-expiry");

    const change = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 4 },
      { token: vendorToken },
    );
    expect(change.status).toBe(200);

    // Time-travel the anchor to 31 days ago.
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    db.prepare("UPDATE listings SET price_band_changed_at = ? WHERE id = ?").run(
      thirtyOneDaysAgo,
      listingId,
    );

    const after = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me",
      { price_band: 1 },
      { token: vendorToken },
    );
    expect(after.status).toBe(200);
    expect(after.data.listing.price_band).toBe(1);
    // The accepted change re-stamps the anchor to "now".
    expect(after.data.listing.price_band_changed_at).toBeGreaterThan(thirtyOneDaysAgo);
  });
});

// ── Portfolio gallery ────────────────────────────────────────────────────────

async function uploadPhoto(
  vendorToken: string,
  blob: Blob,
  filename = "photo.png",
): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, filename);
  return await fetch(`${VENDOR_BASE}/api/vendor/listing/me/photos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vendorToken}`,
      "x-test-client-ip": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: form,
  });
}

describe("vendor listing — portfolio gallery (/api/vendor/listing/me/photos)", () => {
  test("upload, list, public detail exposure (hero first), delete", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-gal@weddly.test",
      "vendor-gal@weddly.test",
      "Gallery Photo Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-gal@weddly.test", "Vendor Owner");

    // Hero first so the public gallery ordering (hero, then uploads) is testable.
    const hero = await uploadHero(vendorToken, tinyPngBlob());
    expect(hero.status).toBe(200);
    const heroUrl = ((await hero.json()) as VendorListingView).listing.hero_image_url;
    expect(heroUrl).toBeTruthy();

    const up1 = await uploadPhoto(vendorToken, tinyPngBlob());
    expect(up1.status).toBe(201);
    const up2 = await uploadPhoto(vendorToken, tinyPngBlob());
    expect(up2.status).toBe(201);
    const afterUploads = (await up2.json()) as VendorListingView;
    expect(afterUploads.photos?.length).toBe(2);
    const [p1, p2] = afterUploads.photos ?? [];
    expect(p1?.url).toMatch(
      new RegExp(
        `^/uploads/listings/${listingId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/gallery/.+\\.png$`,
      ),
    );

    // GET me carries the same photos.
    const me = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, {
      token: vendorToken,
    });
    expect(me.status).toBe(200);
    expect(me.data.photos?.map((p) => p.id)).toEqual([p1?.id, p2?.id].filter(Boolean) as number[]);

    // Public detail: gallery_urls = [hero, photo1, photo2] in that order.
    const detail = await req<{ gallery_urls: string[] | null }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}`,
      undefined,
      { token: vendorToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.gallery_urls).toEqual(
      [heroUrl, p1?.url, p2?.url].filter(Boolean) as string[],
    );

    // Delete the first photo; the second remains. A replayed delete is a 200 no-op.
    const del = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/photos/${p1?.id}`,
      undefined,
      { token: vendorToken },
    );
    expect(del.status).toBe(200);
    expect(del.data.photos?.map((p) => p.id)).toEqual([p2?.id].filter(Boolean) as number[]);
    const replay = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/photos/${p1?.id}`,
      undefined,
      { token: vendorToken },
    );
    expect(replay.status).toBe(200);
    expect(replay.data.photos?.length).toBe(1);
  });

  test("the cap rejects the 13th photo with 409 gallery_full", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-galcap@weddly.test",
      "vendor-galcap@weddly.test",
      "Gallery Cap Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-galcap@weddly.test",
      "Vendor Owner",
    );

    for (let i = 0; i < 12; i++) {
      const r = await uploadPhoto(vendorToken, tinyPngBlob(), `photo-${i}.png`);
      expect(r.status).toBe(201);
    }
    const overflow = await uploadPhoto(vendorToken, tinyPngBlob(), "photo-12.png");
    expect(overflow.status).toBe(409);
    const body = (await overflow.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("gallery_full");
  });

  test("vertical focal point: defaults centred, clamps, reaches the public detail", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-galpos@weddly.test",
      "vendor-galpos@weddly.test",
      "Gallery Position Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-galpos@weddly.test",
      "Vendor Owner",
    );

    const up = await uploadPhoto(vendorToken, tinyPngBlob());
    expect(up.status).toBe(201);
    const photo = ((await up.json()) as VendorListingView).photos?.[0];
    expect(photo).toBeTruthy();
    // A fresh upload is centred, i.e. exactly how it rendered before the
    // control existed.
    expect(photo?.position_y).toBe(50);

    // Centred photos are absent from the public map — nothing to say.
    const before = await req<{ gallery_positions_y?: Record<string, number> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}`,
      undefined,
      { token: vendorToken },
    );
    expect(before.status).toBe(200);
    expect(before.data.gallery_positions_y).toBeUndefined();

    const moved = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/photos/${photo?.id}`,
      { position_y: 18 },
      { token: vendorToken },
    );
    expect(moved.status).toBe(200);
    expect(moved.data.photos?.[0]?.position_y).toBe(18);

    // The vendor's framing reaches couples, keyed by the URL the page renders.
    const after = await req<{ gallery_positions_y?: Record<string, number> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}`,
      undefined,
      { token: vendorToken },
    );
    expect(after.status).toBe(200);
    expect(after.data.gallery_positions_y?.[photo?.url ?? ""]).toBe(18);

    // An over-drag clamps rather than 400s — the client derives this from a
    // pointer delta, so out-of-range is a normal gesture.
    const over = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/photos/${photo?.id}`,
      { position_y: 240 },
      { token: vendorToken },
    );
    expect(over.status).toBe(200);
    expect(over.data.photos?.[0]?.position_y).toBe(100);

    const under = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/photos/${photo?.id}`,
      { position_y: -12 },
      { token: vendorToken },
    );
    expect(under.status).toBe(200);
    expect(under.data.photos?.[0]?.position_y).toBe(0);

    // A non-numeric body is still a client error.
    const bad = await req<unknown>(
      "PATCH",
      `/api/vendor/listing/me/photos/${photo?.id}`,
      { position_y: "middle" },
      { token: vendorToken },
    );
    expect(bad.status).toBe(400);
  });

  test("positioning a photo owned by another listing → 404", async () => {
    wipeAll();
    const a = await makeApprovedListing(
      "owner-galx1@weddly.test",
      "vendor-galx1@weddly.test",
      "Gallery Tenant One",
    );
    const b = await makeApprovedListing(
      "owner-galx2@weddly.test",
      "vendor-galx2@weddly.test",
      "Gallery Tenant Two",
    );
    const one = await claimListing(a.listingId, "vendor-galx1@weddly.test", "Owner One");
    const two = await claimListing(b.listingId, "vendor-galx2@weddly.test", "Owner Two");

    const up = await uploadPhoto(one.vendorToken, tinyPngBlob());
    expect(up.status).toBe(201);
    const victim = ((await up.json()) as VendorListingView).photos?.[0];
    expect(victim).toBeTruthy();

    // Vendor two aims at vendor one's photo id: scoped lookup reads it as
    // absent, so there is no cross-tenant write.
    const cross = await req<unknown>(
      "PATCH",
      `/api/vendor/listing/me/photos/${victim?.id}`,
      { position_y: 90 },
      { token: two.vendorToken },
    );
    expect(cross.status).toBe(404);

    const untouched = await req<VendorListingView>("GET", "/api/vendor/listing/me", undefined, {
      token: one.vendorToken,
    });
    expect(untouched.data.photos?.[0]?.position_y).toBe(50);
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anonForm = new FormData();
    anonForm.append("file", tinyPngBlob(), "photo.png");
    const anon = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/photos`, {
      method: "POST",
      body: anonForm,
    });
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-vendor-gallery@weddly.test");
    const coupleForm = new FormData();
    coupleForm.append("file", tinyPngBlob(), "photo.png");
    const couple = await fetch(`${VENDOR_BASE}/api/vendor/listing/me/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: coupleForm,
    });
    expect(couple.status).toBe(403);
  });
});

// ── Video reel ─────────────────────────────────────────────────────────────
// Reference videos (YouTube) beside the photo gallery. Pasted links, not
// uploads, so these ride the JSON `req` helper. Pairs with the video handlers
// in routes/vendor_listing.ts and the shared parser in shared/listing_videos.ts.

describe("shared/listing_videos parseVideoUrl", () => {
  test("recognises every YouTube URL flavour + Shorts, extracts the id", () => {
    const cases: Array<[string, string]> = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/abcdefghijk", "abcdefghijk"],
      ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"], // trailing/leading space
    ];
    for (const [url, id] of cases) {
      const parsed = parseVideoUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed?.provider).toBe("youtube");
      expect(parsed?.video_id).toBe(id);
    }
  });

  test("rejects non-video / non-YouTube links", () => {
    const bad = [
      "",
      "   ",
      "not a url",
      "https://vimeo.com/12345678",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UC123",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    ];
    for (const url of bad) {
      expect(parseVideoUrl(url)).toBeNull();
    }
  });
});

describe("vendor listing — video reel (/api/vendor/listing/me/videos)", () => {
  test("add, list, public detail exposure, edit, reorder, delete", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vid@weddly.test",
      "vendor-vid@weddly.test",
      "Video Photo Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-vid@weddly.test", "Vendor Owner");

    // Add three videos; each lands at the end of the reel.
    const a = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { token: vendorToken },
    );
    expect(a.status).toBe(201);
    expect(a.data.videos?.length).toBe(1);
    const v0 = a.data.videos?.[0];
    expect(v0?.provider).toBe("youtube");
    expect(v0?.video_id).toBe("dQw4w9WgXcQ");
    expect(v0?.position).toBe(0);
    expect(v0?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const b = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://youtu.be/9bZkp7q19f0" },
      { token: vendorToken },
    );
    expect(b.status).toBe(201);
    const c = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://www.youtube.com/shorts/abcdefghijk" },
      { token: vendorToken },
    );
    expect(c.status).toBe(201);
    const ids = (c.data.videos ?? []).map((v) => v.id);
    expect(ids.length).toBe(3);
    expect((c.data.videos ?? []).map((v) => v.video_id)).toEqual([
      "dQw4w9WgXcQ",
      "9bZkp7q19f0",
      "abcdefghijk",
    ]);

    // Public detail exposes the reel in the same order.
    const detail = await req<{ videos: Array<{ id: number; video_id: string }> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}`,
      undefined,
      { token: vendorToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.videos.map((v) => v.video_id)).toEqual([
      "dQw4w9WgXcQ",
      "9bZkp7q19f0",
      "abcdefghijk",
    ]);

    // Edit the first video's link — keeps its row id + position, swaps the id.
    const edit = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/videos/${v0?.id}`,
      { url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk" },
      { token: vendorToken },
    );
    expect(edit.status).toBe(200);
    const edited = (edit.data.videos ?? []).find((v) => v.id === v0?.id);
    expect(edited?.video_id).toBe("kJQP7kiw5Fk");
    expect(edited?.position).toBe(0);

    // Reorder to [c, a, b]; the reel comes back in that order.
    const [id0, id1, id2] = ids as [number, number, number];
    const reorder = await req<VendorListingView>(
      "PATCH",
      "/api/vendor/listing/me/videos/reorder",
      { ordered_ids: [id2, id0, id1] },
      { token: vendorToken },
    );
    expect(reorder.status).toBe(200);
    expect((reorder.data.videos ?? []).map((v) => v.id)).toEqual([id2, id0, id1]);

    // Delete one; a replayed delete is a 200 no-op.
    const del = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/videos/${id0}`,
      undefined,
      { token: vendorToken },
    );
    expect(del.status).toBe(200);
    expect((del.data.videos ?? []).map((v) => v.id)).toEqual([id2, id1]);
    const replay = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/videos/${id0}`,
      undefined,
      { token: vendorToken },
    );
    expect(replay.status).toBe(200);
    expect(replay.data.videos?.length).toBe(2);
  });

  test("invalid URL → 400 invalid_video_url", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vidbad@weddly.test",
      "vendor-vidbad@weddly.test",
      "BadVideo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-vidbad@weddly.test",
      "Vendor Owner",
    );
    const bad = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://example.com/not-a-video" },
      { token: vendorToken },
    );
    expect(bad.status).toBe(400);
    expect(bad.data.detail?.code).toBe("invalid_video_url");
  });

  test("the cap rejects the 7th video with 409 videos_full", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-vidcap@weddly.test",
      "vendor-vidcap@weddly.test",
      "VideoCap Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-vidcap@weddly.test",
      "Vendor Owner",
    );
    for (let i = 0; i < MAX_LISTING_VIDEOS; i++) {
      // Each id is exactly 11 chars: "vid0000000" (10) + one digit.
      const r = await req(
        "POST",
        "/api/vendor/listing/me/videos",
        { url: `https://www.youtube.com/watch?v=vid0000000${i}` },
        { token: vendorToken },
      );
      expect(r.status).toBe(201);
    }
    // Cap is checked before the URL parse, so this 409s regardless of the id.
    const overflow = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://www.youtube.com/watch?v=overflow123" },
      { token: vendorToken },
    );
    expect(overflow.status).toBe(409);
    expect(overflow.data.detail?.code).toBe("videos_full");
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anon = await req("POST", "/api/vendor/listing/me/videos", {
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-vendor-video@weddly.test");
    const couple = await req(
      "POST",
      "/api/vendor/listing/me/videos",
      { url: "https://youtu.be/dQw4w9WgXcQ" },
      { token },
    );
    expect(couple.status).toBe(403);
  });
});

// ── Packages (árajánlat / price offers) ──────────────────────────────────────

/** Minimal valid PDF — the `%PDF` magic header is all the upload sniff checks. */
function tinyPdfBlob(type = "application/pdf"): Blob {
  const bytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  ]); // "%PDF-1.4\n%..."
  return new Blob([bytes], { type });
}

async function uploadPackagePdf(
  vendorToken: string,
  packageId: number,
  blob: Blob,
  filename = "arlista.pdf",
): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, filename);
  return await fetch(`${VENDOR_BASE}/api/vendor/listing/me/packages/${packageId}/pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vendorToken}`,
      "x-test-client-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: form,
  });
}

describe("vendor listing — packages (/api/vendor/listing/me/packages)", () => {
  test("add up to the cap, partial update + clear, public detail exposure, delete", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-pkg@weddly.test",
      "vendor-pkg@weddly.test",
      "Package Photo Studio",
    );
    const { vendorToken } = await claimListing(listingId, "vendor-pkg@weddly.test", "Vendor Owner");

    // Add the first package with all fields.
    const a = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Félnapos csomag", price_text: "250 000 Ft-tól", description: "4 óra fotózás" },
      { token: vendorToken },
    );
    expect(a.status).toBe(201);
    expect(a.data.packages?.length).toBe(1);
    const p0 = a.data.packages?.[0];
    expect(p0?.name).toBe("Félnapos csomag");
    expect(p0?.price_text).toBe("250 000 Ft-tól");
    expect(p0?.description).toBe("4 óra fotózás");
    expect(p0?.pdf_url).toBeNull();
    expect(p0?.pdf_name).toBeNull();

    // Two more → at the cap of 3.
    await req(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Egész napos csomag" },
      { token: vendorToken },
    );
    const third = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Prémium" },
      { token: vendorToken },
    );
    expect(third.status).toBe(201);
    expect(third.data.packages?.length).toBe(3);

    // Fourth → 409 packages_full.
    const fourth = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Extra" },
      { token: vendorToken },
    );
    expect(fourth.status).toBe(409);
    expect(fourth.data.detail?.code).toBe("packages_full");

    // Partial update — price only; name + description untouched.
    const upd = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/packages/${p0?.id}`,
      { price_text: "300 000 Ft" },
      { token: vendorToken },
    );
    expect(upd.status).toBe(200);
    const updated = upd.data.packages?.find((p) => p.id === p0?.id);
    expect(updated?.price_text).toBe("300 000 Ft");
    expect(updated?.name).toBe("Félnapos csomag");
    expect(updated?.description).toBe("4 óra fotózás");

    // Clear the description via explicit null.
    const clr = await req<VendorListingView>(
      "PATCH",
      `/api/vendor/listing/me/packages/${p0?.id}`,
      { description: null },
      { token: vendorToken },
    );
    expect(clr.data.packages?.find((p) => p.id === p0?.id)?.description).toBeNull();

    // Public detail exposes all three in creation order.
    const detail = await req<{ packages: Array<{ id: number; name: string }> }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}`,
      undefined,
      { token: vendorToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.packages.map((p) => p.name)).toEqual([
      "Félnapos csomag",
      "Egész napos csomag",
      "Prémium",
    ]);

    // Delete the first → two remain, and the deleted id is gone.
    const del = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/packages/${p0?.id}`,
      undefined,
      { token: vendorToken },
    );
    expect(del.status).toBe(200);
    expect(del.data.packages?.length).toBe(2);
    expect(del.data.packages?.some((p) => p.id === p0?.id)).toBe(false);
  });

  test("PDF upload writes a public url + name; delete clears it; non-PDF → 415", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-pkgpdf@weddly.test",
      "vendor-pkgpdf@weddly.test",
      "PDF Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-pkgpdf@weddly.test",
      "Vendor Owner",
    );
    const a = await req<VendorListingView>(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Csomag" },
      { token: vendorToken },
    );
    const pkgId = a.data.packages?.[0]?.id as number;

    // Upload a valid PDF.
    const up = await uploadPackagePdf(vendorToken, pkgId, tinyPdfBlob(), "arlista.pdf");
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as VendorListingView;
    const pkg = upBody.packages?.find((p) => p.id === pkgId);
    expect(pkg?.pdf_url).toMatch(
      new RegExp(
        `^/uploads/listings/${listingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/packages/${pkgId}\\.pdf\\?v=\\d+$`,
      ),
    );
    expect(pkg?.pdf_name).toBe("arlista.pdf");

    // A file that claims application/pdf but isn't (no %PDF header) → 415.
    const bad = await uploadPackagePdf(
      vendorToken,
      pkgId,
      new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "application/pdf" }),
      "fake.pdf",
    );
    expect(bad.status).toBe(415);

    // Delete the PDF → url + name cleared.
    const del = await req<VendorListingView>(
      "DELETE",
      `/api/vendor/listing/me/packages/${pkgId}/pdf`,
      undefined,
      { token: vendorToken },
    );
    expect(del.status).toBe(200);
    const cleared = del.data.packages?.find((p) => p.id === pkgId);
    expect(cleared?.pdf_url).toBeNull();
    expect(cleared?.pdf_name).toBeNull();
  });

  test("validation + scoping: empty/oversize name 400, missing package 404, couple 403", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-pkgval@weddly.test",
      "vendor-pkgval@weddly.test",
      "Val Photo Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-pkgval@weddly.test",
      "Vendor Owner",
    );

    const empty = await req(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "   " },
      { token: vendorToken },
    );
    expect(empty.status).toBe(400);

    const long = await req(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "x".repeat(61) },
      { token: vendorToken },
    );
    expect(long.status).toBe(400);

    const missing = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/vendor/listing/me/packages/999999",
      { name: "Nope" },
      { token: vendorToken },
    );
    expect(missing.status).toBe(404);
    expect(missing.data.detail?.code).toBe("package_not_found");

    const { token: coupleToken } = await bootstrapCouple("pkg-couple@weddly.test");
    const forbidden = await req(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "X" },
      { token: coupleToken },
    );
    expect(forbidden.status).toBe(403);
  });
});
