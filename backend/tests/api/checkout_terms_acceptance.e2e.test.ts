// Point-of-purchase terms-acceptance ledger for recurring checkout (couple,
// planner, vendor). Backs the `PAID_CHECKOUT_TERMS_ACCEPTANCE` readiness gate
// in domain/payment_launch.ts.
//
// Vendor is the only one of the three whose subscription terms are already
// owner-reviewed (VENDOR_TERMS_REVIEWED = true), so it is the only path that
// can be driven all the way to `requirePaymentLaunch` passing in a test. Its
// checkout/setup handlers refuse BEFORE any Stripe network call is made,
// which is what makes the negative path here safe to exercise with fake
// Stripe config (matching the rest of this suite: no test anywhere completes
// a real checkout.sessions.create, since there is no Stripe network stub for
// it). Couple and planner stay fail-closed at the readiness gate itself
// (COUPLE_TERMS_REVIEWED / PLANNER_TERMS_REVIEWED are still false), so their
// coverage here is the ledger primitive directly (domain-level) plus the
// GET status endpoints' read side, which needs no Stripe config at all.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  COUPLE_SUBSCRIPTION_TERMS_VERSION,
  PLANNER_SUBSCRIPTION_TERMS_VERSION,
  PRIVACY_VERSION,
  VENDOR_TERMS_VERSION,
} from "@shared/legal";
import type { BillingStatusResponse } from "@shared/billing";
import type { PlannerBillingStatus } from "@shared/planner_billing";
import { CONFIG } from "../../src/config";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { hasAcceptedCurrentVersion, recordConsent } from "../../src/domain/consents";
import { initPlannerBilling } from "../../src/domain/planner_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

async function addAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

async function makePlanner(email: string): Promise<{ token: string; userId: number }> {
  const reg = await registerAndVerify({ email, password: "supersafe123", full_name: "Planner" });
  expect(reg.status).toBe(201);
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET user_type = 'planner' WHERE id = ?").run(userId);
  initPlannerBilling(userId);
  return { token: reg.data.token, userId };
}

/** Walk a community supplier through submit → verify-email → admin approve so
 *  it has an `active` listing with a contact_email ready to be claimed.
 *  Mirrors the helper in vendor_billing.e2e.test.ts. */
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
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await addAdmin();
  const approve = await req(
    "POST",
    `/api/admin/suppliers/${numericId}/approve`,
    {},
    { token: adminToken },
  );
  expect(approve.status).toBe(200);
  return publicId;
}

/** Run the full claim flow — the claimed vendor has NO vendor_terms consent
 *  on file, same as a real production account that predates this feature or
 *  never opened the app's own accept-terms modal. */
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
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: "Vendor Owner",
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
    highlighted_terms_accepted: true,
  });
  expect(complete.status).toBe(201);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { vendorToken: complete.data.token, accountId: acct.id };
}

/** Configure fake-but-complete vendor Stripe env + flip the operator switch
 *  on, so `requirePaymentLaunch("vendor_billing")` passes and a checkout
 *  call reaches the terms gate instead of 503ing before it. Returns a
 *  restore function. */
async function makeVendorBillingReady(): Promise<() => void> {
  const old = {
    stripeSecretKey: CONFIG.stripeSecretKey,
    stripeVendorWebhookSecret: CONFIG.stripeVendorWebhookSecret,
    stripePriceVendorEur: CONFIG.stripePriceVendorEur,
    stripePriceVendorHuf: CONFIG.stripePriceVendorHuf,
  };
  CONFIG.stripeSecretKey = "sk_test_terms_gate";
  CONFIG.stripeVendorWebhookSecret = "whsec_vendor_terms_gate";
  CONFIG.stripePriceVendorEur = "price_vendor_eur_terms_gate";
  CONFIG.stripePriceVendorHuf = "price_vendor_huf_terms_gate";
  db.prepare(
    "INSERT INTO payment_launch_control (product, enabled) VALUES ('vendor_billing', 1) " +
      "ON CONFLICT(product) DO UPDATE SET enabled = 1",
  ).run();
  return () => {
    CONFIG.stripeSecretKey = old.stripeSecretKey;
    CONFIG.stripeVendorWebhookSecret = old.stripeVendorWebhookSecret;
    CONFIG.stripePriceVendorEur = old.stripePriceVendorEur;
    CONFIG.stripePriceVendorHuf = old.stripePriceVendorHuf;
  };
}

