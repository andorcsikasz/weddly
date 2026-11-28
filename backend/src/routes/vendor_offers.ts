// Couple-side vendor offers: import a priced offer (already extracted to JSON),
// list them, mark a decision, delete. Couple-scoped by the session; the
// payload is re-validated here with the same module the importer UI uses, so a
// hand-edited paste can never store a shape the comparison cannot read.

import {
  OFFER_STATUSES,
  type OfferStatus,
  type VendorOffer,
  type VendorOfferPayload,
  offerTotalAt,
  validateVendorOffer,
} from "@shared/vendor_offers";
import type { ApplyOfferToBudgetInput } from "@shared/offer_budget";
import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import {
  applyOfferToBudget,
  budgetLineCounts,
  releaseOfferBudgetLines,
} from "../domain/offer_budget";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface Row {
  id: number;
  couple_id: number;
  supplier_id: string | null;
  vendor_name: string;
  category: string;
  currency: string;
  quoted_at: string;
  valid_until: string | null;
  total: number;
  status: string;
  payload: string;
  created_at: number;
}

function toOffer(r: Row, budgetLines = 0): VendorOffer {
  return {
    id: r.id,
    supplier_id: r.supplier_id,
    vendor_name: r.vendor_name,
    category: r.category,
    currency: r.currency as Currency,
    quoted_at: r.quoted_at,
    valid_until: r.valid_until,
    total: r.total,
    status: r.status as OfferStatus,
    payload: JSON.parse(r.payload) as VendorOfferPayload,
    created_at: r.created_at,
    budget_lines: budgetLines,
  };
}

function coupleId(ctx: Ctx): number {
  const couple = getCoupleForUser(requireAuth(ctx));
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return couple.id;
}

function parseId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid offer id");
  return n;
}

function handleList(ctx: Ctx): Response {
  const id = coupleId(ctx);
  const rows = db
    .query<Row, [number]>(
      "SELECT * FROM vendor_offers WHERE couple_id = ? ORDER BY quoted_at DESC, id DESC",
    )
    .all(id);
  const counts = budgetLineCounts(id);
  return json({ offers: rows.map((r) => toOffer(r, counts.get(r.id) ?? 0)) });
}

