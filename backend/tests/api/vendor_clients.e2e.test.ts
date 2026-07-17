// Vendor "clients" CRM + lightweight payment tracking.
//
// A vendor CLIENT is a couple that reached the vendor THROUGH Weddly — one
// supplier_bookings row owned by the vendor's account. This suite bootstraps a
// real claimed vendor the same way vendor_availability.e2e.test.ts does, has an
// admin create the inbound booking, and then exercises the vendor surfaces:
// list, detail, CRM status/stage/money PATCH, the PRO-gated payment schedule
// (add / toggle paid / delete), cross-vendor ownership isolation, and the
// free-plan paywall on payment tracking.
//
// Pairs with backend/src/routes/vendor_clients.ts + domain/vendor_clients.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import type {
  VendorClientDetail,
  VendorClientPayment,
  VendorClientView,
} from "@shared/vendor_clients";
import type { SupplierBooking } from "@shared/suppliers";

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
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: fullName,
  });
  expect(complete.status).toBe(201);
  return { vendorToken: complete.data.token, listingId };
}

/** Bootstrap a claimed vendor and return their session token + listing id +
 *  vendor_account id. The account id is read off the claimed listing's
 *  vendor_account_id rather than inferred from the listing slug — the two only
 *  coincide on a clean DB, and diverge once other suites have advanced the
 *  autoincrement sequences (the full-suite pollution that broke this). */
async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const { listingId } = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    `vendor-${slug}@weddly.test`,
    `${slug} Studio`,
  );
  const claimed = await claimListing(listingId, `vendor-${slug}@weddly.test`, `Vendor ${slug}`);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { ...claimed, accountId: acct.id };
}

/** Admin creates an inbound booking (a couple inquiry) against a claimed
 *  listing — the only way a vendor gets a "client". Returns the booking id. */
async function createInboundBooking(
  listingId: string,
  coupleId: number,
  eventDate: string,
): Promise<number> {
  const adminToken = await registerAdminAndGetToken();
  const r = await req<SupplierBooking>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes: "Looking forward!" },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

/** Grant the vendor an entitled (founding) subscription → PRO tier. A freshly
 *  claimed vendor has no sub row and is FREE; the payment surfaces need PRO. */
function upgradeToPro(accountId: number): void {
  initVendorBilling(accountId, "EUR");
}

