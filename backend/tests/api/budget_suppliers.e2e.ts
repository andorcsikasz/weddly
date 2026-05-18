// Comprehensive budget + suppliers coverage. Touches every endpoint in
//   backend/src/routes/budget.ts
//   backend/src/routes/suppliers.ts
//   backend/src/routes/community_suppliers.ts
//   backend/src/routes/couple_suppliers.ts
//   backend/src/routes/supplier_taxonomy.ts
//   backend/src/routes/couple_picks.ts
// without duplicating the smoke + DIY-mirror coverage that already lives in
// backend/tests/e2e.test.ts. Focus areas (per the dispatch brief):
//   - 400 input-validation paths the smoke suite skips
//   - 401 / 403 (requireAuth / requireVerifiedAuth / requireAdmin) per route
//   - 404 + 409 conflict paths
//   - cross-couple isolation per aggregate
//   - integer-HUF + frozen-category + taxonomy-cache + report-threshold quirks
//
// Designed to be safe to run alongside the existing e2e.test.ts — each test
// calls wipeAll() so per-suite state can't leak through the shared SQLite.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";

// ── small helpers ──────────────────────────────────────────────────────────

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function registerUnverifiedUserAndGetToken(email: string): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Unverified",
  });
  expect(reg.status).toBe(201);
  return reg.data.token;
}

interface LineDTO {
  id: number;
  category: string;
  label: string;
  planned_huf: number;
  actual_huf: number;
  notes: string | null;
  per_guest: boolean;
  icon: string | null;
  couple_supplier_id: string | null;
  updated_at: number;
}
interface LinesResp {
  lines: LineDTO[];
}
interface LineResp {
  line: LineDTO;
}
interface SnapshotDTO {
  id: number;
  name: string;
  payload_json: string;
}
interface SnapshotResp {
  snapshot: SnapshotDTO;
}
interface SnapshotsResp {
  snapshots: SnapshotDTO[];
}
interface RestoreResp {
  restored_count: number;
  snapshot: SnapshotDTO;
}

// ── budget lines: validation ───────────────────────────────────────────────

describe("budget lines: input validation", () => {
  test("POST rejects missing category", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-missing-cat@weddly.test");
    const r = await req("POST", "/api/budget/lines", { label: "x", planned_huf: 1 }, { token });
    expect(r.status).toBe(400);
  });

  test("POST rejects unknown category slug", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-bad-cat@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "spaceship", label: "x", planned_huf: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects empty label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-empty-label@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "   ", planned_huf: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects oversized label (>200 chars)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-long-label@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x".repeat(201), planned_huf: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects negative planned_huf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-neg-plan@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: -100 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects negative actual_huf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-neg-actual@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 1, actual_huf: -1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects planned_huf above 10 billion", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-huge@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 10_000_000_001 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects NaN planned_huf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-nan@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: "not-a-number" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rounds fractional planned_huf (integer HUF contract)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-round@weddly.test");
    const r = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Bus", planned_huf: 1000.5, actual_huf: 500.4 },
      { token },
    );
    expect(r.status).toBe(201);
    // parseLineBody uses Math.round() — 1000.5 → 1001 (banker's rounding off),
    // 500.4 → 500. Pinning the actual behavior so a regression would catch it.
    expect(r.data.line.planned_huf).toBe(1001);
    expect(r.data.line.actual_huf).toBe(500);
  });

  test("PATCH rounds fractional actual_huf as well", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-patch-round@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Line", planned_huf: 100 },
      { token },
    );
    const r = await req<LineResp>(
      "PATCH",
      `/api/budget/lines/${create.data.line.id}`,
      { actual_huf: 999.6 },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.line.actual_huf).toBe(1000);
  });

  test("POST rejects bad icon format (non-alphanumeric)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-icon@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 1, icon: "bad/icon" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects icon that is too long (>40 chars)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-icon-long@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 1, icon: "a".repeat(41) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST accepts valid icon slug", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-icon-ok@weddly.test");
    const r = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 1, icon: "music_dj-01" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.line.icon).toBe("music_dj-01");
  });

  test("POST per_guest=true persists as boolean true on read-back", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-per-guest@weddly.test");
    const r = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "catering", label: "Plate", planned_huf: 12_000, per_guest: true },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.line.per_guest).toBe(true);
  });

  test("PATCH rejects empty label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-patch-empty@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Line", planned_huf: 1 },
      { token },
    );
    const r = await req(
      "PATCH",
      `/api/budget/lines/${create.data.line.id}`,
      { label: " " },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH rejects non-string label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-patch-typed@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Line", planned_huf: 1 },
      { token },
    );
    const r = await req(
      "PATCH",
      `/api/budget/lines/${create.data.line.id}`,
      { label: 42 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH on bad numeric id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-patch-badid@weddly.test");
    const r = await req(
      "PATCH",
      "/api/budget/lines/not-a-number",
      { actual_huf: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH unknown line id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-patch-404@weddly.test");
    const r = await req(
      "PATCH",
      "/api/budget/lines/9999999",
      { actual_huf: 1 },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("DELETE unknown line id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bv-del-404@weddly.test");
    const r = await req("DELETE", "/api/budget/lines/9999999", undefined, { token });
    expect(r.status).toBe(404);
  });
});

// ── budget lines: auth gates ───────────────────────────────────────────────

describe("budget lines: auth gates", () => {
  test("GET /api/budget/lines requires auth (401)", async () => {
    wipeAll();
    const r = await req("GET", "/api/budget/lines");
    expect(r.status).toBe(401);
  });

  test("POST /api/budget/lines requires auth (401)", async () => {
    wipeAll();
    const r = await req("POST", "/api/budget/lines", {
      category: "other",
      label: "x",
      planned_huf: 1,
    });
    expect(r.status).toBe(401);
  });

  test("PATCH /api/budget/lines/:id requires auth (401)", async () => {
    wipeAll();
    const r = await req("PATCH", "/api/budget/lines/1", { actual_huf: 1 });
    expect(r.status).toBe(401);
  });

  test("DELETE /api/budget/lines/:id requires auth (401)", async () => {
    wipeAll();
    const r = await req("DELETE", "/api/budget/lines/1");
    expect(r.status).toBe(401);
  });

  test("unverified user gets 403 with code email_unverified on POST", async () => {
    wipeAll();
    const tok = await registerUnverifiedUserAndGetToken("unv-budget@weddly.test");
    const r = await req<{ detail: { code?: string } }>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "x", planned_huf: 1 },
      { token: tok },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("email_unverified");
  });
});

