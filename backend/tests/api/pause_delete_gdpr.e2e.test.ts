import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db, now } from "../../src/db";
import { runPurgeSweep } from "../../src/domain/purge";

// All tests in this file run sequentially and start with wipeAll() so couple_id
// + user_id sequences reset cleanly between scenarios.
//
// The purge sweep itself doesn't accept a `mockNow` parameter — it reads
// `now()` directly. To exercise the "deadline reached" path without waiting
// 30 real days we forcibly age the `scheduled_delete_at` column on the row
// to a past timestamp before invoking runPurgeSweep(). This matches the
// real-world boot sweep semantics: a row already past its deadline gets
// processed on the next sweep tick.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface RegisterResp {
  token: string;
  user: { id: number; email: string };
}

async function freshUserNoCouple(email: string): Promise<{ token: string; userId: number }> {
  const r = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Test User",
  });
  expect(r.status).toBe(201);
  await verifyUserEmail(email);
  return { token: r.data.token, userId: r.data.user.id };
}

async function registerAndAcceptInvite(email: string, inviteToken: string): Promise<string> {
  const reg = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const accept = await req(
    "POST",
    `/api/invites/${inviteToken}/accept`,
    {},
    { token: reg.data.token },
  );
  expect(accept.status).toBe(200);
  return reg.data.token;
}

/** Force the active pause request's scheduled_delete_at to a specific past
 *  timestamp so runPurgeSweep() picks it up on the next call. */
function setDeadlineTo(coupleId: number, target: number): void {
  db.prepare(
    "UPDATE couple_pause_requests SET scheduled_delete_at = ? WHERE couple_id = ? AND status = 'pending'",
  ).run(target, coupleId);
}

