// Guest-broadcast composer API. Couple-scoped invites / major-update /
// pre-wedding-info mails, plus the per-head envelope tip the composer shows.
// Domain logic (recipients, envelope math, the shared send) lives in
// domain/guest_messages.ts so the scheduled worker can reuse it.

import type {
  EnvelopeTip,
  GuestMessage,
  GuestMessageAudience,
  GuestMessageStatus,
  GuestMessageTemplate,
} from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { computeEnvelopeTip, resolveRecipients, sendGuestMessage } from "../domain/guest_messages";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface GuestMessageRow {
  id: number;
  couple_id: number;
  template: string;
  subject: string | null;
  body: string | null;
  include_envelope_tip: number;
  envelope_amount: number | null;
  audience: string;
  status: string;
  scheduled_at: number | null;
  sent_at: number | null;
  recipient_count: number;
  created_at: number;
  updated_at: number;
}

const VALID_TEMPLATES: ReadonlySet<GuestMessageTemplate> = new Set([
  "invite",
  "major_update",
  "pre_wedding_info",
]);
const VALID_AUDIENCES: ReadonlySet<GuestMessageAudience> = new Set(["all", "pending", "confirmed"]);

function toGuestMessage(row: GuestMessageRow): GuestMessage {
  return {
    id: row.id,
    couple_id: row.couple_id,
    template: (VALID_TEMPLATES.has(row.template as GuestMessageTemplate)
      ? row.template
      : "major_update") as GuestMessageTemplate,
    subject: row.subject,
    body: row.body,
    include_envelope_tip: Boolean(row.include_envelope_tip),
    envelope_amount: row.envelope_amount,
    audience: (VALID_AUDIENCES.has(row.audience as GuestMessageAudience)
      ? row.audience
      : "all") as GuestMessageAudience,
    status: row.status as GuestMessageStatus,
    scheduled_at: row.scheduled_at,
    sent_at: row.sent_at,
    recipient_count: row.recipient_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const rows = db
    .prepare("SELECT * FROM guest_messages WHERE couple_id = ? ORDER BY created_at DESC")
    .all(couple.id) as GuestMessageRow[];
  return json({ messages: rows.map(toGuestMessage) });
}

interface CreateBody {
  template?: unknown;
  subject?: unknown;
  body?: unknown;
  audience?: unknown;
  include_envelope_tip?: unknown;
  scheduled_at?: unknown;
}

function parseStr(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `Field longer than ${max} chars`);
  return trimmed;
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<CreateBody>(ctx.req);

  if (
    typeof body.template !== "string" ||
    !VALID_TEMPLATES.has(body.template as GuestMessageTemplate)
  ) {
    throw new HttpError(400, "Invalid template");
  }
  const template = body.template as GuestMessageTemplate;
  if (
    typeof body.audience !== "string" ||
    !VALID_AUDIENCES.has(body.audience as GuestMessageAudience)
  ) {
    throw new HttpError(400, "Invalid audience");
  }
  const audience = body.audience as GuestMessageAudience;

  const subject = parseStr(body.subject, 300);
  const messageBody = parseStr(body.body, 10_000);
  const includeEnvelopeTip = body.include_envelope_tip === true;

  // A finite, strictly-future epoch-ms means "schedule"; anything else
  // (omitted, null, past) means "send now".
  const ts = now();
  let scheduledAt: number | null = null;
  if (
    typeof body.scheduled_at === "number" &&
    Number.isFinite(body.scheduled_at) &&
    body.scheduled_at > ts
  ) {
    scheduledAt = body.scheduled_at;
  }

  const recipients = resolveRecipients(couple.id, audience);

  if (scheduledAt !== null) {
    // Defer to the worker. recipient_count is a current-eligible estimate; the
    // sweep re-resolves at send time so a list that grows/shrinks still sends
    // to the right people.
    const result = db
      .prepare(
        `INSERT INTO guest_messages
           (couple_id, template, subject, body, include_envelope_tip, envelope_amount,
            audience, status, scheduled_at, sent_at, recipient_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'scheduled', ?, NULL, ?, ?, ?)`,
      )
      .run(
        couple.id,
        template,
        subject,
        messageBody,
        includeEnvelopeTip ? 1 : 0,
        audience,
        scheduledAt,
        recipients.length,
        ts,
        ts,
      );
    const id = Number(result.lastInsertRowid);
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "guest_message.schedule",
      target_kind: "guest_message",
      target_id: id,
      after: { template, audience, scheduled_at: scheduledAt, recipient_count: recipients.length },
    });
    const row = db.prepare("SELECT * FROM guest_messages WHERE id = ?").get(id) as GuestMessageRow;
    return json({ message: toGuestMessage(row) }, { status: 201 });
  }

  // Send now.
  const { sent, envelopeAmount } = sendGuestMessage(
    couple,
    { template, subject, body: messageBody, include_envelope_tip: includeEnvelopeTip },
    recipients,
    userId,
  );

  const result = db
    .prepare(
      `INSERT INTO guest_messages
         (couple_id, template, subject, body, include_envelope_tip, envelope_amount,
          audience, status, scheduled_at, sent_at, recipient_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', NULL, ?, ?, ?, ?)`,
    )
    .run(
      couple.id,
      template,
      subject,
      messageBody,
      includeEnvelopeTip ? 1 : 0,
      envelopeAmount,
      audience,
      ts,
      sent,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest_message.send",
    target_kind: "guest_message",
    target_id: id,
    after: { template, audience, recipient_count: sent },
  });
  const row = db.prepare("SELECT * FROM guest_messages WHERE id = ?").get(id) as GuestMessageRow;
  return json({ message: toGuestMessage(row) }, { status: 201 });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = db
    .prepare("SELECT * FROM guest_messages WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as GuestMessageRow | undefined;
  if (!existing) throw new HttpError(404, "Message not found");
  // Only a not-yet-sent scheduled broadcast can be cancelled; sent/sending/
  // failed rows are an immutable history.
  if (existing.status !== "scheduled") {
    throw new HttpError(409, "Only scheduled messages can be deleted");
  }

  db.prepare("DELETE FROM guest_messages WHERE id = ? AND couple_id = ?").run(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest_message.delete",
    target_kind: "guest_message",
    target_id: id,
    before: { template: existing.template, scheduled_at: existing.scheduled_at },
  });
  return json({ ok: true });
}

