// Vendor quotes (árajánlat) end to end: a vendor prices an inquiry, sends it,
// and the couple answers.
//
// What this suite is really guarding is the set of invariants that have no
// column to enforce them:
//   * a DRAFT never leaves the vendor's side, and a SENT quote is frozen,
//   * exactly one live offer per inquiry, so sending a revision retires the
//     number the couple was looking at,
//   * the status ladder is DERIVED, which is what makes expiry work with no
//     cron and is therefore only observable through the API,
//   * accepting is what finally writes `contract_value` and confirms the date,
//   * writing a quote is PRO, but READING one and ANSWERING one never are.
//
// The bootstrap ladder is copied from booking_messages.e2e.test.ts (which
// copied it from vendor_clients.e2e.test.ts) on purpose: these suites are
// deliberately self-contained, and the outreach path is the only seam that
// produces a real inquiry with a real thread behind it.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, enableBillingEnforcement, registerAndVerify, req } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import type { BookingQuote } from "@shared/booking_quotes";
import type { VendorClientDetail, VendorClientView } from "@shared/vendor_clients";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";

interface ClaimRow {
  token: string;
}

interface ErrBody {
  detail?: { code?: string };
}

const TEST_TIMEOUT_MS = 60_000;

// ── Bootstrap ─────────────────────────────────────────────────────────────

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
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
    highlighted_terms_accepted: true,
  });
  expect(complete.status).toBe(201);
  return { vendorToken: complete.data.token, listingId };
}

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

function upgradeToPro(accountId: number): void {
  initVendorBilling(accountId, "EUR");
}

function downgradeToFree(accountId: number): void {
  db.prepare(
    `UPDATE vendor_subscriptions
        SET subscription_status = 'canceled', founding_until = NULL,
            trial_ends_at = NULL, current_period_end = NULL
      WHERE vendor_account_id = ?`,
  ).run(accountId);
}

async function sendOutreach(token: string, listingId: string): Promise<number> {
  const r = await req(
    "POST",
    "/api/outreach/campaigns",
    { subject: "Sept 12", body_template: "Are you free?", supplier_ids: [listingId] },
    { token },
  );
  return r.status;
}

async function soleBookingId(vendorToken: string): Promise<number> {
  const list = await req<{ clients: VendorClientView[] }>("GET", "/api/vendor/clients", undefined, {
    token: vendorToken,
  });
  expect(list.status).toBe(200);
  expect(list.data.clients).toHaveLength(1);
  return list.data.clients[0]!.id;
}

interface Fixture {
  vendorToken: string;
  listingId: string;
  accountId: number;
  coupleToken: string;
  coupleId: number;
  bookingId: number;
}

/** A claimed PRO vendor and an onboarded couple with one live inquiry. */
async function bootstrapThread(slug: string): Promise<Fixture> {
  const vendor = await bootstrapVendor(slug);
  upgradeToPro(vendor.accountId);
  const couple = await bootstrapCouple(`couple-${slug}@weddly.test`);
  expect(await sendOutreach(couple.token, vendor.listingId)).toBe(201);
  return {
    ...vendor,
    coupleToken: couple.token,
    coupleId: couple.coupleId,
    bookingId: await soleBookingId(vendor.vendorToken),
  };
}

const LINES = [
  { label: "Full day coverage", unit_amount: 1200, qty: 1 },
  { label: "Extra hour", unit_amount: 150, qty: 2 },
];
/** 1200 + 300. Written out so a change to LINES cannot silently pass. */
const LINES_TOTAL = 1500;

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function createQuote(
  f: Fixture,
  body: Record<string, unknown> = {},
): Promise<{ status: number; quote: BookingQuote; code?: string }> {
  const r = await req<{ quote: BookingQuote } & ErrBody>(
    "POST",
    `/api/vendor/clients/${f.bookingId}/quotes`,
    { title: "Wedding coverage", lines: LINES, ...body },
    { token: f.vendorToken },
  );
  return { status: r.status, quote: r.data.quote, code: r.data.detail?.code };
}

async function sendQuote(f: Fixture, quoteId: number) {
  return req<{ quote: BookingQuote } & ErrBody>(
    "POST",
    `/api/vendor/quotes/${quoteId}/send`,
    {},
    { token: f.vendorToken },
  );
}

async function coupleQuotes(f: Fixture, token = f.coupleToken) {
  return req<{ quotes: BookingQuote[] } & ErrBody>(
    "GET",
    `/api/messages/threads/${f.bookingId}/quotes`,
    undefined,
    { token },
  );
}

