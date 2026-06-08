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

import type { FeedbackPriority, FeedbackSource, FeedbackStatus } from "@shared/feedback";
import {
  deleteFeedback,
  getFeedbackById,
  insertFeedback,
  listFeedback,
  parseUserAgent,
  setFeedbackStatus,
  setFeedbackTriage,
  toFeedbackEntry,
} from "../domain/feedback";
import { requireAdmin } from "../domain/users";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
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
  const url = trimStr(body.url, 500);
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
  router.patch("/api/admin/feedback/:id", handleAdminTriage, true);
  router.delete("/api/admin/feedback/:id", handleAdminDelete, true);
}
