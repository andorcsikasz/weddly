// 50-user audit probe: spins up a cohort of 50 independent couples and drives
// them through "special use cases" that ordinary per-feature tests skip — the
// cross-tenant / abuse / scale surfaces where weakpoints hide. Each describe
// block asserts the SECURE invariant; a failure here is a discovered weakpoint,
// not flake. Built on the shared harness (req / bootstrapCouple / wipeAll).
//
// Probes:
//   A. 50 concurrent registrations            — unique tokens, no collision
//   B. Cross-couple IDOR matrix               — couple A can't touch couple B
//   C. Money input abuse                      — negative / NaN / Infinity / float
//   D. Public RSVP cross-household forgery    — guest_id from another household
//   E. Invite-code uniqueness at scale        — 50 couples x bulk, no dup codes
//   F. Plus-one orphan on host delete         — no dangling plus_one_of pointer
//   G. Concurrent duplicate RSVP              — no double-insert of added_members
//   H. Stored-payload safety                  — XSS / unicode / huge names
//   I. Auth abuse                             — wrong password, user enumeration

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const COHORT = 50;

interface Couple {
  token: string;
  coupleId: number;
  email: string;
}

/** Build N fully-onboarded couples in parallel waves. The `req` helper spoofs a
 *  unique client IP per call, so concurrent registration doesn't share a
 *  rate-limit bucket — we can fan out safely. Waves keep the in-flight count
 *  bounded so the dev box isn't swamped. */
async function buildCohort(n: number, tag: string): Promise<Couple[]> {
  const couples: Couple[] = [];
  const WAVE = 10;
  for (let start = 0; start < n; start += WAVE) {
    const wave = await Promise.all(
      Array.from({ length: Math.min(WAVE, n - start) }, async (_, j) => {
        const email = `probe-${tag}-${start + j}@weddly.test`;
        const { token, coupleId } = await bootstrapCouple(email);
        return { token, coupleId, email };
      }),
    );
    couples.push(...wave);
  }
  return couples;
}

// Generous per-test timeout for the cohort-scale probes (50x register+verify+
// onboard plus the probe traffic). The default 5s is for unit-sized tests.
const COHORT_TIMEOUT = 60_000;

async function makeGuest(token: string, full_name: string, opts: Record<string, unknown> = {}) {
  const r = await req<{ guest: { id: number; invite_code: string } }>(
    "POST",
    "/api/guests",
    { full_name, ...opts },
    { token },
  );
  return r;
}