// ── budget lines: cross-couple isolation ───────────────────────────────────

describe("budget lines: cross-couple isolation", () => {
  test("couple B cannot PATCH couple A's line (404 — never leak existence)", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("iso-a@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "A only", planned_huf: 1 },
      { token: tokA },
    );
    expect(create.status).toBe(201);
    const id = create.data.line.id;

    const { token: tokB } = await bootstrapCouple("iso-b@weddly.test");
    const r = await req(
      "PATCH",
      `/api/budget/lines/${id}`,
      { actual_huf: 999 },
      { token: tokB },
    );
    expect(r.status).toBe(404);
  });

  test("couple B cannot DELETE couple A's line (404)", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("iso-del-a@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "A only", planned_huf: 1 },
      { token: tokA },
    );
    const id = create.data.line.id;

    const { token: tokB } = await bootstrapCouple("iso-del-b@weddly.test");
    const r = await req("DELETE", `/api/budget/lines/${id}`, undefined, { token: tokB });
    expect(r.status).toBe(404);
  });

  test("GET /api/budget/lines only returns the caller's couple's lines", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("iso-list-a@weddly.test");
    await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "A-private", planned_huf: 1 },
      { token: tokA },
    );

    const { token: tokB } = await bootstrapCouple("iso-list-b@weddly.test");
    const r = await req<LinesResp>("GET", "/api/budget/lines", undefined, { token: tokB });
    expect(r.status).toBe(200);
    expect(r.data.lines.find((l) => l.label === "A-private")).toBeUndefined();
  });
});

// ── budget lines: If-Match optimistic concurrency ──────────────────────────

describe("budget lines: If-Match concurrency", () => {
  test("matching If-Match succeeds", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ifm-match@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Line", planned_huf: 1 },
      { token },
    );
    const r = await req<LineResp>(
      "PATCH",
      `/api/budget/lines/${create.data.line.id}`,
      { actual_huf: 2 },
      {
        token,
        headers: { "If-Match": `"${create.data.line.updated_at}"` as unknown as string },
      },
    );
    expect(r.status).toBe(200);
  });

  test("stale If-Match returns 409 with code stale", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ifm-stale@weddly.test");
    const create = await req<LineResp>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Line", planned_huf: 1 },
      { token },
    );
    const r = await req<{ detail: { code: string } }>(
      "PATCH",
      `/api/budget/lines/${create.data.line.id}`,
      { actual_huf: 5 },
      { token, headers: { "If-Match": "0" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
  });
});

// ── budget snapshots ───────────────────────────────────────────────────────

describe("budget snapshots", () => {
  test("POST snapshot requires non-empty name", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-emptyname@weddly.test");
    const r = await req("POST", "/api/budget/snapshots", { name: "   " }, { token });
    expect(r.status).toBe(400);
  });

  test("POST snapshot rejects oversized name (>200)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-bigname@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/snapshots",
      { name: "x".repeat(201) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("GET /api/budget/snapshots requires auth (401)", async () => {
    wipeAll();
    const r = await req("GET", "/api/budget/snapshots");
    expect(r.status).toBe(401);
  });

  test("GET returns snapshots in created_at DESC order", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-order@weddly.test");
    const s1 = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "First" },
      { token },
    );
    expect(s1.status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "Second" },
      { token },
    );
    expect(s2.status).toBe(201);
    const list = await req<SnapshotsResp>(
      "GET",
      "/api/budget/snapshots",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    expect(list.data.snapshots[0]?.id).toBe(s2.data.snapshot.id);
    expect(list.data.snapshots[1]?.id).toBe(s1.data.snapshot.id);
  });

  test("snapshot captures all current lines at time T (atomicity)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-atomic@weddly.test");
    // Lines list at this point includes the onboarding-seeded rows. Snapshot
    // it and assert payload length matches the live listing.
    const before = await req<LinesResp>("GET", "/api/budget/lines", undefined, { token });
    expect(before.status).toBe(200);
    const snap = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "atomic" },
      { token },
    );
    expect(snap.status).toBe(201);
    const payload = JSON.parse(snap.data.snapshot.payload_json) as { label: string }[];
    expect(payload.length).toBe(before.data.lines.length);
    const labels = before.data.lines.map((l) => l.label).sort();
    const payloadLabels = payload.map((p) => p.label).sort();
    expect(payloadLabels).toEqual(labels);
  });

  test("restore on unknown snapshot id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-unknown@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/snapshots/9999999/restore",
      {},
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("restore with non-numeric id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-badid@weddly.test");
    const r = await req(
      "POST",
      "/api/budget/snapshots/not-a-number/restore",
      {},
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("DELETE unknown snapshot id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("snap-del-404@weddly.test");
    const r = await req("DELETE", "/api/budget/snapshots/9999999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("DELETE snapshot owned by other couple returns 404", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("snap-iso-a@weddly.test");
    const snap = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "A only" },
      { token: tokA },
    );
    const { token: tokB } = await bootstrapCouple("snap-iso-b@weddly.test");
    const r = await req(
      "DELETE",
      `/api/budget/snapshots/${snap.data.snapshot.id}`,
      undefined,
      { token: tokB },
    );
    expect(r.status).toBe(404);
  });

  test("snapshot list isolated per couple", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("snap-list-a@weddly.test");
    await req(
      "POST",
      "/api/budget/snapshots",
      { name: "A's secret plan" },
      { token: tokA },
    );
    const { token: tokB } = await bootstrapCouple("snap-list-b@weddly.test");
    const list = await req<SnapshotsResp>("GET", "/api/budget/snapshots", undefined, {
      token: tokB,
    });
    expect(list.status).toBe(200);
    expect(list.data.snapshots.find((s) => s.name === "A's secret plan")).toBeUndefined();
  });

  test("restore swap audit-log payload records the name + count", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("snap-audit-after@weddly.test");
    const snap = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "audit-bundle" },
      { token },
    );
    const r = await req<RestoreResp>(
      "POST",
      `/api/budget/snapshots/${snap.data.snapshot.id}/restore`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    const row = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'budget.snapshot_restore' ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { after_json: string | null };
    const after = JSON.parse(row.after_json ?? "{}") as {
      name?: string;
      restored_count?: number;
    };
    expect(after.name).toBe("audit-bundle");
    expect(typeof after.restored_count).toBe("number");
  });

  test("DELETE snapshot audits action=budget.snapshot_delete", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("snap-del-audit@weddly.test");
    const snap = await req<SnapshotResp>(
      "POST",
      "/api/budget/snapshots",
      { name: "to-delete" },
      { token },
    );
    const r = await req("DELETE", `/api/budget/snapshots/${snap.data.snapshot.id}`, undefined, {
      token,
    });
    expect(r.status).toBe(200);
    const audits = db
      .prepare(
        "SELECT id FROM audit_log WHERE couple_id = ? AND action = 'budget.snapshot_delete'",
      )
      .all(coupleId) as { id: number }[];
    expect(audits.length).toBe(1);
  });
});

