// Budget documents — invoices / receipts attached to a budget row via the bill
// icon in the PAID column. Anchored by `scope` ('cat:<category>' for an
// aggregated category row, 'line:<id>' for a custom line). Covers multipart
// upload (PDF + image, type + size + cap validation), scope validation, the
// served-back /uploads bytes, per-document delete, cross-couple isolation, and
// the read-only (402) gate for lapsed couples.

import "../setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BudgetDocument, BudgetLine } from "@shared/types";
import { db } from "../../src/db";
import { setBillingEnforcement } from "../../src/domain/billing";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Minimal valid PDF — the route sniffs the `%PDF` magic bytes, never parses
 *  the structure, so this leading-bytes fixture is enough to pass validation. */
function tinyPdfBlob(): Blob {
  const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  return new Blob([bytes], { type: "application/pdf" });
}

/** 67-byte 1x1 transparent PNG — same fixture as the moodboard upload tests. */
function tinyPngBlob(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: "image/png" });
}

/** Seed the founding cohort so a fresh couple stays on the (expirable) trial
 *  rather than being auto-granted founding — mirrors moodboard.e2e. */
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

async function upload(token: string | null, scope: string, blob: Blob, name = "invoice"): Promise<Response> {
  const form = new FormData();
  form.append("scope", scope);
  form.append("file", blob, name);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${BASE}/api/budget/documents`, { method: "POST", headers, body: form });
}

async function createLine(token: string): Promise<number> {
  const r = await req<{ line: BudgetLine }>(
    "POST",
    "/api/budget/lines",
    { category: "other", label: "Custom thing", planned_huf: 1000, actual_huf: 500 },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.line.id;
}

describe("budget documents — upload, list, serve, delete", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("a fresh couple has no documents", async () => {
    const { token } = await bootstrapCouple("bd-empty@weddly.test");
    const r = await req<{ documents: BudgetDocument[] }>("GET", "/api/budget/documents", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.documents).toEqual([]);
  });

  test("uploads a PDF to a category scope → 201, cache-busted /uploads URL", async () => {
    const { token, coupleId } = await bootstrapCouple("bd-pdf@weddly.test");
    const res = await upload(token, "cat:venue", tinyPdfBlob(), "helyszin.pdf");
    expect(res.status).toBe(201);
    const { document } = (await res.json()) as { document: BudgetDocument };
    expect(document.scope).toBe("cat:venue");
    expect(document.mime).toBe("application/pdf");
    expect(document.file_name).toBe("helyszin.pdf");
    expect(document.file_path).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/budget-docs/\\d+\\.pdf\\?v=\\d+$`),
    );

    const list = await req<{ documents: BudgetDocument[] }>(
      "GET",
      "/api/budget/documents",
      undefined,
      { token },
    );
    expect(list.data.documents).toHaveLength(1);
  });

  test("uploads an image to a line scope and serves it back from /uploads", async () => {
    const { token } = await bootstrapCouple("bd-line@weddly.test");
    const lineId = await createLine(token);
    const res = await upload(token, `line:${lineId}`, tinyPngBlob(), "nyugta.png");
    expect(res.status).toBe(201);
    const { document } = (await res.json()) as { document: BudgetDocument };
    expect(document.mime).toBe("image/png");

    const served = await fetch(`${BASE}${document.file_path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");
    expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("delete removes the document", async () => {
    const { token } = await bootstrapCouple("bd-del@weddly.test");
    const up = await upload(token, "cat:catering", tinyPdfBlob());
    const { document } = (await up.json()) as { document: BudgetDocument };

    const del = await req("DELETE", `/api/budget/documents/${document.id}`, undefined, { token });
    expect(del.status).toBe(200);

    const list = await req<{ documents: BudgetDocument[] }>(
      "GET",
      "/api/budget/documents",
      undefined,
      { token },
    );
    expect(list.data.documents).toEqual([]);
  });
});

describe("budget documents — validation", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("non-PDF / non-image bytes → 415", async () => {
    const { token } = await bootstrapCouple("bd-badtype@weddly.test");
    const res = await upload(token, "cat:venue", new Blob(["not a document"], { type: "application/pdf" }));
    expect(res.status).toBe(415);
  });

  test("missing file field → 400", async () => {
    const { token } = await bootstrapCouple("bd-nofile@weddly.test");
    const form = new FormData();
    form.append("scope", "cat:venue");
    const res = await fetch(`${BASE}/api/budget/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("malformed scope → 400", async () => {
    const { token } = await bootstrapCouple("bd-badscope@weddly.test");
    const res = await upload(token, "nonsense", tinyPdfBlob());
    expect(res.status).toBe(400);
  });

  test("unknown category scope → 400", async () => {
    const { token } = await bootstrapCouple("bd-unkcat@weddly.test");
    const res = await upload(token, "cat:spaceship", tinyPdfBlob());
    expect(res.status).toBe(400);
  });

  test("line scope for a non-existent line → 404", async () => {
    const { token } = await bootstrapCouple("bd-noline@weddly.test");
    const res = await upload(token, "line:999999", tinyPdfBlob());
    expect(res.status).toBe(404);
  });

  test("over the 20-document cap → 400 upload_limit", async () => {
    const { token } = await bootstrapCouple("bd-cap@weddly.test");
    for (let i = 0; i < 20; i++) {
      const ok = await upload(token, "cat:decor_floral", tinyPdfBlob());
      expect(ok.status).toBe(201);
    }
    const over = await upload(token, "cat:decor_floral", tinyPdfBlob());
    expect(over.status).toBe(400);
    const body = (await over.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("upload_limit");
  });

  test("anon → 401", async () => {
    const res = await upload(null, "cat:venue", tinyPdfBlob());
    expect(res.status).toBe(401);
  });
});

describe("budget documents — cross-couple isolation", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("B can't see, attach to, or delete A's documents", async () => {
    const a = await bootstrapCouple("bd-a@weddly.test");
    const b = await bootstrapCouple("bd-b@weddly.test");
    const aLine = await createLine(a.token);
    const upA = await upload(a.token, `line:${aLine}`, tinyPdfBlob());
    const { document } = (await upA.json()) as { document: BudgetDocument };

    // B's list is its own (empty).
    const bList = await req<{ documents: BudgetDocument[] }>(
      "GET",
      "/api/budget/documents",
      undefined,
      { token: b.token },
    );
    expect(bList.data.documents).toEqual([]);

    // B can't attach to A's line scope.
    const bAttach = await upload(b.token, `line:${aLine}`, tinyPdfBlob());
    expect(bAttach.status).toBe(404);

    // B can't delete A's document.
    const del = await req("DELETE", `/api/budget/documents/${document.id}`, undefined, {
      token: b.token,
    });
    expect(del.status).toBe(404);

    // A still has it.
    const aList = await req<{ documents: BudgetDocument[] }>(
      "GET",
      "/api/budget/documents",
      undefined,
      { token: a.token },
    );
    expect(aList.data.documents).toHaveLength(1);
  });
});

describe("budget documents — read-only gate (lapsed couple)", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("a lapsed couple gets 402 on upload but can still read", async () => {
    seedFoundingCohort(200);
    const { token, coupleId } = await bootstrapCouple("bd-lapsed@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId);
    setBillingEnforcement(true, 1);

    const get = await req<{ documents: BudgetDocument[] }>(
      "GET",
      "/api/budget/documents",
      undefined,
      { token },
    );
    expect(get.status).toBe(200);

    const up = await upload(token, "cat:venue", tinyPdfBlob());
    expect(up.status).toBe(402);
  });
});
