import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, registerAndVerify, bootstrapCouple } from "../helpers";
import { issueSession } from "../../src/auth/session";
import { db } from "../../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// ─────────────────────────────────────────────────────────────────────────────
// Tiny per-file helpers — kept inline so the harness module stays generic and
// every test reads as self-contained. addGuest is used a LOT below; the
// returned id is the only thing 99% of the call sites care about.
// ─────────────────────────────────────────────────────────────────────────────

async function addGuest(token: string, full_name = "Guest"): Promise<number> {
  const r = await req<{ guest: { id: number } }>("POST", "/api/guests", { full_name }, { token });
  expect(r.status).toBe(201);
  return r.data.guest.id;
}

async function makeTable(
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ id: number; seats: number; updated_at: number }> {
  const r = await req<{ table: { id: number; seats: number; updated_at: number } }>(
    "POST",
    "/api/seating/tables",
    {
      label: body.label ?? "T",
      shape: body.shape ?? "round",
      seats: body.seats ?? 6,
      x_mm: body.x_mm ?? 0,
      y_mm: body.y_mm ?? 0,
      width_mm: body.width_mm ?? 3000, // big enough that 6 seats clear the cap
      length_mm: body.length_mm ?? 3000,
      ...body,
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.table;
}

async function makeEvent(
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ id: number; updated_at: number; label: string }> {
  const r = await req<{ event: { id: number; updated_at: number; label: string } }>(
    "POST",
    "/api/schedule",
    {
      label: body.label ?? "Ceremónia",
      starts_at_minutes: body.starts_at_minutes ?? 16 * 60,
      ...body,
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.event;
}

async function makePlanning(
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ id: number; updated_at: number; kind: string }> {
  const r = await req<{ item: { id: number; updated_at: number; kind: string } }>(
    "POST",
    "/api/planning",
    { kind: body.kind ?? "task", title: body.title ?? "Pick a baker", ...body },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.item;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seating tables — create / patch / delete validation
// ─────────────────────────────────────────────────────────────────────────────

describe("seating tables: create validation", () => {
  test("requires a non-empty label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-1@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      { label: "", shape: "round", seats: 6, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects labels over 100 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-2@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      { label: "x".repeat(101), shape: "round", seats: 6, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects seats outside 1..40", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-3@weddly.test");
    const low = await req(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 0, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(low.status).toBe(400);
    const high = await req(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 41, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(high.status).toBe(400);
  });

  test("rejects non-finite x/y", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-4@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 6, x_mm: "abc", y_mm: 0 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects dimensions below the 100mm floor", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-5@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      {
        label: "T",
        shape: "long",
        seats: 4,
        x_mm: 0,
        y_mm: 0,
        width_mm: 50,
        length_mm: 1600,
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rejects dimensions above the 10m ceiling", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-6@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      {
        label: "T",
        shape: "long",
        seats: 4,
        x_mm: 0,
        y_mm: 0,
        width_mm: 800,
        length_mm: 99_999,
      },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("unknown shape silently coerces to round", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-7@weddly.test");
    const r = await req<{ table: { shape: string; width_mm: number; length_mm: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "trapezoid", seats: 4, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.shape).toBe("round");
    // Defaults for round Ø 1500 × 1500 since dims were omitted.
    expect(r.data.table.width_mm).toBe(1500);
    expect(r.data.table.length_mm).toBe(1500);
  });

  test("accepts head shape with the documented 900×4000 default", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-8@weddly.test");
    const r = await req<{ table: { shape: string; width_mm: number; length_mm: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "Head", shape: "head", seats: 4, x_mm: 0, y_mm: 0 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.shape).toBe("head");
    expect(r.data.table.width_mm).toBe(900);
    expect(r.data.table.length_mm).toBe(4000);
  });

  test("square shape collapses to the larger side", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-9@weddly.test");
    const r = await req<{ table: { width_mm: number; length_mm: number } }>(
      "POST",
      "/api/seating/tables",
      {
        label: "Sq",
        shape: "square",
        seats: 4,
        x_mm: 0,
        y_mm: 0,
        width_mm: 1200,
        length_mm: 1800,
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.width_mm).toBe(1800);
    expect(r.data.table.length_mm).toBe(1800);
  });

  test("seats clamp surfaces seats_clamped + seats_requested", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-10@weddly.test");
    const r = await req<{
      table: { seats: number };
      seats_clamped?: boolean;
      seats_requested?: number;
    }>(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 8, x_mm: 0, y_mm: 0 }, // defaults to Ø1500
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.seats).toBe(5);
    expect(r.data.seats_clamped).toBe(true);
    expect(r.data.seats_requested).toBe(8);
  });

  test("non-finite rotation rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-11@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 4, x_mm: 0, y_mm: 0, rotation_deg: "NaN" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("rotation_deg normalises into 0..359", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-12@weddly.test");
    const r = await req<{ table: { rotation_deg: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 4, x_mm: 0, y_mm: 0, rotation_deg: -90 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.rotation_deg).toBe(270);
  });

  test("disabled_seats out-of-range entries are filtered out", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-create-13@weddly.test");
    const r = await req<{ table: { disabled_seats: number[]; baby_seats: number[] } }>(
      "POST",
      "/api/seating/tables",
      {
        label: "T",
        shape: "round",
        seats: 4,
        x_mm: 0,
        y_mm: 0,
        width_mm: 3000,
        length_mm: 3000,
        disabled_seats: [0, 999, 2, "lol"],
        baby_seats: [2, 3], // 2 collides w/ disabled → dropped
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.disabled_seats).toEqual([0, 2]);
    expect(r.data.table.baby_seats).toEqual([3]);
  });
});

describe("seating tables: requireVerifiedAuth", () => {
  test("anon request to POST /api/seating/tables → 401", async () => {
    const r = await req("POST", "/api/seating/tables", {
      label: "T",
      shape: "round",
      seats: 4,
      x_mm: 0,
      y_mm: 0,
    });
    expect(r.status).toBe(401);
  });

  test("unverified user can edit seating on their own workspace", async () => {
    // POST /api/seating/tables was previously gated on verified email; the
    // P0-2 backend rollback (consensus: own-workspace writes don't need
    // verification, only third-party email fanout does) downgraded it to
    // plain requireAuth. The test now asserts the new positive contract.
    // The user still needs a couple workspace, so the 400 here is for the
    // missing couple, not for the email gate.
    wipeAll();
    // Register no longer mints a `users` row (it parks a pending signup and
    // the verify click creates the account), so an unverified account with a
    // session has to be written directly.
    const ts = Date.now();
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'owner', 0, 1, ?, ?)`,
      )
      .run("st-unv@weddly.test", "x", "Unv", ts, ts);
    const unverifiedToken = issueSession(Number(info.lastInsertRowid), "activation");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/seating/tables",
      { label: "T", shape: "round", seats: 4, x_mm: 0, y_mm: 0 },
      { token: unverifiedToken },
    );
    // No couple yet → 400 "No couple workspace". Not 403 email_unverified.
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBeUndefined();
  });

  test("anon GET /api/seating/plan → 401", async () => {
    const r = await req("GET", "/api/seating/plan");
    expect(r.status).toBe(401);
  });

  test("anon GET /api/seating/conflicts → 401", async () => {
    const r = await req("GET", "/api/seating/conflicts");
    expect(r.status).toBe(401);
  });
});

describe("seating tables: PATCH", () => {
  test("404 on unknown table id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-patch-1@weddly.test");
    const r = await req("PATCH", "/api/seating/tables/9999999", { label: "Anything" }, { token });
    expect(r.status).toBe(404);
  });

  test("If-Match stale → 409 with code:stale + current_updated_at", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-patch-2@weddly.test");
    const t = await makeTable(token, { label: "Edit me" });
    const stale = await fetch(`${BASE}/api/seating/tables/${t.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "If-Match": String(t.updated_at - 100),
      },
      body: JSON.stringify({ label: "Won't land" }),
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      detail?: { code?: string; current_updated_at?: number };
    };
    expect(body.detail?.code).toBe("stale");
    expect(body.detail?.current_updated_at).toBe(t.updated_at);
  });

  test("If-Match fresh → 200; PATCH partial preserves other fields", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-patch-3@weddly.test");
    const t = await makeTable(token, { label: "Keep label" });
    const r = await req<{ table: { label: string; is_kids_table: boolean } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { is_kids_table: true },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(r.status).toBe(200);
    expect(r.data.table.label).toBe("Keep label");
    expect(r.data.table.is_kids_table).toBe(true);
  });

  test("PATCH shrinking seats below occupied index → 400 table_too_small", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-patch-4@weddly.test");
    const t = await makeTable(token, { seats: 6, width_mm: 3000, length_mm: 3000 });
    const g = await addGuest(token, "Anna");
    const a = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 4, guest_id: g },
      { token },
    );
    expect(a.status).toBe(200);
    const r = await req<{ detail?: { code?: string; occupied_count?: number } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 2 },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("table_too_small");
    expect(r.data.detail?.occupied_count).toBe(1);
  });

  test("PATCH with bad shape silently coerces to round", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-patch-5@weddly.test");
    const t = await makeTable(token, { shape: "long", width_mm: 800, length_mm: 1600 });
    const r = await req<{ table: { shape: string } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { shape: "octagonal" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.table.shape).toBe("round");
  });
});

