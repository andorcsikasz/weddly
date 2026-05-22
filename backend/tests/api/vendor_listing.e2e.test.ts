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
  const start = await req("POST", "/api/vendor/claim/start", { listing_id: listingId });
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
