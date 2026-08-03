// Vendor automations: the engine behind the three switches at
// /vendor/settings/automations.
//
// The shape of this module is deliberate and mirrors the points engine: the
// TRIGGER RULES live somewhere else (`shared/vendor_next_action.ts`), the facts
// are gathered by the code that already gathers them (`clientSignalsForBookings`
// in domain/vendor_clients.ts), and what is left here is only "which occurrence
// has not been handled yet, and what does handling it look like".
//
// Rules worth not re-deriving:
//
//   * NOTHING here re-decides what "unanswered" or "review due" means. Both
//     come out of `vendorAttention`, the same call the vendor's own attention
//     band renders from, so an email can never arrive about a lead the vendor's
//     screen says is fine. Every automation-layer constant in this file is a
//     NARROWING on top of that verdict (a longer wait, a freshness ceiling),
//     never a second opinion about the same booking.
//
//   * AN AUTOMATIC ACKNOWLEDGEMENT IS NOT A REPLY. The ack writes a real
//     `booking_messages` row so the vendor and the couple both see it, which
//     would otherwise silence the unanswered rule the moment both automations
//     are on: `last_vendor_message_at` would be non-null and the lead would read
//     as "awaiting the couple". `lastHumanVendorMessageAt` is the correction,
//     and it is the one place the two modules' facts differ on purpose.
//
//   * NOTHING IS RETROACTIVE. `armed_at` is the floor for the two automations
//     that send on their own, so switching one on cannot answer a month of
//     inquiries or mail a burst of reminders about leads the vendor already
//     handled by hand. The review request needs no such floor: it sends nothing
//     without a human click, so its queue can safely reach back.
//
//   * THE DEDUPE KEY NAMES THE OCCURRENCE, and reserving it is what authorises
//     the send. `INSERT OR IGNORE` returning `changes === 1` is the permission
//     slip; a worker restart, a double tick and a manual replay all lose the
//     race to the same unique index. The reservation happens BEFORE the mail,
//     because a crash mid-send must cost one message, never produce a loop that
//     mails the same couple every minute.
//
//   * PRO gates the whole engine, and a lapse PARKS it. The sweep skips a FREE
//     account and the routes refuse its writes, but nothing is disabled and
//     nothing is deleted: the switch position, the chosen template and the delay
//     are all still there when the subscription comes back.

import {
  ACK_MAX_AGE_HOURS,
  AUTOMATION_ACTIVITY_LIMIT,
  AUTOMATION_ATTENTION,
  automationDedupeKey,
  canArm,
  clampDelayHours,
  CLOSED_AUTOMATION_STATUSES,
  defaultAutomation,
  OPEN_AUTOMATION_STATUSES,
  type VendorAutomation,
  type VendorAutomationKey,
  type VendorAutomationRun,
  type VendorAutomationStatus,
  type VendorAutomationsView,
  VENDOR_AUTOMATION_KEYS,
} from "@shared/vendor_automations";
import { applyTemplateVars } from "@shared/booking_messages";
import { vendorPublicId } from "@shared/vendor_slug";
import type { VendorAttention, VendorClientSignals } from "@shared/vendor_next_action";
import { vendorAttention } from "@shared/vendor_next_action";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { insertMessage } from "./booking_messages";
import { sendKind } from "./emails/send";
import { getListingByVendorAccountId } from "./listings";
import { insertCoupleNotification } from "./notifications";
import type { BookingRow } from "./supplier_bookings";
import { clientSignalsForBookings, vendorPlanForAccount } from "./vendor_clients";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How far back the review queue reaches when a vendor first switches it on.
 *
 * `review_due` has no upper bound of its own (a confirmed booking from two
 * years ago with no review still reads as due, forever, and correctly so for a
 * band the vendor scrolls). Asking a couple for stars two years after the fact
 * is a different matter, so the automation narrows it. This is a policy on top
 * of the verdict, never a redefinition of it.
 */
const REVIEW_PROPOSAL_MAX_AGE_DAYS = 90;

/** Burst guards, per account per sweep. The `armed_at` floor already bounds the
 *  reminder to genuinely new waits; this is the second belt, so a pathological
 *  account can never emit a page of mail in one tick. */
const MAX_ACKS_PER_SWEEP = 10;
const MAX_REMINDERS_PER_SWEEP = 5;
const MAX_PROPOSALS_PER_SWEEP = 10;