describe("seating tables: DELETE", () => {
  test("404 on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-del-1@weddly.test");
    const r = await req("DELETE", "/api/seating/tables/424242", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("DELETE writes a table.delete audit row", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("st-del-2@weddly.test");
    const t = await makeTable(token);
    const r = await req("DELETE", `/api/seating/tables/${t.id}`, undefined, { token });
    expect(r.status).toBe(200);
    const audit = db
      .prepare("SELECT action FROM audit_log WHERE couple_id = ? AND action = 'table.delete'")
      .all(coupleId) as { action: string }[];
    expect(audit.length).toBe(1);
  });

  test("DELETE cascades seat_assignments via FK", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-del-3@weddly.test");
    const t = await makeTable(token);
    const g = await addGuest(token, "C");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: g },
      { token },
    );
    await req("DELETE", `/api/seating/tables/${t.id}`, undefined, { token });
    const rows = db.prepare("SELECT id FROM seat_assignments WHERE table_id = ?").all(t.id);
    expect(rows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seat assign / unassign / swap
// ─────────────────────────────────────────────────────────────────────────────

describe("seating: assign seats", () => {
  test("rejects non-numeric ids", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-1@weddly.test");
    const r = await req(
      "POST",
      "/api/seating/assign",
      { table_id: "abc", seat_index: 0, guest_id: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("404 on unknown table id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-2@weddly.test");
    const g = await addGuest(token, "C");
    const r = await req(
      "POST",
      "/api/seating/assign",
      { table_id: 9999, seat_index: 0, guest_id: g },
      { token },
    );
    expect(r.status).toBe(404);
  });

  test("400 on seat_index out of range", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-3@weddly.test");
    const t = await makeTable(token, { seats: 4 });
    const g = await addGuest(token, "Z");
    const r = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: -1, guest_id: g },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("400 when seat is disabled", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-4@weddly.test");
    const t = await makeTable(token, { seats: 4, disabled_seats: [1] });
    const g = await addGuest(token, "Z");
    const r = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 1, guest_id: g },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("same guest re-assigned → moves them, no duplicate row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-5@weddly.test");
    const t = await makeTable(token);
    const g = await addGuest(token, "Anna");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: g },
      { token },
    );
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 3, guest_id: g },
      { token },
    );
    const rows = db
      .prepare("SELECT seat_index FROM seat_assignments WHERE guest_id = ?")
      .all(g) as { seat_index: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.seat_index).toBe(3);
  });

  test("second guest into same seat → overwrites (UNIQUE(table_id, seat_index))", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sa-6@weddly.test");
    const t = await makeTable(token);
    const a = await addGuest(token, "Anna");
    const b = await addGuest(token, "Bence");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 2, guest_id: a },
      { token },
    );
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 2, guest_id: b },
      { token },
    );
    const rows = db
      .prepare("SELECT guest_id FROM seat_assignments WHERE table_id = ? AND seat_index = 2")
      .all(t.id) as { guest_id: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.guest_id).toBe(b);
    // The displaced guest now has no seat.
    const aRows = db.prepare("SELECT id FROM seat_assignments WHERE guest_id = ?").all(a);
    expect(aRows.length).toBe(0);
  });

  test("cross-couple: assigning a foreign couple's guest → 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("sa-7a@weddly.test");
    const b = await bootstrapCouple("sa-7b@weddly.test");
    const t = await makeTable(a.token);
    const bg = await addGuest(b.token, "B");
    const r = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: bg },
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("audit: seat.assign row recorded with table_label + guest_name", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sa-8@weddly.test");
    const t = await makeTable(token, { label: "T-audit" });
    const g = await addGuest(token, "Audit Guest");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: g },
      { token },
    );
    const row = db
      .prepare("SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'seat.assign'")
      .get(coupleId) as { after_json: string };
    const after = JSON.parse(row.after_json) as { guest_name: string; table_label: string };
    expect(after.guest_name).toBe("Audit Guest");
    expect(after.table_label).toBe("T-audit");
  });
});

describe("seating: unassign", () => {
  test("400 when guest_id missing", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("un-1@weddly.test");
    const r = await req("POST", "/api/seating/unassign", {}, { token });
    expect(r.status).toBe(400);
  });

  test("404 on guest from a different couple", async () => {
    wipeAll();
    const a = await bootstrapCouple("un-2a@weddly.test");
    const b = await bootstrapCouple("un-2b@weddly.test");
    const bg = await addGuest(b.token, "B");
    const r = await req("POST", "/api/seating/unassign", { guest_id: bg }, { token: a.token });
    expect(r.status).toBe(404);
  });

  test("removing a guest who has no seat is a no-op (200)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("un-3@weddly.test");
    const g = await addGuest(token, "Empty");
    const r = await req("POST", "/api/seating/unassign", { guest_id: g }, { token });
    expect(r.status).toBe(200);
  });

  test("audit: seat.unassign row carries previous table_label", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("un-4@weddly.test");
    const t = await makeTable(token, { label: "Vacate-from" });
    const g = await addGuest(token, "Bence");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: g },
      { token },
    );
    await req("POST", "/api/seating/unassign", { guest_id: g }, { token });
    const row = db
      .prepare("SELECT before_json FROM audit_log WHERE couple_id = ? AND action = 'seat.unassign'")
      .get(coupleId) as { before_json: string };
    const before = JSON.parse(row.before_json) as { table_label: string };
    expect(before.table_label).toBe("Vacate-from");
  });
});

