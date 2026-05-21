// /api/public/wedding/:slug — happy path + 404 guards. The endpoint is the
// public-facing landing for a couple's wedding ("microsite"), so the privacy
// contract matters: archived/paused/purged workspaces must not leak, and a
// missing/malformed slug must not 500.
//
// Minimal coverage in this milestone — privacy-radius distortion + leakage
// shape will get harder coverage when the microsite gets dedicated UI.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";

describe("GET /api/public/wedding/:slug — minimal coverage", () => {
  test("active workspace returns the public view shape", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("public-wedding-active@weddly.test");
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    expect(slugRow?.slug).toBeTruthy();

    const r = await req<{ wedding: PublicWeddingWebsiteView }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.wedding.couple_slug).toBe(slugRow!.slug);
    expect(r.data.wedding.couple_display_name).toBeTruthy();
    expect(r.data.wedding.wedding_date).toBe("2026-09-12");
    expect(Array.isArray(r.data.wedding.schedule)).toBe(true);
    // PII boundary: the response shape MUST NOT include guests, budget, or
    // workspace-internal fields. Spot-check the keys.
    const keys = new Set(Object.keys(r.data.wedding));
    expect(keys.has("couple_slug")).toBe(true);
    expect(keys.has("guests")).toBe(false);
    expect(keys.has("budget")).toBe(false);
    expect(keys.has("partner_a_id")).toBe(false);
  });

  test("archived workspace 404s (status !== 'active' guard)", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("public-wedding-archived@weddly.test");
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    db.prepare("UPDATE couples SET status = 'archived' WHERE id = ?").run(coupleId);

    const r = await req(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`,
    );
    expect(r.status).toBe(404);
  });

  test("unknown slug 404s", async () => {
    wipeAll();
    const r = await req("GET", "/api/public/wedding/NONEXISTENT");
    expect(r.status).toBe(404);
  });

  test("malformed slug (too long) 400s", async () => {
    wipeAll();
    const longSlug = "A".repeat(80);
    const r = await req("GET", `/api/public/wedding/${longSlug}`);
    expect(r.status).toBe(400);
  });
});