// ── suppliers directory (public list + vote + events) ──────────────────────

describe("suppliers directory: vote validation + auth", () => {
  test("PUT /vote requires auth (401)", async () => {
    wipeAll();
    const r = await req("PUT", "/api/suppliers/normafa-rendezvenyhaz/vote", { value: 1 });
    expect(r.status).toBe(401);
  });

  test("PUT /vote with unverified user returns 403 email_unverified", async () => {
    wipeAll();
    const tok = await registerUnverifiedUserAndGetToken("unv-vote@weddly.test");
    const r = await req<{ detail: { code?: string } }>(
      "PUT",
      "/api/suppliers/normafa-rendezvenyhaz/vote",
      { value: 1 },
      { token: tok },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("email_unverified");
  });

  test("PUT /vote without a couple workspace returns 403 no_couple", async () => {
    wipeAll();
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "voter-no-couple@weddly.test",
      password: "supersafe123",
      full_name: "No Couple",
    });
    expect(reg.status).toBe(201);
    await verifyUserEmail("voter-no-couple@weddly.test");
    const r = await req<{ detail: { code?: string } }>(
      "PUT",
      "/api/suppliers/normafa-rendezvenyhaz/vote",
      { value: 1 },
      { token: reg.data.token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("no_couple");
  });

  test("PUT /vote with non -1/0/1 value returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-bad-value@weddly.test");
    const r = await req(
      "PUT",
      "/api/suppliers/normafa-rendezvenyhaz/vote",
      { value: 0.5 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PUT /vote rejects missing supplier_id (empty path component)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-empty@weddly.test");
    // Trailing slash collapses to no param — server treats as 400 or 404.
    const r = await req("PUT", "/api/suppliers/ /vote", { value: 1 }, { token });
    expect([400, 404]).toContain(r.status);
  });

  test("PUT /vote rejects oversized supplier_id (>80 chars)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-long-id@weddly.test");
    const id = "x".repeat(81);
    const r = await req("PUT", `/api/suppliers/${id}/vote`, { value: 1 }, { token });
    expect(r.status).toBe(400);
  });

  test("PUT /vote on bogus 'c' community id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-bogus-c@weddly.test");
    const r = await req(
      "PUT",
      "/api/suppliers/c99999/vote",
      { value: 1 },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("PUT /vote on unknown curated id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-bogus@weddly.test");
    const r = await req(
      "PUT",
      "/api/suppliers/does-not-exist-at-all/vote",
      { value: 1 },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("PUT /vote self-vote on own community submission returns 403 self_vote", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vote-self@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        name: "Self Venue",
        city: "Budapest",
        website: "https://self-venue.test",
        contact_email: "hello@self-venue.test",
        blurb: "Mine",
        price_band: 3,
      },
      { token },
    );
    expect(submit.status).toBe(201);
    const numericId = Number(submit.data.supplier.id.slice(1));
    // Email-verify + admin-approve so the supplier is voteable.
    const tokenRow = db
      .prepare(
        "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(numericId) as { token: string };
    await req("POST", `/api/suppliers/community/verify/${tokenRow.token}`);
    const adminToken = await registerAdminAndGetToken();
    await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: adminToken });

    const r = await req<{ detail: { code?: string } }>(
      "PUT",
      `/api/suppliers/c${numericId}/vote`,
      { value: 1 },
      { token },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("self_vote");
  });

  test("vote upsert: both partners voting → one row only, score=1", async () => {
    wipeAll();
    // Bootstrap A, invite B, accept. Then both vote +1 on the same supplier.
    const a = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "vote-pair-a@weddly.test",
      password: "supersafe123",
      full_name: "A",
    });
    expect(a.status).toBe(201);
    await verifyUserEmail("vote-pair-a@weddly.test");
    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      { display_name: "A & B", wedding_date: "2026-10-10", target_guest_count: 50 },
      { token: a.data.token },
    );
    expect(ob.status).toBe(201);
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "vote-pair-b@weddly.test" },
      { token: a.data.token },
    );
    const b = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "vote-pair-b@weddly.test",
      password: "supersafe123",
      full_name: "B",
    });
    await verifyUserEmail("vote-pair-b@weddly.test");
    await req(
      "POST",
      `/api/invites/${inv.data.invite.token}/accept`,
      {},
      { token: b.data.token },
    );

    interface VoteResp {
      votes_score: number;
      user_vote: number;
    }
    const aVote = await req<VoteResp>(
      "PUT",
      "/api/suppliers/normafa-rendezvenyhaz/vote",
      { value: 1 },
      { token: a.data.token },
    );
    expect(aVote.status).toBe(200);
    expect(aVote.data.votes_score).toBe(1);

    const bVote = await req<VoteResp>(
      "PUT",
      "/api/suppliers/normafa-rendezvenyhaz/vote",
      { value: 1 },
      { token: b.data.token },
    );
    expect(bVote.status).toBe(200);
    // Per-couple unique: B's vote replaces (overwrites) A's, score stays 1.
    expect(bVote.data.votes_score).toBe(1);

    const rows = db
      .prepare(
        "SELECT COUNT(*) AS c FROM supplier_votes WHERE couple_id = ? AND supplier_id = ?",
      )
      .get(ob.data.couple.id, "normafa-rendezvenyhaz") as { c: number };
    expect(rows.c).toBe(1);
  });
});