describe("seating: swap", () => {
  test("400 when guest_a_id == guest_b_id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sw-1@weddly.test");
    const g = await addGuest(token, "Solo");
    const r = await req("POST", "/api/seating/swap", { guest_a_id: g, guest_b_id: g }, { token });
    expect(r.status).toBe(400);
  });

  test("404 when one guest is not in the couple", async () => {
    wipeAll();
    const a = await bootstrapCouple("sw-2a@weddly.test");
    const b = await bootstrapCouple("sw-2b@weddly.test");
    const ag = await addGuest(a.token, "A");
    const bg = await addGuest(b.token, "B");
    const r = await req(
      "POST",
      "/api/seating/swap",
      { guest_a_id: ag, guest_b_id: bg },
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("400 when one guest is unseated", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sw-3@weddly.test");
    const t = await makeTable(token);
    const a = await addGuest(token, "Seated");
    const b = await addGuest(token, "Unseated");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 0, guest_id: a },
      { token },
    );
    const r = await req("POST", "/api/seating/swap", { guest_a_id: a, guest_b_id: b }, { token });
    expect(r.status).toBe(400);
  });

  test("swap across two tables succeeds", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sw-4@weddly.test");
    const t1 = await makeTable(token, { label: "T1" });
    const t2 = await makeTable(token, { label: "T2" });
    const a = await addGuest(token, "A");
    const b = await addGuest(token, "B");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t1.id, seat_index: 0, guest_id: a },
      { token },
    );
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t2.id, seat_index: 3, guest_id: b },
      { token },
    );
    const swap = await req(
      "POST",
      "/api/seating/swap",
      { guest_a_id: a, guest_b_id: b },
      { token },
    );
    expect(swap.status).toBe(200);
    const aRow = db
      .prepare("SELECT table_id, seat_index FROM seat_assignments WHERE guest_id = ?")
      .get(a) as { table_id: number; seat_index: number };
    const bRow = db
      .prepare("SELECT table_id, seat_index FROM seat_assignments WHERE guest_id = ?")
      .get(b) as { table_id: number; seat_index: number };
    expect(aRow.table_id).toBe(t2.id);
    expect(aRow.seat_index).toBe(3);
    expect(bRow.table_id).toBe(t1.id);
    expect(bRow.seat_index).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seating conflicts
// ─────────────────────────────────────────────────────────────────────────────