/** Statuses a live lead can be in. Narrower than the queue's, on purpose: an
 *  acknowledgement belongs to an inquiry, and a booking an admin created as
 *  `confirmed` was never a question anyone asked. */
const OPEN_BOOKING_STATUSES = ["requested", "vendor_seen"] as const;

/**
 * The line appended to an automatic message so nobody is surprised by words in
 * their name. Rendered in the COUPLE's language, because the couple is who the
 * message is addressed to; the vendor reads the same row in their own thread
 * and sees the same mark.
 *
 * Kept next to the send rather than in the locale tree: this is stored text on
 * a message row, not UI copy, so it must not change retroactively when someone
 * edits a translation.
 */
const AUTO_NOTE: Record<string, string> = {
  hu: "(Automatikus válasz.)",
  en: "(Sent automatically.)",
  es: "(Enviado automáticamente.)",
};

function autoNoteFor(locale: string | null): string {
  return AUTO_NOTE[locale ?? "en"] ?? AUTO_NOTE.en ?? "(Sent automatically.)";
}

// ── Rows ────────────────────────────────────────────────────────────────────

interface AutomationRow {
  id: number;
  vendor_account_id: number;
  automation_key: string;
  enabled: number;
  template_id: number | null;
  delay_hours: number | null;
  armed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: number;
  vendor_account_id: number;
  automation_key: string;
  booking_id: number | null;
  dedupe_key: string;
  status: string;
  detail: string | null;
  message_id: number | null;
  created_at: number;
  resolved_at: number | null;
}

function toAutomation(row: AutomationRow): VendorAutomation {
  return {
    key: row.automation_key as VendorAutomationKey,
    enabled: row.enabled === 1,
    template_id: row.template_id,
    delay_hours: row.delay_hours,
    armed_at: row.armed_at,
    updated_at: row.updated_at,
  };
}

function toRun(row: RunRow, coupleName: string, eventDate: string): VendorAutomationRun {
  return {
    id: row.id,
    key: row.automation_key as VendorAutomationKey,
    booking_id: row.booking_id,
    couple_name: coupleName,
    event_date: eventDate,
    status: row.status as VendorAutomationStatus,
    detail: row.detail,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  };
}

// ── Configuration ───────────────────────────────────────────────────────────

/** Every automation for an account, in the canonical order, with the resting
 *  state filled in for the ones nobody has touched. An absent row is not a
 *  missing feature, it is the default: OFF. */
export function listAutomations(accountId: number): VendorAutomation[] {
  const rows = db
    .prepare("SELECT * FROM vendor_automations WHERE vendor_account_id = ?")
    .all(accountId) as AutomationRow[];
  const byKey = new Map(rows.map((r) => [r.automation_key, toAutomation(r)]));
  const ts = now();
  return VENDOR_AUTOMATION_KEYS.map((key) => byKey.get(key) ?? defaultAutomation(key, ts));
}

function getAutomationRow(accountId: number, key: VendorAutomationKey): AutomationRow | null {
  return (
    (db
      .prepare(
        "SELECT * FROM vendor_automations WHERE vendor_account_id = ? AND automation_key = ?",
      )
      .get(accountId, key) as AutomationRow | undefined) ?? null
  );
}

export interface AutomationPatch {
  enabled?: boolean;
  /** `null` clears the chosen template, which also disarms the acknowledgement.  */
  template_id?: number | null;
  delay_hours?: number;
}

/**
 * Partial by contract, exactly like the community-supplier PATCH: an absent key
 * means "leave it alone". A body about the delay must not silently disarm the
 * switch, and a body about the switch must not blank the text.
 *
 * Two invariants are enforced here rather than trusted from the client:
 *   - an automation that `canArm` says is incomplete cannot be enabled, so the
 *     acknowledgement stays off until the vendor has written the words;
 *   - `armed_at` moves only on an OFF → ON transition, so re-saving the delay
 *     of a running automation does not re-open the retroactivity window.
 */
