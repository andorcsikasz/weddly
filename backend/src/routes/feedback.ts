// Feedback dialog endpoint. Two surfaces share one POST:
//   • /api/feedback                — anon or authenticated, source from body
// Admins triage at /app/admin/feedback via these auth'd routes:
//   • GET    /api/admin/feedback
//   • PATCH  /api/admin/feedback/:id/status
//   • DELETE /api/admin/feedback/:id
//
// Submissions are persisted to `feedback_submissions` — no email is sent
// any more. The admin UI is the canonical destination.

import type { FeedbackSource, FeedbackStatus } from "@shared/feedback";
import {
  deleteFeedback,
  getFeedbackById,
  insertFeedback,
  listFeedback,
  setFeedbackStatus,
  toFeedbackEntry,
} from "../domain/feedback";
import { requireAdmin } from "../domain/users";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

interface SubmitBody {
  source?: unknown;
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

function parseStatus(v: unknown): FeedbackStatus | null {
  return v === "new" || v === "read" || v === "resolved" || v === "dismissed" ? v : null;
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Anon-friendly endpoint — IP-bucket for spam, even when authenticated.
  // 10 submissions per hour per IP is generous enough for bursty real
  // users without leaving the door open to crawlers.
  rateLimit(ctx.clientIp, "feedback", { capacity: 10, refillRate: 1 / 360 });

  const body = await readJson<SubmitBody>(ctx.req);

  const source = parseSource(body.source);
  const message = trimStr(body.message, 2000);
  const rating = intInRange(body.rating, 1, 10, "rating");
  const monthlyValue = intInRange(body.monthly_value_ft, 0, 15000, "monthly_value_ft");
  const fromEmailRaw = trimStr(body.from_email, 200);
  const fromEmail = fromEmailRaw?.toLowerCase() ?? null;
  if (fromEmail && !isValidEmail(fromEmail)) {
    throw new HttpError(400, "from_email is not valid");
  }
  const locale = trimStr(body.locale, 8);

  if (!message && rating === null && monthlyValue === null) {
    throw new HttpError(400, "Feedback is empty — provide message, rating or monthly_value_ft");
  }

  insertFeedback({
    source,
    user_id: ctx.userId,
    message,
    rating,
    monthly_value_ft: monthlyValue,
    from_email: fromEmail,
    locale,
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
    throw new HttpError(400, "status must be one of new|read|resolved|dismissed");
  }

  const existing = getFeedbackById(id);
  if (!existing) throw new HttpError(404, "Feedback not found");

  const updated = setFeedbackStatus(id, status, admin.id);
  if (!updated) throw new HttpError(500, "Failed to update feedback");

  return json({ entry: toFeedbackEntry(updated) });
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
  router.delete("/api/admin/feedback/:id", handleAdminDelete, true);
}
