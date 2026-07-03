// Vendor self-serve account (company identity) + data takeout. Verifies:
//   - PATCH /api/vendor/account applies partial company-identity updates,
//     normalises empty strings to null, uppercases the country code, and
//     writes an audit-log entry
//   - display_name cannot be blanked; oversize fields are rejected
//   - GET /api/vendor/export returns the vendor's full snapshot (user +
//     account + owned listings + clients + blocked dates)
//   - 401 for anon, 403 for couple-role users on both endpoints
//
// Pairs with backend/src/routes/vendor_account.ts. Bootstraps a real vendor
// the same way vendor_listing.e2e.test.ts does: community submit → verify →
// admin approve → claim flow.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorAccount, VendorDataExport } from "@shared/listings";

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

/** Community submit → email verify → admin approve, so the listing is
 *  claimable. Same bootstrap as vendor_listing.e2e.test.ts. */
async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<{ listingId: string; coupleToken: string }> {
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
      blurb: `${name} blurb`,
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
  return { listingId: publicId, coupleToken: token };
}

async function claimListing(
  listingId: string,
  contactEmail: string,
  fullName: string,
): Promise<{ vendorToken: string }> {
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
  return { vendorToken: complete.data.token };
}

describe("PATCH /api/vendor/account", () => {
  test("updates company identity fields + writes an audit entry", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-acct-patch@weddly.test",
      "vendor-acct-patch@weddly.test",
      "Acct Patch Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-acct-patch@weddly.test",
      "Patch Vendor",
    );

    const r = await req<{ account: VendorAccount }>(
      "PATCH",
      "/api/vendor/account",
      {
        display_name: "Acct Patch Studio Kft.",
        vat_number: "12345678-2-42",
        registry_number: "01-09-999999",
        legal_form: "Kft.",
        country: "hu",
        postal_code: "1051",
        city: "Budapest",
        address: "Fő utca 1.",
        contact_phone: "+36 30 123 4567",
      },
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.account.display_name).toBe("Acct Patch Studio Kft.");
    expect(r.data.account.vat_number).toBe("12345678-2-42");
    expect(r.data.account.registry_number).toBe("01-09-999999");
    expect(r.data.account.legal_form).toBe("Kft.");
    // Country code is normalised to uppercase.
    expect(r.data.account.country).toBe("HU");
    expect(r.data.account.postal_code).toBe("1051");
    expect(r.data.account.city).toBe("Budapest");
    expect(r.data.account.address).toBe("Fő utca 1.");
    expect(r.data.account.contact_phone).toBe("+36 30 123 4567");

    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vendor.account_update'")
      .get() as { n: number };
    expect(audit.n).toBe(1);
  });

  test("partial patch leaves other fields alone; empty string clears to null", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-acct-partial@weddly.test",
      "vendor-acct-partial@weddly.test",
      "Acct Partial Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-acct-partial@weddly.test",
      "Partial Vendor",
    );

    const first = await req<{ account: VendorAccount }>(
      "PATCH",
      "/api/vendor/account",
      { vat_number: "11111111-1-11", city: "Szeged" },
      { token: vendorToken },
    );
    expect(first.status).toBe(200);

    const second = await req<{ account: VendorAccount }>(
      "PATCH",
      "/api/vendor/account",
      { city: "" },
      { token: vendorToken },
    );
    expect(second.status).toBe(200);
    expect(second.data.account.city).toBeNull();
    // Untouched by the second patch:
    expect(second.data.account.vat_number).toBe("11111111-1-11");
  });

  test("rejects a blank display_name and oversize fields", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-acct-invalid@weddly.test",
      "vendor-acct-invalid@weddly.test",
      "Acct Invalid Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-acct-invalid@weddly.test",
      "Invalid Vendor",
    );

    const blank = await req(
      "PATCH",
      "/api/vendor/account",
      { display_name: "  " },
      {
        token: vendorToken,
      },
    );
    expect(blank.status).toBe(400);

    const oversize = await req(
      "PATCH",
      "/api/vendor/account",
      { vat_number: "x".repeat(41) },
      { token: vendorToken },
    );
    expect(oversize.status).toBe(400);

    const badCountry = await req(
      "PATCH",
      "/api/vendor/account",
      { country: "HUN" },
      { token: vendorToken },
    );
    expect(badCountry.status).toBe(400);
  });

  test("401 anon, 403 couple role", async () => {
    wipeAll();
    const anon = await req("PATCH", "/api/vendor/account", { city: "Pécs" });
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("couple-acct@weddly.test");
    const couple = await req("PATCH", "/api/vendor/account", { city: "Pécs" }, { token });
    expect(couple.status).toBe(403);
  });
});

describe("GET /api/vendor/export", () => {
  test("returns the vendor's full data snapshot", async () => {
    wipeAll();
    const { listingId } = await makeApprovedListing(
      "owner-acct-export@weddly.test",
      "vendor-acct-export@weddly.test",
      "Acct Export Studio",
    );
    const { vendorToken } = await claimListing(
      listingId,
      "vendor-acct-export@weddly.test",
      "Export Vendor",
    );

    // A blocked date should show up in the export.
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const block = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: future },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);

    const r = await req<VendorDataExport>("GET", "/api/vendor/export", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.exported_at).toBeGreaterThan(0);
    expect(r.data.user.email).toBe("vendor-acct-export@weddly.test");
    expect(r.data.account.display_name).toBe("Acct Export Studio");
    expect(r.data.listings.map((l) => l.id)).toContain(listingId);
    expect(Array.isArray(r.data.clients)).toBe(true);
    expect(r.data.blocked_dates).toContain(future);

    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vendor.data_export'")
      .get() as { n: number };
    expect(audit.n).toBe(1);
  });

  test("401 anon, 403 couple role", async () => {
    wipeAll();
    const anon = await req("GET", "/api/vendor/export");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("couple-export@weddly.test");
    const couple = await req("GET", "/api/vendor/export", undefined, { token });
    expect(couple.status).toBe(403);
  });
});