describe("checkout terms-acceptance ledger (domain)", () => {
  test("hasAcceptedCurrentVersion / recordConsent round-trip for the two new documents", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ledger-couple@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    const userId = me.data.user.id;

    expect(
      hasAcceptedCurrentVersion(
        userId,
        "couple_subscription_terms",
        COUPLE_SUBSCRIPTION_TERMS_VERSION,
      ),
    ).toBe(false);
    expect(
      hasAcceptedCurrentVersion(
        userId,
        "planner_subscription_terms",
        PLANNER_SUBSCRIPTION_TERMS_VERSION,
      ),
    ).toBe(false);

    recordConsent({
      subjectUserId: userId,
      subjectKind: "user",
      subjectRef: null,
      document: "couple_subscription_terms",
      version: COUPLE_SUBSCRIPTION_TERMS_VERSION,
      ip: "127.0.0.1",
      userAgent: "bun-test",
    });
    expect(
      hasAcceptedCurrentVersion(
        userId,
        "couple_subscription_terms",
        COUPLE_SUBSCRIPTION_TERMS_VERSION,
      ),
    ).toBe(true);
    // A DIFFERENT (e.g. future, bumped) version is not satisfied by an older
    // acceptance — a content change must re-ask.
    expect(hasAcceptedCurrentVersion(userId, "couple_subscription_terms", "2099-01-01")).toBe(
      false,
    );
    // The sibling document is untouched.
    expect(
      hasAcceptedCurrentVersion(
        userId,
        "planner_subscription_terms",
        PLANNER_SUBSCRIPTION_TERMS_VERSION,
      ),
    ).toBe(false);
  });
});

describe("GET /api/billing/status — subscription_terms_accepted", () => {
  test("false for a fresh couple, true once the ledger has a matching row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("status-couple@weddly.test");
    const before = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, {
      token,
    });
    expect(before.status).toBe(200);
    expect(before.data.subscription_terms_accepted).toBe(false);
    expect(before.data.subscription_terms_version).toBe(COUPLE_SUBSCRIPTION_TERMS_VERSION);

    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    recordConsent({
      subjectUserId: me.data.user.id,
      subjectKind: "user",
      subjectRef: null,
      document: "couple_subscription_terms",
      version: COUPLE_SUBSCRIPTION_TERMS_VERSION,
      ip: null,
      userAgent: null,
    });
    const after = await req<BillingStatusResponse>("GET", "/api/billing/status", undefined, {
      token,
    });
    expect(after.data.subscription_terms_accepted).toBe(true);
  });
});

describe("GET /api/planner/billing — subscription_terms_accepted", () => {
  test("false for a fresh planner, true once the ledger has a matching row", async () => {
    wipeAll();
    const { token, userId } = await makePlanner("status-planner@weddly.test");
    const before = await req<PlannerBillingStatus>("GET", "/api/planner/billing", undefined, {
      token,
    });
    expect(before.status).toBe(200);
    expect(before.data.subscription_terms_accepted).toBe(false);
    expect(before.data.subscription_terms_version).toBe(PLANNER_SUBSCRIPTION_TERMS_VERSION);

    recordConsent({
      subjectUserId: userId,
      subjectKind: "user",
      subjectRef: null,
      document: "planner_subscription_terms",
      version: PLANNER_SUBSCRIPTION_TERMS_VERSION,
      ip: null,
      userAgent: null,
    });
    const after = await req<PlannerBillingStatus>("GET", "/api/planner/billing", undefined, {
      token,
    });
    expect(after.data.subscription_terms_accepted).toBe(true);
  });
});

describe("couple/planner checkout stay fail-closed regardless of a terms_version in the body", () => {
  test("couple checkout: 503 payment_not_ready, not 400/200, even with the correct terms_version", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("gated-couple@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/billing/checkout",
      { terms_version: COUPLE_SUBSCRIPTION_TERMS_VERSION },
      { token },
    );
    // COUPLE_TERMS_REVIEWED is still false in domain/payment_launch.ts, so the
    // readiness gate (checked before the terms gate) wins regardless of what
    // the request sends.
    expect(r.status).toBe(503);
    expect(r.data.detail?.code).toBe("payment_not_launched");
  });

  test("planner checkout: 503 payment_not_ready, not 400/200, even with the correct terms_version", async () => {
    wipeAll();
    const { token } = await makePlanner("gated-planner@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/planner/billing/checkout",
      { tier: "starter", terms_version: PLANNER_SUBSCRIPTION_TERMS_VERSION },
      { token },
    );
    expect(r.status).toBe(503);
    expect(r.data.detail?.code).toBe("payment_not_launched");
  });
});

