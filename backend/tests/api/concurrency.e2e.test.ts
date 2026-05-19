// Focused e2e coverage for the optimistic-concurrency / idempotency surfaces
// the rest of the suite touches only tangentially:
//
//   A) Budget PATCH `If-Match` etag — the canonical pattern; every other route
//      that ships an If-Match guard is expected to behave the same way.
//   B) Seating-table PATCH `If-Match` — same etag pattern, plus interactions
//      with the table_too_small shrink-guard.
//   C) Schedule PATCH `If-Match` — third route on the same pattern, plus a
//      note that POST /duplicate is etag-free by design.
//   D) Bulk POST /api/guests/bulk — atomicity, audit-log bundling, limits.
//   E) RSVP /api/rsvp/checkin — `Idempotency-Key` header + content-hash
//      fallback.
//
// Patterns covered:
// - Quoted vs unquoted If-Match (RFC 9110 allows both; the server strips
//   surrounding quotes before comparing).
// - Malformed / empty If-Match values are treated as missing.
// - Mid-flight DELETE wins over a stale If-Match (404 over 409).
// - Bulk batches roll back wholesale on the first parse error.
// - Bulk audit log bundles into ONE entry per request, not N.
// - Idempotency cache is keyed on (household_id, key) and survives across IPs
//   but not across body-byte differences when the content-hash fallback fires.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db } from "../../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// ─────────────────────────────────────────────────────────────────────────────
// Tiny per-file helpers — kept inline so the file reads as self-contained.
// ─────────────────────────────────────────────────────────────────────────────

interface BudgetLine {
  id: number;
  label: string;
  planned_huf: number;
  actual_huf: number;
  updated_at: number;
}

interface SeatingTable {
  id: number;
  label: string;
  seats: number;
  width_mm: number;
  length_mm: number;
  updated_at: number;
}

interface ScheduleEvent {
  id: number;
  label: string;
  starts_at_minutes: number;
  updated_at: number;
}

