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
import type { VendorBilling, VendorBillingDetails, VendorOffer } from "@shared/vendor_billing";
import { PAST_DUE_GRACE_MS } from "@shared/billing";
import {
  VENDOR_EARLY_CAP,
  VENDOR_EARLY_DURATION_MS,
  VENDOR_FOUNDING_CAP,
  VENDOR_FOUNDING_DURATION_MS,
  VENDOR_FREE_LEAD_CREDITS,
  VENDOR_TRIAL_DURATION_MS,
  vendorOfferForSlots,
} from "@shared/vendor_billing";
import type { VendorFeatureFlags, VendorPlan } from "@shared/vendor_plan";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import {
  currentVendorOffer,
  applyVendorSubscriptionState,
  initVendorBilling,
  markVendorCardOnFile,
  toVendorBilling,
  vendorEarlySpotsLeft,
  vendorFoundingSpotsLeft,
} from "../../src/domain/vendor_billing";
import {
  bootstrapCouple,
  enableBillingEnforcement,
  registerAndVerify,
  req,
  wipeAll,
} from "../helpers";

interface BillingResponse {
  billing: VendorBilling;
  plan: VendorPlan;
  features: VendorFeatureFlags;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) {
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
    enableBillingEnforcement();
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

  test("while the freeze is deferred a lapsed vendor stays PRO", async () => {
    // The go-live switch is GLOBAL: couples, planners and vendors all read the
    // same flag, so one flip starts charging everywhere at the same instant.
    // Deliberately no enableBillingEnforcement() here — the default off state
    // IS the case under test, and it is production's resting state today.
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-deferred@weddly.test",
      "vendor-deferred@weddly.test",
      "Deferred Co",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-deferred@weddly.test");
    // The same lapsed row that reads FREE in the test above.
    setVendorSub(accountId, { subscription_status: "none" });

    const r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing.subscription_status).toBe("none");
    expect(r.data.billing.entitled).toBe(true);
    expect(r.data.plan).toBe("pro");
    // The whole feature table follows the one verdict, which is what makes the
    // single check in toVendorBilling enough to cover every gate.
    expect(r.data.features.client_crm_detail).toBe(true);
    expect(r.data.features.payment_tracking).toBe(true);
  });

  test("an expired trial resolves to plan='free'", async () => {
    wipeAll();
    enableBillingEnforcement();
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

  test("each delivered inquiry spends a credit; the 3rd pauses PRO without charging", async () => {
    wipeAll();
    enableBillingEnforcement();
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

    const inquire = async (eventDate: string, expectedStatus = 201) => {
      const r = await req(
        "POST",
        `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
        { couple_id: coupleId, event_date: eventDate },
        { token: adminToken },
      );
      expect(r.status).toBe(expectedStatus);
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
    // The third lead pauses PRO. Saving a card never schedules a charge; only
    // a later explicit subscription Checkout can create payment obligations.
    expect(r.data.billing.billing_starts_at).toBeNull();
    expect(r.data.billing.entitled).toBe(false);
    expect(r.data.billing.reason).toBe("leads_exhausted");
    expect(r.data.plan).toBe("free");

    // A 4th inquiry is rejected and must not over-count or create a schedule.
    await inquire("2027-08-01", 409);
    r = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(r.data.billing.lead_credits_used).toBe(VENDOR_FREE_LEAD_CREDITS);
  });

  test("spent free leads are immediately leads_exhausted until explicit checkout", async () => {
    wipeAll();
    enableBillingEnforcement();
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
      billing_starts_at: null,
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
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-disabled@weddly.test");

    for (const path of ["/api/vendor/billing/setup", "/api/vendor/billing/checkout"]) {
      const r = await req<{ detail?: { code?: string } }>(
        "POST",
        path,
        {},
        {
          token: vendorToken,
        },
      );
      expect(r.status).toBe(503);
      expect(r.data.detail?.code).toBe("payment_not_launched");
    }
    // Portal recovery remains separate from new-payment admission.
    const portal = await req("POST", "/api/vendor/billing/portal", {}, { token: vendorToken });
    expect(portal.status).toBe(503);

    setVendorSub(accountId, { subscription_status: "lead_window", card_on_file: 1 });
    const scheduled = db
      .prepare(
        "SELECT stripe_subscription_id FROM vendor_subscriptions WHERE vendor_account_id = ?",
      )
      .get(accountId) as { stripe_subscription_id: string | null };
    expect(scheduled.stripe_subscription_id).toBeNull();
    const wh = await req("POST", "/api/vendor/billing/webhook", {});
    expect(wh.status).toBe(503);
  });

  test("vendor dunning timestamp is stable, bounds access, and clears on recovery", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-dunning@weddly.test",
      "vendor-dunning@weddly.test",
      "Dunning Vendor",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-dunning@weddly.test");
    setVendorSub(accountId, { subscription_status: "trialing" });
    const monthAhead = Date.now() + 30 * 86_400_000;
    applyVendorSubscriptionState(accountId, {
      subscriptionId: "sub_vendor_dunning",
      stripeStatus: "past_due",
      currentPeriodEnd: monthAhead,
    });
    const eightDaysAgo = Date.now() - (PAST_DUE_GRACE_MS + 86_400_000);
    db.prepare(
      "UPDATE vendor_subscriptions SET past_due_since = ? WHERE vendor_account_id = ?",
    ).run(eightDaysAgo, accountId);
    applyVendorSubscriptionState(accountId, {
      subscriptionId: "sub_vendor_dunning",
      stripeStatus: "past_due",
      currentPeriodEnd: monthAhead,
    });
    enableBillingEnforcement();
    const status = await req<BillingResponse>("GET", "/api/vendor/billing", undefined, {
      token: vendorToken,
    });
    expect(status.data.billing.current_period_end).toBe(monthAhead);
    expect(status.data.billing.past_due_since).toBe(eightDaysAgo);
    expect(status.data.billing.entitled).toBe(false);

    applyVendorSubscriptionState(accountId, {
      subscriptionId: "sub_vendor_dunning",
      stripeStatus: "active",
      currentPeriodEnd: monthAhead,
    });
    const cleared = db
      .prepare("SELECT past_due_since FROM vendor_subscriptions WHERE vendor_account_id = ?")
      .get(accountId) as { past_due_since: number | null };
    expect(cleared.past_due_since).toBeNull();
  });
});

// ── Freemium gates ───────────────────────────────────────────────────────────
// Direct inquiries + the availability calendar are PRO; the listing editor
// stays FREE (the freemium promise: the listing never disappears).
describe("vendor billing: freemium feature gates", () => {
  test("a FREE vendor is not bookable: bookable=false and inquiry create 409", async () => {
    wipeAll();
    enableBillingEnforcement();
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
    // The refusal names the actual reason. Both cases used to answer
    // `booking_unavailable` / "Supplier is not claimed", so an operator looking
    // at a claimed vendor on the FREE plan was told the opposite of the truth.
    expect(create.data.detail?.code).toBe("booking_free_plan");
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
    enableBillingEnforcement();
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

// ── Free-cohort ladder ──────────────────────────────────────────────────────
// The grant at activation walks three tiers: founding 100 (one year) → early
// 300 (three months) → 3-day trial. Both free tiers ride status='founding' +
// founding_until and are told apart ONLY by which badge column is stamped, so
// these tests assert the badges, not just the status.

/** Seed `n` vendor accounts that already hold a cohort badge, cheaply. Goes
 *  straight to SQL rather than through the claim flow: the caps are 100 and 300
 *  and walking the HTTP flow that many times would dominate the suite runtime.
 *  Both FK parents (users → vendor_accounts) are inserted for real, because
 *  foreign keys are ON. */
function seedCohort(n: number, badge: "founding" | "early", tag: string): void {
  const ts = Date.now();
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
     VALUES (?, 'x', ?, 'active', 'vendor', 1, ?, ?)`,
  );
  const insertAccount = db.prepare(
    `INSERT INTO vendor_accounts (owner_user_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const insertSub = db.prepare(
    `INSERT INTO vendor_subscriptions
       (vendor_account_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, is_early_member, currency, created_at, updated_at)
     VALUES (?, 'founding', NULL, ?, ?, ?, 'EUR', ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const uid = Number(
        insertUser.run(`${tag}-${i}@cohort.test`, `${tag} ${i}`, ts, ts).lastInsertRowid,
      );
      const aid = Number(insertAccount.run(uid, `${tag} ${i}`, ts, ts).lastInsertRowid);
      insertSub.run(
        aid,
        ts + VENDOR_FOUNDING_DURATION_MS,
        badge === "founding" ? 1 : 0,
        badge === "early" ? 1 : 0,
        ts,
        ts,
      );
    }
  })();
}

/** A bare vendor account with no subscription row, ready for initVendorBilling. */
function makeUngrantedAccount(tag: string): number {
  const ts = Date.now();
  const uid = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
         VALUES (?, 'x', ?, 'active', 'vendor', 1, ?, ?)`,
      )
      .run(`${tag}@ungranted.test`, tag, ts, ts).lastInsertRowid,
  );
  return Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(uid, tag, ts, ts).lastInsertRowid,
  );
}

describe("vendor free-cohort ladder", () => {
  test("vendorOfferForSlots walks founding → early → trial", () => {
    expect(vendorOfferForSlots(0, 0)).toEqual({
      tier: "founding",
      duration_ms: VENDOR_FOUNDING_DURATION_MS,
      spots_left: VENDOR_FOUNDING_CAP,
      cap: VENDOR_FOUNDING_CAP,
    });
    // Last founding slot is still founding; the one after it flips tiers.
    expect(vendorOfferForSlots(VENDOR_FOUNDING_CAP - 1, 0).tier).toBe("founding");
    expect(vendorOfferForSlots(VENDOR_FOUNDING_CAP - 1, 0).spots_left).toBe(1);
    expect(vendorOfferForSlots(VENDOR_FOUNDING_CAP, 0)).toEqual({
      tier: "early",
      duration_ms: VENDOR_EARLY_DURATION_MS,
      spots_left: VENDOR_EARLY_CAP,
      cap: VENDOR_EARLY_CAP,
    });
    expect(vendorOfferForSlots(VENDOR_FOUNDING_CAP, VENDOR_EARLY_CAP - 1).spots_left).toBe(1);
    expect(vendorOfferForSlots(VENDOR_FOUNDING_CAP, VENDOR_EARLY_CAP)).toEqual({
      tier: "trial",
      duration_ms: VENDOR_TRIAL_DURATION_MS,
      spots_left: 0,
      cap: 0,
    });
  });

  test("founding slots remaining → one free year, founding badge only", () => {
    wipeAll();
    const accountId = makeUngrantedAccount("first-vendor");
    const nowMs = Date.now();
    const row = initVendorBilling(accountId, "EUR", nowMs);

    expect(row.subscription_status).toBe("founding");
    expect(row.founding_until).toBe(nowMs + VENDOR_FOUNDING_DURATION_MS);
    expect(row.trial_ends_at).toBeNull();
    expect(row.is_founding_member).toBe(1);
    expect(row.is_early_member).toBe(0);
    expect(vendorFoundingSpotsLeft()).toBe(VENDOR_FOUNDING_CAP - 1);
    // An early slot is NOT consumed while the founding cohort is still open.
    expect(vendorEarlySpotsLeft()).toBe(VENDOR_EARLY_CAP);
  });

  test("founding cohort full → three months free on the early badge", () => {
    wipeAll();
    seedCohort(VENDOR_FOUNDING_CAP, "founding", "f");
    expect(vendorFoundingSpotsLeft()).toBe(0);
    expect(currentVendorOffer().tier).toBe("early");

    const accountId = makeUngrantedAccount("vendor-101");
    const nowMs = Date.now();
    const row = initVendorBilling(accountId, "EUR", nowMs);

    // Still 'founding' status, which is what carries the free window through
    // computeEntitlement, but the badge (and therefore the cap it counts
    // against) is the early one.
    expect(row.subscription_status).toBe("founding");
    expect(row.founding_until).toBe(nowMs + VENDOR_EARLY_DURATION_MS);
    expect(row.trial_ends_at).toBeNull();
    expect(row.is_founding_member).toBe(0);
    expect(row.is_early_member).toBe(1);
    expect(vendorFoundingSpotsLeft()).toBe(0);
    expect(vendorEarlySpotsLeft()).toBe(VENDOR_EARLY_CAP - 1);
    expect(toVendorBilling(row, nowMs).entitled).toBe(true);
  });

  test("both cohorts full → the 3-day trial, no badge", () => {
    wipeAll();
    seedCohort(VENDOR_FOUNDING_CAP, "founding", "f");
    seedCohort(VENDOR_EARLY_CAP, "early", "e");
    expect(currentVendorOffer()).toEqual({
      tier: "trial",
      duration_ms: VENDOR_TRIAL_DURATION_MS,
      spots_left: 0,
      cap: 0,
    });

    const accountId = makeUngrantedAccount("vendor-401");
    const nowMs = Date.now();
    const row = initVendorBilling(accountId, "EUR", nowMs);

    expect(row.subscription_status).toBe("trialing");
    expect(row.trial_ends_at).toBe(nowMs + VENDOR_TRIAL_DURATION_MS);
    expect(row.founding_until).toBeNull();
    expect(row.is_founding_member).toBe(0);
    expect(row.is_early_member).toBe(0);
  });

  test("an expired free window never frees its slot back up", () => {
    wipeAll();
    enableBillingEnforcement();
    const accountId = makeUngrantedAccount("long-ago");
    const longAgo = Date.now() - VENDOR_FOUNDING_DURATION_MS * 2;
    const row = initVendorBilling(accountId, "EUR", longAgo);

    expect(toVendorBilling(row).entitled).toBe(false);
    // Badge is permanent, so the cohort counter does not rewind.
    expect(vendorFoundingSpotsLeft()).toBe(VENDOR_FOUNDING_CAP - 1);
  });

  test("GET /api/vendor/billing reports the live offer", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-offer@weddly.test",
      "vendor-offer@weddly.test",
      "Offer Co",
    );
    const { vendorToken } = await claimVendor(listingId, "vendor-offer@weddly.test");

    const r = await req<BillingResponse & { offer: VendorOffer; early_spots_left: number }>(
      "GET",
      "/api/vendor/billing",
      undefined,
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.offer.tier).toBe("founding");
    // The claim itself just spent a slot, so the offer counts one fewer.
    expect(r.data.offer.spots_left).toBe(VENDOR_FOUNDING_CAP - 1);
    expect(r.data.early_spots_left).toBe(VENDOR_EARLY_CAP);
    expect(r.data.billing.is_early_member).toBe(false);
  });

  // The details endpoint is the read-only mirror of Stripe (card + invoices).
  // With STRIPE_SECRET_KEY unset — the test environment, and production until
  // the vendor go-live — it must answer 200 with an empty, inactive payload
  // rather than a 503 the settings tab would have to special-case.
  test("GET /api/vendor/billing/details answers empty while Stripe is unconfigured", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-details@weddly.test",
      "vendor-details@weddly.test",
      "Details Co",
    );
    const { vendorToken } = await claimVendor(listingId, "vendor-details@weddly.test");

    const r = await req<VendorBillingDetails>("GET", "/api/vendor/billing/details", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.billing_active).toBe(false);
    expect(r.data.card).toBeNull();
    expect(r.data.invoices).toEqual([]);
  });

  test("GET /api/vendor/billing/details needs a vendor session", async () => {
    const anon = await req("GET", "/api/vendor/billing/details");
    expect(anon.status).toBe(401);

    const couple = await registerAndVerify({
      email: `details-couple-${Date.now()}@weddly.test`,
      password: "test1234",
      full_name: "Panni Kovács",
    });
    const asCouple = await req("GET", "/api/vendor/billing/details", undefined, {
      token: couple.data.token,
    });
    expect(asCouple.status).toBe(403);
  });
});