async function vendorQuotes(f: Fixture) {
  return req<{ quotes: BookingQuote[] }>(
    "GET",
    `/api/vendor/clients/${f.bookingId}/quotes`,
    undefined,
    { token: f.vendorToken },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("vendor quotes — pricing an inquiry", () => {
  test(
    "a draft stays on the vendor's side; sending is what shows it to the couple",
    async () => {
      const f = await bootstrapThread("q-draft");

      const created = await createQuote(f);
      expect(created.status).toBe(201);
      expect(created.quote.status).toBe("draft");
      // The total is derived from the lines, so it is right without anyone
      // having posted it.
      expect(created.quote.total).toBe(LINES_TOTAL);
      expect(created.quote.lines).toHaveLength(2);
      expect(created.quote.currency).toBe("EUR");

      // The couple sees nothing at all while it is a draft.
      const before = await coupleQuotes(f);
      expect(before.status).toBe(200);
      expect(before.data.quotes).toHaveLength(0);

      const sent = await sendQuote(f, created.quote.id);
      expect(sent.status).toBe(200);
      expect(sent.data.quote.status).toBe("sent");
      expect(sent.data.quote.sent_at).not.toBeNull();

      const after = await coupleQuotes(f);
      expect(after.data.quotes).toHaveLength(1);
      expect(after.data.quotes[0]!.title).toBe("Wedding coverage");
      expect(after.data.quotes[0]!.total).toBe(LINES_TOTAL);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the couple opening the thread is what marks it viewed, first-wins",
    async () => {
      const f = await bootstrapThread("q-viewed");
      const created = await createQuote(f);
      await sendQuote(f, created.quote.id);

      // The vendor's own read must not stamp it: only the couple's visit counts.
      const vendorRead = await vendorQuotes(f);
      expect(vendorRead.data.quotes[0]!.status).toBe("sent");
      expect(vendorRead.data.quotes[0]!.viewed_at).toBeNull();

      const first = await coupleQuotes(f);
      expect(first.data.quotes[0]!.status).toBe("viewed");
      const stamp = first.data.quotes[0]!.viewed_at;
      expect(stamp).not.toBeNull();

      const second = await coupleQuotes(f);
      expect(second.data.quotes[0]!.viewed_at).toBe(stamp);

      const afterVendor = await vendorQuotes(f);
      expect(afterVendor.data.quotes[0]!.status).toBe("viewed");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "accepting writes the contract value and confirms the date",
    async () => {
      const f = await bootstrapThread("q-accept");
      const created = await createQuote(f, { deposit_amount: 400 });
      await sendQuote(f, created.quote.id);

      const before = await req<VendorClientDetail>(
        "GET",
        `/api/vendor/clients/${f.bookingId}`,
        undefined,
        { token: f.vendorToken },
      );
      expect(before.data.contract_value).toBeNull();
      expect(before.data.status).not.toBe("confirmed");

      const accept = await req<{ quote: BookingQuote }>(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(accept.status).toBe(200);
      expect(accept.data.quote.status).toBe("accepted");
      expect(accept.data.quote.accepted_at).not.toBeNull();

      const after = await req<VendorClientDetail>(
        "GET",
        `/api/vendor/clients/${f.bookingId}`,
        undefined,
        { token: f.vendorToken },
      );
      // The number the couple agreed to is the contract value, and the date is
      // off the vendor's free calendar.
      expect(after.data.contract_value).toBe(LINES_TOTAL);
      expect(after.data.status).toBe("confirmed");
      // The deposit is part of the offer TEXT and nothing else: accepting must
      // not invent money the vendor has not been paid.
      expect(after.data.deposit_paid).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "declining carries the reason back and leaves the conversation open",
    async () => {
      const f = await bootstrapThread("q-decline");
      const created = await createQuote(f);
      await sendQuote(f, created.quote.id);

      const decline = await req<{ quote: BookingQuote }>(
        "POST",
        `/api/quotes/${created.quote.id}/decline`,
        { reason: "Over our budget" },
        { token: f.coupleToken },
      );
      expect(decline.status).toBe(200);
      expect(decline.data.quote.status).toBe("declined");
      expect(decline.data.quote.decline_reason).toBe("Over our budget");

      const detail = await req<VendorClientDetail>(
        "GET",
        `/api/vendor/clients/${f.bookingId}`,
        undefined,
        { token: f.vendorToken },
      );
      // A declined PRICE is not a declined conversation: the inquiry stays
      // where it was, and no contract value is written.
      expect(detail.data.status).not.toBe("declined");
      expect(detail.data.contract_value).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a sent quote is frozen: no edit, no delete, and answering it twice fails",
    async () => {
      const f = await bootstrapThread("q-frozen");
      const created = await createQuote(f);

      // A draft edits fine.
      const draftPatch = await req<{ quote: BookingQuote }>(
        "PATCH",
        `/api/vendor/quotes/${created.quote.id}`,
        { title: "Revised title" },
        { token: f.vendorToken },
      );
      expect(draftPatch.status).toBe(200);
      expect(draftPatch.data.quote.title).toBe("Revised title");

      await sendQuote(f, created.quote.id);

      const patch = await req<ErrBody>(
        "PATCH",
        `/api/vendor/quotes/${created.quote.id}`,
        { title: "Sneaky change" },
        { token: f.vendorToken },
      );
      expect(patch.status).toBe(409);
      expect(patch.data.detail?.code).toBe("quote_not_draft");

      const del = await req<ErrBody>(
        "DELETE",
        `/api/vendor/quotes/${created.quote.id}`,
        undefined,
        { token: f.vendorToken },
      );
      expect(del.status).toBe(409);
      expect(del.data.detail?.code).toBe("quote_not_draft");

      const accept = await req(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(accept.status).toBe(200);

      const twice = await req<ErrBody>(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(twice.status).toBe(409);
      expect(twice.data.detail?.code).toBe("quote_not_answerable");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "sending a revision retires the price the couple was looking at",
    async () => {
      const f = await bootstrapThread("q-revision");
      const first = await createQuote(f, { title: "First offer" });
      await sendQuote(f, first.quote.id);

      const second = await createQuote(f, {
        title: "Second offer",
        lines: [{ label: "All in", unit_amount: 1000, qty: 1 }],
      });
      await sendQuote(f, second.quote.id);

      const visible = await coupleQuotes(f);
      const byId = new Map(visible.data.quotes.map((q) => [q.id, q]));
      expect(byId.get(first.quote.id)!.status).toBe("withdrawn");
      expect(byId.get(second.quote.id)!.status).toBe("viewed");

      // And the retired one can no longer be accepted, which is the whole point.
      const stale = await req<ErrBody>(
        "POST",
        `/api/quotes/${first.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(stale.status).toBe(409);
      expect(stale.data.detail?.code).toBe("quote_not_answerable");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "expiry is derived from valid_until, with no sweep in between",
    async () => {
      const f = await bootstrapThread("q-expiry");
      const created = await createQuote(f, { valid_until: isoDaysFromToday(-1) });
      await sendQuote(f, created.quote.id);

      const seen = await coupleQuotes(f);
      // Nothing ran. The date simply passed, and the read says so.
      expect(seen.data.quotes[0]!.status).toBe("expired");

      const accept = await req<ErrBody>(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(accept.status).toBe(409);
      expect(accept.data.detail?.code).toBe("quote_not_answerable");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "writing a quote is PRO, but reading one and answering one never are",
    async () => {
      enableBillingEnforcement();
      const f = await bootstrapThread("q-plan");

      // Sent while entitled.
      const created = await createQuote(f);
      await sendQuote(f, created.quote.id);

      downgradeToFree(f.accountId);

      const blocked = await createQuote(f, { title: "Second" });
      expect(blocked.status).toBe(403);
      expect(blocked.code).toBe("vendor_pro_required");

      // A lapsed vendor must still be able to READ the offer they made.
      const read = await vendorQuotes(f);
      expect(read.status).toBe(200);
      expect(read.data.quotes).toHaveLength(1);

      // And the couple's answer must land whatever the vendor's plan is: they
      // were never the ones with a subscription.
      const accept = await req<{ quote: BookingQuote }>(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(accept.status).toBe(200);
      expect(accept.data.quote.status).toBe("accepted");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a quote belongs to two parties and nobody else",
    async () => {
      const f = await bootstrapThread("q-tenant");
      const created = await createQuote(f);
      await sendQuote(f, created.quote.id);

      const stranger = await bootstrapCouple("stranger-q@weddly.test");
      const peek = await req<ErrBody>(
        "GET",
        `/api/messages/threads/${f.bookingId}/quotes`,
        undefined,
        { token: stranger.token },
      );
      expect(peek.status).toBe(404);

      const grab = await req<ErrBody>(
        "POST",
        `/api/quotes/${created.quote.id}/accept`,
        {},
        { token: stranger.token },
      );
      expect(grab.status).toBe(404);

      const otherVendor = await bootstrapVendor("q-tenant-other");
      upgradeToPro(otherVendor.accountId);
      const reach = await req<ErrBody>(
        "POST",
        `/api/vendor/quotes/${created.quote.id}/withdraw`,
        {},
        { token: otherVendor.vendorToken },
      );
      // 404, never 403: a foreign id must not be confirmable by probing.
      expect(reach.status).toBe(404);
      expect(reach.data.detail?.code).toBe("quote_not_found");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an offer with no priced row, or an impossible one, is refused",
    async () => {
      const f = await bootstrapThread("q-validation");

      const noLines = await createQuote(f, { lines: [] });
      expect(noLines.status).toBe(400);
      expect(noLines.code).toBe("bad_lines");

      const noTitle = await createQuote(f, { title: "   " });
      expect(noTitle.status).toBe(400);
      expect(noTitle.code).toBe("bad_title");

      const badQty = await createQuote(f, {
        lines: [{ label: "Nothing", unit_amount: 100, qty: 0 }],
      });
      expect(badQty.status).toBe(400);
      expect(badQty.code).toBe("bad_lines");

      const badAmount = await createQuote(f, {
        lines: [{ label: "Negative", unit_amount: -5, qty: 1 }],
      });
      expect(badAmount.status).toBe(400);
      expect(badAmount.code).toBe("bad_lines");

      const tooMany = await createQuote(f, {
        lines: Array.from({ length: 26 }, (_, i) => ({
          label: `Row ${i}`,
          unit_amount: 10,
          qty: 1,
        })),
      });
      expect(tooMany.status).toBe(400);
      expect(tooMany.code).toBe("too_many_lines");

      const badDate = await createQuote(f, { valid_until: "2026-02-30" });
      expect(badDate.status).toBe(400);
      expect(badDate.code).toBe("bad_valid_until");
    },
    TEST_TIMEOUT_MS,
  );
});
