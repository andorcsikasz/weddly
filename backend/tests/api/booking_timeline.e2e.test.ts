// The unified booking timeline end to end: one chronological log per inquiry,
// projected from rows that already existed, read from both ends.
//
// What this suite guards is the set of invariants that have no column behind
// them, because the whole feature is a DERIVATION:
//   * events merge in stamp order ACROSS sources. A list that merely
//     concatenated the tables would pass every "is it there" assertion and fail
//     the only question the timeline exists to answer.
//   * the audience is declared per event KIND in shared/booking_timeline.ts and
//     applied server-side, so a couple's payload never carries a vendor-private
//     fact for the client to hide. Asserted against VENDOR_PRIVATE_KINDS rather
//     than a hand-written list, so a kind added later is covered the day it
//     lands.
//   * a hold that lapsed shows up as expired with NOTHING having run, the same
//     way the hold's own state does.
//   * a machine-written message is flagged, because a vendor must never be
//     surprised by words attributed to them.
//   * an inquiry with nothing else on it is a one-event timeline, not an empty
//     screen.
//
// The bootstrap ladder is copied from date_holds.e2e.test.ts (which copied it
// from booking_quotes.e2e.test.ts) on purpose: these suites are deliberately
// self-contained, and the claim path is the only seam that produces a real
// vendor account with a real listing behind it.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { insertMessage } from "../../src/domain/booking_messages";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import type { BookingThread } from "@shared/booking_messages";
import type { BookingTimelineEvent, TimelineEventKind } from "@shared/booking_timeline";
import { TIMELINE_AUDIENCE, VENDOR_PRIVATE_KINDS } from "@shared/booking_timeline";
import type { BookingQuote } from "@shared/booking_quotes";
import type { DateHold } from "@shared/date_holds";
import type { SupplierBooking } from "@shared/suppliers";
import type { VendorClientPayment } from "@shared/vendor_clients";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";

interface ClaimRow {
  token: string;
}

interface ErrBody {
  detail?: { code?: string };
}

const TEST_TIMEOUT_MS = 60_000;
const HOUR = 3_600_000;

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
    .get(numericId) as ClaimRow | undefined;
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
    .get(listingId, contactEmail) as ClaimRow | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: `Vendor ${slug}`,
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
    highlighted_terms_accepted: true,
  });
  expect(complete.status).toBe(201);
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  initVendorBilling(acct.id, "EUR");
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An inquiry with a real date on it, through the admin door: the one path
 *  that makes a booking with NO message row behind it, which is exactly the
 *  bare-inquiry case the timeline has to survive. */
async function createInquiry(
  listingId: string,
  coupleId: number,
  eventDate: string,
): Promise<number> {
  const adminToken = await registerAdminAndGetToken();
  const r = await req<SupplierBooking & ErrBody>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes: "Are you free that day?" },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

interface Fixture {
  vendorToken: string;
  listingId: string;
  accountId: number;
  coupleToken: string;
  coupleId: number;
  bookingId: number;
  eventDate: string;
  createdAt: number;
}

