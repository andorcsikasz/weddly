// Money-in ledger endpoints. Couple-scoped; every endpoint resolves the couple
// via the authenticated user. See backend/src/domain/income.ts for the model.

import { getCoupleForUser } from "../domain/couples";
import * as domain from "../domain/income";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Body {
  label?: unknown;
  amount_huf?: unknown;
  received_on?: unknown;
  notes?: unknown;
}

interface Parsed {
  label?: string;
  amount_huf?: number;
  received_on?: string | null;
  notes?: string | null;
}

function parseBody(body: Body, partial: boolean): Parsed {
  const out: Parsed = {};

  if (body.label !== undefined) {
    if (typeof body.label !== "string") throw new HttpError(400, "label must be a string");
    const trimmed = body.label.trim();
    if (!trimmed) throw new HttpError(400, "label required");
    if (trimmed.length > 120) throw new HttpError(400, "label too long (max 120)");
    out.label = trimmed;
  } else if (!partial) {
    throw new HttpError(400, "label required");
  }

  if (body.amount_huf !== undefined) {
    const n = Number(body.amount_huf);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000_000) {
      throw new HttpError(400, "amount_huf out of range");
    }
    out.amount_huf = Math.round(n);
  } else if (!partial) {
    throw new HttpError(400, "amount_huf required");
  }

  if (body.received_on !== undefined) {
    if (body.received_on === null || body.received_on === "") {
      out.received_on = null;
    } else if (typeof body.received_on === "string" && ISO_DATE.test(body.received_on)) {
      out.received_on = body.received_on;
    } else {
      throw new HttpError(400, "received_on must be YYYY-MM-DD or null");
    }
  }

  if (body.notes !== undefined) {
    if (body.notes === null) {
      out.notes = null;
    } else if (typeof body.notes === "string") {
      const trimmed = body.notes.trim();
      if (trimmed.length > 500) throw new HttpError(400, "notes too long (max 500)");
      out.notes = trimmed || null;
    } else {
      throw new HttpError(400, "notes must be a string or null");
    }
  }

  return out;
}

function requireCouple(ctx: Ctx): { userId: number; coupleId: number } {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, coupleId: couple.id };
}

function handleList(ctx: Ctx): Response {
  const { coupleId } = requireCouple(ctx);
  return json({ income: domain.listByCoupleId(coupleId) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const parsed = parseBody(await readJson<Body>(ctx.req), false);
  if (!parsed.label || parsed.amount_huf === undefined) {
    throw new HttpError(400, "label and amount_huf required");
  }
  const created = domain.insert(coupleId, {
    label: parsed.label,
    amount_huf: parsed.amount_huf,
    received_on: parsed.received_on ?? null,
    notes: parsed.notes ?? null,
  });
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "income.create",
    target_kind: "couple_income",
    target_id: created.id,
    after: { label: created.label, amount_huf: created.amount_huf },
  });
  return json({ income: created }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const parsed = parseBody(await readJson<Body>(ctx.req), true);
  const updated = domain.update(id, coupleId, parsed);
  if (!updated) throw new HttpError(404, "Income entry not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "income.update",
    target_kind: "couple_income",
    target_id: id,
    after: { label: updated.label, amount_huf: updated.amount_huf },
  });
  return json({ income: updated });
}

function handleDelete(ctx: Ctx): Response {
  const { userId, coupleId } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  if (!domain.deleteById(id, coupleId)) throw new HttpError(404, "Income entry not found");
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "income.delete",
    target_kind: "couple_income",
    target_id: id,
  });
  return json({ ok: true });
}

export function registerIncomeRoutes(router: Router) {
  router.get("/api/income", handleList, true);
  router.post("/api/income", handleCreate, true);
  router.patch("/api/income/:id", handleUpdate, true);
  router.delete("/api/income/:id", handleDelete, true);
}
