// Vendor automations: the three things Weddly may do on a vendor's behalf.
//
// The suite is written around the invariants rather than the endpoints, because
// the endpoints are thin and the invariants are the feature:
//
//   - every automation is OFF until the vendor says otherwise, and the
//     acknowledgement cannot even be armed until they have written the words;
//   - the triggers ARE `vendorAttention`'s verdicts, asserted by deriving the
//     same verdict directly and watching the sweep agree;
//   - an automatic acknowledgement is not a reply, so a lead the machine
//     answered is still a lead the vendor owes an answer;
//   - a dedupe key names the occurrence, so a second sweep sends nothing and a
//     NEW wait earns a new reminder;
//   - the review request is queued for a human click, never sent;
//   - nothing is retroactive: arming acts on what happens next;
//   - a suppressed address is refused by the dispatcher, and the in-app copy
//     still lands, because suppression is about email;
//   - PRO gates the writes and a lapse PARKS the automations, it never deletes
//     the vendor's configured text;
//   - these are automatic sends, so they leave from the automatic mailbox.
//
// Pairs with backend/src/domain/vendor_automations.ts + routes/vendor_automations.ts.

import "../setup";

import { beforeAll, describe, expect, test } from "bun:test";
import type { BookingThread } from "@shared/booking_messages";
import type { SupplierBooking } from "@shared/suppliers";
import type { VendorAutomationsView } from "@shared/vendor_automations";
import {
  ACK_MAX_AGE_HOURS,
  automationDedupeKey,
  REMINDER_DELAY_DEFAULT_HOURS,
  REMINDER_DELAY_MIN_HOURS,
} from "@shared/vendor_automations";
import { REPLY_DUE_HOURS, REVIEW_DUE_DAYS, vendorAttention } from "@shared/vendor_next_action";
import { CONFIG } from "../../src/config";
import { db } from "../../src/db";
import { insertMessage } from "../../src/domain/booking_messages";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { senderForKind } from "../../src/domain/emails/kinds";
import { addOptOut } from "../../src/domain/emails/optouts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { clientSignalsForBookings } from "../../src/domain/vendor_clients";
import {
  lastHumanVendorMessageAt,
  runVendorAutomationSweep,
} from "../../src/domain/vendor_automations";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const HOUR = 3_600_000;
const DAY = 86_400_000;

interface TokenRow {
  token: string;
}

let vendorToken = "";
let vendorAccountId = 0;
let listingId = "";
let adminToken = "";
let coupleId = 0;
let coupleEmail = "";
let vendorEmail = "";

// ── Fixtures ────────────────────────────────────────────────────────────────

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
    .get(numericId) as TokenRow | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const at = await registerAdminAndGetToken();
  const approve = await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: at });
  expect(approve.status).toBe(200);
  return publicId;
}

/** A claimed listing with a real vendor account behind it. `v<accountId>` would
 *  be the wrong id here, which is exactly why the automations resolve the
 *  listing through `getListingByVendorAccountId`. */
async function bootstrapVendor(slug: string, claimantEmail: string): Promise<void> {
  const contactEmail = `vendor-${slug}@weddly.test`;
  listingId = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    contactEmail,
    `${slug} Studio`,
  );
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: claimantEmail,
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as TokenRow | undefined;
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
  vendorToken = complete.data.token;
  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  vendorAccountId = acct.id;
  // The account owner's address, read back rather than assumed: the claim flow
  // mints the user against the LISTING's contact email, not the claimant's.
  vendorEmail = (
    db
      .prepare(
        "SELECT u.email AS email FROM vendor_accounts v JOIN users u ON u.id = v.owner_user_id WHERE v.id = ?",
      )
      .get(vendorAccountId) as { email: string }
  ).email;
  expect(claimantEmail.length).toBeGreaterThan(0);
  initVendorBilling(vendorAccountId, "EUR");
}

beforeAll(async () => {
  wipeAll();
  coupleEmail = "couple-autom@weddly.test";
  await bootstrapVendor("autom", "claimer-autom@gmail.test");
  adminToken = await registerAdminAndGetToken();
  const couple = await bootstrapCouple(coupleEmail);
  coupleId = couple.coupleId;
});

/** Everything a single case owns. Deliberately NOT `wipeAll()`: that drops
 *  `users`/`sessions` and costs a ~2s argon2 re-registration per test, and the
 *  vendor/couple pair is identical for every case here anyway. */
