// Supplier Outreach Inbox — Q3 (P2.E) domain helpers.
//
// Schema in `schema.sql` (outreach_campaigns / outreach_messages /
// outreach_replies, landed in a47199a as Q3 reservation). This module
// adds the v1 send + list + detail logic on top:
//
//   - createCampaign(couple, input) — validates input, throttles, inserts
//     the campaign + one message per supplier, fires the email (with the
//     couple owner's address as Reply-To so the vendor replies straight
//     into the couple's inbox).
//   - listCampaigns(coupleId) — the in-app /app/outreach index view.
//   - getCampaignDetail(coupleId, id) — campaign + messages + replies for
//     the detail pane. Cross-couple isolation enforced by the `coupleId`
//     filter so a leaked `id` can't surface another couple's outreach.
//
// Reply capture (the inbound webhook + reply archival) is v1.5 — for now
// the vendor replies to the couple's own email and the couple manages the
// thread in their own client. `reply_token` is still stamped on every
// message so the future inbound webhook can route without a migration.

import type { CreateOutreachCampaignInput } from "@shared/outreach";
import { isUiLocale, type UiLocale } from "@shared/locales";
import {
  OUTREACH_BODY_MAX_LEN,
  OUTREACH_MESSAGES_PER_WEEK_CAP,
  OUTREACH_SUBJECT_MAX_LEN,
  OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP,
  type OutreachCampaign,
  type OutreachCampaignDetail,
  type OutreachMessage,
  type OutreachMessageStatus,
  type OutreachReply,
} from "@shared/outreach";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { sendKind } from "./emails";
import { isOptedOut } from "./emails/optouts";
import type { SupplierOutreachMode } from "./emails/templates";
import { linkableListingCategories } from "./listings";
import { deliverInquiryFromOutreach, type DeliveredInquiry } from "./supplier_bookings";
import { isVendorEntitled } from "./vendor_billing";
import { localeForCountry, resolveListingCountry } from "./vendor_campaign";

/** Subset of `Couple` / `CoupleRow` the outreach send pipeline actually
 *  reads. Decoupled so the route handler can pass either shape without a
 *  conversion hop. */
export interface OutreachCouple {
  id: number;
  display_name: string;
}

// ── Validation + parsing ──────────────────────────────────────────────────

export function parseCreateInput(raw: unknown): CreateOutreachCampaignInput {
  if (!raw || typeof raw !== "object") {
    throw new HttpError(400, "Campaign body required");
  }
  const body = raw as Record<string, unknown>;
  const subject = parseStringField(body.subject, "subject", OUTREACH_SUBJECT_MAX_LEN);
  const bodyTemplate = parseStringField(body.body_template, "body_template", OUTREACH_BODY_MAX_LEN);
  const supplierIds = parseSupplierIds(body.supplier_ids);
  return { subject, body_template: bodyTemplate, supplier_ids: supplierIds };
}

function parseStringField(raw: unknown, field: string, maxLen: number): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, `${field} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new HttpError(400, `${field} cannot be empty`);
  }
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `${field} is too long (${trimmed.length} > ${maxLen})`);
  }
  return trimmed;
}

function parseSupplierIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "supplier_ids must be a non-empty array");
  }
  if (raw.length > OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP) {
    throw new HttpError(
      400,
      `Too many suppliers (max ${OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP} per campaign)`,
      { code: "supplier_cap_exceeded" },
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new HttpError(400, "supplier_ids entries must be strings");
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new HttpError(400, "supplier_ids entries cannot be empty");
    }
    if (trimmed.length > 80) {
      throw new HttpError(400, "supplier_id too long");
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

// ── Rate limiting ─────────────────────────────────────────────────────────

/** Throws 429 when this batch would push the couple past
 *  `OUTREACH_MESSAGES_PER_WEEK_CAP` RECIPIENTS in the last rolling 7 days.
 *  Counts DB rows directly so a restart doesn't reset the limit.
 *
 *  Counts messages, not campaigns: the supplier detail page's "Send inquiry"
 *  CTA composes to a single vendor, so a campaign-based cap punished the
 *  normal one-vendor-at-a-time flow (3 vendors a week) while letting a
 *  batched sender through with 5× the volume. See the constant's comment. */
function assertWithinWeeklyCap(coupleId: number, incoming: number): void {
  const sevenDaysAgo = now() - 7 * 24 * 60 * 60 * 1000;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM outreach_messages m
         JOIN outreach_campaigns c ON c.id = m.campaign_id
        WHERE c.couple_id = ? AND m.created_at >= ?`,
    )
    .get(coupleId, sevenDaysAgo) as { n: number };
  if (row.n + incoming > OUTREACH_MESSAGES_PER_WEEK_CAP) {
    throw new HttpError(
      429,
      `Outreach limit reached (max ${OUTREACH_MESSAGES_PER_WEEK_CAP} messages per 7 days)`,
      { code: "campaign_rate_limited" },
    );
  }
}