describe("vendor clients — /api/vendor/clients + payment tracking", () => {
  test("lists the vendor's Weddly-sourced clients with couple name + status", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("clients-list");
    upgradeToPro(accountId);
    const { coupleId } = await bootstrapCouple("couple-list@weddly.test");
    await createInboundBooking(listingId, coupleId, "2030-06-20");

    const r = await req<{ clients: VendorClientView[] }>("GET", "/api/vendor/clients", undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.clients.length).toBe(1);
    const client = r.data.clients[0];
    expect(client?.couple_id).toBe(coupleId);
    expect(client?.couple_display_name).toBe("Mia & Lucas");
    expect(client?.event_date).toBe("2030-06-20");
    expect(client?.status).toBe("requested");
    // No money recorded yet → null balance.
    expect(client?.balance).toBeNull();
  });

  test("detail returns the couple contact email + empty payment schedule", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("clients-detail");
    upgradeToPro(accountId);
    const { coupleId } = await bootstrapCouple("couple-detail@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, "2030-07-01");

    const r = await req<VendorClientDetail>("GET", `/api/vendor/clients/${bookingId}`, undefined, {
      token: vendorToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(bookingId);
    expect(r.data.couple_contact_email).toBe("couple-detail@weddly.test");
    expect(r.data.payments).toEqual([]);
    expect(r.data.vendor_notes).toBeNull();
  });

  test("PATCH updates status + stage + money and recomputes balance", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("clients-patch");
    upgradeToPro(accountId);
    const { coupleId } = await bootstrapCouple("couple-patch@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, "2030-08-08");

    const r = await req<{ client: VendorClientDetail }>(
      "PATCH",
      `/api/vendor/clients/${bookingId}`,
      {
        status: "confirmed",
        stage: "Contract sent",
        vendor_notes: "Deposit due Friday",
        contract_value: 500000,
        deposit_paid: 150000,
      },
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.client.status).toBe("confirmed");
    expect(r.data.client.stage).toBe("Contract sent");
    expect(r.data.client.vendor_notes).toBe("Deposit due Friday");
    expect(r.data.client.contract_value).toBe(500000);
    expect(r.data.client.deposit_paid).toBe(150000);
    expect(r.data.client.balance).toBe(350000);

    // The mutation is audited (append-only log).
    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vendor_client.updated' AND target_id = ?",
      )
      .get(bookingId) as { n: number };
    expect(audit.n).toBe(1);
  });

  test("payment schedule: add → toggle paid → delete (PRO)", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("clients-pay");
    upgradeToPro(accountId);
    const { coupleId } = await bootstrapCouple("couple-pay@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, "2030-09-09");

    // Add an installment.
    const add = await req<{ payment: VendorClientPayment }>(
      "POST",
      `/api/vendor/clients/${bookingId}/payments`,
      { label: "Deposit", amount: 100000, due_date: "2030-03-01" },
      { token: vendorToken },
    );
    expect(add.status).toBe(200);
    expect(add.data.payment.label).toBe("Deposit");
    expect(add.data.payment.amount).toBe(100000);
    expect(add.data.payment.paid).toBe(false);
    const paymentId = add.data.payment.id;

    // It shows on the PRO payments list.
    const list = await req<{ payments: VendorClientPayment[] }>(
      "GET",
      `/api/vendor/clients/${bookingId}/payments`,
      undefined,
      { token: vendorToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.payments.length).toBe(1);

    // Toggle paid → paid_at stamped.
    const toggle = await req<{ payment: VendorClientPayment }>(
      "PATCH",
      `/api/vendor/payments/${paymentId}`,
      { paid: true },
      { token: vendorToken },
    );
    expect(toggle.status).toBe(200);
    expect(toggle.data.payment.paid).toBe(true);
    expect(toggle.data.payment.paid_at).not.toBeNull();

    // Delete it.
    const del = await req<{ ok: boolean }>(
      "DELETE",
      `/api/vendor/payments/${paymentId}`,
      undefined,
      { token: vendorToken },
    );
    expect(del.status).toBe(200);
    expect(del.data.ok).toBe(true);

    const after = await req<{ payments: VendorClientPayment[] }>(
      "GET",
      `/api/vendor/clients/${bookingId}/payments`,
      undefined,
      { token: vendorToken },
    );
    expect(after.data.payments.length).toBe(0);
  });

  test("ownership isolation: vendor B cannot see or mutate vendor A's client", async () => {
    wipeAll();
    const a = await bootstrapVendor("iso-a");
    const b = await bootstrapVendor("iso-b");
    upgradeToPro(a.accountId);
    upgradeToPro(b.accountId);
    const { coupleId } = await bootstrapCouple("couple-iso@weddly.test");
    const bookingId = await createInboundBooking(a.listingId, coupleId, "2030-10-10");

    // B's client list is empty — the booking belongs to A.
    const bList = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: b.vendorToken },
    );
    expect(bList.status).toBe(200);
    expect(bList.data.clients.length).toBe(0);

    // B fetching A's client → 404 (not 403, so ids can't be enumerated).
    const bGet = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/vendor/clients/${bookingId}`,
      undefined,
      { token: b.vendorToken },
    );
    expect(bGet.status).toBe(404);
    expect(bGet.data.detail?.code).toBe("client_not_found");

    // B patching A's client → 404.
    const bPatch = await req(
      "PATCH",
      `/api/vendor/clients/${bookingId}`,
      { status: "confirmed" },
      { token: b.vendorToken },
    );
    expect(bPatch.status).toBe(404);

    // A adds a payment; B cannot toggle it.
    const add = await req<{ payment: VendorClientPayment }>(
      "POST",
      `/api/vendor/clients/${bookingId}/payments`,
      { label: "Deposit", amount: 50000, due_date: null },
      { token: a.vendorToken },
    );
    expect(add.status).toBe(200);
    const bToggle = await req<{ detail?: { code?: string } }>(
      "PATCH",
      `/api/vendor/payments/${add.data.payment.id}`,
      { paid: true },
      { token: b.vendorToken },
    );
    expect(bToggle.status).toBe(404);
    expect(bToggle.data.detail?.code).toBe("payment_not_found");
  });

  test("free plan: list/detail work but payment tracking is PRO-gated (403)", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("free-gate");
    const { coupleId } = await bootstrapCouple("couple-free@weddly.test");
    // The inquiry arrives while the activation grant is live (claim-complete
    // grants founding/trial), THEN the vendor lapses to FREE: a free vendor
    // can't receive new inquiries but keeps the ones already delivered.
    const bookingId = await createInboundBooking(listingId, coupleId, "2030-11-11");
    db.prepare(
      "UPDATE vendor_subscriptions SET subscription_status = 'none', founding_until = NULL, is_founding_member = 0 WHERE vendor_account_id = ?",
    ).run(accountId);

    // FREE tier still sees the basic client list + detail.
    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: vendorToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.clients.length).toBe(1);

    const detail = await req("GET", `/api/vendor/clients/${bookingId}`, undefined, {
      token: vendorToken,
    });
    expect(detail.status).toBe(200);

    // Payment tracking is PRO-only → 403 with a clear paywall code.
    const addPayment = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/vendor/clients/${bookingId}/payments`,
      { label: "Deposit", amount: 100000 },
      { token: vendorToken },
    );
    expect(addPayment.status).toBe(403);
    expect(addPayment.data.detail?.code).toBe("vendor_pro_required");

    const listPayments = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/vendor/clients/${bookingId}/payments`,
      undefined,
      { token: vendorToken },
    );
    expect(listPayments.status).toBe(403);
    expect(listPayments.data.detail?.code).toBe("vendor_pro_required");
  });

  test("anon → 401, couple-role → 403", async () => {
    wipeAll();
    const anon = await req("GET", "/api/vendor/clients");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-clients@weddly.test");
    const couple = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token },
    );
    expect(couple.status).toBe(403);
    expect(couple.data.detail?.code).toBe("vendor_role_required");
  });
});
