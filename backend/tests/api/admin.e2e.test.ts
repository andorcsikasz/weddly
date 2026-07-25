import "../setup";

import { describe, expect, test } from "bun:test";
import type {
  AdminActivityAnalytics,
  AdminGuestAnalytics,
  AdminHoneymoonAnalytics,
  AdminWeddingAnalytics,
} from "@shared/admin_analytics";
import { req, wipeAll, registerAndVerify, bootstrapCouple } from "../helpers";
import { db, now } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { autoInviteDueAt, runEmailSweep } from "../../src/domain/emails/worker";
import { purgeOneUser, runPurgeSweep } from "../../src/domain/purge";

const HOUR = 1000 * 60 * 60;

// ────────────────────────────────────────────────────────────────────────────
// Helpers — admin bootstrap + a few light shapes used across tests.
// ────────────────────────────────────────────────────────────────────────────

/** Register the ADMIN_EMAILS allowlist email, verify it, return the bearer.
 *  setup.ts sets ADMIN_EMAILS=admin@test.test, so this address is the one and
 *  only test admin. Wipes the DB up front so every caller starts clean. */
async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

/** Variant that doesn't wipe — for tests that already wiped + bootstrapped
 *  a regular user and now need an admin alongside without resetting state. */
async function addAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

/** Insert a real but UNVERIFIED users row and return its id.
 *
 *  Register can't produce one anymore: it parks the signup in `pending_signups`
 *  and the users row is only minted, already verified, when the link is clicked.
 *  The unverified-account state still exists for legacy rows (vendor register,
 *  a resend that was never followed), which is what the admin resend-verify
 *  surface acts on, so build it directly. */