function handleEnvelopeTipGet(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json(computeEnvelopeTip(couple) satisfies EnvelopeTip);
}

interface EnvelopeTipPatchBody {
  enabled?: unknown;
  override?: unknown;
}

async function handleEnvelopeTipPatch(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<EnvelopeTipPatchBody>(ctx.req);
  const ts = now();

  if (typeof body.enabled === "boolean") {
    db.prepare("UPDATE couples SET envelope_tip_enabled = ?, updated_at = ? WHERE id = ?").run(
      body.enabled ? 1 : 0,
      ts,
      couple.id,
    );
  }
  if (body.override === null) {
    db.prepare(
      "UPDATE couples SET envelope_tip_amount_override = NULL, updated_at = ? WHERE id = ?",
    ).run(ts, couple.id);
  } else if (typeof body.override === "number" && Number.isFinite(body.override)) {
    if (body.override < 0) throw new HttpError(400, "override must be >= 0");
    db.prepare(
      "UPDATE couples SET envelope_tip_amount_override = ?, updated_at = ? WHERE id = ?",
    ).run(Math.round(body.override), ts, couple.id);
  }

  const fresh = getCoupleForUser(userId);
  if (!fresh) throw new HttpError(400, "No couple workspace yet");
  return json(computeEnvelopeTip(fresh) satisfies EnvelopeTip);
}

export function registerGuestMessagesRoutes(router: Router) {
  router.get("/api/guest-messages", handleList, true);
  // Literal sub-paths MUST be registered before the :id route so the
  // "envelope-tip" segment isn't captured as an id.
  router.get("/api/guest-messages/envelope-tip", handleEnvelopeTipGet, true);
  router.patch("/api/guest-messages/envelope-tip", handleEnvelopeTipPatch, true);
  router.post("/api/guest-messages", handleCreate, true);
  router.delete("/api/guest-messages/:id", handleDelete, true);
}
