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
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { Listing, VendorAccount, VendorListingView } from "@shared/listings";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
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
      category: "photo_video",
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
    expect(patch.data.listing.category).toBe("photo_video");
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