export function saveAutomation(
  accountId: number,
  key: VendorAutomationKey,
  patch: AutomationPatch,
): VendorAutomation {
  const ts = now();
  const current = getAutomationRow(accountId, key);
  const wasEnabled = current?.enabled === 1;

  const templateId =
    patch.template_id === undefined ? (current?.template_id ?? null) : patch.template_id;
  const delayHours =
    key === "unanswered_reminder"
      ? patch.delay_hours === undefined
        ? (current?.delay_hours ?? defaultAutomation(key, ts).delay_hours)
        : clampDelayHours(patch.delay_hours)
      : null;
  const enabled = patch.enabled === undefined ? wasEnabled : patch.enabled;

  if (enabled && !canArm({ key, template_id: templateId })) {
    throw new HttpError(400, "This automation needs its message text first", {
      code: "automation_needs_body",
    });
  }
  // A template that is present but empty is the same failure one step later:
  // the picker offered a canned reply whose body the vendor cleared.
  if (enabled && key === "inquiry_ack" && templateBody(accountId, templateId) === null) {
    throw new HttpError(400, "This automation needs its message text first", {
      code: "automation_needs_body",
    });
  }

  const armedAt = enabled
    ? wasEnabled
      ? (current?.armed_at ?? ts)
      : ts
    : (current?.armed_at ?? null);

  db.prepare(
    `INSERT INTO vendor_automations
       (vendor_account_id, automation_key, enabled, template_id, delay_hours, armed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(vendor_account_id, automation_key) DO UPDATE SET
       enabled = excluded.enabled,
       template_id = excluded.template_id,
       delay_hours = excluded.delay_hours,
       armed_at = excluded.armed_at,
       updated_at = excluded.updated_at`,
  ).run(accountId, key, enabled ? 1 : 0, templateId, delayHours, armedAt, ts, ts);

  const row = getAutomationRow(accountId, key);
  if (!row) throw new HttpError(500, "Automation save failed");
  return toAutomation(row);
}

/** The vendor's own canned-reply body, or null when there is nothing usable.
 *  Re-read before every send: a deleted or emptied template must disarm the
 *  acknowledgement, never send a blank message signed by the vendor. */
function templateBody(accountId: number, templateId: number | null): string | null {
  if (templateId === null) return null;
  const row = db
    .prepare("SELECT body FROM vendor_message_templates WHERE id = ? AND vendor_account_id = ?")
    .get(templateId, accountId) as { body: string } | undefined;
  const body = row?.body.trim() ?? "";
  return body.length > 0 ? body : null;
}

// ── Activity + proposals ────────────────────────────────────────────────────

interface RunJoinRow extends RunRow {
  couple_name: string | null;
  event_date: string | null;
}

