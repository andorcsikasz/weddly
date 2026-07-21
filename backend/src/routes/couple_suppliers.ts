// Private DIY supplier entries — see backend/src/domain/couple_suppliers.ts
// for the model. Couple-scoped; every endpoint resolves the couple via the
// authenticated user. No admin visibility.

import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { getCoupleForUser } from "../domain/couples";
import * as domain from "../domain/couple_suppliers";
import * as installments from "../domain/supplier_installments";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

// Derived from the single taxonomy source so it can never drift from the enum.
const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set(
  SUPPLIER_GROUPS.flatMap((g) => g.categories),
);

interface Body {
  name?: unknown;
  category?: unknown;
  notes?: unknown;
  price_huf?: unknown;
  paid?: unknown;
  city?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  contact_email?: unknown;
  contact_phone?: unknown;
}

interface ParsedFields {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

/** Trimmed nullable string with a max length. `null` and `""` both clear the
 *  field; anything non-string is a 400. */
function parseNullableStr(v: unknown, field: string, max: number): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string or null`);
  const trimmed = v.trim();
  if (trimmed.length > max) throw new HttpError(400, `${field} too long (max ${max})`);
  return trimmed || null;
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

  if (body.city !== undefined) out.city = parseNullableStr(body.city, "city", 120);
  if (body.address !== undefined) out.address = parseNullableStr(body.address, "address", 300);
  if (body.contact_phone !== undefined) {
    out.contact_phone = parseNullableStr(body.contact_phone, "contact_phone", 40);
  }
  if (body.contact_email !== undefined) {
    const email = parseNullableStr(body.contact_email, "contact_email", 200);
    // A deliberately loose shape check — the user/geocoder supplies these and we
    // never send to them, so we only guard against obvious garbage.
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, "contact_email is not a valid email");
    }
    out.contact_email = email;
  }

  // Coordinates move as a pair: send both (numbers to set, null/"" to clear) or
  // neither. A lone lat or lng — or a number paired with a null — is rejected so
  // a venue pin can't end up half-defined.
  if (body.lat !== undefined || body.lng !== undefined) {
    if (body.lat === undefined || body.lng === undefined) {
      throw new HttpError(400, "lat and lng must be sent together");
    }
    const latNull = body.lat === null || body.lat === "";
    const lngNull = body.lng === null || body.lng === "";
    if (latNull !== lngNull) throw new HttpError(400, "lat and lng must be set together");
    if (latNull) {
      out.lat = null;
      out.lng = null;
    } else {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new HttpError(400, "lat out of range");
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new HttpError(400, "lng out of range");
      }
      out.lat = lat;
      out.lng = lng;
    }
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
    city: parsed.city ?? null,
    address: parsed.address ?? null,
    lat: parsed.lat ?? null,
    lng: parsed.lng ?? null,
    contact_email: parsed.contact_email ?? null,
    contact_phone: parsed.contact_phone ?? null,
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