function resetState(): void {
  db.exec("DELETE FROM vendor_automation_runs");
  db.exec("DELETE FROM vendor_automations");
  db.exec("DELETE FROM vendor_message_templates");
  db.exec("DELETE FROM booking_messages");
  db.exec("DELETE FROM supplier_bookings");
  db.exec("DELETE FROM email_log");
  db.exec("DELETE FROM email_optouts");
  db.exec("DELETE FROM couple_notifications");
  // Restore the subscription a FREE-tier case may have removed.
  initVendorBilling(vendorAccountId, "EUR");
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

async function createInquiry(eventDate = isoDaysFromNow(300)): Promise<number> {
  const r = await req<SupplierBooking>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes: "Are you free that day?" },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

function setBookingCreatedAt(bookingId: number, ts: number): void {
  db.prepare("UPDATE supplier_bookings SET created_at = ? WHERE id = ?").run(ts, bookingId);
}

/** Backdate the arm stamp, so a case can exercise the freshness ceiling without
 *  the "not retroactive" floor answering first. */
function setArmedAt(key: string, ts: number): void {
  db.prepare(
    "UPDATE vendor_automations SET armed_at = ? WHERE vendor_account_id = ? AND automation_key = ?",
  ).run(ts, vendorAccountId, key);
}

/** The vendor opened the inquiry. Moves the band's verdict from `unopened` to
 *  `unanswered`, which is the branch most of the reminder cases are about. */
async function markSeen(bookingId: number): Promise<void> {
  const r = await req("POST", `/api/vendor/clients/${bookingId}/seen`, {}, { token: vendorToken });
  expect(r.status).toBe(200);
}

/** Error bodies are `{ error, detail }`; the machine-readable code rides
 *  `detail.code`. */
function errorCode(data: unknown): string | undefined {
  return (data as { detail?: { code?: string } } | undefined)?.detail?.code;
}

async function vendorThreadMessageCount(bookingId: number): Promise<number> {
  const r = await req<{ thread: BookingThread }>(
    "GET",
    `/api/vendor/clients/${bookingId}/messages`,
    undefined,
    { token: vendorToken },
  );
  expect(r.status).toBe(200);
  return r.data.thread.messages.filter((m) => m.sender_kind === "vendor").length;
}

async function vendorThreadBody(bookingId: number): Promise<string> {
  const r = await req<{ thread: BookingThread }>(
    "GET",
    `/api/vendor/clients/${bookingId}/messages`,
    undefined,
    { token: vendorToken },
  );
  return r.data.thread.messages.find((m) => m.sender_kind === "vendor")?.body ?? "";
}

function getAutomations(): Promise<{ status: number; data: VendorAutomationsView }> {
  return req<VendorAutomationsView>("GET", "/api/vendor/automations", undefined, {
    token: vendorToken,
  });
}

function putAutomation(key: string, body: Record<string, unknown>) {
  return req<VendorAutomationsView>("PUT", `/api/vendor/automations/${key}`, body, {
    token: vendorToken,
  });
}

async function createTemplate(body: string): Promise<number> {
  const r = await req<{ template: { id: number } }>(
    "POST",
    "/api/vendor/message-templates",
    { title: "Auto reply", body },
    { token: vendorToken },
  );
  expect(r.status).toBe(201);
  return r.data.template.id;
}

interface LogRow {
  kind: string;
  to_email: string;
  status: string;
  from_email: string | null;
}

function emailLog(kind: string): LogRow[] {
  return db
    .prepare("SELECT kind, to_email, status, from_email FROM email_log WHERE kind = ?")
    .all(kind) as LogRow[];
}

interface RunRow {
  automation_key: string;
  dedupe_key: string;
  status: string;
  detail: string | null;
  message_id: number | null;
}

function runs(): RunRow[] {
  return db
    .prepare(
      "SELECT automation_key, dedupe_key, status, detail, message_id FROM vendor_automation_runs ORDER BY id ASC",
    )
    .all() as RunRow[];
}

function bookingRow(bookingId: number) {
  return db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(bookingId) as never;
}

/** The verdict the vendor's own attention band would draw for this booking,
 *  from the same gatherer and the same rule the automation consults. */
function attentionNow(bookingId: number, nowMs: number) {
  const row = bookingRow(bookingId);
  const signals = clientSignalsForBookings(vendorAccountId, [row]).get(bookingId);
  expect(signals).toBeDefined();
  return signals ? vendorAttention(signals, nowMs) : null;
}

/** The same rule, asked with the automation's own correction: an automatic
 *  acknowledgement is not a reply, so it does not count as the vendor having
 *  answered. Same derivation, one honest fact. */
function correctedAttention(bookingId: number, nowMs: number) {
  const row = bookingRow(bookingId);
  const signals = clientSignalsForBookings(vendorAccountId, [row]).get(bookingId);
  if (!signals) return null;
  const human = lastHumanVendorMessageAt([bookingId]).get(bookingId) ?? null;
  return vendorAttention({ ...signals, last_vendor_message_at: human }, nowMs);
}

// ── Defaults + arming ───────────────────────────────────────────────────────

describe("vendor automations: nothing runs until the vendor says so", () => {
  test("every automation is off out of the box", async () => {
    resetState();
    const r = await getAutomations();
    expect(r.status).toBe(200);
    expect(r.data.automations.length).toBe(3);
    for (const a of r.data.automations) {
      expect(a.enabled).toBe(false);
      expect(a.armed_at).toBeNull();
    }
    const byKey = new Map(r.data.automations.map((a) => [a.key, a]));
    // Nothing is preconfigured, and the reminder carries a suggestion rather
    // than a decision: it is still off.
    expect(byKey.get("inquiry_ack")?.template_id).toBeNull();
    expect(byKey.get("unanswered_reminder")?.delay_hours).toBe(REMINDER_DELAY_DEFAULT_HOURS);
    expect(r.data.proposals.length).toBe(0);
    expect(r.data.recent.length).toBe(0);
  });

  test("the acknowledgement refuses to arm before the vendor has written the words", async () => {
    resetState();
    const refused = await putAutomation("inquiry_ack", { enabled: true });
    expect(refused.status).toBe(400);
    expect(errorCode(refused.data)).toBe("automation_needs_body");

    // Still off, and no half-armed row was left behind.
    const after = await getAutomations();
    const ack = after.data.automations.find((a) => a.key === "inquiry_ack");
    expect(ack?.enabled).toBe(false);
    expect(ack?.armed_at).toBeNull();

    // A template that exists but has been cleared is the same failure one step
    // later: the picker offered a canned reply with nothing in it.
    const blank = await createTemplate("about to be cleared");
    db.prepare("UPDATE vendor_message_templates SET body = '' WHERE id = ?").run(blank);
    const stillRefused = await putAutomation("inquiry_ack", {
      enabled: true,
      template_id: blank,
    });
    expect(stillRefused.status).toBe(400);

    const templateId = await createTemplate("Thanks for reaching out, {client_name}!");
    const armed = await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    expect(armed.status).toBe(200);
    const on = armed.data.automations.find((a) => a.key === "inquiry_ack");
    expect(on?.enabled).toBe(true);
    expect(on?.template_id).toBe(templateId);
    expect(on?.armed_at).not.toBeNull();
  });

  test("a patch about one field leaves the others alone", async () => {
    resetState();
    const templateId = await createTemplate("Thanks!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    // A body that says nothing about the template must not clear it.
    const patched = await putAutomation("inquiry_ack", { enabled: false });
    const ack = patched.data.automations.find((a) => a.key === "inquiry_ack");
    expect(ack?.enabled).toBe(false);
    expect(ack?.template_id).toBe(templateId);
  });

  test("the reminder delay is clamped to what the queue can justify", async () => {
    resetState();
    const tooFast = await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: 1,
    });
    expect(tooFast.status).toBe(200);
    const a = tooFast.data.automations.find((k) => k.key === "unanswered_reminder");
    // The floor IS `REPLY_DUE_HOURS`: below it `vendorAttention` does not call
    // the lead unanswered, so a shorter delay could only be honoured by
    // inventing a second opinion about the same booking.
    expect(a?.delay_hours).toBe(REMINDER_DELAY_MIN_HOURS);
    expect(REMINDER_DELAY_MIN_HOURS).toBe(REPLY_DUE_HOURS);
  });
});

