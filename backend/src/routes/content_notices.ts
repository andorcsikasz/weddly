import { randomBytes } from "node:crypto";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { sendTransactionalMessage } from "../domain/emails/send";
import { rateLimit } from "../lib/rate_limit";

interface NoticeRow {
  id: number;
  reference: string;
  reporter_name: string;
  reporter_email: string;
  content_url: string;
  illegality: string;
  explanation: string;
  good_faith: number;
  status: "submitted" | "reviewing" | "actioned" | "rejected";
  decision_reason: string | null;
  decided_by_user_id: number | null;
  decided_at: number | null;
  appeal_text: string | null;
  appealed_at: number | null;
  appeal_decision: string | null;
  appeal_decided_at: number | null;
  created_at: number;
  updated_at: number;
}

function textField(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, `${field} must be ${min}-${max} characters`);
  }
  return normalized;
}

function emailField(value: unknown): string {
  const email = textField(value, "email", 3, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "email is invalid");
  return email;
}

function contentUrl(value: unknown): string {
  const raw = textField(value, "content_url", 8, 800);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "content_url must be an absolute Weddly URL");
  }
  const allowed = new Set<string>();
  for (const candidate of [CONFIG.frontendBaseUrl, process.env.EN_CANONICAL_HOST ?? ""]) {
    if (!candidate) continue;
    try {
      allowed.add(new URL(candidate.includes("://") ? candidate : `https://${candidate}`).host);
    } catch {
      // Invalid canonical configuration is handled by config's production gate.
    }
  }
  if (!allowed.has(url.host) || !["http:", "https:"].includes(url.protocol)) {
    throw new HttpError(400, "content_url must identify content hosted by Weddly");
  }
  url.hash = "";
  return url.toString();
}

function publicCase(row: NoticeRow) {
  return {
    reference: row.reference,
    status: row.status,
    content_url: row.content_url,
    decision_reason: row.decision_reason,
    decided_at: row.decided_at,
    appealed_at: row.appealed_at,
    appeal_decision: row.appeal_decision,
    appeal_decided_at: row.appeal_decided_at,
    created_at: row.created_at,
  };
}

function caseByReference(reference: string): NoticeRow | null {
  return (
    (db.prepare("SELECT * FROM content_notices WHERE reference = ?").get(reference) as
      | NoticeRow
      | undefined) ?? null
  );
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "content_notice", { capacity: 5, refillRate: 1 / 900 });
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const reporterName = textField(body.reporter_name, "reporter_name", 2, 200);
  const reporterEmail = emailField(body.reporter_email);
  const url = contentUrl(body.content_url);
  const illegality = textField(body.illegality, "illegality", 10, 2000);
  const explanation = textField(body.explanation, "explanation", 20, 4000);
  if (body.good_faith !== true) {
    throw new HttpError(400, "The good-faith and accuracy declaration is required");
  }
  const reference = randomBytes(16).toString("hex");
  const ts = now();
  db.prepare(
    `INSERT INTO content_notices
       (reference, reporter_name, reporter_email, content_url, illegality, explanation,
        good_faith, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(reference, reporterName, reporterEmail, url, illegality, explanation, ts, ts);
  void sendTransactionalMessage({
    to: reporterEmail,
    subject: `Weddly content notice received · ${reference}`,
    text: `We received your notice. Reference: ${reference}\nContent: ${url}\nYou can check the outcome or appeal at ${CONFIG.frontendBaseUrl}/report-content.`,
    html: `<p>We received your notice.</p><p><strong>Reference:</strong> ${reference}</p><p>Use the reference and your email address at <a href="${CONFIG.frontendBaseUrl}/report-content">Weddly's notice status page</a>.</p>`,
  });
  return json({ reference, status: "submitted", created_at: ts }, { status: 201 });
}

function handleStatus(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "content_notice_status", { capacity: 20, refillRate: 1 / 60 });
  const reference = textField(ctx.params.reference, "reference", 32, 32);
  const email = emailField(ctx.url.searchParams.get("email"));
  const row = caseByReference(reference);
  if (!row || row.reporter_email !== email) throw new HttpError(404, "Notice not found");
  return json({ notice: publicCase(row) });
}