// ════════════════════════════════════════════════════════════════════════════
//   PAUSE WINDOW — request, validate, cancel
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: pause window scheduling", () => {
  test("POST /api/couples/pause stamps scheduled_delete_at ≈ now + 30 days", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-schedule@weddly.test");

    const t0 = Date.now();
    const r = await req<{ pause_request: { scheduled_delete_at: number; status: string } }>(
      "POST",
      "/api/couples/pause",
      {},
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.pause_request.status).toBe("pending");

    const delta = r.data.pause_request.scheduled_delete_at - t0;
    // Allow ±60s for test-runtime jitter (task spec tolerance).
    expect(Math.abs(delta - THIRTY_DAYS_MS)).toBeLessThan(60_000);
  });

  test("cancel before deadline removes the pause and flips couple back to active", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pause-cancel@weddly.test");

    await req("POST", "/api/couples/pause", {}, { token });
    const beforeRow = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(beforeRow.status).toBe("paused");

    const cancel = await req<{ ok: boolean }>("POST", "/api/couples/pause/cancel", {}, { token });
    expect(cancel.status).toBe(200);
    expect(cancel.data.ok).toBe(true);

    const afterRow = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(afterRow.status).toBe("active");

    // The pause-request row itself flipped to 'cancelled' (not deleted —
    // schema is additive-only).
    const pauseRow = db
      .prepare(
        "SELECT status, completed_at FROM couple_pause_requests WHERE couple_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { status: string; completed_at: number };
    expect(pauseRow.status).toBe("cancelled");
    expect(pauseRow.completed_at).toBeGreaterThan(0);

    // No 'pending' rows remain for this couple.
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS n FROM couple_pause_requests WHERE couple_id = ? AND status = 'pending'",
      )
      .get(coupleId) as { n: number };
    expect(pending.n).toBe(0);
  });

  test("cancel without an active pause returns 404 (not 200)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-cancel-none@weddly.test");

    const r = await req("POST", "/api/couples/pause/cancel", {}, { token });
    expect(r.status).toBe(404);
  });

  test("pausing an archived couple returns 409 (status != active)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-archived@weddly.test");
    await req("POST", "/api/couples/current/archive", {}, { token });

    const r = await req("POST", "/api/couples/pause", {}, { token });
    expect(r.status).toBe(409);
  });

  test("double-pause: the second request 409s", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("pause-double@weddly.test");

    const first = await req("POST", "/api/couples/pause", {}, { token });
    expect(first.status).toBe(201);

    const second = await req("POST", "/api/couples/pause", {}, { token });
    expect(second.status).toBe(409);
  });

  test("reason of pure whitespace stores NULL; >500 chars is trimmed to 500", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("pause-reason-trim@weddly.test");

    // Pure-whitespace reason → null.
    await req("POST", "/api/couples/pause", { reason: "   \t  \n " }, { token });
    let row = db
      .prepare(
        "SELECT reason FROM couple_pause_requests WHERE couple_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { reason: string | null };
    expect(row.reason).toBeNull();

    // Cancel to clear the active state, then try a 600-char reason.
    await req("POST", "/api/couples/pause/cancel", {}, { token });
    await req("POST", "/api/couples/pause", { reason: `   ${"x".repeat(600)}   ` }, { token });
    row = db
      .prepare(
        "SELECT reason FROM couple_pause_requests WHERE couple_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { reason: string | null };
    expect(row.reason).not.toBeNull();
    expect(row.reason!.length).toBe(500);
    // Leading whitespace stripped before the cap.
    expect(row.reason!.startsWith("x")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   PAUSE STATUS QUERY — couple_status + pause_request reflection
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: GET /api/couples/pause status", () => {
  test("returns couple_status='active' with pause_request=null when no pause is active", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("status-active@weddly.test");

    const r = await req<{ couple_status: string; pause_request: unknown }>(
      "GET",
      "/api/couples/pause",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple_status).toBe("active");
    expect(r.data.pause_request).toBeNull();
  });

  test("after pause request, returns couple_status='paused' + scheduled_delete_at", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("status-pending@weddly.test");
    await req("POST", "/api/couples/pause", { reason: "thinking" }, { token });

    const r = await req<{
      couple_status: string;
      pause_request: { status: string; scheduled_delete_at: number } | null;
    }>("GET", "/api/couples/pause", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couple_status).toBe("paused");
    expect(r.data.pause_request).not.toBeNull();
    expect(r.data.pause_request!.status).toBe("pending");
    expect(r.data.pause_request!.scheduled_delete_at).toBeGreaterThan(Date.now());
  });

  test("GET /api/couples/pause without a couple → 400", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("status-nocouple@weddly.test");

    const r = await req("GET", "/api/couples/pause", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("suspended user → 401 (verify-token rejects before the handler runs)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("status-suspended@weddly.test");

    // Suspend the user manually — verifyToken's loadUserById filter drops
    // suspended rows so the bearer becomes unusable.
    db.prepare("UPDATE users SET status = 'suspended' WHERE couple_id = ?").run(coupleId);

    const r = await req("GET", "/api/couples/pause", undefined, { token });
    expect(r.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   PURGE SWEEP — deadline-driven scrub
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: runPurgeSweep deadline gating", () => {
  test("sweep one day before the deadline: PII stays intact, status remains 'paused'", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-before@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });

    // Push the deadline 1 day INTO THE FUTURE relative to now() — the sweep
    // should skip it because `scheduled_delete_at > now()`.
    setDeadlineTo(coupleId, now() + ONE_DAY_MS);

    const result = runPurgeSweep();
    expect(result.purged).toBe(0);

    const couple = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(couple.status).toBe("paused");

    // PII is intact.
    const u = db
      .prepare("SELECT email, password_hash FROM users WHERE couple_id = ?")
      .get(coupleId) as { email: string; password_hash: string };
    expect(u.email).toBe("sweep-before@weddly.test");
    expect(u.password_hash).not.toBe("!purged!");
  });

  test("sweep at the deadline: status flips to 'deleting' and PII is scrubbed", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-at@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });

    // Age the deadline by 1 day into the past so the sweep treats it as due.
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);

    const result = runPurgeSweep();
    expect(result.purged).toBe(1);

    const couple = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(coupleId) as { status: string; display_name: string };
    expect(couple.status).toBe("deleting");
    expect(couple.display_name).toBe("Purged workspace");

    const u = db
      .prepare("SELECT id, email, password_hash, full_name, status FROM users WHERE couple_id = ?")
      .get(coupleId) as {
      id: number;
      email: string;
      password_hash: string;
      full_name: string;
      status: string;
    };
    expect(u.email).toBe(`deleted-${u.id}@purged.local`);
    expect(u.password_hash).toBe("!purged!");
    expect(u.full_name).toBe("Purged user");
    expect(u.status).toBe("suspended");
  });

  test("purge wipes every child PII table for the couple", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-children@weddly.test");

    // Plant rows in a handful of child tables so the sweep has something to
    // erase. We use the public API where possible so the test mirrors a
    // real-user workflow.
    await req("POST", "/api/guests", { full_name: "Aunt Klári" }, { token });
    await req(
      "POST",
      "/api/budget-lines",
      { category: "venue", label: "Reception hall", planned_huf: 1_500_000 },
      { token },
    );
    await req("POST", "/api/planning", { kind: "task", title: "Pick the cake" }, { token });
    await req(
      "POST",
      "/api/schedule",
      { label: "Ceremony", starts_at_minutes: 16 * 60 },
      { token },
    );

    // Pause + force the deadline into the past + sweep.
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const tables = [
      "guests",
      "households",
      "budget_lines",
      "schedule_events",
      "planning_items",
      "seat_assignments",
      "seating_tables",
      "couple_supplier_costs",
      "couple_suppliers",
    ];
    for (const t of tables) {
      // `couple_supplier_costs` and child tables may not have the couple_id
      // column directly in seat_assignments — but the purge.ts sweep DELETEs
      // by table_id IN (...). We assert the count regardless.
      let n: number;
      if (t === "seat_assignments") {
        n = (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM seat_assignments WHERE table_id IN (SELECT id FROM seating_tables WHERE couple_id = ?)",
            )
            .get(coupleId) as { n: number }
        ).n;
      } else {
        n = (
          db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE couple_id = ?`).get(coupleId) as {
            n: number;
          }
        ).n;
      }
      expect(n).toBe(0);
    }
  });

  test("purge keeps the couples row (FK target for audit_log) with status='deleting'", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-couple-row@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const row = db
      .prepare("SELECT id, status, display_name, wedding_date FROM couples WHERE id = ?")
      .get(coupleId) as
      | { id: number; status: string; display_name: string; wedding_date: string | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.id).toBe(coupleId);
    expect(row!.status).toBe("deleting");
    expect(row!.display_name).toBe("Purged workspace");
    expect(row!.wedding_date).toBeNull();
  });

  test("purge keeps audit_log rows for the couple (admin retention)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-audit@weddly.test");

    // Audit-log entries are written by the pause and by ordinary actions.
    await req("POST", "/api/guests", { full_name: "Aunt Trixi" }, { token });
    await req("POST", "/api/couples/pause", {}, { token });

    const beforeCount = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ?").get(coupleId) as {
        n: number;
      }
    ).n;
    expect(beforeCount).toBeGreaterThan(0);

    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const afterCount = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ?").get(coupleId) as {
        n: number;
      }
    ).n;
    // Audit log is append-only; sweep only INSERTs a `couple.purge` row.
    expect(afterCount).toBeGreaterThan(beforeCount);

    // The purge itself is recorded.
    const purgeRow = db
      .prepare(
        "SELECT action FROM audit_log WHERE couple_id = ? AND action = 'couple.purge' LIMIT 1",
      )
      .get(coupleId) as { action: string } | undefined;
    expect(purgeRow?.action).toBe("couple.purge");
  });

  test("purge marks the pause request as 'completed' (idempotency anchor)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-completes@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const row = db
      .prepare(
        "SELECT status, completed_at FROM couple_pause_requests WHERE couple_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { status: string; completed_at: number };
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBeGreaterThan(0);
  });

  test("purge deletes email_log rows for the couple (PII contains to_email)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-email-log@weddly.test");
    // The welcome-verify mailer ran during bootstrapCouple → at least one
    // row references this user_id.
    const before = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM email_log WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?)",
        )
        .get(coupleId) as { n: number }
    ).n;
    expect(before).toBeGreaterThanOrEqual(0);

    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const after = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM email_log WHERE user_id IN (SELECT id FROM users WHERE couple_id = ?) OR couple_id = ?",
        )
        .get(coupleId, coupleId) as { n: number }
    ).n;
    // Whatever `account_purged` mail the worker fired is enqueued AFTER
    // bootstrap's welcome mail but before the DELETE statement runs in the
    // same synchronous call. In a hermetic test (RESEND_API_KEY=""), the
    // mailer skips outbound but still writes a `skipped_no_provider` row.
    // The sweep deletes both — final count is 0.
    expect(after).toBe(0);
  });

  test("re-pause after cancel: deadline is +30 days from the SECOND pause", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-repause@weddly.test");

    await req("POST", "/api/couples/pause", {}, { token });
    await req("POST", "/api/couples/pause/cancel", {}, { token });

    const t0 = Date.now();
    const second = await req<{ pause_request: { scheduled_delete_at: number } }>(
      "POST",
      "/api/couples/pause",
      {},
      { token },
    );
    expect(second.status).toBe(201);

    const delta = second.data.pause_request.scheduled_delete_at - t0;
    expect(Math.abs(delta - THIRTY_DAYS_MS)).toBeLessThan(60_000);

    // Two rows in couple_pause_requests for this couple: first cancelled,
    // second pending — the SQL-most-recent one is the live one.
    const rows = db
      .prepare("SELECT status FROM couple_pause_requests WHERE couple_id = ? ORDER BY id ASC")
      .all(coupleId) as { status: string }[];
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "pending"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   SESSIONS — before and after deadline
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: session lifecycle vs. purge", () => {
  test("pause request alone does NOT revoke the user's bearer token", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("session-paused@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });

    const me = await req("GET", "/api/auth/me", undefined, { token });
    // The session is still valid; the user can keep using their bearer.
    expect(me.status).toBe(200);
  });

  test("purge at deadline revokes the session — old token returns 401", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("session-purged@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const me = await req("GET", "/api/auth/me", undefined, { token });
    // sessions table is wiped for every user belonging to the couple;
    // the bearer can no longer be exchanged for ctx.userId.
    expect(me.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   CROSS-COUPLE ISOLATION
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: cross-couple isolation", () => {
  test("couple A's pause does not affect couple B's status", async () => {
    wipeAll();
    const { token: tA, coupleId: cidA } = await bootstrapCouple("iso-a@weddly.test");
    const { coupleId: cidB } = await bootstrapCouple("iso-b@weddly.test");

    await req("POST", "/api/couples/pause", {}, { token: tA });

    const a = db.prepare("SELECT status FROM couples WHERE id = ?").get(cidA) as {
      status: string;
    };
    const b = db.prepare("SELECT status FROM couples WHERE id = ?").get(cidB) as {
      status: string;
    };
    expect(a.status).toBe("paused");
    expect(b.status).toBe("active");
  });

  test("purging couple A at deadline leaves couple B's data fully intact", async () => {
    wipeAll();
    const { token: tA, coupleId: cidA } = await bootstrapCouple("iso-purge-a@weddly.test");
    const { token: tB, coupleId: cidB } = await bootstrapCouple("iso-purge-b@weddly.test");

    // Plant data in B that we'll re-assert after the purge.
    await req("POST", "/api/guests", { full_name: "B's aunt" }, { token: tB });

    await req("POST", "/api/couples/pause", {}, { token: tA });
    setDeadlineTo(cidA, now() - ONE_DAY_MS);
    const result = runPurgeSweep();
    expect(result.purged).toBe(1);

    // A is scrubbed.
    const aCouple = db.prepare("SELECT status FROM couples WHERE id = ?").get(cidA) as {
      status: string;
    };
    expect(aCouple.status).toBe("deleting");

    // B is untouched.
    const bCouple = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(cidB) as { status: string; display_name: string };
    expect(bCouple.status).toBe("active");
    expect(bCouple.display_name).toBe("Mia & Lucas");

    const bGuests = (
      db.prepare("SELECT COUNT(*) AS n FROM guests WHERE couple_id = ?").get(cidB) as { n: number }
    ).n;
    expect(bGuests).toBe(1);

    const bUser = db
      .prepare("SELECT email, password_hash FROM users WHERE couple_id = ?")
      .get(cidB) as { email: string; password_hash: string };
    expect(bUser.email).toBe("iso-purge-b@weddly.test");
    expect(bUser.password_hash).not.toBe("!purged!");
  });

  test("user with multiple workspaces: purging only the paused one preserves the other", async () => {
    wipeAll();
    const { token, coupleId: alphaId } = await bootstrapCouple("multi-purge@weddly.test");

    // Spin up a second workspace (Bravo) for the same user via POST /api/couples.
    const bravo = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Anniversary brunch", wedding_date_goal: { kind: "tbd" } },
      { token },
    );
    expect(bravo.status).toBe(201);
    const bravoId = bravo.data.couple.id;

    // The active workspace is now Bravo. Switch back to Alpha so pause()
    // targets the workspace we expect to be purged.
    const sw = await req("POST", "/api/users/me/active-couple", { couple_id: alphaId }, { token });
    expect(sw.status).toBe(200);

    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(alphaId, now() - ONE_DAY_MS);
    runPurgeSweep();

    // Alpha is in 'deleting'.
    const alpha = db.prepare("SELECT status FROM couples WHERE id = ?").get(alphaId) as {
      status: string;
    };
    expect(alpha.status).toBe("deleting");

    // Bravo survives untouched.
    const bravoRow = db
      .prepare("SELECT status, display_name FROM couples WHERE id = ?")
      .get(bravoId) as { status: string; display_name: string };
    expect(bravoRow.status).toBe("active");
    expect(bravoRow.display_name).not.toBe("Purged workspace");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   AUDIT TRAIL — pause / cancel / purge
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: audit trail", () => {
  test("audit_log records couple.pause + couple.unpause + couple.purge across the flow", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("audit-flow@weddly.test");

    await req("POST", "/api/couples/pause", { reason: "thinking" }, { token });
    await req("POST", "/api/couples/pause/cancel", {}, { token });
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);
    runPurgeSweep();

    const rows = db
      .prepare(
        "SELECT action FROM audit_log WHERE couple_id = ? AND action IN ('couple.pause', 'couple.unpause', 'couple.purge') ORDER BY id ASC",
      )
      .all(coupleId) as { action: string }[];

    expect(rows.map((r) => r.action)).toEqual([
      "couple.pause",
      "couple.unpause",
      "couple.pause",
      "couple.purge",
    ]);
  });

  test("audit row for couple.pause carries scheduled_delete_at + reason in after_json", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("audit-payload@weddly.test");
    await req("POST", "/api/couples/pause", { reason: "second thoughts" }, { token });

    const row = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE couple_id = ? AND action = 'couple.pause' LIMIT 1",
      )
      .get(coupleId) as { after_json: string };
    const parsed = JSON.parse(row.after_json) as {
      scheduled_delete_at: number;
      reason: string | null;
    };
    expect(parsed.reason).toBe("second thoughts");
    expect(parsed.scheduled_delete_at).toBeGreaterThan(Date.now());
  });
});

// ════════════════════════════════════════════════════════════════════════════
//   DATA RESIDENCY — what survives a purge
// ════════════════════════════════════════════════════════════════════════════

describe("pause_delete_gdpr: data residency after purge", () => {
  test("partner B (joined via /accept) can also pause — both partners are equals", async () => {
    wipeAll();
    const { token: aToken, coupleId } = await bootstrapCouple("perm-a@weddly.test");
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "perm-b@weddly.test" },
      { token: aToken },
    );
    expect(inv.status).toBe(201);
    const bToken = await registerAndAcceptInvite("perm-b@weddly.test", inv.data.invite.token);

    // Documented behaviour: the handler scopes by couple_id (not role) so
    // partner B can request the pause too. This pins the actual observed
    // behaviour — if we ever tighten this to owner-only it'll be a 403 here
    // and this test will catch the regression.
    const r = await req("POST", "/api/couples/pause", {}, { token: bToken });
    expect(r.status).toBe(201);

    const c = db.prepare("SELECT status FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
    };
    expect(c.status).toBe("paused");
  });

  test("cancel without a workspace at all → 400 'no couple' (not 401, not 404)", async () => {
    wipeAll();
    const { token } = await freshUserNoCouple("cancel-noc@weddly.test");
    const r = await req("POST", "/api/couples/pause/cancel", {}, { token });
    expect(r.status).toBe(400);
  });

  test("runPurgeSweep is idempotent — calling twice at deadline is a no-op the second time", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("sweep-idem@weddly.test");
    await req("POST", "/api/couples/pause", {}, { token });
    setDeadlineTo(coupleId, now() - ONE_DAY_MS);

    const first = runPurgeSweep();
    expect(first.purged).toBe(1);

    // Couple is now 'deleting' and the pause row is 'completed' — the next
    // sweep finds no pending rows, so purged === 0.
    const second = runPurgeSweep();
    expect(second.purged).toBe(0);

    // Couple state remains 'deleting' (the second sweep did not re-run the
    // scrub or revert any field).
    const c = db.prepare("SELECT status, display_name FROM couples WHERE id = ?").get(coupleId) as {
      status: string;
      display_name: string;
    };
    expect(c.status).toBe("deleting");
    expect(c.display_name).toBe("Purged workspace");

    // Audit-log: exactly ONE couple.purge entry (the second sweep didn't
    // append a redundant row).
    const purgeRows = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'couple.purge'",
        )
        .get(coupleId) as { n: number }
    ).n;
    expect(purgeRows).toBe(1);
  });
});
