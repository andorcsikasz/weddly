// Budget payments — the timestamped ledger behind the PAID column. Each row is
// one payment ("20% paid today"), anchored by `scope` ('cat:<category>' for an
// aggregated category row, 'line:<id>' for a custom line). Covers create / list
// / update / delete, scope validation, amount + date guards, the paid_at
// default, cross-couple isolation, and the read-only (402) gate for lapsed
// couples.

import "../setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BudgetLine, BudgetPayment } from "@shared/types";
import { db } from "../../src/db";
import { setBillingEnforcement } from "../../src/domain/billing";
import { bootstrapCouple, expireTrialGraceWindow, req, wipeAll } from "../helpers";

/** Seed the founding cohort so a fresh couple stays on the (expirable) trial
 *  rather than being auto-granted founding — mirrors budget_documents.e2e. */
function seedFoundingCohort(n: number): void {
  const until = Date.now() + 1000 * 60 * 60 * 24 * 365;
  const insert = db.prepare(
    `INSERT INTO couples (id, partner_a_id, display_name, bride_name, groom_name,
       style_tags_json, frozen_categories_json, status, subscription_status,
       is_founding_member, founding_until, created_at, updated_at, is_demo)
     VALUES (?, 1, 'x', '', '', '[]', '[]', 'active', 'founding', 1, ?, 1, 1, 0)`,
  );
  db.transaction(() => {
    for (let i = 1; i <= n; i++) insert.run(-i, until);
  })();
}

async function createLine(token: string): Promise<number> {
  const r = await req<{ line: BudgetLine }>(
    "POST",
    "/api/budget/lines",
    { category: "other", label: "Custom thing", planned_huf: 1000, actual_huf: 500_000 },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.line.id;
}

describe("budget payments — record, list, edit, delete", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("a fresh couple has no payments", async () => {
    const { token } = await bootstrapCouple("bp-empty@weddly.test");
    const r = await req<{ payments: BudgetPayment[] }>("GET", "/api/budget/payments", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.payments).toEqual([]);
  });

  test("records a payment to a category scope → 201 with the entered date", async () => {
    const { token } = await bootstrapCouple("bp-cat@weddly.test");
    const paidAt = Date.parse("2026-06-01T12:00:00.000Z");
    const res = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope: "cat:venue", amount_huf: 60_000, paid_at: paidAt },
      { token },
    );
    expect(res.status).toBe(201);
    expect(res.data.payment.scope).toBe("cat:venue");
    expect(res.data.payment.amount_huf).toBe(60_000);
    expect(res.data.payment.paid_at).toBe(paidAt);

    const list = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      { token },
    );
    expect(list.data.payments).toHaveLength(1);
  });

  test("paid_at defaults to now when omitted", async () => {
    const { token } = await bootstrapCouple("bp-default@weddly.test");
    const before = Date.now();
    const res = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope: "cat:catering", amount_huf: 1000 },
      { token },
    );
    expect(res.status).toBe(201);
    expect(res.data.payment.paid_at).toBeGreaterThanOrEqual(before);
    expect(res.data.payment.paid_at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("two installments on a line read back in chronological order (20% + 80%)", async () => {
    const { token } = await bootstrapCouple("bp-two@weddly.test");
    const lineId = await createLine(token);
    const scope = `line:${lineId}`;
    const first = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope, amount_huf: 100_000, paid_at: Date.parse("2026-05-01T12:00:00Z") },
      { token },
    );
    expect(first.status).toBe(201);
    const second = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope, amount_huf: 400_000, paid_at: Date.parse("2026-06-01T12:00:00Z") },
      { token },
    );
    expect(second.status).toBe(201);

    const list = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      { token },
    );
    const mine = list.data.payments.filter((p) => p.scope === scope);
    expect(mine.map((p) => p.amount_huf)).toEqual([100_000, 400_000]);
  });

  test("PATCH edits a payment's amount and date", async () => {
    const { token } = await bootstrapCouple("bp-patch@weddly.test");
    const created = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope: "cat:rings", amount_huf: 1000 },
      { token },
    );
    const id = created.data.payment.id;
    const newDate = Date.parse("2026-01-15T12:00:00Z");
    const patched = await req<{ payment: BudgetPayment }>(
      "PATCH",
      `/api/budget/payments/${id}`,
      { amount_huf: 2500, paid_at: newDate },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.payment.amount_huf).toBe(2500);
    expect(patched.data.payment.paid_at).toBe(newDate);
  });

  test("DELETE removes a payment", async () => {
    const { token } = await bootstrapCouple("bp-del@weddly.test");
    const created = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope: "cat:decor_floral", amount_huf: 1000 },
      { token },
    );
    const del = await req("DELETE", `/api/budget/payments/${created.data.payment.id}`, undefined, {
      token,
    });
    expect(del.status).toBe(200);
    const list = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      { token },
    );
    expect(list.data.payments).toEqual([]);
  });

  test("rejects non-positive amounts and bad scopes", async () => {
    const { token } = await bootstrapCouple("bp-bad@weddly.test");
    const zero = await req(
      "POST",
      "/api/budget/payments",
      { scope: "cat:venue", amount_huf: 0 },
      {
        token,
      },
    );
    expect(zero.status).toBe(400);
    const neg = await req(
      "POST",
      "/api/budget/payments",
      { scope: "cat:venue", amount_huf: -50 },
      { token },
    );
    expect(neg.status).toBe(400);
    const unknownCat = await req(
      "POST",
      "/api/budget/payments",
      { scope: "cat:nope", amount_huf: 100 },
      { token },
    );
    expect(unknownCat.status).toBe(400);
    const garbage = await req(
      "POST",
      "/api/budget/payments",
      { scope: "weird", amount_huf: 100 },
      { token },
    );
    expect(garbage.status).toBe(400);
  });

  test("a foreign line scope is rejected (404)", async () => {
    const { token: tokenA } = await bootstrapCouple("bp-iso-a@weddly.test");
    const lineId = await createLine(tokenA);
    const { token: tokenB } = await bootstrapCouple("bp-iso-b@weddly.test");
    const res = await req(
      "POST",
      "/api/budget/payments",
      { scope: `line:${lineId}`, amount_huf: 100 },
      { token: tokenB },
    );
    expect(res.status).toBe(404);
  });

  test("a couple cannot see or delete another couple's payment", async () => {
    const { token: tokenA } = await bootstrapCouple("bp-x-a@weddly.test");
    const created = await req<{ payment: BudgetPayment }>(
      "POST",
      "/api/budget/payments",
      { scope: "cat:venue", amount_huf: 5000 },
      { token: tokenA },
    );
    const { token: tokenB } = await bootstrapCouple("bp-x-b@weddly.test");
    const list = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      { token: tokenB },
    );
    expect(list.data.payments).toEqual([]);
    const del = await req("DELETE", `/api/budget/payments/${created.data.payment.id}`, undefined, {
      token: tokenB,
    });
    expect(del.status).toBe(404);
  });

  test("a lapsed couple cannot record payments (402) but can still read", async () => {
    seedFoundingCohort(200);
    const { token, coupleId } = await bootstrapCouple("bp-lapsed@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId);
    setBillingEnforcement(true, 1);
    expireTrialGraceWindow(); // ...and long enough ago that the grace week is over

    const read = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      { token },
    );
    expect(read.status).toBe(200);

    const blocked = await req(
      "POST",
      "/api/budget/payments",
      { scope: "cat:venue", amount_huf: 1000 },
      { token },
    );
    expect(blocked.status).toBe(402);
  });
});

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Minimal valid PDF — the route sniffs the `%PDF` magic bytes. */
function tinyPdfBlob(): Blob {
  return new Blob([new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n")], {
    type: "application/pdf",
  });
}
/** A tiny PNG — used to prove non-PDF uploads are rejected. */
function tinyPngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: "image/png",
  });
}