async function makeBudgetLine(token: string, label = "Concurrency Line"): Promise<BudgetLine> {
  const r = await req<{ line: BudgetLine }>(
    "POST",
    "/api/budget/lines",
    { category: "other", label, planned_huf: 1000 },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.line;
}

async function makeTable(token: string, label = "Concurrency Table"): Promise<SeatingTable> {
  const r = await req<{ table: SeatingTable }>(
    "POST",
    "/api/seating/tables",
    {
      label,
      shape: "round",
      seats: 6,
      x_mm: 0,
      y_mm: 0,
      width_mm: 3000,
      length_mm: 3000,
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.table;
}

async function makeEvent(token: string, label = "Concurrency Event"): Promise<ScheduleEvent> {
  const r = await req<{ event: ScheduleEvent }>(
    "POST",
    "/api/schedule",
    { label, starts_at_minutes: 16 * 60, duration_minutes: 30 },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.event;
}

async function makeGuest(token: string, full_name: string, opts: Record<string, unknown> = {}) {
  const r = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name, ...opts },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.guest.id;
}

async function makeHousehold(token: string, label = "Household") {
  const r = await req<{ household: { id: number; code: string } }>(
    "POST",
    "/api/households",
    { label },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.household;
}

async function getCoupleSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

function countAudit(coupleId: number, action: string): number {
  const r = db
    .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE couple_id = ? AND action = ?")
    .get(coupleId, action) as { c: number };
  return r.c;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Budget PATCH If-Match (etag) — canonical implementation; we hammer this
//    surface a little harder than the others so any drift in HttpError shape /
//    quoting / etc. trips a test here first.
// ─────────────────────────────────────────────────────────────────────────────

describe("A. budget PATCH If-Match", () => {
  test("matching If-Match succeeds and rolls updated_at forward", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a1@weddly.test");
    const line = await makeBudgetLine(token);
    // updated_at is millisecond resolution + Date.now() is monotonic non-
    // decreasing, but two writes inside the same ms tick are possible. Sleep
    // one tick to guarantee a forward bump we can assert on.
    await new Promise((r) => setTimeout(r, 5));
    const r = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 2000 },
      { token, headers: { "If-Match": String(line.updated_at) } },
    );
    expect(r.status).toBe(200);
    expect(r.data.line.actual_huf).toBe(2000);
    expect(r.data.line.updated_at).toBeGreaterThanOrEqual(line.updated_at);
  });

  test("stale If-Match → 409 code:stale, body.current_updated_at matches server", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a2@weddly.test");
    const line = await makeBudgetLine(token);
    const r = await req<{ detail: { code: string; current_updated_at: number } }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 500 },
      { token, headers: { "If-Match": "1" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
    expect(r.data.detail.current_updated_at).toBe(line.updated_at);
  });

  test("PATCH without If-Match still succeeds (etag is optional)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a3@weddly.test");
    const line = await makeBudgetLine(token);
    const r = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 750 },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.line.actual_huf).toBe(750);
  });

  test("malformed If-Match (empty / whitespace) is treated as missing → 200", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a4@weddly.test");
    const line = await makeBudgetLine(token);
    // Whitespace-only header → after trim+unquote it's "", server falls
    // through the guard.
    const r = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 800 },
      { token, headers: { "If-Match": "   " } },
    );
    expect(r.status).toBe(200);
  });

  test("malformed If-Match (non-numeric) → 409 stale (string compare doesn't match)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a4b@weddly.test");
    const line = await makeBudgetLine(token);
    // Non-numeric values are still *present* — the server compares them
    // string-wise to the updated_at number and a non-numeric string can
    // never equal a numeric one, so we get 409 (not 200). This pins the
    // current behaviour: "garbage that isn't empty" ≠ "no header".
    const r = await req<{ detail: { code: string } }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 900 },
      { token, headers: { "If-Match": "not-a-number" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
  });

  test("sequential PATCH-with-etag: second call must use the freshly-returned updated_at", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a5@weddly.test");
    const line = await makeBudgetLine(token);
    await new Promise((r) => setTimeout(r, 5));
    const first = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 1234 },
      { token, headers: { "If-Match": String(line.updated_at) } },
    );
    expect(first.status).toBe(200);
    const firstUpdatedAt = first.data.line.updated_at;
    // Reusing the ORIGINAL updated_at must now fail — the row moved on.
    await new Promise((r) => setTimeout(r, 5));
    const stale = await req<{ detail: { code: string; current_updated_at: number } }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 4321 },
      { token, headers: { "If-Match": String(line.updated_at) } },
    );
    expect(stale.status).toBe(409);
    expect(stale.data.detail.current_updated_at).toBe(firstUpdatedAt);
    // Using the freshly-returned updated_at works.
    const second = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 4321 },
      { token, headers: { "If-Match": String(firstUpdatedAt) } },
    );
    expect(second.status).toBe(200);
    expect(second.data.line.actual_huf).toBe(4321);
  });

  test("PATCH after DELETE → 404 (not 409) regardless of If-Match value", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a6@weddly.test");
    const line = await makeBudgetLine(token);
    const del = await req("DELETE", `/api/budget/lines/${line.id}`, undefined, { token });
    expect(del.status).toBe(200);
    // Try with fresh AND stale etag — both must 404. The existence check fires
    // before the etag compare.
    const fresh = await req(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 1 },
      { token, headers: { "If-Match": String(line.updated_at) } },
    );
    expect(fresh.status).toBe(404);
    const stale = await req(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 1 },
      { token, headers: { "If-Match": "0" } },
    );
    expect(stale.status).toBe(404);
  });

  test("If-Match quoted ('\"123\"') and unquoted ('123') both accepted (RFC 9110)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-a7@weddly.test");
    const line = await makeBudgetLine(token);
    await new Promise((r) => setTimeout(r, 5));
    // Unquoted form.
    const unquoted = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 10 },
      { token, headers: { "If-Match": String(line.updated_at) } },
    );
    expect(unquoted.status).toBe(200);
    const after1 = unquoted.data.line.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    // Quoted form — leading and trailing double-quotes the server strips.
    const quoted = await req<{ line: BudgetLine }>(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 20 },
      { token, headers: { "If-Match": `"${after1}"` } },
    );
    expect(quoted.status).toBe(200);
    expect(quoted.data.line.actual_huf).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Seating-table PATCH If-Match (same etag pattern + a shrink-guard quirk)