describe("seating: conflicts", () => {
  test("kind must be 'split' or 'avoid' — anything else 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cf-1@weddly.test");
    const a = await addGuest(token, "A");
    const b = await addGuest(token, "B");
    const r = await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: a, guest_b_id: b, kind: "kissy" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("self-conflict (guest_a == guest_b) → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cf-2@weddly.test");
    const g = await addGuest(token, "Solo");
    const r = await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: g, guest_b_id: g, kind: "split" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("404 when one guest is in another couple", async () => {
    wipeAll();
    const a = await bootstrapCouple("cf-3a@weddly.test");
    const b = await bootstrapCouple("cf-3b@weddly.test");
    const ag = await addGuest(a.token, "A-guest");
    const bg = await addGuest(b.token, "B-guest");
    const r = await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: ag, guest_b_id: bg, kind: "split" },
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("note is trimmed and capped at 500 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cf-4@weddly.test");
    const a = await addGuest(token, "A");
    const b = await addGuest(token, "B");
    const r = await req<{ conflict: { note: string | null } }>(
      "POST",
      "/api/seating/conflicts",
      {
        guest_a_id: a,
        guest_b_id: b,
        kind: "avoid",
        note: "   " + "n".repeat(600),
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.conflict.note?.length).toBe(500);
  });

  test("GET /api/seating/conflicts mirrors the list inside /plan", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cf-5@weddly.test");
    const a = await addGuest(token, "A");
    const b = await addGuest(token, "B");
    const c = await addGuest(token, "C");
    await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: a, guest_b_id: b, kind: "split" },
      { token },
    );
    await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: a, guest_b_id: c, kind: "avoid", note: "Awkward" },
      { token },
    );
    const std = await req<{ conflicts: { id: number; kind: string }[] }>(
      "GET",
      "/api/seating/conflicts",
      undefined,
      { token },
    );
    const plan = await req<{ conflicts: { id: number; kind: string }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(std.status).toBe(200);
    expect(std.data.conflicts.map((c) => c.id)).toEqual(plan.data.conflicts.map((c) => c.id));
    expect(std.data.conflicts.map((c) => c.kind)).toEqual(["split", "avoid"]);
  });

  test("DELETE 404 on unknown id, isolated across couples", async () => {
    wipeAll();
    const a = await bootstrapCouple("cf-6a@weddly.test");
    const b = await bootstrapCouple("cf-6b@weddly.test");
    const ag1 = await addGuest(a.token, "A1");
    const ag2 = await addGuest(a.token, "A2");
    const c = await req<{ conflict: { id: number } }>(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: ag1, guest_b_id: ag2, kind: "split" },
      { token: a.token },
    );
    expect(c.status).toBe(201);
    const crossDel = await req(
      "DELETE",
      `/api/seating/conflicts/${c.data.conflict.id}`,
      undefined,
      { token: b.token },
    );
    expect(crossDel.status).toBe(404);
    const ownDel = await req("DELETE", `/api/seating/conflicts/${c.data.conflict.id}`, undefined, {
      token: a.token,
    });
    expect(ownDel.status).toBe(200);
  });

  test("deleting a guest cascades the conflict row", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("cf-7@weddly.test");
    const a = await addGuest(token, "A");
    const b = await addGuest(token, "B");
    const c = await req<{ conflict: { id: number } }>(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: a, guest_b_id: b, kind: "split" },
      { token },
    );
    expect(c.status).toBe(201);
    // Hard-delete the guest via API.
    const del = await req("DELETE", `/api/guests/${a}`, undefined, { token });
    expect(del.status).toBe(200);
    const rows = db.prepare("SELECT id FROM seating_conflicts WHERE couple_id = ?").all(coupleId);
    expect(rows.length).toBe(0);
  });

  test("conflicts list is scoped per couple", async () => {
    wipeAll();
    const a = await bootstrapCouple("cf-8a@weddly.test");
    const b = await bootstrapCouple("cf-8b@weddly.test");
    const a1 = await addGuest(a.token, "A1");
    const a2 = await addGuest(a.token, "A2");
    await req(
      "POST",
      "/api/seating/conflicts",
      { guest_a_id: a1, guest_b_id: a2, kind: "avoid" },
      { token: a.token },
    );
    const list = await req<{ conflicts: unknown[] }>("GET", "/api/seating/conflicts", undefined, {
      token: b.token,
    });
    expect(list.status).toBe(200);
    expect(list.data.conflicts.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule: list / create / patch / duplicate / delete
// ─────────────────────────────────────────────────────────────────────────────

describe("schedule: list", () => {
  test("anon → 401", async () => {
    const r = await req("GET", "/api/schedule");
    expect(r.status).toBe(401);
  });

  test("cross-couple list isolation", async () => {
    wipeAll();
    const a = await bootstrapCouple("sl-1a@weddly.test");
    const b = await bootstrapCouple("sl-1b@weddly.test");
    await makeEvent(a.token, { label: "A only" });
    const bList = await req<{ events: unknown[] }>("GET", "/api/schedule", undefined, {
      token: b.token,
    });
    expect(bList.data.events.length).toBe(0);
  });

  test("orders by starts_at_minutes then sort_order", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sl-2@weddly.test");
    await makeEvent(token, { label: "After", starts_at_minutes: 600, sort_order: 1 });
    await makeEvent(token, { label: "Before", starts_at_minutes: 600, sort_order: 0 });
    await makeEvent(token, { label: "Way later", starts_at_minutes: 1000 });
    const list = await req<{ events: { label: string }[] }>("GET", "/api/schedule", undefined, {
      token,
    });
    expect(list.data.events.map((e) => e.label)).toEqual(["Before", "After", "Way later"]);
  });
});

describe("schedule: create validation", () => {
  test("non-string label → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-1@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: 12345, starts_at_minutes: 600 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("label over 200 chars → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-2@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: "x".repeat(201), starts_at_minutes: 600 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("non-integer starts_at_minutes → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-3@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: "T", starts_at_minutes: 12.5 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("starts_at_minutes accepts both day-1 and day-2 boundaries", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-4@weddly.test");
    const dayOne = await req(
      "POST",
      "/api/schedule",
      { label: "Last minute of day 1", starts_at_minutes: 1439 },
      { token },
    );
    expect(dayOne.status).toBe(201);
    const dayTwoEdge = await req(
      "POST",
      "/api/schedule",
      { label: "Final minute of day 2", starts_at_minutes: 2879 },
      { token },
    );
    expect(dayTwoEdge.status).toBe(201);
  });

  test("duration_minutes <= 0 rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-5@weddly.test");
    const zero = await req(
      "POST",
      "/api/schedule",
      { label: "T", starts_at_minutes: 600, duration_minutes: 0 },
      { token },
    );
    expect(zero.status).toBe(400);
    const neg = await req(
      "POST",
      "/api/schedule",
      { label: "T", starts_at_minutes: 600, duration_minutes: -10 },
      { token },
    );
    expect(neg.status).toBe(400);
  });

  test("duration_minutes above 1440 rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-6@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: "T", starts_at_minutes: 600, duration_minutes: 1441 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("two events overlapping in time both create successfully (server doesn't block)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-7@weddly.test");
    const a = await req(
      "POST",
      "/api/schedule",
      { label: "Ceremónia", starts_at_minutes: 600, duration_minutes: 60 },
      { token },
    );
    const b = await req(
      "POST",
      "/api/schedule",
      { label: "Overlap", starts_at_minutes: 610, duration_minutes: 30 },
      { token },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  test("location and notes round-trip", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-8@weddly.test");
    const r = await req<{
      event: { location: string | null; notes: string | null };
    }>(
      "POST",
      "/api/schedule",
      {
        label: "Vacsora",
        starts_at_minutes: 18 * 60,
        location: "  Étterem  ",
        notes: " Háromfogásos ",
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.event.location).toBe("Étterem");
    expect(r.data.event.notes).toBe("Háromfogásos");
  });

  test("notes over 2000 chars rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sc-9@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: "T", starts_at_minutes: 600, notes: "n".repeat(2001) },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("schedule: patch", () => {
  test("404 on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sp-1@weddly.test");
    const r = await req("PATCH", "/api/schedule/99999", { label: "x" }, { token });
    expect(r.status).toBe(404);
  });

  test("If-Match stale → 409 with current_updated_at", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sp-2@weddly.test");
    const e = await makeEvent(token, { label: "Stale-me" });
    db.prepare("UPDATE schedule_events SET updated_at = updated_at + 5000 WHERE id = ?").run(e.id);
    const fresh = db.prepare("SELECT updated_at FROM schedule_events WHERE id = ?").get(e.id) as {
      updated_at: number;
    };
    const res = await fetch(`${BASE}/api/schedule/${e.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "If-Match": String(e.updated_at),
      },
      body: JSON.stringify({ label: "Stale" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      detail?: { code?: string; current_updated_at?: number };
    };
    expect(body.detail?.code).toBe("stale");
    expect(body.detail?.current_updated_at).toBe(fresh.updated_at);
  });

  test("PATCH preserves untouched fields", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sp-3@weddly.test");
    const e = await req<{
      event: { id: number; location: string | null; notes: string | null };
    }>(
      "POST",
      "/api/schedule",
      {
        label: "Survive",
        starts_at_minutes: 12 * 60,
        location: "Kápolna",
        notes: "Preserve me",
        duration_minutes: 45,
      },
      { token },
    );
    expect(e.status).toBe(201);
    const upd = await req<{
      event: {
        label: string;
        location: string | null;
        notes: string | null;
        duration_minutes: number | null;
      };
    }>("PATCH", `/api/schedule/${e.data.event.id}`, { label: "Renamed" }, { token });
    expect(upd.status).toBe(200);
    expect(upd.data.event.label).toBe("Renamed");
    expect(upd.data.event.location).toBe("Kápolna");
    expect(upd.data.event.notes).toBe("Preserve me");
    expect(upd.data.event.duration_minutes).toBe(45);
  });

  test("PATCH starts_at_minutes out-of-range rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sp-4@weddly.test");
    const e = await makeEvent(token);
    const r = await req("PATCH", `/api/schedule/${e.id}`, { starts_at_minutes: 3000 }, { token });
    expect(r.status).toBe(400);
  });

  test("PATCH clearing notes via null → null in response", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sp-5@weddly.test");
    const e = await req<{ event: { id: number } }>(
      "POST",
      "/api/schedule",
      { label: "Clear-me", starts_at_minutes: 600, notes: "wipe me" },
      { token },
    );
    const r = await req<{ event: { notes: string | null } }>(
      "PATCH",
      `/api/schedule/${e.data.event.id}`,
      { notes: null },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.event.notes).toBeNull();
  });
});

describe("schedule: duplicate", () => {
  test("404 on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("dup-1@weddly.test");
    const r = await req("POST", "/api/schedule/9999999/duplicate", {}, { token });
    expect(r.status).toBe(404);
  });

  test("clones with ' (copy)' suffix and returns 201", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("dup-2@weddly.test");
    const e = await req<{
      event: { id: number; label: string; starts_at_minutes: number };
    }>(
      "POST",
      "/api/schedule",
      {
        label: "Welcome drink",
        starts_at_minutes: 17 * 60,
        duration_minutes: 30,
        location: "Garden",
        notes: "Champagne arrival",
        sort_order: 3,
      },
      { token },
    );
    const dup = await req<{
      event: {
        id: number;
        label: string;
        starts_at_minutes: number;
        duration_minutes: number | null;
        location: string | null;
        notes: string | null;
        sort_order: number;
      };
    }>("POST", `/api/schedule/${e.data.event.id}/duplicate`, {}, { token });
    expect(dup.status).toBe(201);
    expect(dup.data.event.id).not.toBe(e.data.event.id);
    expect(dup.data.event.label).toBe("Welcome drink (copy)");
    expect(dup.data.event.starts_at_minutes).toBe(17 * 60);
    expect(dup.data.event.duration_minutes).toBe(30);
    expect(dup.data.event.location).toBe("Garden");
    expect(dup.data.event.notes).toBe("Champagne arrival");
    expect(dup.data.event.sort_order).toBe(3);
  });

  test("does not double-append ' (copy)' on a row that already ends with it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("dup-3@weddly.test");
    const e = await req<{ event: { id: number; label: string } }>(
      "POST",
      "/api/schedule",
      { label: "Aperitif (copy)", starts_at_minutes: 17 * 60 },
      { token },
    );
    const dup = await req<{ event: { label: string } }>(
      "POST",
      `/api/schedule/${e.data.event.id}/duplicate`,
      {},
      { token },
    );
    expect(dup.status).toBe(201);
    expect(dup.data.event.label).toBe("Aperitif (copy)");
  });

  test("cross-couple duplicate → 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("dup-4a@weddly.test");
    const b = await bootstrapCouple("dup-4b@weddly.test");
    const e = await makeEvent(a.token, { label: "A only" });
    const r = await req("POST", `/api/schedule/${e.id}/duplicate`, {}, { token: b.token });
    expect(r.status).toBe(404);
  });

  test("audit row logged with source_id", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("dup-5@weddly.test");
    const e = await makeEvent(token, { label: "Audit me" });
    const dup = await req<{ event: { id: number } }>(
      "POST",
      `/api/schedule/${e.id}/duplicate`,
      {},
      { token },
    );
    expect(dup.status).toBe(201);
    const row = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'schedule.event_duplicate'",
      )
      .get(coupleId) as { after_json: string };
    const after = JSON.parse(row.after_json) as { source_id: number };
    expect(after.source_id).toBe(e.id);
  });
});

describe("schedule: delete", () => {
  test("404 on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sd-1@weddly.test");
    const r = await req("DELETE", "/api/schedule/9999999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("404 cross-couple", async () => {
    wipeAll();
    const a = await bootstrapCouple("sd-2a@weddly.test");
    const b = await bootstrapCouple("sd-2b@weddly.test");
    const e = await makeEvent(a.token, { label: "A only" });
    const r = await req("DELETE", `/api/schedule/${e.id}`, undefined, { token: b.token });
    expect(r.status).toBe(404);
  });

  test("deleting a non-existent id from a clean couple → 400 invalid id when NaN", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sd-3@weddly.test");
    const r = await req("DELETE", "/api/schedule/abc", undefined, { token });
    expect(r.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Planning items
// ─────────────────────────────────────────────────────────────────────────────

describe("planning: create validation", () => {
  test("anon → 401", async () => {
    const r = await req("GET", "/api/planning");
    expect(r.status).toBe(401);
  });

  test("invalid kind → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-1@weddly.test");
    const r = await req("POST", "/api/planning", { kind: "blob", title: "Hi" }, { token });
    expect(r.status).toBe(400);
  });

  test("missing title → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-2@weddly.test");
    const r = await req("POST", "/api/planning", { kind: "task", title: "" }, { token });
    expect(r.status).toBe(400);
  });

  test("title over 200 chars → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-3@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "x".repeat(201) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("body over 5000 chars → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-4@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "x", body: "b".repeat(5001) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("kind allowlist accepts task / idea / schedule", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-5@weddly.test");
    for (const kind of ["task", "idea", "schedule"] as const) {
      const r = await req("POST", "/api/planning", { kind, title: `Hi ${kind}` }, { token });
      expect(r.status).toBe(201);
    }
  });

  test("topic must be wedding or honeymoon when present", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-6@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "X", topic: "garden-party" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("assignee non-string rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-7@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "X", assignee: 42 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("assignee over 80 chars rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-8@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "X", assignee: "a".repeat(81) },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("assignee on idea silently nulled", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-9@weddly.test");
    const r = await req<{ item: { assignee: string | null } }>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Ignore my assignee", assignee: "Anna" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.item.assignee).toBeNull();
  });

  test("due_date must be YYYY-MM-DD", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-10@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "T", due_date: "tomorrow" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("scheduled_time must be HH:MM", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-11@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "schedule", title: "T", scheduled_time: "9pm" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("priority must be 0..2 integer", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-12@weddly.test");
    const bad = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "T", priority: 3 },
      { token },
    );
    expect(bad.status).toBe(400);
    const strBad = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "T", priority: "1" },
      { token },
    );
    expect(strBad.status).toBe(400);
  });

  test("idea auto-stamps suggested_by_name from the creating user", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-13@weddly.test");
    const r = await req<{
      item: { suggested_by_user_id: number | null; suggested_by_name: string | null };
    }>("POST", "/api/planning", { kind: "idea", title: "Branded napkins" }, { token });
    expect(r.status).toBe(201);
    expect(r.data.item.suggested_by_user_id).not.toBeNull();
    expect(r.data.item.suggested_by_name).toBe("Owner");
  });

  test("task doesn't auto-stamp suggested_by", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-14@weddly.test");
    const r = await req<{
      item: { suggested_by_user_id: number | null; suggested_by_name: string | null };
    }>("POST", "/api/planning", { kind: "task", title: "Pay deposit" }, { token });
    expect(r.status).toBe(201);
    expect(r.data.item.suggested_by_user_id).toBeNull();
    expect(r.data.item.suggested_by_name).toBeNull();
  });

  test("position must be integer in range", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-15@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "T", position: 2_000_000 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("supplier_id over 64 chars rejected (tasks only)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pl-16@weddly.test");
    const r = await req(
      "POST",
      "/api/planning",
      { kind: "task", title: "T", supplier_id: "x".repeat(65) },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("planning: list + patch + delete", () => {
  test("404 PATCH on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-1@weddly.test");
    const r = await req("PATCH", "/api/planning/999999", { title: "X" }, { token });
    expect(r.status).toBe(404);
  });

  test("404 DELETE on unknown id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-2@weddly.test");
    const r = await req("DELETE", "/api/planning/999999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("PATCH preserves assignee when not supplied", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-3@weddly.test");
    const created = await req<{ item: { id: number; assignee: string | null } }>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Assigned task", assignee: "Anna" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.assignee).toBe("Anna");
    const patched = await req<{ item: { assignee: string | null; title: string } }>(
      "PATCH",
      `/api/planning/${created.data.item.id}`,
      { title: "Renamed task" },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.item.title).toBe("Renamed task");
    expect(patched.data.item.assignee).toBe("Anna");
  });

  test("PATCH can clear assignee with null", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-4@weddly.test");
    const created = await makePlanning(token, {
      kind: "task",
      title: "X",
      assignee: "Anna",
    });
    const r = await req<{ item: { assignee: string | null } }>(
      "PATCH",
      `/api/planning/${created.id}`,
      { assignee: null },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.item.assignee).toBeNull();
  });

  test("PATCH done toggles to true", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-5@weddly.test");
    const created = await makePlanning(token, { kind: "task", title: "Tick me" });
    const r = await req<{ item: { done: boolean } }>(
      "PATCH",
      `/api/planning/${created.id}`,
      { done: true },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.item.done).toBe(true);
  });

  test("PATCH rejecting an invalid due_date on a task → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-6@weddly.test");
    const created = await makePlanning(token, { kind: "task", title: "Date me" });
    const r = await req(
      "PATCH",
      `/api/planning/${created.id}`,
      { due_date: "yesterday" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH supplying due_date to an idea silently nulls", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-7@weddly.test");
    const created = await makePlanning(token, { kind: "idea", title: "Idea row" });
    const r = await req<{ item: { due_date: string | null } }>(
      "PATCH",
      `/api/planning/${created.id}`,
      { due_date: "2026-09-12" },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.item.due_date).toBeNull();
  });

  test("DELETE works and cascades to nothing extra", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pp-8@weddly.test");
    const created = await makePlanning(token, { kind: "idea", title: "Bye" });
    const r = await req("DELETE", `/api/planning/${created.id}`, undefined, { token });
    expect(r.status).toBe(200);
    const after = await req<{ items: { id: number }[] }>("GET", "/api/planning", undefined, {
      token,
    });
    expect(after.data.items.find((i) => i.id === created.id)).toBeUndefined();
  });

  test("cross-couple isolation: A's planning items invisible to B", async () => {
    wipeAll();
    const a = await bootstrapCouple("pp-9a@weddly.test");
    const b = await bootstrapCouple("pp-9b@weddly.test");
    const created = await makePlanning(a.token, { kind: "task", title: "Hidden" });
    const bList = await req<{ items: { id: number }[] }>("GET", "/api/planning", undefined, {
      token: b.token,
    });
    expect(bList.data.items.find((i) => i.id === created.id)).toBeUndefined();
    const bPatch = await req(
      "PATCH",
      `/api/planning/${created.id}`,
      { title: "Hijack" },
      { token: b.token },
    );
    expect(bPatch.status).toBe(404);
    const bDel = await req("DELETE", `/api/planning/${created.id}`, undefined, {
      token: b.token,
    });
    expect(bDel.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Print / PDF endpoints
// ─────────────────────────────────────────────────────────────────────────────

async function expectPdf(res: Response): Promise<Uint8Array> {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/pdf");
  const buf = new Uint8Array(await res.arrayBuffer());
  // %PDF magic header.
  expect(buf[0]).toBe(0x25);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x44);
  expect(buf[3]).toBe(0x46);
  expect(buf.byteLength).toBeGreaterThan(500);
  return buf;
}

describe("print: seating chart", () => {
  test("anon → 401", async () => {
    const res = await fetch(`${BASE}/api/print/seating/a4`);
    expect(res.status).toBe(401);
  });

  test("A3 returns a valid pdf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pr-1@weddly.test");
    await addGuest(token, "PDF Guest");
    const res = await fetch(`${BASE}/api/print/seating/a3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectPdf(res);
  });

  test("Content-Disposition uses seating-<fmt>.pdf", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pr-2@weddly.test");
    const res4 = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res4.headers.get("content-disposition")).toContain("seating-a4.pdf");
    const res3 = await fetch(`${BASE}/api/print/seating/a3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res3.headers.get("content-disposition")).toContain("seating-a3.pdf");
  });

  test("audit row recorded with format + counts", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pr-3@weddly.test");
    await addGuest(token, "Counted Guest");
    const res = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const row = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'print.seating_chart'",
      )
      .get(coupleId) as { after_json: string };
    const after = JSON.parse(row.after_json) as {
      format: string;
      guest_count: number;
      table_count: number;
    };
    expect(after.format).toBe("a4");
    expect(after.guest_count).toBe(1);
    expect(after.table_count).toBe(0);
  });
});

describe("print: seating chart honours table rotation", () => {
  test("rotation_deg=37 round-trips through PATCH", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rot-1@weddly.test");
    const t = await makeTable(token, {
      shape: "long",
      seats: 6,
      width_mm: 900,
      length_mm: 2400,
      x_mm: 3000,
      y_mm: 2000,
    });
    const patch = await req<{ table: { rotation_deg: number } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { rotation_deg: 37 },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.table.rotation_deg).toBe(37);
    // And it survives a fresh read of the plan.
    const plan = await req<{ tables: { id: number; rotation_deg: number }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(plan.data.tables.find((x) => x.id === t.id)?.rotation_deg).toBe(37);
  });

  test("rotated long table + seated guest renders a valid A4 PDF", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rot-2@weddly.test");
    // One rotated long table and one unrotated round neighbour so BOTH the
    // rotated-rectangle branch and the legacy 0° branch draw in one render.
    const rotated = await makeTable(token, {
      label: "Head-ish",
      shape: "long",
      seats: 6,
      width_mm: 900,
      length_mm: 2400,
      x_mm: 3000,
      y_mm: 2000,
      rotation_deg: 90,
    });
    await makeTable(token, {
      label: "Round",
      shape: "round",
      seats: 6,
      width_mm: 3000,
      length_mm: 3000,
      x_mm: 6000,
      y_mm: 2000,
    });
    const g = await addGuest(token, "Rotated Guest");
    const assign = await req(
      "POST",
      "/api/seating/assign",
      { table_id: rotated.id, seat_index: 0, guest_id: g },
      { token },
    );
    expect(assign.status).toBe(200);
    const res = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buf = await expectPdf(res);
    // Non-trivial: two tables, twelve chairs, a guest name and the embedded
    // font subset all landed in the file, not just an empty page.
    expect(buf.byteLength).toBeGreaterThan(2000);
  });
});

describe("print: place cards", () => {
  test("anon → 401", async () => {
    const res = await fetch(`${BASE}/api/print/place-cards`);
    expect(res.status).toBe(401);
  });

  test("returns one PDF, larger than tiny", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pc-1@weddly.test");
    for (let i = 0; i < 3; i++) await addGuest(token, `Guest ${i}`);
    const res = await fetch(`${BASE}/api/print/place-cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectPdf(res);
  });

  test("more guests → bigger PDF (lower bound: per-card content)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pc-2@weddly.test");
    for (let i = 0; i < 2; i++) await addGuest(token, `Few ${i}`);
    const small = await fetch(`${BASE}/api/print/place-cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const smallBuf = new Uint8Array(await small.arrayBuffer());
    for (let i = 0; i < 30; i++) await addGuest(token, `Many ${i}`);
    const big = await fetch(`${BASE}/api/print/place-cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bigBuf = new Uint8Array(await big.arrayBuffer());
    expect(bigBuf.byteLength).toBeGreaterThan(smallBuf.byteLength);
  });

  test("?guest_ids with no matching ids → 404 no_matching_guests", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pc-3@weddly.test");
    await addGuest(token, "Just one");
    const res = await fetch(`${BASE}/api/print/place-cards?guest_ids=99999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("no_matching_guests");
  });

  test("?guest_ids with at least one valid id → 200", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pc-4@weddly.test");
    const gid = await addGuest(token, "Selectable");
    const res = await fetch(`${BASE}/api/print/place-cards?guest_ids=99999,${gid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectPdf(res);
  });
});

