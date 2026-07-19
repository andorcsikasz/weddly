// Timestamped payment ledger for a budget row. Couple-scoped.
//
//   - GET    /api/budget/payments        → every recorded payment for the couple
//   - POST   /api/budget/payments        → record one payment (scope + amount + date)
//   - PATCH  /api/budget/payments/:id     → fix a payment's amount / date / note
//   - DELETE /api/budget/payments/:id     → remove one payment
//
// Payments are anchored by `scope` to what the user sees in the PAID column:
// 'cat:<category>' for an aggregated category row, 'line:<id>' for a custom
// line — the same scoping as budget_documents.ts (whose scope validator this
// mirrors). The cumulative paid amount stays on budget_lines.paid_huf, committed
// through the existing line/category edit path; these rows are the additive
// history behind that total.

import type { BudgetCategory, BudgetPayment } from "@shared/types";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { keyFromUploadUrl, storage } from "../lib/storage";

const VALID_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
]);

const MAX_AMOUNT = 10_000_000_000; // 10B minor units — same ceiling as installments
const MAX_PAYMENTS_PER_SCOPE = 60;

interface PaymentRow {
  id: number;
  couple_id: number;
  scope: string;
  amount_huf: number;
  paid_at: number;
  note: string | null;
  pdf_url: string | null;
  pdf_name: string | null;
  created_at: number;
}

function toPayment(r: PaymentRow): BudgetPayment {
  return {
    id: r.id,
    couple_id: r.couple_id,
    scope: r.scope,
    amount_huf: r.amount_huf,
    paid_at: r.paid_at,
    note: r.note,
    pdf_url: r.pdf_url,
    pdf_name: r.pdf_name,
    created_at: r.created_at,
  };
}

const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB, matches budget documents

/** Look up a couple-owned payment row or 404. */
function requirePayment(coupleId: number, id: number): PaymentRow {
  const row = db
    .prepare("SELECT * FROM budget_payments WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as PaymentRow | undefined;
  if (!row) throw new HttpError(404, "Payment not found");
  return row;
}

/** Delete a payment's attached PDF from storage (best-effort). */
async function deletePaymentPdf(row: PaymentRow): Promise<void> {
  if (!row.pdf_url) return;
  const key = keyFromUploadUrl(row.pdf_url);
  if (key) await storage.delete(key);
}

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, couple };
}

/** Validate `scope` and, for line scopes, confirm the line belongs to the
 *  couple so a caller can't write payments against another couple's row.
 *  Mirrors budget_documents.ts. */
function validateScope(raw: unknown, coupleId: number): string {
  if (typeof raw !== "string" || raw.length > 60) throw new HttpError(400, "Invalid scope");
  const catMatch = /^cat:([a-z_]{1,30})$/.exec(raw);
  if (catMatch) {
    if (!VALID_CATEGORIES.has(catMatch[1] as BudgetCategory)) {
      throw new HttpError(400, "Unknown category scope");
    }
    return raw;
  }
  const lineMatch = /^line:(\d{1,15})$/.exec(raw);
  if (lineMatch) {
    const lineId = Number(lineMatch[1]);
    const line = db
      .prepare("SELECT id FROM budget_lines WHERE id = ? AND couple_id = ?")
      .get(lineId, coupleId) as { id: number } | undefined;
    if (!line) throw new HttpError(404, "Budget line not found");
    return raw;
  }
  throw new HttpError(400, "scope must be 'cat:<category>' or 'line:<id>'");
}

/** Coerce a client-supplied integer amount, rejecting non-finite / out-of-range
 *  values. Payments are strictly positive — a zero/negative "payment" is a
 *  delete, handled by its own route. */
function parseAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new HttpError(400, "amount_huf must be a number");
  }
  const v = Math.round(raw);
  if (v <= 0 || v > MAX_AMOUNT) throw new HttpError(400, "amount_huf out of range");
  return v;
}

