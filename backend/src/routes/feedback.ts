// Feedback dialog endpoint. Two surfaces share one POST:
//   • /api/feedback                — anon or authenticated, source from body
// Admins triage at /app/admin/feedback via these auth'd routes:
//   • GET    /api/admin/feedback
//   • PATCH  /api/admin/feedback/:id/status   — lifecycle move
//   • PATCH  /api/admin/feedback/:id          — priority / area / notes
//   • DELETE /api/admin/feedback/:id
//
// Submissions are persisted to `feedback_submissions` — no email is sent
// any more. The admin UI is the canonical destination.

import type {
  FeedbackPriority,
  FeedbackReplyChannel,
  FeedbackSource,
  FeedbackStatus,
} from "@shared/feedback";
import { db } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { sendKind } from "../domain/emails/send";
import {
  deleteFeedback,
  getFeedbackById,
  insertFeedback,
  insertFeedbackReply,
  listFeedback,
  parseUserAgent,
  setFeedbackStatus,
  setFeedbackTriage,
  toFeedbackEntry,
} from "../domain/feedback";
import { insertCoupleNotification } from "../domain/notifications";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { httpUrlOrNull } from "../lib/url";
import { rateLimit } from "../lib/rate_limit";

interface SubmitBody {
  source?: unknown;
  /** In-app pathname the dialog was opened from, e.g. "/app/media". Only
   *  meaningful for `source: "app"`; ignored for landing submissions. */
  context?: unknown;
  /** Full URL (window.location.href) so admins can reproduce exactly. */
  url?: unknown;
  message?: unknown;
  rating?: unknown;
  monthly_value_ft?: unknown;
  from_email?: unknown;
  /** "hu" | "en" — captured so admins can see what language the visitor
   *  was reading the page in when they submitted. */
  locale?: unknown;
}

function trimStr(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > maxLen) throw new HttpError(400, `Field too long (max ${maxLen})`);
  return s;
}

function intInRange(v: unknown, lo: number, hi: number, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  const rounded = Math.round(n);
  if (rounded < lo || rounded > hi) {
    throw new HttpError(400, `${field} must be between ${lo} and ${hi}`);
  }
  return rounded;
}

function isValidEmail(s: string): boolean {
  if (s.length > 200) return false;
  const at = s.indexOf("@");
  return at >= 1 && s.indexOf(".", at) !== -1;
}

function parseSource(v: unknown): FeedbackSource {
  return v === "app" ? "app" : "landing";
}

const STATUSES: ReadonlySet<string> = new Set([
  "new",
  "reviewed",
  "planned",
  "fixed",
  "rejected",
  "archived",
]);

function parseStatus(v: unknown): FeedbackStatus | null {
  return typeof v === "string" && STATUSES.has(v) ? (v as FeedbackStatus) : null;
}