// ── 1. Instant acknowledgement ──────────────────────────────────────────────

describe("vendor automations: the acknowledgement", () => {
  test("answers a new inquiry once, marks itself as automatic, and a second sweep is a no-op", async () => {
    resetState();
    const templateId = await createTemplate(
      "Thanks {client_name}, we will be in touch about {event_date}.",
    );
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    const bookingId = await createInquiry();

    const first = await runVendorAutomationSweep();
    expect(first.acknowledged).toBe(1);

    // The couple reads it in the thread, and it says plainly that a machine
    // sent it, so nobody is surprised by words in the vendor's name.
    expect(await vendorThreadMessageCount(bookingId)).toBe(1);
    const body = await vendorThreadBody(bookingId);
    // The vendor's own tokens were substituted, so the couple reads their name.
    expect(body).toContain("Mia & Lucas");
    expect(body).not.toContain("{client_name}");
    expect(body.toLowerCase()).toContain("automat");

    const runRows = runs();
    expect(runRows.length).toBe(1);
    expect(runRows[0]?.status).toBe("sent");
    expect(runRows[0]?.dedupe_key).toBe(automationDedupeKey("inquiry_ack", bookingId));
    expect(runRows[0]?.message_id).not.toBeNull();

    // The occurrence is consumed. A worker restart, a double tick and a manual
    // replay all lose the race to the same unique index.
    const second = await runVendorAutomationSweep();
    expect(second.acknowledged).toBe(0);
    expect(runs().length).toBe(1);
    expect(await vendorThreadMessageCount(bookingId)).toBe(1);
  });

  test("arming is never retroactive: the inquiries already sitting there are left alone", async () => {
    resetState();
    // An inquiry that landed BEFORE the switch was flipped. Answering it now
    // would tell a couple the vendor has probably already replied to that
    // somebody will be in touch shortly.
    const oldBooking = await createInquiry();
    setBookingCreatedAt(oldBooking, Date.now() - 2 * HOUR);
    const templateId = await createTemplate("Thanks!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });

    expect((await runVendorAutomationSweep()).acknowledged).toBe(0);
    expect(runs().length).toBe(0);

    // What arrives NEXT is what it is for.
    const current = await createInquiry();
    expect((await runVendorAutomationSweep()).acknowledged).toBe(1);
    expect(runs()[0]?.dedupe_key).toBe(automationDedupeKey("inquiry_ack", current));
  });

  test("a sweep that was down for a day does not answer a backlog on waking", async () => {
    resetState();
    const templateId = await createTemplate("Thanks!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    // Armed a month ago, so the freshness ceiling is the only thing left to
    // catch a stale inquiry.
    setArmedAt("inquiry_ack", Date.now() - 30 * DAY);

    const stale = await createInquiry();
    setBookingCreatedAt(stale, Date.now() - (ACK_MAX_AGE_HOURS + 2) * HOUR);
    expect((await runVendorAutomationSweep()).acknowledged).toBe(0);
    expect(runs().length).toBe(0);
  });

  test("a vendor who already answered by hand is not followed by a robot", async () => {
    resetState();
    const templateId = await createTemplate("Thanks!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    const bookingId = await createInquiry();
    insertMessage({
      bookingId,
      senderKind: "vendor",
      senderUserId: null,
      body: "Yes, that date is open, let me send you the package.",
    });

    expect((await runVendorAutomationSweep()).acknowledged).toBe(0);
    expect(runs().length).toBe(0);
  });

  test("a template deleted after arming disarms the send rather than mailing an empty message", async () => {
    resetState();
    const templateId = await createTemplate("Thanks!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    await req("DELETE", `/api/vendor/message-templates/${templateId}`, undefined, {
      token: vendorToken,
    });
    await createInquiry();

    expect((await runVendorAutomationSweep()).acknowledged).toBe(0);
    expect(emailLog("vendor_auto_reply").length).toBe(0);
  });
});

// ── 2. Unanswered-lead reminder ─────────────────────────────────────────────

describe("vendor automations: the unanswered-lead reminder", () => {
  test("fires on the SAME condition vendorAttention calls unanswered, and goes to the vendor", async () => {
    resetState();
    await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: REMINDER_DELAY_MIN_HOURS,
    });
    const bookingId = await createInquiry();
    // The vendor opened it, so the verdict is `unanswered` rather than
    // `unopened`, which is the branch this case is about.
    await markSeen(bookingId);

    // Inside the reply window nothing is wrong yet, and the automation agrees
    // with the band rather than with a clock of its own.
    const early = Date.now() + (REMINDER_DELAY_MIN_HOURS - 2) * HOUR;
    expect(attentionNow(bookingId, early)).toBeNull();
    expect((await runVendorAutomationSweep(early)).reminded).toBe(0);

    const late = Date.now() + (REMINDER_DELAY_MIN_HOURS + 2) * HOUR;
    const verdict = attentionNow(bookingId, late);
    expect(verdict?.key).toBe("unanswered");
    expect((await runVendorAutomationSweep(late)).reminded).toBe(1);

    // TO THE VENDOR, never to the couple.
    const sent = emailLog("vendor_lead_reminder");
    expect(sent.length).toBe(1);
    expect(sent[0]?.to_email).toBe(vendorEmail);
    expect(emailLog("vendor_auto_reply").length).toBe(0);

    // The occurrence is the WAIT, named by the stamp the derivation itself
    // says the wait started at.
    const runRows = runs();
    expect(runRows[0]?.dedupe_key).toBe(
      automationDedupeKey("unanswered_reminder", bookingId, verdict?.since),
    );

    // Same tick, same occurrence, nothing more.
    expect((await runVendorAutomationSweep(late)).reminded).toBe(0);
    expect(emailLog("vendor_lead_reminder").length).toBe(1);
  });

  test("a lead nobody has even opened is the same wait, and earns the same reminder", async () => {
    resetState();
    await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: REMINDER_DELAY_MIN_HOURS,
    });
    const bookingId = await createInquiry();

    // The band calls this one `unopened`, the other rung of the same ladder:
    // the ball is in the vendor's court and nobody has picked it up. A reminder
    // that fired only on `unanswered` would go silent on exactly the lead that
    // most needs it.
    const late = Date.now() + (REMINDER_DELAY_MIN_HOURS + 2) * HOUR;
    const verdict = attentionNow(bookingId, late);
    expect(verdict?.key).toBe("unopened");
    expect((await runVendorAutomationSweep(late)).reminded).toBe(1);

    // Opening it later moves the verdict to `unanswered` without moving the
    // stamp the wait started at, so the occurrence is the same one and the
    // vendor is not reminded twice for reading their own inbox.
    await markSeen(bookingId);
    const later = late + HOUR;
    expect(attentionNow(bookingId, later)?.key).toBe("unanswered");
    expect(attentionNow(bookingId, later)?.since).toBe(verdict?.since ?? 0);
    expect((await runVendorAutomationSweep(later)).reminded).toBe(0);
    expect(emailLog("vendor_lead_reminder").length).toBe(1);
  });

  test("a NEW wait is a new occurrence and earns its own reminder", async () => {
    resetState();
    await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: REMINDER_DELAY_MIN_HOURS,
    });
    const bookingId = await createInquiry();
    await markSeen(bookingId);
    const first = Date.now() + (REMINDER_DELAY_MIN_HOURS + 1) * HOUR;
    expect((await runVendorAutomationSweep(first)).reminded).toBe(1);

    // The vendor answers, the couple comes back: the ball moves twice and the
    // wait restarts, which is a different thing to be reminded about.
    insertMessage({
      bookingId,
      senderKind: "vendor",
      senderUserId: null,
      body: "Sorry for the delay, here is the package.",
      at: first + HOUR,
    });
    insertMessage({
      bookingId,
      senderKind: "couple",
      senderUserId: null,
      body: "Thanks. Can you hold the date?",
      at: first + 2 * HOUR,
    });
    const second = first + (2 + REMINDER_DELAY_MIN_HOURS + 1) * HOUR;
    expect(attentionNow(bookingId, second)?.key).toBe("unanswered");
    expect((await runVendorAutomationSweep(second)).reminded).toBe(1);
    expect(emailLog("vendor_lead_reminder").length).toBe(2);
    expect(runs().length).toBe(2);
    expect(runs()[0]?.dedupe_key).not.toBe(runs()[1]?.dedupe_key);
  });

  test("an automatic acknowledgement is not a reply, so the lead is still owed one", async () => {
    resetState();
    const templateId = await createTemplate("Thanks, we will get back to you shortly.");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: REMINDER_DELAY_MIN_HOURS,
    });
    const bookingId = await createInquiry();

    expect((await runVendorAutomationSweep()).acknowledged).toBe(1);
    // Opened, so the only thing that could still silence the band is a reply.
    await markSeen(bookingId);
    const late = Date.now() + (REMINDER_DELAY_MIN_HOURS + 2) * HOUR;

    // Taken at face value the ack IS a vendor message, and reading it as one
    // would silence the reminder forever by the machine's own courtesy. So the
    // exclusion lives in the SHARED fact gathering (`messageEdgesFor` skips any
    // message the engine authored), not in this module: the clients list, the
    // client detail CTA and this mail all have to agree that no PERSON has
    // replied yet, or the vendor gets a reminder about a lead their own screen
    // calls settled.
    expect(attentionNow(bookingId, late)?.key).toBe("unanswered");
    expect(correctedAttention(bookingId, late)?.key).toBe("unanswered");

    expect((await runVendorAutomationSweep(late)).reminded).toBe(1);
    expect(emailLog("vendor_lead_reminder").length).toBe(1);

    // A HUMAN reply does silence it: a second wait never starts.
    insertMessage({
      bookingId,
      senderKind: "vendor",
      senderUserId: null,
      body: "Here are the details.",
      at: late,
    });
    const later = late + 5 * DAY;
    expect((await runVendorAutomationSweep(later)).reminded).toBe(0);
  });

  test("a snoozed lead goes quiet in the mail too", async () => {
    resetState();
    await putAutomation("unanswered_reminder", {
      enabled: true,
      delay_hours: REMINDER_DELAY_MIN_HOURS,
    });
    const bookingId = await createInquiry();
    const snooze = await req(
      "POST",
      `/api/vendor/clients/${bookingId}/snooze`,
      {},
      { token: vendorToken },
    );
    expect(snooze.status).toBe(200);

    // `vendorAttention` returns null for a snoozed row, and the automation has
    // no second opinion to fall back on.
    const late = Date.now() + (REMINDER_DELAY_MIN_HOURS + 2) * HOUR;
    expect(attentionNow(bookingId, late)).toBeNull();
    expect((await runVendorAutomationSweep(late)).reminded).toBe(0);
  });
});

