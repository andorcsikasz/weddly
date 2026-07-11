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
import {
  startOfNextUtcMonth,
  VENDOR_FOUNDING_DURATION_MS,
  VENDOR_FREE_LEAD_CREDITS,
  VENDOR_TRIAL_DURATION_MS,
} from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { markVendorCardOnFile } from "../../src/domain/vendor_billing";
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
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  // Already registered this test (makeApprovedListing does it too) → log in.
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
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
    card_on_file?: number;
    lead_credits_used?: number;
    billing_starts_at?: number | null;
  },
): void {
  const ts = Date.now();
  db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(accountId);
  db.prepare(
    `INSERT INTO vendor_subscriptions
       (vendor_account_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, currency, card_on_file, lead_credits_used,
        billing_starts_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    accountId,
    patch.subscription_status,
    patch.trial_ends_at ?? null,
    patch.founding_until ?? null,
    patch.is_founding_member ?? 0,
    patch.currency ?? "EUR",
    patch.card_on_file ?? 0,
    patch.lead_credits_used ?? 0,
    patch.billing_starts_at ?? null,
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

  test("claim-complete grants the activation sub (founding while slots remain)", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-actgrant@weddly.test",
      "vendor-actgrant@weddly.test",
      "Activation Grant Co",
    );
    const { vendorToken } = await claimVendor(listingId, "vendor-actgrant@weddly.test");

    // No setVendorSub: the claim flow itself must have granted the sub.
    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("founding");
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.plan).toBe("pro");
  });

  test("no subscription row (legacy pre-billing account) resolves to plan='free'", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-nosub@weddly.test",
      "vendor-nosub@weddly.test",
      "No Sub Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-nosub@weddly.test");
    // Simulate an account that pre-dates billing (the boot grandfather handles
    // these in prod; the read path must still degrade gracefully).
    db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(accountId);

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("none");
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

// ── Freemium lifecycle ───────────────────────────────────────────────────────
// trial (3d) → card on file → lead_window (3 free inquiries) → billing starts
// on the 1st of the next month → active via the (Stripe) webhook seam.
describe("vendor billing: freemium lead window", () => {
  test("trial constant is the 3-day tryout", () => {
    expect(VENDOR_TRIAL_DURATION_MS).toBe(1000 * 60 * 60 * 24 * 3);
    expect(VENDOR_FREE_LEAD_CREDITS).toBe(3);
  });

  test("card on file flips an expired trial into the lead window (entitled, PRO)", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-leadwin@weddly.test",
      "vendor-leadwin@weddly.test",
      "Lead Window Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-leadwin@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "trialing",
      trial_ends_at: Date.now() - 1000, // tryout over, card wall reached
    });
    // The webhook seam the setup-mode Checkout completion calls:
    markVendorCardOnFile(accountId);

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("lead_window");
    expect(r.data.billing.card_on_file).toBe(true);
    expect(r.data.billing.lead_credits_used).toBe(0);
    expect(r.data.billing.lead_credits_total).toBe(VENDOR_FREE_LEAD_CREDITS);
    expect(r.data.billing.billing_starts_at).toBeNull();
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.billing.reason).toBe("lead_window");
    expect(r.data.plan).toBe("pro");
    expect(r.data.features.direct_messages).toBe(true);
    expect(r.data.features.calendar_availability).toBe(true);
  });

  test("card on file does NOT re-open a lead window for a canceled subscriber", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-nocheat@weddly.test",
      "vendor-nocheat@weddly.test",
      "No Cheat Co",
    );
    const { accountId } = await claimVendor(listingId, "vendor-nocheat@weddly.test");
    setVendorSub(accountId, { subscription_status: "canceled" });
    db.prepare(
      "UPDATE vendor_subscriptions SET stripe_subscription_id = 'sub_old' WHERE vendor_account_id = ?",
    ).run(accountId);

    markVendorCardOnFile(accountId);
    const row = db
      .prepare(
        "SELECT subscription_status, card_on_file FROM vendor_subscriptions WHERE vendor_account_id = ?",
      )
      .get(accountId) as { subscription_status: string; card_on_file: number };
    expect(row.subscription_status).toBe("canceled");
    expect(row.card_on_file).toBe(1);
  });

  test("each delivered inquiry spends a credit; the 3rd schedules billing for next month", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-credits@weddly.test",
      "vendor-credits@weddly.test",
      "Credits Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-credits@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "lead_window",
      card_on_file: 1,
    });
    const adminToken = await registerAdminAndGetToken();
    const { coupleId } = await bootstrapCouple("couple-credits@weddly.test");

    const inquire = async (eventDate: string) => {
      const r = await req(
        "POST",
        `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
        { couple_id: coupleId, event_date: eventDate },
        { token: adminToken },
      );
      expect(r.status).toBe(201);
    };

    await inquire("2027-05-01");
    await inquire("2027-06-01");
    let r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.data.billing.lead_credits_used).toBe(2);
    expect(r.data.billing.billing_starts_at).toBeNull();
    expect(r.data.billing.entitled).toBe(true);

    await inquire("2027-07-01");
    r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.data.billing.lead_credits_used).toBe(VENDOR_FREE_LEAD_CREDITS);
    // The 3rd generated lead anchors the first payment to the start of the
    // NEXT calendar month.
    expect(r.data.billing.billing_starts_at).toBe(startOfNextUtcMonth(Date.now()));
    // Still entitled until that date, the free window was promised through it.
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.plan).toBe("pro");

    // A 4th inquiry must not over-count or move the anchor.
    await inquire("2027-08-01");
    r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.data.billing.lead_credits_used).toBe(VENDOR_FREE_LEAD_CREDITS);
  });

  test("scheduled billing date passed with no active sub → leads_exhausted, FREE", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-exhaust@weddly.test",
      "vendor-exhaust@weddly.test",
      "Exhausted Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-exhaust@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "lead_window",
      card_on_file: 1,
      lead_credits_used: VENDOR_FREE_LEAD_CREDITS,
      billing_starts_at: Date.now() - 1000,
    });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.data.billing.entitled).toBe(false);
    expect(r.data.billing.reason).toBe("leads_exhausted");
    expect(r.data.plan).toBe("free");
    expect(r.data.features.direct_messages).toBe(false);
  });

  test("trial inquiries are free and uncounted", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-trialfree@weddly.test",
      "vendor-trialfree@weddly.test",
      "Trial Free Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-trialfree@weddly.test");
    setVendorSub(accountId, {
      subscription_status: "trialing",
      trial_ends_at: Date.now() + VENDOR_TRIAL_DURATION_MS,
    });
    const adminToken = await registerAdminAndGetToken();
    const { coupleId } = await bootstrapCouple("couple-trialfree@weddly.test");

    const r = await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
      { couple_id: coupleId, event_date: "2027-05-02" },
      { token: adminToken },
    );
    expect(r.status).toBe(201);

    const b = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(b.data.billing.lead_credits_used).toBe(0);
    expect(b.data.billing.billing_starts_at).toBeNull();
  });

  test("Stripe endpoints 503 while billing is disabled", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-disabled@weddly.test",
      "vendor-disabled@weddly.test",
      "Disabled Stripe Co",
    );
    const { vendorToken } = await claimVendor(listingId, "vendor-disabled@weddly.test");

    for (const path of [
      "/api/vendor/billing/setup",
      "/api/vendor/billing/checkout",
      "/api/vendor/billing/portal",
    ]) {
      const r = await req("POST", path, {}, { token: vendorToken });
      expect(r.status).toBe(503);
    }
    const wh = await req("POST", "/api/vendor/billing/webhook", {});
    expect(wh.status).toBe(503);
  });
});