describe("vendor checkout terms gate (VENDOR_TERMS_REVIEWED is already true)", () => {
  test("setup and checkout both refuse without terms, before any Stripe call, no side effects", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-terms-gate@weddly.test",
      "vendor-terms-gate@weddly.test",
      "Terms Gate Photography",
    );
    const { vendorToken, accountId } = await claimVendor(
      listingId,
      "vendor-terms-gate@weddly.test",
    );
    // claimVendor now records consent itself (claim-complete IS this
    // vendor's registration). This gate exists for the vendor who never did —
    // a legacy account from before consent capture — so strip it back out to
    // simulate that instead of the now-impossible "claimed but unaccepted".
    db.prepare(
      "DELETE FROM user_consents WHERE document IN ('vendor_terms', 'vendor_terms_highlighted')",
    ).run();
    const restore = await makeVendorBillingReady();
    try {
      for (const path of ["/api/vendor/billing/setup", "/api/vendor/billing/checkout"]) {
        const r = await req<{ detail?: { code?: string; terms_version?: string } }>(
          "POST",
          path,
          {},
          { token: vendorToken },
        );
        expect(r.status).toBe(400);
        expect(r.data.detail?.code).toBe("terms_not_accepted");
        expect(r.data.detail?.terms_version).toBe(VENDOR_TERMS_VERSION);
      }
      const consents = db
        .prepare(
          "SELECT document FROM user_consents WHERE document IN ('vendor_terms','vendor_terms_highlighted')",
        )
        .all();
      expect(consents.length).toBe(0);
      // claim/complete already grants the free/trial window via
      // initVendorBilling, so the row itself pre-exists — what proves the
      // refusal happened before any Stripe call is that no customer id was
      // ever attached and no card was marked on file.
      const sub = db
        .prepare(
          "SELECT stripe_customer_id, card_on_file FROM vendor_subscriptions WHERE vendor_account_id = ?",
        )
        .get(accountId) as { stripe_customer_id: string | null; card_on_file: number };
      expect(sub.stripe_customer_id).toBeNull();
      expect(sub.card_on_file).toBe(0);
    } finally {
      restore();
    }
  });

  test("a vendor who already accepted at the current version is not re-prompted", async () => {
    wipeAll();
    const listingId = await makeApprovedListing(
      "owner-terms-ok@weddly.test",
      "vendor-terms-ok@weddly.test",
      "Terms Ok Catering",
    );
    const { vendorToken, accountId } = await claimVendor(listingId, "vendor-terms-ok@weddly.test");
    const ownerId = (
      db.prepare("SELECT owner_user_id FROM vendor_accounts WHERE id = ?").get(accountId) as {
        owner_user_id: number;
      }
    ).owner_user_id;
    const evidence = {
      subjectUserId: ownerId,
      subjectKind: "user" as const,
      subjectRef: null,
      ip: null,
      userAgent: null,
    };
    recordConsent({ ...evidence, document: "vendor_terms", version: VENDOR_TERMS_VERSION });
    recordConsent({
      ...evidence,
      document: "vendor_terms_highlighted",
      version: VENDOR_TERMS_VERSION,
    });

    // GET /api/vendor/billing reads the exact same hasCurrentVendorAcceptance
    // check that the checkout/setup handlers' ensureVendorTermsAccepted guard
    // uses to decide whether to skip re-prompting — so this is sufficient
    // proof the checkout path would not re-ask, without needing to drive the
    // request past this guard into the real (unmockable in this suite)
    // Stripe customer/session creation call.
    const status = await req<{ subscription_terms_accepted: boolean }>(
      "GET",
      "/api/vendor/billing",
      undefined,
      { token: vendorToken },
    );
    expect(status.data.subscription_terms_accepted).toBe(true);
  });
});
