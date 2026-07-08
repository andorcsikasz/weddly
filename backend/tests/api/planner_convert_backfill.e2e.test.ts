// Boot reconciler: heal accepted /planners applicants who landed on a plain
// couple account instead of a planner (the "Regisztrációra vár" mis-route).
// Account only, non-destructive to couple data, idempotent, audited, and it
// skips vendors, admins, demo accounts, and suspended users.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { backfillWaitlistPlannerConversions } from "../../src/domain/planner_conversion";
import { bootstrapCouple, wipeAll } from "../helpers";

function seedAcceptedWaitlist(email: string, fullName = "Applicant"): void {
  const ts = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO planner_waitlist
       (full_name, email, phone, company_name, city, selected_plan, status, created_at)
     VALUES (?, ?, '+3630', 'Some Co', 'Budapest', 'pro', 'accepted', ?)`,
  ).run(fullName, email, ts);
}

/** Minimal users row for the skip-matrix cases (no full bootstrap needed). */
function insertUser(
  email: string,
  opts: { role?: string; status?: string; user_type?: string } = {},
): number {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          password_set, user_type, created_at, updated_at)
       VALUES (?, 'x', 'Name', ?, ?, 1, 1, ?, ?, ?)`,
    )
    .run(
      email.toLowerCase(),
      opts.status ?? "active",
      opts.role ?? "owner",
      opts.user_type ?? "couple",
      ts,
      ts,
    );
  return Number(info.lastInsertRowid);
}

function userType(userId: number): string {
  return (
    db.prepare("SELECT user_type FROM users WHERE id = ?").get(userId) as { user_type: string }
  ).user_type;
}

describe("planner conversion backfill", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("converts a mis-routed couple account, preserves couple data, idempotent, audited", async () => {
    const { coupleId } = await bootstrapCouple("evelin@weddly.test");
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get("evelin@weddly.test") as {
      id: number;
    };
    seedAcceptedWaitlist("Evelin@weddly.test"); // casing differs on purpose

    const converted = backfillWaitlistPlannerConversions();
    expect(converted).toBe(1);

    const row = db.prepare("SELECT user_type, couple_id FROM users WHERE id = ?").get(u.id) as {
      user_type: string;
      couple_id: number | null;
    };
    expect(row.user_type).toBe("planner");
    expect(row.couple_id).toBe(coupleId); // couple data preserved

    // Seeded from the application + billing granted.
    const seeded = db
      .prepare("SELECT business_name, planner_plan FROM users WHERE id = ?")
      .get(u.id) as { business_name: string | null; planner_plan: string | null };
    expect(seeded.business_name).toBe("Some Co");
    expect(seeded.planner_plan).toBe("pro");
    expect(
      db.prepare("SELECT 1 FROM planner_subscriptions WHERE user_id = ?").get(u.id),
    ).toBeDefined();

    // One audit row for the conversion.
    const audit = db
      .prepare(
        "SELECT 1 FROM audit_log WHERE action = 'system.planner_backfill_convert' AND target_id = ?",
      )
      .get(u.id);
    expect(audit).toBeDefined();

    // Idempotent: a second run converts nothing (they're a planner now).
    expect(backfillWaitlistPlannerConversions()).toBe(0);
  });

  test("skips vendors, admins, demo, and suspended accounts", async () => {
    const vendor = insertUser("vendor@weddly.test", { role: "vendor" });
    const admin = insertUser("admin@test.test"); // in the test ADMIN_EMAILS allowlist
    const demo = insertUser("someone@demo.weddly.local");
    const suspended = insertUser("suspended@weddly.test", { status: "suspended" });
    const control = insertUser("control@weddly.test");
    for (const e of [
      "vendor@weddly.test",
      "admin@test.test",
      "someone@demo.weddly.local",
      "suspended@weddly.test",
      "control@weddly.test",
    ]) {
      seedAcceptedWaitlist(e);
    }

    const converted = backfillWaitlistPlannerConversions();
    expect(converted).toBe(1); // only the control

    expect(userType(vendor)).toBe("couple");
    expect(userType(admin)).toBe("couple");
    expect(userType(demo)).toBe("couple");
    expect(userType(suspended)).toBe("couple");
    expect(userType(control)).toBe("planner");
  });
});