async function handleAppeal(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "content_notice_appeal", { capacity: 5, refillRate: 1 / 900 });
  const reference = textField(ctx.params.reference, "reference", 32, 32);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const email = emailField(body.reporter_email);
  const reason = textField(body.reason, "reason", 20, 4000);
  const row = caseByReference(reference);
  if (!row || row.reporter_email !== email) throw new HttpError(404, "Notice not found");
  if (!row.decided_at) throw new HttpError(409, "A notice can be appealed only after a decision");
  if (row.appealed_at) throw new HttpError(409, "This notice has already been appealed");
  const ts = now();
  db.prepare(
    "UPDATE content_notices SET appeal_text = ?, appealed_at = ?, updated_at = ? WHERE id = ?",
  ).run(reason, ts, ts, row.id);
  return json({ ok: true, appealed_at: ts });
}

function handleAdminList(ctx: Ctx): Response {
  requireAdmin(ctx);
  const rows = db
    .prepare("SELECT * FROM content_notices ORDER BY created_at DESC LIMIT 500")
    .all() as NoticeRow[];
  return json({ notices: rows });
}

async function handleAdminDecision(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const reference = textField(ctx.params.reference, "reference", 32, 32);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const statusRaw = String(body.status);
  if (!["reviewing", "actioned", "rejected"].includes(statusRaw)) {
    throw new HttpError(400, "status must be reviewing, actioned or rejected");
  }
  const status = statusRaw as "reviewing" | "actioned" | "rejected";
  const row = caseByReference(reference);
  if (!row) throw new HttpError(404, "Notice not found");
  const decisionReason =
    status === "reviewing" ? null : textField(body.decision_reason, "decision_reason", 20, 4000);
  const appealDecision =
    body.appeal_decision === undefined
      ? row.appeal_decision
      : textField(body.appeal_decision, "appeal_decision", 20, 4000);
  const appealDecisionInput =
    body.appeal_decision === undefined ? null : String(body.appeal_decision);
  if (body.appeal_decision !== undefined && !row.appealed_at) {
    throw new HttpError(409, "There is no appeal to decide");
  }
  const ts = now();
  db.prepare(
    `UPDATE content_notices SET status = ?, decision_reason = ?, decided_by_user_id = ?,
       decided_at = CASE WHEN ? = 'reviewing' THEN NULL ELSE ? END,
       appeal_decision = ?, appeal_decided_at = CASE WHEN ? IS NULL THEN appeal_decided_at ELSE ? END,
       updated_at = ? WHERE id = ?`,
  ).run(
    status,
    decisionReason,
    admin.id,
    status,
    ts,
    appealDecision,
    appealDecisionInput,
    ts,
    ts,
    row.id,
  );
  const updated = caseByReference(reference);
  if (!updated) throw new HttpError(500, "Notice vanished");
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "content_notice.decision",
    target_kind: "content_notice",
    target_id: row.id,
    after: { reference, status, appeal_decided: body.appeal_decision !== undefined },
  });
  if (status !== "reviewing") {
    void sendTransactionalMessage({
      to: row.reporter_email,
      subject: `Weddly content notice outcome · ${reference}`,
      text: `Decision: ${status}\nReason: ${decisionReason}\nCheck the case or appeal at ${CONFIG.frontendBaseUrl}/report-content.`,
      html: `<p><strong>Decision:</strong> ${status}</p><p>${decisionReason}</p><p>You may check the case or appeal at <a href="${CONFIG.frontendBaseUrl}/report-content">the notice status page</a>.</p>`,
    });
  }
  return json({ notice: updated });
}

export function registerContentNoticeRoutes(router: Router): void {
  router.post("/api/legal/content-notices", handleSubmit);
  router.get("/api/legal/content-notices/:reference", handleStatus);
  router.post("/api/legal/content-notices/:reference/appeal", handleAppeal);
  router.get("/api/admin/content-notices", handleAdminList, true);
  router.patch("/api/admin/content-notices/:reference", handleAdminDecision, true);
}