async function makeBudgetLine(token: string, planned_huf = 1000) {
  return req<{ line: { id: number } }>(
    "POST",
    "/api/budget/lines",
    { category: "other", label: "Probe", planned_huf },
    { token },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 50 concurrent registrations — unique tokens, no id/code collision.
// ─────────────────────────────────────────────────────────────────────────────

describe("A. concurrent registration at cohort scale", () => {
  test(
    "50 registrations all succeed with distinct tokens",
    async () => {
      wipeAll();
      const results = await Promise.all(
        Array.from({ length: COHORT }, (_, i) =>
          req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
            email: `conc-reg-${i}@weddly.test`,
            password: "supersafe123",
            full_name: `User ${i}`,
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      expect(ok.length).toBe(COHORT);
      const tokens = new Set(ok.map((r) => r.data.token));
      const ids = new Set(ok.map((r) => r.data.user.id));
      expect(tokens.size).toBe(COHORT);
      expect(ids.size).toBe(COHORT);
    },
    COHORT_TIMEOUT,
  );

  test("duplicate email registration is rejected (no second account)", async () => {
    wipeAll();
    const first = await req("POST", "/api/auth/register", {
      email: "dup@weddly.test",
      password: "supersafe123",
      full_name: "First",
    });
    expect(first.status).toBe(201);
    const second = await req("POST", "/api/auth/register", {
      email: "dup@weddly.test",
      password: "supersafe123",
      full_name: "Second",
    });
    expect(second.status).not.toBe(201);
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?")
      .get("dup@weddly.test") as {
      c: number;
    };
    expect(count.c).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Cross-couple IDOR matrix — the highest-value probe. Each couple owns a
//    guest + a budget line; the next couple in the ring tries to read, mutate,
//    and delete them. Every attempt MUST fail (non-2xx) and the row MUST be
//    untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe("B. cross-couple IDOR matrix (50 couples)", () => {
  test(
    "no couple can read/patch/delete another couple's guest or budget line",
    async () => {
      wipeAll();
      const couples = await buildCohort(COHORT, "idor");

      // Each couple gets one guest + one budget line.
      const owned = await Promise.all(
        couples.map(async (c) => {
          const g = await makeGuest(c.token, "Owned Guest");
          const b = await makeBudgetLine(c.token, 5000);
          expect(g.status).toBe(201);
          expect(b.status).toBe(201);
          return { guestId: g.data.guest.id, lineId: b.data.line.id };
        }),
      );

      const violations: string[] = [];
      for (let i = 0; i < couples.length; i++) {
        const attacker = couples[i]!;
        const victim = owned[(i + 1) % couples.length]!;

        // GET another couple's guest list never includes the victim's guest —
        // implicitly scoped, so just verify the mutate/delete by id.
        const patchGuest = await req(
          "PATCH",
          `/api/guests/${victim.guestId}`,
          { full_name: "HACKED" },
          { token: attacker.token },
        );
        if (patchGuest.status >= 200 && patchGuest.status < 300) {
          violations.push(
            `patch guest ${victim.guestId} by couple ${attacker.coupleId} → ${patchGuest.status}`,
          );
        }

        const delGuest = await req("DELETE", `/api/guests/${victim.guestId}`, undefined, {
          token: attacker.token,
        });
        if (delGuest.status >= 200 && delGuest.status < 300) {
          violations.push(
            `delete guest ${victim.guestId} by couple ${attacker.coupleId} → ${delGuest.status}`,
          );
        }

        const patchLine = await req(
          "PATCH",
          `/api/budget/lines/${victim.lineId}`,
          { actual_huf: 999999 },
          { token: attacker.token },
        );
        if (patchLine.status >= 200 && patchLine.status < 300) {
          violations.push(
            `patch line ${victim.lineId} by couple ${attacker.coupleId} → ${patchLine.status}`,
          );
        }

        const delLine = await req("DELETE", `/api/budget/lines/${victim.lineId}`, undefined, {
          token: attacker.token,
        });
        if (delLine.status >= 200 && delLine.status < 300) {
          violations.push(
            `delete line ${victim.lineId} by couple ${attacker.coupleId} → ${delLine.status}`,
          );
        }
      }

      // Every victim row must still exist and be unmodified.
      for (let i = 0; i < couples.length; i++) {
        const victim = owned[(i + 1) % couples.length]!;
        const g = db.prepare("SELECT full_name FROM guests WHERE id = ?").get(victim.guestId) as
          | { full_name: string }
          | undefined;
        expect(g?.full_name).toBe("Owned Guest");
        const b = db
          .prepare("SELECT actual_huf FROM budget_lines WHERE id = ?")
          .get(victim.lineId) as { actual_huf: number } | undefined;
        expect(b?.actual_huf).toBe(0);
      }

      expect(violations).toEqual([]);
    },
    COHORT_TIMEOUT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Money input abuse on the budget surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("C. money input abuse", () => {
  test("negative / NaN / Infinity / string money is rejected; float is rounded", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("money@weddly.test");

    const bad: unknown[] = [
      -1,
      -100000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1000",
      "abc",
      null,
      {},
    ];
    for (const v of bad) {
      const r = await req("POST", "/api/budget/lines", {
        category: "other",
        label: "Bad money",
        planned_huf: v,
      });
      // Unauthenticated guard would 401; ensure we send a token.
      const r2 = await req(
        "POST",
        "/api/budget/lines",
        { category: "other", label: "Bad money", planned_huf: v },
        { token },
      );
      expect(r2.status).not.toBe(201);
    }

    // Float must round, not store a float.
    const f = await req<{ line: { id: number; planned_huf: number } }>(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Floaty", planned_huf: 1234.7 },
      { token },
    );
    expect(f.status).toBe(201);
    expect(Number.isInteger(f.data.line.planned_huf)).toBe(true);
    expect(f.data.line.planned_huf).toBe(1235);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Public RSVP cross-household forgery — submit a guest_id that belongs to a
//    DIFFERENT household/couple. Must be rejected.
// ─────────────────────────────────────────────────────────────────────────────

describe("D. public RSVP cross-household forgery", () => {
  test("checkin rejects a guest_id outside the addressed household", async () => {
    wipeAll();
    const a = await bootstrapCouple("rsvp-a@weddly.test");
    const b = await bootstrapCouple("rsvp-b@weddly.test");

    const hhA = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "HH-A" },
      { token: a.token },
    );
    const guestA = await makeGuest(a.token, "Guest A", { household_id: hhA.data.household.id });

    // Couple B's guest in B's own household.
    const hhB = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "HH-B" },
      { token: b.token },
    );
    const guestB = await makeGuest(b.token, "Guest B", { household_id: hhB.data.household.id });

    const slugA = (
      await req<{ couple: { slug: string } }>("GET", "/api/couples/current", undefined, {
        token: a.token,
      })
    ).data.couple.slug;

    // Attacker addresses household A but tries to check in couple B's guest id.
    const res = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        couple_slug: slugA,
        household_code: hhA.data.household.code,
        members: [{ guest_id: guestB.data.guest.id, rsvp_status: "yes" }],
      }),
    });
    expect(res.status).toBe(400);

    // Couple B's guest is untouched (still pending).
    const row = db
      .prepare("SELECT rsvp_status FROM guests WHERE id = ?")
      .get(guestB.data.guest.id) as { rsvp_status: string };
    expect(row.rsvp_status).toBe("pending");
    // Sanity: legit member still works.
    const ok = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        couple_slug: slugA,
        household_code: hhA.data.household.code,
        members: [{ guest_id: guestA.data.guest.id, rsvp_status: "yes" }],
      }),
    });
    expect(ok.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Invite-code uniqueness across the whole cohort. 50 couples each bulk-add
//    40 guests = 2000 codes; every invite_code in the DB must be globally
//    unique (codes are the public RSVP key).
// ─────────────────────────────────────────────────────────────────────────────

describe("E. invite-code uniqueness at cohort scale", () => {
  test(
    "2000 guests across 50 couples → all invite codes unique",
    async () => {
      wipeAll();
      const couples = await buildCohort(COHORT, "codes");
      await Promise.all(
        couples.map((c) => {
          const guests = Array.from({ length: 40 }, (_, i) => ({
            full_name: `G ${i}`,
            group_tag: "other",
          }));
          return req("POST", "/api/guests/bulk", { guests }, { token: c.token });
        }),
      );
      const codes = db
        .prepare("SELECT invite_code FROM guests WHERE invite_code IS NOT NULL")
        .all() as {
        invite_code: string;
      }[];
      const seen = new Set(codes.map((c) => c.invite_code));
      expect(codes.length).toBeGreaterThanOrEqual(COHORT * 40);
      expect(seen.size).toBe(codes.length);
    },
    COHORT_TIMEOUT,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Plus-one orphan on host delete. Deleting a host must not leave a guest
//    whose plus_one_of points at a now-deleted row.
// ─────────────────────────────────────────────────────────────────────────────

describe("F. plus-one orphan on host delete", () => {
  test("deleting a host leaves no dangling plus_one_of pointer", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("orphan@weddly.test");
    const host = await makeGuest(token, "Host");
    const plus = await makeGuest(token, "Plus", { plus_one_of: host.data.guest.id });
    expect(plus.data.guest.id).toBeGreaterThan(0);

    const del = await req("DELETE", `/api/guests/${host.data.guest.id}`, undefined, { token });
    expect(del.status).toBe(200);

    // No surviving row may reference the deleted host.
    const dangling = db
      .prepare("SELECT id FROM guests WHERE plus_one_of = ?")
      .all(host.data.guest.id) as { id: number }[];
    expect(dangling).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Concurrent duplicate RSVP without an idempotency key — racing identical
//    submissions must not double-insert an added member.
// ─────────────────────────────────────────────────────────────────────────────

describe("G. concurrent duplicate RSVP", () => {
  test("two identical concurrent checkins add the plus-one only once", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("dupe-rsvp@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "HH" },
      { token },
    );
    const guest = await makeGuest(token, "Primary", { household_id: hh.data.household.id });
    const slug = (
      await req<{ couple: { slug: string } }>("GET", "/api/couples/current", undefined, { token })
    ).data.couple.slug;

    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.data.household.code,
      members: [{ guest_id: guest.data.guest.id, rsvp_status: "yes" }],
      added_members: [{ full_name: "RaceDupe", kind: "adult", rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json" };
    const [r1, r2] = await Promise.all([
      fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body }),
      fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body }),
    ]);
    expect([r1.status, r2.status].every((s) => s === 200)).toBe(true);

    const added = db.prepare("SELECT id FROM guests WHERE full_name = ?").all("RaceDupe") as {
      id: number;
    }[];
    // Exactly one inserted — the content-hash idempotency must collapse the race.
    expect(added.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Stored-payload safety — XSS / unicode / oversized names must be stored
//    without corrupting the row or crashing the read path. (Escaping is the
//    frontend's job; the API must round-trip safely or reject cleanly.)
// ─────────────────────────────────────────────────────────────────────────────

describe("H. stored-payload safety", () => {
  test("script payloads, emoji, and very long names are handled cleanly", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("payload@weddly.test");
    const payloads = [
      `<script>alert('xss')</script>`,
      `'; DROP TABLE guests;--`,
      `Zoé 🎉👰🏽‍♀️ Ünnep`,
      "A".repeat(5000),
      ` nullbyte`,
    ];
    for (const p of payloads) {
      const r = await makeGuest(token, p);
      // Either accepted (then round-trips) or cleanly rejected (4xx) — never 500.
      expect(r.status).toBeLessThan(500);
    }
    // The list endpoint must still work after all that.
    const list = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    expect(list.status).toBe(200);
    // Table still intact (SQL injection didn't drop it).
    const ok = db.prepare("SELECT COUNT(*) AS c FROM guests").get() as { c: number };
    expect(ok.c).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Auth abuse — wrong password is 401, and a wrong password vs unknown email
//    should not reveal which (user enumeration). Best-effort: both non-2xx.
// ─────────────────────────────────────────────────────────────────────────────

describe("I. auth abuse", () => {
  test("wrong password and unknown email both fail without 2xx", async () => {
    wipeAll();
    await bootstrapCouple("login@weddly.test");
    const wrongPw = await req("POST", "/api/auth/login", {
      email: "login@weddly.test",
      password: "WRONGwrongWRONG",
    });
    expect(wrongPw.status).toBeGreaterThanOrEqual(400);
    const unknown = await req("POST", "/api/auth/login", {
      email: "nobody-here@weddly.test",
      password: "whatever123",
    });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    // Enumeration check: same status code for both.
    expect(wrongPw.status).toBe(unknown.status);
  });
});
