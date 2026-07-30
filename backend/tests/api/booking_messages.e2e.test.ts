// Couple ↔ vendor message threads (booking_messages / attachments / templates).
//
// A THREAD is anchored on a supplier_bookings row, so both sides address it by
// the same `booking_id`: the vendor through /api/vendor/clients/:id/messages,
// the couple through /api/messages/threads/:bookingId. What this suite pins
// down is the part that is invisible until it breaks:
//
//   - the delivery ladder is DERIVED from (created_at, delivered_at, seen_at),
//     stamped on the RECIPIENT's read and first-wins, so re-opening an old
//     thread can never rewrite when a message arrived;
//   - a reader's own fetch never marks their own messages delivered or seen —
//     a vendor loading their reply must not read it on the couple's behalf;
//   - the vendor's SEND (and templates, and attachments) is PRO, while READING
//     a lead they were given stays FREE;
//   - attachments are sniffed, not trusted, and served only through the
//     authenticated download route.
//
// The inbound direction is seeded through /api/outreach/campaigns rather than
// the admin booking route, because `deliverInquiryFromOutreach` is what writes
// the couple's inquiry as a real message row (the admin POST
// /api/suppliers/:id/bookings only writes the legacy notes blob, which is split
// into rows by a BOOT backfill — long before any row this file creates exists).
//
// Pairs with backend/src/routes/booking_messages.ts, domain/booking_messages.ts
// and shared/booking_messages.ts. Harness preamble copied from
// vendor_clients.e2e.test.ts, deliberately: these suites are self-contained.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import {
  MESSAGE_BODY_MAX_LEN,
  type BookingMessage,
  type BookingThread,
  type CoupleVendorThreadPreview,
  type VendorMessageTemplate,
} from "@shared/booking_messages";
import type { VendorClientView, VendorStats } from "@shared/vendor_clients";

interface ClaimRow {
  token: string;
}

interface ErrBody {
  detail?: { code?: string };
}

const TEST_TIMEOUT_MS = 60_000;

// ── Bootstrap (copied from vendor_clients.e2e.test.ts) ────────────────────

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

/** Grant the vendor an entitled (founding) subscription → PRO tier. A freshly
 *  claimed vendor has no sub row and is FREE; the payment surfaces need PRO. */
function upgradeToPro(accountId: number): void {
  initVendorBilling(accountId, "EUR");
}

/** Drop a claimed vendor out of entitlement the way a lapse does — the FREE
 *  tier. Their already-delivered leads stay readable, which is the point. */
function downgradeToFree(accountId: number): void {
  db.prepare(
    `UPDATE vendor_subscriptions
        SET subscription_status = 'canceled', founding_until = NULL,
            trial_ends_at = NULL, current_period_end = NULL
      WHERE vendor_account_id = ?`,
  ).run(accountId);
}

// ── Thread seeding + raw-fetch helpers ────────────────────────────────────

/** The couple-facing "send an inquiry" path. This is what writes the couple's
 *  first message ROW on the thread (deliverInquiryFromOutreach), which is what
 *  makes the vendor's thread non-empty without leaning on the boot backfill. */
async function sendOutreach(
  token: string,
  listingId: string,
  subject: string,
  body: string,
): Promise<number> {
  const r = await req(
    "POST",
    "/api/outreach/campaigns",
    { subject, body_template: body, supplier_ids: [listingId] },
    { token },
  );
  return r.status;
}

/** The booking id of the vendor's single client — the thread id on both sides. */
async function soleBookingId(vendorToken: string): Promise<number> {
  const list = await req<{ clients: VendorClientView[] }>("GET", "/api/vendor/clients", undefined, {
    token: vendorToken,
  });
  expect(list.status).toBe(200);
  expect(list.data.clients).toHaveLength(1);
  return list.data.clients[0]!.id;
}