function insertUnverifiedUser(email: string, fullName: string): number {
  const ts = now();
  const row = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, password_set, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 0, 1, ?, ?) RETURNING id`,
    )
    .get(email, "argon2-placeholder", fullName, ts, ts) as { id: number };
  return row.id;
}

interface SubmitVendorTipResult {
  supplier: { id: string };
}

/** Insert one community-supplier row in `awaiting_review` and return its
 *  numeric id (the public DTO uses `c${id}` strings). Used by every admin
 *  supplier moderation test below. */
async function insertSupplierAwaitingReview(token: string): Promise<number> {
  const r = await req<SubmitVendorTipResult>(
    "POST",
    "/api/suppliers/community",
    {
      category: "venue",
      submitter_type: "user",
      name: "Crystal Hall",
      city: "Budapest",
      address: "Andrássy út 1.",
      website: "https://crystal-hall.test",
      contact_email: "hello@crystal-hall.test",
      blurb: "Stunning historic ballroom in the heart of the city.",
      price_band: 3,
    },
    { token },
  );
  expect(r.status).toBe(201);
  const numericId = Number(r.data.supplier.id.slice(1));
  createVerificationToken(numericId);
  const tokenRow = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as { token: string };
  const verify = await req("POST", `/api/suppliers/community/verify/${tokenRow.token}`);
  expect(verify.status).toBe(200);
  return numericId;
}

// ────────────────────────────────────────────────────────────────────────────
// Category 1 — Admin gates (403 for non-admin, 401 for anon) on every route.
// ────────────────────────────────────────────────────────────────────────────

describe("admin gate — 403 for verified non-admin token on every /api/admin/* route", () => {
  // Inventory of every admin route exposed by the six modules under test.
  // Bundled into one test so the gate suite costs one wipe + one bootstrap
  // (instead of ~30) — keeps the SQLite WAL volume low on macOS test runs
  // where rapid wipes trigger SQLITE_IOERR_VNODE under load.
  const routes: Array<{
    method: string;
    path: string;
    body?: unknown;
  }> = [
    // admin_users.ts
    { method: "GET", path: "/api/admin/users" },
    { method: "GET", path: "/api/admin/couples" },
    { method: "GET", path: "/api/admin/sidebar-badges" },
    { method: "POST", path: "/api/admin/sidebar-badges/seen", body: { section: "users" } },
    { method: "POST", path: "/api/admin/users/1/resend-verify", body: {} },
    { method: "DELETE", path: "/api/admin/users/1" },
    {
      method: "POST",
      path: "/api/admin/users/1/flag",
      body: { reason: "spam tipper" },
    },
    { method: "POST", path: "/api/admin/users/1/unflag", body: {} },
    { method: "POST", path: "/api/admin/users/1/beta", body: { beta: true } },
    { method: "POST", path: "/api/admin/couples/1/remind-invite-partner", body: {} },
    // admin_suppliers.ts
    { method: "GET", path: "/api/admin/suppliers" },
    { method: "GET", path: "/api/admin/suppliers/directory" },
    { method: "GET", path: "/api/admin/suppliers/1/reports" },
    { method: "POST", path: "/api/admin/suppliers/1/approve", body: {} },
    { method: "POST", path: "/api/admin/suppliers/1/enrich", body: {} },
    { method: "POST", path: "/api/admin/suppliers/1/hide", body: {} },
    { method: "POST", path: "/api/admin/suppliers/1/unhide", body: {} },
    { method: "POST", path: "/api/admin/suppliers/1/reports/dismiss", body: {} },
    { method: "PATCH", path: "/api/admin/suppliers/1/notes", body: { notes: "" } },
    { method: "DELETE", path: "/api/admin/suppliers/1" },
    // admin_analytics.ts
    { method: "GET", path: "/api/admin/analytics/money" },
    { method: "GET", path: "/api/admin/analytics/activity" },
    { method: "GET", path: "/api/admin/analytics/picks" },
    { method: "GET", path: "/api/admin/analytics/growth-funnel" },
    { method: "GET", path: "/api/admin/analytics/weddings" },
    { method: "GET", path: "/api/admin/analytics/honeymoon" },
    { method: "GET", path: "/api/admin/analytics/guests" },
    // vendor_waitlist.ts (admin half)
    { method: "GET", path: "/api/admin/vendor-waitlist" },
    {
      method: "POST",
      path: "/api/admin/vendor-waitlist/1/decide",
      body: { outcome: "accepted", subject: "x", body: "y", notes: "" },
    },
    { method: "POST", path: "/api/admin/vendor-waitlist/1/reopen", body: {} },
    // feedback.ts (admin half)
    { method: "GET", path: "/api/admin/feedback" },
    {
      method: "PATCH",
      path: "/api/admin/feedback/1/status",
      body: { status: "read" },
    },
    { method: "DELETE", path: "/api/admin/feedback/1" },
    // supplier_taxonomy.ts (admin half)
    {
      method: "POST",
      path: "/api/admin/supplier-groups",
      body: { slug: "x_test", label_hu: "X", label_en: "X" },
    },
    {
      method: "PATCH",
      path: "/api/admin/supplier-groups/1",
      body: { label_hu: "X" },
    },
    { method: "DELETE", path: "/api/admin/supplier-groups/1" },
    {
      method: "POST",
      path: "/api/admin/supplier-categories",
      body: { group_id: 1, slug: "y_test", label_hu: "Y", label_en: "Y" },
    },
    {
      method: "PATCH",
      path: "/api/admin/supplier-categories/1",
      body: { label_hu: "Y" },
    },
    { method: "DELETE", path: "/api/admin/supplier-categories/1" },
  ];

  test("every listed admin route returns 403 with a non-admin verified token", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("notadmin@weddly.test");
    for (const r of routes) {
      const res = await req(r.method, r.path, r.body, { token });
      // Annotate the failure with the exact route so a regression points
      // at the handler that lost its requireAdmin() call.
      if (res.status !== 403) {
        throw new Error(
          `${r.method} ${r.path} expected 403, got ${res.status} (body=${JSON.stringify(
            res.data,
          )})`,
        );
      }
      expect(res.status).toBe(403);
    }
  });
});

describe("admin gate — 401 with no token on every /api/admin/* route", () => {
  const routes: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/admin/users" },
    { method: "GET", path: "/api/admin/couples" },
    { method: "GET", path: "/api/admin/sidebar-badges" },
    { method: "GET", path: "/api/admin/suppliers" },
    { method: "GET", path: "/api/admin/analytics/money" },
    { method: "GET", path: "/api/admin/analytics/activity" },
    { method: "GET", path: "/api/admin/analytics/picks" },
    { method: "GET", path: "/api/admin/analytics/growth-funnel" },
    { method: "GET", path: "/api/admin/analytics/weddings" },
    { method: "GET", path: "/api/admin/analytics/honeymoon" },
    { method: "GET", path: "/api/admin/analytics/guests" },
    { method: "GET", path: "/api/admin/vendor-waitlist" },
    { method: "GET", path: "/api/admin/feedback" },
    {
      method: "POST",
      path: "/api/admin/supplier-groups",
      body: { slug: "z_test", label_hu: "Z", label_en: "Z" },
    },
  ];
  test("every listed admin route returns 401 with no Authorization header", async () => {
    wipeAll();
    for (const r of routes) {
      const res = await req(r.method, r.path, r.body);
      if (res.status !== 401) {
        throw new Error(
          `${r.method} ${r.path} expected 401, got ${res.status} (body=${JSON.stringify(
            res.data,
          )})`,
        );
      }
      expect(res.status).toBe(401);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 2 — Admin users module (list, badges, resend-verify, flag/unflag,
//                                    delete, auto-finalised deleting tombstones).
// ────────────────────────────────────────────────────────────────────────────

interface AdminUserRow {
  id: number;
  email: string;
  is_admin: boolean;
  verified_email: boolean;
  couple_id: number | null;
  account_type: "couple" | "vendor" | "planner";
  is_demo: boolean;
  last_seen_at: number | null;
  active_flag: { id: number; reason: string } | null;
  activity: {
    supplier_tip_count: number;
    supplier_tip_last_at: number | null;
    feedback_count: number;
    feedback_last_at: number | null;
    prior_flag_count: number;
  };
}

interface UsersListResp {
  users: AdminUserRow[];
}

describe("admin users — list, engagement, badges", () => {
  test("list returns engagement metrics + correctly flags admin row", async () => {
    const adminToken = await bootstrapAdmin();
    // Add a regular user so the list has more than one row.
    await bootstrapCouple("partner@weddly.test");
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(list.status).toBe(200);
    expect(list.data.users.length).toBe(2);
    const adminRow = list.data.users.find((u) => u.email === "admin@test.test");
    expect(adminRow).toBeDefined();
    expect(adminRow?.is_admin).toBe(true);
    expect(adminRow?.verified_email).toBe(true);
    // Engagement shape present even when zero.
    expect(adminRow?.activity.supplier_tip_count).toBe(0);
    expect(adminRow?.activity.feedback_count).toBe(0);
    expect(adminRow?.activity.prior_flag_count).toBe(0);
    expect(adminRow?.active_flag).toBeNull();
    // Both rows should have last_seen_at stamped (admin from verify, partner
    // from the post-onboard token verify) — but the partner-side throttle may
    // skip; tolerate either by asserting the column is at least numeric-or-null.
    for (const u of list.data.users) {
      if (u.last_seen_at !== null) expect(typeof u.last_seen_at).toBe("number");
    }
  });

  test("list ordering: newest user first by created_at DESC", async () => {
    const adminToken = await bootstrapAdmin();
    // Add two more users so we have three; the most recently registered
    // should land at index 0.
    await bootstrapCouple("first@weddly.test");
    await bootstrapCouple("second@weddly.test");
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(list.data.users[0]?.email).toBe("second@weddly.test");
  });

  test("real vendors + planners are excluded from the couples user list (they have their own FIÓKOK pages)", async () => {
    const adminToken = await bootstrapAdmin();
    // Three plain accounts, then flip two of them at the DB layer to mirror how
    // a real vendor signup (role='vendor') and planner provisioning
    // (user_type='planner') leave the row — both legitimately have no `couples`
    // workspace. A real vendor lives on FIÓKOK → Szolgáltatók, a real planner on
    // FIÓKOK → Szervezők, so NEITHER may also surface in this couples-oriented
    // Felhasználók list (that's the "why is this szolgáltató in Felhasználók?" bug).
    const couple = await bootstrapCouple("stuck-couple@weddly.test");
    const vendor = await bootstrapCouple("shop@weddly.test");
    const planner = await bootstrapCouple("wedplanner@weddly.test");
    // Null out couple_id so all three would otherwise land in the "no workspace"
    // bucket, then stamp the class-defining columns.
    db.prepare("UPDATE users SET couple_id = NULL WHERE email = ?").run("stuck-couple@weddly.test");
    db.prepare("UPDATE users SET couple_id = NULL, role = 'vendor' WHERE email = ?").run(
      "shop@weddly.test",
    );
    db.prepare("UPDATE users SET couple_id = NULL, user_type = 'planner' WHERE email = ?").run(
      "wedplanner@weddly.test",
    );
    void couple;
    void vendor;
    void planner;

    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const byEmail = (e: string) => list.data.users.find((u) => u.email === e);

    // The abandoned-onboarding couple stays — it's a real couple-track user with
    // no dedicated page of its own.
    const stuck = byEmail("stuck-couple@weddly.test");
    expect(stuck?.couple_id).toBeNull();
    expect(stuck?.account_type).toBe("couple");

    // The real vendor + real planner are gone from this list.
    expect(byEmail("shop@weddly.test")).toBeUndefined();
    expect(byEmail("wedplanner@weddly.test")).toBeUndefined();

    // Sanity: a default account (no vendor role / planner type) is a couple and stays.
    const adminRow = byEmail("admin@test.test");
    expect(adminRow?.account_type).toBe("couple");
  });

  test("supplier_tip_count rolls into the activity record", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("tipper@weddly.test");
    await insertSupplierAwaitingReview(token);
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const tipper = list.data.users.find((u) => u.email === "tipper@weddly.test");
    expect(tipper?.activity.supplier_tip_count).toBe(1);
    expect(typeof tipper?.activity.supplier_tip_last_at).toBe("number");
  });

  test("sidebar badges reflect awaiting_review + new flags + new feedback", async () => {
    const adminToken = await bootstrapAdmin();
    // Watermark all sections to NOW so the existing admin row doesn't count.
    for (const section of ["suppliers", "users", "vendor_waitlist", "feedback"]) {
      await req("POST", "/api/admin/sidebar-badges/seen", { section }, { token: adminToken });
    }
    // Now create new rows in every category.
    const { token } = await bootstrapCouple("badger@weddly.test");
    await insertSupplierAwaitingReview(token);
    await req("POST", "/api/feedback", { message: "Nice product." });
    await req("POST", "/api/vendors/waitlist", {
      business_name: "Cake Co",
      email: "cake@example.com",
      category: "cake_dessert",
    });
    const badges = await req<{
      suppliers: number;
      users: number;
      vendor_waitlist: number;
      feedback: number;
    }>("GET", "/api/admin/sidebar-badges", undefined, { token: adminToken });
    expect(badges.status).toBe(200);
    expect(badges.data.suppliers).toBe(1);
    expect(badges.data.vendor_waitlist).toBe(1);
    expect(badges.data.feedback).toBe(1);
    // users badge includes the new signup itself.
    expect(badges.data.users).toBeGreaterThanOrEqual(1);
  });

  test("sidebar users badge ignores freshly generated demo accounts", async () => {
    const adminToken = await bootstrapAdmin();
    // Watermark the users section so existing rows don't count.
    await req(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section: "users" },
      { token: adminToken },
    );
    const before = await req<{ users: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    // Spin up a demo workspace — this creates a throwaway user attached to an
    // is_demo couple, which must NOT light up the users badge.
    const demo = await req("POST", "/api/demo/start", {});
    expect(demo.status).toBe(201);
    const after = await req<{ users: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    expect(after.data.users).toBe(before.data.users);
  });

  test("sidebar users badge ignores freshly generated demo vendor + planner accounts", async () => {
    const adminToken = await bootstrapAdmin();
    await req(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section: "users" },
      { token: adminToken },
    );
    const before = await req<{ users: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    // Demo vendor + demo planner are workspace-less throwaway accounts
    // (demo-…@demo.weddly.local). Neither may light up the users badge — the
    // couple-join is_demo test misses them, so the email-suffix guard must.
    expect((await req("POST", "/api/demo/vendor/start", {})).status).toBe(201);
    expect((await req("POST", "/api/demo/planner/start", {})).status).toBe(201);
    const after = await req<{ users: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    expect(after.data.users).toBe(before.data.users);
  });

  test("admin users list flags demo accounts via is_demo (vendor, planner, couple)", async () => {
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("real-signup@weddly.test");
    await req("POST", "/api/demo/vendor/start", {});
    await req("POST", "/api/demo/planner/start", {});
    await req("POST", "/api/demo/start", {});

    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const demoUsers = list.data.users.filter((u) => u.email.endsWith("@demo.weddly.local"));
    // Three demo kinds → at least three demo users, every one flagged is_demo.
    expect(demoUsers.length).toBeGreaterThanOrEqual(3);
    for (const u of demoUsers) expect(u.is_demo).toBe(true);
    // The demo vendor + demo planner are workspace-less, so account_type tells
    // the two apart in the list.
    expect(demoUsers.some((u) => u.account_type === "vendor" && u.couple_id === null)).toBe(true);
    expect(demoUsers.some((u) => u.account_type === "planner" && u.couple_id === null)).toBe(true);

    // Real signups (and the admin) are never flagged demo.
    const real = list.data.users.find((u) => u.email === "real-signup@weddly.test");
    expect(real?.is_demo).toBe(false);
    expect(list.data.users.find((u) => u.email === "admin@test.test")?.is_demo).toBe(false);
  });

  test("sidebar mark-seen clears the section it touches", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/feedback", { message: "Hello world." });
    const before = await req<{ feedback: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    expect(before.data.feedback).toBeGreaterThanOrEqual(1);
    const mark = await req<{ section: string; seen_at: number }>(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section: "feedback" },
      { token: adminToken },
    );
    expect(mark.status).toBe(200);
    expect(mark.data.section).toBe("feedback");
    expect(typeof mark.data.seen_at).toBe("number");
    const after = await req<{ feedback: number }>("GET", "/api/admin/sidebar-badges", undefined, {
      token: adminToken,
    });
    expect(after.data.feedback).toBe(0);
  });

  test("sidebar mark-seen rejects unknown section", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/sidebar-badges/seen",
      { section: "nope" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });
});

describe("admin users — resend-verify, delete, flag/unflag", () => {
  test("resend-verify on unverified user writes an email_log row + audit log", async () => {
    const adminToken = await bootstrapAdmin();
    // Register no longer mints a users row (it parks a pending signup until the
    // link is clicked), so the only unverified account left is the legacy kind:
    // a real row whose verify flag was never flipped. Insert one directly.
    const targetId = insertUnverifiedUser("unverif@weddly.test", "Unverified");

    const r = await req<{ ok: boolean; already_verified?: boolean }>(
      "POST",
      `/api/admin/users/${targetId}/resend-verify`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(r.data.already_verified).toBeUndefined();

    // An email_log row landed (status is "skipped_no_provider" because
    // RESEND_API_KEY is empty in the test harness — what matters is the
    // attempt was recorded).
    const log = db
      .prepare(
        "SELECT kind, to_email, status FROM email_log WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(targetId) as { kind: string; to_email: string; status: string } | undefined;
    expect(log).toBeDefined();
    expect(log?.kind).toBe("verify_resend");
    expect(log?.to_email).toBe("unverif@weddly.test");

    // Audit log entry recorded.
    const audit = db
      .prepare(
        "SELECT action, target_id FROM audit_log WHERE action = 'admin.user_resend_verify' AND target_id = ?",
      )
      .get(targetId) as { action: string; target_id: number } | undefined;
    expect(audit).toBeDefined();
  });

  test("resend-verify on already-verified user returns already_verified=true", async () => {
    const adminToken = await bootstrapAdmin();
    const { token: _t } = await bootstrapCouple("verified@weddly.test");
    void _t;
    const target = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("verified@weddly.test") as { id: number };
    const r = await req<{ ok: boolean; already_verified?: boolean }>(
      "POST",
      `/api/admin/users/${target.id}/resend-verify`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.already_verified).toBe(true);
  });

  test("resend-verify on unknown user id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/admin/users/99999/resend-verify", {}, { token: adminToken });
    expect(r.status).toBe(404);
  });

  test("resend-verify with bad id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/users/notanumber/resend-verify",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("delete user — admin cannot delete themselves", async () => {
    const adminToken = await bootstrapAdmin();
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, {
      token: adminToken,
    });
    const r = await req("DELETE", `/api/admin/users/${me.data.user.id}`, undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(400);
  });

  test("delete user — orphan user is removed from the list", async () => {
    const adminToken = await bootstrapAdmin();
    const orphan = await registerAndVerify({
      email: "orphan@weddly.test",
      password: "supersafe123",
      full_name: "Orphan",
    });
    const r = await req("DELETE", `/api/admin/users/${orphan.data.user.id}`, undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(200);
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(list.data.users.find((u) => u.email === "orphan@weddly.test")).toBeUndefined();
  });

  test("delete user — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("DELETE", "/api/admin/users/99999", undefined, { token: adminToken });
    expect(r.status).toBe(404);
  });

  test("flag user — writes a user_flags row + emits an audit entry", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "naughty@weddly.test",
      password: "supersafe123",
      full_name: "Naughty",
    });
    const r = await req<{
      user: AdminUserRow | null;
      flag: { id: number; user_id: number; reason: string };
    }>(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "Submitting spam suppliers." },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.flag.user_id).toBe(reg.data.user.id);
    expect(r.data.user?.active_flag?.id).toBe(r.data.flag.id);
    const row = db
      .prepare("SELECT id, reason FROM user_flags WHERE user_id = ?")
      .get(reg.data.user.id) as { id: number; reason: string } | undefined;
    expect(row?.reason).toBe("Submitting spam suppliers.");
  });

  test("flag user — reason validation: missing", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "n2@weddly.test",
      password: "supersafe123",
      full_name: "N2",
    });
    const r = await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("flag user — reason validation: too short", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "n3@weddly.test",
      password: "supersafe123",
      full_name: "N3",
    });
    const r = await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "ab" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("flag user — can't flag self", async () => {
    const adminToken = await bootstrapAdmin();
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, {
      token: adminToken,
    });
    const r = await req(
      "POST",
      `/api/admin/users/${me.data.user.id}/flag`,
      { reason: "self flag" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("flag user — stacking refused with 409", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "stacky@weddly.test",
      password: "supersafe123",
      full_name: "Stacky",
    });
    const first = await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "first flag" },
      { token: adminToken },
    );
    expect(first.status).toBe(200);
    const second = await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "another reason" },
      { token: adminToken },
    );
    expect(second.status).toBe(409);
  });

  test("flag user — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/users/99999/flag",
      { reason: "ghost" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("unflag user — clears the active flag and returns cleared=true", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "clearme@weddly.test",
      password: "supersafe123",
      full_name: "Clear",
    });
    await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "first flag" },
      { token: adminToken },
    );
    const r = await req<{ cleared: boolean; user: AdminUserRow | null }>(
      "POST",
      `/api/admin/users/${reg.data.user.id}/unflag`,
      { note: "user explained themselves" },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.cleared).toBe(true);
    expect(r.data.user?.active_flag).toBeNull();
    // Re-flag is allowed now that the active flag was cleared.
    const refl = await req(
      "POST",
      `/api/admin/users/${reg.data.user.id}/flag`,
      { reason: "they did it again" },
      { token: adminToken },
    );
    expect(refl.status).toBe(200);
    // prior_flag_count picks up the resolved flag.
    const list = await req<UsersListResp>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    const row = list.data.users.find((u) => u.email === "clearme@weddly.test");
    expect(row?.activity.prior_flag_count).toBe(1);
  });

  test("unflag user — idempotent: returns cleared=false when nothing to clear", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "noflag@weddly.test",
      password: "supersafe123",
      full_name: "NoFlag",
    });
    const r = await req<{ cleared: boolean }>(
      "POST",
      `/api/admin/users/${reg.data.user.id}/unflag`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.cleared).toBe(false);
  });

  test("deleting tombstones are finalised automatically by the purge sweep, not a button", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("victim@weddly.test");
    const owner = db.prepare("SELECT id FROM users WHERE email = 'victim@weddly.test'").get() as {
      id: number;
    };
    // Admin deletes the owner → couple flips to status='deleting' and the
    // current purge stamps purged_at, so it's already fully finalised.
    await req("DELETE", `/api/admin/users/${owner.id}`, undefined, { token: adminToken });
    const before = db
      .prepare("SELECT status, purged_at FROM couples WHERE id = ?")
      .get(coupleId) as { status: string; purged_at: number | null };
    expect(before.status).toBe("deleting");
    expect(before.purged_at).not.toBeNull();

    // Simulate a LEGACY tombstone: a row scrubbed by an older purge pass that
    // predates the purged_at column. The hourly sweep must finalise it once.
    db.prepare("UPDATE couples SET purged_at = NULL WHERE id = ?").run(coupleId);
    const first = runPurgeSweep();
    expect(first.residue_finalised).toBe(1);

    // It's now stamped, so a second sweep is a no-op — bounded, never re-hammered.
    const stamped = db.prepare("SELECT purged_at FROM couples WHERE id = ?").get(coupleId) as {
      purged_at: number | null;
    };
    expect(stamped.purged_at).not.toBeNull();
    expect(runPurgeSweep().residue_finalised).toBe(0);
  });
});

describe("admin users — beta-tester marker", () => {
  interface BetaResp {
    user: (AdminUserRow & { is_beta_tester: boolean }) | null;
  }
  interface CouplesListResp {
    couples: { id: number; is_demo: boolean; is_beta_tester: boolean }[];
  }

  test("mark + unmark flips the user flag and is audit-logged", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("tester@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    const userId = me.data.user.id;

    const set = await req<BetaResp>(
      "POST",
      `/api/admin/users/${userId}/beta`,
      { beta: true },
      { token: adminToken },
    );
    expect(set.status).toBe(200);
    expect(set.data.user?.is_beta_tester).toBe(true);
    expect(
      (
        db.prepare("SELECT is_beta_tester FROM users WHERE id = ?").get(userId) as {
          is_beta_tester: number;
        }
      ).is_beta_tester,
    ).toBe(1);
    const audit = db
      .prepare(
        "SELECT action FROM audit_log WHERE action = 'admin.user_beta_set' AND target_id = ?",
      )
      .get(userId) as { action: string } | undefined;
    expect(audit?.action).toBe("admin.user_beta_set");

    const unset = await req<BetaResp>(
      "POST",
      `/api/admin/users/${userId}/beta`,
      { beta: false },
      { token: adminToken },
    );
    expect(unset.status).toBe(200);
    expect(unset.data.user?.is_beta_tester).toBe(false);
  });

  test("marking beta grants the founding gift; unmarking revokes it", async () => {
    const adminToken = await bootstrapAdmin();
    const { token, coupleId } = await bootstrapCouple("betagift@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    const userId = me.data.user.id;

    const readBilling = () =>
      db
        .prepare("SELECT subscription_status, is_founding_member FROM couples WHERE id = ?")
        .get(coupleId) as { subscription_status: string; is_founding_member: number };

    // Mark as beta → workspace receives the free-access founding gift.
    const set = await req(
      "POST",
      `/api/admin/users/${userId}/beta`,
      { beta: true },
      { token: adminToken },
    );
    expect(set.status).toBe(200);
    const granted = readBilling();
    expect(granted.subscription_status).toBe("founding");
    expect(Boolean(granted.is_founding_member)).toBe(false);

    // Audit log records the billing effect.
    const grantAudit = db
      .prepare(
        "SELECT after_json FROM audit_log WHERE action = 'admin.user_beta_set' AND target_id = ? ORDER BY id DESC",
      )
      .get(userId) as { after_json: string } | undefined;
    expect(grantAudit?.after_json).toContain('"billing_gift":"granted"');

    // Unmark → comped gift is revoked, plan back to none.
    const unset = await req(
      "POST",
      `/api/admin/users/${userId}/beta`,
      { beta: false },
      { token: adminToken },
    );
    expect(unset.status).toBe(200);
    const revoked = readBilling();
    expect(revoked.subscription_status).toBe("none");
  });

  test("marking beta does NOT downgrade an active paying couple", async () => {
    const adminToken = await bootstrapAdmin();
    const { token, coupleId } = await bootstrapCouple("betaactive@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    const userId = me.data.user.id;

    db.prepare("UPDATE couples SET subscription_status = 'active' WHERE id = ?").run(coupleId);

    const set = await req(
      "POST",
      `/api/admin/users/${userId}/beta`,
      { beta: true },
      { token: adminToken },
    );
    expect(set.status).toBe(200);
    const row = db
      .prepare("SELECT subscription_status FROM couples WHERE id = ?")
      .get(coupleId) as { subscription_status: string };
    expect(row.subscription_status).toBe("active");
  });

  test("workspace inherits beta status from a tagged member", async () => {
    const adminToken = await bootstrapAdmin();
    const { token, coupleId } = await bootstrapCouple("betacouple@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });

    await req(
      "POST",
      `/api/admin/users/${me.data.user.id}/beta`,
      { beta: true },
      {
        token: adminToken,
      },
    );

    const couples = await req<CouplesListResp>("GET", "/api/admin/couples", undefined, {
      token: adminToken,
    });
    const row = couples.data.couples.find((c) => c.id === coupleId);
    expect(row?.is_beta_tester).toBe(true);
  });

  test("non-boolean `beta` body → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("t2@weddly.test");
    const me = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, { token });
    const r = await req(
      "POST",
      `/api/admin/users/${me.data.user.id}/beta`,
      { beta: "yes" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("unknown user id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/users/99999/beta",
      { beta: true },
      {
        token: adminToken,
      },
    );
    expect(r.status).toBe(404);
  });
});

// Regression: a multi-workspace owner used to make their OTHER couples render
// memberless / email-less in the admin list, because membership was read from
// `users.couple_id` (the active-workspace pointer) instead of `couple_members`.
describe("admin couples — multi-workspace member resolution", () => {
  interface CouplesWithPartners {
    couples: {
      id: number;
      partners: { id: number; full_name: string; email: string }[];
      last_seen_at: number | null;
    }[];
  }

  test("the owner's non-active workspace still shows their email", async () => {
    const adminToken = await bootstrapAdmin();
    // Couple A is the owner's first (active) workspace.
    const { token, coupleId: coupleA } = await bootstrapCouple("multiws-owner@weddly.test");

    // Creating a second workspace auto-switches users.couple_id to couple B,
    // leaving A with no user whose active pointer references it.
    const second = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples",
      { event_name: "Polgári szertartás" },
      { token },
    );
    expect(second.status).toBe(201);
    const coupleB = second.data.couple.id;
    expect(coupleB).not.toBe(coupleA);

    const list = await req<CouplesWithPartners>("GET", "/api/admin/couples", undefined, {
      token: adminToken,
    });
    const rowA = list.data.couples.find((c) => c.id === coupleA);
    const rowB = list.data.couples.find((c) => c.id === coupleB);

    // BOTH workspaces resolve the owner through couple_members — neither is
    // memberless, and both surface the real email.
    expect(rowA?.partners.map((p) => p.email)).toContain("multiws-owner@weddly.test");
    expect(rowB?.partners.map((p) => p.email)).toContain("multiws-owner@weddly.test");
  });
});

describe("admin couples — remind-invite-partner nudge", () => {
  test("solo couple → email_log row + audit log + 200", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("solo@weddly.test");
    const target = db.prepare("SELECT id FROM users WHERE email = ?").get("solo@weddly.test") as {
      id: number;
    };

    const r = await req<{ ok: boolean }>(
      "POST",
      `/api/admin/couples/${coupleId}/remind-invite-partner`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);

    const log = db
      .prepare("SELECT kind, to_email FROM email_log WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(target.id) as { kind: string; to_email: string } | undefined;
    expect(log).toBeDefined();
    expect(log?.kind).toBe("partner_invite_reminder");
    expect(log?.to_email).toBe("solo@weddly.test");

    const audit = db
      .prepare(
        "SELECT action, target_id FROM audit_log WHERE action = 'admin.remind_invite_partner' AND target_id = ?",
      )
      .get(target.id) as { action: string; target_id: number } | undefined;
    expect(audit).toBeDefined();
  });

  test("unknown couple id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/couples/99999/remind-invite-partner",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("second send for the same couple → 409 already_reminded", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("once@weddly.test");
    const first = await req(
      "POST",
      `/api/admin/couples/${coupleId}/remind-invite-partner`,
      {},
      { token: adminToken },
    );
    expect(first.status).toBe(200);
    const second = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/admin/couples/${coupleId}/remind-invite-partner`,
      {},
      { token: adminToken },
    );
    expect(second.status).toBe(409);
    expect(second.data.detail?.code).toBe("already_reminded");

    const row = db
      .prepare("SELECT invite_partner_reminded_at AS t FROM couples WHERE id = ?")
      .get(coupleId) as { t: number | null };
    expect(typeof row.t).toBe("number");
  });

  test("couple with two partners → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("owner@weddly.test");
    // Forge a partner_b by attaching a second registered user to the row.
    const partnerB = await registerAndVerify({
      email: "partner@weddly.test",
      password: "supersafe123",
      full_name: "Partner",
    });
    db.prepare("UPDATE couples SET partner_b_id = ? WHERE id = ?").run(
      partnerB.data.user.id,
      coupleId,
    );
    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(coupleId, partnerB.data.user.id);
    const r = await req(
      "POST",
      `/api/admin/couples/${coupleId}/remind-invite-partner`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("bad id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/couples/notanumber/remind-invite-partner",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });
});