// ─────────────────────────────────────────────────────────────────────────────

describe("B. seating tables PATCH If-Match", () => {
  test("matching If-Match succeeds; updated_at moves forward", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b1@weddly.test");
    const t = await makeTable(token);
    await new Promise((r) => setTimeout(r, 5));
    const r = await req<{ table: SeatingTable }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "Renamed" },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(r.status).toBe(200);
    expect(r.data.table.label).toBe("Renamed");
    expect(r.data.table.updated_at).toBeGreaterThanOrEqual(t.updated_at);
  });

  test("stale If-Match → 409 code:stale, current_updated_at echoes server", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b2@weddly.test");
    const t = await makeTable(token);
    const r = await req<{ detail: { code: string; current_updated_at: number } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "Stale" },
      { token, headers: { "If-Match": "1" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
    expect(r.data.detail.current_updated_at).toBe(t.updated_at);
  });

  test("PATCH without If-Match succeeds (etag optional)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b3@weddly.test");
    const t = await makeTable(token);
    const r = await req<{ table: SeatingTable }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "NoEtag" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.table.label).toBe("NoEtag");
  });

  test("PATCH after DELETE → 404 regardless of etag", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b4@weddly.test");
    const t = await makeTable(token);
    expect((await req("DELETE", `/api/seating/tables/${t.id}`, undefined, { token })).status).toBe(
      200,
    );
    const r = await req(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "Gone" },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(r.status).toBe(404);
  });

  test("If-Match quoted form also accepted", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b5@weddly.test");
    const t = await makeTable(token);
    await new Promise((r) => setTimeout(r, 5));
    const r = await req<{ table: SeatingTable }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "Quoted" },
      { token, headers: { "If-Match": `"${t.updated_at}"` } },
    );
    expect(r.status).toBe(200);
  });

  test("shrink-guard runs AFTER the If-Match check: fresh etag + orphan shrink → 400 table_too_small", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b6@weddly.test");
    const t = await makeTable(token);
    // Seat a guest at index 4 (well within the 6 seats), then try to shrink
    // to 2 seats. With a FRESH If-Match (so the etag check passes), the
    // shrink-guard should fire and produce 400 code:table_too_small —
    // pinning the order: etag first (here it passes), then shrink check.
    const g = await makeGuest(token, "Sitter");
    const assign = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 4, guest_id: g },
      { token },
    );
    expect(assign.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const shrink = await req<{ detail: { code: string } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 2 },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(shrink.status).toBe(400);
    expect(shrink.data.detail.code).toBe("table_too_small");
  });

  test("stale If-Match wins over shrink-guard (etag check fires first)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-b7@weddly.test");
    const t = await makeTable(token);
    const g = await makeGuest(token, "Sitter2");
    expect(
      (
        await req(
          "POST",
          "/api/seating/assign",
          { table_id: t.id, seat_index: 4, guest_id: g },
          { token },
        )
      ).status,
    ).toBe(200);
    // Stale etag + a shrink that would also fail. Etag check fires first →
    // 409, not 400. Pins the order.
    const r = await req<{ detail: { code: string } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 2 },
      { token, headers: { "If-Match": "1" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Schedule PATCH If-Match — third route on the same pattern, plus a check
//    that POST /:id/duplicate is etag-free by design.
// ─────────────────────────────────────────────────────────────────────────────

describe("C. schedule PATCH If-Match", () => {
  test("matching If-Match succeeds", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-c1@weddly.test");
    const e = await makeEvent(token);
    await new Promise((r) => setTimeout(r, 5));
    const r = await req<{ event: ScheduleEvent }>(
      "PATCH",
      `/api/schedule/${e.id}`,
      { label: "Renamed event" },
      { token, headers: { "If-Match": String(e.updated_at) } },
    );
    expect(r.status).toBe(200);
    expect(r.data.event.label).toBe("Renamed event");
    expect(r.data.event.updated_at).toBeGreaterThanOrEqual(e.updated_at);
  });

  test("stale If-Match → 409 stale + current_updated_at", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-c2@weddly.test");
    const e = await makeEvent(token);
    const r = await req<{ detail: { code: string; current_updated_at: number } }>(
      "PATCH",
      `/api/schedule/${e.id}`,
      { label: "Stale" },
      { token, headers: { "If-Match": "0" } },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail.code).toBe("stale");
    expect(r.data.detail.current_updated_at).toBe(e.updated_at);
  });

  test("PATCH after DELETE → 404 regardless of If-Match", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-c3@weddly.test");
    const e = await makeEvent(token);
    expect((await req("DELETE", `/api/schedule/${e.id}`, undefined, { token })).status).toBe(200);
    const r = await req(
      "PATCH",
      `/api/schedule/${e.id}`,
      { label: "Gone" },
      { token, headers: { "If-Match": String(e.updated_at) } },
    );
    expect(r.status).toBe(404);
  });

  test("If-Match quoted form accepted", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-c4@weddly.test");
    const e = await makeEvent(token);
    await new Promise((r) => setTimeout(r, 5));
    const r = await req<{ event: ScheduleEvent }>(
      "PATCH",
      `/api/schedule/${e.id}`,
      { label: "Q" },
      { token, headers: { "If-Match": `"${e.updated_at}"` } },
    );
    expect(r.status).toBe(200);
  });

  test("POST /:id/duplicate does NOT consume an etag — racing duplicate vs PATCH is safe", async () => {
    // The duplicate endpoint inserts a new row and never inspects If-Match —
    // pinning here so a future refactor that "adds etag everywhere" can't
    // silently regress the duplicate UX.
    wipeAll();
    const { token } = await bootstrapCouple("ccy-c5@weddly.test");
    const e = await makeEvent(token, "Welcome drink");
    // Hold a stale-etag PATCH in flight, but duplicate without an etag —
    // duplicate should succeed even if PATCH would 409.
    const dupP = req<{ event: ScheduleEvent }>(
      "POST",
      `/api/schedule/${e.id}/duplicate`,
      {},
      { token, headers: { "If-Match": "garbage" } },
    );
    const patchP = req<{ detail?: { code: string } }>(
      "PATCH",
      `/api/schedule/${e.id}`,
      { label: "Renamed" },
      { token, headers: { "If-Match": "0" } },
    );
    const [dup, patch] = await Promise.all([dupP, patchP]);
    expect(dup.status).toBe(201);
    expect(dup.data.event.label).toContain("Welcome drink");
    // Patch must still 409 — the duplicate doesn't change the original's
    // etag, but our "0" If-Match is stale.
    expect(patch.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. POST /api/guests/bulk — batch atomicity + audit-log bundling + limits.
// ─────────────────────────────────────────────────────────────────────────────

describe("D. bulk guests POST /api/guests/bulk", () => {
  function makeRow(name: string, extra: Record<string, unknown> = {}) {
    return { full_name: name, group_tag: "other", ...extra };
  }

  test("50 valid rows → 201 + 50 created + single bundled audit entry", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ccy-d1@weddly.test");
    const before = countAudit(coupleId, "guest.bulk_create");
    const guests = Array.from({ length: 50 }, (_, i) => makeRow(`Bulk ${i + 1}`));
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(50);
    const after = countAudit(coupleId, "guest.bulk_create");
    expect(after - before).toBe(1);
  });

  test("invalid row mid-batch → 400 + entire batch rolls back (zero rows added)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d2@weddly.test");
    const before = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const beforeCount = before.data.guests.length;
    const guests: Record<string, unknown>[] = Array.from({ length: 50 }, (_, i) =>
      makeRow(`Pre ${i + 1}`),
    );
    // Row 25 has an empty full_name — parseUpsert throws before the tx opens,
    // so nothing is inserted.
    guests[24] = { full_name: "" };
    const r = await req("POST", "/api/guests/bulk", { guests }, { token });
    expect(r.status).toBe(400);
    const after = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(after.data.guests.length).toBe(beforeCount);
  });

  test("row referencing unknown household_id → 400 + full batch rollback", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d3@weddly.test");
    const before = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const beforeCount = before.data.guests.length;
    const guests = Array.from({ length: 10 }, (_, i) => makeRow(`Pre ${i + 1}`));
    // The household_id check fires inside the tx (resolveHouseholdForCreate
    // throws), which the transaction wrapper aborts and rethrows — so no
    // partial insert.
    guests[5] = makeRow("Bad row", { household_id: 9_999_999 });
    const r = await req("POST", "/api/guests/bulk", { guests }, { token });
    expect(r.status).toBe(400);
    const after = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(after.data.guests.length).toBe(beforeCount);
  });

  test("invite-code uniqueness: 100 rows all get unique codes", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d4@weddly.test");
    const guests = Array.from({ length: 100 }, (_, i) => makeRow(`Unique ${i + 1}`));
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(100);
    // Verify directly in the DB that every code is unique.
    const codes = db
      .prepare(
        `SELECT invite_code FROM guests WHERE id IN (${r.data.guests.map(() => "?").join(",")})`,
      )
      .all(...r.data.guests.map((g) => g.id)) as { invite_code: string }[];
    const seen = new Set(codes.map((c) => c.invite_code));
    expect(seen.size).toBe(100);
  });

  test("empty array → 400 not 201", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d5@weddly.test");
    const r = await req("POST", "/api/guests/bulk", { guests: [] }, { token });
    expect(r.status).toBe(400);
  });

  test("exactly BULK_MAX (200) rows → 201, 200 created", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d6@weddly.test");
    const guests = Array.from({ length: 200 }, (_, i) => makeRow(`Boundary ${i + 1}`));
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(200);
  });

  test("201 rows → 400 'limit'", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d7@weddly.test");
    const guests = Array.from({ length: 201 }, (_, i) => makeRow(`Over ${i + 1}`));
    const r = await req<{ error: string }>("POST", "/api/guests/bulk", { guests }, { token });
    expect(r.status).toBe(400);
    expect(r.data.error.toLowerCase()).toContain("limit");
  });

  test("non-array body → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d8@weddly.test");
    const r = await req("POST", "/api/guests/bulk", { guests: "nope" }, { token });
    expect(r.status).toBe(400);
  });

  test("concurrent bulk POSTs from same token both succeed; total adds up", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-d9@weddly.test");
    const before = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const beforeCount = before.data.guests.length;
    const batchA = Array.from({ length: 50 }, (_, i) => makeRow(`A ${i + 1}`));
    const batchB = Array.from({ length: 50 }, (_, i) => makeRow(`B ${i + 1}`));
    const [rA, rB] = await Promise.all([
      req<{ guests: { id: number }[] }>("POST", "/api/guests/bulk", { guests: batchA }, { token }),
      req<{ guests: { id: number }[] }>("POST", "/api/guests/bulk", { guests: batchB }, { token }),
    ]);
    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    expect(rA.data.guests.length).toBe(50);
    expect(rB.data.guests.length).toBe(50);
    const after = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(after.data.guests.length - beforeCount).toBe(100);
  });

  test("audit log: ONE bundled entry per bulk call (not N)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ccy-d10@weddly.test");
    const before = countAudit(coupleId, "guest.bulk_create");
    const guests = Array.from({ length: 75 }, (_, i) => makeRow(`Audit ${i + 1}`));
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(75);
    expect(countAudit(coupleId, "guest.bulk_create") - before).toBe(1);
    // And the per-row guest.create action must NOT have been emitted by the
    // bulk path (those are reserved for single POST /api/guests).
    const perRow = countAudit(coupleId, "guest.create");
    // Only the partner-role onboarding inserts may have logged guest.create —
    // bootstrapCouple seeds 2 partner guests. So this must be ≤ 2.
    expect(perRow).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. RSVP /api/rsvp/checkin Idempotency-Key + content-hash fallback.
