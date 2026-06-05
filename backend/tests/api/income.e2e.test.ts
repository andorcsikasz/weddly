// Money-in ledger coverage:
//   backend/src/routes/income.ts + backend/src/domain/income.ts

import "../setup";

import { describe, expect, test } from "bun:test";
import type { CoupleIncome } from "@shared/types";
import { bootstrapCouple, req, wipeAll } from "../helpers";

interface IncomeResp {
  income: CoupleIncome;
}

describe("income: CRUD", () => {
  test("create, list, patch, delete", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("income-crud@weddly.test");

    const created = await req<IncomeResp>(
      "POST",
      "/api/income",
      { label: "Kovács család", amount_huf: 50_000, received_on: "2026-07-04" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.income.label).toBe("Kovács család");
    expect(created.data.income.amount_huf).toBe(50_000);
    expect(created.data.income.received_on).toBe("2026-07-04");

    const list = await req<{ income: CoupleIncome[] }>("GET", "/api/income", undefined, { token });
    expect(list.data.income).toHaveLength(1);

    const patched = await req<IncomeResp>(
      "PATCH",
      `/api/income/${created.data.income.id}`,
      { amount_huf: 60_000, received_on: null },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.income.amount_huf).toBe(60_000);
    expect(patched.data.income.received_on).toBeNull();

    const del = await req("DELETE", `/api/income/${created.data.income.id}`, undefined, { token });
    expect(del.status).toBe(200);
    const after = await req<{ income: CoupleIncome[] }>("GET", "/api/income", undefined, { token });
    expect(after.data.income).toHaveLength(0);
  });
});

describe("income: validation + isolation", () => {
  test("amount must be positive", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("income-amt@weddly.test");
    const r = await req("POST", "/api/income", { label: "x", amount_huf: 0 }, { token });
    expect(r.status).toBe(400);
  });

  test("label is required", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("income-label@weddly.test");
    const r = await req("POST", "/api/income", { amount_huf: 1000 }, { token });
    expect(r.status).toBe(400);
  });

  test("received_on must be ISO or null", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("income-date@weddly.test");
    const r = await req(
      "POST",
      "/api/income",
      { label: "x", amount_huf: 1000, received_on: "2026/07/04" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("a couple cannot touch another couple's income", async () => {
    wipeAll();
    const { token: aToken } = await bootstrapCouple("income-iso-a@weddly.test");
    const created = await req<IncomeResp>(
      "POST",
      "/api/income",
      { label: "Gift", amount_huf: 10_000 },
      { token: aToken },
    );
    const { token: bToken } = await bootstrapCouple("income-iso-b@weddly.test");
    const patch = await req(
      "PATCH",
      `/api/income/${created.data.income.id}`,
      { amount_huf: 999 },
      { token: bToken },
    );
    expect(patch.status).toBe(404);
    const del = await req("DELETE", `/api/income/${created.data.income.id}`, undefined, {
      token: bToken,
    });
    expect(del.status).toBe(404);
  });

  test("requires auth", async () => {
    wipeAll();
    const r = await req("GET", "/api/income");
    expect(r.status).toBe(401);
  });
});