/** A verified solo couple (one member, partner_b_id NULL). Returns the
 *  workspace + owner ids the auto-nudge sweep keys on. */
async function bootstrapSoloCouple(
  email: string,
): Promise<{ coupleId: number; userId: number; token: string }> {
  const { token, coupleId } = await bootstrapCouple(email);
  const owner = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
  return { coupleId, userId: owner.id, token };
}

describe("auto invite-partner nudge (worker sweep)", () => {
  test("next-10:00-UTC rule: rounds the 48h mark up to 10:00 UTC", () => {
    // Mark falls before 10:00 → due same day at 10:00.
    const beforeTen = Date.UTC(2026, 0, 3, 9, 0) - 48 * HOUR;
    expect(autoInviteDueAt(beforeTen)).toBe(Date.UTC(2026, 0, 3, 10, 0));
    // Mark falls exactly at 10:00 → due that instant.
    const atTen = Date.UTC(2026, 0, 3, 10, 0) - 48 * HOUR;
    expect(autoInviteDueAt(atTen)).toBe(Date.UTC(2026, 0, 3, 10, 0));
    // Mark falls after 10:00 → due next day at 10:00.
    const afterTen = Date.UTC(2026, 0, 3, 11, 0) - 48 * HOUR;
    expect(autoInviteDueAt(afterTen)).toBe(Date.UTC(2026, 0, 4, 10, 0));
  });

  test("solo workspace past the 48h + 10:00 boundary → auto-sent + stamp set", async () => {
    wipeAll();
    const reg = await bootstrapSoloCouple("auto-solo@weddly.test");
    // Created 96h ago: the next-10:00 boundary is comfortably in the past.
    db.prepare("UPDATE couples SET created_at = ? WHERE id = ?").run(
      now() - 96 * HOUR,
      reg.coupleId,
    );

    const sweep = runEmailSweep();
    expect(sweep.invitePartnerAuto).toBe(1);

    const log = db
      .prepare("SELECT kind FROM email_log WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(reg.userId) as { kind: string } | undefined;
    expect(log?.kind).toBe("partner_invite_reminder");

    const stamp = db
      .prepare("SELECT invite_partner_reminded_at AS t FROM couples WHERE id = ?")
      .get(reg.coupleId) as { t: number | null };
    expect(typeof stamp.t).toBe("number");
  });

  test("fires once per workspace (idempotent across sweeps)", async () => {
    wipeAll();
    const reg = await bootstrapSoloCouple("auto-once@weddly.test");
    db.prepare("UPDATE couples SET created_at = ? WHERE id = ?").run(
      now() - 96 * HOUR,
      reg.coupleId,
    );

    expect(runEmailSweep().invitePartnerAuto).toBe(1);
    expect(runEmailSweep().invitePartnerAuto).toBe(0);

    const logs = db
      .prepare("SELECT id FROM email_log WHERE user_id = ? AND kind = 'partner_invite_reminder'")
      .all(reg.userId) as { id: number }[];
    expect(logs.length).toBe(1);
  });

  test("younger than 48h → not sent, stamp stays null", async () => {
    wipeAll();
    const reg = await bootstrapSoloCouple("auto-young@weddly.test");
    // 47h old: the 48h mark is still 1h in the future, so it is never due.
    db.prepare("UPDATE couples SET created_at = ? WHERE id = ?").run(
      now() - 47 * HOUR,
      reg.coupleId,
    );

    expect(runEmailSweep().invitePartnerAuto).toBe(0);
    const stamp = db
      .prepare("SELECT invite_partner_reminded_at AS t FROM couples WHERE id = ?")
      .get(reg.coupleId) as { t: number | null };
    expect(stamp.t).toBeNull();
  });

  test("workspace with two partners → skipped", async () => {
    wipeAll();
    const reg = await bootstrapSoloCouple("auto-pair@weddly.test");
    const partnerB = await registerAndVerify({
      email: "auto-pair-b@weddly.test",
      password: "supersafe123",
      full_name: "Partner B",
    });
    db.prepare("UPDATE couples SET partner_b_id = ?, created_at = ? WHERE id = ?").run(
      partnerB.data.user.id,
      now() - 96 * HOUR,
      reg.coupleId,
    );
    db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(
      reg.coupleId,
      partnerB.data.user.id,
    );

    expect(runEmailSweep().invitePartnerAuto).toBe(0);
  });

  test("already nudged by admin → auto-sweep skips it", async () => {
    wipeAll();
    const reg = await bootstrapSoloCouple("auto-already@weddly.test");
    db.prepare(
      "UPDATE couples SET created_at = ?, invite_partner_reminded_at = ? WHERE id = ?",
    ).run(now() - 96 * HOUR, now() - 10 * HOUR, reg.coupleId);

    expect(runEmailSweep().invitePartnerAuto).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 3 — Admin suppliers module (list, approve, hide/unhide, enrich,
//                                       reports list/dismiss, notes, delete).
// ────────────────────────────────────────────────────────────────────────────

interface AdminSupplierRow {
  id: number;
  status: string;
  hide_reason: string | null;
  admin_notes: string | null;
  open_report_count: number;
}

interface AdminSuppliersResp {
  suppliers: AdminSupplierRow[];
}

describe("admin suppliers — list, approve, hide/unhide", () => {
  test("list returns the row in awaiting_review immediately after verify", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    const list = await req<AdminSuppliersResp>("GET", "/api/admin/suppliers", undefined, {
      token: adminToken,
    });
    expect(list.status).toBe(200);
    const row = list.data.suppliers.find((s) => s.id === id);
    expect(row).toBeDefined();
    expect(row?.status).toBe("awaiting_review");
    expect(row?.open_report_count).toBe(0);
  });

  test("approve — flips status to active and writes an audit row", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    const r = await req<{ supplier: AdminSupplierRow }>(
      "POST",
      `/api/admin/suppliers/${id}/approve`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.supplier.status).toBe("active");
    const audit = db
      .prepare(
        "SELECT action FROM audit_log WHERE action = 'supplier.community.approve' AND target_id = ?",
      )
      .get(id) as { action: string } | undefined;
    expect(audit).toBeDefined();
  });

  test("approve — refuses non-awaiting_review rows with 409", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    await req("POST", `/api/admin/suppliers/${id}/approve`, {}, { token: adminToken });
    // Already active — second approve must 409.
    const second = await req(
      "POST",
      `/api/admin/suppliers/${id}/approve`,
      {},
      { token: adminToken },
    );
    expect(second.status).toBe(409);
  });

  test("approve — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/admin/suppliers/99999/approve", {}, { token: adminToken });
    expect(r.status).toBe(404);
  });

  test("approve — bad id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/suppliers/notanumber/approve",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("send-verify — mints token + fires verify mail on pending submission with email", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("send-verify@weddly.test");
    // Bare submit — no token minted, no mail fired.
    const r = await req<SubmitVendorTipResult>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        submitter_type: "user",
        name: "Verify Hall",
        city: "Budapest",
        address: "X",
        website: "https://verify-hall.test",
        contact_email: "hello@verify-hall.test",
        blurb: "x",
        price_band: 2,
      },
      { token },
    );
    expect(r.status).toBe(201);
    const id = Number(r.data.supplier.id.slice(1));
    const beforeCount = (
      db
        .prepare("SELECT COUNT(*) AS n FROM community_supplier_verifications WHERE supplier_id = ?")
        .get(id) as { n: number }
    ).n;
    expect(beforeCount).toBe(0);

    // Admin releases the verify mail.
    const send = await req(
      "POST",
      `/api/admin/suppliers/${id}/send-verify`,
      {},
      { token: adminToken },
    );
    expect(send.status).toBe(200);

    // Token now exists + a community_supplier_verify mail landed in email_log.
    const tokenCount = (
      db
        .prepare("SELECT COUNT(*) AS n FROM community_supplier_verifications WHERE supplier_id = ?")
        .get(id) as { n: number }
    ).n;
    expect(tokenCount).toBe(1);
    const mail = db
      .prepare(
        "SELECT to_email FROM email_log WHERE kind = 'community_supplier_verify' ORDER BY id DESC LIMIT 1",
      )
      .get() as { to_email: string } | undefined;
    expect(mail?.to_email).toBe("hello@verify-hall.test");
  });

  test("send-verify — refuses when no contact_email", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("no-email-submit@weddly.test");
    const r = await req<SubmitVendorTipResult>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        submitter_type: "user",
        name: "No Email Hall",
        city: "Budapest",
        address: "X",
        website: "https://no-email-hall.test",
        contact_email: null,
        blurb: "x",
        price_band: 2,
      },
      { token },
    );
    expect(r.status).toBe(201);
    const id = Number(r.data.supplier.id.slice(1));
    const send = await req(
      "POST",
      `/api/admin/suppliers/${id}/send-verify`,
      {},
      { token: adminToken },
    );
    expect(send.status).toBe(409);
  });

  test("hide → unhide → hide cycle", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    await req("POST", `/api/admin/suppliers/${id}/approve`, {}, { token: adminToken });

    const hidden = await req<{ supplier: AdminSupplierRow }>(
      "POST",
      `/api/admin/suppliers/${id}/hide`,
      { reason: "Phishing site" },
      { token: adminToken },
    );
    expect(hidden.data.supplier.status).toBe("hidden");
    expect(hidden.data.supplier.hide_reason).toBe("Phishing site");

    const unhidden = await req<{ supplier: AdminSupplierRow }>(
      "POST",
      `/api/admin/suppliers/${id}/unhide`,
      {},
      { token: adminToken },
    );
    expect(unhidden.data.supplier.status).toBe("active");
    expect(unhidden.data.supplier.hide_reason).toBeNull();

    const rehidden = await req<{ supplier: AdminSupplierRow }>(
      "POST",
      `/api/admin/suppliers/${id}/hide`,
      {},
      { token: adminToken },
    );
    expect(rehidden.data.supplier.status).toBe("hidden");
    expect(rehidden.data.supplier.hide_reason).toBeNull();
  });

  test("hide — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/admin/suppliers/99999/hide", {}, { token: adminToken });
    expect(r.status).toBe(404);
  });

  test("unhide — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/admin/suppliers/99999/unhide", {}, { token: adminToken });
    expect(r.status).toBe(404);
  });

  test("delete — removes the row entirely", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    const del = await req("DELETE", `/api/admin/suppliers/${id}`, undefined, {
      token: adminToken,
    });
    expect(del.status).toBe(200);
    const after = await req<AdminSuppliersResp>("GET", "/api/admin/suppliers", undefined, {
      token: adminToken,
    });
    expect(after.data.suppliers.find((s) => s.id === id)).toBeUndefined();
  });

  test("delete — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("DELETE", "/api/admin/suppliers/99999", undefined, { token: adminToken });
    expect(r.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Catalog moderation: curated hide/unhide/delete (override table) + purge of
// the entire submitter account behind a community supplier.
// ────────────────────────────────────────────────────────────────────────────

interface DirectoryRow {
  id: string;
  source: "curated" | "community";
  status: string;
  community_id: number | null;
  submitter_type: "self" | "user" | null;
  submitter_last_seen_at: number | null;
}
interface DirectoryResp {
  suppliers: DirectoryRow[];
}

async function firstCuratedSlug(adminToken: string): Promise<string> {
  const dir = await req<DirectoryResp>(
    "GET",
    "/api/admin/suppliers/directory?source=curated",
    undefined,
    { token: adminToken },
  );
  expect(dir.status).toBe(200);
  const slug = dir.data.suppliers[0]?.id;
  expect(slug).toBeTruthy();
  return slug as string;
}

async function publicHasSupplier(id: string): Promise<boolean> {
  const list = await req<{ suppliers: { id: string }[] }>("GET", "/api/suppliers");
  return list.data.suppliers.some((s) => s.id === id);
}

describe("admin suppliers — curated moderation", () => {
  test("hide → curated drops off public list, shows hidden in admin, unhide restores", async () => {
    const adminToken = await bootstrapAdmin();
    const slug = await firstCuratedSlug(adminToken);
    expect(await publicHasSupplier(slug)).toBe(true);

    const hide = await req(
      "POST",
      `/api/admin/suppliers/curated/${slug}/hide`,
      { reason: "outdated" },
      { token: adminToken },
    );
    expect(hide.status).toBe(200);
    expect(await publicHasSupplier(slug)).toBe(false);

    // Still present in the admin catalog, now flagged hidden.
    const dir = await req<DirectoryResp>("GET", "/api/admin/suppliers/directory", undefined, {
      token: adminToken,
    });
    expect(dir.data.suppliers.find((s) => s.id === slug)?.status).toBe("hidden");

    const unhide = await req(
      "POST",
      `/api/admin/suppliers/curated/${slug}/unhide`,
      {},
      { token: adminToken },
    );
    expect(unhide.status).toBe(200);
    expect(await publicHasSupplier(slug)).toBe(true);
  });

  test("delete → curated gone from both public list and admin catalog", async () => {
    const adminToken = await bootstrapAdmin();
    const slug = await firstCuratedSlug(adminToken);

    const del = await req("DELETE", `/api/admin/suppliers/curated/${slug}`, undefined, {
      token: adminToken,
    });
    expect(del.status).toBe(200);
    expect(await publicHasSupplier(slug)).toBe(false);

    const dir = await req<DirectoryResp>("GET", "/api/admin/suppliers/directory", undefined, {
      token: adminToken,
    });
    expect(dir.data.suppliers.find((s) => s.id === slug)).toBeUndefined();
  });

  test("hide — unknown curated slug → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/suppliers/curated/not-a-real-slug/hide",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });
});

describe("admin suppliers — purge submitter", () => {
  test("purge-submitter deletes the submitter account and cascades the supplier", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("purge-victim@weddly.test");
    const id = await insertSupplierAwaitingReview(token);

    const submitterId = (
      db.prepare("SELECT submitter_user_id AS u FROM community_suppliers WHERE id = ?").get(id) as {
        u: number;
      }
    ).u;

    const r = await req(
      "POST",
      `/api/admin/suppliers/${id}/purge-submitter`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(200);

    // Supplier row cascaded away with the user.
    const supplier = db.prepare("SELECT id FROM community_suppliers WHERE id = ?").get(id);
    expect(supplier).toBeNull();
    // Audit trail records the purge against the submitter user.
    const audit = db
      .prepare(
        "SELECT action FROM audit_log WHERE action = 'supplier.community.purge_submitter' AND target_id = ?",
      )
      .get(submitterId) as { action: string } | undefined;
    expect(audit).toBeDefined();
  });

  test("purge-submitter — refuses to purge the admin's own account → 409", async () => {
    const adminToken = await bootstrapAdmin();
    // Admin self-submits a community supplier, then tries to purge via it.
    const sub = await req<SubmitVendorTipResult>(
      "POST",
      "/api/suppliers/community",
      {
        category: "venue",
        submitter_type: "self",
        name: "Self Hall",
        city: "Budapest",
        address: "X",
        website: "https://self-hall.test",
        contact_email: null,
        blurb: "x",
        price_band: 2,
      },
      { token: adminToken },
    );
    expect(sub.status).toBe(201);
    const id = Number(sub.data.supplier.id.slice(1));
    const r = await req(
      "POST",
      `/api/admin/suppliers/${id}/purge-submitter`,
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("purge-submitter — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/suppliers/99999/purge-submitter",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });
});

describe("admin suppliers — reports, notes, enrich", () => {
  test("reports list — empty by default, then surfaces a fresh report", async () => {
    const adminToken = await bootstrapAdmin();
    const { token: ownerToken } = await bootstrapCouple("owner@weddly.test");
    const id = await insertSupplierAwaitingReview(ownerToken);
    await req("POST", `/api/admin/suppliers/${id}/approve`, {}, { token: adminToken });

    const empty = await req<{ reports: unknown[] }>(
      "GET",
      `/api/admin/suppliers/${id}/reports`,
      undefined,
      { token: adminToken },
    );
    expect(empty.status).toBe(200);
    expect(empty.data.reports.length).toBe(0);

    // Someone else reports the listing.
    const { token: reporterToken } = await bootstrapCouple("reporter@weddly.test");
    const rep = await req(
      "POST",
      `/api/suppliers/community/${id}/report`,
      { reason: "spam", note: "All caps clickbait" },
      { token: reporterToken },
    );
    expect(rep.status).toBe(200);

    const full = await req<{
      reports: Array<{ supplier_id: number; reason: string; note: string | null }>;
    }>("GET", `/api/admin/suppliers/${id}/reports`, undefined, { token: adminToken });
    expect(full.data.reports.length).toBe(1);
    expect(full.data.reports[0]?.reason).toBe("spam");
    expect(full.data.reports[0]?.note).toBe("All caps clickbait");
  });

  test("reports list — unknown supplier → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("GET", "/api/admin/suppliers/99999/reports", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(404);
  });

  test("dismiss reports — clears them and returns the count", async () => {
    const adminToken = await bootstrapAdmin();
    const { token: ownerToken } = await bootstrapCouple("owner@weddly.test");
    const id = await insertSupplierAwaitingReview(ownerToken);
    await req("POST", `/api/admin/suppliers/${id}/approve`, {}, { token: adminToken });
    const { token: reporterToken } = await bootstrapCouple("reporter@weddly.test");
    await req(
      "POST",
      `/api/suppliers/community/${id}/report`,
      { reason: "spam" },
      { token: reporterToken },
    );

    const dis = await req<{ ok: boolean; dismissed: number }>(
      "POST",
      `/api/admin/suppliers/${id}/reports/dismiss`,
      {},
      { token: adminToken },
    );
    expect(dis.status).toBe(200);
    expect(dis.data.dismissed).toBe(1);

    const after = await req<{ reports: unknown[] }>(
      "GET",
      `/api/admin/suppliers/${id}/reports`,
      undefined,
      { token: adminToken },
    );
    expect(after.data.reports.length).toBe(0);
  });

  test("dismiss reports — unknown supplier → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/suppliers/99999/reports/dismiss",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("notes — PATCH updates admin_notes and roundtrips on the list", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    const patched = await req<{ supplier: AdminSupplierRow }>(
      "PATCH",
      `/api/admin/suppliers/${id}/notes`,
      { notes: "Owner confirmed they want to be listed." },
      { token: adminToken },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.supplier.admin_notes).toBe("Owner confirmed they want to be listed.");
    const list = await req<AdminSuppliersResp>("GET", "/api/admin/suppliers", undefined, {
      token: adminToken,
    });
    expect(list.data.suppliers.find((s) => s.id === id)?.admin_notes).toBe(
      "Owner confirmed they want to be listed.",
    );
  });

  test("notes — missing `notes` field → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("submitter@weddly.test");
    const id = await insertSupplierAwaitingReview(token);
    const r = await req("PATCH", `/api/admin/suppliers/${id}/notes`, {}, { token: adminToken });
    expect(r.status).toBe(400);
  });

  test("notes — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "PATCH",
      "/api/admin/suppliers/99999/notes",
      { notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("enrich — runs against an unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/admin/suppliers/99999/enrich", {}, { token: adminToken });
    expect(r.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 4 — Admin analytics (money, activity, picks).
// ────────────────────────────────────────────────────────────────────────────

describe("admin analytics", () => {
  test("money — empty state returns zeroed totals + the histogram scaffold", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<{
      couples_with_budget: number;
      couples_with_actuals: number;
      budget_ceiling_huf: { count: number; sum: number };
      planned_huf: { count: number; sum: number };
      actual_huf: { count: number; sum: number };
      per_category: Array<{ category: string; avg_planned: number; couples_with_data: number }>;
      budget_histogram: Array<{ bucket_max_huf: number; count: number }>;
      cost_histogram: Array<{ bucket_max_huf: number; count: number }>;
    }>("GET", "/api/admin/analytics/money", undefined, { token: adminToken });
    expect(r.status).toBe(200);
    expect(r.data.couples_with_budget).toBe(0);
    expect(r.data.couples_with_actuals).toBe(0);
    expect(r.data.budget_ceiling_huf.count).toBe(0);
    expect(r.data.planned_huf.count).toBe(0);
    expect(r.data.actual_huf.count).toBe(0);
    // Per-category scaffold always returns the full 15-row table even when empty.
    expect(r.data.per_category.length).toBe(15);
    for (const c of r.data.per_category) {
      expect(c.couples_with_data).toBe(0);
      expect(c.avg_planned).toBe(0);
    }
    // Both histograms return the 0-bucket + the 6 size buckets, all zeroed.
    expect(r.data.budget_histogram.length).toBe(7);
    expect(r.data.cost_histogram.length).toBe(7);
    for (const b of r.data.cost_histogram) expect(b.count).toBe(0);
  });

  test("money — populated couple shows up in couples_with_budget + histogram", async () => {
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("withbudget@weddly.test");
    const r = await req<{
      couples_with_budget: number;
      budget_ceiling_huf: { count: number; sum: number };
      budget_histogram: Array<{ bucket_max_huf: number; count: number }>;
    }>("GET", "/api/admin/analytics/money", undefined, { token: adminToken });
    expect(r.data.couples_with_budget).toBe(1);
    expect(r.data.budget_ceiling_huf.count).toBe(1);
    expect(r.data.budget_ceiling_huf.sum).toBe(5_000_000);
    // 5M ceiling lands in the bucket_max_huf=5_000_000 bucket.
    const five = r.data.budget_histogram.find((b) => b.bucket_max_huf === 5_000_000);
    expect(five?.count).toBe(1);
  });

  test("money — cost_histogram bins couples by total planned cost", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("withcost@weddly.test");
    // New workspaces start with an empty budget (feat 15f5f77e — no per-category
    // prefill), so build the couple's planned cost explicitly: two lines summing
    // to the 5M ceiling. cost_histogram bins that SUM, landing it in the 5M
    // bucket, same as its budget_ceiling_huf does for budget_histogram.
    const ts = now();
    for (const [category, planned] of [
      ["venue", 3_000_000],
      ["catering", 2_000_000],
    ] as const) {
      db.prepare(
        `INSERT INTO budget_lines (couple_id, category, label, planned_huf, actual_huf, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(coupleId, category, category, planned, ts, ts);
    }
    const r = await req<{
      budget_histogram: Array<{ bucket_max_huf: number; count: number }>;
      cost_histogram: Array<{ bucket_max_huf: number; count: number }>;
    }>("GET", "/api/admin/analytics/money", undefined, { token: adminToken });
    expect(r.data.cost_histogram.length).toBe(7);
    const five = r.data.cost_histogram.find((b) => b.bucket_max_huf === 5_000_000);
    expect(five?.count).toBe(1);
    // Both histograms cover the same couple universe, so their bars sum equally.
    const total = (h: Array<{ count: number }>) => h.reduce((s, b) => s + b.count, 0);
    expect(total(r.data.cost_histogram)).toBe(total(r.data.budget_histogram));
  });

  test("activity — empty: registered=0, signups.total=0", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<{
      signups: { total: number };
      onboarding_funnel: { registered: number; verified: number; onboarded: number };
      couples_by_status: Record<string, number>;
      top_actions: Array<{ action: string; count: number }>;
      signups_daily: Array<{ date: string; count: number }>;
    }>("GET", "/api/admin/analytics/activity", undefined, { token: adminToken });
    expect(r.status).toBe(200);
    // Default audience is "real users only" — the admin@test.test account is
    // on the ADMIN_EMAILS allowlist, so it's excluded from every headline.
    expect(r.data.signups.total).toBe(0);
    expect(r.data.onboarding_funnel.registered).toBe(0);
    expect(r.data.onboarding_funnel.verified).toBe(0);
    expect(r.data.onboarding_funnel.onboarded).toBe(0);
    expect(r.data.couples_by_status.active).toBe(0);
    expect(Array.isArray(r.data.top_actions)).toBe(true);
    // 14 daily points always present.
    expect(r.data.signups_daily.length).toBe(14);
  });

  test("activity — include_admins=1 brings the admin account back into the headline", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<{ signups: { total: number } }>(
      "GET",
      "/api/admin/analytics/activity?include_admins=1",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.signups.total).toBe(1);
  });

  test("weddings — demo couples excluded by default, in with include_demos=1", async () => {
    const adminToken = await bootstrapAdmin();
    // A real demo workspace (is_demo=1 couple) via the public CTA.
    const demo = await req("POST", "/api/demo/start");
    expect(demo.status).toBe(201);

    const def = await req<{ total_couples: number }>(
      "GET",
      "/api/admin/analytics/weddings",
      undefined,
      { token: adminToken },
    );
    expect(def.data.total_couples).toBe(0);

    const incl = await req<{ total_couples: number }>(
      "GET",
      "/api/admin/analytics/weddings?include_demos=1",
      undefined,
      { token: adminToken },
    );
    expect(incl.data.total_couples).toBe(1);
  });

  test("activity — onboarded couple flips couples_by_status.active to 1", async () => {
    const adminToken = await bootstrapAdmin();
    await bootstrapCouple("workspace@weddly.test");
    const r = await req<{
      onboarding_funnel: { registered: number; onboarded: number };
      couples_by_status: Record<string, number>;
    }>("GET", "/api/admin/analytics/activity", undefined, { token: adminToken });
    // Admin excluded by default → only the real onboarded couple is counted.
    expect(r.data.onboarding_funnel.registered).toBe(1);
    expect(r.data.onboarding_funnel.onboarded).toBe(1);
    expect(r.data.couples_by_status.active).toBe(1);
  });

  test("activity — demo workspace is excluded from the real headline, counted in `demo`", async () => {
    const adminToken = await bootstrapAdmin();
    // Spin up a real demo workspace through the public CTA endpoint. It
    // creates a verified, onboarded demo user + an is_demo=1 active couple.
    const demo = await req("POST", "/api/demo/start");
    expect(demo.status).toBe(201);

    const r = await req<AdminActivityAnalytics>("GET", "/api/admin/analytics/activity", undefined, {
      token: adminToken,
    });

    // Real headline: the admin is excluded by default (ADMIN_EMAILS) and the
    // demo user/couple must NOT leak in either, so the real headline is empty.
    expect(r.data.signups.total).toBe(0);
    expect(r.data.signups.last_24h).toBe(0);
    expect(r.data.onboarding_funnel.registered).toBe(0);
    expect(r.data.onboarding_funnel.verified).toBe(0);
    expect(r.data.onboarding_funnel.onboarded).toBe(0);
    expect(r.data.couples_by_status.active).toBe(0);
    // Daily series excludes both the admin and the demo signup.
    expect(r.data.signups_daily.reduce((s, d) => s + d.count, 0)).toBe(0);

    // Demo block: the one demo workspace shows up here instead.
    expect(r.data.demo.signups.total).toBe(1);
    expect(r.data.demo.signups.last_24h).toBe(1);
    expect(r.data.demo.onboarding_funnel.registered).toBe(1);
    expect(r.data.demo.onboarding_funnel.verified).toBe(1);
    expect(r.data.demo.onboarding_funnel.onboarded).toBe(1);
    expect(r.data.demo.couples_total).toBe(1);
  });

  test("picks — empty returns zeroed totals + the category scaffold", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<{
      total_picks: number;
      picks_per_couple: { count: number };
      top_picks: unknown[];
      category_coverage: Array<{ category: string; picked: number; missing: number }>;
      source_breakdown: { curated: number; community: number; diy: number };
    }>("GET", "/api/admin/analytics/picks", undefined, { token: adminToken });
    expect(r.status).toBe(200);
    expect(r.data.total_picks).toBe(0);
    expect(r.data.picks_per_couple.count).toBe(0);
    expect(r.data.top_picks.length).toBe(0);
    // 30 since the celebrant split (76338e14) gave szertartásvezető its own
    // category. The scaffold lists every category, picked or not.
    expect(r.data.category_coverage.length).toBe(30);
    expect(r.data.source_breakdown.curated).toBe(0);
    expect(r.data.source_breakdown.community).toBe(0);
    expect(r.data.source_breakdown.diy).toBe(0);
  });

  // ── Weddings / honeymoon / guests rollups ──────────────────────────────

  /** Insert a guest row straight into SQLite — bypasses the create API's
   *  plus-one auto-guest + household side-effects so the analytics counts
   *  stay exactly what the test sets. */
  function insertGuest(
    coupleId: number,
    code: string,
    fields: {
      rsvp_status?: string;
      kind?: string;
      plus_one_name?: string | null;
      accommodation_needed?: number;
      song_request?: string | null;
      dietary?: string | null;
    } = {},
  ): void {
    const ts = now();
    db.prepare(
      `INSERT INTO guests
         (couple_id, full_name, invite_code, rsvp_status, kind, plus_one_name,
          accommodation_needed, song_request, dietary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      coupleId,
      `Guest ${code}`,
      code,
      fields.rsvp_status ?? "pending",
      fields.kind ?? "adult",
      fields.plus_one_name ?? null,
      fields.accommodation_needed ?? 0,
      fields.song_request ?? null,
      fields.dietary ?? null,
      ts,
      ts,
    );
  }

  test("weddings — empty: zeroed totals + full month/weekday/season scaffold", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<AdminWeddingAnalytics>("GET", "/api/admin/analytics/weddings", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(200);
    // The admin has no couple workspace, so the real-couple universe is empty.
    expect(r.data.total_couples).toBe(0);
    expect(r.data.couples_with_date).toBe(0);
    expect(r.data.wedding_month.length).toBe(12);
    expect(r.data.wedding_weekday.length).toBe(7);
    expect(r.data.wedding_season.length).toBe(4);
    expect(r.data.guest_count_target.count).toBe(0);
  });

  test("weddings — a bootstrapped couple lands in the month + season + guest target", async () => {
    const adminToken = await bootstrapAdmin();
    // bootstrapCouple onboards with wedding_date 2026-09-12 (September → autumn)
    // and target_guest_count 80.
    await bootstrapCouple("wed@weddly.test");
    const r = await req<AdminWeddingAnalytics>("GET", "/api/admin/analytics/weddings", undefined, {
      token: adminToken,
    });
    expect(r.data.total_couples).toBe(1);
    expect(r.data.couples_with_date).toBe(1);
    expect(r.data.wedding_month.find((m) => m.month === 9)?.count).toBe(1);
    expect(r.data.wedding_season.find((s) => s.season === "autumn")?.count).toBe(1);
    expect(r.data.guest_count_target.count).toBe(1);
    expect(r.data.guest_count_target.median).toBe(80);
    expect(r.data.by_currency.find((c) => c.currency === "HUF")?.count).toBe(1);
    expect(r.data.by_country.find((c) => c.country === "HU")?.count).toBe(1);
  });

  test("honeymoon — empty: zero destinations, adoption 0", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<AdminHoneymoonAnalytics>(
      "GET",
      "/api/admin/analytics/honeymoon",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.couples_with_destination).toBe(0);
    expect(r.data.adoption_pct).toBe(0);
    expect(r.data.top_destinations.length).toBe(0);
    expect(r.data.start_month.length).toBe(12);
  });

  test("honeymoon — destination + dates roll up into the leaderboard + trip nights", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("honey@weddly.test");
    db.prepare(
      `UPDATE couples SET honeymoon_destination = ?, honeymoon_start_date = ?,
         honeymoon_end_date = ?, honeymoon_origin_iata = ? WHERE id = ?`,
    ).run("Bali", "2026-10-01", "2026-10-10", "bud", coupleId);

    const r = await req<AdminHoneymoonAnalytics>(
      "GET",
      "/api/admin/analytics/honeymoon",
      undefined,
      { token: adminToken },
    );
    expect(r.data.total_couples).toBe(1);
    expect(r.data.couples_with_destination).toBe(1);
    expect(r.data.adoption_pct).toBe(1);
    expect(r.data.top_destinations[0]?.destination).toBe("Bali");
    expect(r.data.top_destinations[0]?.count).toBe(1);
    // IATA is normalised to upper-case.
    expect(r.data.top_origins[0]?.iata).toBe("BUD");
    expect(r.data.couples_with_dates).toBe(1);
    expect(r.data.trip_nights.median).toBe(9);
    // October departure.
    expect(r.data.start_month.find((m) => m.month === 10)?.count).toBe(1);
  });

  test("honeymoon — case-insensitive grouping keeps the most common spelling", async () => {
    const adminToken = await bootstrapAdmin();
    const a = await bootstrapCouple("h1@weddly.test");
    const b = await bootstrapCouple("h2@weddly.test");
    const c = await bootstrapCouple("h3@weddly.test");
    db.prepare("UPDATE couples SET honeymoon_destination = ? WHERE id = ?").run("Bali", a.coupleId);
    db.prepare("UPDATE couples SET honeymoon_destination = ? WHERE id = ?").run("bali", b.coupleId);
    db.prepare("UPDATE couples SET honeymoon_destination = ? WHERE id = ?").run(
      "Paris",
      c.coupleId,
    );

    const r = await req<AdminHoneymoonAnalytics>(
      "GET",
      "/api/admin/analytics/honeymoon",
      undefined,
      { token: adminToken },
    );
    // "Bali"/"bali" collapse to one group of 2; display picks the spelling that
    // is alphabetically first on a frequency tie → "Bali".
    expect(r.data.top_destinations[0]?.destination).toBe("Bali");
    expect(r.data.top_destinations[0]?.count).toBe(2);
    expect(r.data.top_destinations.find((d) => d.destination === "Paris")?.count).toBe(1);
  });

  test("guests — empty returns zeroed funnel + rates", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<AdminGuestAnalytics>("GET", "/api/admin/analytics/guests", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(200);
    expect(r.data.total_guests).toBe(0);
    expect(r.data.couples_with_guests).toBe(0);
    expect(r.data.response_rate).toBe(0);
    expect(r.data.acceptance_rate).toBe(0);
    expect(r.data.guests_with_dietary).toBe(0);
  });

  test("guests — RSVP funnel, kinds, plus-one, dietary keyword buckets", async () => {
    const adminToken = await bootstrapAdmin();
    const { coupleId } = await bootstrapCouple("guesthost@weddly.test");
    insertGuest(coupleId, "G1", {
      rsvp_status: "yes",
      plus_one_name: "Partner A",
      accommodation_needed: 1,
      song_request: "ABBA",
      dietary: "gluténmentes",
    });
    insertGuest(coupleId, "G2", { rsvp_status: "no", dietary: "vegan, no dairy" });
    insertGuest(coupleId, "G3", { rsvp_status: "maybe", kind: "child" });
    insertGuest(coupleId, "G4", { rsvp_status: "pending", kind: "baby" });

    const r = await req<AdminGuestAnalytics>("GET", "/api/admin/analytics/guests", undefined, {
      token: adminToken,
    });
    expect(r.data.total_guests).toBe(4);
    expect(r.data.couples_with_guests).toBe(1);
    expect(r.data.rsvp_breakdown).toEqual({ pending: 1, yes: 1, no: 1, maybe: 1 });
    // (yes+no+maybe)/total = 3/4
    expect(r.data.response_rate).toBeCloseTo(0.75, 5);
    // yes/(yes+no) = 1/2
    expect(r.data.acceptance_rate).toBeCloseTo(0.5, 5);
    expect(r.data.kind_breakdown).toEqual({ adult: 2, child: 1, baby: 1 });
    expect(r.data.plus_one_count).toBe(1);
    expect(r.data.accommodation_needed_count).toBe(1);
    expect(r.data.song_request_count).toBe(1);
    // "gluténmentes" → gluten bucket; "vegan, no dairy" → vegan + lactose.
    expect(r.data.dietary.gluten).toBe(1);
    expect(r.data.dietary.vegan).toBe(1);
    expect(r.data.dietary.lactose).toBe(1);
    expect(r.data.guests_with_dietary).toBe(2);
  });

  test("weddings/honeymoon/guests — demo workspaces are excluded", async () => {
    const adminToken = await bootstrapAdmin();
    // A real demo workspace (is_demo=1) seeded through the public CTA.
    const demo = await req("POST", "/api/demo/start");
    expect(demo.status).toBe(201);

    const w = await req<AdminWeddingAnalytics>("GET", "/api/admin/analytics/weddings", undefined, {
      token: adminToken,
    });
    const g = await req<AdminGuestAnalytics>("GET", "/api/admin/analytics/guests", undefined, {
      token: adminToken,
    });
    // The demo couple + its seeded guests must not leak into the real universe.
    expect(w.data.total_couples).toBe(0);
    expect(g.data.total_guests).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 5 — Vendor waitlist (public POST + admin list/decide/reopen).
// ────────────────────────────────────────────────────────────────────────────

interface VendorEntry {
  id: number;
  business_name: string;
  email: string;
  category: string;
  status: string;
  notes?: string | null;
  sent_subject?: string | null;
}

describe("vendor waitlist — public submit", () => {
  test("public POST creates a row, no auth required", async () => {
    wipeAll();
    const r = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "Floral Studio",
      email: "florist@example.com",
      category: "wedding_decor",
      location: "Pest, HU",
      website: "https://floral.test",
      message: "We do garden weddings.",
    });
    expect(r.status).toBe(201);
    expect(r.data.entry.business_name).toBe("Floral Studio");
    expect(r.data.entry.email).toBe("florist@example.com");
    expect(r.data.entry.status).toBe("new");
  });

  test("public POST — missing business_name → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/vendors/waitlist", {
      email: "x@x.com",
      category: "venue",
    });
    expect(r.status).toBe(400);
  });

  test("public POST — invalid category → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/vendors/waitlist", {
      business_name: "X",
      email: "x@x.com",
      category: "not_a_real_category",
    });
    expect(r.status).toBe(400);
  });

  test("public POST — malformed email → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/vendors/waitlist", {
      business_name: "X",
      email: "not-an-email",
      category: "venue",
    });
    expect(r.status).toBe(400);
  });

  test("public POST — missing email → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/vendors/waitlist", {
      business_name: "X",
      category: "venue",
    });
    expect(r.status).toBe(400);
  });

  test("public POST — instagram handle normalisation strips leading @", async () => {
    wipeAll();
    const r = await req<{ entry: VendorEntry & { instagram_handle: string | null } }>(
      "POST",
      "/api/vendors/waitlist",
      {
        business_name: "Handle Test",
        email: "h@h.com",
        category: "venue",
        instagram_handle: "@happy.handle",
      },
    );
    expect(r.status).toBe(201);
    expect(r.data.entry.instagram_handle).toBe("happy.handle");
  });
});

