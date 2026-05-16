// Private DIY supplier entries — see backend/src/domain/couple_suppliers.ts
// for the model. Couple-scoped; every endpoint resolves the couple via the
// authenticated user. No admin visibility.

import type { SupplierCategory } from "@shared/suppliers";
import { getCoupleForUser } from "../domain/couples";
import * as domain from "../domain/couple_suppliers";
import { getUserById } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

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
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ suppliers: domain.listByCoupleId(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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

export function registerCoupleSupplierRoutes(router: Router) {
  router.get("/api/couple-suppliers", handleList, true);
  router.post("/api/couple-suppliers", handleCreate, true);
  router.patch("/api/couple-suppliers/:id", handleUpdate, true);
  router.delete("/api/couple-suppliers/:id", handleDelete, true);
}