async function handleImport(ctx: Ctx): Promise<Response> {
  const id = coupleId(ctx);
  const body = await readJson<{ offer?: unknown; supplier_id?: unknown }>(ctx.req);
  const parsed = validateVendorOffer(body.offer);
  if (!parsed.ok) {
    throw new HttpError(400, parsed.errors.join("; "), {
      code: "invalid_offer",
      errors: parsed.errors,
    });
  }
  const supplierId =
    typeof body.supplier_id === "string" && body.supplier_id.trim()
      ? body.supplier_id.trim().slice(0, 120)
      : null;
  const p = parsed.offer;
  const ts = now();
  const total = offerTotalAt(p, p.guest_count);
  const res = db
    .query(
      `INSERT INTO vendor_offers
        (couple_id, supplier_id, vendor_name, category, currency, quoted_at, valid_until,
         total, status, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(
      id,
      supplierId,
      p.vendor_name,
      p.category,
      p.currency,
      p.quoted_at,
      p.valid_until,
      total,
      JSON.stringify(p),
      ts,
      ts,
    );
  const row = db
    .query<Row, [number]>("SELECT * FROM vendor_offers WHERE id = ?")
    .get(Number(res.lastInsertRowid));
  if (!row) throw new HttpError(500, "Offer vanished");
  addAuditLog({
    actor_user_id: requireAuth(ctx),
    couple_id: id,
    action: "vendor_offer.import",
    target_kind: "vendor_offer",
    target_id: row.id,
  });
  return json({ offer: toOffer(row) }, { status: 201 });
}

function ownedRow(ctx: Ctx): Row {
  const id = coupleId(ctx);
  const row = db
    .query<Row, [number, number]>("SELECT * FROM vendor_offers WHERE id = ? AND couple_id = ?")
    .get(parseId(ctx.params.id), id);
  if (!row) throw new HttpError(404, "Offer not found");
  return row;
}

async function handlePatch(ctx: Ctx): Promise<Response> {
  const row = ownedRow(ctx);
  const body = await readJson<{ status?: unknown }>(ctx.req);
  if (typeof body.status !== "string" || !OFFER_STATUSES.includes(body.status as OfferStatus)) {
    throw new HttpError(400, `status must be one of ${OFFER_STATUSES.join(", ")}`);
  }
  const status = body.status as OfferStatus;
  const ts = now();
  // One chosen offer per category: choosing a second releases the first back to
  // "shortlisted", because two "winners" for one job is a decision nobody made.
  let released = 0;
  if (status === "chosen") {
    // The offers being demoted stop being the plan, so the budget lines they
    // wrote go with them. Two vendors' lines side by side would double count.
    const demoted = db
      .query<{ id: number }, [number, string, number]>(
        "SELECT id FROM vendor_offers WHERE couple_id = ? AND category = ? AND status = 'chosen' AND id != ?",
      )
      .all(row.couple_id, row.category, row.id);
    for (const d of demoted) released += releaseOfferBudgetLines(row.couple_id, d.id);
    db.query(
      "UPDATE vendor_offers SET status = 'shortlisted', updated_at = ? WHERE couple_id = ? AND category = ? AND status = 'chosen' AND id != ?",
    ).run(ts, row.couple_id, row.category, row.id);
  } else if (row.status === "chosen") {
    released += releaseOfferBudgetLines(row.couple_id, row.id);
  }
  db.query("UPDATE vendor_offers SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    ts,
    row.id,
  );
  const fresh = db.query<Row, [number]>("SELECT * FROM vendor_offers WHERE id = ?").get(row.id);
  const counts = budgetLineCounts(row.couple_id);
  return json({
    offer: toOffer(fresh as Row, counts.get(row.id) ?? 0),
    budget_lines_removed: released,
  });
}

function handleDelete(ctx: Ctx): Response {
  const row = ownedRow(ctx);
  releaseOfferBudgetLines(row.couple_id, row.id);
  db.query("DELETE FROM vendor_offers WHERE id = ?").run(row.id);
  return json({ ok: true });
}

/** POST /api/budget/offer-lines/:id: write the chosen offer into the budget as a
 *  breakdown. Registered under /api/budget on purpose: that prefix is on the
 *  billing edit gate, so a lapsed (read-only) workspace cannot write budget lines
 *  through the offers door. */
async function handleApplyToBudget(ctx: Ctx): Promise<Response> {
  const row = ownedRow(ctx);
  const couple = getCoupleForUser(requireAuth(ctx));
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const body = await readJson<Partial<ApplyOfferToBudgetInput>>(ctx.req);
  const result = applyOfferToBudget(couple, row, body);
  addAuditLog({
    actor_user_id: requireAuth(ctx),
    couple_id: couple.id,
    action: "vendor_offer.apply_to_budget",
    target_kind: "vendor_offer",
    target_id: row.id,
    after: { lines: result.line_ids.length, total: result.total },
  });
  return json(result, { status: 201 });
}

function handleRemoveFromBudget(ctx: Ctx): Response {
  const row = ownedRow(ctx);
  const removed = releaseOfferBudgetLines(row.couple_id, row.id);
  return json({ removed });
}

export function registerVendorOfferRoutes(router: Router) {
  router.get("/api/vendor-offers", handleList, true);
  router.post("/api/vendor-offers", handleImport, true);
  router.patch("/api/vendor-offers/:id", handlePatch, true);
  router.delete("/api/vendor-offers/:id", handleDelete, true);
  router.post("/api/budget/offer-lines/:id", handleApplyToBudget, true);
  router.delete("/api/budget/offer-lines/:id", handleRemoveFromBudget, true);
}