// ── Token + mappers ───────────────────────────────────────────────────────

/** 32-hex per-message reply token. Used in the Reply-To address (v1.5)
 *  for the inbound webhook; v1 stamps it ahead of time so the column is
 *  populated when reply capture lands. Bun.randomUUIDv7 isn't available
 *  pre-1.3; this gives the same ~128-bit non-guessability via crypto.
 */
function generateReplyToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface CampaignRow {
  id: number;
  couple_id: number;
  subject: string;
  body_template: string;
  created_at: number;
}

interface MessageRow {
  id: number;
  campaign_id: number;
  supplier_id: string;
  supplier_email: string;
  sent_at: number | null;
  status: string;
  reply_token: string;
  /** The `supplier_bookings` row this message was delivered into, or null when
   *  it was email-only (unclaimed listing). Also the idempotency key for the
   *  claim-time replay and the one-off backfill. */
  booking_id: number | null;
  created_at: number;
}

interface ReplyRow {
  id: number;
  message_id: number;
  from_email: string;
  body: string;
  received_at: number;
}

function toCampaign(row: CampaignRow, messageCount: number): OutreachCampaign {
  return {
    id: row.id,
    couple_id: row.couple_id,
    subject: row.subject,
    body_template: row.body_template,
    created_at: row.created_at,
    message_count: messageCount,
  };
}

function toMessageStatus(raw: string): OutreachMessageStatus {
  if (raw === "sent" || raw === "bounced" || raw === "replied") return raw;
  return "queued";
}

/** Has a HUMAN at the vendor answered, for a batch of delivered inquiries?
 *
 *  Derived on read rather than stamped, the same idiom as `quoteStatus` and
 *  `holdState`: `outreach_messages.status` records what the SEND did, and a
 *  reply is not an event the send can know about. Nothing has ever written
 *  `status='replied'` even though the enum, the pill and the copy for it have
 *  shipped in all five locales since v1, so a couple watched a frozen "Sent"
 *  chip on an inquiry the vendor had already answered.
 *
 *  An AUTOMATED acknowledgement is not a reply, and the exclusion is the same
 *  join `messageEdgesFor` uses in the vendor's own client list. A vendor with an
 *  auto-reply armed would otherwise show as "Replied" to the couple within
 *  seconds of every inquiry, which is precisely the lie the automation layer
 *  already refuses to tell on the vendor's side. One rule, both directions. */