function runsForAccount(accountId: number, statuses: string[], limit: number): RunJoinRow[] {
  const placeholders = statuses.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT r.*, c.display_name AS couple_name, b.event_date AS event_date
         FROM vendor_automation_runs r
         LEFT JOIN supplier_bookings b ON b.id = r.booking_id
         LEFT JOIN couples c ON c.id = b.couple_id
        WHERE r.vendor_account_id = ?
          AND r.status IN (${placeholders})
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`,
    )
    .all(accountId, ...statuses, limit) as RunJoinRow[];
}

function mapRuns(rows: RunJoinRow[]): VendorAutomationRun[] {
  return rows.map((r) => toRun(r, r.couple_name ?? "", r.event_date ?? ""));
}

/** The whole settings payload in one read. */
export function buildAutomationsView(accountId: number): VendorAutomationsView {
  return {
    plan: vendorPlanForAccount(accountId),
    automations: listAutomations(accountId),
    proposals: mapRuns(
      runsForAccount(accountId, [...OPEN_AUTOMATION_STATUSES], AUTOMATION_ACTIVITY_LIMIT),
    ),
    recent: mapRuns(
      runsForAccount(accountId, [...CLOSED_AUTOMATION_STATUSES], AUTOMATION_ACTIVITY_LIMIT),
    ),
  };
}

function getOwnedRun(accountId: number, runId: number): RunRow {
  const row = db.prepare("SELECT * FROM vendor_automation_runs WHERE id = ?").get(runId) as
    | RunRow
    | undefined;
  // 404 rather than 403 on a foreign row, matching getOwnedBooking: run ids
  // must not be probeable across vendor accounts.
  if (!row || row.vendor_account_id !== accountId) {
    throw new HttpError(404, "Automation run not found", { code: "automation_run_not_found" });
  }
  return row;
}

/** Move a proposal to its terminal status. Only a row that is still `proposed`
 *  can transition, so a double-clicked Approve cannot send twice. */
function resolveProposal(
  accountId: number,
  runId: number,
  status: "approved" | "dismissed",
): RunRow {
  const row = getOwnedRun(accountId, runId);
  if (row.status !== "proposed") {
    throw new HttpError(409, "This request has already been answered", {
      code: "automation_already_resolved",
    });
  }
  const info = db
    .prepare(
      "UPDATE vendor_automation_runs SET status = ?, resolved_at = ? WHERE id = ? AND status = 'proposed'",
    )
    .run(status, now(), runId);
  if (info.changes !== 1) {
    throw new HttpError(409, "This request has already been answered", {
      code: "automation_already_resolved",
    });
  }
  return { ...row, status, resolved_at: now() };
}

/** The vendor said yes: the review request goes out now, in their name, because
 *  they clicked. */
export async function approveProposal(accountId: number, runId: number): Promise<void> {
  const row = resolveProposal(accountId, runId, "approved");
  if (row.booking_id === null) return;
  const booking = getBookingRow(row.booking_id);
  if (!booking) return;
  await sendReviewRequest(accountId, booking, row.id);
}

/** The vendor said no. Nothing is sent, and the occurrence stays consumed, so
 *  the couple is never asked twice about one wedding. */
export function dismissProposal(accountId: number, runId: number): void {
  resolveProposal(accountId, runId, "dismissed");
}

// ── Facts ───────────────────────────────────────────────────────────────────

function getBookingRow(bookingId: number): BookingRow | null {
  return (
    (db.prepare("SELECT * FROM supplier_bookings WHERE id = ?").get(bookingId) as
      | BookingRow
      | undefined) ?? null
  );
}

/**
 * Newest vendor message per booking that a HUMAN wrote.
 *
 * The correction described in the module header. Every message this engine
 * writes is recorded on its run row, so "did the machine write it?" is a join,
 * not a flag on somebody else's table.
 */
export function lastHumanVendorMessageAt(bookingIds: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (bookingIds.length === 0) return out;
  const placeholders = bookingIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT m.booking_id AS booking_id, MAX(m.created_at) AS last_at
         FROM booking_messages m
        WHERE m.booking_id IN (${placeholders})
          AND m.sender_kind = 'vendor'
          AND m.id NOT IN (
                SELECT message_id FROM vendor_automation_runs WHERE message_id IS NOT NULL
              )
        GROUP BY m.booking_id`,
    )
    .all(...bookingIds) as { booking_id: number; last_at: number }[];
  for (const r of rows) out.set(r.booking_id, r.last_at);
  return out;
}

/**
 * Signals for the sweep: the existing gatherer, with the one deliberate
 * override. Reusing `clientSignalsForBookings` is what keeps the automation and
 * the vendor's own screen reading the same booking the same way; the override is
 * the single documented difference, and it is a difference of FACT ("has a
 * person replied?"), never of rule.
 */
function sweepSignals(accountId: number, rows: BookingRow[]): Map<number, VendorClientSignals> {
  const signals = clientSignalsForBookings(accountId, rows);
  const human = lastHumanVendorMessageAt(rows.map((r) => r.id));
  for (const [id, s] of signals) {
    signals.set(id, { ...s, last_vendor_message_at: human.get(id) ?? null });
  }
  return signals;
}

function attentionFor(
  signals: Map<number, VendorClientSignals>,
  bookingId: number,
  nowMs: number,
): VendorAttention | null {
  const s = signals.get(bookingId);
  return s ? vendorAttention(s, nowMs) : null;
}

// ── Recipients ──────────────────────────────────────────────────────────────

interface Recipient {
  id: number;
  email: string;
  full_name: string;
  locale: string | null;
}

function coupleOwner(coupleId: number): Recipient | null {
  return (
    (db
      .prepare(
        `SELECT u.id AS id, u.email AS email, COALESCE(u.full_name, '') AS full_name, u.locale AS locale
           FROM couples c JOIN users u ON u.id = c.partner_a_id
          WHERE c.id = ?`,
      )
      .get(coupleId) as Recipient | undefined) ?? null
  );
}

function vendorOwner(accountId: number): Recipient | null {
  return (
    (db
      .prepare(
        `SELECT u.id AS id, u.email AS email, COALESCE(u.full_name, '') AS full_name, u.locale AS locale
           FROM vendor_accounts v JOIN users u ON u.id = v.owner_user_id
          WHERE v.id = ?`,
      )
      .get(accountId) as Recipient | undefined) ?? null
  );
}

function coupleName(coupleId: number): string {
  const row = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(coupleId) as
    | { display_name: string }
    | undefined;
  return row?.display_name ?? "";
}

