// Private DIY supplier entries — see backend/src/domain/couple_suppliers.ts
// for the model. Couple-scoped; every endpoint resolves the couple via the
// authenticated user. No admin visibility.

import type { SupplierCategory } from "@shared/suppliers";
import { getCoupleForUser } from "../domain/couples";
import * as domain from "../domain/couple_suppliers";
import * as installments from "../domain/supplier_installments";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "venue",
  "accommodation",
  "tent_pavilion",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "sound_tech",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "nails",
  "rings",
  "stationery",
  "wedding_website",
  "transport",
]);

interface Body {
  name?: unknown;
  category?: unknown;
  notes?: unknown;
  price_huf?: unknown;
  paid?: unknown;
}

interface ParsedFields {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
}

function parseBody(body: Body, partial: boolean): ParsedFields {
  const out: ParsedFields = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw new HttpError(400, "name must be a string");
    const trimmed = body.name.trim();
    if (!trimmed) throw new HttpError(400, "name required");
    if (trimmed.length > 120) throw new HttpError(400, "name too long (max 120)");
    out.name = trimmed;
  } else if (!partial) {
    throw new HttpError(400, "name required");
  }

  if (body.category !== undefined) {
    const c = typeof body.category === "string" ? body.category : "";
    if (!VALID_CATEGORIES.has(c as SupplierCategory)) {
      throw new HttpError(400, "Invalid category");
    }
    out.category = c as SupplierCategory;
  } else if (!partial) {
    throw new HttpError(400, "category required");
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

  if (body.price_huf !== undefined) {
    if (body.price_huf === null || body.price_huf === "") {
      out.price_huf = null;
    } else {
      const n = Number(body.price_huf);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) {
        throw new HttpError(400, "price_huf out of range");
      }
      const rounded = Math.round(n);
      out.price_huf = rounded > 0 ? rounded : null;
    }
  }

  if (body.paid !== undefined) {
    if (typeof body.paid !== "boolean") throw new HttpError(400, "paid must be a boolean");
    out.paid = body.paid;
  }

  return out;
}

async function handleList(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ suppliers: domain.listByCoupleId(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Body>(ctx.req);
  const parsed = parseBody(body, false);
  if (!parsed.name || !parsed.category) {
    throw new HttpError(400, "name and category required");
  }

  const created = domain.insert(couple.id, {
    name: parsed.name,
    category: parsed.category,
    notes: parsed.notes ?? null,
    price_huf: parsed.price_huf ?? null,
    paid: parsed.paid ?? false,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple_supplier.create",
    target_kind: "couple_supplier",
    target_id: null,
    note: created.id,
    after: {
      name: created.name,
      category: created.category,
      price_huf: created.price_huf,
      paid: created.paid,
    },
  });

  return json({ supplier: created }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = ctx.params.id;
  if (!id) throw new HttpError(400, "Invalid id");

  const body = await readJson<Body>(ctx.req);
  const parsed = parseBody(body, true);

  // Snapshot the previous `paid` value so the audit-log diff can surface the
  // flip on the activity panel.
  const previous = domain.getById(id, couple.id);

  const updated = domain.update(id, couple.id, parsed);
  if (!updated) throw new HttpError(404, "Supplier not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple_supplier.update",
    target_kind: "couple_supplier",
    target_id: null,
    note: id,
    before: previous
      ? {
          name: previous.name,
          category: previous.category,
          price_huf: previous.price_huf,
          paid: previous.paid,
        }
      : undefined,
    after: {
      name: updated.name,
      category: updated.category,
      price_huf: updated.price_huf,
      paid: updated.paid,
    },
  });

  return json({ supplier: updated });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = ctx.params.id;
  if (!id) throw new HttpError(400, "Invalid id");

  const ok = domain.deleteById(id, couple.id);
  if (!ok) throw new HttpError(404, "Supplier not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple_supplier.delete",
    target_kind: "couple_supplier",
    target_id: null,
    note: id,
  });

  return json({ ok: true });
}

// ── Payment schedule (installments) ─────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface InstallmentBody {
  label?: unknown;
  amount_huf?: unknown;
  due_date?: unknown;
  paid?: unknown;
}

interface ParsedInstallment {
  label?: string | null;
  amount_huf?: number;
  due_date?: string | null;
  paid?: boolean;
}

