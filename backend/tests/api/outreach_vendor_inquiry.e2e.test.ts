// Outreach → vendor inbox delivery.
//
// The bug this suite pins down: `POST /api/outreach/campaigns` is the ONLY
// couple-facing "send an inquiry" path (the supplier detail page's CTA opens
// its composer), but for a long time it was email-only. It wrote
// outreach_campaigns/outreach_messages and mailed listings.contact_email, and
// never touched `supplier_bookings` — which is the one table every vendor
// surface reads (the /vendor dashboard counters, /vendor/clients, the
// /vendor/stats conversion panel, the vendor Google Calendar). Its only writer
// was the ADMIN-only POST /api/suppliers/:id/bookings. So a couple could send
// a message, watch it land in their own sent history, and the vendor's account
// would honestly report zero inquiries, forever.
//
// What's asserted here is the seam: a claimed recipient gets a real inquiry
// with the couple's message on it whatever their PLAN, an unclaimed one gets
// only the mail (there is no account to deliver into) but is handed the lead the
// moment they claim, a follow-up joins the open inquiry instead of opening a
// second one, and the couple is told which of those actually happened.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { OutreachCampaignDetail } from "@shared/outreach";
import type { VendorClientDetail, VendorClientView } from "@shared/vendor_clients";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { replayOutreachForListing } from "../../src/domain/outreach";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// ── Bootstrap (same shape as vendor_clients.e2e.test.ts) ──────────────────

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
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

/** Claim the listing so it belongs to a real vendor account. Returns the
 *  vendor's session token, the (unchanged) listing id, and the account id. */
async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const contactEmail = `vendor-${slug}@weddly.test`;
  const listingId = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    contactEmail,
    `${slug} Studio`,
  );
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
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
    full_name: `Vendor ${slug}`,
  });
  expect(complete.status).toBe(201);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

async function sendOutreach(
  token: string,
  supplierIds: string[],
  subject: string,
  body: string,
): Promise<number> {
  const r = await req(
    "POST",
    "/api/outreach/campaigns",
    { subject, body_template: body, supplier_ids: supplierIds },
    { token },
  );
  return r.status;
}