/** The vendor's public card. `getListingByVendorAccountId(...).id` is the ONLY
 *  correct source for a listing id: `v<accountId>` is a guess that is wrong for
 *  every claimed listing, which is most of them. */
function vendorListing(accountId: number): { id: string; name: string } | null {
  const listing = getListingByVendorAccountId(accountId);
  return listing ? { id: listing.id, name: listing.name } : null;
}

// ── The dedupe reservation ──────────────────────────────────────────────────

/**
 * Claim an occurrence. Returns the new run id, or null when this occurrence was
 * already handled by an earlier tick, another process, or a replay.
 *
 * This is the ONLY authorisation to send. Reserving before the mail rather than
 * after is a deliberate trade: a crash between the two costs one message, while
 * the opposite order costs the recipient one message per tick forever.
 */
function reserveRun(args: {
  accountId: number;
  key: VendorAutomationKey;
  bookingId: number;
  dedupeKey: string;
  status: VendorAutomationStatus;
}): number | null {
  const ts = now();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO vendor_automation_runs
         (vendor_account_id, automation_key, booking_id, dedupe_key, status, detail, message_id, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
    )
    .run(args.accountId, args.key, args.bookingId, args.dedupeKey, args.status, ts);
  if (info.changes !== 1) return null;
  return Number(info.lastInsertRowid);
}

function markRunSkipped(runId: number, detail: string): void {
  db.prepare(
    "UPDATE vendor_automation_runs SET status = 'skipped', detail = ?, resolved_at = ? WHERE id = ?",
  ).run(detail, now(), runId);
}

function attachMessage(runId: number, messageId: number): void {
  db.prepare("UPDATE vendor_automation_runs SET message_id = ? WHERE id = ?").run(messageId, runId);
}

/** Fold the dispatcher's verdict back onto the run row. A suppressed address
 *  keeps the occurrence CONSUMED (never retry a tombstone every minute) but
 *  records the truth, so "why did nothing arrive?" has an answer. */
function recordSendResult(runId: number, status: string): void {
  if (status === "skipped_opt_out") markRunSkipped(runId, "opted_out");
  else if (status === "failed") markRunSkipped(runId, "send_failed");
}

// ── 1. Instant acknowledgement ──────────────────────────────────────────────

/**
 * Inquiries that may still be acknowledged: young, still open, landed after the
 * vendor armed the automation, and not already answered by a human. The last
 * one matters, a vendor who replied within the minute must not be followed by a
 * robot saying they will be in touch.
 */
function ackCandidates(accountId: number, armedAt: number, nowMs: number): BookingRow[] {
  const floor = Math.max(armedAt, nowMs - ACK_MAX_AGE_HOURS * HOUR_MS);
  const statuses = OPEN_BOOKING_STATUSES.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM supplier_bookings
        WHERE vendor_account_id = ?
          AND created_at >= ?
          AND status IN (${statuses})
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(accountId, floor, ...OPEN_BOOKING_STATUSES, MAX_ACKS_PER_SWEEP) as BookingRow[];
}

async function sendAcknowledgement(
  accountId: number,
  booking: BookingRow,
  body: string,
  listing: { id: string; name: string },
): Promise<boolean> {
  const owner = coupleOwner(booking.couple_id);
  if (!owner) return false;

  const runId = reserveRun({
    accountId,
    key: "inquiry_ack",
    bookingId: booking.id,
    dedupeKey: automationDedupeKey("inquiry_ack", booking.id),
    status: "sent",
  });
  if (runId === null) return false;

  const text = applyTemplateVars(body, {
    client_name: coupleName(booking.couple_id),
    event_date: booking.event_date,
    vendor_name: listing.name,
  });
  // The mark is part of the STORED message, which is what makes the automation
  // visible in the thread to both sides without a second channel to check.
  const messageBody = `${text}\n\n${autoNoteFor(owner.locale)}`;

  const messageId = insertMessage({
    bookingId: booking.id,
    senderKind: "vendor",
    senderUserId: null,
    body: messageBody,
  });
  attachMessage(runId, messageId);

  insertCoupleNotification({
    couple_id: booking.couple_id,
    kind: "vendor_message",
    data: { vendorName: listing.name },
    link: `/app/messages/${booking.id}`,
  });

  const result = await sendKind(
    "vendor_auto_reply",
    {
      vendorName: listing.name,
      bodyText: text,
      threadUrl: `/app/messages/${booking.id}`,
    },
    { user: owner, couple_id: booking.couple_id },
  );
  recordSendResult(runId, result.status);
  return true;
}