// ── 3. Post-wedding review request ──────────────────────────────────────────

describe("vendor automations: the review request", () => {
  async function confirmedPastWedding(): Promise<number> {
    const bookingId = await createInquiry(isoDaysFromNow(-(REVIEW_DUE_DAYS + 2)));
    db.prepare("UPDATE supplier_bookings SET status = 'confirmed' WHERE id = ?").run(bookingId);
    return bookingId;
  }

  test("queues for approval instead of sending, and one wedding is asked about once", async () => {
    resetState();
    await putAutomation("review_request", { enabled: true });
    const bookingId = await confirmedPastWedding();

    expect(attentionNow(bookingId, Date.now())?.key).toBe("review_due");
    const swept = await runVendorAutomationSweep();
    expect(swept.proposed).toBe(1);
    // NOTHING left the building. Asking a couple for stars in a vendor's name
    // is a reputational act, so it waits for a human click.
    expect(emailLog("vendor_review_request").length).toBe(0);

    const view = await getAutomations();
    expect(view.data.proposals.length).toBe(1);
    const proposal = view.data.proposals[0];
    expect(proposal?.status).toBe("proposed");
    expect(proposal?.booking_id).toBe(bookingId);
    expect(proposal?.couple_name).toBe("Mia & Lucas");

    // A second sweep re-proposes nothing.
    expect((await runVendorAutomationSweep()).proposed).toBe(0);
    expect(runs().length).toBe(1);

    const approved = await req<VendorAutomationsView>(
      "POST",
      `/api/vendor/automations/proposals/${proposal?.id}/approve`,
      {},
      { token: vendorToken },
    );
    expect(approved.status).toBe(200);
    const mails = emailLog("vendor_review_request");
    expect(mails.length).toBe(1);
    expect(mails[0]?.to_email).toBe(coupleEmail);
    expect(approved.data.proposals.length).toBe(0);
    expect(approved.data.recent.some((r) => r.status === "approved")).toBe(true);

    // Double-clicking Approve cannot send twice.
    const again = await req(
      "POST",
      `/api/vendor/automations/proposals/${proposal?.id}/approve`,
      {},
      { token: vendorToken },
    );
    expect(again.status).toBe(409);
    expect(emailLog("vendor_review_request").length).toBe(1);
  });

  test("dismissing sends nothing and never re-asks", async () => {
    resetState();
    await putAutomation("review_request", { enabled: true });
    await confirmedPastWedding();
    await runVendorAutomationSweep();
    const view = await getAutomations();
    const proposalId = view.data.proposals[0]?.id;

    const dismissed = await req<VendorAutomationsView>(
      "POST",
      `/api/vendor/automations/proposals/${proposalId}/dismiss`,
      {},
      { token: vendorToken },
    );
    expect(dismissed.status).toBe(200);
    expect(dismissed.data.proposals.length).toBe(0);
    expect(emailLog("vendor_review_request").length).toBe(0);

    // The occurrence stays consumed, so the sweep does not re-queue it.
    expect((await runVendorAutomationSweep()).proposed).toBe(0);
  });

  test("a foreign run id is a 404, not a 403", async () => {
    resetState();
    const r = await req(
      "POST",
      "/api/vendor/automations/proposals/999999/approve",
      {},
      {
        token: vendorToken,
      },
    );
    expect(r.status).toBe(404);
  });
});

