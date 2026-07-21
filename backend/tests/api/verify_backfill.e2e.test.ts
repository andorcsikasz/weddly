// One-time cleanup that guarantees every account existing at deploy carries a
// verified email. Since the pending_signups split a couple can no longer be
// born unverified, so a verified_email = 0 couple row is always a legacy
// straggler. verifyExistingUnverifiedAccounts flips those, plus any already-
// registered unverified vendor, bounded to rows created before a cutoff so
// future registrations still verify the normal way.
//
// The exclusion cases are the important half of this suite: dormant provisioned
// planners and purged tombstones also carry verified_email = 0 and must survive.

import "../setup";

import { describe, expect, test } from "bun:test";
import { wipeAll } from "../helpers";
import { db, now } from "../../src/db";
import { verifyExistingUnverifiedAccounts } from "../../src/domain/verify_backfill";

type Seed = {
  email: string;
  role?: string;
  verified?: 0 | 1;
  password_set?: 0 | 1;
  user_type?: string | null;
  status?: string;
  createdAt?: number;
};

function seedUser(s: Seed): number {
  const ts = s.createdAt ?? now();
  const result = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email,
          password_set, user_type, created_at, updated_at)
       VALUES (?, '!hash!', 'Seed', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.email,
      s.status ?? "active",
      s.role ?? "owner",
      s.verified ?? 0,
      s.password_set ?? 1,
      s.user_type ?? "couple",
      ts,
      ts,
    );
  return Number(result.lastInsertRowid);
}

function isVerified(email: string): boolean {
  const row = db.prepare("SELECT verified_email FROM users WHERE email = ?").get(email) as
    | { verified_email: number }
    | undefined;
  expect(row).toBeDefined();
  return Boolean(row!.verified_email);
}

describe("verify-existing backfill", () => {
  // A cutoff far ahead: every normally-created fixture row qualifies as "exists
  // today". The created-after-cutoff exclusion is tested separately.
  const FUTURE = now() + 1000 * 60 * 60 * 24 * 365;

  test("verifies a legacy unverified couple", () => {
    wipeAll();
    seedUser({ email: "legacy-couple@weddly.test", user_type: "couple" });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(1);
    expect(isVerified("legacy-couple@weddly.test")).toBe(true);
  });

  test("verifies an unverified vendor (all account types)", () => {
    wipeAll();
    // Vendors register unverified (vendor_register.ts). The chosen scope is
    // "all account types", so an existing unverified vendor is flipped too.
    seedUser({ email: "legacy-vendor@weddly.test", role: "vendor", user_type: null });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(1);
    expect(isVerified("legacy-vendor@weddly.test")).toBe(true);
  });

  test("spares an admin-provisioned dormant planner (password_set = 0)", () => {
    wipeAll();
    // Mirrors planner_provisioning.ts: deliberately verified_email=0 +
    // password_set=0 until the planner activates. Verifying would break setup.
    seedUser({ email: "dormant-planner@weddly.test", user_type: "planner", password_set: 0 });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(0);
    expect(isVerified("dormant-planner@weddly.test")).toBe(false);
  });

  test("spares a purged tombstone", () => {
    wipeAll();
    // A purge scrubs the address to @purged.local but never resets
    // verified_email, so without the guard it would re-match forever.
    seedUser({ email: "deleted-999@purged.local", status: "suspended" });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(0);
    expect(isVerified("deleted-999@purged.local")).toBe(false);
  });

  test("spares a registration created after the cutoff", () => {
    wipeAll();
    const cutoff = now();
    // A brand-new vendor registering after the fix must still prove its address,
    // otherwise the next boot would auto-verify every future signup.
    seedUser({ email: "future-vendor@weddly.test", role: "vendor", createdAt: cutoff + 60_000 });

    expect(verifyExistingUnverifiedAccounts(cutoff)).toBe(0);
    expect(isVerified("future-vendor@weddly.test")).toBe(false);
  });

  test("leaves an already-verified account untouched", () => {
    wipeAll();
    seedUser({ email: "already@weddly.test", verified: 1 });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(0);
    expect(isVerified("already@weddly.test")).toBe(true);
  });

  test("is idempotent — a second run flips nothing", () => {
    wipeAll();
    seedUser({ email: "idem@weddly.test" });

    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(1);
    expect(verifyExistingUnverifiedAccounts(FUTURE)).toBe(0);
  });
});
