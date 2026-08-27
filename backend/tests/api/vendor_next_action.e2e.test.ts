// Vendor Next Best Action + the attention queue.
//
// One derivation (`shared/vendor_next_action.ts`) answers two questions about a
// client: what is the single next step, and does it need the vendor right now.
// The rules are pure, so most of this file exercises them directly with hand-
// built signals — that is the only way to cover a ladder whose branches depend
// on clock arithmetic without a fixture per hour. The API half then proves the
// server actually gathers those signals off real rows, that the snooze endpoint
// mutes the band and nothing else, and that the PRO-derived rules are absent on
// FREE rather than leaking money state into a free-tier payload.
//
// Covers (major-change rule — new endpoint + new derived state machine):
//   - the full action ladder, including the two "nothing is owed" verdicts
//   - archived leads and past-date open leads produce no action and no attention
//   - every attention rule, and the precedence between them
//   - a live list carries next_action / attention derived from real bookings
//   - POST /api/vendor/clients/:id/snooze mutes the band, leaves the action and
//     the unread count alone, and clears again with days: null
//   - a FREE vendor gets no payment-derived action or attention
//   - snooze is ownership-gated (404 on another vendor's booking)
//
// Pairs with backend/src/routes/vendor_clients.ts + domain/vendor_clients.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { VendorClientSignals } from "@shared/vendor_next_action";
import {
  DATE_SOON_DAYS,
  GOING_COLD_DAYS,
  REPLY_DUE_HOURS,
  REVIEW_DUE_DAYS,
  SNOOZE_DAYS,
  daysUntilDate,
  vendorAttention,
  vendorNextAction,
} from "@shared/vendor_next_action";
import type { VendorClientView } from "@shared/vendor_clients";
import type { SupplierBooking } from "@shared/suppliers";
import { db } from "../../src/db";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { insertMessage } from "../../src/domain/booking_messages";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed "now" so every expectation is arithmetic, not wall-clock luck. */
const NOW = Date.UTC(2027, 4, 10, 12, 0, 0);

function isoDaysFromNow(days: number): string {
  return new Date(NOW + days * DAY).toISOString().slice(0, 10);
}

/** Signals for a live, untouched inquiry; each test overrides only what it is
 *  about, so a new field can't silently change every case's meaning. */
function signals(patch: Partial<VendorClientSignals> = {}): VendorClientSignals {
  return {
    status: "requested",
    created_at: NOW - HOUR,
    vendor_seen_at: null,
    event_date: isoDaysFromNow(200),
    last_couple_message_at: NOW - HOUR,
    last_vendor_message_at: null,
    contract_value: null,
    payment_count: 0,
    next_unpaid_due: null,
    reviewed: false,
    snoozed_until: null,
    hold_until: null,
    hold_released_at: null,
    pro: true,
    ...patch,
  };
}