/** A claimed vendor + an onboarded couple with one live thread between them. */
async function bootstrapThread(slug: string): Promise<{
  vendorToken: string;
  listingId: string;
  accountId: number;
  coupleToken: string;
  coupleId: number;
  bookingId: number;
}> {
  const vendor = await bootstrapVendor(slug);
  upgradeToPro(vendor.accountId);
  const couple = await bootstrapCouple(`couple-${slug}@weddly.test`);
  expect(await sendOutreach(couple.token, vendor.listingId, "Sept 12", "Are you free?")).toBe(201);
  return {
    ...vendor,
    coupleToken: couple.token,
    coupleId: couple.coupleId,
    bookingId: await soleBookingId(vendor.vendorToken),
  };
}

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** `req()` only builds multipart for the vendor-waitlist route, so the
 *  attachment upload goes through plain fetch. The body is ALWAYS drained: an
 *  unread body holds its keep-alive connection open and stalls the next
 *  request (the vendor_campaign suite's note). */
async function postMultipart<T = unknown>(
  path: string,
  form: FormData,
  token: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    // No Content-Type: fetch has to set the multipart boundary itself.
    headers: { Authorization: `Bearer ${token}`, "x-test-client-ip": "10.0.77.1" },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

/** Raw GET that keeps the bytes — the download route serves a file, not JSON. */
async function getRaw(
  path: string,
  token?: string,
): Promise<{ status: number; bytes: Uint8Array; contentType: string | null }> {
  const headers: Record<string, string> = { "x-test-client-ip": "10.0.77.2" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, bytes, contentType: res.headers.get("content-type") };
}

/** A minimal but genuinely %PDF-headed file — the route sniffs magic bytes and
 *  never trusts the declared Content-Type. */
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

function pdfFile(name = "quote.pdf"): File {
  return new File([PDF_BYTES], name, { type: "application/pdf" });
}

function messageById(thread: BookingThread, id: number): BookingMessage {
  const found = thread.messages.find((m) => m.id === id);
  expect(found).toBeTruthy();
  return found as BookingMessage;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("booking messages — couple ↔ vendor thread", () => {
  test(
    "a couple's inquiry lands in the vendor's thread as a couple-sent message",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("inbound");

      const r = await req<{ thread: BookingThread; unread: number }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      expect(r.status).toBe(200);
      expect(r.data.thread.booking_id).toBe(bookingId);
      // The thread renders from the READER's side: the vendor sees the couple.
      expect(r.data.thread.counterparty_name).toBe("Mia & Lucas");
      expect(r.data.thread.event_date).toBe("2026-09-12");
      expect(r.data.thread.messages).toHaveLength(1);
      const msg = r.data.thread.messages[0]!;
      expect(msg.sender_kind).toBe("couple");
      // Subject AND body — the whole inquiry, not just a name and a date.
      expect(msg.body).toContain("Sept 12");
      expect(msg.body).toContain("Are you free?");
      expect(msg.attachments).toEqual([]);
      // Unseen until the vendor explicitly marks the thread seen.
      expect(r.data.unread).toBe(1);

      // The couple's own inbox lists the same conversation, named from THEIR
      // side (the listing, not the couple).
      const threads = await req<{ threads: CoupleVendorThreadPreview[] }>(
        "GET",
        "/api/messages/threads",
        undefined,
        { token: coupleToken },
      );
      expect(threads.status).toBe(200);
      expect(threads.data.threads).toHaveLength(1);
      const preview = threads.data.threads[0]!;
      expect(preview.booking_id).toBe(bookingId);
      expect(preview.vendor_name).toBe("inbound Studio");
      expect(preview.last_sender_kind).toBe("couple");
      expect(preview.last_body).toContain("Are you free?");
      // Their own message is not something they can have unread.
      expect(preview.unread_count).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a PRO vendor's reply reaches the couple's thread, with sender_kind right on both sides",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("reply");

      const sent = await req<{ message: BookingMessage }>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "Free that day. Package from 450k." },
        { token: vendorToken },
      );
      expect(sent.status).toBe(201);
      expect(sent.data.message.sender_kind).toBe("vendor");
      expect(sent.data.message.booking_id).toBe(bookingId);
      expect(sent.data.message.body).toBe("Free that day. Package from 450k.");

      const coupleView = await req<{ thread: BookingThread; unread: number }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      expect(coupleView.status).toBe(200);
      expect(coupleView.data.thread.counterparty_name).toBe("reply Studio");
      expect(coupleView.data.thread.messages).toHaveLength(2);
      expect(coupleView.data.thread.messages.map((m) => m.sender_kind)).toEqual([
        "couple",
        "vendor",
      ]);
      expect(coupleView.data.thread.messages[1]!.body).toBe("Free that day. Package from 450k.");
      expect(coupleView.data.unread).toBe(1);

      // The couple answers; the vendor reads it back on their own side.
      const coupleReply = await req<{ message: BookingMessage }>(
        "POST",
        `/api/messages/threads/${bookingId}`,
        { body: "Sounds good, can you hold it?" },
        { token: coupleToken },
      );
      expect(coupleReply.status).toBe(201);
      expect(coupleReply.data.message.sender_kind).toBe("couple");

      const vendorView = await req<{ thread: BookingThread }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      expect(vendorView.data.thread.messages).toHaveLength(3);
      expect(vendorView.data.thread.messages.map((m) => m.sender_kind)).toEqual([
        "couple",
        "vendor",
        "couple",
      ]);

      // The couple's inbox preview follows the newest message.
      const threads = await req<{ threads: CoupleVendorThreadPreview[] }>(
        "GET",
        "/api/messages/threads",
        undefined,
        { token: coupleToken },
      );
      expect(threads.data.threads[0]!.last_body).toBe("Sounds good, can you hold it?");
      expect(threads.data.threads[0]!.last_sender_kind).toBe("couple");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "status ladder: sent → delivered on the recipient's read → seen, and the stamps are first-wins",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("ladder");

      const sent = await req<{ message: BookingMessage }>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "Quote attached tomorrow." },
        { token: vendorToken },
      );
      expect(sent.status).toBe(201);
      const messageId = sent.data.message.id;
      // Fresh insert: one tick.
      expect(sent.data.message.status).toBe("sent");
      expect(sent.data.message.delivered_at).toBeNull();
      expect(sent.data.message.seen_at).toBeNull();

      // The SENDER re-reading their own thread changes nothing about it.
      const senderRead = await req<{ thread: BookingThread }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      expect(messageById(senderRead.data.thread, messageId).status).toBe("sent");

      // The RECIPIENT fetching the thread is what stamps delivery.
      const firstCoupleRead = await req<{ thread: BookingThread }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      const delivered = messageById(firstCoupleRead.data.thread, messageId);
      expect(delivered.status).toBe("delivered");
      expect(delivered.delivered_at).not.toBeNull();
      expect(delivered.seen_at).toBeNull();
      const deliveredAt = delivered.delivered_at as number;

      // First-wins: re-reading a thread cannot rewrite when it arrived. The
      // sleep is what makes this a real assertion — now() has moved on.
      await Bun.sleep(15);
      const secondCoupleRead = await req<{ thread: BookingThread }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      const reread = messageById(secondCoupleRead.data.thread, messageId);
      expect(reread.delivered_at).toBe(deliveredAt);
      expect(reread.status).toBe("delivered");

      // Opening the panel is the explicit seen call.
      const seen = await req<{ seen_at: number }>(
        "POST",
        `/api/messages/threads/${bookingId}/seen`,
        {},
        { token: coupleToken },
      );
      expect(seen.status).toBe(200);
      expect(typeof seen.data.seen_at).toBe("number");

      const afterSeen = await req<{ thread: BookingThread }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      const seenMsg = messageById(afterSeen.data.thread, messageId);
      expect(seenMsg.status).toBe("seen");
      expect(seenMsg.seen_at).not.toBeNull();
      // Being seen must not rewrite the delivery stamp either.
      expect(seenMsg.delivered_at).toBe(deliveredAt);
      const seenAt = seenMsg.seen_at as number;

      await Bun.sleep(15);
      const seenAgain = await req<{ seen_at: number }>(
        "POST",
        `/api/messages/threads/${bookingId}/seen`,
        {},
        { token: coupleToken },
      );
      expect(seenAgain.status).toBe(200);
      const afterSecondSeen = await req<{ thread: BookingThread }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      const stable = messageById(afterSecondSeen.data.thread, messageId);
      expect(stable.seen_at).toBe(seenAt);
      expect(stable.delivered_at).toBe(deliveredAt);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a reader's own messages are never delivered or seen by their own fetch",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("self-read");

      // The couple's inquiry is already on the thread. They open it, twice, and
      // mark it seen — none of which is allowed to read it on the vendor's
      // behalf, or the vendor's unread badge would clear itself.
      const own = await req<{ thread: BookingThread; unread: number }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      expect(own.status).toBe(200);
      expect(own.data.unread).toBe(0);
      const mine = own.data.thread.messages[0]!;
      expect(mine.sender_kind).toBe("couple");
      expect(mine.status).toBe("sent");
      expect(mine.delivered_at).toBeNull();
      expect(mine.seen_at).toBeNull();

      await req("POST", `/api/messages/threads/${bookingId}/seen`, {}, { token: coupleToken });
      const afterOwnSeen = await req<{ thread: BookingThread }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      const stillUnread = afterOwnSeen.data.thread.messages[0]!;
      expect(stillUnread.status).toBe("sent");
      expect(stillUnread.delivered_at).toBeNull();
      expect(stillUnread.seen_at).toBeNull();

      // And the vendor still has it waiting for them.
      const vendorSide = await req<{ thread: BookingThread; unread: number }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      expect(vendorSide.data.unread).toBe(1);

      // Mirror image: the vendor's own reply is not self-delivered either.
      const reply = await req<{ message: BookingMessage }>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "On it." },
        { token: vendorToken },
      );
      await req(
        "POST",
        `/api/vendor/clients/${bookingId}/messages/seen`,
        {},
        {
          token: vendorToken,
        },
      );
      const vendorReread = await req<{ thread: BookingThread }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendorToken },
      );
      const ownReply = messageById(vendorReread.data.thread, reply.data.message.id);
      expect(ownReply.status).toBe("sent");
      expect(ownReply.delivered_at).toBeNull();
      expect(ownReply.seen_at).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "unread counters: client-list badge + stats total reflect unseen couple messages",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("unread");

      const list = await req<{ clients: VendorClientView[] }>(
        "GET",
        "/api/vendor/clients",
        undefined,
        { token: vendorToken },
      );
      expect(list.data.clients[0]!.unread_count).toBe(1);

      const stats = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
        token: vendorToken,
      });
      expect(stats.status).toBe(200);
      expect(stats.data.unread_messages).toBe(1);

      // A second couple message adds to both.
      const second = await req(
        "POST",
        `/api/messages/threads/${bookingId}`,
        { body: "One more thing" },
        { token: coupleToken },
      );
      expect(second.status).toBe(201);
      const list2 = await req<{ clients: VendorClientView[] }>(
        "GET",
        "/api/vendor/clients",
        undefined,
        { token: vendorToken },
      );
      expect(list2.data.clients[0]!.unread_count).toBe(2);
      const stats2 = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
        token: vendorToken,
      });
      expect(stats2.data.unread_messages).toBe(2);

      // Merely FETCHING the thread stamps delivery, not seen — the badge stays.
      await req("GET", `/api/vendor/clients/${bookingId}/messages`, undefined, {
        token: vendorToken,
      });
      const list3 = await req<{ clients: VendorClientView[] }>(
        "GET",
        "/api/vendor/clients",
        undefined,
        { token: vendorToken },
      );
      expect(list3.data.clients[0]!.unread_count).toBe(2);

      // The explicit seen call is what clears it.
      const seen = await req(
        "POST",
        `/api/vendor/clients/${bookingId}/messages/seen`,
        {},
        { token: vendorToken },
      );
      expect(seen.status).toBe(200);
      const list4 = await req<{ clients: VendorClientView[] }>(
        "GET",
        "/api/vendor/clients",
        undefined,
        { token: vendorToken },
      );
      expect(list4.data.clients[0]!.unread_count).toBe(0);
      const stats3 = await req<VendorStats>("GET", "/api/vendor/stats", undefined, {
        token: vendorToken,
      });
      expect(stats3.data.unread_messages).toBe(0);

      // The couple's own badge is the mirror: vendor messages they haven't seen.
      await req(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "Answering both" },
        { token: vendorToken },
      );
      const coupleThreads = await req<{ threads: CoupleVendorThreadPreview[] }>(
        "GET",
        "/api/messages/threads",
        undefined,
        { token: coupleToken },
      );
      expect(coupleThreads.data.threads[0]!.unread_count).toBe(1);
      await req("POST", `/api/messages/threads/${bookingId}/seen`, {}, { token: coupleToken });
      const coupleThreads2 = await req<{ threads: CoupleVendorThreadPreview[] }>(
        "GET",
        "/api/messages/threads",
        undefined,
        { token: coupleToken },
      );
      expect(coupleThreads2.data.threads[0]!.unread_count).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "FREE vendor: reading a lead stays free, sending and templates are PRO",
    async () => {
      wipeAll();
      const vendor = await bootstrapVendor("free-msg");
      // The inquiry is delivered whatever the plan (deliverInquiryFromOutreach
      // does not consult entitlement), so drop to FREE first and prove the
      // vendor can still READ what landed.
      downgradeToFree(vendor.accountId);
      const couple = await bootstrapCouple("couple-free-msg@weddly.test");
      expect(
        await sendOutreach(couple.token, vendor.listingId, "Hello", "Are you available?"),
      ).toBe(201);
      const bookingId = await soleBookingId(vendor.vendorToken);

      const read = await req<{ thread: BookingThread; unread: number }>(
        "GET",
        `/api/vendor/clients/${bookingId}/messages`,
        undefined,
        { token: vendor.vendorToken },
      );
      expect(read.status).toBe(200);
      expect(read.data.thread.messages).toHaveLength(1);
      expect(read.data.unread).toBe(1);

      // Marking it seen is free too — it is a read, not a reply.
      const seen = await req(
        "POST",
        `/api/vendor/clients/${bookingId}/messages/seen`,
        {},
        { token: vendor.vendorToken },
      );
      expect(seen.status).toBe(200);

      // Sending is the paywall.
      const send = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "Yes, we are free" },
        { token: vendor.vendorToken },
      );
      expect(send.status).toBe(403);
      expect(send.data.detail?.code).toBe("vendor_pro_required");

      // Templates are a PRO surface end to end — a vendor who cannot send has
      // nothing to insert one into.
      const listTemplates = await req<ErrBody>("GET", "/api/vendor/message-templates", undefined, {
        token: vendor.vendorToken,
      });
      expect(listTemplates.status).toBe(403);
      expect(listTemplates.data.detail?.code).toBe("vendor_pro_required");

      const createTemplate = await req<ErrBody>(
        "POST",
        "/api/vendor/message-templates",
        { title: "Free date", body: "The date is free." },
        { token: vendor.vendorToken },
      );
      expect(createTemplate.status).toBe(403);
      expect(createTemplate.data.detail?.code).toBe("vendor_pro_required");

      // The couple's side of a FREE vendor's thread is untouched by any of it.
      const coupleRead = await req<{ thread: BookingThread }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: couple.token },
      );
      expect(coupleRead.status).toBe(200);
      expect(coupleRead.data.thread.messages).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "templates: create → list → patch → delete, and a foreign id is a 404",
    async () => {
      wipeAll();
      const a = await bootstrapVendor("tpl-a");
      const b = await bootstrapVendor("tpl-b");
      upgradeToPro(a.accountId);
      upgradeToPro(b.accountId);

      const created = await req<{ template: VendorMessageTemplate }>(
        "POST",
        "/api/vendor/message-templates",
        { title: "Date is free", body: "Hi {client_name}, {event_date} is still open." },
        { token: a.vendorToken },
      );
      expect(created.status).toBe(201);
      const templateId = created.data.template.id;
      expect(created.data.template.title).toBe("Date is free");
      expect(created.data.template.body).toContain("{client_name}");

      const list = await req<{ templates: VendorMessageTemplate[] }>(
        "GET",
        "/api/vendor/message-templates",
        undefined,
        { token: a.vendorToken },
      );
      expect(list.status).toBe(200);
      expect(list.data.templates).toHaveLength(1);
      expect(list.data.templates[0]!.id).toBe(templateId);

      const patched = await req<{ template: VendorMessageTemplate }>(
        "PATCH",
        `/api/vendor/message-templates/${templateId}`,
        { title: "Date is free (v2)", body: "Hi {client_name}, still open." },
        { token: a.vendorToken },
      );
      expect(patched.status).toBe(200);
      expect(patched.data.template.title).toBe("Date is free (v2)");
      expect(patched.data.template.body).toBe("Hi {client_name}, still open.");
      expect(patched.data.template.updated_at).toBeGreaterThanOrEqual(
        created.data.template.created_at,
      );

      // Validation: both fields are required.
      const blank = await req<ErrBody>(
        "POST",
        "/api/vendor/message-templates",
        { title: "   ", body: "something" },
        { token: a.vendorToken },
      );
      expect(blank.status).toBe(400);
      expect(blank.data.detail?.code).toBe("empty_title");

      // Vendor B is PRO, so this is genuinely the ownership check and not the
      // paywall: a foreign id 404s rather than 403s, so templates can't be
      // enumerated.
      const bList = await req<{ templates: VendorMessageTemplate[] }>(
        "GET",
        "/api/vendor/message-templates",
        undefined,
        { token: b.vendorToken },
      );
      expect(bList.data.templates).toHaveLength(0);

      const bPatch = await req<ErrBody>(
        "PATCH",
        `/api/vendor/message-templates/${templateId}`,
        { title: "Mine now", body: "Taken" },
        { token: b.vendorToken },
      );
      expect(bPatch.status).toBe(404);
      expect(bPatch.data.detail?.code).toBe("template_not_found");

      const bDelete = await req<ErrBody>(
        "DELETE",
        `/api/vendor/message-templates/${templateId}`,
        undefined,
        { token: b.vendorToken },
      );
      expect(bDelete.status).toBe(404);
      expect(bDelete.data.detail?.code).toBe("template_not_found");

      const del = await req<{ ok: boolean }>(
        "DELETE",
        `/api/vendor/message-templates/${templateId}`,
        undefined,
        { token: a.vendorToken },
      );
      expect(del.status).toBe(200);
      expect(del.data.ok).toBe(true);

      const after = await req<{ templates: VendorMessageTemplate[] }>(
        "GET",
        "/api/vendor/message-templates",
        undefined,
        { token: a.vendorToken },
      );
      expect(after.data.templates).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "cross-tenant: another vendor and another couple get 404 on a thread that isn't theirs",
    async () => {
      wipeAll();
      const a = await bootstrapThread("iso-a");
      const b = await bootstrapVendor("iso-b");
      upgradeToPro(b.accountId);
      const outsider = await bootstrapCouple("couple-iso-b@weddly.test");

      // Vendor B is PRO, so a 404 here is the ownership check, not the paywall.
      const bRead = await req<ErrBody>(
        "GET",
        `/api/vendor/clients/${a.bookingId}/messages`,
        undefined,
        { token: b.vendorToken },
      );
      expect(bRead.status).toBe(404);
      expect(bRead.data.detail?.code).toBe("client_not_found");

      const bSend = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${a.bookingId}/messages`,
        { body: "Hello, wrong vendor here" },
        { token: b.vendorToken },
      );
      expect(bSend.status).toBe(404);
      expect(bSend.data.detail?.code).toBe("client_not_found");

      const bSeen = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${a.bookingId}/messages/seen`,
        {},
        { token: b.vendorToken },
      );
      expect(bSeen.status).toBe(404);

      // Couple B: same thread id, a 404 rather than a 403, for the same reason.
      const outsiderRead = await req<ErrBody>(
        "GET",
        `/api/messages/threads/${a.bookingId}`,
        undefined,
        { token: outsider.token },
      );
      expect(outsiderRead.status).toBe(404);
      expect(outsiderRead.data.detail?.code).toBe("thread_not_found");

      const outsiderSend = await req<ErrBody>(
        "POST",
        `/api/messages/threads/${a.bookingId}`,
        { body: "Wrong couple here" },
        { token: outsider.token },
      );
      expect(outsiderSend.status).toBe(404);

      const outsiderList = await req<{ threads: CoupleVendorThreadPreview[] }>(
        "GET",
        "/api/messages/threads",
        undefined,
        { token: outsider.token },
      );
      expect(outsiderList.status).toBe(200);
      expect(outsiderList.data.threads).toHaveLength(0);

      // A vendor has no couple workspace, so the couple routes refuse them.
      const vendorOnCoupleRoute = await req<ErrBody>("GET", "/api/messages/threads", undefined, {
        token: b.vendorToken,
      });
      expect(vendorOnCoupleRoute.status).toBe(403);
      expect(vendorOnCoupleRoute.data.detail?.code).toBe("no_couple");

      // And anonymous gets nothing anywhere.
      expect((await req("GET", `/api/messages/threads/${a.bookingId}`)).status).toBe(401);
      expect((await req("GET", `/api/vendor/clients/${a.bookingId}/messages`)).status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "attachments: a sniffed PDF rides along, garbage is 415, and the bytes are behind auth",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, coupleId, bookingId } = await bootstrapThread("attach");
      const outsider = await bootstrapCouple("couple-attach-outsider@weddly.test");

      const form = new FormData();
      form.append("body", "Quote attached.");
      form.append("file", pdfFile());
      const sent = await postMultipart<{ message: BookingMessage }>(
        `/api/vendor/clients/${bookingId}/messages`,
        form,
        vendorToken,
      );
      expect(sent.status).toBe(201);
      expect(sent.data.message.body).toBe("Quote attached.");
      expect(sent.data.message.attachments).toHaveLength(1);
      const attachment = sent.data.message.attachments[0]!;
      expect(attachment.file_name).toBe("quote.pdf");
      expect(attachment.mime).toBe("application/pdf");
      expect(attachment.size_bytes).toBe(PDF_BYTES.byteLength);
      // Never a public /uploads URL — this is a quote.
      expect(attachment.download_url).toBe(
        `/api/booking-messages/attachments/${attachment.id}/download`,
      );

      // Both parties can read the bytes.
      const vendorDownload = await getRaw(attachment.download_url, vendorToken);
      expect(vendorDownload.status).toBe(200);
      expect(vendorDownload.contentType).toBe("application/pdf");
      expect(Array.from(vendorDownload.bytes)).toEqual(Array.from(PDF_BYTES));

      const coupleDownload = await getRaw(attachment.download_url, coupleToken);
      expect(coupleDownload.status).toBe(200);
      expect(Array.from(coupleDownload.bytes)).toEqual(Array.from(PDF_BYTES));

      // Nobody else can, and anonymous least of all.
      expect((await getRaw(attachment.download_url, outsider.token)).status).toBe(404);
      expect((await getRaw(attachment.download_url)).status).toBe(401);

      // The stored object is keyed under the COUPLE's prefix (so a GDPR purge
      // takes it) and the public /uploads route refuses that prefix outright.
      const stored = db
        .prepare("SELECT file_path FROM booking_message_attachments WHERE id = ?")
        .get(attachment.id) as { file_path: string };
      expect(stored.file_path).toBe(
        `/uploads/couples/${coupleId}/booking-messages/${attachment.id}.pdf`,
      );
      expect((await getRaw(stored.file_path)).status).not.toBe(200);

      // A file with no words is a legitimate message.
      const fileOnly = new FormData();
      fileOnly.append("file", pdfFile("contract.pdf"));
      const bare = await postMultipart<{ message: BookingMessage }>(
        `/api/vendor/clients/${bookingId}/messages`,
        fileOnly,
        vendorToken,
      );
      expect(bare.status).toBe(201);
      expect(bare.data.message.body).toBe("");
      expect(bare.data.message.attachments).toHaveLength(1);

      // The declared Content-Type is attacker-controlled, so the magic bytes
      // decide: this one claims to be a PDF and is not.
      const liar = new FormData();
      liar.append("body", "Trust me");
      liar.append(
        "file",
        new File([new TextEncoder().encode("just text")], "notes.txt", {
          type: "application/pdf",
        }),
      );
      const rejected = await postMultipart<ErrBody>(
        `/api/vendor/clients/${bookingId}/messages`,
        liar,
        vendorToken,
      );
      expect(rejected.status).toBe(415);
      expect(rejected.data.detail?.code).toBe("unsupported_type");
      // NOTE: the rejected send still leaves its message row on the thread —
      // handleVendorSendMessage inserts the message BEFORE storing the files,
      // and nothing rolls it back. Deliberately not asserted here: that is a
      // bug to fix, not a contract to pin.

      // Four files is one too many.
      const tooMany = new FormData();
      tooMany.append("body", "Everything");
      for (let i = 0; i < 4; i++) tooMany.append("file", pdfFile(`page-${i}.pdf`));
      const capped = await postMultipart<ErrBody>(
        `/api/vendor/clients/${bookingId}/messages`,
        tooMany,
        vendorToken,
      );
      expect(capped.status).toBe(400);
      expect(capped.data.detail?.code).toBe("too_many_attachments");

      // The couple reads the attachment off their own side of the thread.
      const coupleThread = await req<{ thread: BookingThread }>(
        "GET",
        `/api/messages/threads/${bookingId}`,
        undefined,
        { token: coupleToken },
      );
      const withFile = messageById(coupleThread.data.thread, sent.data.message.id);
      expect(withFile.attachments).toHaveLength(1);
      expect(withFile.attachments[0]!.file_name).toBe("quote.pdf");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "validation: an empty body is 400, an over-long one is 400, the boundary is fine",
    async () => {
      wipeAll();
      const { vendorToken, coupleToken, bookingId } = await bootstrapThread("validate");

      const empty = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "   " },
        { token: vendorToken },
      );
      expect(empty.status).toBe(400);
      expect(empty.data.detail?.code).toBe("empty_body");

      const missing = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        {},
        { token: vendorToken },
      );
      expect(missing.status).toBe(400);
      expect(missing.data.detail?.code).toBe("bad_body");

      const tooLong = await req<ErrBody>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "a".repeat(MESSAGE_BODY_MAX_LEN + 1) },
        { token: vendorToken },
      );
      expect(tooLong.status).toBe(400);
      expect(tooLong.data.detail?.code).toBe("body_too_long");

      // Exactly at the ceiling is a message, not an error.
      const atLimit = await req<{ message: BookingMessage }>(
        "POST",
        `/api/vendor/clients/${bookingId}/messages`,
        { body: "a".repeat(MESSAGE_BODY_MAX_LEN) },
        { token: vendorToken },
      );
      expect(atLimit.status).toBe(201);
      expect(atLimit.data.message.body.length).toBe(MESSAGE_BODY_MAX_LEN);

      // The couple's side guards the same way.
      const coupleEmpty = await req<ErrBody>(
        "POST",
        `/api/messages/threads/${bookingId}`,
        { body: "" },
        { token: coupleToken },
      );
      expect(coupleEmpty.status).toBe(400);
      expect(coupleEmpty.data.detail?.code).toBe("empty_body");

      const coupleTooLong = await req<ErrBody>(
        "POST",
        `/api/messages/threads/${bookingId}`,
        { body: "b".repeat(MESSAGE_BODY_MAX_LEN + 1) },
        { token: coupleToken },
      );
      expect(coupleTooLong.status).toBe(400);
      expect(coupleTooLong.data.detail?.code).toBe("body_too_long");

      // A non-numeric thread id is rejected before any lookup.
      const badId = await req("GET", "/api/vendor/clients/not-a-number/messages", undefined, {
        token: vendorToken,
      });
      expect(badId.status).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});