async function createPayment(token: string, scope = "cat:venue"): Promise<number> {
  const r = await req<{ payment: BudgetPayment }>(
    "POST",
    "/api/budget/payments",
    { scope, amount_huf: 1000 },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.payment.id;
}

async function uploadPdf(token: string, id: number, blob: Blob, name: string): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, name);
  return await fetch(`${BASE}/api/budget/payments/${id}/pdf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

describe("budget payments — PDF attachment", () => {
  beforeEach(() => wipeAll());
  afterEach(() => wipeAll());

  test("attach → view → remove a PDF invoice on a payment", async () => {
    const { token } = await bootstrapCouple("bp-pdf@weddly.test");
    const id = await createPayment(token);

    // Attach.
    const up = await uploadPdf(token, id, tinyPdfBlob(), "szamla.pdf");
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as { payment: BudgetPayment };
    expect(upBody.payment.pdf_name).toBe("szamla.pdf");
    expect(upBody.payment.pdf_url).toContain(`/budget-payments/${id}.pdf`);

    // It shows up on the list.
    const listed = await req<{ payments: BudgetPayment[] }>(
      "GET",
      "/api/budget/payments",
      undefined,
      {
        token,
      },
    );
    expect(listed.data.payments.find((p) => p.id === id)?.pdf_name).toBe("szamla.pdf");

    // Gated download streams the PDF.
    const dl = await fetch(`${BASE}/api/budget/payments/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("application/pdf");
    expect((await dl.text()).startsWith("%PDF")).toBe(true);

    // Remove.
    const rm = await req<{ payment: BudgetPayment }>(
      "DELETE",
      `/api/budget/payments/${id}/pdf`,
      undefined,
      {
        token,
      },
    );
    expect(rm.status).toBe(200);
    expect(rm.data.payment.pdf_url).toBeNull();
    expect(rm.data.payment.pdf_name).toBeNull();
    // Download now 404s.
    const dl2 = await fetch(`${BASE}/api/budget/payments/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(dl2.status).toBe(404);
  });

  test("rejects a non-PDF upload (415)", async () => {
    const { token } = await bootstrapCouple("bp-pdf-bad@weddly.test");
    const id = await createPayment(token);
    const res = await uploadPdf(token, id, tinyPngBlob(), "receipt.png");
    expect(res.status).toBe(415);
  });

  test("another couple cannot download a payment's PDF", async () => {
    const a = await bootstrapCouple("bp-pdf-a@weddly.test");
    const id = await createPayment(a.token);
    expect((await uploadPdf(a.token, id, tinyPdfBlob(), "a.pdf")).status).toBe(200);

    const b = await bootstrapCouple("bp-pdf-b@weddly.test");
    const dl = await fetch(`${BASE}/api/budget/payments/${id}/download`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(dl.status).toBe(404);
  });
});
