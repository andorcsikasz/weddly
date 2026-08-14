import "../setup";

import { checklistTemplateSize } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

type InitResponse = { items: PlanningItem[]; created: number; linked: number };

describe("wedding checklist", () => {
  beforeEach(() => wipeAll());

  test("initializes ordinary Planning tasks once and keeps completion on the task row", async () => {
    const { token } = await bootstrapCouple();
    const first = await req<InitResponse>(
      "POST",
      "/api/planning/checklist/initialize",
      { locale: "en" },
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.created).toBe(checklistTemplateSize());
    const checklistTasks = first.data.items.filter((entry) => entry.checklist_template_id);
    expect(checklistTasks).toHaveLength(checklistTemplateSize());
    expect(new Set(checklistTasks.map((entry) => entry.checklist_template_id)).size).toBe(
      checklistTemplateSize(),
    );
    expect(checklistTasks.every((entry) => entry.kind === "task")).toBe(true);
    expect(
      checklistTasks.find((entry) => entry.checklist_template_id === "book-venue")?.due_date,
    ).not.toBeNull();

    const venue = checklistTasks.find((entry) => entry.checklist_template_id === "book-venue");
    expect(venue).toBeDefined();
    const completed = await req<{ item: PlanningItem }>(
      "PATCH",
      `/api/planning/${venue?.id}`,
      { done: true },
      { token },
    );
    expect(completed.data.item.done).toBe(true);
    expect(completed.data.item.checklist_template_id).toBe("book-venue");

    const second = await req<InitResponse>(
      "POST",
      "/api/planning/checklist/initialize",
      { locale: "de" },
      { token },
    );
    expect(second.data.created).toBe(0);
    expect(second.data.linked).toBe(0);
    expect(second.data.items.filter((entry) => entry.checklist_template_id)).toHaveLength(
      checklistTemplateSize(),
    );
    expect(second.data.items.find((entry) => entry.id === venue?.id)?.done).toBe(true);
  });

  test("adopts an equivalent existing template task instead of creating a duplicate", async () => {
    const { token } = await bootstrapCouple();
    const existing = await req<{ item: PlanningItem }>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Book your venue" },
      { token },
    );
    const initialized = await req<InitResponse>(
      "POST",
      "/api/planning/checklist/initialize",
      { locale: "en" },
      { token },
    );
    expect(initialized.data.linked).toBeGreaterThanOrEqual(1);
    expect(initialized.data.created).toBe(checklistTemplateSize() - 1);
    const venue = initialized.data.items.find(
      (entry) => entry.checklist_template_id === "book-venue",
    );
    expect(venue?.id).toBe(existing.data.item.id);
    expect(
      initialized.data.items.filter((entry) => entry.title === "Book your venue"),
    ).toHaveLength(1);
  });

  test("renders branded progress and blank variants as valid localized PDFs", async () => {
    const { token } = await bootstrapCouple();
    await req("POST", "/api/planning/checklist/initialize", { locale: "hr" }, { token });
    const base = `http://localhost:${process.env.PORT ?? "8791"}`;
    for (const query of [
      "locale=en",
      "locale=hu",
      "locale=es",
      "locale=hr",
      "locale=de&mode=blank&dates=1&owners=1&remaining=1",
    ]) {
      const response = await fetch(`${base}/api/print/wedding-checklist?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toContain("weddly-wedding-checklist.pdf");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(10_000);
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
      const document = await PDFDocument.load(bytes);
      expect(document.getPageCount()).toBeGreaterThanOrEqual(2);
      const firstPage = document.getPage(0);
      // A4 portrait in PDF points (210 × 297 mm), allowing pdf-lib rounding.
      expect(firstPage.getWidth()).toBeCloseTo(595.28, 0);
      expect(firstPage.getHeight()).toBeCloseTo(841.89, 0);
    }
  });

  test("requires the authenticated couple workspace", async () => {
    const result = await req("POST", "/api/planning/checklist/initialize", { locale: "en" });
    expect(result.status).toBe(401);
    const response = await fetch(
      `http://localhost:${process.env.PORT ?? "8791"}/api/print/wedding-checklist?locale=en`,
    );
    expect(response.status).toBe(401);
    await response.text();
  });

  test("public checklist PDF renders with no auth and rate-limits by IP", async () => {
    const base = `http://localhost:${process.env.PORT ?? "8791"}`;
    const ip = "10.55.0.9";
    const response = await fetch(`${base}/api/public/checklist/pdf?locale=hu`, {
      headers: { "x-test-client-ip": ip },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("weddly-wedding-checklist.pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(2);

    // Bucket capacity is 8 (PUBLIC_CHECKLIST_PDF_BUCKET) — one token already
    // spent above, so 7 more succeed (request #8) and the 9th overall
    // request 429s.
    for (let i = 0; i < 7; i++) {
      const ok = await fetch(`${base}/api/public/checklist/pdf?locale=en`, {
        headers: { "x-test-client-ip": ip },
      });
      expect(ok.status).toBe(200);
      await ok.arrayBuffer();
    }
    const limited = await fetch(`${base}/api/public/checklist/pdf?locale=en`, {
      headers: { "x-test-client-ip": ip },
    });
    expect(limited.status).toBe(429);
    await limited.text();

    // A different IP is a fresh bucket.
    const otherIp = await fetch(`${base}/api/public/checklist/pdf?locale=en`, {
      headers: { "x-test-client-ip": "10.55.0.10" },
    });
    expect(otherIp.status).toBe(200);
    await otherIp.arrayBuffer();
  });
});