// ── 2. Unanswered-lead reminder ─────────────────────────────────────────────

/** Live leads worth evaluating. The verdict itself is `vendorAttention`'s; this
 *  only keeps the query off the archive. */
function openBookings(accountId: number): BookingRow[] {
  const statuses = OPEN_BOOKING_STATUSES.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM supplier_bookings
        WHERE vendor_account_id = ? AND status IN (${statuses})
        ORDER BY created_at ASC`,
    )
    .all(accountId, ...OPEN_BOOKING_STATUSES) as BookingRow[];
}

async function sendLeadReminder(
  accountId: number,
  booking: BookingRow,
  attention: VendorAttention,
): Promise<boolean> {
  const owner = vendorOwner(accountId);
  if (!owner) return false;

  const runId = reserveRun({
    accountId,
    key: "unanswered_reminder",
    bookingId: booking.id,
    dedupeKey: automationDedupeKey("unanswered_reminder", booking.id, attention.since),
    status: "sent",
  });
  if (runId === null) return false;

  const result = await sendKind(
    "vendor_lead_reminder",
    {
      coupleName: coupleName(booking.couple_id),
      eventDate: booking.event_date,
      waitingHours: attention.hours,
      clientUrl: `/vendor/clients/${booking.id}`,
    },
    { user: owner, couple_id: booking.couple_id },
  );
  recordSendResult(runId, result.status);
  return true;
}

// ── 3. Post-wedding review request ──────────────────────────────────────────

/** Confirmed bookings whose date has gone. The `review_due` verdict is still
 *  `vendorAttention`'s call; this is the freshness ceiling and the index-friendly
 *  half of the query. */
function pastWeddings(accountId: number, nowMs: number): BookingRow[] {
  const from = new Date(nowMs - REVIEW_PROPOSAL_MAX_AGE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT * FROM supplier_bookings
        WHERE vendor_account_id = ?
          AND status = 'confirmed'
          AND event_date >= ? AND event_date < ?
        ORDER BY event_date DESC`,
    )
    .all(accountId, from, today) as BookingRow[];
}

/** Queue the ask. NOTHING is sent here, by product decision: a review request
 *  goes out in the vendor's name, and the vendor clicks. */
function proposeReviewRequest(accountId: number, booking: BookingRow): boolean {
  return (
    reserveRun({
      accountId,
      key: "review_request",
      bookingId: booking.id,
      dedupeKey: automationDedupeKey("review_request", booking.id),
      status: "proposed",
    }) !== null
  );
}

async function sendReviewRequest(
  accountId: number,
  booking: BookingRow,
  runId: number,
): Promise<void> {
  const owner = coupleOwner(booking.couple_id);
  const listing = vendorListing(accountId);
  if (!owner || !listing) {
    markRunSkipped(runId, "no_recipient");
    return;
  }
  const result = await sendKind(
    "vendor_review_request",
    {
      vendorName: listing.name,
      eventDate: booking.event_date,
      // The pretty, name-prefixed public id, the same link the vendor hands out
      // themselves. `pathSupplierId` canonicalises it at the route boundary, so
      // a review written from here keys on the listing rather than the slug.
      reviewUrl: `${CONFIG.frontendBaseUrl}/vendors/${vendorPublicId(listing.id, listing.name)}?review=1`,
    },
    { user: owner, couple_id: booking.couple_id },
  );
  recordSendResult(runId, result.status);
}

// ── The sweep ───────────────────────────────────────────────────────────────

export interface AutomationSweepResult {
  acknowledged: number;
  reminded: number;
  proposed: number;
}

/** Accounts with at least one automation switched on. The sweep costs one
 *  indexed query when nobody has armed anything, which is the resting state. */
function armedAccountIds(): number[] {
  return (
    db
      .prepare("SELECT DISTINCT vendor_account_id AS id FROM vendor_automations WHERE enabled = 1")
      .all() as { id: number }[]
  ).map((r) => r.id);
}

/**
 * One pass over every armed vendor. Safe to call at any interval and safe to
 * call twice: every send is behind a dedupe reservation, so the second pass is
 * a no-op by construction rather than by luck.
 */