describe("vendor next action — the rules", () => {
  test("a brand-new inquiry is 'open' and sits at the top of the band", () => {
    const s = signals();
    expect(vendorNextAction(s, NOW)).toBe("open");
    const a = vendorAttention(s, NOW);
    expect(a?.key).toBe("unopened");
    expect(a?.severity).toBe(0);
    // `since` is the newest thing the vendor has not read, so a couple who
    // followed up moves the lead up rather than resetting its clock.
    expect(a?.since).toBe(NOW - HOUR);
  });

  test("opened but unanswered: quiet inside the reply window, flagged after it", () => {
    const fresh = signals({
      vendor_seen_at: NOW - HOUR,
      last_couple_message_at: NOW - (REPLY_DUE_HOURS - 1) * HOUR,
    });
    expect(vendorNextAction(fresh, NOW)).toBe("reply");
    // The action already says "reply"; it is simply not an alarm yet.
    expect(vendorAttention(fresh, NOW)).toBeNull();

    const late = signals({
      vendor_seen_at: NOW - HOUR,
      last_couple_message_at: NOW - (REPLY_DUE_HOURS + 2) * HOUR,
    });
    expect(vendorNextAction(late, NOW)).toBe("reply");
    const a = vendorAttention(late, NOW);
    expect(a?.key).toBe("unanswered");
    expect(a?.hours).toBe(REPLY_DUE_HOURS + 2);
  });

  test("the vendor answered: waiting is a real verdict, silence becomes a follow-up", () => {
    const waiting = signals({
      vendor_seen_at: NOW - 2 * DAY,
      last_couple_message_at: NOW - 2 * DAY,
      last_vendor_message_at: NOW - DAY,
    });
    expect(vendorNextAction(waiting, NOW)).toBe("await");
    expect(vendorAttention(waiting, NOW)).toBeNull();

    const cold = signals({
      vendor_seen_at: NOW - 30 * DAY,
      last_couple_message_at: NOW - 30 * DAY,
      last_vendor_message_at: NOW - (GOING_COLD_DAYS + 2) * DAY,
    });
    expect(vendorNextAction(cold, NOW)).toBe("follow_up");
    const a = vendorAttention(cold, NOW);
    expect(a?.key).toBe("going_cold");
    expect(a?.days).toBe(GOING_COLD_DAYS + 2);
  });

  test("an approaching date outranks going cold, and counts days FORWARD", () => {
    const s = signals({
      event_date: isoDaysFromNow(12),
      created_at: NOW - 30 * DAY,
      vendor_seen_at: NOW - 30 * DAY,
      last_couple_message_at: NOW - 30 * DAY,
      last_vendor_message_at: NOW - (GOING_COLD_DAYS + 2) * DAY,
    });
    // Both reasons produce the SAME action: whichever one the band names, the
    // vendor is being asked to chase, and the CTA must not contradict the chip.
    expect(vendorNextAction(s, NOW)).toBe("follow_up");
    const a = vendorAttention(s, NOW);
    expect(a?.key).toBe("date_soon");
    // Days until the wedding, not days elapsed: the copy reads "in 12d".
    expect(a?.days).toBe(12);
    expect(daysUntilDate(s.event_date, NOW)).toBe(12);

    // One day outside the window and only the silence is left to report.
    const far = signals({ ...s, event_date: isoDaysFromNow(DATE_SOON_DAYS + 1) });
    expect(vendorAttention(far, NOW)?.key).toBe("going_cold");
    expect(vendorNextAction(far, NOW)).toBe("follow_up");

    // A near date with a fresh reply is still a nudge, with nothing wrong yet.
    const nearAndFresh = signals({
      ...s,
      last_vendor_message_at: NOW - DAY,
      event_date: isoDaysFromNow(9),
    });
    expect(vendorNextAction(nearAndFresh, NOW)).toBe("follow_up");
    expect(vendorAttention(nearAndFresh, NOW)?.key).toBe("date_soon");
  });

  test("an inquiry with no message row still counts as a couple waiting", () => {
    // The ask lives in the legacy `supplier_bookings.notes` blob (every
    // pre-thread inquiry, and every admin-created booking). Keying the rule on
    // message rows alone dropped exactly these leads out of the queue the
    // moment the vendor opened them.
    const s = signals({
      created_at: NOW - (REPLY_DUE_HOURS + 5) * HOUR,
      vendor_seen_at: NOW - HOUR,
      last_couple_message_at: null,
      last_vendor_message_at: null,
    });
    expect(vendorNextAction(s, NOW)).toBe("reply");
    const a = vendorAttention(s, NOW);
    expect(a?.key).toBe("unanswered");
    expect(a?.hours).toBe(REPLY_DUE_HOURS + 5);

    // Once the vendor has written, the same booking goes quiet.
    const answered = signals({ ...s, last_vendor_message_at: NOW - HOUR });
    expect(vendorNextAction(answered, NOW)).toBe("await");
    expect(vendorAttention(answered, NOW)).toBeNull();
  });

  test("an unanswered couple outranks an approaching date", () => {
    const s = signals({
      event_date: isoDaysFromNow(5),
      vendor_seen_at: NOW - 5 * DAY,
      last_couple_message_at: NOW - 2 * DAY,
      last_vendor_message_at: NOW - 3 * DAY,
    });
    expect(vendorAttention(s, NOW)?.key).toBe("unanswered");
    expect(vendorNextAction(s, NOW)).toBe("reply");
  });

  test("a confirmed booking walks contract → schedule → nothing outstanding", () => {
    const noContract = signals({ status: "confirmed", vendor_seen_at: NOW - DAY });
    expect(vendorNextAction(noContract, NOW)).toBe("record_contract");
    expect(vendorAttention(noContract, NOW)).toBeNull();

    const noSchedule = signals({
      status: "confirmed",
      vendor_seen_at: NOW - DAY,
      contract_value: 500000,
    });
    expect(vendorNextAction(noSchedule, NOW)).toBe("add_schedule");

    const settled = signals({
      status: "confirmed",
      vendor_seen_at: NOW - DAY,
      contract_value: 500000,
      payment_count: 2,
    });
    expect(vendorNextAction(settled, NOW)).toBe("prepare");
    expect(vendorAttention(settled, NOW)).toBeNull();
  });

  test("an overdue installment is the loudest thing about a confirmed booking", () => {
    const s = signals({
      status: "confirmed",
      vendor_seen_at: NOW - DAY,
      contract_value: 500000,
      payment_count: 2,
      next_unpaid_due: isoDaysFromNow(-4),
    });
    expect(vendorNextAction(s, NOW)).toBe("chase_payment");
    const a = vendorAttention(s, NOW);
    expect(a?.key).toBe("payment_overdue");
    expect(a?.days).toBe(4);

    // Due tomorrow is not overdue.
    const upcoming = signals({ ...s, next_unpaid_due: isoDaysFromNow(1) });
    expect(vendorNextAction(upcoming, NOW)).toBe("prepare");
    expect(vendorAttention(upcoming, NOW)).toBeNull();
  });

  test("after the wedding the ask is a review, once, and only if there isn't one", () => {
    const justOver = signals({
      status: "confirmed",
      vendor_seen_at: NOW - 200 * DAY,
      event_date: isoDaysFromNow(-1),
      contract_value: 500000,
      payment_count: 1,
    });
    expect(vendorNextAction(justOver, NOW)).toBe("request_review");
    // The action is there, but the band waits a few days: the couple is away
    // and the vendor's own delivery is usually not out.
    expect(vendorAttention(justOver, NOW)).toBeNull();

    const settled = signals({ ...justOver, event_date: isoDaysFromNow(-REVIEW_DUE_DAYS - 1) });
    expect(vendorAttention(settled, NOW)?.key).toBe("review_due");

    const reviewed = signals({ ...settled, reviewed: true });
    expect(vendorNextAction(reviewed, NOW)).toBe("none");
    expect(vendorAttention(reviewed, NOW)).toBeNull();
  });

  test("an archived lead is silent, whatever else is true about it", () => {
    for (const status of ["declined", "cancelled", "expired"]) {
      const s = signals({
        status,
        event_date: isoDaysFromNow(3),
        last_couple_message_at: NOW - 30 * DAY,
        next_unpaid_due: isoDaysFromNow(-30),
      });
      expect(vendorNextAction(s, NOW)).toBe("none");
      expect(vendorAttention(s, NOW)).toBeNull();
    }
  });

  test("an open inquiry whose date has passed is a lost lead, not a deadline", () => {
    const s = signals({
      status: "vendor_seen",
      vendor_seen_at: NOW - 100 * DAY,
      event_date: isoDaysFromNow(-2),
      last_couple_message_at: NOW - 100 * DAY,
    });
    expect(vendorNextAction(s, NOW)).toBe("none");
    expect(vendorAttention(s, NOW)).toBeNull();
  });

  test("FREE has no money rules at all — not a locked row, no row", () => {
    // The server zeroes the payment signals off the plan; the derivation must
    // then produce the same answer it would for a vendor with no schedule.
    const free = signals({
      status: "confirmed",
      vendor_seen_at: NOW - DAY,
      pro: false,
      contract_value: null,
      payment_count: 0,
      next_unpaid_due: null,
    });
    expect(vendorNextAction(free, NOW)).toBe("prepare");
    expect(vendorAttention(free, NOW)).toBeNull();
  });

  test("a snooze mutes the band without changing the next step", () => {
    const s = signals({ snoozed_until: NOW + 2 * DAY });
    expect(vendorAttention(s, NOW)).toBeNull();
    expect(vendorNextAction(s, NOW)).toBe("open");
    // Expired snooze: the row comes back on its own.
    expect(vendorAttention(signals({ snoozed_until: NOW - DAY }), NOW)?.key).toBe("unopened");
  });

  test("a malformed event date can't fake a deadline", () => {
    expect(daysUntilDate("not-a-date", NOW)).toBeNull();
    const s = signals({ event_date: "", vendor_seen_at: NOW - DAY, last_vendor_message_at: NOW });
    expect(vendorNextAction(s, NOW)).toBe("await");
    expect(vendorAttention(s, NOW)).toBeNull();
  });
});