function parseInstallmentBody(body: InstallmentBody, partial: boolean): ParsedInstallment {
  const out: ParsedInstallment = {};

  if (body.label !== undefined) {
    if (body.label === null) {
      out.label = null;
    } else if (typeof body.label === "string") {
      const trimmed = body.label.trim();
      if (trimmed.length > 80) throw new HttpError(400, "label too long (max 80)");
      out.label = trimmed || null;
    } else {
      throw new HttpError(400, "label must be a string or null");
    }
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

  if (body.due_date !== undefined) {
    if (body.due_date === null || body.due_date === "") {
      out.due_date = null;
    } else if (typeof body.due_date === "string" && ISO_DATE.test(body.due_date)) {
      out.due_date = body.due_date;
    } else {
      throw new HttpError(400, "due_date must be YYYY-MM-DD or null");
    }
  }

  if (body.paid !== undefined) {
    if (typeof body.paid !== "boolean") throw new HttpError(400, "paid must be a boolean");
    out.paid = body.paid;
  }

  return out;
}

/** Resolve the couple + assert the DIY supplier in the path belongs to it.
 *  Returns { coupleId, supplierId } or throws 400/404. */
function requireOwnedSupplier(ctx: Ctx): { userId: number; coupleId: number; supplierId: string } {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const supplierId = ctx.params.id;
  if (!supplierId) throw new HttpError(400, "Invalid supplier id");
  if (!domain.getById(supplierId, couple.id)) throw new HttpError(404, "Supplier not found");
  return { userId, coupleId: couple.id, supplierId };
}

async function handleCreateInstallment(ctx: Ctx): Promise<Response> {
  const { userId, coupleId, supplierId } = requireOwnedSupplier(ctx);
  const body = await readJson<InstallmentBody>(ctx.req);
  const parsed = parseInstallmentBody(body, false);
  if (parsed.amount_huf === undefined) throw new HttpError(400, "amount_huf required");

  installments.createInstallment(coupleId, supplierId, {
    label: parsed.label ?? null,
    amount_huf: parsed.amount_huf,
    due_date: parsed.due_date ?? null,
    paid: parsed.paid ?? false,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "supplier_installment.create",
    target_kind: "couple_supplier",
    target_id: null,
    note: supplierId,
    after: {
      amount_huf: parsed.amount_huf,
      due_date: parsed.due_date ?? null,
      paid: parsed.paid ?? false,
    },
  });

  const supplier = domain.getById(supplierId, coupleId);
  return json({ supplier }, { status: 201 });
}

async function handleUpdateInstallment(ctx: Ctx): Promise<Response> {
  const { userId, coupleId, supplierId } = requireOwnedSupplier(ctx);
  const installmentId = Number(ctx.params.iid);
  if (!Number.isInteger(installmentId)) throw new HttpError(400, "Invalid installment id");

  const body = await readJson<InstallmentBody>(ctx.req);
  const parsed = parseInstallmentBody(body, true);

  const updated = installments.updateInstallment(coupleId, supplierId, installmentId, parsed);
  if (!updated) throw new HttpError(404, "Installment not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "supplier_installment.update",
    target_kind: "couple_supplier",
    target_id: null,
    note: supplierId,
    after: { id: installmentId, paid: updated.paid, amount_huf: updated.amount_huf },
  });

  const supplier = domain.getById(supplierId, coupleId);
  return json({ supplier });
}

function handleDeleteInstallment(ctx: Ctx): Response {
  const { userId, coupleId, supplierId } = requireOwnedSupplier(ctx);
  const installmentId = Number(ctx.params.iid);
  if (!Number.isInteger(installmentId)) throw new HttpError(400, "Invalid installment id");

  const ok = installments.deleteInstallment(coupleId, supplierId, installmentId);
  if (!ok) throw new HttpError(404, "Installment not found");

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "supplier_installment.delete",
    target_kind: "couple_supplier",
    target_id: null,
    note: supplierId,
  });

  const supplier = domain.getById(supplierId, coupleId);
  return json({ supplier });
}

export function registerCoupleSupplierRoutes(router: Router) {
  router.get("/api/couple-suppliers", handleList, true);
  router.post("/api/couple-suppliers", handleCreate, true);
  router.patch("/api/couple-suppliers/:id", handleUpdate, true);
  router.delete("/api/couple-suppliers/:id", handleDelete, true);
  router.post("/api/couple-suppliers/:id/installments", handleCreateInstallment, true);
  router.patch("/api/couple-suppliers/:id/installments/:iid", handleUpdateInstallment, true);
  router.delete("/api/couple-suppliers/:id/installments/:iid", handleDeleteInstallment, true);
}
