// Admin email-list endpoint: aggregates every real contact across users,
// guests and the two waitlists, deduped by address. The one behaviour worth
// pinning is the exclusion of demo-seed rows: every demo owner/vendor/planner
// is minted under `%@demo.weddly.local`, and a throwaway "Try the demo" seed
// must never surface in an outreach export. Pairs with
// backend/src/routes/admin_email_list.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AdminEmailListResponse } from "@shared/types";
import { db, now } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  return reg.data.token;
}

/** Insert a bare user row directly — register can't mint a demo-addressed
 *  account, and we only need the row to exist for the collector to see it. */
function insertUser(email: string, role = "owner"): void {
  const ts = now();
  const name = email.split("@")[0] ?? email;
  db.prepare(
    `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
     VALUES (?, 'x', ?, 'active', ?, 1, ?, ?)`,
  ).run(email, name, role, ts, ts);
}

async function fetchList(token: string): Promise<AdminEmailListResponse> {
  const res = await req<AdminEmailListResponse>("GET", "/api/admin/email-list", undefined, {
    token,
  });
  expect(res.status).toBe(200);
  return res.data;
}

describe("admin email-list", () => {
  test("demo-seed addresses never appear in the list", async () => {
    wipeAll();
    const token = await bootstrapAdmin();

    insertUser("real-owner@example.com");
    insertUser("demo-48a15341e9c95fc2@demo.weddly.local");
    insertUser("demo-vendor@demo.weddly.local", "vendor");

    const list = await fetchList(token);
    const emails = list.entries.map((e) => e.email);

    expect(emails).toContain("real-owner@example.com");
    expect(emails).toContain("admin@test.test");
    expect(emails.some((e) => e.endsWith("@demo.weddly.local"))).toBe(false);
    expect(list.total).toBe(list.entries.length);
  });

  test("guests of a demo couple are excluded, real guests are kept", async () => {
    wipeAll();
    const token = await bootstrapAdmin();
    const real = await bootstrapCouple("host@example.com");
    const demo = await bootstrapCouple("demo-host@example.com");
    // The address stays real-looking on purpose: the row is filtered because
    // the WORKSPACE is a demo, not because the guest email says so.
    db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?").run(demo.coupleId);

    const ts = now();
    const addGuest = (coupleId: number, email: string) =>
      db
        .prepare(
          `INSERT INTO guests (couple_id, full_name, email, invite_code, rsvp_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(coupleId, email.split("@")[0] ?? email, email, `code-${email}`, ts, ts);

    addGuest(real.coupleId, "real-guest@example.com");
    addGuest(demo.coupleId, "guest-of-demo@example.com");

    const emails = (await fetchList(token)).entries.map((e) => e.email);
    expect(emails).toContain("real-guest@example.com");
    expect(emails).not.toContain("guest-of-demo@example.com");
  });

  test("requires an admin session", async () => {
    wipeAll();
    const nonAdmin = await registerAndVerify({
      email: "nobody@example.com",
      password: "supersafe123",
      full_name: "Nándor Kiss",
    });
    const res = await req("GET", "/api/admin/email-list", undefined, {
      token: nonAdmin.data.token,
    });
    expect(res.status).toBe(403);
  });
});