// ── API surface ─────────────────────────────────────────────────────────────

interface ClaimRow {
  token: string;
}

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
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

async function createInboundBooking(
  listingId: string,
  coupleId: number,
  eventDate: string,
): Promise<number> {
  const adminToken = await registerAdminAndGetToken();
  const r = await req<SupplierBooking>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes: "Are you free that day?" },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

/** Age the inquiry itself so it crosses the reply-due window without the test
 *  having to wait. This route writes no message row (the ask lives in the
 *  legacy `notes` blob), which is exactly the shape the created_at fallback
 *  exists for. */
function ageInquiry(bookingId: number, hoursAgo: number): void {
  db.prepare("UPDATE supplier_bookings SET created_at = ? WHERE id = ?").run(
    Date.now() - hoursAgo * HOUR,
    bookingId,
  );
}

/** A real couple message on the thread, `hoursAgo` old. */
function addCoupleMessage(bookingId: number, hoursAgo: number): void {
  insertMessage({
    bookingId,
    senderKind: "couple",
    senderUserId: null,
    body: "Any news on the quote?",
    at: Date.now() - hoursAgo * HOUR,
  });
}

/** Strip the subscription a claim-complete granted, dropping the account to the
 *  FREE tier. There is no endpoint for this — lapsing is what produces it in
 *  production, and the derived plan is what the payload actually reads. */