function vendorRepliedBookingIds(bookingIds: number[]): Set<number> {
  if (bookingIds.length === 0) return new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT booking_id
         FROM booking_messages
        WHERE booking_id IN (${bookingIds.map(() => "?").join(",")})
          AND sender_kind = 'vendor'
          AND id NOT IN (
                SELECT message_id FROM vendor_automation_runs WHERE message_id IS NOT NULL
              )`,
    )
    .all(...bookingIds) as Array<{ booking_id: number }>;
  return new Set(rows.map((r) => r.booking_id));
}

function toMessage(
  row: MessageRow,
  supplierName: string,
  supplierCategory: string | null,
  /** The vendor has answered in the thread this inquiry became. Only ever true
   *  for an `in_account` delivery: an unclaimed listing replies to the couple's
   *  own mailbox and Weddly never sees it, so "no reply" here means "we cannot
   *  know", which is what the delivery label is there to say. */
  vendorReplied = false,
): OutreachMessage {
  const stored = toMessageStatus(row.status);
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    supplier_id: row.supplier_id,
    supplier_name: supplierName,
    supplier_category: supplierCategory,
    // `supplier_email` is deliberately NOT mapped out. The column stays (it is
    // the record of where the mail actually went, and the reply-routing key),
    // but a vendor's mailbox is never shown to a user (owner rule, 2026-07-31)
    // and this was the door that rule missed: the catalogue, the detail, the
    // contact endpoint and the public page were all closed, while the outreach
    // inbox read back the address of every vendor a couple had written to, five
    // per campaign, for as many campaigns as they cared to send. What the couple
    // needs from this row is WHERE it landed, and `delivery` already says that.
    sent_at: row.sent_at,
    // A reply only overrides a clean `sent`. A BOUNCE is a fact about this
    // message that a later thread cannot undo, and it is the one the couple has
    // to act on (the address is wrong), so it keeps the row.
    status: vendorReplied && stored === "sent" ? "replied" : stored,
    reply_token: row.reply_token,
    delivery: row.booking_id === null ? "email_only" : "in_account",
    // The inquiry this message became, so the row can open the conversation it
    // started. `delivery` is derived from this same column; the id is what the
    // couple needs to actually get there, and until now the outreach tab could
    // only send them back to the vendor's directory card. The couple owns this
    // booking, and `getCoupleBooking` re-authorises it at the thread route.
    booking_id: row.booking_id,
    created_at: row.created_at,
  };
}

function toReply(row: ReplyRow): OutreachReply {
  return {
    id: row.id,
    message_id: row.message_id,
    from_email: row.from_email,
    body: row.body,
    received_at: row.received_at,
  };
}

// ── Create ────────────────────────────────────────────────────────────────

interface SupplierContact {
  id: string;
  name: string;
  email: string;
  /** `listings.source` — 'curated' | 'community' | 'claimed'. Feeds the
   *  country → language resolution for the outbound mail. */
  source: string;
  city: string;
  /** Non-null when a Weddly vendor has claimed this listing. That's the whole
   *  difference between "we mailed a business" and "a vendor got a lead in
   *  their Weddly inbox" — see `deliverInquiries` below. */
  vendorAccountId: number | null;
}

/** Look up the couple owner's user row — used as the Reply-To address on
 *  outreach mail so the vendor replies straight to the couple. v1 has no
 *  inbound webhook, so this is the single hop the vendor's reply takes. */
interface OwnerRow {
  id: number;
  email: string;
  full_name: string;
}

function getCoupleOwner(coupleId: number): OwnerRow {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.full_name
         FROM couple_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.couple_id = ? AND cm.role = 'owner'
        ORDER BY cm.created_at ASC
        LIMIT 1`,
    )
    .get(coupleId) as OwnerRow | undefined;
  if (!row) {
    throw new HttpError(400, "Couple has no owner — cannot send outreach", {
      code: "couple_no_owner",
    });
  }
  return row;
}

/** Resolves supplier_ids to (name, email) pairs. Pulled from the unified
 *  `listings` table so curated, community, and claimed listings all work.
 *  Suppliers without a contact email are rejected up front — there's
 *  nothing to send to. Order matches the input. */