// ── Freemium gates ───────────────────────────────────────────────────────────
// Direct inquiries + the availability calendar are PRO; the listing editor
// stays FREE (the freemium promise: the listing never disappears).
describe("vendor billing: freemium feature gates", () => {
  test("a FREE vendor is not bookable: bookable=false and inquiry create 409", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-gatebook@weddly.test",
      "vendor-gatebook@weddly.test",
      "Gate Book Co",
    );
    const { accountId } = await claimVendor(listingId, "vendor-gatebook@weddly.test");
    setVendorSub(accountId, { subscription_status: "none" });
    const adminToken = await registerAdminAndGetToken();
    const { token: coupleToken, coupleId } = await bootstrapCouple("couple-gate@weddly.test");

    const avail = await req<{ bookable: boolean }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(avail.status).toBe(200);
    expect(avail.data.bookable).toBe(false);

    const create = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
      { couple_id: coupleId, event_date: "2027-05-03" },
      { token: adminToken },
    );
    expect(create.status).toBe(409);
    expect(create.data.detail?.code).toBe("booking_unavailable");
  });

  test("an entitled vendor stays bookable", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-probook@weddly.test",
      "vendor-probook@weddly.test",
      "Pro Book Co",
    );
    const { accountId } = await claimVendor(listingId, "vendor-probook@weddly.test");
    setVendorSub(accountId, { subscription_status: "lead_window", card_on_file: 1 });
    const { token: coupleToken } = await bootstrapCouple("couple-probook@weddly.test");

    const avail = await req<{ bookable: boolean }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(avail.status).toBe(200);
    expect(avail.data.bookable).toBe(true);
  });

  test("FREE vendor: availability writes 402, listing edit still allowed", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-gateedit@weddly.test",
      "vendor-gateedit@weddly.test",
      "Gate Edit Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-gateedit@weddly.test");
    setVendorSub(accountId, { subscription_status: "none" });

    const block = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "2027-05-04" },
      { token: vendorToken },
    );
    expect(block.status).toBe(402);

    // The freemium promise: the FREE plan keeps the listing editable.
    const edit = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { city: "Szeged" },
      { token: vendorToken },
    );
    expect(edit.status).toBe(200);
  });
});
