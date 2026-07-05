import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminPlannerView } from "@shared/types";
import { db, now } from "../../src/db";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Seed a planner: a users row flipped to user_type='planner'. Returns userId. */
async function seedPlanner(email: string): Promise<number> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Planner Person",
  });
  await verifyUserEmail(email);
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE id = ?").run(userId);
  return userId;
}

describe("admin planner management", () => {
  test("lists planners with active-client counts", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner1@weddly.test");
    const { coupleId } = await bootstrapCouple("client1@weddly.test");
    db.prepare(
      "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'active', ?)",
    ).run(plannerId, coupleId, now());

    const res = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const planner = res.data.planners.find(
      (p): p is Extract<AdminPlannerView, { state: "active" }> =>
        p.state === "active" && p.user_id === plannerId,
    );
    expect(planner).toBeDefined();
    expect(planner?.client_count).toBe(1);
    expect(planner?.planner_plan).toBe("starter");
  });

  test("merges accepted waitlist applicants: pending rows for no-account emails, profile attached to matching accounts", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("hasaccount@weddly.test");

    const ts = Math.floor(Date.now() / 1000);
    const insertWaitlist = db.prepare(
      `INSERT INTO planner_waitlist
         (full_name, email, phone, company_name, city, km_radius, website,
          wedding_style_1, wedding_style_2, early_bird, reference_links,
          status, outcome_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    );
    // Matched by email (case-insensitive) to the seeded account.
    insertWaitlist.run(
      "Planner Person",
      "HasAccount@weddly.test",
      "+3611",
      "Acc Co",
      "Budapest",
      120,
      "acc.example",
      "romantic",
      "vintage",
      1,
      "instagram.com/acc",
      ts,
      ts,
    );
    // No account for this email → should surface as a pending row.
    insertWaitlist.run(
      "No Account",
      "noaccount@weddly.test",
      "+3622",
      "NoAcc Co",
      "Szeged",
      80,
      "noacc.example",
      "classic",
      null,
      0,
      null,
      ts,
      ts,
    );

    const res = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);

    const account = res.data.planners.find(
      (p): p is Extract<AdminPlannerView, { state: "active" }> =>
        p.state === "active" && p.user_id === plannerId,
    );
    expect(account?.waitlist?.company_name).toBe("Acc Co");
    expect(account?.waitlist?.wedding_styles).toEqual(["romantic", "vintage"]);
    expect(account?.waitlist?.early_bird).toBe(true);

    const pending = res.data.planners.find(
      (p): p is Extract<AdminPlannerView, { state: "pending" }> =>
        p.state === "pending" && p.email === "noaccount@weddly.test",
    );
    expect(pending).toBeDefined();
    expect(pending?.full_name).toBe("No Account");
    expect(pending?.waitlist.city).toBe("Szeged");
    // The no-account applicant must NOT also appear as an active account.
    expect(
      res.data.planners.some((p) => p.state === "active" && p.email === "noaccount@weddly.test"),
    ).toBe(false);
  });

  test("suspend + reactivate flips users.status", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner2@weddly.test");

    const suspend = await req(
      "POST",
      `/api/admin/planners/${plannerId}/suspend`,
      {},
      { token: adminToken },
    );
    expect(suspend.status).toBe(200);
    let row = db.prepare("SELECT status FROM users WHERE id = ?").get(plannerId) as {
      status: string;
    };
    expect(row.status).toBe("suspended");

    const reactivate = await req(
      "POST",
      `/api/admin/planners/${plannerId}/reactivate`,
      {},
      { token: adminToken },
    );
    expect(reactivate.status).toBe(200);
    row = db.prepare("SELECT status FROM users WHERE id = ?").get(plannerId) as { status: string };
    expect(row.status).toBe("active");
  });

  test("PATCH plan tier updates plan + max clients", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner3@weddly.test");

    const res = await req(
      "PATCH",
      `/api/admin/planners/${plannerId}`,
      { planner_plan: "premium" },
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT planner_plan, planner_max_clients FROM users WHERE id = ?")
      .get(plannerId) as { planner_plan: string; planner_max_clients: number };
    expect(row.planner_plan).toBe("premium");
    expect(row.planner_max_clients).toBe(10);
  });

  test("PATCH rejects an unknown plan", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner4@weddly.test");
    const res = await req(
      "PATCH",
      `/api/admin/planners/${plannerId}`,
      { planner_plan: "gold" },
      { token: adminToken },
    );
    expect(res.status).toBe(400);
  });

  test("DELETE purges the planner", async () => {
    const adminToken = await bootstrapAdmin();
    const plannerId = await seedPlanner("planner5@weddly.test");
    const res = await req("DELETE", `/api/admin/planners/${plannerId}`, undefined, {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    // purgeOneUser scrubs the user (email → purged) rather than hard-deleting.
    const row = db.prepare("SELECT email FROM users WHERE id = ?").get(plannerId) as
      | { email: string }
      | undefined;
    expect(row?.email.endsWith("@purged.local")).toBe(true);
  });

  test("targeting a non-planner user 404s", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("regular@weddly.test");
    const owner = db.prepare("SELECT id FROM users WHERE couple_id = ? LIMIT 1").get(coupleId) as {
      id: number;
    };
    const res = await req(
      "PATCH",
      `/api/admin/planners/${owner.id}`,
      { planner_plan: "pro" },
      { token: adminToken },
    );
    expect(res.status).toBe(404);
  });

  test("non-admin is rejected", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("notadmin2@weddly.test");
    const res = await req("GET", "/api/admin/planners", undefined, { token });
    expect(res.status).toBe(403);
  });

  /** Insert an accepted planner_waitlist row, returning its id. */
  function seedAcceptedWaitlist(email: string, fullName = "Applicant"): number {
    const ts = Math.floor(Date.now() / 1000);
    const info = db
      .prepare(
        `INSERT INTO planner_waitlist (full_name, email, phone, status, created_at)
         VALUES (?, ?, '+3630', 'accepted', ?)`,
      )
      .run(fullName, email, ts);
    return Number(info.lastInsertRowid);
  }

  test("send-invite to a no-account applicant emails a register CTA and keeps them pending", async () => {
    const adminToken = await bootstrapAdmin();
    const waitlistId = seedAcceptedWaitlist("newbie@weddly.test", "Newbie Planner");

    const res = await req<{ ok: true; granted: boolean; has_account: boolean }>(
      "POST",
      `/api/admin/planners/pending/${waitlistId}/send-invite`,
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.granted).toBe(false);
    expect(res.data.has_account).toBe(false);

    const mail = db
      .prepare("SELECT kind FROM email_log WHERE kind = 'planner_access_invite' AND to_email = ?")
      .all("newbie@weddly.test") as { kind: string }[];
    expect(mail.length).toBe(1);

    // Nothing granted (no account existed) → still a pending row.
    const list = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(
      list.data.planners.some((p) => p.state === "pending" && p.email === "newbie@weddly.test"),
    ).toBe(true);
  });

  test("send-invite to an orphaned account grants planner + moves it out of pending", async () => {
    const adminToken = await bootstrapAdmin();
    // Registered under this email as a COUPLE (the orphan case): an account
    // exists but user_type != 'planner', so the email-only waitlist match never
    // cleared it and it stays stuck on "Regisztrációra vár".
    const { coupleId } = await bootstrapCouple("orphan@weddly.test");
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get("orphan@weddly.test") as {
      id: number;
    };
    // Waitlist email carries different casing to prove the match is case-insensitive.
    const waitlistId = seedAcceptedWaitlist("Orphan@weddly.test", "Orphan Planner");

    // Before: surfaces as pending (the couple account doesn't clear it).
    const before = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(
      before.data.planners.some(
        (p) => p.state === "pending" && p.email.toLowerCase() === "orphan@weddly.test",
      ),
    ).toBe(true);

    const res = await req<{ ok: true; granted: boolean; has_account: boolean }>(
      "POST",
      `/api/admin/planners/pending/${waitlistId}/send-invite`,
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.granted).toBe(true);
    expect(res.data.has_account).toBe(true);

    // Existing account is now a planner, couple_id preserved (non-destructive).
    const row = db.prepare("SELECT user_type, couple_id FROM users WHERE id = ?").get(user.id) as {
      user_type: string;
      couple_id: number | null;
    };
    expect(row.user_type).toBe("planner");
    expect(row.couple_id).toBe(coupleId);

    // initPlannerBilling ran on the existing account.
    const sub = db
      .prepare("SELECT user_id FROM planner_subscriptions WHERE user_id = ?")
      .get(user.id);
    expect(sub).toBeDefined();

    // The sign-in email went to the account holder.
    const mail = db
      .prepare("SELECT kind FROM email_log WHERE kind = 'planner_access_invite' AND to_email = ?")
      .all("orphan@weddly.test") as { kind: string }[];
    expect(mail.length).toBe(1);

    // After: no longer pending; now an active account.
    const after = await req<{ planners: AdminPlannerView[] }>(
      "GET",
      "/api/admin/planners",
      undefined,
      { token: adminToken },
    );
    expect(
      after.data.planners.some(
        (p) => p.state === "pending" && p.email.toLowerCase() === "orphan@weddly.test",
      ),
    ).toBe(false);
    expect(after.data.planners.some((p) => p.state === "active" && p.user_id === user.id)).toBe(
      true,
    );
  });

  test("send-invite 404s for an unknown waitlist id", async () => {
    const adminToken = await bootstrapAdmin();
    const res = await req(
      "POST",
      "/api/admin/planners/pending/999999/send-invite",
      {},
      { token: adminToken },
    );
    expect(res.status).toBe(404);
  });

  test("send-invite rejects a non-admin", async () => {
    await bootstrapAdmin();
    const { token } = await bootstrapCouple("notadmin-invite@weddly.test");
    const waitlistId = seedAcceptedWaitlist("x-invite@weddly.test");
    const res = await req(
      "POST",
      `/api/admin/planners/pending/${waitlistId}/send-invite`,
      {},
      { token },
    );
    expect(res.status).toBe(403);
  });
});