async function bootstrapInquiry(slug: string, daysOut = 200): Promise<Fixture> {
  const vendor = await bootstrapVendor(slug);
  const couple = await bootstrapCouple(`couple-${slug}@weddly.test`);
  const eventDate = isoDaysFromToday(daysOut);
  const bookingId = await createInquiry(vendor.listingId, couple.coupleId, eventDate);
  const row = db
    .prepare("SELECT created_at FROM supplier_bookings WHERE id = ?")
    .get(bookingId) as { created_at: number };
  return {
    ...vendor,
    coupleToken: couple.token,
    coupleId: couple.coupleId,
    bookingId,
    eventDate,
    createdAt: row.created_at,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────

async function vendorTimeline(f: Fixture): Promise<BookingTimelineEvent[]> {
  const r = await req<{ thread: BookingThread }>(
    "GET",
    `/api/vendor/clients/${f.bookingId}/messages`,
    undefined,
    { token: f.vendorToken },
  );
  expect(r.status).toBe(200);
  return r.data.thread.events;
}

async function coupleTimeline(f: Fixture): Promise<BookingTimelineEvent[]> {
  const r = await req<{ thread: BookingThread }>(
    "GET",
    `/api/messages/threads/${f.bookingId}`,
    undefined,
    { token: f.coupleToken },
  );
  expect(r.status).toBe(200);
  return r.data.thread.events;
}

function kinds(events: readonly BookingTimelineEvent[]): TimelineEventKind[] {
  return events.map((e) => e.kind);
}

function only(events: readonly BookingTimelineEvent[], kind: TimelineEventKind) {
  const found = events.filter((e) => e.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** Non-decreasing stamps. The one assertion a concatenated list cannot pass. */
function expectChronological(events: readonly BookingTimelineEvent[]): void {
  for (let i = 1; i < events.length; i++) {
    expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
  }
}

// ── Mutations, through the real doors ─────────────────────────────────────

async function sendQuote(f: Fixture, title: string, unit: number, qty: number): Promise<number> {
  const created = await req<{ quote: BookingQuote }>(
    "POST",
    `/api/vendor/clients/${f.bookingId}/quotes`,
    { title, lines: [{ label: "Csomag", unit_amount: unit, qty }] },
    { token: f.vendorToken },
  );
  expect(created.status).toBe(201);
  const sent = await req<{ quote: BookingQuote }>(
    "POST",
    `/api/vendor/quotes/${created.data.quote.id}/send`,
    {},
    { token: f.vendorToken },
  );
  expect(sent.status).toBe(200);
  return created.data.quote.id;
}

async function placeHold(f: Fixture, hours: number): Promise<DateHold> {
  const r = await req<{ hold: DateHold } & ErrBody>(
    "PUT",
    `/api/vendor/clients/${f.bookingId}/hold`,
    { hours },
    { token: f.vendorToken },
  );
  expect(r.status === 200 || r.status === 201).toBe(true);
  return r.data.hold;
}

async function addPayment(f: Fixture, label: string, amount: number): Promise<number> {
  const r = await req<{ payment: VendorClientPayment }>(
    "POST",
    `/api/vendor/clients/${f.bookingId}/payments`,
    { label, amount, due_date: isoDaysFromToday(30) },
    { token: f.vendorToken },
  );
  expect(r.status).toBe(200);
  return r.data.payment.id;
}

/** Push a hold's deadline into the past WITHOUT running anything. The whole
 *  point of a derived state is that only the clock has to move. */
function lapseHold(bookingId: number): void {
  db.prepare("UPDATE booking_date_holds SET hold_until = ? WHERE booking_id = ?").run(
    Date.now() - HOUR,
    bookingId,
  );
}

/** Re-stamp one column so a merge can be asserted against known times rather
 *  than against however fast the machine happened to run. */
function restamp(sql: string, values: (number | string)[]): void {
  db.prepare(sql).run(...values);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("booking timeline: one log per inquiry", () => {
  test(
    "an inquiry with nothing else on it is a one-event timeline",
    async () => {
      const f = await bootstrapInquiry("tl-bare");

      const events = await vendorTimeline(f);
      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe("inquiry_sent");
      expect(events[0]!.actor).toBe("couple");
      expect(events[0]!.at).toBe(f.createdAt);
      // The payload is what the copy interpolates, and for an inquiry that is
      // the date the couple asked about.
      expect(events[0]!.payload.date).toBe(f.eventDate);

      // And the couple reads the same single event, since an inquiry is theirs.
      expect(kinds(await coupleTimeline(f))).toEqual(["inquiry_sent"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "events merge in timestamp order across every source, not table by table",
    async () => {
      const f = await bootstrapInquiry("tl-merge");
      const base = f.createdAt;

      // Four sources, deliberately written in the WRONG order and then
      // re-stamped, so a projector that concatenated its queries would come
      // back with the tables in query order instead of the times in order.
      const quoteId = await sendQuote(f, "Teljes nap", 1200, 1);
      const messageId = insertMessage({
        bookingId: f.bookingId,
        senderKind: "couple",
        senderUserId: null,
        body: "Mennyibe kerül?",
      });
      const hold = await placeHold(f, 48);
      const paymentId = await addPayment(f, "Foglaló", 400);

      restamp("UPDATE booking_messages SET created_at = ? WHERE id = ?", [base + 1000, messageId]);
      restamp("UPDATE booking_quotes SET sent_at = ? WHERE id = ?", [base + 2000, quoteId]);
      restamp("UPDATE booking_date_holds SET created_at = ? WHERE id = ?", [base + 3000, hold.id]);
      restamp("UPDATE vendor_client_payments SET created_at = ? WHERE id = ?", [
        base + 4000,
        paymentId,
      ]);

      const events = await vendorTimeline(f);
      expectChronological(events);
      expect(kinds(events)).toEqual([
        "inquiry_sent",
        "message",
        "quote_sent",
        "hold_placed",
        "payment_scheduled",
      ]);
      // The message event names the row, it does not carry a second copy of the
      // body: the panel already holds it.
      expect(only(events, "message").payload.message_id).toBe(messageId);
      // Money rides as a WHOLE unit of the quote's own currency.
      const quoteEvent = only(events, "quote_sent");
      expect(quoteEvent.payload.amount).toBe(1200);
      expect(quoteEvent.payload.currency).toBe("EUR");
      expect(quoteEvent.payload.label).toBe("Teljes nap");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a quote sent and accepted, a hold placed and released, an installment paid and a status change all appear",
    async () => {
      const f = await bootstrapInquiry("tl-sources");

      // The vendor opens the lead, then answers it. Two different stamps, and
      // `first_response_at` is write-once so the second one is exact.
      const seen = await req(
        "POST",
        `/api/vendor/clients/${f.bookingId}/seen`,
        {},
        { token: f.vendorToken },
      );
      expect(seen.status).toBe(200);
      const patched = await req(
        "PATCH",
        `/api/vendor/clients/${f.bookingId}`,
        { status: "vendor_seen" },
        { token: f.vendorToken },
      );
      expect(patched.status).toBe(200);

      // A hold, taken and then given back early.
      const hold = await placeHold(f, 48);
      const released = await req("DELETE", `/api/vendor/clients/${f.bookingId}/hold`, undefined, {
        token: f.vendorToken,
      });
      expect(released.status).toBe(200);

      // An offer the couple says yes to. Accepting is also what confirms the
      // booking, which is why the timeline can date the confirmation exactly.
      const quoteId = await sendQuote(f, "Egész napos csomag", 900, 2);
      const accepted = await req<{ quote: BookingQuote }>(
        "POST",
        `/api/quotes/${quoteId}/accept`,
        {},
        { token: f.coupleToken },
      );
      expect(accepted.status).toBe(200);

      // An installment, and then the vendor marking it paid.
      const paymentId = await addPayment(f, "Foglaló", 500);
      const paid = await req<{ payment: VendorClientPayment }>(
        "PATCH",
        `/api/vendor/payments/${paymentId}`,
        { label: "Foglaló", amount: 500, paid: true },
        { token: f.vendorToken },
      );
      expect(paid.status).toBe(200);

      const events = await vendorTimeline(f);
      expectChronological(events);
      const seen_kinds = new Set(kinds(events));
      for (const kind of [
        "inquiry_sent",
        "vendor_opened",
        "vendor_responded",
        "quote_sent",
        "quote_accepted",
        "booking_confirmed",
        "hold_placed",
        "hold_released",
        "payment_scheduled",
        "payment_paid",
      ] as TimelineEventKind[]) {
        expect(seen_kinds.has(kind)).toBe(true);
      }
      // A released hold is not also an expired one: "I let it go" and "it ran
      // out" are different things to have to explain.
      expect(seen_kinds.has("hold_expired")).toBe(false);

      // The confirmation is dated by the acceptance, not by whenever the row
      // was last touched, because accepting is what confirmed it.
      expect(only(events, "booking_confirmed").at).toBe(only(events, "quote_accepted").at);

      const paidEvent = only(events, "payment_paid");
      expect(paidEvent.payload.amount).toBe(500);
      expect(paidEvent.payload.currency).toBe("EUR");
      expect(paidEvent.actor).toBe("vendor");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hold that ran out reads as expired, with nothing having run in between",
    async () => {
      const f = await bootstrapInquiry("tl-lapse");
      await placeHold(f, 48);
      expect(kinds(await vendorTimeline(f))).toContain("hold_placed");

      lapseHold(f.bookingId);

      const events = await vendorTimeline(f);
      const expired = only(events, "hold_expired");
      // Derived against the clock: the event is dated by the deadline itself.
      expect(expired.actor).toBe("system");
      expect(expired.payload.date).toBe(f.eventDate);
      expect(kinds(events)).not.toContain("hold_released");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the couple's view omits every vendor-private kind and the vendor's includes them",
    async () => {
      const f = await bootstrapInquiry("tl-audience");

      await req("POST", `/api/vendor/clients/${f.bookingId}/seen`, {}, { token: f.vendorToken });
      await placeHold(f, 48);
      const quoteId = await sendQuote(f, "Ajánlat", 1000, 1);
      await addPayment(f, "Foglaló", 300);
      // The couple opening the offer is what stamps `viewed_at`.
      const list = await req<{ quotes: BookingQuote[] }>(
        "GET",
        `/api/messages/threads/${f.bookingId}/quotes`,
        undefined,
        { token: f.coupleToken },
      );
      expect(list.status).toBe(200);
      expect(list.data.quotes.find((q) => q.id === quoteId)?.status).toBe("viewed");

      const vendorSide = new Set(kinds(await vendorTimeline(f)));
      const coupleSide = new Set(kinds(await coupleTimeline(f)));

      // Every kind the map calls vendor-private, checked against the map rather
      // than a list written out here: a kind added later is covered on day one.
      expect(VENDOR_PRIVATE_KINDS.length).toBeGreaterThan(0);
      for (const kind of VENDOR_PRIVATE_KINDS) {
        expect(coupleSide.has(kind)).toBe(false);
      }
      for (const kind of [
        "vendor_opened",
        "hold_placed",
        "payment_scheduled",
        "quote_viewed",
      ] as const) {
        expect(TIMELINE_AUDIENCE[kind]).toBe("vendor");
        expect(vendorSide.has(kind)).toBe(true);
      }
      // What the couple DOES get is everything addressed to them.
      expect(coupleSide.has("inquiry_sent")).toBe(true);
      expect(coupleSide.has("quote_sent")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an automation-authored message is flagged, and a run that wrote nothing stays the vendor's own business",
    async () => {
      const f = await bootstrapInquiry("tl-automation");

      const humanId = insertMessage({
        bookingId: f.bookingId,
        senderKind: "vendor",
        senderUserId: null,
        body: "Szia, ráérek aznap.",
      });
      const robotId = insertMessage({
        bookingId: f.bookingId,
        senderKind: "vendor",
        senderUserId: null,
        body: "Köszönjük a megkeresést, hamarosan jelentkezünk.",
      });
      const ts = Date.now();
      // What the automation sweep writes: the run that authored the message…
      db.prepare(
        `INSERT INTO vendor_automation_runs
           (vendor_account_id, automation_key, booking_id, dedupe_key, status, message_id, created_at)
         VALUES (?, 'inquiry_ack', ?, ?, 'sent', ?, ?)`,
      ).run(f.accountId, f.bookingId, `inquiry_ack:${f.bookingId}`, robotId, ts);
      // …and one that wrote no message at all, which is bookkeeping.
      db.prepare(
        `INSERT INTO vendor_automation_runs
           (vendor_account_id, automation_key, booking_id, dedupe_key, status, created_at)
         VALUES (?, 'review_request', ?, ?, 'proposed', ?)`,
      ).run(f.accountId, f.bookingId, `review_request:${f.bookingId}`, ts);

      const events = await vendorTimeline(f);
      const messages = events.filter((e) => e.kind === "message");
      expect(messages).toHaveLength(2);
      expect(messages.find((e) => e.payload.message_id === humanId)?.payload.automated).toBe(false);
      expect(messages.find((e) => e.payload.message_id === robotId)?.payload.automated).toBe(true);

      // The run that wrote a message is NOT repeated as bookkeeping: that would
      // be the same fact on the timeline twice.
      const runs = events.filter((e) => e.kind === "automation_ran");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.payload.value).toBe("review_request");
      expect(runs[0]!.actor).toBe("system");

      // The couple sees the messages, and the flag with them: the words are the
      // vendor's, the timing was not, and that is the same disclosure an
      // out-of-office carries. The bookkeeping row stays behind.
      const coupleEvents = await coupleTimeline(f);
      expect(kinds(coupleEvents)).not.toContain("automation_ran");
      expect(coupleEvents.find((e) => e.payload.message_id === robotId)?.payload.automated).toBe(
        true,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a declined inquiry says so on both sides, and nothing is invented for one still waiting",
    async () => {
      const f = await bootstrapInquiry("tl-declined");
      const open = await vendorTimeline(f);
      // 'requested' is how an inquiry ARRIVES, not a change worth a line.
      expect(kinds(open)).toEqual(["inquiry_sent"]);

      const patched = await req(
        "PATCH",
        `/api/vendor/clients/${f.bookingId}`,
        { status: "declined" },
        { token: f.vendorToken },
      );
      expect(patched.status).toBe(200);

      const events = await vendorTimeline(f);
      expect(kinds(events)).toContain("booking_declined");
      expect(only(events, "booking_declined").actor).toBe("vendor");
      // A refusal is addressed to the couple, so they read it too.
      expect(kinds(await coupleTimeline(f))).toContain("booking_declined");
    },
    TEST_TIMEOUT_MS,
  );
});