describe("suppliers events ingest", () => {
  test("POST /api/suppliers/events without body → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/suppliers/events", {});
    expect(r.status).toBe(400);
  });

  test("POST /api/suppliers/events with non-array events → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/suppliers/events", { events: "x" });
    expect(r.status).toBe(400);
  });

  test("POST /api/suppliers/events with batch > 200 → 400", async () => {
    wipeAll();
    const events = Array.from({ length: 201 }, () => ({
      supplier_id: "normafa-rendezvenyhaz",
      type: "view",
    }));
    const r = await req("POST", "/api/suppliers/events", { events });
    expect(r.status).toBe(400);
  });

  test("POST /api/suppliers/events is anonymous-tolerant; silently drops unknown ids", async () => {
    wipeAll();
    const r = await req<{ recorded: number }>("POST", "/api/suppliers/events", {
      events: [
        { supplier_id: "normafa-rendezvenyhaz", type: "view" },
        { supplier_id: "nonexistent-slug", type: "view" },
        { supplier_id: "etyeki-kuria", type: "website_click" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.data.recorded).toBe(2);
  });

  test("POST /api/suppliers/events drops events with invalid type", async () => {
    wipeAll();
    const r = await req<{ recorded: number }>("POST", "/api/suppliers/events", {
      events: [
        { supplier_id: "normafa-rendezvenyhaz", type: "snorgle" },
        { supplier_id: "normafa-rendezvenyhaz", type: "view" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.data.recorded).toBe(1);
  });

  test("POST /api/suppliers/events rate-limited per IP (61st batch → 429)", async () => {
    wipeAll();
    const ip = "10.77.77.77";
    // Capacity is 60 batches/min; drain it then expect the 61st to fail.
    for (let i = 0; i < 60; i++) {
      const r = await req(
        "POST",
        "/api/suppliers/events",
        { events: [{ supplier_id: "normafa-rendezvenyhaz", type: "view" }] },
        { clientIp: ip },
      );
      expect(r.status).toBe(200);
    }
    const blocked = await req(
      "POST",
      "/api/suppliers/events",
      { events: [{ supplier_id: "normafa-rendezvenyhaz", type: "view" }] },
      { clientIp: ip },
    );
    expect(blocked.status).toBe(429);
  });

  test("GET /api/suppliers is public (no auth required)", async () => {
    wipeAll();
    const r = await req<{ suppliers: { id: string }[] }>("GET", "/api/suppliers");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.suppliers)).toBe(true);
  });
});

// ── community suppliers: edge cases ────────────────────────────────────────

function communityPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: "venue",
    name: "Sample Hall",
    city: "Budapest",
    website: "https://sample-hall.test",
    contact_email: "owner@sample-hall.test",
    contact_phone: "+36 1 999 8888",
    blurb: "Test listing.",
    price_band: 3,
    ...overrides,
  };
}

