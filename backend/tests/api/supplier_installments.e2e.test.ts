// Payment-schedule (installments) coverage for couple_suppliers:
//   backend/src/routes/couple_suppliers.ts  (installment endpoints)
//   backend/src/domain/supplier_installments.ts
// Asserts the core invariant: when a supplier has installments they are the
// source of truth — the mirrored budget line's actual_huf equals the sum of
// PAID installments, and couple_suppliers.paid is derived (fully settled).

import "../setup";

import { describe, expect, test } from "bun:test";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import { bootstrapCouple, req, wipeAll } from "../helpers";

interface SupplierResp {
  supplier: CoupleSupplier;
}
interface BudgetLine {
  id: number;
  planned_huf: number;
  actual_huf: number;
}

async function createPricedSupplier(token: string, priceHuf: number): Promise<CoupleSupplier> {
  const r = await req<SupplierResp>(
    "POST",
    "/api/couple-suppliers",
    { name: "DJ Marci", category: "music_dj", price_huf: priceHuf, paid: false },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.supplier;
}

async function actualOf(token: string, lineId: number): Promise<number> {
  const r = await req<{ lines: BudgetLine[] }>("GET", "/api/budget/lines", undefined, { token });
  const line = r.data.lines.find((l) => l.id === lineId);
  expect(line).toBeDefined();
  return line!.actual_huf;
}

describe("supplier installments: paid portions drive the budget mirror", () => {
  test("unpaid installment leaves actual at 0; marking paid lifts it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-basic@weddly.test");
    const supplier = await createPricedSupplier(token, 120_000);
    const lineId = supplier.budget_line_id!;
    expect(lineId).not.toBeNull();
    // paid:false on create → mirror actual starts at 0.
    expect(await actualOf(token, lineId)).toBe(0);

    // Add a 40k deposit, unpaid.
    const add = await req<SupplierResp>(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { label: "Foglaló", amount_huf: 40_000, due_date: "2026-07-01", paid: false },
      { token },
    );
    expect(add.status).toBe(201);
    expect(add.data.supplier.installments).toHaveLength(1);
    expect(add.data.supplier.installments[0]!.paid).toBe(false);
    expect(add.data.supplier.paid).toBe(false);
    expect(await actualOf(token, lineId)).toBe(0);

    // Mark the deposit paid → actual = 40k, but not fully paid (40k < 120k).
    const instId = add.data.supplier.installments[0]!.id;
    const pay = await req<SupplierResp>(
      "PATCH",
      `/api/couple-suppliers/${supplier.id}/installments/${instId}`,
      { paid: true },
      { token },
    );
    expect(pay.status).toBe(200);
    expect(pay.data.supplier.installments[0]!.paid).toBe(true);
    expect(pay.data.supplier.installments[0]!.paid_at).not.toBeNull();
    expect(pay.data.supplier.paid).toBe(false);
    expect(await actualOf(token, lineId)).toBe(40_000);
  });

  test("paying the full schedule marks the supplier paid", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-full@weddly.test");
    const supplier = await createPricedSupplier(token, 120_000);
    const lineId = supplier.budget_line_id!;

    await req(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 40_000, paid: true },
      { token },
    );
    const last = await req<SupplierResp>(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 80_000, paid: true },
      { token },
    );
    expect(last.data.supplier.installments).toHaveLength(2);
    // 40k + 80k = 120k = price → fully paid.
    expect(last.data.supplier.paid).toBe(true);
    expect(await actualOf(token, lineId)).toBe(120_000);
  });

  test("deleting a paid installment lowers actual again", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-del@weddly.test");
    const supplier = await createPricedSupplier(token, 120_000);
    const lineId = supplier.budget_line_id!;

    const a = await req<SupplierResp>(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 50_000, paid: true },
      { token },
    );
    await req(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 70_000, paid: true },
      { token },
    );
    expect(await actualOf(token, lineId)).toBe(120_000);

    const firstId = a.data.supplier.installments[0]!.id;
    const del = await req<SupplierResp>(
      "DELETE",
      `/api/couple-suppliers/${supplier.id}/installments/${firstId}`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.supplier.installments).toHaveLength(1);
    expect(await actualOf(token, lineId)).toBe(70_000);
    expect(del.data.supplier.paid).toBe(false);
  });

  test("editing amount + due date recomputes", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-edit@weddly.test");
    const supplier = await createPricedSupplier(token, 100_000);
    const lineId = supplier.budget_line_id!;
    const add = await req<SupplierResp>(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 30_000, paid: true },
      { token },
    );
    const instId = add.data.supplier.installments[0]!.id;
    expect(await actualOf(token, lineId)).toBe(30_000);

    const edit = await req<SupplierResp>(
      "PATCH",
      `/api/couple-suppliers/${supplier.id}/installments/${instId}`,
      { amount_huf: 55_000, due_date: "2026-08-15" },
      { token },
    );
    expect(edit.status).toBe(200);
    expect(edit.data.supplier.installments[0]!.amount_huf).toBe(55_000);
    expect(edit.data.supplier.installments[0]!.due_date).toBe("2026-08-15");
    expect(await actualOf(token, lineId)).toBe(55_000);
  });
});

describe("supplier installments: validation + isolation", () => {
  test("amount must be positive", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-val-amt@weddly.test");
    const supplier = await createPricedSupplier(token, 100_000);
    const r = await req(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 0 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("due_date must be ISO YYYY-MM-DD", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-val-date@weddly.test");
    const supplier = await createPricedSupplier(token, 100_000);
    const r = await req(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 1000, due_date: "2026/08/15" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("404 for an unknown supplier", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("inst-404@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers/deadbeef/installments",
      { amount_huf: 1000 },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("a couple cannot touch another couple's supplier installments", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("inst-iso-a@weddly.test");
    const supplier = await createPricedSupplier(aToken, 100_000);
    const { token: bToken } = await bootstrapCouple("inst-iso-b@weddly.test");
    const r = await req(
      "POST",
      `/api/couple-suppliers/${supplier.id}/installments`,
      { amount_huf: 1000 },
      { token: bToken },
    );
    expect(r.status).toBe(404);
  });
});