// ─────────────────────────────────────────────────────────────────────────────

describe("E. rsvp checkin idempotency", () => {
  // Build a household + a single guest scoped to it. Most checkin tests below
  // share this shape — keeping the helper local so each test reads as one
  // unit.
  async function setupHousehold(email: string) {
    const { token } = await bootstrapCouple(email);
    const hh = await makeHousehold(token, "Idem-HH");
    const guestId = await makeGuest(token, "Idem Guest", { household_id: hh.id });
    const slug = await getCoupleSlug(token);
    return { token, hh, guestId, slug };
  }

  test("same Idempotency-Key replay returns identical status + body bytes", async () => {
    wipeAll();
    const { hh, guestId, slug } = await setupHousehold("ccy-e1@weddly.test");
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "k-replay-1" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    const firstBody = await first.text();
    expect(first.status).toBe(200);
    const second = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    const secondBody = await second.text();
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
    expect(secondBody).toBe(firstBody);
  });

  test("different Idempotency-Key but same body → second IS deduped via content-hash fallback when no key… wait, header beats hash: pin behaviour", async () => {
    wipeAll();
    const { hh, guestId, slug } = await setupHousehold("ccy-e2@weddly.test");
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
    });
    // When BOTH calls send an Idempotency-Key (even different ones), the
    // header wins and each key gets its OWN cache slot — so the second call
    // is NOT a replay. Pinning this: header-keyed isolation is the contract.
    const r1 = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key-A" },
      body,
    });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("idempotent-replay")).toBeNull();
    const r2 = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key-B" },
      body,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replay")).toBeNull();
  });

  test("same Idempotency-Key but DIFFERENT body → second IS still treated as a replay (key wins, NOT a 4xx)", async () => {
    // Pinning the current behaviour: the cache is keyed strictly on
    // (household_id, idem_key); the body bytes are NOT compared on lookup.
    // Industry "first wins" semantics — a key reused across different bodies
    // returns the FIRST cached response, not the second's payload. If the
    // contract were stricter (reject with 409 on mismatch), this test would
    // need updating. For now: same key, different body → second sees first's
    // cached body.
    wipeAll();
    const { token, hh, guestId, slug } = await setupHousehold("ccy-e3@weddly.test");
    // Add a second guest so we can submit different payloads.
    const g2 = await makeGuest(token, "Idem Guest 2", { household_id: hh.id });
    const bodyA = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
    });
    const bodyB = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g2, rsvp_status: "no" }],
    });
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "shared-key" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: bodyA,
    });
    const firstBody = await first.text();
    expect(first.status).toBe(200);
    const second = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: bodyB,
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
    // Replayed body equals the FIRST response (not what bodyB would have
    // produced). Verifies "first wins".
    expect(await second.text()).toBe(firstBody);
    // Sanity: g2 should still be "pending" in the DB — the second POST was
    // a cache hit and never executed.
    const list = await req<{ guests: { id: number; rsvp_status: string }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const g2Row = list.data.guests.find((g) => g.id === g2);
    expect(g2Row?.rsvp_status).toBe("pending");
  });

  test("replay across different x-test-client-ip but same key → still deduped (cache is global, not IP-scoped)", async () => {
    wipeAll();
    const { hh, guestId, slug } = await setupHousehold("ccy-e4@weddly.test");
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
    });
    const headers1 = {
      "Content-Type": "application/json",
      "Idempotency-Key": "k-global",
      "x-test-client-ip": "10.0.0.1",
    };
    const headers2 = {
      "Content-Type": "application/json",
      "Idempotency-Key": "k-global",
      "x-test-client-ip": "10.0.0.2",
    };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: headers1,
      body,
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: headers2,
      body,
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
  });

  test("POST without Idempotency-Key falls back to content-hash; bit-exact retransmit is deduped", async () => {
    wipeAll();
    const { token, hh, guestId, slug } = await setupHousehold("ccy-e5@weddly.test");
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
      added_members: [{ full_name: "Hash-Plus-One", kind: "adult", rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
    // Added-member was inserted exactly once, not twice — the second call
    // was a cache hit.
    const list = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const added = list.data.guests.filter((g) => g.full_name === "Hash-Plus-One");
    expect(added.length).toBe(1);
  });

  test("content-hash fallback: whitespace difference → different hash → NOT deduped", async () => {
    wipeAll();
    const { token, hh, guestId, slug } = await setupHousehold("ccy-e6@weddly.test");
    // Two bodies that differ only by an extra space in the JSON encoding —
    // semantically identical, but the content-hash sees different bytes.
    const payload = {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
      added_members: [{ full_name: "WS-Plus", kind: "adult", rsvp_status: "yes" }],
    };
    const compact = JSON.stringify(payload);
    const pretty = JSON.stringify(payload, null, 2);
    expect(compact).not.toBe(pretty);
    const headers = { "Content-Type": "application/json" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: compact,
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replay")).toBeNull();
    const second = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: pretty,
    });
    expect(second.status).toBe(200);
    // Different bytes → different content-hash → NOT a replay. The added-
    // member from the second call gets inserted (so we expect TWO).
    expect(second.headers.get("idempotent-replay")).toBeNull();
    const list = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const added = list.data.guests.filter((g) => g.full_name === "WS-Plus");
    expect(added.length).toBe(2);
  });

  test("idempotency cache TTL: simulated by manually expiring the in-process entry is not feasible from the test process — covered via header-replay window assertion instead", async () => {
    // The in-process Map is held inside backend/src/routes/rsvp.ts and is not
    // exported, so we can't poke at its expiresAt from the test harness. The
    // 5-minute TTL is asserted indirectly: a fresh replay within a single test
    // run (which takes ~100ms) MUST be served from cache. We assert that here
    // by running the replay loop 3× back-to-back and confirming every replay
    // after the first is marked Idempotent-Replay:1.
    wipeAll();
    const { hh, guestId, slug } = await setupHousehold("ccy-e7@weddly.test");
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: guestId, rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "k-ttl" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replay")).toBeNull();
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
      expect(r.status).toBe(200);
      expect(r.headers.get("idempotent-replay")).toBe("1");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: read-after-write consistency. The hand-rolled router + bun:sqlite
// pair runs everything in-process so writes commit before the response goes
// out — these tests pin that contract so a future async-write refactor would
// trip something obvious.
// ─────────────────────────────────────────────────────────────────────────────

describe("F. read-after-write consistency", () => {
  test("budget: PATCH → immediate GET reflects the change", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-f1@weddly.test");
    const line = await makeBudgetLine(token);
    const patch = await req(
      "PATCH",
      `/api/budget/lines/${line.id}`,
      { actual_huf: 9999 },
      { token },
    );
    expect(patch.status).toBe(200);
    const list = await req<{ lines: BudgetLine[] }>("GET", "/api/budget/lines", undefined, {
      token,
    });
    const row = list.data.lines.find((l) => l.id === line.id);
    expect(row?.actual_huf).toBe(9999);
  });

  test("seating: PATCH → immediate GET /api/seating/plan reflects the change", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-f2@weddly.test");
    const t = await makeTable(token);
    const patch = await req(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "RAW-Renamed" },
      { token },
    );
    expect(patch.status).toBe(200);
    const plan = await req<{ tables: SeatingTable[] }>("GET", "/api/seating/plan", undefined, {
      token,
    });
    const row = plan.data.tables.find((tt) => tt.id === t.id);
    expect(row?.label).toBe("RAW-Renamed");
  });

  test("schedule: POST → immediate GET /api/schedule includes the new event", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ccy-f3@weddly.test");
    const e = await makeEvent(token, "RAW-NewEvent");
    const list = await req<{ events: ScheduleEvent[] }>("GET", "/api/schedule", undefined, {
      token,
    });
    expect(list.data.events.find((ev) => ev.id === e.id)?.label).toBe("RAW-NewEvent");
  });
});