export async function runVendorAutomationSweep(
  nowMs: number = now(),
): Promise<AutomationSweepResult> {
  const result: AutomationSweepResult = { acknowledged: 0, reminded: 0, proposed: 0 };
  for (const accountId of armedAccountIds()) {
    // A lapse PARKS the automations. Nothing is disabled and nothing is
    // deleted; the sweep simply passes this account by until the plan is back.
    if (vendorPlanForAccount(accountId) !== "pro") continue;
    try {
      const perAccount = await sweepAccount(accountId, nowMs);
      result.acknowledged += perAccount.acknowledged;
      result.reminded += perAccount.reminded;
      result.proposed += perAccount.proposed;
    } catch (e) {
      // One broken account must never stop the others.
      log.warn("vendor_automations.account_failed", { account_id: accountId, error: String(e) });
    }
  }
  return result;
}

async function sweepAccount(accountId: number, nowMs: number): Promise<AutomationSweepResult> {
  const out: AutomationSweepResult = { acknowledged: 0, reminded: 0, proposed: 0 };
  const config = new Map(listAutomations(accountId).map((a) => [a.key, a]));
  const listing = vendorListing(accountId);

  const ack = config.get("inquiry_ack");
  if (ack?.enabled && ack.armed_at !== null && listing) {
    const body = templateBody(accountId, ack.template_id);
    // The template was deleted or emptied after arming. Silence is the only
    // correct answer: an empty auto-reply is worse than none.
    if (body !== null) {
      const candidates = ackCandidates(accountId, ack.armed_at, nowMs);
      const human = lastHumanVendorMessageAt(candidates.map((b) => b.id));
      for (const booking of candidates) {
        if (human.has(booking.id)) continue;
        if (await sendAcknowledgement(accountId, booking, body, listing)) out.acknowledged += 1;
      }
    }
  }

  const reminder = config.get("unanswered_reminder");
  if (reminder?.enabled && reminder.armed_at !== null) {
    const rows = openBookings(accountId);
    const signals = sweepSignals(accountId, rows);
    const delay = reminder.delay_hours ?? clampDelayHours(Number.NaN);
    let sent = 0;
    for (const booking of rows) {
      if (sent >= MAX_REMINDERS_PER_SWEEP) break;
      const attention = attentionFor(signals, booking.id, nowMs);
      // THE trigger: the same verdicts the vendor's own attention band draws.
      if (attention === null) continue;
      if (!AUTOMATION_ATTENTION.unanswered_reminder.includes(attention.key)) continue;
      // The vendor's own patience, which may exceed the queue's but never
      // undercut it (see REMINDER_DELAY_MIN_HOURS).
      if (attention.hours < delay) continue;
      // Not retroactive: only a wait that STARTED after they armed it.
      if (attention.since < reminder.armed_at) continue;
      if (await sendLeadReminder(accountId, booking, attention)) {
        out.reminded += 1;
        sent += 1;
      }
    }
  }

  const review = config.get("review_request");
  if (review?.enabled) {
    const rows = pastWeddings(accountId, nowMs);
    const signals = sweepSignals(accountId, rows);
    let queued = 0;
    for (const booking of rows) {
      if (queued >= MAX_PROPOSALS_PER_SWEEP) break;
      // Same rule as the band: `review_due` already knows about an existing
      // review, an overdue installment outranking it, and the snooze.
      const attention = attentionFor(signals, booking.id, nowMs);
      if (attention === null) continue;
      if (!AUTOMATION_ATTENTION.review_request.includes(attention.key)) continue;
      if (proposeReviewRequest(accountId, booking)) {
        out.proposed += 1;
        queued += 1;
      }
    }
  }

  return out;
}

// ── Worker ──────────────────────────────────────────────────────────────────

/** A minute. "Instant" acknowledgement is a poll, not a hook, because the
 *  inquiry can arrive down several paths (the couple's booking form, outreach
 *  delivery, an admin creating one) and a trigger wired into each of them is
 *  three places for the rule to go missing. A minute is inside the window a
 *  couple would call instant, and the query costs nothing when nothing is
 *  armed. */
const TICK_MS = 60_000;

export function startVendorAutomationWorker(): void {
  const tick = () => {
    void runVendorAutomationSweep()
      .then((r) => {
        if (r.acknowledged + r.reminded + r.proposed > 0) {
          log.info("vendor_automations.sweep", { ...r });
        }
      })
      .catch((e) => {
        // Never let a worker rejection kill the process: the next tick retries.
        log.warn("vendor_automations.sweep_failed", { error: String(e) });
      });
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
}
