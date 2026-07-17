// Never-verified signups used to accumulate forever: the verify link dies after
// VERIFY_TTL_MS (7 days) but the row lived on, holding its address hostage
// against the users.email UNIQUE constraint and cluttering the admin
// "no workspace" list. purgeStaleUnverifiedSignups reaps them after 30 days.
//
// The exclusion cases below are the important half of this suite — several
// legitimate account classes also carry verified_email = 0 and must survive.
// Ages are set by writing created_at directly; there's no clock to travel.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail } from "../helpers";
import { db, now } from "../../src/db";
import { purgeStaleUnverifiedSignups, UNVERIFIED_TTL_MS } from "../../src/domain/purge";

/** A never-verified signup as a `users` row — the fixture this sweep exists to
 *  reap.
 *
 *  It can't come from POST /api/auth/register anymore: that parks the signup in
 *  `pending_signups` and mints nothing, so a couples register leaves no
 *  unverified user behind at all. The row goes in directly instead, in exactly
 *  the shape a password signup used to leave: verified_email = 0,
 *  password_set = 1, no workspace. The sweep's own behaviour is unchanged. */
function seedUnverifiedSignup(email: string): number {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          password_set, couple_id, created_at, updated_at)
       VALUES (?, '!hash!', 'Never Verified', 'active', 'owner', 0, 1, NULL, ?, ?)`,
    )
    .run(email, ts, ts);
  return Number(result.lastInsertRowid);
}

/** Age a user's signup past the reap cutoff. */
function ageSignup(email: string, ms = UNVERIFIED_TTL_MS + 1000 * 60 * 60): number {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  expect(row).toBeDefined();
  db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now() - ms, row!.id);
  return row!.id;
}

function userById(id: number): { email: string; status: string } | undefined {
  return db.prepare("SELECT email, status FROM users WHERE id = ?").get(id) as
    | { email: string; status: string }
    | undefined;
}

/** Park a signup. Register no longer mints a users row, so this returns 202
 *  and leaves only a pending_signups row until the verify link is clicked. */
async function register(email: string): Promise<void> {
  const r = await req("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Never Verified",
  });
  expect(r.status).toBe(202);
}

describe("unverified signup sweep", () => {
  test("reaps a never-verified signup older than 30 days", async () => {
    wipeAll();
    seedUnverifiedSignup("stale@weddly.test");
    const userId = ageSignup("stale@weddly.test");

    expect(purgeStaleUnverifiedSignups()).toBe(1);

    // Scrubbed, not hard-deleted: audit_log is append-only and FKs are ON, so
    // the row survives as a tombstone (invisible to admins — listAllUsers
    // filters @purged.local out).
    const after = userById(userId);
    expect(after).toBeDefined();
    expect(after!.email).toBe(`deleted-${userId}@purged.local`);
    expect(after!.status).toBe("suspended");
  });

  test("frees the email address for a real re-registration", async () => {
    wipeAll();
    // The squatted-address bug: a typo'd/abandoned signup blocked the rightful
    // owner from ever registering that address again (409 forever).
    seedUnverifiedSignup("squatted@weddly.test");
    const dupe = await req("POST", "/api/auth/register", {
      email: "squatted@weddly.test",
      password: "supersafe123",
      full_name: "Real Owner",
    });
    expect(dupe.status).toBe(409);

    ageSignup("squatted@weddly.test");
    expect(purgeStaleUnverifiedSignups()).toBe(1);

    // The address is registerable again: the sweep renamed the tombstone, so
    // register gets past the users.email UNIQUE check and parks the signup.
    const retry = await req<{ pending: boolean; email: string }>("POST", "/api/auth/register", {
      email: "squatted@weddly.test",
      password: "supersafe123",
      full_name: "Real Owner",
    });
    expect(retry.status).toBe(202);
    expect(retry.data.pending).toBe(true);
    expect(retry.data.email).toBe("squatted@weddly.test");
  });

  test("spares a recent unverified signup", async () => {
    wipeAll();
    seedUnverifiedSignup("fresh@weddly.test");
    // Still inside the verify window — the link works, so the row must live.
    ageSignup("fresh@weddly.test", 1000 * 60 * 60 * 24 * 3);

    expect(purgeStaleUnverifiedSignups()).toBe(0);
    const row = db.prepare("SELECT email FROM users WHERE email = ?").get("fresh@weddly.test");
    expect(row).toBeDefined();
  });

  test("spares a verified user with no workspace", async () => {
    wipeAll();
    await register("verified-orphan@weddly.test");
    await verifyUserEmail("verified-orphan@weddly.test");
    const userId = ageSignup("verified-orphan@weddly.test");

    // These are real signups who never onboarded — re-engagement targets,
    // not junk. Age must never matter for them.
    expect(purgeStaleUnverifiedSignups()).toBe(0);
    expect(userById(userId)!.email).toBe("verified-orphan@weddly.test");
  });

  test("spares an admin-provisioned dormant planner (password_set = 0)", async () => {
    wipeAll();
    const ts = now() - UNVERIFIED_TTL_MS - 1000;
    // Mirrors planner_provisioning.ts: deliberately verified_email=0 +
    // password_set=0 until the planner activates. Reaping these would delete
    // accounts an admin just created.
    const result = db
      .prepare(
        `INSERT INTO users
           (email, password_hash, full_name, status, role, verified_email,
            password_set, user_type, created_at, updated_at)
         VALUES (?, '!placeholder!', 'Dormant Planner', 'active', 'owner', 0, 0, 'planner', ?, ?)`,
      )
      .run("dormant-planner@weddly.test", ts, ts);
    const userId = Number(result.lastInsertRowid);

    expect(purgeStaleUnverifiedSignups()).toBe(0);
    expect(userById(userId)!.email).toBe("dormant-planner@weddly.test");
  });

  test("spares an unverified vendor account", async () => {
    wipeAll();
    const ts = now() - UNVERIFIED_TTL_MS - 1000;
    // Vendors register unverified too (vendor_register.ts) but own a separate
    // lifecycle and may already carry a listing or claim.
    const result = db
      .prepare(
        `INSERT INTO users
           (email, password_hash, full_name, status, role, verified_email,
            password_set, created_at, updated_at)
         VALUES (?, '!hash!', 'Vendor', 'active', 'vendor', 0, 1, ?, ?)`,
      )
      .run("stale-vendor@weddly.test", ts, ts);
    const userId = Number(result.lastInsertRowid);

    expect(purgeStaleUnverifiedSignups()).toBe(0);
    expect(userById(userId)!.email).toBe("stale-vendor@weddly.test");
  });

  test("is idempotent — a purged tombstone is not re-reaped", async () => {
    wipeAll();
    seedUnverifiedSignup("idem@weddly.test");
    ageSignup("idem@weddly.test");

    expect(purgeStaleUnverifiedSignups()).toBe(1);
    // purge never resets verified_email, so without the suspended/@purged.local
    // guards the tombstone would match this query on every hourly tick.
    expect(purgeStaleUnverifiedSignups()).toBe(0);
  });
});