describe("community suppliers: input validation", () => {
  test("POST without contact_email triggers awaiting_review immediately", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-no-email@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const r = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ contact_email: undefined, website: "https://no-email.test" }),
      { token },
    );
    expect(r.status).toBe(201);
    const numericId = Number(r.data.supplier.id.slice(1));
    const status = (
      db.prepare("SELECT status FROM community_suppliers WHERE id = ?").get(numericId) as {
        status: string;
      }
    ).status;
    expect(status).toBe("awaiting_review");
  });

  test("POST with contact_email creates a verification token", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-with-email@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const r = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://with-email.test" }),
      { token },
    );
    expect(r.status).toBe(201);
    const numericId = Number(r.data.supplier.id.slice(1));
    const tokenRow = db
      .prepare(
        "SELECT token, expires_at, consumed_at FROM community_supplier_verifications WHERE supplier_id = ?",
      )
      .get(numericId) as { token: string; expires_at: number; consumed_at: number | null };
    expect(tokenRow.token.length).toBe(64);
    expect(tokenRow.consumed_at).toBeNull();
    // TTL ≈ 7 days from now (allow a wide window).
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const delta = tokenRow.expires_at - Date.now();
    expect(delta).toBeGreaterThan(sevenDays - 60_000);
    expect(delta).toBeLessThanOrEqual(sevenDays + 60_000);
  });

  test("POST rejects invalid submitter_type", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-bad-submitter@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ submitter_type: "other" }),
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST accepts submitter_type=self", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-self@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ submitter_type: "self", website: "https://self.test" }),
      { token },
    );
    expect(r.status).toBe(201);
  });

  test("POST rejects city > 80 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-city@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ city: "x".repeat(81) }),
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects address > 200 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-addr@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ address: "x".repeat(201) }),
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects website > 300 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-site@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: `https://${"a".repeat(295)}.test` }),
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects contact_email > 200 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-email@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ contact_email: `${"a".repeat(195)}@x.test` }),
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects contact_phone > 30 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-phone@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community",
      communityPayload({ contact_phone: "+".repeat(31) }),
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("community suppliers: verify endpoint", () => {
  test("verify with token < 16 chars → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/suppliers/community/verify/short", {});
    expect(r.status).toBe(400);
  });

  test("verify with unknown 64-char token → 404", async () => {
    wipeAll();
    const r = await req("POST", `/api/suppliers/community/verify/${"a".repeat(64)}`, {});
    expect(r.status).toBe(404);
  });

  test("verify is single-use: second click → 200 with already_consumed=true", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-verify-once@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://once.test" }),
      { token },
    );
    expect(submit.status).toBe(201);
    const numericId = Number(submit.data.supplier.id.slice(1));
    const tokenRow = db
      .prepare(
        "SELECT token FROM community_supplier_verifications WHERE supplier_id = ?",
      )
      .get(numericId) as { token: string };
    const first = await req<{ ok: boolean; already_consumed: boolean }>(
      "POST",
      `/api/suppliers/community/verify/${tokenRow.token}`,
      {},
    );
    expect(first.status).toBe(200);
    expect(first.data.already_consumed).toBe(false);
    const second = await req<{ ok: boolean; already_consumed: boolean }>(
      "POST",
      `/api/suppliers/community/verify/${tokenRow.token}`,
      {},
    );
    expect(second.status).toBe(200);
    expect(second.data.already_consumed).toBe(true);
  });

  test("verify with expired token returns 410", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-verify-expired@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://expired.test" }),
      { token },
    );
    expect(submit.status).toBe(201);
    const numericId = Number(submit.data.supplier.id.slice(1));
    const tokenRow = db
      .prepare(
        "SELECT id, token FROM community_supplier_verifications WHERE supplier_id = ?",
      )
      .get(numericId) as { id: number; token: string };
    // Force expiry into the past.
    db.prepare("UPDATE community_supplier_verifications SET expires_at = 1 WHERE id = ?").run(
      tokenRow.id,
    );
    const r = await req(
      "POST",
      `/api/suppliers/community/verify/${tokenRow.token}`,
      {},
    );
    expect(r.status).toBe(410);
  });

  test("verify-token row survives only as long as its supplier (FK cascade)", async () => {
    // Deleting the supplier cascades the verification row away (FK is
    // ON DELETE CASCADE in schema.sql), so the `supplier_missing` branch of
    // consumeVerificationToken is unreachable in practice — we instead
    // observe the resulting "not_found" path. Pinning the actual behavior
    // so a schema change that drops the cascade is loud about it.
    wipeAll();
    const { token } = await bootstrapCouple("cs-verify-gone@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://gone.test" }),
      { token },
    );
    const numericId = Number(submit.data.supplier.id.slice(1));
    const tokenRow = db
      .prepare(
        "SELECT token FROM community_supplier_verifications WHERE supplier_id = ?",
      )
      .get(numericId) as { token: string };
    db.prepare("DELETE FROM community_suppliers WHERE id = ?").run(numericId);
    const remaining = db
      .prepare(
        "SELECT COUNT(*) AS c FROM community_supplier_verifications WHERE token = ?",
      )
      .get(tokenRow.token) as { c: number };
    expect(remaining.c).toBe(0);
    const r = await req(
      "POST",
      `/api/suppliers/community/verify/${tokenRow.token}`,
      {},
    );
    expect(r.status).toBe(404);
  });
});