describe("vendor waitlist — admin list/decide/reopen", () => {
  test("admin list returns the new entry", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/vendors/waitlist", {
      business_name: "ListMe",
      email: "list@me.com",
      category: "dj",
    });
    const r = await req<{ entries: VendorEntry[] }>(
      "GET",
      "/api/admin/vendor-waitlist",
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.entries.length).toBe(1);
    expect(r.data.entries[0]?.business_name).toBe("ListMe");
    expect(r.data.entries[0]?.status).toBe("new");
  });

  test("decide accepted → status=accepted, then reopen → status=new", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "Acme",
      email: "acme@example.com",
      category: "venue",
    });
    const id = sub.data.entry.id;
    const dec = await req<{ entry: VendorEntry }>(
      "POST",
      `/api/admin/vendor-waitlist/${id}/decide`,
      {
        outcome: "accepted",
        subject: "Welcome aboard",
        body: "We'd love to onboard you.",
        notes: "Strong portfolio",
      },
      { token: adminToken },
    );
    expect(dec.status).toBe(200);
    expect(dec.data.entry.status).toBe("accepted");
    expect(dec.data.entry.notes).toBe("Strong portfolio");
    expect(dec.data.entry.sent_subject).toBe("Welcome aboard");

    const re = await req<{ entry: VendorEntry }>(
      "POST",
      `/api/admin/vendor-waitlist/${id}/reopen`,
      {},
      { token: adminToken },
    );
    expect(re.status).toBe(200);
    expect(re.data.entry.status).toBe("new");
  });

  test("decide rejected → status=rejected", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "NoFit",
      email: "no@fit.com",
      category: "venue",
    });
    const dec = await req<{ entry: VendorEntry }>(
      "POST",
      `/api/admin/vendor-waitlist/${sub.data.entry.id}/decide`,
      { outcome: "rejected", subject: "Thanks", body: "Not a match.", notes: "" },
      { token: adminToken },
    );
    expect(dec.status).toBe(200);
    expect(dec.data.entry.status).toBe("rejected");
  });

  test("decide under_review → status=under_review", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "Pending",
      email: "p@p.com",
      category: "venue",
    });
    const dec = await req<{ entry: VendorEntry }>(
      "POST",
      `/api/admin/vendor-waitlist/${sub.data.entry.id}/decide`,
      {
        outcome: "under_review",
        subject: "Looking deeper",
        body: "We'll be in touch.",
        notes: "",
      },
      { token: adminToken },
    );
    expect(dec.status).toBe(200);
    expect(dec.data.entry.status).toBe("under_review");
  });

  test("decide — invalid outcome → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "Bad",
      email: "bad@x.com",
      category: "venue",
    });
    const r = await req(
      "POST",
      `/api/admin/vendor-waitlist/${sub.data.entry.id}/decide`,
      { outcome: "made_up", subject: "x", body: "y", notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("decide — missing subject → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "NoSub",
      email: "n@x.com",
      category: "venue",
    });
    const r = await req(
      "POST",
      `/api/admin/vendor-waitlist/${sub.data.entry.id}/decide`,
      { outcome: "accepted", body: "x", notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("decide — missing body → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const sub = await req<{ entry: VendorEntry }>("POST", "/api/vendors/waitlist", {
      business_name: "NoBody",
      email: "n2@x.com",
      category: "venue",
    });
    const r = await req(
      "POST",
      `/api/admin/vendor-waitlist/${sub.data.entry.id}/decide`,
      { outcome: "accepted", subject: "x", notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("decide — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/vendor-waitlist/99999/decide",
      { outcome: "accepted", subject: "x", body: "y", notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("decide — bad id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/vendor-waitlist/abc/decide",
      { outcome: "accepted", subject: "x", body: "y", notes: "" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("reopen — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/vendor-waitlist/99999/reopen",
      {},
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 6 — Feedback (public submit + admin list/status/delete).
// ────────────────────────────────────────────────────────────────────────────

interface FeedbackRow {
  id: number;
  message: string | null;
  status: string;
  source: string;
  context: string | null;
  user_id: number | null;
  user_email: string | null;
}

describe("feedback — public submit", () => {
  test("anonymous POST is accepted with a message", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", { message: "Hi I'm new!" });
    expect(r.status).toBe(200);
  });

  test("anonymous POST accepted with rating only", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", { rating: 8 });
    expect(r.status).toBe(200);
  });

  test("anonymous POST accepted with monthly_value_ft only", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", { monthly_value_ft: 1500 });
    expect(r.status).toBe(200);
  });

  test("POST with no payload at all → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", {});
    expect(r.status).toBe(400);
  });

  test("POST with rating out of range → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", { rating: 99 });
    expect(r.status).toBe(400);
  });

  test("POST with bad from_email → 400", async () => {
    wipeAll();
    const r = await req("POST", "/api/feedback", {
      message: "hi",
      from_email: "garbage",
    });
    expect(r.status).toBe(400);
  });

  test("app-source POST persists the in-app context path", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/feedback", {
      source: "app",
      context: "/app/media",
      message: "Photo gallery feels slow.",
    });
    expect(r.status).toBe(200);
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    const entry = list.data.entries.find((e) => e.message === "Photo gallery feels slow.");
    expect(entry?.source).toBe("app");
    expect(entry?.context).toBe("/app/media");
  });

  test("landing-source POST drops any context the client tries to attach", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("POST", "/api/feedback", {
      source: "landing",
      context: "/app/media",
      message: "Landing should not carry a context.",
    });
    expect(r.status).toBe(200);
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    const entry = list.data.entries.find(
      (e) => e.message === "Landing should not carry a context.",
    );
    expect(entry?.source).toBe("landing");
    expect(entry?.context).toBeNull();
  });
});