function resolveSupplierContacts(supplierIds: string[]): SupplierContact[] {
  const placeholders = supplierIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, name, contact_email, source, city, vendor_account_id
         FROM listings WHERE id IN (${placeholders})`,
    )
    .all(...supplierIds) as Array<{
    id: string;
    name: string;
    contact_email: string | null;
    source: string;
    city: string;
    vendor_account_id: number | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const out: SupplierContact[] = [];
  const missingEmail: string[] = [];
  const notFound: string[] = [];
  const suppressed: string[] = [];
  for (const id of supplierIds) {
    const row = byId.get(id);
    if (!row) {
      notFound.push(id);
      continue;
    }
    if (!row.contact_email) {
      missingEmail.push(id);
      continue;
    }
    // A business that asked us to stop mailing it must not be reachable through
    // a couple's campaign either. `sendKind` would suppress the mail anyway, but
    // it does so after `outreach_messages` has recorded a row — so without this
    // the couple sees "sent" for a mail that never left. Refuse at the door
    // instead, with the same shape as the no-email case.
    if (isOptedOut(row.contact_email)) {
      suppressed.push(id);
      continue;
    }
    out.push({
      id,
      name: row.name,
      email: row.contact_email,
      source: row.source,
      city: row.city,
      vendorAccountId: row.vendor_account_id,
    });
  }
  if (notFound.length > 0) {
    throw new HttpError(400, `Unknown supplier ids: ${notFound.join(", ")}`, {
      code: "supplier_not_found",
    });
  }
  if (missingEmail.length > 0) {
    throw new HttpError(400, `Suppliers without contact email: ${missingEmail.join(", ")}`, {
      code: "supplier_no_email",
    });
  }
  if (suppressed.length > 0) {
    throw new HttpError(400, `Suppliers who opted out of contact: ${suppressed.join(", ")}`, {
      code: "supplier_no_contact",
    });
  }
  return out;
}

/** The recipient's own language, for the outbound mail. A CLAIMED listing has
 *  a real Weddly account behind it, so their `users.locale` is the truth; an
 *  unclaimed one falls back to the directory's country → language rule (the
 *  same one the claim-invite campaign uses). Returning null keeps the legacy
 *  bilingual HU+EN stack, which is only right when we genuinely don't know. */
function recipientLocaleFor(contact: SupplierContact): UiLocale | null {
  if (contact.vendorAccountId !== null) {
    const row = db
      .prepare(
        `SELECT u.locale AS locale
           FROM vendor_accounts va
           JOIN users u ON u.id = va.owner_user_id
          WHERE va.id = ?`,
      )
      .get(contact.vendorAccountId) as { locale: string | null } | undefined;
    const raw = row?.locale?.toLowerCase();
    if (raw) {
      // A claimed vendor's own account language, when it names one we ship.
      const base = raw.split(/[-_]/)[0] ?? "";
      if (isUiLocale(base)) return base;
      return "en";
    }
    // Claimed but no locale captured (legacy account) — fall through to the
    // listing's country rather than guessing.
  }
  return localeForCountry(
    resolveListingCountry({ id: contact.id, source: contact.source, city: contact.city }),
  );
}

/** How much of the message the recipient's mail has to carry, which is decided
 *  by whether they can read it anywhere else.
 *
 *  `deliverInquiries` is the authority: it returns exactly the recipients the
 *  inquiry actually reached in-app, so a FREE-plan vendor (direct inquiries are
 *  PRO) correctly resolves to `account` and gets the full text, even though
 *  they do have a Weddly account. Deriving this from `vendorAccountId` alone
 *  would send them a notification pointing at a lead they cannot open. */
function outreachModeFor(contact: SupplierContact, deliveredTo: Set<string>): SupplierOutreachMode {
  if (deliveredTo.has(contact.id)) return "in_account";
  return contact.vendorAccountId !== null ? "account" : "claim";
}

/** Where the mail's button should land the recipient. Straight to the inquiry
 *  when it is in their client list; to the dashboard when they have an account
 *  but this lead did not land in it; and otherwise to their OWN public profile,
 *  which carries the claim notice. Pointing an unclaimed business at a
 *  couple-app URL (which is what v1 did, `/app/outreach`, a route that no
 *  longer even exists) was a dead end. */
function outreachCtaUrlFor(contact: SupplierContact, mode: SupplierOutreachMode): string {
  if (mode === "in_account") return `${CONFIG.frontendBaseUrl}/vendor/clients`;
  if (mode === "account") return `${CONFIG.frontendBaseUrl}/vendor`;
  return `${CONFIG.frontendBaseUrl}/suppliers/${contact.id}`;
}

export interface CreateCampaignResult {
  detail: OutreachCampaignDetail;
  /** Recipients whose listing is claimed by an entitled Weddly vendor, so the
   *  message also landed in their in-app client list. The route layer needs
   *  these to fire the vendor-side side effects (calendar sync, billing). */
  inquiries: DeliveredInquiry[];
}

/** Put the couple's message in front of every recipient who actually has a
 *  Weddly vendor account, as a `supplier_bookings` inquiry.
 *
 *  This is the seam that was missing. Outreach used to be email-ONLY: it wrote
 *  `outreach_messages` and sent mail to `listings.contact_email`, and nothing
 *  else. But every vendor-facing surface — the `/vendor` dashboard counters,
 *  the `/vendor/clients` CRM, the `/vendor/stats` conversion panel, the vendor
 *  Google Calendar — reads `supplier_bookings`, whose only writer was the
 *  admin-only `POST /api/suppliers/:id/bookings`. So a couple could send an
 *  inquiry, see it in their own sent history, and the vendor's account would
 *  correctly report zero inquiries forever. The mail was the entire delivery
 *  mechanism, and a mail that lands in a shared info@ inbox is not a lead the
 *  vendor can see, answer, or be measured on.
 *
 *  Unclaimed listings are skipped by design (no account to deliver into) and
 *  so are FREE-plan vendors, because direct inquiries are a PRO feature — both
 *  still get the email, which is the same fallback the public profile uses. */
function deliverInquiries(
  coupleId: number,
  contacts: SupplierContact[],
  input: CreateOutreachCampaignInput,
  ts: number,
  eventDate: string,
): DeliveredInquiry[] {
  const out: DeliveredInquiry[] = [];
  for (const contact of contacts) {
    if (contact.vendorAccountId === null) continue;
    try {
      const delivered = deliverInquiryFromOutreach({
        supplierId: contact.id,
        coupleId,
        eventDate,
        message: `${input.subject}\n\n${input.body_template}`,
        at: ts,
      });
      if (delivered) out.push(delivered);
    } catch (e) {
      // A vendor-side delivery failure must never cost the couple their mail:
      // the campaign rows are already committed and the email is what the
      // recipient reads either way. Log and carry on.
      log.error("outreach.inquiry_delivery_failed", e, {
        couple_id: coupleId,
        supplier_id: contact.id,
      });
    }
  }
  return out;
}

/** The couple's wedding date for the inquiry row, or "" when they haven't
 *  picked one (a `wedding_date_goal` of "summer 2027" leaves the scalar NULL).
 *  Empty rather than invented: `event_date` is NOT NULL, the vendor CRM and
 *  dashboard already render a falsy date as "no date yet", and both the
 *  Google Calendar push and the upcoming-events list filter on a well-formed
 *  ISO date — so a blank passes through every consumer as "unknown", which is
 *  the truth, instead of parking a fake wedding on the vendor's calendar. */
function coupleWeddingDate(coupleId: number): string {
  const row = db.prepare("SELECT wedding_date FROM couples WHERE id = ?").get(coupleId) as
    | { wedding_date: string | null }
    | undefined;
  return row?.wedding_date ?? "";
}

/** Create + fire a campaign. Inserts the campaign row, one message per
 *  resolved supplier, delivers an in-app inquiry to every claimed recipient,
 *  and kicks off a `supplier_outreach` email each (fire-and-forget — the
 *  mailer logs failures into `email_log` for later introspection). Returns
 *  the freshly-inserted campaign so the route handler can echo it back to
 *  the client, plus the inquiries it delivered so the route can run the
 *  vendor-side side effects. */
export function createCampaign(
  couple: OutreachCouple,
  input: CreateOutreachCampaignInput,
): CreateCampaignResult {
  const contacts = resolveSupplierContacts(input.supplier_ids);
  assertWithinWeeklyCap(couple.id, contacts.length);
  const owner = getCoupleOwner(couple.id);
  const ts = now();

  const insertCampaign = db.prepare(
    `INSERT INTO outreach_campaigns (couple_id, subject, body_template, created_at)
     VALUES (?, ?, ?, ?)
     RETURNING id`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO outreach_messages
       (campaign_id, supplier_id, supplier_email, sent_at, status, reply_token, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)
     RETURNING id, campaign_id, supplier_id, supplier_email, sent_at, status, reply_token,
               booking_id, created_at`,
  );

  const inserted = db.transaction(() => {
    const cRow = insertCampaign.get(couple.id, input.subject, input.body_template, ts) as {
      id: number;
    };
    const messageRows: MessageRow[] = [];
    for (const contact of contacts) {
      const mRow = insertMessage.get(
        cRow.id,
        contact.id,
        contact.email,
        null,
        generateReplyToken(),
        ts,
      ) as MessageRow;
      messageRows.push(mRow);
    }
    return { campaignId: cRow.id, messages: messageRows };
  })();

  // Land the message inside the product for every recipient who has an
  // account there. Runs BEFORE the mail so a claimed vendor who opens the
  // link in the mail already finds the lead waiting in their client list —
  // and so the mail knows which recipients it must carry the full text to.
  const eventDate = coupleWeddingDate(couple.id);
  const inquiries = deliverInquiries(couple.id, contacts, input, ts, eventDate);
  const deliveredTo = new Set(inquiries.map((i) => i.supplierId));
  // Record WHICH inquiry each message became. Read back by the couple's sent
  // history ("in their client list" vs "emailed only") and by the claim-time
  // replay, which must not re-deliver a message that already landed.
  const bookingBySupplier = new Map(inquiries.map((i) => [i.supplierId, i.bookingId]));
  // Whether each recipient can actually answer on the thread. Replying is PRO,
  // so the mail must not tell a FREE vendor to "reply there" and land them on a
  // paywall; see the plan-aware closing line in the supplier_outreach template.
  const canReplyBySupplier = new Map(
    inquiries.map((i) => [i.supplierId, isVendorEntitled(i.vendorAccountId)]),
  );
  const stampBooking = db.prepare("UPDATE outreach_messages SET booking_id = ? WHERE id = ?");
  for (const row of inserted.messages) {
    const bookingId = bookingBySupplier.get(row.supplier_id);
    if (bookingId === undefined) continue;
    stampBooking.run(bookingId, row.id);
    row.booking_id = bookingId;
  }

  // Fire the outbound mail per message. `sendKind` is fire-and-forget;
  // failures land in `email_log`. We flip status to "sent" optimistically
  // — a transient mailer failure won't surface in the in-app UI until
  // v1.5 wires per-kind status updates from the email_log.
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]!;
    const messageRow = inserted.messages[i]!;
    db.prepare("UPDATE outreach_messages SET sent_at = ?, status = 'sent' WHERE id = ?").run(
      ts,
      messageRow.id,
    );
    messageRow.sent_at = ts;
    messageRow.status = "sent";
    const mode = outreachModeFor(contact, deliveredTo);
    void sendKind(
      "supplier_outreach",
      {
        coupleDisplayName: couple.display_name,
        coupleReplyEmail: owner.email,
        coupleReplyName: owner.full_name,
        supplierName: contact.name,
        subject: input.subject,
        body: input.body_template,
        outreachUrl: outreachCtaUrlFor(contact, mode),
        mode,
        eventDate,
        sentAt: ts,
        canReplyInApp: canReplyBySupplier.get(contact.id) ?? false,
      },
      {
        user: null,
        guest: { email: contact.email, full_name: contact.name },
        guestLocale: recipientLocaleFor(contact),
        couple_id: couple.id,
      },
    );
  }

  const campaignRow = db
    .prepare("SELECT * FROM outreach_campaigns WHERE id = ?")
    .get(inserted.campaignId) as CampaignRow;
  const openableCategories = linkableListingCategories(contacts.map((c) => c.id));
  const messages = inserted.messages.map((m, i) =>
    toMessage(m, contacts[i]!.name, openableCategories.get(contacts[i]!.id) ?? null),
  );
  return {
    detail: {
      ...toCampaign(campaignRow, messages.length),
      messages,
      replies: [],
    },
    inquiries,
  };
}