/** Coerce a client-supplied epoch-ms timestamp, defaulting to now. Guards
 *  against absurd values so a bad client can't poison sort order. */
function parsePaidAt(raw: unknown): number {
  if (raw === undefined || raw === null) return now();
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new HttpError(400, "paid_at must be an epoch-ms number");
  }
  const v = Math.round(raw);
  // Roughly [year 2000, year 2100] in ms — anything outside is a client bug.
  if (v < 946_684_800_000 || v > 4_102_444_800_000)
    throw new HttpError(400, "paid_at out of range");
  return v;
}

function parseNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, "note must be a string");
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : null;
}

function listPayments(coupleId: number): BudgetPayment[] {
  const rows = db
    .prepare("SELECT * FROM budget_payments WHERE couple_id = ? ORDER BY paid_at ASC, id ASC")
    .all(coupleId) as PaymentRow[];
  return rows.map(toPayment);
}

function handleList(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  return json({ payments: listPayments(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const body = await readJson<{
    scope?: unknown;
    amount_huf?: unknown;
    paid_at?: unknown;
    note?: unknown;
  }>(ctx.req);

  const scope = validateScope(body.scope, couple.id);
  const amount = parseAmount(body.amount_huf);
  const paidAt = parsePaidAt(body.paid_at);
  const note = parseNote(body.note);

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM budget_payments WHERE couple_id = ? AND scope = ?")
    .get(couple.id, scope) as { n: number };
  if (count.n >= MAX_PAYMENTS_PER_SCOPE) {
    throw new HttpError(400, "Too many payments on this row");
  }

  const ts = now();
  const info = db
    .prepare(
      "INSERT INTO budget_payments (couple_id, scope, amount_huf, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(couple.id, scope, amount, paidAt, note, ts);
  const id = Number(info.lastInsertRowid);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.payment_create",
    target_kind: "budget_payment",
    target_id: id,
    after: { scope, amount_huf: amount, paid_at: paidAt },
  });

  const row = db.prepare("SELECT * FROM budget_payments WHERE id = ?").get(id) as PaymentRow;
  return json({ payment: toPayment(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");

  const existing = db
    .prepare("SELECT * FROM budget_payments WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as PaymentRow | undefined;
  if (!existing) throw new HttpError(404, "Payment not found");

  const body = await readJson<{
    amount_huf?: unknown;
    paid_at?: unknown;
    note?: unknown;
  }>(ctx.req);

  const amount = body.amount_huf === undefined ? existing.amount_huf : parseAmount(body.amount_huf);
  const paidAt = body.paid_at === undefined ? existing.paid_at : parsePaidAt(body.paid_at);
  const note = body.note === undefined ? existing.note : parseNote(body.note);

  db.prepare(
    "UPDATE budget_payments SET amount_huf = ?, paid_at = ?, note = ? WHERE id = ? AND couple_id = ?",
  ).run(amount, paidAt, note, id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.payment_update",
    target_kind: "budget_payment",
    target_id: id,
    before: { amount_huf: existing.amount_huf, paid_at: existing.paid_at },
    after: { amount_huf: amount, paid_at: paidAt },
  });

  const row = db.prepare("SELECT * FROM budget_payments WHERE id = ?").get(id) as PaymentRow;
  return json({ payment: toPayment(row) });
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");

  const row = db
    .prepare("SELECT * FROM budget_payments WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as PaymentRow | undefined;
  if (!row) throw new HttpError(404, "Payment not found");

  db.prepare("DELETE FROM budget_payments WHERE id = ? AND couple_id = ?").run(id, couple.id);
  // Drop the attached invoice/receipt too so a deleted payment leaves no orphan.
  await deletePaymentPdf(row);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.payment_delete",
    target_kind: "budget_payment",
    target_id: id,
    before: { scope: row.scope, amount_huf: row.amount_huf, paid_at: row.paid_at },
  });

  return json({ ok: true });
}

/** Attach (or replace) a PDF invoice/receipt on a single payment. Multipart
 *  `file`. PDF only, validated by magic bytes — never trust the client type.
 *  The file is PRIVATE: stored under a `budget-payments` key the public
 *  /uploads/* handler refuses, readable only through handleDownloadPdf. */
async function handleUploadPdf(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  const existing = requirePayment(couple.id, id);

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const file = form.get("file");
  if (!(file instanceof File))
    throw new HttpError(400, "`file` field required", {
      code: "missing_file",
    });
  if (file.size <= 0) throw new HttpError(400, "Empty file", { code: "empty_file" });
  if (file.size > MAX_PDF_BYTES) {
    throw new HttpError(413, `File too large (max ${MAX_PDF_BYTES / 1024 / 1024} MB)`, {
      code: "file_too_large",
    });
  }
  const head = new Uint8Array(await file.arrayBuffer()).subarray(0, 5);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  if ((file.type && file.type !== "application/pdf") || !isPdf) {
    throw new HttpError(415, "Only PDF files are allowed", { code: "unsupported_type" });
  }
  // Sanitised display name: strip path, cap length, guarantee a .pdf suffix.
  let name = (file.name || "szamla.pdf")
    .replace(/^.*[\\/]/, "")
    .trim()
    .slice(0, 200);
  if (name.length === 0) name = "szamla.pdf";
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`;

  // Replacing an existing PDF: drop the old object first (same key is reused
  // but the ?v= cache-buster changes).
  await deletePaymentPdf(existing);

  const ts = now();
  const key = `couples/${couple.id}/budget-payments/${id}.pdf`;
  await storage.write(key, file, "application/pdf");
  const pdfUrl = `/uploads/couples/${couple.id}/budget-payments/${id}.pdf?v=${ts}`;
  db.prepare(
    "UPDATE budget_payments SET pdf_url = ?, pdf_name = ? WHERE id = ? AND couple_id = ?",
  ).run(pdfUrl, name, id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.payment_pdf_upload",
    target_kind: "budget_payment",
    target_id: id,
    after: { pdf_name: name, bytes: file.size },
  });

  return json({ payment: toPayment(requirePayment(couple.id, id)) });
}

/** Stream a payment's private PDF. Couple-gated (never the public /uploads/*). */
async function handleDownloadPdf(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  const row = requirePayment(couple.id, id);
  const key = row.pdf_url ? keyFromUploadUrl(row.pdf_url) : null;
  const served = key ? await storage.serve(key) : null;
  if (!served) throw new HttpError(404, "No PDF on this payment");
  const safeName = (row.pdf_name ?? "szamla.pdf").replace(/[\r\n"\\]/g, "_").slice(0, 200);
  const headers = new Headers(served.headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `inline; filename="${safeName}"`);
  return new Response(served.body, { headers });
}

/** Detach + delete a payment's PDF. */
async function handleRemovePdf(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  const row = requirePayment(couple.id, id);
  await deletePaymentPdf(row);
  db.prepare(
    "UPDATE budget_payments SET pdf_url = NULL, pdf_name = NULL WHERE id = ? AND couple_id = ?",
  ).run(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.payment_pdf_remove",
    target_kind: "budget_payment",
    target_id: id,
  });
  return json({ payment: toPayment(requirePayment(couple.id, id)) });
}

export function registerBudgetPaymentRoutes(router: Router) {
  router.get("/api/budget/payments", handleList, true);
  router.post("/api/budget/payments", handleCreate, true);
  router.patch("/api/budget/payments/:id", handleUpdate, true);
  router.delete("/api/budget/payments/:id", handleDelete, true);
  router.post("/api/budget/payments/:id/pdf", handleUploadPdf, true);
  router.get("/api/budget/payments/:id/download", handleDownloadPdf, true);
  router.delete("/api/budget/payments/:id/pdf", handleRemovePdf, true);
}