function downgradeToFree(accountId: number): void {
  db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(accountId);
}

async function listClients(token: string): Promise<VendorClientView[]> {
  const r = await req<{ clients: VendorClientView[] }>("GET", "/api/vendor/clients", undefined, {
    token,
  });
  expect(r.status).toBe(200);
  return r.data.clients;
}

/** A future date far outside DATE_SOON_DAYS, so the date rule never joins in. */
function farEventDate(): string {
  return new Date(Date.now() + 300 * DAY).toISOString().slice(0, 10);
}

describe("vendor next action — the API", () => {
  test("a live inquiry arrives on the list as 'open' + unopened, and opening it becomes 'reply'", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("nba-live");
    initVendorBilling(accountId, "EUR");
    const { coupleId } = await bootstrapCouple("couple-nba-live@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, farEventDate());

    const before = await listClients(vendorToken);
    expect(before[0]?.next_action).toBe("open");
    expect(before[0]?.attention?.key).toBe("unopened");
    expect(before[0]?.attention_snoozed_until).toBeNull();

    // Opening it is the vendor's own action, and it moves the verdict along:
    // the couple is still waiting, so the next step is a reply.
    const seen = await req(
      "POST",
      `/api/vendor/clients/${bookingId}/seen`,
      {},
      { token: vendorToken },
    );
    expect(seen.status).toBe(200);
    ageInquiry(bookingId, REPLY_DUE_HOURS + 3);

    const after = await listClients(vendorToken);
    expect(after[0]?.next_action).toBe("reply");
    expect(after[0]?.attention?.key).toBe("unanswered");
    expect(after[0]?.attention?.hours).toBe(REPLY_DUE_HOURS + 3);
  });

  test("a couple's follow-up message re-opens a lead the vendor had answered", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("nba-thread");
    initVendorBilling(accountId, "EUR");
    const { coupleId } = await bootstrapCouple("couple-nba-thread@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, farEventDate());
    db.prepare("UPDATE supplier_bookings SET vendor_seen_at = ? WHERE id = ?").run(
      Date.now(),
      bookingId,
    );
    // The inquiry is three days old, so the vendor's reply below genuinely
    // comes after it.
    ageInquiry(bookingId, 72);

    // The vendor answered two days ago: nothing is owed.
    insertMessage({
      bookingId,
      senderKind: "vendor",
      senderUserId: null,
      body: "We're free, here's the package.",
      at: Date.now() - 2 * DAY,
    });
    const answered = await listClients(vendorToken);
    expect(answered[0]?.next_action).toBe("await");
    expect(answered[0]?.attention).toBeNull();

    // The couple comes back. The ball moves, and the clock starts on the newest
    // message rather than the original inquiry.
    addCoupleMessage(bookingId, REPLY_DUE_HOURS + 1);
    const reopened = await listClients(vendorToken);
    expect(reopened[0]?.next_action).toBe("reply");
    expect(reopened[0]?.attention?.key).toBe("unanswered");
    expect(reopened[0]?.attention?.hours).toBe(REPLY_DUE_HOURS + 1);
    expect(reopened[0]?.unread_count).toBe(1);
  });

  test("snooze mutes the band, leaves the action and the unread count alone, and clears again", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("nba-snooze");
    initVendorBilling(accountId, "EUR");
    const { coupleId } = await bootstrapCouple("couple-nba-snooze@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, farEventDate());
    addCoupleMessage(bookingId, 1);

    const before = await listClients(vendorToken);
    expect(before[0]?.attention).not.toBeNull();
    const unreadBefore = before[0]?.unread_count ?? 0;
    expect(unreadBefore).toBeGreaterThan(0);

    const snoozed = await req<{ attention_snoozed_until: number | null }>(
      "POST",
      `/api/vendor/clients/${bookingId}/snooze`,
      {},
      { token: vendorToken },
    );
    expect(snoozed.status).toBe(200);
    const until = snoozed.data.attention_snoozed_until;
    expect(until).not.toBeNull();
    // Default window, to the day.
    expect(Math.round(((until ?? 0) - Date.now()) / DAY)).toBe(SNOOZE_DAYS);

    const muted = await listClients(vendorToken);
    expect(muted[0]?.attention).toBeNull();
    // The band went quiet; nothing else did. This is the whole contract of the
    // snooze — a dismissed lead must not become an invisible one.
    expect(muted[0]?.next_action).toBe("open");
    expect(muted[0]?.unread_count).toBe(unreadBefore);
    expect(muted[0]?.attention_snoozed_until).toBe(until);

    const cleared = await req<{ attention_snoozed_until: number | null }>(
      "POST",
      `/api/vendor/clients/${bookingId}/snooze`,
      { days: null },
      { token: vendorToken },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.attention_snoozed_until).toBeNull();
    expect((await listClients(vendorToken))[0]?.attention?.key).toBe("unopened");
  });

  test("snooze rejects a junk window and another vendor's client", async () => {
    wipeAll();
    const a = await bootstrapVendor("nba-own");
    initVendorBilling(a.accountId, "EUR");
    const { coupleId } = await bootstrapCouple("couple-nba-own@weddly.test");
    const bookingId = await createInboundBooking(a.listingId, coupleId, farEventDate());

    const bad = await req(
      "POST",
      `/api/vendor/clients/${bookingId}/snooze`,
      { days: 0 },
      { token: a.vendorToken },
    );
    expect(bad.status).toBe(400);

    const b = await bootstrapVendor("nba-other");
    initVendorBilling(b.accountId, "EUR");
    // 404 rather than 403, so booking ids can't be enumerated from outside.
    const foreign = await req(
      "POST",
      `/api/vendor/clients/${bookingId}/snooze`,
      {},
      { token: b.vendorToken },
    );
    expect(foreign.status).toBe(404);
  });

  test("a FREE vendor's confirmed booking never asks about money", async () => {
    wipeAll();
    const { vendorToken, listingId, accountId } = await bootstrapVendor("nba-free");
    const { coupleId } = await bootstrapCouple("couple-nba-free@weddly.test");
    const bookingId = await createInboundBooking(listingId, coupleId, farEventDate());
    db.prepare(
      "UPDATE supplier_bookings SET status = 'confirmed', vendor_seen_at = ? WHERE id = ?",
    ).run(Date.now(), bookingId);
    // Claim-complete grants a subscription, so FREE has to be produced, not
    // merely not-granted. Dropped AFTER the inquiry lands, because an
    // unentitled vendor can't receive one in the first place.
    downgradeToFree(accountId);

    const clients = await listClients(vendorToken);
    // PRO would say `record_contract` here. FREE has no contract field to fill,
    // so the honest verdict is that the wedding is simply booked.
    expect(clients[0]?.next_action).toBe("prepare");
    expect(clients[0]?.attention).toBeNull();
  });
});