function parsePriority(v: unknown): FeedbackPriority | null | undefined {
  if (v === undefined) return undefined; // omitted — leave as-is
  if (v === null || v === "") return null; // explicit clear
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

const REPLY_CHANNELS: ReadonlySet<string> = new Set(["email", "notification", "both"]);

/** Body `channel` → validated union, defaulting to "email" when omitted. */
function parseReplyChannel(v: unknown): FeedbackReplyChannel {
  return v === "notification" || v === "both" ? v : "email";
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Anon-friendly endpoint — IP-bucket for spam, even when authenticated.
  // 10 submissions per hour per IP is generous enough for bursty real
  // users without leaving the door open to crawlers.
  rateLimit(ctx.clientIp, "feedback", { capacity: 10, refillRate: 1 / 360 });

  const body = await readJson<SubmitBody>(ctx.req);

  const source = parseSource(body.source);
  // Context is an in-app route; only retain it for in-product submissions so
  // a crafted landing-page POST can't smuggle a bogus surface label in.
  const context = source === "app" ? trimStr(body.context, 200) : null;
  // Scheme-guard: this URL is anchored into an href in the admin feedback panel,
  // so a javascript:/data: value would be stored XSS. Drop anything non-http(s).
  const urlRaw = trimStr(body.url, 500);
  const url = urlRaw === null ? null : httpUrlOrNull(urlRaw);
  const message = trimStr(body.message, 2000);
  const rating = intInRange(body.rating, 1, 10, "rating");
  const monthlyValue = intInRange(body.monthly_value_ft, 0, 15000, "monthly_value_ft");
  const fromEmailRaw = trimStr(body.from_email, 200);
  const fromEmail = fromEmailRaw?.toLowerCase() ?? null;
  if (fromEmail && !isValidEmail(fromEmail)) {
    throw new HttpError(400, "from_email is not valid");
  }
  const locale = trimStr(body.locale, 8);
  // Device/browser/os come from the request header, not the body — can't be
  // spoofed by a crafted client and works identically for both surfaces.
  const { device, browser, os } = parseUserAgent(ctx.req.headers.get("user-agent"));

  if (!message && rating === null && monthlyValue === null) {
    throw new HttpError(400, "Feedback is empty — provide message, rating or monthly_value_ft");
  }

  insertFeedback({
    source,
    context,
    url,
    user_id: ctx.userId,
    message,
    rating,
    monthly_value_ft: monthlyValue,
    from_email: fromEmail,
    locale,
    device,
    browser,
    os,
  });

  return json({ ok: true });
}

async function handleAdminList(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const entries = listFeedback().map(toFeedbackEntry);
  return json({ entries });
}

async function handleAdminSetStatus(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");

  const body = await readJson<{ status?: unknown }>(ctx.req);
  const status = parseStatus(body.status);
  if (!status) {
    throw new HttpError(400, "status must be one of new|reviewed|planned|fixed|rejected|archived");
  }

  const existing = getFeedbackById(id);
  if (!existing) throw new HttpError(404, "Feedback not found");

  const updated = setFeedbackStatus(id, status, admin.id);
  if (!updated) throw new HttpError(500, "Failed to update feedback");

  return json({ entry: toFeedbackEntry(updated) });
}

async function handleAdminTriage(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");

  const body = await readJson<{
    priority?: unknown;
    feature_area?: unknown;
    admin_notes?: unknown;
  }>(ctx.req);

  const patch: {
    priority?: FeedbackPriority | null;
    feature_area?: string | null;
    admin_notes?: string | null;
  } = {};

  if ("priority" in body) {
    const p = parsePriority(body.priority);
    if (p === undefined && body.priority !== undefined) {
      throw new HttpError(400, "priority must be one of low|medium|high or null");
    }
    if (p !== undefined) patch.priority = p;
  }
  if ("feature_area" in body) {
    // Empty string clears the area; otherwise a short slug.
    patch.feature_area = body.feature_area === null ? null : trimStr(body.feature_area, 40);
  }
  if ("admin_notes" in body) {
    patch.admin_notes = body.admin_notes === null ? null : trimStr(body.admin_notes, 4000);
  }

  const existing = getFeedbackById(id);
  if (!existing) throw new HttpError(404, "Feedback not found");

  const updated = setFeedbackTriage(id, patch, admin.id);
  if (!updated) throw new HttpError(500, "Failed to update feedback");

  return json({ entry: toFeedbackEntry(updated) });
}

/** Send an admin's free-form reply to the submitter via email and/or an in-app
 *  bell notification, record it on the thread, and nudge a still-new row to
 *  reviewed. Deliverability is validated up front: a chosen channel that can't
 *  reach the submitter (no email on file / no workspace for a bell) 400s
 *  instead of silently dropping. */
async function handleAdminReply(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");

  const body = await readJson<{ message?: unknown; channel?: unknown }>(ctx.req);
  const message = trimStr(body.message, 4000);
  if (!message) throw new HttpError(400, "message required");
  if (
    body.channel !== undefined &&
    (typeof body.channel !== "string" || !REPLY_CHANNELS.has(body.channel))
  ) {
    throw new HttpError(400, "channel must be one of email|notification|both");
  }
  const channel = parseReplyChannel(body.channel);

  const entry = getFeedbackById(id);
  if (!entry) throw new HttpError(404, "Feedback not found");

  const wantEmail = channel === "email" || channel === "both";
  const wantNotif = channel === "notification" || channel === "both";

  const recipientEmail = entry.user_email ?? entry.from_email;
  if (wantEmail && !recipientEmail) {
    throw new HttpError(400, "No email address on file for this submitter");
  }

  // The submitter's workspace: drives the bell leg and locale-aware email.
  const couple = entry.user_id ? getCoupleForUser(entry.user_id) : null;
  if (channel === "notification" && !couple) {
    throw new HttpError(400, "Submitter has no workspace for an in-app notification");
  }

  // ── email leg ──
  let emailStatus: string | null = null;
  if (wantEmail && recipientEmail) {
    const recipientUser = entry.user_id
      ? (db.prepare("SELECT id, email, full_name FROM users WHERE id = ?").get(entry.user_id) as
          | { id: number; email: string; full_name: string | null }
          | undefined)
      : undefined;
    const result = await sendKind(
      "admin_feedback_reply",
      { replyText: message, originalMessage: entry.message },
      recipientUser
        ? {
            user: {
              id: recipientUser.id,
              email: recipientUser.email,
              full_name: recipientUser.full_name ?? "",
            },
            couple_id: couple?.id ?? null,
          }
        : {
            user: null,
            guest: { email: recipientEmail, full_name: entry.user_full_name ?? "" },
          },
    );
    emailStatus = result.status;
    if (result.status === "skipped_duplicate") {
      throw new HttpError(409, "This email was already sent in the last 5 minutes", {
        code: "email_recently_sent",
      });
    }
  }

  // ── in-app bell notification leg ──
  let notified = false;
  if (wantNotif && couple) {
    insertCoupleNotification({
      couple_id: couple.id,
      kind: "admin_message",
      actor_user_id: null,
      data: { message },
      link: null,
    });
    notified = true;
  }

  insertFeedbackReply({
    feedback_id: id,
    admin_user_id: admin.id,
    message,
    channel,
    email_status: emailStatus,
    notified,
  });

  // A reply means someone looked at it, so advance a still-new row to reviewed.
  if (entry.status === "new") setFeedbackStatus(id, "reviewed", admin.id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: couple?.id ?? null,
    action: "admin.feedback_reply",
    target_kind: "feedback",
    target_id: id,
    note: `${channel}: ${message.slice(0, 120)}`,
  });

  const updated = getFeedbackById(id);
  if (!updated) throw new HttpError(500, "Failed to reload feedback");
  return json({
    entry: toFeedbackEntry(updated),
    delivery: { email: emailStatus, notified },
  });
}

async function handleAdminDelete(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Bad id");
  const removed = deleteFeedback(id);
  if (!removed) throw new HttpError(404, "Feedback not found");
  return json({ ok: true });
}

export function registerFeedbackRoutes(router: Router) {
  router.post("/api/feedback", handleSubmit);
  router.get("/api/admin/feedback", handleAdminList, true);
  router.patch("/api/admin/feedback/:id/status", handleAdminSetStatus, true);
  router.post("/api/admin/feedback/:id/reply", handleAdminReply, true);
  router.patch("/api/admin/feedback/:id", handleAdminTriage, true);
  router.delete("/api/admin/feedback/:id", handleAdminDelete, true);
}