describe("community suppliers: report endpoint", () => {
  test("report requires auth (401)", async () => {
    wipeAll();
    const r = await req(
      "POST",
      "/api/suppliers/community/1/report",
      { reason: "spam" },
    );
    expect(r.status).toBe(401);
  });

  test("report with bad numeric id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rep-badid@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community/abc/report",
      { reason: "spam" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("report with id=0 returns 400 (must be positive)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rep-zero@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community/0/report",
      { reason: "spam" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("report unknown supplier → 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rep-404@weddly.test");
    const r = await req(
      "POST",
      "/api/suppliers/community/9999/report",
      { reason: "spam" },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("report with invalid reason returns 400", async () => {
    wipeAll();
    const { token: subTok } = await bootstrapCouple("rep-badrsn-a@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://reason-test.test" }),
      { token: subTok },
    );
    const numericId = Number(submit.data.supplier.id.slice(1));
    const { token } = await bootstrapCouple("rep-badrsn-b@weddly.test");
    const r = await req(
      "POST",
      `/api/suppliers/community/${numericId}/report`,
      { reason: "weather" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("report with note > 500 chars returns 400", async () => {
    wipeAll();
    const { token: subTok } = await bootstrapCouple("rep-longnote-a@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://note-test.test" }),
      { token: subTok },
    );
    const numericId = Number(submit.data.supplier.id.slice(1));
    const { token } = await bootstrapCouple("rep-longnote-b@weddly.test");
    const r = await req(
      "POST",
      `/api/suppliers/community/${numericId}/report`,
      { reason: "spam", note: "x".repeat(501) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("3rd distinct reporter auto-hides the supplier (REPORT_AUTOHIDE_THRESHOLD)", async () => {
    wipeAll();
    const { token: subTok } = await bootstrapCouple("rep-autohide-sub@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ website: "https://autohide-iso.test" }),
      { token: subTok },
    );
    const numericId = Number(submit.data.supplier.id.slice(1));
    // Promote past both gates so the public list shows it.
    const tokRow = db
      .prepare(
        "SELECT token FROM community_supplier_verifications WHERE supplier_id = ?",
      )
      .get(numericId) as { token: string };
    await req("POST", `/api/suppliers/community/verify/${tokRow.token}`);
    const adminToken = await registerAdminAndGetToken();
    await req(
      "POST",
      `/api/admin/suppliers/${numericId}/approve`,
      {},
      { token: adminToken },
    );

    const reporters: string[] = ["r1", "r2", "r3"];
    let lastAutoHidden = false;
    let lastCount = 0;
    for (const r of reporters) {
      const { token } = await bootstrapCouple(`rep-thresh-${r}@weddly.test`);
      const resp = await req<{ auto_hidden: boolean; report_count: number }>(
        "POST",
        `/api/suppliers/community/${numericId}/report`,
        { reason: "spam" },
        { token },
      );
      expect(resp.status).toBe(200);
      lastAutoHidden = resp.data.auto_hidden;
      lastCount = resp.data.report_count;
    }
    expect(lastCount).toBe(3);
    expect(lastAutoHidden).toBe(true);

    // Sanity: status is now hidden.
    const status = (
      db.prepare("SELECT status FROM community_suppliers WHERE id = ?").get(numericId) as {
        status: string;
      }
    ).status;
    expect(status).toBe("hidden");
  });
});

// ── couple_suppliers: validation + isolation ───────────────────────────────

interface CoupleSupplierDTO {
  id: string;
  category: string;
  name: string;
  price_huf: number | null;
}
interface CoupleSupplierResp {
  supplier: CoupleSupplierDTO;
}
interface CoupleSuppliersListResp {
  suppliers: CoupleSupplierDTO[];
}

describe("couple_suppliers: validation + auth", () => {
  test("LIST requires auth (401)", async () => {
    wipeAll();
    const r = await req("GET", "/api/couple-suppliers");
    expect(r.status).toBe(401);
  });

  test("POST requires auth (401)", async () => {
    wipeAll();
    const r = await req("POST", "/api/couple-suppliers", { name: "x", category: "venue" });
    expect(r.status).toBe(401);
  });

  test("POST rejects missing name", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-no-name@weddly.test");
    const r = await req("POST", "/api/couple-suppliers", { category: "venue" }, { token });
    expect(r.status).toBe(400);
  });

  test("POST rejects missing category", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-no-cat@weddly.test");
    const r = await req("POST", "/api/couple-suppliers", { name: "x" }, { token });
    expect(r.status).toBe(400);
  });

  test("POST rejects invalid category", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-bad-cat@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "x", category: "snorgle" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects name > 120 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-name@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "x".repeat(121), category: "venue" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects notes > 500 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-long-notes@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "x", category: "venue", notes: "n".repeat(501) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects negative price_huf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-neg-price@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "x", category: "venue", price_huf: -1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rejects price_huf above 10 billion", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-huge-price@weddly.test");
    const r = await req(
      "POST",
      "/api/couple-suppliers",
      { name: "x", category: "venue", price_huf: 10_000_000_001 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST rounds fractional price_huf to nearest integer", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-round@weddly.test");
    const r = await req<CoupleSupplierResp>(
      "POST",
      "/api/couple-suppliers",
      { name: "Round", category: "venue", price_huf: 1500.6 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.supplier.price_huf).toBe(1501);
  });

  test("POST treats empty-string price_huf as null (no budget mirror)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-empty-price@weddly.test");
    const r = await req<CoupleSupplierResp>(
      "POST",
      "/api/couple-suppliers",
      { name: "NoPrice", category: "venue", price_huf: "" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.supplier.price_huf).toBeNull();
  });

  test("PATCH on unknown id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-patch-404@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couple-suppliers/deadbeefdeadbeef",
      { name: "x" },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("DELETE on unknown id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-del-404@weddly.test");
    const r = await req(
      "DELETE",
      "/api/couple-suppliers/deadbeefdeadbeef",
      undefined,
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("PATCH with empty name string returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-patch-empty@weddly.test");
    const create = await req<CoupleSupplierResp>(
      "POST",
      "/api/couple-suppliers",
      { name: "Real", category: "venue" },
      { token },
    );
    const r = await req(
      "PATCH",
      `/api/couple-suppliers/${create.data.supplier.id}`,
      { name: " " },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH with notes=null clears notes", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cs-clear-notes@weddly.test");
    interface FullResp {
      supplier: { id: string; notes: string | null };
    }
    const create = await req<FullResp>(
      "POST",
      "/api/couple-suppliers",
      { name: "Real", category: "venue", notes: "Some notes" },
      { token },
    );
    expect(create.data.supplier.notes).toBe("Some notes");
    const r = await req<FullResp>(
      "PATCH",
      `/api/couple-suppliers/${create.data.supplier.id}`,
      { notes: null },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.supplier.notes).toBeNull();
  });

  test("cross-couple LIST isolation", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("cs-iso-a@weddly.test");
    await req(
      "POST",
      "/api/couple-suppliers",
      { name: "Private to A", category: "venue" },
      { token: tokA },
    );
    const { token: tokB } = await bootstrapCouple("cs-iso-b@weddly.test");
    const list = await req<CoupleSuppliersListResp>(
      "GET",
      "/api/couple-suppliers",
      undefined,
      { token: tokB },
    );
    expect(list.status).toBe(200);
    expect(list.data.suppliers).toHaveLength(0);
  });

  test("cross-couple DELETE returns 404 (don't leak existence)", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("cs-iso-del-a@weddly.test");
    const create = await req<CoupleSupplierResp>(
      "POST",
      "/api/couple-suppliers",
      { name: "Private", category: "venue" },
      { token: tokA },
    );
    const { token: tokB } = await bootstrapCouple("cs-iso-del-b@weddly.test");
    const r = await req(
      "DELETE",
      `/api/couple-suppliers/${create.data.supplier.id}`,
      undefined,
      { token: tokB },
    );
    expect(r.status).toBe(404);
  });
});

// ── couple_picks: validation + isolation ───────────────────────────────────

describe("couple_picks: validation + auth", () => {
  test("GET /api/picks requires auth (401)", async () => {
    wipeAll();
    const r = await req("GET", "/api/picks");
    expect(r.status).toBe(401);
  });

  test("PUT /api/picks/:category requires auth (401)", async () => {
    wipeAll();
    const r = await req("PUT", "/api/picks/venue", { supplier_id: "x" });
    expect(r.status).toBe(401);
  });

  test("DELETE /api/picks/:category requires auth (401)", async () => {
    wipeAll();
    const r = await req("DELETE", "/api/picks/venue");
    expect(r.status).toBe(401);
  });

  test("PUT with invalid category slug returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-bad-cat@weddly.test");
    const r = await req(
      "PUT",
      "/api/picks/snorgle",
      { supplier_id: "s1" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("DELETE with invalid category slug returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-bad-cat-del@weddly.test");
    const r = await req("DELETE", "/api/picks/snorgle", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("PUT missing supplier_id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-no-sid@weddly.test");
    const r = await req("PUT", "/api/picks/venue", {}, { token });
    expect(r.status).toBe(400);
  });

  test("PUT empty supplier_id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-empty-sid@weddly.test");
    const r = await req(
      "PUT",
      "/api/picks/venue",
      { supplier_id: " " },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PUT supplier_id > 80 chars returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-long-sid@weddly.test");
    const r = await req(
      "PUT",
      "/api/picks/venue",
      { supplier_id: "x".repeat(81) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PUT non-string supplier_id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-num-sid@weddly.test");
    const r = await req(
      "PUT",
      "/api/picks/venue",
      { supplier_id: 42 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PUT does NOT validate supplier_id existence (preserves historical picks)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-loose-sid@weddly.test");
    const r = await req(
      "PUT",
      "/api/picks/venue",
      { supplier_id: "this-supplier-does-not-exist-anywhere" },
      { token },
    );
    expect(r.status).toBe(200);
  });

  test("PUT replaces prior pick (one row per category)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pick-replace2@weddly.test");
    await req("PUT", "/api/picks/venue", { supplier_id: "alpha" }, { token });
    await req("PUT", "/api/picks/venue", { supplier_id: "beta" }, { token });
    const rows = db
      .prepare("SELECT supplier_id FROM couple_picks WHERE couple_id = ? AND category = ?")
      .all(coupleId, "venue") as { supplier_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.supplier_id).toBe("beta");
  });

  test("GET returns picks ordered by category ASC", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-order@weddly.test");
    await req("PUT", "/api/picks/venue", { supplier_id: "v1" }, { token });
    await req("PUT", "/api/picks/catering", { supplier_id: "c1" }, { token });
    await req("PUT", "/api/picks/photo_video", { supplier_id: "p1" }, { token });
    const list = await req<{ picks: { category: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    const cats = list.data.picks.map((p) => p.category);
    expect(cats).toEqual([...cats].sort());
  });

  test("DELETE on never-picked category is a 200 idempotent no-op", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pick-idempotent@weddly.test");
    const r = await req("DELETE", "/api/picks/venue", undefined, { token });
    expect(r.status).toBe(200);
  });

  test("cross-couple isolation: A's pick invisible to B", async () => {
    wipeAll();
    const { token: tokA } = await bootstrapCouple("pick-iso-a@weddly.test");
    await req("PUT", "/api/picks/venue", { supplier_id: "a-only" }, { token: tokA });
    const { token: tokB } = await bootstrapCouple("pick-iso-b@weddly.test");
    const list = await req<{ picks: { supplier_id: string }[] }>(
      "GET",
      "/api/picks",
      undefined,
      { token: tokB },
    );
    expect(list.status).toBe(200);
    expect(list.data.picks.find((p) => p.supplier_id === "a-only")).toBeUndefined();
  });
});

// ── supplier taxonomy: public + admin ──────────────────────────────────────

describe("supplier taxonomy: public read", () => {
  test("GET /api/supplier-categories is public (no auth)", async () => {
    wipeAll();
    const r = await req<{ groups: unknown[] }>("GET", "/api/supplier-categories");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.groups)).toBe(true);
  });

  test("public GET reflects admin POST (cache invalidation on create)", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();

    // Unique slug per run — `supplier_groups` / `supplier_categories` are NOT
    // in wipeAll's truncate list, so admin-created rows from earlier tests
    // (in the same suite OR the parent e2e.test.ts) leak across runs and a
    // hardcoded slug would flake.
    const slug = `cache_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Hit GET once to prime the in-process cache.
    const before = await req<{ groups: { slug: string }[] }>("GET", "/api/supplier-categories");
    expect(before.status).toBe(200);
    expect(before.data.groups.find((g) => g.slug === slug)).toBeUndefined();

    const create = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug, label_hu: "W", label_en: "W" },
      { token: adminToken },
    );
    expect(create.status).toBe(201);

    const after = await req<{ groups: { slug: string }[] }>("GET", "/api/supplier-categories");
    expect(after.status).toBe(200);
    expect(after.data.groups.find((g) => g.slug === slug)).toBeDefined();
  });

  test("public GET reflects admin PATCH (cache invalidation on update)", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();

    const list = await req<{ groups: { id: number; slug: string; label_hu: string }[] }>(
      "GET",
      "/api/supplier-categories",
    );
    const target = list.data.groups[0]!;
    const newLabel = `${target.label_hu} v2`;
    const upd = await req(
      "PATCH",
      `/api/admin/supplier-groups/${target.id}`,
      { label_hu: newLabel },
      { token: adminToken },
    );
    expect(upd.status).toBe(200);

    const after = await req<{ groups: { id: number; label_hu: string }[] }>(
      "GET",
      "/api/supplier-categories",
    );
    const refreshed = after.data.groups.find((g) => g.id === target.id);
    expect(refreshed?.label_hu).toBe(newLabel);
  });

  test("public GET reflects admin DELETE (cache invalidation on delete)", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();

    // Same flakiness guard as the create-cache test above — unique slug.
    const slug = `cache_del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const create = await req<{ group: { id: number; slug: string } }>(
      "POST",
      "/api/admin/supplier-groups",
      { slug, label_hu: "X", label_en: "X" },
      { token: adminToken },
    );
    expect(create.status).toBe(201);
    // Cache the list so we know cache was warmed.
    await req("GET", "/api/supplier-categories");
    const del = await req(
      "DELETE",
      `/api/admin/supplier-groups/${create.data.group.id}`,
      undefined,
      { token: adminToken },
    );
    expect(del.status).toBe(200);
    const after = await req<{ groups: { slug: string }[] }>("GET", "/api/supplier-categories");
    expect(after.data.groups.find((g) => g.slug === slug)).toBeUndefined();
  });
});

describe("supplier taxonomy: admin gates + edge cases", () => {
  test("admin endpoints require auth (401 anonymous)", async () => {
    wipeAll();
    expect((await req("POST", "/api/admin/supplier-groups", {})).status).toBe(401);
    expect((await req("PATCH", "/api/admin/supplier-groups/1", {})).status).toBe(401);
    expect((await req("DELETE", "/api/admin/supplier-groups/1")).status).toBe(401);
    expect((await req("POST", "/api/admin/supplier-categories", {})).status).toBe(401);
    expect((await req("PATCH", "/api/admin/supplier-categories/1", {})).status).toBe(401);
    expect((await req("DELETE", "/api/admin/supplier-categories/1")).status).toBe(401);
  });

  test("non-admin user gets 403 on POST group", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("tax-nonadm-group@weddly.test");
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "nope", label_hu: "x", label_en: "x" },
      { token },
    );
    expect(r.status).toBe(403);
  });

  test("non-admin user gets 403 on POST category", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("tax-nonadm-cat@weddly.test");
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { group_id: 1, slug: "nope", label_hu: "x", label_en: "x" },
      { token },
    );
    expect(r.status).toBe(403);
  });

  test("POST group with invalid slug returns 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "Has Spaces!", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("POST group with label_hu shorter than 1 char returns 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "valid_slug", label_hu: "", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("POST group with label_en > 120 chars returns 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "valid_slug", label_hu: "x", label_en: "y".repeat(121) },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH unknown group returns 404", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "PATCH",
      "/api/admin/supplier-groups/999999",
      { label_hu: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("DELETE unknown group returns 404", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "DELETE",
      "/api/admin/supplier-groups/999999",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("POST category requires group_id", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { slug: "newcat", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("POST category with non-existent group_id returns 404", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { group_id: 999999, slug: "newcat", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("duplicate category slug returns 409", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const list = await req<{ groups: { id: number; categories: { slug: string }[] }[] }>(
      "GET",
      "/api/supplier-categories",
    );
    const groupWithCats = list.data.groups.find((g) => g.categories.length > 0);
    if (!groupWithCats) throw new Error("seeded taxonomy missing categories");
    const dupSlug = groupWithCats.categories[0]!.slug;
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      {
        group_id: groupWithCats.id,
        slug: dupSlug,
        label_hu: "Dup",
        label_en: "Dup",
        budget_category: "other",
      },
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("DELETE category referenced by active community supplier returns 409", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const { token: subTok } = await bootstrapCouple("tax-block-del@weddly.test");
    interface SubmitResp {
      supplier: { id: string };
    }
    const submit = await req<SubmitResp>(
      "POST",
      "/api/suppliers/community",
      communityPayload({ category: "venue", website: "https://block-del.test" }),
      { token: subTok },
    );
    expect(submit.status).toBe(201);

    // Find the category id for slug=venue.
    const list = await req<{
      groups: { categories: { id: number; slug: string }[] }[];
    }>("GET", "/api/supplier-categories");
    const cat = list.data.groups
      .flatMap((g) => g.categories)
      .find((c) => c.slug === "venue");
    expect(cat).toBeDefined();
    const r = await req(
      "DELETE",
      `/api/admin/supplier-categories/${cat?.id}`,
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("PATCH category with bad sort_order returns 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const list = await req<{
      groups: { categories: { id: number }[] }[];
    }>("GET", "/api/supplier-categories");
    const cat = list.data.groups.flatMap((g) => g.categories)[0];
    if (!cat) throw new Error("no seeded categories");
    const r = await req(
      "PATCH",
      `/api/admin/supplier-categories/${cat.id}`,
      { sort_order: 1.5 },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH category with empty budget_category returns 400", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const list = await req<{
      groups: { categories: { id: number }[] }[];
    }>("GET", "/api/supplier-categories");
    const cat = list.data.groups.flatMap((g) => g.categories)[0];
    if (!cat) throw new Error("no seeded categories");
    const r = await req(
      "PATCH",
      `/api/admin/supplier-categories/${cat.id}`,
      { budget_category: "  " },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("DELETE unknown category returns 404", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "DELETE",
      "/api/admin/supplier-categories/999999",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("PATCH unknown category returns 404", async () => {
    wipeAll();
    const adminToken = await registerAdminAndGetToken();
    const r = await req(
      "PATCH",
      "/api/admin/supplier-categories/999999",
      { label_hu: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });
});