function bookingsFor(supplierId: string): Array<{ id: number; notes: string | null }> {
  return db
    .prepare("SELECT id, notes FROM supplier_bookings WHERE supplier_id = ? ORDER BY id ASC")
    .all(supplierId) as Array<{ id: number; notes: string | null }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("outreach → vendor inbox", () => {
  test("a message to a claimed vendor becomes a client they can actually read", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("inbox");
    // Direct inquiries are PRO; a freshly claimed account has no sub row.
    initVendorBilling(accountId, "EUR");
    const { token, coupleId } = await bootstrapCouple("couple-inbox@weddly.test");

    expect(
      await sendOutreach(
        token,
        [listingId],
        "Photo for Sept 12",
        "Are you free on our date? About 80 guests.",
      ),
    ).toBe(201);

    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: vendorToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.clients).toHaveLength(1);
    const client = list.data.clients[0]!;
    expect(client.couple_id).toBe(coupleId);
    expect(client.status).toBe("requested");
    // The couple's wedding date rides along so the vendor can check availability.
    expect(client.event_date).toBe("2026-09-12");

    const detail = await req<VendorClientDetail>(
      "GET",
      `/api/vendor/clients/${client.id}`,
      undefined,
      { token: vendorToken },
    );
    expect(detail.status).toBe(200);
    // Subject AND body — a lead the vendor can answer, not just a name.
    expect(detail.data.inquiry_message).toContain("Photo for Sept 12");
    expect(detail.data.inquiry_message).toContain("About 80 guests");
  }, 30000);

  test("a follow-up joins the open inquiry instead of opening a second one", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("followup");
    initVendorBilling(accountId, "EUR");
    const { token } = await bootstrapCouple("couple-followup@weddly.test");

    expect(await sendOutreach(token, [listingId], "First", "Original question")).toBe(201);
    expect(await sendOutreach(token, [listingId], "Second", "Following up")).toBe(201);

    // One conversation → one row. Two would split the vendor's CRM thread and,
    // because every delivered inquiry spends a free lead credit, bill them
    // twice for the same couple.
    expect(bookingsFor(listingId)).toHaveLength(1);

    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: vendorToken },
    );
    expect(list.data.clients).toHaveLength(1);
    const detail = await req<VendorClientDetail>(
      "GET",
      `/api/vendor/clients/${list.data.clients[0]!.id}`,
      undefined,
      { token: vendorToken },
    );
    expect(detail.data.inquiry_message).toContain("Original question");
    expect(detail.data.inquiry_message).toContain("Following up");
  }, 30000);

  test("a FREE-plan vendor's lead is RECORDED, not thrown away", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("freeplan");
    // Claiming grants a sub (founding / early / trial), so drop this one out of
    // entitlement the way a lapse does, which is the FREE tier.
    db.prepare(
      `UPDATE vendor_subscriptions
          SET subscription_status = 'canceled', founding_until = NULL,
              trial_ends_at = NULL, current_period_end = NULL
        WHERE vendor_account_id = ?`,
    ).run(accountId);
    const { token } = await bootstrapCouple("couple-free@weddly.test");

    expect(await sendOutreach(token, [listingId], "Hello", "Are you available?")).toBe(201);

    // The entitlement check used to sit HERE, at creation, and returned null, so
    // so the lead was not deferred, it was destroyed, unrecoverable even if the
    // vendor subscribed an hour later, while the couple was told "sent" and the
    // vendor was mailed a link to a dashboard where it did not exist. The PRO
    // gate belongs on `bookable` (the date-picker booking), not on writing down
    // a message that has already been emailed.
    expect(bookingsFor(listingId)).toHaveLength(1);
    // And the basic client list is FREE by design, so they can read it.
    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: vendorToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.clients).toHaveLength(1);

    const msgs = db
      .prepare("SELECT status FROM outreach_messages WHERE supplier_id = ?")
      .all(listingId) as Array<{ status: string }>;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.status).toBe("sent");
  }, 30000);

  test("the couple is told which recipients it actually reached in-app", async () => {
    wipeAll();
    const { listingId, accountId } = await bootstrapVendor("delivery");
    initVendorBilling(accountId, "EUR");
    const { token } = await bootstrapCouple("couple-delivery@weddly.test");
    // One claimed recipient, one curated entry nobody owns.
    const unclaimed = "budapest-congress-center";

    const sent = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Two of you",
        body_template: "Are you free?",
        supplier_ids: [listingId, unclaimed],
      },
      { token },
    );
    expect(sent.status).toBe(201);

    // One undifferentiated "sent" was how an inquiry that reached nobody's
    // dashboard looked exactly like one that did.
    const byId = new Map(sent.data.messages.map((m) => [m.supplier_id, m.delivery]));
    expect(byId.get(listingId)).toBe("in_account");
    expect(byId.get(unclaimed)).toBe("email_only");
  }, 30000);

  // Four argon2 hashes in one test (two couples, an admin, the vendor's own
  // password), so it needs more than the 5s default on a loaded machine.
  test("claiming a listing hands over the leads that arrived before the account did", async () => {
    wipeAll();
    // The message goes out FIRST, while the listing is still unclaimed: the
    // ordering the claim-invite campaign creates by design, and the one that
    // used to lose the lead permanently because supplier_bookings.
    // vendor_account_id is resolved once, at insert.
    const contactEmail = "vendor-replay@weddly.test";
    const listingId = await makeApprovedListing(
      "owner-replay@weddly.test",
      contactEmail,
      "Replay Studio",
    );
    const { token, coupleId } = await bootstrapCouple("couple-replay@weddly.test");
    expect(
      await sendOutreach(token, [listingId], "Before you joined", "Are you free in Sept?"),
    ).toBe(201);
    expect(bookingsFor(listingId)).toHaveLength(0);

    // Now the vendor claims it.
    const start = await req("POST", "/api/vendor/claim/start", {
      listing_id: listingId,
      claimant_email: "claimer-replay@gmail.test",
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
      full_name: "Vendor Replay",
    });
    expect(complete.status).toBe(201);

    // Their brand-new portal opens on the couples who were already waiting,
    // instead of on "no inquiries yet".
    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: complete.data.token },
    );
    expect(list.status).toBe(200);
    expect(list.data.clients).toHaveLength(1);
    expect(list.data.clients[0]?.couple_id).toBe(coupleId);

    const detail = await req<VendorClientDetail>(
      "GET",
      `/api/vendor/clients/${list.data.clients[0]!.id}`,
      undefined,
      { token: complete.data.token },
    );
    expect(detail.data.inquiry_message).toContain("Are you free in Sept?");

    // Idempotent: the replay is keyed on outreach_messages.booking_id, so a
    // second pass (another claim, a backfill re-run) can't duplicate the lead.
    expect(replayOutreachForListing(listingId)).toBe(0);
    expect(bookingsFor(listingId)).toHaveLength(1);
  }, 30000);

  test("an unclaimed listing gets the mail and nothing else", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("couple-unclaimed@weddly.test");
    // Curated entry with a contact_email, nobody has claimed it.
    const supplierId = "budapest-congress-center";

    expect(await sendOutreach(token, [supplierId], "Hi", "Are you free?")).toBe(201);

    expect(bookingsFor(supplierId)).toHaveLength(0);
    const msgs = db
      .prepare("SELECT COUNT(*) AS n FROM outreach_messages WHERE supplier_id = ?")
      .get(supplierId) as { n: number };
    expect(msgs.n).toBe(1);
  });

  test("a couple with no exact wedding date still reaches the vendor", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("nodate");
    initVendorBilling(accountId, "EUR");
    const { token, coupleId } = await bootstrapCouple("couple-nodate@weddly.test");
    // "Summer 2027" leaves the scalar NULL. Refusing the inquiry over a
    // missing date would drop a real lead on the floor.
    db.prepare("UPDATE couples SET wedding_date = NULL WHERE id = ?").run(coupleId);

    expect(await sendOutreach(token, [listingId], "Someday", "Still picking a date")).toBe(201);

    const list = await req<{ clients: VendorClientView[] }>(
      "GET",
      "/api/vendor/clients",
      undefined,
      { token: vendorToken },
    );
    expect(list.data.clients).toHaveLength(1);
    // Blank, not invented — the CRM renders it as "no date yet" and the
    // Google Calendar push skips anything that isn't a well-formed ISO date.
    expect(list.data.clients[0]?.event_date).toBe("");
  }, 30000);
});