// ── List + detail ────────────────────────────────────────────────────────

export function listCampaigns(coupleId: number): OutreachCampaign[] {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM outreach_messages m WHERE m.campaign_id = c.id) AS message_count
         FROM outreach_campaigns c
        WHERE c.couple_id = ?
        ORDER BY c.created_at DESC`,
    )
    .all(coupleId) as Array<CampaignRow & { message_count: number }>;
  return rows.map((row) => toCampaign(row, row.message_count));
}

export function getCampaignDetail(
  coupleId: number,
  campaignId: number,
): OutreachCampaignDetail | null {
  const campaignRow = db
    .prepare("SELECT * FROM outreach_campaigns WHERE id = ? AND couple_id = ?")
    .get(campaignId, coupleId) as CampaignRow | undefined;
  if (!campaignRow) return null;
  const messageRows = db
    .prepare("SELECT * FROM outreach_messages WHERE campaign_id = ? ORDER BY id ASC")
    .all(campaignId) as MessageRow[];
  // Pull current supplier names in one IN(...) hop so the detail view
  // reads consistent labels even when the directory rename happens after
  // the campaign was sent.
  const ids = messageRows.map((m) => m.supplier_id);
  const supplierNames = new Map<string, string>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name FROM listings WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string; name: string }>;
    for (const r of rows) supplierNames.set(r.id, r.name);
  }
  // Deliberately a SECOND lookup rather than one more column above: the name is
  // read for every row we have (the label must render even for a listing that
  // has since been hidden), the category only for the ones the couple can still
  // open, and that verdict is not this module's to spell.
  const openableCategories = linkableListingCategories(ids);
  // One batched lookup for the whole campaign, like the two above it.
  const replied = vendorRepliedBookingIds(
    messageRows.map((m) => m.booking_id).filter((id): id is number => id !== null),
  );
  const messages = messageRows.map((row) =>
    toMessage(
      row,
      supplierNames.get(row.supplier_id) ?? row.supplier_id,
      openableCategories.get(row.supplier_id) ?? null,
      row.booking_id !== null && replied.has(row.booking_id),
    ),
  );
  const replyRows = db
    .prepare(
      `SELECT r.* FROM outreach_replies r
         JOIN outreach_messages m ON m.id = r.message_id
        WHERE m.campaign_id = ?
        ORDER BY r.received_at ASC`,
    )
    .all(campaignId) as ReplyRow[];
  const replies = replyRows.map(toReply);
  return {
    ...toCampaign(campaignRow, messages.length),
    messages,
    replies,
  };
}

// ── Handing over the leads that arrived before the account did ───────────────

/** Deliver every outreach message for `listingId` that never reached a Weddly
 *  inbox, now that one exists. Returns how many landed.
 *
 *  A vendor's `supplier_bookings.vendor_account_id` is resolved once, at insert.
 *  Claim-then-inquire therefore works and inquire-then-claim silently did not:
 *  the couples who wrote to a business BEFORE it joined were the whole reason it
 *  was worth joining, and their messages were exactly the ones the new portal
 *  reported as zero. That is the worst possible first impression, and it is
 *  precisely the cohort the claim-invite campaign converts.
 *
 *  Idempotent via `outreach_messages.booking_id`: a message that already landed
 *  is skipped, so this is safe to call on every claim and safe to re-run as a
 *  backfill. Failures are logged per message and never abort the rest: a claim
 *  must not fail because one old lead couldn't be replayed. */
export function replayOutreachForListing(listingId: string): number {
  const pending = db
    .prepare(
      `SELECT m.id, m.supplier_id, c.couple_id, c.subject, c.body_template, m.created_at
         FROM outreach_messages m
         JOIN outreach_campaigns c ON c.id = m.campaign_id
        WHERE m.supplier_id = ? AND m.booking_id IS NULL
        ORDER BY m.created_at ASC`,
    )
    .all(listingId) as {
    id: number;
    supplier_id: string;
    couple_id: number;
    subject: string;
    body_template: string;
    created_at: number;
  }[];
  if (pending.length === 0) return 0;

  const stamp = db.prepare("UPDATE outreach_messages SET booking_id = ? WHERE id = ?");
  let landed = 0;
  for (const msg of pending) {
    try {
      const delivered = deliverInquiryFromOutreach({
        supplierId: msg.supplier_id,
        coupleId: msg.couple_id,
        eventDate: coupleWeddingDate(msg.couple_id),
        message: `${msg.subject}\n\n${msg.body_template}`,
        // The ORIGINAL send time, not now: the vendor's CRM should show when the
        // couple actually wrote, and a lead backdated honestly is also a lead
        // whose age tells them how overdue the reply is.
        at: msg.created_at,
      });
      if (!delivered) continue;
      stamp.run(delivered.bookingId, msg.id);
      landed++;
    } catch (e) {
      log.error("outreach.replay_failed", e, { listing_id: listingId, message_id: msg.id });
    }
  }
  if (landed > 0) log.info("outreach.replayed", { listing_id: listingId, landed });
  return landed;
}
