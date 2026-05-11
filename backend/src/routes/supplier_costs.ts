// Couple-scoped planned + final cost tracking against directory suppliers.
// One row per (couple, supplier). Auto-upserted from the /app/suppliers card.

import { getCoupleForUser } from "../domain/couples";
import {
  listCoupleSupplierCosts,
  toCoupleSupplierCost,
  upsertCoupleSupplierCost,
} from "../domain/supplier_costs";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface UpsertBody {
  planned_huf?: unknown;
  actual_huf?: unknown;
  notes?: unknown;
}

function parseHuf(v: unknown, field: string): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpError(400, `${field} must be an integer`);
  }
  if (n < 0) throw new HttpError(400, `${field} must be >= 0`);
  if (n > 9_999_999_999) throw new HttpError(400, `${field} too large`);
  return n;
}

async function handleList(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "Couple not found");
  const rows = listCoupleSupplierCosts(couple.id);
  return json({ costs: rows.map(toCoupleSupplierCost) });
}

async function handleUpsert(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "Couple not found");

  const supplierId = ctx.params.supplier_id?.trim();
  if (!supplierId) throw new HttpError(400, "supplier_id required");
  if (supplierId.length > 80) throw new HttpError(400, "supplier_id too long");

  const body = await readJson<UpsertBody>(ctx.req);
  const planned_huf = parseHuf(body.planned_huf, "planned_huf");
  const actual_huf = parseHuf(body.actual_huf, "actual_huf");
  let notes: string | null = null;
  if (typeof body.notes === "string" && body.notes.trim()) {
    const n = body.notes.trim();
    if (n.length > 500) throw new HttpError(400, "notes too long (max 500)");
    notes = n;
  }

  const row = upsertCoupleSupplierCost(couple.id, supplierId, {
    planned_huf,
    actual_huf,
    notes,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "supplier_cost.upsert",
    target_kind: "supplier_cost",
    target_id: row.id,
    after: { supplier_id: supplierId, planned_huf, actual_huf },
  });

  return json({ cost: toCoupleSupplierCost(row) });
}

export function registerSupplierCostRoutes(router: Router) {
  router.get("/api/couples/supplier-costs", handleList, true);
  router.put("/api/couples/supplier-costs/:supplier_id", handleUpsert, true);
}