describe("print: schedule pdf", () => {
  test("anon → 401", async () => {
    const res = await fetch(`${BASE}/api/print/schedule`);
    expect(res.status).toBe(401);
  });

  test("returns a valid pdf even with no events", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ps-1@weddly.test");
    const res = await fetch(`${BASE}/api/print/schedule`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectPdf(res);
  });

  test("events are rendered in starts_at_minutes order (audit count matches)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ps-2@weddly.test");
    await makeEvent(token, { label: "C", starts_at_minutes: 18 * 60 });
    await makeEvent(token, { label: "A", starts_at_minutes: 10 * 60 });
    await makeEvent(token, { label: "B", starts_at_minutes: 14 * 60 });
    const res = await fetch(`${BASE}/api/print/schedule`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectPdf(res);
    // The list endpoint orders by starts_at; confirm event_count is 3.
    const row = db
      .prepare("SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'print.schedule'")
      .get(coupleId) as { after_json: string };
    expect(JSON.parse(row.after_json).event_count).toBe(3);
    // And the list endpoint orders them ASC.
    const list = await req<{ events: { label: string }[] }>("GET", "/api/schedule", undefined, {
      token,
    });
    expect(list.data.events.map((e) => e.label)).toEqual(["A", "B", "C"]);
  });

  test("cross-couple: B's schedule PDF doesn't include A's events (different sizes)", async () => {
    wipeAll();
    const a = await bootstrapCouple("ps-3a@weddly.test");
    const b = await bootstrapCouple("ps-3b@weddly.test");
    for (let i = 0; i < 10; i++) {
      await makeEvent(a.token, { label: `A-${i}`, starts_at_minutes: 600 + i });
    }
    const aRes = await fetch(`${BASE}/api/print/schedule`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    const bRes = await fetch(`${BASE}/api/print/schedule`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    const aBuf = new Uint8Array(await aRes.arrayBuffer());
    const bBuf = new Uint8Array(await bRes.arrayBuffer());
    // A has 10 rows of content; B has zero. A's PDF must be strictly larger.
    expect(aBuf.byteLength).toBeGreaterThan(bBuf.byteLength);
  });
});

describe("print: A4 vs A3 page size differs", () => {
  test("A3 layout is at least as large as A4 for the same content", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("aafmt@weddly.test");
    await addGuest(token, "G");
    const a4 = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const a3 = await fetch(`${BASE}/api/print/seating/a3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const a4Buf = new Uint8Array(await a4.arrayBuffer());
    const a3Buf = new Uint8Array(await a3.arrayBuffer());
    // Distinct outputs — different format string baked into the page.
    // Strict equality would be the bug we'd want to catch.
    expect(a4Buf.length === a3Buf.length && Buffer.from(a4Buf).equals(Buffer.from(a3Buf))).toBe(
      false,
    );
  });
});

describe("print: unknown couple", () => {
  test("verified user without a couple → 400 'No couple workspace yet'", async () => {
    wipeAll();
    const email = "no-couple@weddly.test";
    const reg = await registerAndVerify({
      email,
      password: "supersafe123",
      full_name: "Noémi Kiss",
    });
    expect(reg.status).toBe(201);
    const res = await fetch(`${BASE}/api/print/seating/a4`, {
      headers: { Authorization: `Bearer ${reg.data.token}` },
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schedule run-sheet fields — responsible + couple_supplier_id (F3)
// ─────────────────────────────────────────────────────────────────────────────

describe("schedule: run-sheet fields (responsible + supplier)", () => {
  test("create + patch persist responsible and couple_supplier_id", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-runsheet@weddly.test");

    // A booked DIY supplier to link the beat to.
    const sup = await req<{ supplier: { id: string } }>(
      "POST",
      "/api/couple-suppliers",
      { name: "DJ Marci", category: "dj" },
      { token },
    );
    const supplierId = sup.data.supplier.id;

    const created = await req<{
      event: { id: number; responsible: string | null; couple_supplier_id: string | null };
    }>(
      "POST",
      "/api/schedule",
      {
        label: "First dance",
        starts_at_minutes: 20 * 60,
        responsible: "Anna (maid of honour)",
        couple_supplier_id: supplierId,
      },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.event.responsible).toBe("Anna (maid of honour)");
    expect(created.data.event.couple_supplier_id).toBe(supplierId);

    // PATCH can clear them with null.
    const patched = await req<{
      event: { responsible: string | null; couple_supplier_id: string | null };
    }>(
      "PATCH",
      `/api/schedule/${created.data.event.id}`,
      { responsible: null, couple_supplier_id: null },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.event.responsible).toBeNull();
    expect(patched.data.event.couple_supplier_id).toBeNull();
  });

  test("duplicate carries the run-sheet fields", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-dup@weddly.test");
    const created = await req<{ event: { id: number } }>(
      "POST",
      "/api/schedule",
      { label: "Speeches", starts_at_minutes: 21 * 60, responsible: "Best man" },
      { token },
    );
    const dup = await req<{ event: { responsible: string | null; label: string } }>(
      "POST",
      `/api/schedule/${created.data.event.id}/duplicate`,
      {},
      { token },
    );
    expect(dup.status).toBe(201);
    expect(dup.data.event.responsible).toBe("Best man");
    expect(dup.data.event.label).toContain("copy");
  });

  test("responsible over the length cap is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-toolong@weddly.test");
    const r = await req(
      "POST",
      "/api/schedule",
      { label: "X", starts_at_minutes: 600, responsible: "z".repeat(81) },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("schedule: key moments", () => {
  test("defaults to false, round-trips true on create, and PATCH toggles it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-key-1@weddly.test");

    const plain = await makeEvent(token, { label: "Arrival", starts_at_minutes: 900 });
    expect(plain).toBeDefined();
    const listed = await req<{ events: { id: number; is_key_moment: boolean }[] }>(
      "GET",
      "/api/schedule",
      undefined,
      { token },
    );
    expect(listed.data.events.find((e) => e.id === plain.id)?.is_key_moment).toBe(false);

    const keyed = await req<{ event: { id: number; is_key_moment: boolean } }>(
      "POST",
      "/api/schedule",
      { label: "Ceremony", starts_at_minutes: 930, is_key_moment: true },
      { token },
    );
    expect(keyed.status).toBe(201);
    expect(keyed.data.event.is_key_moment).toBe(true);

    const patched = await req<{ event: { is_key_moment: boolean } }>(
      "PATCH",
      `/api/schedule/${plain.id}`,
      { is_key_moment: true },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.event.is_key_moment).toBe(true);
  });

  test("rejects a 5th key moment, on both create and PATCH", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-key-2@weddly.test");

    for (let i = 0; i < 4; i++) {
      const r = await req(
        "POST",
        "/api/schedule",
        { label: `Beat ${i}`, starts_at_minutes: 600 + i * 30, is_key_moment: true },
        { token },
      );
      expect(r.status).toBe(201);
    }

    // 5th key moment via create → 400 key_moment_max
    const fifth = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/schedule",
      { label: "Beat 5", starts_at_minutes: 800, is_key_moment: true },
      { token },
    );
    expect(fifth.status).toBe(400);
    expect(fifth.data.detail?.code).toBe("key_moment_max");

    // A plain create still works, but flipping it on via PATCH is blocked.
    const plain = await makeEvent(token, { label: "Plain", starts_at_minutes: 810 });
    const flip = await req<{ detail?: { code?: string } }>(
      "PATCH",
      `/api/schedule/${plain.id}`,
      { is_key_moment: true },
      { token },
    );
    expect(flip.status).toBe(400);
    expect(flip.data.detail?.code).toBe("key_moment_max");
  });

  test("re-saving an already-key event does not trip the cap", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("sched-key-3@weddly.test");
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await req<{ event: { id: number; updated_at: number } }>(
        "POST",
        "/api/schedule",
        { label: `Beat ${i}`, starts_at_minutes: 600 + i * 30, is_key_moment: true },
        { token },
      );
      ids.push(r.data.event.id);
    }
    // Edit the label of one of the four key moments — it stays key, cap intact.
    const r = await req<{ event: { is_key_moment: boolean; label: string } }>(
      "PATCH",
      `/api/schedule/${ids[0]}`,
      { label: "Renamed beat", is_key_moment: true },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.event.is_key_moment).toBe(true);
    expect(r.data.event.label).toBe("Renamed beat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seating tables — M1 correctness pass: seat-clamp envelope, partial-PATCH
// merge semantics, the resize→seats If-Match flow behind the "5 /7 but +
// does nothing" bug, and the occupied-seat disable guard.
// ─────────────────────────────────────────────────────────────────────────────

describe("seating tables: clamp envelope + partial PATCH semantics", () => {
  test("create clamps seats to the footprint and reports it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-clamp@weddly.test");
    // Ø150 cm round fits floor(π·1500 / 800) = 5 chairs; asking for 8 must
    // come back clamped WITH the diagnostic so the UI can explain.
    const r = await req<{
      table: { seats: number };
      seats_clamped?: boolean;
      seats_requested?: number;
    }>(
      "POST",
      "/api/seating/tables",
      { label: "Clamp", shape: "round", seats: 8, x_mm: 0, y_mm: 0, width_mm: 1500 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.seats).toBe(5);
    expect(r.data.seats_clamped).toBe(true);
    expect(r.data.seats_requested).toBe(8);
  });

  test("partial PATCH leaves unsent fields untouched", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-partial@weddly.test");
    const t = await makeTable(token, { shape: "round", seats: 5, width_mm: 1500, length_mm: 1500 });
    // Resize only — label/seats/position must carry through server-side.
    const grow = await req<{ table: { width_mm: number; seats: number; label: string } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { width_mm: 2000 },
      { token },
    );
    expect(grow.status).toBe(200);
    expect(grow.data.table.width_mm).toBe(2000);
    expect(grow.data.table.seats).toBe(5);
    expect(grow.data.table.label).toBe("T");
    // Seats only — the fresh 200 cm footprint (cap 7) must be what the
    // merge validates against, NOT a stale copy of the old dims.
    const seats = await req<{ table: { seats: number; width_mm: number } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 6 },
      { token },
    );
    expect(seats.status).toBe(200);
    expect(seats.data.table.seats).toBe(6);
    expect(seats.data.table.width_mm).toBe(2000);
  });

  test("resize then seat-add in rapid succession with per-response ETags", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-etag@weddly.test");
    const t = await makeTable(token, { shape: "round", seats: 5, width_mm: 1500, length_mm: 1500 });
    // The user's exact repro: grow 150 → 200 cm, then immediately + a seat.
    // Each write carries the ETag from the PREVIOUS response — no 409, no
    // clamp-back to the old cap.
    const grow = await req<{ table: { updated_at: number } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { width_mm: 2000 },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(grow.status).toBe(200);
    const add = await req<{ table: { seats: number }; seats_clamped?: boolean }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 6 },
      { token, headers: { "If-Match": String(grow.data.table.updated_at) } },
    );
    expect(add.status).toBe(200);
    expect(add.data.table.seats).toBe(6);
    expect(add.data.seats_clamped).toBeUndefined();
    // A write against the ORIGINAL (stale) ETag must 409 and report the
    // fresh timestamp so the client can retry.
    const stale = await req<{ error?: string; code?: string; current_updated_at?: number }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { seats: 7 },
      { token, headers: { "If-Match": String(t.updated_at) } },
    );
    expect(stale.status).toBe(409);
  });

  test("duplicate-style create preserves disabled and baby seats", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-dup@weddly.test");
    const r = await req<{ table: { disabled_seats: number[]; baby_seats: number[] } }>(
      "POST",
      "/api/seating/tables",
      {
        label: "Copy",
        shape: "round",
        seats: 6,
        x_mm: 800,
        y_mm: 800,
        width_mm: 3000,
        length_mm: 3000,
        disabled_seats: [1, 3],
        baby_seats: [2],
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.table.disabled_seats).toEqual([1, 3]);
    expect(r.data.table.baby_seats).toEqual([2]);
  });
});

describe("seating tables: occupied-seat disable guard", () => {
  test("disabling an occupied seat is rejected with seat_occupied", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-occ@weddly.test");
    const t = await makeTable(token, { seats: 6 });
    const guestId = await addGuest(token, "Sitting Guest");
    const assign = await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 1, guest_id: guestId },
      { token },
    );
    expect(assign.status).toBe(200);
    const r = await req<{ detail?: { code?: string } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { disabled_seats: [1] },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("seat_occupied");
    // The assignment survives untouched.
    const plan = await req<{ assignments: { guest_id: number; seat_index: number }[] }>(
      "GET",
      "/api/seating/plan",
      undefined,
      { token },
    );
    expect(plan.data.assignments).toEqual([
      expect.objectContaining({ guest_id: guestId, seat_index: 1 }),
    ]);
  });

  test("disabling a free seat still works, and pre-disabled seats pass through", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("st-m1-occ2@weddly.test");
    const t = await makeTable(token, { seats: 6 });
    const guestId = await addGuest(token, "Sitting Guest");
    await req(
      "POST",
      "/api/seating/assign",
      { table_id: t.id, seat_index: 1, guest_id: guestId },
      { token },
    );
    // Seat 2 is free — disabling it is fine.
    const ok = await req<{ table: { disabled_seats: number[] } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { disabled_seats: [2] },
      { token },
    );
    expect(ok.status).toBe(200);
    expect(ok.data.table.disabled_seats).toEqual([2]);
    // A later unrelated PATCH that re-sends the SAME disabled list must not
    // trip the guard (only newly-disabled seats are checked).
    const rename = await req<{ table: { label: string; disabled_seats: number[] } }>(
      "PATCH",
      `/api/seating/tables/${t.id}`,
      { label: "Renamed", disabled_seats: [2] },
      { token },
    );
    expect(rename.status).toBe(200);
    expect(rename.data.table.disabled_seats).toEqual([2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seating room size. It lived in one browser-wide localStorage key, which got
// it wrong three ways at once: partner B opened the same plan in a default
// 12x9 m room with the tables laid outside it, the seating PDF is rendered
// from a room size the CLIENT sends so the two partners printed different
// charts, and a couple with a second event shared one room between both
// weddings. It is workspace state now.
// ─────────────────────────────────────────────────────────────────────────────
describe("seating room size", () => {
  test("defaults to null, round-trips, and reaches the other partner", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("room-owner@weddly.test");

    const fresh = await req<{ couple: { seating_room_w_mm: number | null } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(fresh.status).toBe(200);
    // Null is "never sized", which the editor resolves to 12x9 m. Storing the
    // default eagerly would make "untouched" and "deliberately 12x9" the same
    // row.
    expect(fresh.data.couple.seating_room_w_mm).toBeNull();

    const saved = await req(
      "PATCH",
      "/api/couples/current",
      { seating_room_w_mm: 20_000, seating_room_h_mm: 30_000 },
      { token },
    );
    expect(saved.status).toBe(200);

    // The second partner, a different session entirely, gets the same floor.
    // A real-looking name on purpose: `checkRealName` refuses "Partner B".
    const partnerB = await registerAndVerify({
      email: "room-partner@weddly.test",
      password: "supersafe123",
      full_name: "Bence Kovács",
    });
    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(coupleId, partnerB.data.user.id);
    db.prepare(
      "INSERT OR IGNORE INTO couple_members (couple_id, user_id, role, created_at) VALUES (?, ?, 'partner', ?)",
    ).run(coupleId, partnerB.data.user.id, Date.now());

    const theirs = await req<{
      couple: { seating_room_w_mm: number | null; seating_room_h_mm: number | null };
    }>("GET", "/api/couples/current", undefined, { token: partnerB.data.token });
    expect(theirs.status).toBe(200);
    expect(theirs.data.couple.seating_room_w_mm).toBe(20_000);
    expect(theirs.data.couple.seating_room_h_mm).toBe(30_000);
  });

  test("accepts the full range the canvas allows, and refuses what it cannot produce", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("room-bounds@weddly.test");

    // 60 m is a legal room: the editor's input tops out at 100 m, so a
    // validator with its own lower ceiling would reject a room a couple can
    // type. Both read isRoomDimension from shared/seating.
    const wide = await req(
      "PATCH",
      "/api/couples/current",
      { seating_room_w_mm: 60_000, seating_room_h_mm: 100_000 },
      { token },
    );
    expect(wide.status).toBe(200);

    for (const body of [
      { seating_room_w_mm: 2_999 },
      { seating_room_w_mm: 100_001 },
      { seating_room_h_mm: 12_000.5 },
      { seating_room_h_mm: "12000" },
    ]) {
      const bad = await req("PATCH", "/api/couples/current", body, { token });
      expect(`${JSON.stringify(body)} → ${bad.status}`).toBe(`${JSON.stringify(body)} → 400`);
    }

    // Out of range is a 400 rather than a clamp, so the stored room is still
    // the last good one rather than a number nobody sent.
    const after = await req<{ couple: { seating_room_w_mm: number | null } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(after.data.couple.seating_room_w_mm).toBe(60_000);
  });

  test("null clears it back to the default", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("room-clear@weddly.test");
    await req(
      "PATCH",
      "/api/couples/current",
      { seating_room_w_mm: 18_000, seating_room_h_mm: 14_000 },
      { token },
    );
    const cleared = await req(
      "PATCH",
      "/api/couples/current",
      { seating_room_w_mm: null, seating_room_h_mm: null },
      { token },
    );
    expect(cleared.status).toBe(200);
    const after = await req<{
      couple: { seating_room_w_mm: number | null; seating_room_h_mm: number | null };
    }>("GET", "/api/couples/current", undefined, { token });
    expect(after.data.couple.seating_room_w_mm).toBeNull();
    expect(after.data.couple.seating_room_h_mm).toBeNull();
  });

  test("a PATCH about something else leaves the room alone", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("room-untouched@weddly.test");
    await req(
      "PATCH",
      "/api/couples/current",
      { seating_room_w_mm: 22_000, seating_room_h_mm: 16_000 },
      { token },
    );
    const other = await req(
      "PATCH",
      "/api/couples/current",
      { display_name: "Renamed" },
      { token },
    );
    expect(other.status).toBe(200);
    const after = await req<{
      couple: { seating_room_w_mm: number | null; seating_room_h_mm: number | null };
    }>("GET", "/api/couples/current", undefined, { token });
    expect(after.data.couple.seating_room_w_mm).toBe(22_000);
    expect(after.data.couple.seating_room_h_mm).toBe(16_000);
  });
});