describe("feedback — admin list/status/delete", () => {
  test("admin list returns both submitted entries", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/feedback", { message: "first" });
    await req("POST", "/api/feedback", { message: "second" });
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    expect(list.status).toBe(200);
    expect(list.data.entries.length).toBe(2);
    // Ordering is `ORDER BY created_at DESC` — but in tests both rows can land
    // in the same millisecond, so we only assert presence. The integration
    // tests over real-world timestamps cover the ordering separately.
    const messages = list.data.entries.map((e) => e.message);
    expect(messages).toContain("first");
    expect(messages).toContain("second");
  });

  test("admin can move status new → reviewed → fixed → rejected", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/feedback", { message: "moving" });
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    const id = list.data.entries[0]!.id;
    for (const status of ["reviewed", "fixed", "rejected"] as const) {
      const r = await req<{ entry: FeedbackRow }>(
        "PATCH",
        `/api/admin/feedback/${id}/status`,
        { status },
        { token: adminToken },
      );
      expect(r.status).toBe(200);
      expect(r.data.entry.status).toBe(status);
    }
  });

  test("admin PATCH status — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "PATCH",
      "/api/admin/feedback/99999/status",
      { status: "reviewed" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("admin PATCH status — bad id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "PATCH",
      "/api/admin/feedback/abc/status",
      { status: "read" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("admin PATCH status — invalid status string → 400", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/feedback", { message: "x" });
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    const id = list.data.entries[0]!.id;
    const r = await req(
      "PATCH",
      `/api/admin/feedback/${id}/status`,
      { status: "wat" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("admin DELETE — hard-removes the row", async () => {
    const adminToken = await bootstrapAdmin();
    await req("POST", "/api/feedback", { message: "delete me" });
    const list = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    const id = list.data.entries[0]!.id;
    const del = await req("DELETE", `/api/admin/feedback/${id}`, undefined, {
      token: adminToken,
    });
    expect(del.status).toBe(200);
    const after = await req<{ entries: FeedbackRow[] }>("GET", "/api/admin/feedback", undefined, {
      token: adminToken,
    });
    expect(after.data.entries.length).toBe(0);
  });

  test("admin DELETE — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("DELETE", "/api/admin/feedback/99999", undefined, { token: adminToken });
    expect(r.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Category 7 — Supplier taxonomy (public read + admin CRUD).
// ────────────────────────────────────────────────────────────────────────────

interface GroupRow {
  id: number;
  slug: string;
  label_hu: string;
  label_en: string;
  sort_order: number;
}

interface CategoryRow extends GroupRow {
  group_id: number;
  budget_category: string;
}

interface TaxonomyResp {
  groups: Array<GroupRow & { categories: CategoryRow[] }>;
}

describe("supplier taxonomy — admin groups CRUD", () => {
  test("public GET returns the seeded 9 groups", async () => {
    wipeAll();
    const r = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    expect(r.status).toBe(200);
    expect(r.data.groups.length).toBe(9);
  });

  test("admin POST create group — happy path", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req<{ group: GroupRow }>(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "new_group", label_hu: "Új", label_en: "New" },
      { token: adminToken },
    );
    expect(r.status).toBe(201);
    expect(r.data.group.slug).toBe("new_group");
    expect(r.data.group.label_hu).toBe("Új");
  });

  test("admin POST create group — duplicate slug → 409", async () => {
    const adminToken = await bootstrapAdmin();
    await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "dup_group", label_hu: "X", label_en: "X" },
      { token: adminToken },
    );
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "dup_group", label_hu: "Y", label_en: "Y" },
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("admin POST create group — invalid slug shape → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "Bad Slug!", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("admin POST create group — missing label_hu → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "missing_label", label_en: "X" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("admin PATCH group — preserves untouched fields", async () => {
    const adminToken = await bootstrapAdmin();
    const created = await req<{ group: GroupRow }>(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "patch_target", label_hu: "PHU", label_en: "PEN" },
      { token: adminToken },
    );
    const patched = await req<{ group: GroupRow }>(
      "PATCH",
      `/api/admin/supplier-groups/${created.data.group.id}`,
      { label_hu: "PHU2" },
      { token: adminToken },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.group.label_hu).toBe("PHU2");
    expect(patched.data.group.label_en).toBe("PEN"); // unchanged
    expect(patched.data.group.slug).toBe("patch_target"); // unchanged
  });

  test("admin PATCH group — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "PATCH",
      "/api/admin/supplier-groups/99999",
      { label_hu: "X" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("admin DELETE group — refuses while categories remain → 409", async () => {
    const adminToken = await bootstrapAdmin();
    // Pull a seeded group id (any one — they all have categories).
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const seededId = tax.data.groups[0]!.id;
    const r = await req("DELETE", `/api/admin/supplier-groups/${seededId}`, undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(409);
  });

  test("admin DELETE group — succeeds on an empty group", async () => {
    const adminToken = await bootstrapAdmin();
    const created = await req<{ group: GroupRow }>(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "empty_group", label_hu: "X", label_en: "X" },
      { token: adminToken },
    );
    const r = await req(
      "DELETE",
      `/api/admin/supplier-groups/${created.data.group.id}`,
      undefined,
      { token: adminToken },
    );
    expect(r.status).toBe(200);
  });

  test("admin DELETE group — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("DELETE", "/api/admin/supplier-groups/99999", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(404);
  });
});

describe("supplier taxonomy — admin categories CRUD", () => {
  test("admin POST create category — happy path", async () => {
    const adminToken = await bootstrapAdmin();
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const groupId = tax.data.groups[0]!.id;
    const r = await req<{ category: CategoryRow }>(
      "POST",
      "/api/admin/supplier-categories",
      {
        group_id: groupId,
        slug: "new_cat",
        label_hu: "Új kat",
        label_en: "New cat",
      },
      { token: adminToken },
    );
    expect(r.status).toBe(201);
    expect(r.data.category.slug).toBe("new_cat");
    expect(r.data.category.group_id).toBe(groupId);
  });

  test("admin POST create category — duplicate slug → 409", async () => {
    const adminToken = await bootstrapAdmin();
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const groupId = tax.data.groups[0]!.id;
    await req(
      "POST",
      "/api/admin/supplier-categories",
      { group_id: groupId, slug: "dup_cat", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { group_id: groupId, slug: "dup_cat", label_hu: "y", label_en: "y" },
      { token: adminToken },
    );
    expect(r.status).toBe(409);
  });

  test("admin POST create category — missing group_id → 400", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { slug: "no_gid", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("admin POST create category — unknown group_id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "POST",
      "/api/admin/supplier-categories",
      { group_id: 99999, slug: "ghost_cat", label_hu: "x", label_en: "x" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("admin PATCH category — preserves untouched fields", async () => {
    const adminToken = await bootstrapAdmin();
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const groupId = tax.data.groups[0]!.id;
    const created = await req<{ category: CategoryRow }>(
      "POST",
      "/api/admin/supplier-categories",
      {
        group_id: groupId,
        slug: "patch_cat",
        label_hu: "CHU",
        label_en: "CEN",
        budget_category: "venue",
      },
      { token: adminToken },
    );
    const patched = await req<{ category: CategoryRow }>(
      "PATCH",
      `/api/admin/supplier-categories/${created.data.category.id}`,
      { label_hu: "CHU2" },
      { token: adminToken },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.category.label_hu).toBe("CHU2");
    expect(patched.data.category.label_en).toBe("CEN");
    expect(patched.data.category.slug).toBe("patch_cat");
    expect(patched.data.category.budget_category).toBe("venue");
  });

  test("admin PATCH category — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req(
      "PATCH",
      "/api/admin/supplier-categories/99999",
      { label_hu: "X" },
      { token: adminToken },
    );
    expect(r.status).toBe(404);
  });

  test("admin DELETE category — refuses while active community suppliers reference it → 409", async () => {
    const adminToken = await bootstrapAdmin();
    const { token } = await bootstrapCouple("supref@weddly.test");
    await insertSupplierAwaitingReview(token); // category=venue
    // Find the seeded `venue` category id.
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const venueCat = tax.data.groups.flatMap((g) => g.categories).find((c) => c.slug === "venue");
    expect(venueCat).toBeDefined();
    const r = await req("DELETE", `/api/admin/supplier-categories/${venueCat!.id}`, undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(409);
  });

  test("admin DELETE category — succeeds when nothing references it", async () => {
    const adminToken = await bootstrapAdmin();
    const tax = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const groupId = tax.data.groups[0]!.id;
    const created = await req<{ category: CategoryRow }>(
      "POST",
      "/api/admin/supplier-categories",
      {
        group_id: groupId,
        slug: "deletable_cat",
        label_hu: "X",
        label_en: "X",
      },
      { token: adminToken },
    );
    const del = await req(
      "DELETE",
      `/api/admin/supplier-categories/${created.data.category.id}`,
      undefined,
      { token: adminToken },
    );
    expect(del.status).toBe(200);
  });

  test("admin DELETE category — unknown id → 404", async () => {
    const adminToken = await bootstrapAdmin();
    const r = await req("DELETE", "/api/admin/supplier-categories/99999", undefined, {
      token: adminToken,
    });
    expect(r.status).toBe(404);
  });

  test("admin mutations propagate to the public taxonomy endpoint", async () => {
    const adminToken = await bootstrapAdmin();
    const before = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    const beforeCount = before.data.groups.length;
    await req(
      "POST",
      "/api/admin/supplier-groups",
      { slug: "publish_test", label_hu: "Publish", label_en: "Publish" },
      { token: adminToken },
    );
    const after = await req<TaxonomyResp>("GET", "/api/supplier-categories");
    expect(after.data.groups.length).toBe(beforeCount + 1);
    expect(after.data.groups.some((g) => g.slug === "publish_test")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Purged tombstones must never reach the admin user list. A purge scrubs the
// row but keeps it (FK target for audit_log + couples) and NULLs couple_id, so
// without an explicit filter every deleted user reappears forever as
// "Purged user" under "Munkaterület nélküli felhasználók".
// ────────────────────────────────────────────────────────────────────────────
describe("admin user list — purged tombstones", () => {
  test("a purged orphan is hidden from the user list", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "to-purge@weddly.test",
      password: "supersafe123",
      full_name: "Doomed",
    });
    const userId = reg.data.user.id;

    const before = await req<{ users: { id: number }[] }>("GET", "/api/admin/users", undefined, {
      token: adminToken,
    });
    expect(before.data.users.some((u) => u.id === userId)).toBe(true);

    purgeOneUser(userId);

    const after = await req<{ users: { id: number; email: string }[] }>(
      "GET",
      "/api/admin/users",
      undefined,
      { token: adminToken },
    );
    expect(after.data.users.some((u) => u.id === userId)).toBe(false);
    expect(after.data.users.some((u) => u.email.endsWith("@purged.local"))).toBe(false);
    // The admin themselves must survive the filter — proves the new WHERE
    // clause didn't over-match (the OR-precedence trap).
    expect(after.data.users.some((u) => u.email === "admin@test.test")).toBe(true);
  });

  test("resend-verify refuses a purged user", async () => {
    const adminToken = await bootstrapAdmin();
    const reg = await registerAndVerify({
      email: "purged-resend@weddly.test",
      password: "supersafe123",
      full_name: "Doomed",
    });
    const userId = reg.data.user.id;
    // Purge never resets verified_email, so this row still looks "resendable" —
    // without the guard we'd mail a fresh link to deleted-N@purged.local.
    purgeOneUser(userId);

    const r = await req(
      "POST",
      `/api/admin/users/${userId}/resend-verify`,
      {},
      {
        token: adminToken,
      },
    );
    expect(r.status).toBe(400);
  });
});

// Reference to addAdmin to satisfy "unused" lint if Bun-test ever flags it.
// Kept exported as part of the module surface for sibling test files.
void addAdmin;
