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
import {
  OUTREACH_BODY_MAX_LEN,
  OUTREACH_CAMPAIGNS_PER_WEEK_CAP,
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
import { sendKind } from "./emails";

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

/** Throws 429 when the couple has already created
 *  `OUTREACH_CAMPAIGNS_PER_WEEK_CAP` (or more) campaigns in the last
 *  rolling 7 days. Counts DB rows directly so a restart doesn't reset
 *  the limit. */
function assertWithinWeeklyCap(coupleId: number): void {
  const sevenDaysAgo = now() - 7 * 24 * 60 * 60 * 1000;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM outreach_campaigns WHERE couple_id = ? AND created_at >= ?")
    .get(coupleId, sevenDaysAgo) as { n: number };
  if (row.n >= OUTREACH_CAMPAIGNS_PER_WEEK_CAP) {
    throw new HttpError(
      429,
      `Outreach limit reached (max ${OUTREACH_CAMPAIGNS_PER_WEEK_CAP} campaigns per 7 days)`,
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

function toMessage(row: MessageRow, supplierName: string): OutreachMessage {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    supplier_id: row.supplier_id,
    supplier_name: supplierName,
    supplier_email: row.supplier_email,
    sent_at: row.sent_at,
    status: toMessageStatus(row.status),
    reply_token: row.reply_token,
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
    .prepare(`SELECT id, name, contact_email FROM listings WHERE id IN (${placeholders})`)
    .all(...supplierIds) as Array<{ id: string; name: string; contact_email: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const out: SupplierContact[] = [];
  const missingEmail: string[] = [];
  const notFound: string[] = [];
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
    out.push({ id, name: row.name, email: row.contact_email });
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
  return out;
}

/** Create + fire a campaign. Inserts the campaign row, one message per
 *  resolved supplier, kicks off a `supplier_outreach` email each (fire-
 *  and-forget — the mailer logs failures into `email_log` for later
 *  introspection). Returns the freshly-inserted campaign so the route
 *  handler can echo it back to the client. */
export function createCampaign(
  couple: OutreachCouple,
  input: CreateOutreachCampaignInput,
): OutreachCampaignDetail {
  assertWithinWeeklyCap(couple.id);
  const contacts = resolveSupplierContacts(input.supplier_ids);
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
     RETURNING id, campaign_id, supplier_id, supplier_email, sent_at, status, reply_token, created_at`,
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
    void sendKind(
      "supplier_outreach",
      {
        coupleDisplayName: couple.display_name,
        coupleReplyEmail: owner.email,
        coupleReplyName: owner.full_name,
        supplierName: contact.name,
        subject: input.subject,
        body: input.body_template,
        outreachUrl: `${CONFIG.frontendBaseUrl}/app/outreach`,
      },
      {
        user: null,
        guest: { email: contact.email, full_name: contact.name },
        couple_id: couple.id,
      },
    );
  }

  const campaignRow = db
    .prepare("SELECT * FROM outreach_campaigns WHERE id = ?")
    .get(inserted.campaignId) as CampaignRow;
  const messages = inserted.messages.map((m, i) => toMessage(m, contacts[i]!.name));
  return {
    ...toCampaign(campaignRow, messages.length),
    messages,
    replies: [],
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
  const messages = messageRows.map((row) =>
    toMessage(row, supplierNames.get(row.supplier_id) ?? row.supplier_id),
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