// ── Suppression, plan and sender ────────────────────────────────────────────

describe("vendor automations: who is written to, and from where", () => {
  test("a suppressed address is refused by the dispatcher, and the in-app copy still lands", async () => {
    resetState();
    // The address asked us, in writing, to stop. That answer covers every
    // automated surface, including one a vendor armed on their own.
    addOptOut(coupleEmail, "do_not_contact");

    const templateId = await createTemplate("Thanks for getting in touch!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    const bookingId = await createInquiry();
    await runVendorAutomationSweep();

    const mails = emailLog("vendor_auto_reply");
    expect(mails.length).toBe(1);
    // Never delivered, and the log says why rather than going silent.
    expect(mails[0]?.status).toBe("skipped_opt_out");

    const runRows = runs();
    expect(runRows[0]?.status).toBe("skipped");
    expect(runRows[0]?.detail).toBe("opted_out");

    // Suppression is about EMAIL. The thread message is still there, because
    // the couple can read it in the app and nothing was mailed to say so.
    expect(await vendorThreadMessageCount(bookingId)).toBe(1);
  });

  test("a FREE vendor is refused, keeps their configured text, and their automations are parked", async () => {
    resetState();
    const templateId = await createTemplate("Thanks for getting in touch!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    // The inquiry has to arrive while the vendor can still take direct
    // bookings; the point of the case is what happens to the AUTOMATION when
    // the plan lapses under it.
    await createInquiry();

    // A lapse. There is no endpoint for this: losing the subscription is what
    // produces it in production, and the derived plan is what the gate reads.
    db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(vendorAccountId);

    const refused = await putAutomation("inquiry_ack", { enabled: false });
    expect(refused.status).toBe(403);
    expect(errorCode(refused.data)).toBe("vendor_pro_required");

    // The read stays open, and NOTHING was deleted: the switch position and the
    // words they wrote are exactly where they left them.
    const view = await getAutomations();
    expect(view.status).toBe(200);
    expect(view.data.plan).toBe("free");
    const ack = view.data.automations.find((a) => a.key === "inquiry_ack");
    expect(ack?.enabled).toBe(true);
    expect(ack?.template_id).toBe(templateId);

    // Parked, not running: an armed automation on a lapsed account sends nothing.
    expect((await runVendorAutomationSweep()).acknowledged).toBe(0);
    expect(emailLog("vendor_auto_reply").length).toBe(0);

    // And it resumes untouched when the plan comes back.
    initVendorBilling(vendorAccountId, "EUR");
    expect((await runVendorAutomationSweep()).acknowledged).toBe(1);
  });

  test("these are automatic sends, so they keep the automatic mailbox", async () => {
    resetState();
    for (const kind of [
      "vendor_auto_reply",
      "vendor_lead_reminder",
      "vendor_review_request",
    ] as const) {
      // No automation belongs in ADMIN_CONSOLE_KINDS: nobody composes these by
      // hand from /app/admin, a timer fires them.
      expect(senderForKind(kind)).toBe("default");
    }

    const templateId = await createTemplate("Thanks for getting in touch!");
    await putAutomation("inquiry_ack", { enabled: true, template_id: templateId });
    await createInquiry();
    await runVendorAutomationSweep();

    const mails = emailLog("vendor_auto_reply");
    expect(mails.length).toBe(1);
    expect(mails[0]?.from_email).toBe(CONFIG.emailFrom);
    expect(mails[0]?.from_email).not.toBe(CONFIG.emailFromAdmin);
  });

  test("the endpoints are vendor-only", async () => {
    resetState();
    const { token } = await bootstrapCouple("outsider-autom@weddly.test");
    const r = await req("GET", "/api/vendor/automations", undefined, { token });
    expect(r.status).toBe(403);
    const anon = await req("GET", "/api/vendor/automations");
    expect(anon.status).toBe(401);
  });
});
