// Vendor billing surface: GET /api/vendor/billing returns the billing snapshot
// (reused from shared/vendor_billing.ts), the DERIVED FREE/PRO plan, and the
// per-feature flag map the frontend uses to gate premium surfaces + render the
// upgrade CTA. Plan is derived from the entitlement (entitled => 'pro';
// lapsed/none => 'free'); there is no stored plan column.
//
// Covers (major-change rule — new endpoint):
//   - a founding vendor (entitled) resolves to plan='pro' with every feature on
//   - a trialing vendor with an open window resolves to plan='pro'
//   - a lapsed vendor ('none') / expired trial resolves to plan='free' with
//     every feature off
//   - the returned billing snapshot mirrors the stored subscription state
//   - 401 for anon, 403 for a couple-role user
//
// Pairs with backend/src/routes/vendor_billing.ts. Bootstraps a real vendor via
// the production claim flow (community supplier → approve → claim → complete),
// then writes the vendor_subscriptions row directly to exercise each billing
// state — the claim flow itself does not grant a subscription.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { VendorBilling } from "@shared/vendor_billing";
import { VENDOR_FOUNDING_DURATION_MS, VENDOR_TRIAL_DURATION_MS } from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

interface BillingResponse {
  billing: VendorBilling;
  plan: VendorPlan;
  features: VendorFeatureFlags;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Walk a community supplier through submit → verify-email → admin approve so it
 *  has an `active` listing with a contact_email ready to be claimed. */
async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<string> {
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
  return publicId;
}

/** Run the full claim flow against a prepared listing and return the vendor's
 *  session token + vendor_account id. */
async function claimVendor(
  listingId: string,
  contactEmail: string,
): Promise<{ vendorToken: string; accountId: number }> {
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: contactEmail,
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as { token: string } | undefined;
  expect(claim).toBeTruthy();
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: "Vendor Owner",
  });
  expect(complete.status).toBe(201);

  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { vendorToken: complete.data.token, accountId: acct.id };
}

/** Upsert the vendor_subscriptions row into a chosen billing state. */
function setVendorSub(
  accountId: number,
  patch: {
    subscription_status: string;
    trial_ends_at?: number | null;
    founding_until?: number | null;
    is_founding_member?: number;
    currency?: string;
  },
): void {
  const ts = Date.now();
  db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(accountId);
  db.prepare(
    `INSERT INTO vendor_subscriptions
       (vendor_account_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    accountId,
    patch.subscription_status,
    patch.trial_ends_at ?? null,
    patch.founding_until ?? null,
    patch.is_founding_member ?? 0,
    patch.currency ?? "EUR",
    ts,
    ts,
  );
}

describe("vendor billing — GET /api/vendor/billing", () => {
  test("founding vendor resolves to plan='pro' with every feature on", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-founding@weddly.test",
      "vendor-founding@weddly.test",
      "Founding Films",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-founding@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "founding",
      founding_until: Date.now() + VENDOR_FOUNDING_DURATION_MS,
      is_founding_member: 1,
      currency: "HUF",
    });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.plan).toBe("pro");
    expect(r.data.billing.subscription_status).toBe("founding");
    expect(r.data.billing.is_founding_member).toBe(true);
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.billing.currency).toBe("HUF");
    expect(r.data.features.client_crm_detail).toBe(true);
    expect(r.data.features.payment_tracking).toBe(true);
    expect(r.data.features.advanced_stats).toBe(true);
    expect(r.data.features.response_workflow).toBe(true);
  });

  test("trialing vendor with an open window resolves to plan='pro'", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-trial@weddly.test",
      "vendor-trial@weddly.test",
      "Trial Studio",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-trial@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "trialing",
      trial_ends_at: Date.now() + VENDOR_TRIAL_DURATION_MS,
    });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("trialing");
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.plan).toBe("pro");
    expect(r.data.features.payment_tracking).toBe(true);
  });

  test("lapsed vendor ('none') resolves to plan='free' with every feature off", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-lapsed@weddly.test",
      "vendor-lapsed@weddly.test",
      "Lapsed Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-lapsed@weddly.test");
    setVendorSub(accountId, { subscription_status: "none" });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("none");
    expect(r.data.billing.entitled).toBe(false);
    expect(r.data.plan).toBe("free");
    expect(r.data.features.client_crm_detail).toBe(false);
    expect(r.data.features.payment_tracking).toBe(false);
    expect(r.data.features.advanced_stats).toBe(false);
    expect(r.data.features.response_workflow).toBe(false);
  });

  test("an expired trial resolves to plan='free'", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-expired@weddly.test",
      "vendor-expired@weddly.test",
      "Expired Trial Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-expired@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "trialing",
      trial_ends_at: Date.now() - 1000,
    });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.entitled).toBe(false);
    expect(r.data.plan).toBe("free");
  });

  test("no subscription row yet resolves to plan='free'", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-nosub@weddly.test",
      "vendor-nosub@weddly.test",
      "No Sub Co",
    );
    const { vendorToken } = await claimVendor(listingId, "vendor-nosub@weddly.test");

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.entitled).toBe(false);
    expect(r.data.plan).toBe("free");
  });

  test("anon → 401", async () => {
    wipeAll();
    const r = await req("GET", "/api/vendor/billing");
    expect(r.status).toBe(401);
  });

  test("couple-role user → 403 vendor_role_required", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("not-a-vendor-billing@weddly.test");
    const r = await req<{ detail?: { code?: string } }>("GET", "/api/vendor/billing", undefined, {
      token,
    });
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("vendor_role_required");
  });
});
