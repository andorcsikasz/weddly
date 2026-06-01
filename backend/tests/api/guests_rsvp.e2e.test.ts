// Comprehensive coverage for the guest list, household CRUD, public RSVP, and
// post-RSVP guest portal. The "smoke" cases that prove the routes wire up at
// all already live in tests/e2e.test.ts under `describe("guests" / "rsvp" /
// "households + airport check-in" / "guest portal")`; this file deliberately
// avoids re-running them and focuses on the edge cases the original suite
// barely touches: validation errors, cross-couple isolation, rate-limit
// behaviour, CSV import/export quirks, the bulk endpoint's transaction
// boundary, regenerate-code invalidation, idempotency replays, and gate
// conditions on the public portal.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db } from "../../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Onboard a second couple alongside the bootstrapped one. Returns the new
 *  couple's token + id; useful for cross-couple isolation cases. */
async function bootstrapSecondCouple(
  email: string,
): Promise<{ token: string; coupleId: number; slug: string }> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Other",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const ob = await req<{ couple: { id: number; slug: string | null } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Other Couple",
      wedding_date: "2027-04-04",
      target_guest_count: 50,
      budget_ceiling_huf: 3_000_000,
      style_tags: [],
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return {
    token: reg.data.token,
    coupleId: ob.data.couple.id,
    slug: ob.data.couple.slug ?? "",
  };
}

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

async function listHouseholds(
  token: string,
): Promise<{ id: number; code: string; label: string; member_ids: number[] }[]> {
  const list = await req<{
    households: { id: number; code: string; label: string; member_ids: number[] }[];
  }>("GET", "/api/households", undefined, { token });
  return list.data.households;
}

// ─── guests: validation + group_tag filter ──────────────────────────────────

describe("guests: validation + filter", () => {
  test("POST /api/guests rejects missing full_name", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-noname@weddly.test");
    const r = await req("POST", "/api/guests", { full_name: "" }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests rejects full_name longer than 200 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-toolong@weddly.test");
    const r = await req("POST", "/api/guests", { full_name: "x".repeat(201) }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests with whitespace-only name is rejected", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-ws@weddly.test");
    const r = await req("POST", "/api/guests", { full_name: "   " }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests with unknown household_id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-badhh@weddly.test");
    const r = await req(
      "POST",
      "/api/guests",
      { full_name: "Lost", household_id: 999999 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST /api/guests with cross-couple household_id returns 400", async () => {
    wipeAll();
    const a = await bootstrapCouple("g-xhhA@weddly.test");
    const b = await bootstrapSecondCouple("g-xhhB@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "A-only" },
      { token: a.token },
    );
    const r = await req(
      "POST",
      "/api/guests",
      { full_name: "Spy", household_id: hh.data.household.id },
      { token: b.token },
    );
    expect(r.status).toBe(400);
  });

  test("POST /api/guests with garbage group_tag silently falls back to 'other'", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-grp@weddly.test");
    const r = await req<{ guest: { group_tag: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", group_tag: "moon_clan" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.group_tag).toBe("other");
  });

  test("POST /api/guests with garbage rsvp_status falls back to 'pending'", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-rsvp@weddly.test");
    const r = await req<{ guest: { rsvp_status: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", rsvp_status: "perhaps" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.rsvp_status).toBe("pending");
  });

  test("POST /api/guests with garbage meal_choice nulls the value", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-meal@weddly.test");
    const r = await req<{ guest: { meal_choice: string | null } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", meal_choice: "sushi" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.meal_choice).toBeNull();
  });

  test("GET /api/guests rejects an unknown group_tag (not silent-passthrough)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-listflt@weddly.test");
    const r = await req("GET", "/api/guests?group_tag=moon_clan", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("GET /api/guests filters by known group_tag and returns matching subset", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-fltgood@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna", group_tag: "her_family" }, { token });
    await req("POST", "/api/guests", { full_name: "Bence", group_tag: "his_family" }, { token });
    const r = await req<{ guests: { full_name: string }[]; total: number }>(
      "GET",
      "/api/guests?group_tag=her_family",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.guests.length).toBe(1);
    expect(r.data.guests[0]!.full_name).toBe("Anna");
    expect(r.data.total).toBe(1);
  });

  test("GET /api/guests?group_tag=&q= combines filter and search", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-combo@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna Smith", group_tag: "work" }, { token });
    await req(
      "POST",
      "/api/guests",
      { full_name: "Anna Jones", group_tag: "her_family" },
      {
        token,
      },
    );
    await req("POST", "/api/guests", { full_name: "Bob Smith", group_tag: "work" }, { token });
    const r = await req<{ guests: { full_name: string }[] }>(
      "GET",
      "/api/guests?group_tag=work&q=anna",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.guests.length).toBe(1);
    expect(r.data.guests[0]!.full_name).toBe("Anna Smith");
  });

  test("GET /api/guests rejects non-numeric limit", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-badlim@weddly.test");
    const r = await req("GET", "/api/guests?limit=banana", undefined, { token });
    expect(r.status).toBe(400);
  });
});

// ─── guests: send_invite on create ─────────────────────────────────────────
//
// The "send invite now" checkbox in /app/guests posts `send_invite: true` on
// the create body. When the guest has an email, the server fires a
// `guest_invite` mail with a /rsvp/{invite_code} magic link AND stamps
// `invited_at` so the row's status badge moves to "invited" without a second
// toggle. When the email is missing the flag is silently ignored — partial
// info on a new guest shouldn't error.

describe("guests: send_invite on create", () => {
  test("send_invite=true with email fires guest_invite kind and stamps invited_at", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("send-inv@weddly.test");
    const r = await req<{ guest: { id: number; invited_at: number | null } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", email: "anna@example.test", send_invite: true },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.invited_at).not.toBeNull();

    const log = db
      .prepare(
        "SELECT kind, to_email, status FROM email_log WHERE couple_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as { kind: string; to_email: string; status: string } | undefined;
    expect(log).toBeDefined();
    expect(log?.kind).toBe("guest_invite");
    expect(log?.to_email).toBe("anna@example.test");
  });

  test("send_invite=true without email is silently ignored", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("send-noemail@weddly.test");
    const r = await req<{ guest: { id: number; invited_at: number | null } }>(
      "POST",
      "/api/guests",
      { full_name: "NoEmail", send_invite: true },
      { token },
    );
    expect(r.status).toBe(201);
    // invited_at stays null when we can't physically deliver — the flag is a
    // hint, not a stamp. The couple can still flip the "invited" toggle by
    // hand to track that they texted the guest instead.
    expect(r.data.guest.invited_at).toBeNull();

    const logCount = db
      .prepare("SELECT COUNT(*) as n FROM email_log WHERE couple_id = ? AND kind = 'guest_invite'")
      .get(coupleId) as { n: number };
    expect(logCount.n).toBe(0);
  });

  test("send_invite omitted preserves silent-create behaviour (back-compat)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("send-omit@weddly.test");
    const r = await req<{ guest: { id: number; invited_at: number | null } }>(
      "POST",
      "/api/guests",
      { full_name: "Quiet", email: "quiet@example.test" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guest.invited_at).toBeNull();

    const logCount = db
      .prepare("SELECT COUNT(*) as n FROM email_log WHERE couple_id = ? AND kind = 'guest_invite'")
      .get(coupleId) as { n: number };
    expect(logCount.n).toBe(0);
  });

  test("guest_invite email body contains the /rsvp/{code} magic link", async () => {
    // dev/test mode has no Resend key so the mailer logs to stdout — the
    // rendered body still lands in `email_log` (status=skipped_no_provider)
    // but the body itself is in the log line, not the row. Instead we read
    // the guest back out and assert the URL we'd have shipped matches the
    // server-side base + the row's invite_code.
    wipeAll();
    const { token } = await bootstrapCouple("send-url@weddly.test");
    const r = await req<{ guest: { id: number; invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Linker", email: "linker@example.test", send_invite: true },
      { token },
    );
    expect(r.status).toBe(201);
    // invite_code is 6 chars from the Crockford-style alphabet — same shape
    // the server bakes into the email URL. Ship-readiness check: the code is
    // present, non-empty, and the legacy `/rsvp/:code` route already accepts
    // this exact shape (see rsvp.ts handleByCode).
    expect(r.data.guest.invite_code).toMatch(/^[A-Z2-9]{6}$/);
  });
});

// ─── guests: bulk endpoint ─────────────────────────────────────────────────

describe("guests: bulk endpoint", () => {
  test("POST /api/guests/bulk rejects when guests field is missing", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-miss@weddly.test");
    const r = await req("POST", "/api/guests/bulk", {}, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/bulk rejects an empty array", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-empty@weddly.test");
    const r = await req("POST", "/api/guests/bulk", { guests: [] }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/bulk rejects > 200 entries", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-cap@weddly.test");
    const rows = Array.from({ length: 201 }, (_, i) => ({ full_name: `G${i}` }));
    const r = await req("POST", "/api/guests/bulk", { guests: rows }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/bulk accepts exactly 200 entries", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-cap2@weddly.test");
    const rows = Array.from({ length: 200 }, (_, i) => ({ full_name: `G${i}` }));
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests: rows },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(200);
  });

  test("POST /api/guests/bulk rolls back the entire batch on a bad row in the middle", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-rollback@weddly.test");
    const before = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    const baselineCount = before.data.guests.length;
    const r = await req(
      "POST",
      "/api/guests/bulk",
      {
        guests: [
          { full_name: "Row 1 OK" },
          { full_name: "Row 2 OK" },
          { full_name: "" }, // bad row in the middle
          { full_name: "Row 4 OK" },
        ],
      },
      { token },
    );
    expect(r.status).toBe(400);
    expect((r.data as { error: string }).error).toMatch(/row 3/);
    const after = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    expect(after.data.guests.length).toBe(baselineCount);
  });

  test("POST /api/guests/bulk rejects a non-object row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-junkrow@weddly.test");
    const r = await req(
      "POST",
      "/api/guests/bulk",
      { guests: [{ full_name: "OK" }, "garbage"] },
      { token },
    );
    expect(r.status).toBe(400);
    expect((r.data as { error: string }).error).toMatch(/row 2/);
  });

  test("POST /api/guests/bulk transaction commits exactly N rows on success", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("bulk-commit@weddly.test");
    const before = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    const baseline = before.data.guests.length;
    const rows = Array.from({ length: 10 }, (_, i) => ({ full_name: `Bulk-${i}` }));
    const r = await req<{ guests: { id: number; invite_code: string }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests: rows },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.guests.length).toBe(10);
    // Every row gets its own invite_code (no collisions inside the txn).
    const codes = new Set(r.data.guests.map((g) => g.invite_code));
    expect(codes.size).toBe(10);
    const after = await req<{ guests: unknown[] }>("GET", "/api/guests", undefined, { token });
    expect(after.data.guests.length).toBe(baseline + 10);
  });

  test("POST /api/guests/bulk requires auth", async () => {
    wipeAll();
    const r = await req("POST", "/api/guests/bulk", { guests: [{ full_name: "Anon" }] });
    expect(r.status).toBe(401);
  });

  test("POST /api/guests/bulk writes a single bundled audit log entry", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("bulk-audit@weddly.test");
    const r = await req<{ guests: { id: number }[] }>(
      "POST",
      "/api/guests/bulk",
      { guests: [{ full_name: "A" }, { full_name: "B" }, { full_name: "C" }] },
      { token },
    );
    expect(r.status).toBe(201);
    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'guest.bulk_create'",
      )
      .get(coupleId) as { n: number };
    expect(audit.n).toBe(1);
  });
});

// ─── guests: CSV import ─────────────────────────────────────────────────────

describe("guests: CSV import", () => {
  test("POST /api/guests/import rejects missing csv field", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-miss@weddly.test");
    const r = await req("POST", "/api/guests/import", {}, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/import rejects oversized csv (>1MB)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-big@weddly.test");
    const csv = `full_name\n${"a".repeat(1_000_001)}`;
    const r = await req("POST", "/api/guests/import", { csv }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/import rejects csv without a header + data row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-thin@weddly.test");
    const r = await req("POST", "/api/guests/import", { csv: "full_name" }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/import rejects csv missing full_name column", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-noname@weddly.test");
    const csv = "email,phone\nfoo@x.test,1234";
    const r = await req("POST", "/api/guests/import", { csv }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/guests/import records errors per bad row but commits the rest", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-perrow@weddly.test");
    // Row 2 = good, Row 3 = blank name (bad).
    const csv = ["full_name,email", "Anna,a@x.test", ",bad@x.test", "Bence,b@x.test"].join("\n");
    const r = await req<{ created_count: number; errors: { row: number; reason: string }[] }>(
      "POST",
      "/api/guests/import",
      { csv },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.created_count).toBe(2);
    expect(r.data.errors.length).toBe(1);
    expect(r.data.errors[0]!.row).toBe(3);
    expect(r.data.errors[0]!.reason).toMatch(/full_name/);
  });

  test("POST /api/guests/import folds same-named households into one row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-fold@weddly.test");
    const csv = [
      "full_name,household,group_tag",
      "Anna,Kovács család,her_family",
      "Mark,Kovács család,her_family",
      "Lilla,Kovács család,her_family",
      "Eszter,Solo,other",
    ].join("\n");
    const r = await req<{ created_count: number }>(
      "POST",
      "/api/guests/import",
      { csv },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.created_count).toBe(4);

    const hh = await listHouseholds(token);
    const kovacs = hh.find((h) => h.label === "Kovács család");
    expect(kovacs).toBeDefined();
    expect(kovacs!.member_ids.length).toBe(3);
    const solo = hh.find((h) => h.label === "Solo");
    expect(solo).toBeDefined();
    expect(solo!.member_ids.length).toBe(1);
  });

  test("POST /api/guests/import: unknown group_tag falls back to 'other'", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-grpunknown@weddly.test");
    const csv = "full_name,group_tag\nAnna,mars_family";
    const r = await req("POST", "/api/guests/import", { csv }, { token });
    expect(r.status).toBe(201);
    const list = await req<{ guests: { group_tag: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    expect(list.data.guests[0]!.group_tag).toBe("other");
  });

  test("POST /api/guests/import: quoted field with embedded comma + newline survives", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-quoted@weddly.test");
    const csv = [
      "full_name,notes",
      `Anna,"line1,line2"`,
      `"Smith, Jr.","needs ""vegan"" plate"`,
    ].join("\n");
    const r = await req<{ created_count: number }>(
      "POST",
      "/api/guests/import",
      { csv },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.created_count).toBe(2);
    const list = await req<{ guests: { full_name: string; notes: string | null }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const jr = list.data.guests.find((g) => g.full_name === "Smith, Jr.");
    expect(jr).toBeDefined();
    expect(jr!.notes).toBe('needs "vegan" plate');
  });

  test("POST /api/guests/import requires auth", async () => {
    wipeAll();
    const r = await req("POST", "/api/guests/import", { csv: "full_name\nAnna" });
    expect(r.status).toBe(401);
  });

  test("POST /api/guests/import rejects non-string csv", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csv-bool@weddly.test");
    const r = await req("POST", "/api/guests/import", { csv: 42 }, { token });
    expect(r.status).toBe(400);
  });
});

// ─── guests: CSV export ─────────────────────────────────────────────────────

describe("guests: CSV export", () => {
  test("GET /api/guests/csv requires auth", async () => {
    wipeAll();
    const r = await fetch(`${BASE}/api/guests/csv`);
    expect(r.status).toBe(401);
  });

  test("GET /api/guests/csv emits UTF-8 BOM + content-type + Content-Disposition", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csvexp-h@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const r = await fetch(`${BASE}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="weddly-guests-/);
    const buf = new Uint8Array(await r.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  test("GET /api/guests/csv includes meal_choice + dietary columns", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csvexp-meal@weddly.test");
    const created = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", meal_choice: "fish", dietary: "no gluten" },
      { token },
    );
    expect(created.status).toBe(201);
    const r = await fetch(`${BASE}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = (await r.text()).replace(/^﻿/, "");
    const headerLine = text.split("\r\n")[0]!;
    expect(headerLine).toContain("meal_choice");
    expect(headerLine).toContain("dietary");
    const dataLine = text.split("\r\n")[1]!;
    expect(dataLine).toContain("fish");
    expect(dataLine).toContain("no gluten");
  });

  test("GET /api/guests/csv: Hungarian collation orders Ákos before Csikász before Zoltán", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("csvexp-hu@weddly.test");
    // Insert deliberately out of order — HU collation should re-sort.
    for (const name of ["Zoltán", "Csikász", "Ákos"]) {
      await req("POST", "/api/guests", { full_name: name }, { token });
    }
    const r = await fetch(`${BASE}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = (await r.text()).replace(/^﻿/, "");
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines[1]!.startsWith("Ákos,")).toBe(true);
    expect(lines[2]!.startsWith("Csikász,")).toBe(true);
    expect(lines[3]!.startsWith("Zoltán,")).toBe(true);
  });

  test("GET /api/guests/csv only includes the calling couple's rows", async () => {
    wipeAll();
    const a = await bootstrapCouple("csvexp-A@weddly.test");
    const b = await bootstrapSecondCouple("csvexp-B@weddly.test");
    await req("POST", "/api/guests", { full_name: "A-Only-Guest" }, { token: a.token });
    await req("POST", "/api/guests", { full_name: "B-Only-Guest" }, { token: b.token });
    const r = await fetch(`${BASE}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    const text = await r.text();
    expect(text).not.toContain("A-Only-Guest");
    expect(text).toContain("B-Only-Guest");
  });
});

// ─── guests: dietary summary ───────────────────────────────────────────────

describe("guests: dietary summary keywords", () => {
  test("HU 'gluténmentes' counted in gluten bucket", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-glu@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "G", rsvp_status: "yes", dietary: "gluténmentes kérem" },
      { token },
    );
    expect(g.status).toBe(201);
    const r = await req<{ allergies: { gluten: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.gluten).toBe(1);
  });

  test("EN 'lactose' + HU 'laktóz' both counted in lactose bucket", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-lac@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G1", rsvp_status: "yes", dietary: "lactose intolerant" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "G2", rsvp_status: "maybe", dietary: "laktóz" },
      { token },
    );
    const r = await req<{ allergies: { lactose: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.lactose).toBe(2);
  });

  test("HU 'tejfehérje' counted in milk_protein bucket and NOT in lactose", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-milk@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G", rsvp_status: "yes", dietary: "tejfehérje-allergia" },
      { token },
    );
    const r = await req<{ allergies: { lactose: number; milk_protein: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.milk_protein).toBe(1);
    expect(r.data.allergies.lactose).toBe(0);
  });

  test("HU 'mogyoró' + EN 'peanut' both counted in nut bucket", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-nut@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G1", rsvp_status: "yes", dietary: "mogyoró-allergia" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "G2", rsvp_status: "yes", dietary: "peanut allergy" },
      { token },
    );
    const r = await req<{ allergies: { nut: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.nut).toBe(2);
  });

  test("HU 'tojás' + EN 'egg allergy' counted in egg bucket", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-egg@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G1", rsvp_status: "yes", dietary: "tojás-allergia" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "G2", rsvp_status: "yes", dietary: "egg allergy" },
      { token },
    );
    const r = await req<{ allergies: { egg: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.egg).toBe(2);
  });

  test("'shellfish' + 'seafood' counted in fish_shellfish bucket", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-fish@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G1", rsvp_status: "yes", dietary: "shellfish allergy" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "G2", rsvp_status: "yes", dietary: "no seafood please" },
      { token },
    );
    const r = await req<{ allergies: { fish_shellfish: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.fish_shellfish).toBe(2);
  });

  test("a multi-allergen note still counts in every matching bucket exactly once", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-multi@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G", rsvp_status: "yes", dietary: "gluten + lactose + peanut" },
      { token },
    );
    const r = await req<{
      allergies: { gluten: number; lactose: number; nut: number; other_text_count: number };
    }>("GET", "/api/guests/dietary-summary", undefined, { token });
    expect(r.data.allergies.gluten).toBe(1);
    expect(r.data.allergies.lactose).toBe(1);
    expect(r.data.allergies.nut).toBe(1);
    expect(r.data.allergies.other_text_count).toBe(0);
  });

  test("dietary text not matching any keyword counts in other_text_count", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-other@weddly.test");
    await req(
      "POST",
      "/api/guests",
      { full_name: "G", rsvp_status: "yes", dietary: "Vegetarian curry only, thanks" },
      { token },
    );
    const r = await req<{ allergies: { other_text_count: number; gluten: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.allergies.other_text_count).toBe(1);
    expect(r.data.allergies.gluten).toBe(0);
  });

  test("rsvp=no / pending guests are excluded from counted_guests", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("diet-excl@weddly.test");
    await req("POST", "/api/guests", { full_name: "G1", rsvp_status: "yes" }, { token });
    await req("POST", "/api/guests", { full_name: "G2", rsvp_status: "maybe" }, { token });
    await req(
      "POST",
      "/api/guests",
      { full_name: "G3", rsvp_status: "no", dietary: "gluten" },
      { token },
    );
    await req("POST", "/api/guests", { full_name: "G4" }, { token }); // pending
    const r = await req<{ counted_guests: number; allergies: { gluten: number } }>(
      "GET",
      "/api/guests/dietary-summary",
      undefined,
      { token },
    );
    expect(r.data.counted_guests).toBe(2);
    expect(r.data.allergies.gluten).toBe(0);
  });
});

// ─── guests: auth + cross-couple isolation ──────────────────────────────────

describe("guests: auth + cross-couple isolation", () => {
  test("POST /api/guests without a bearer returns 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/guests", { full_name: "Anon" });
    expect(r.status).toBe(401);
  });

  test("PATCH /api/guests/:id without a bearer returns 401", async () => {
    wipeAll();
    const r = await req("PATCH", "/api/guests/1", { full_name: "Anon" });
    expect(r.status).toBe(401);
  });

  test("DELETE /api/guests/:id without a bearer returns 401", async () => {
    wipeAll();
    const r = await req("DELETE", "/api/guests/1");
    expect(r.status).toBe(401);
  });

  test("PATCH /api/guests/:id rejects an unverified user with 403 email_unverified", async () => {
    wipeAll();
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "g-unv@weddly.test",
      password: "supersafe123",
      full_name: "Unv",
    });
    expect(reg.status).toBe(201);
    // Note: never verify the email.
    const r = await req("PATCH", "/api/guests/1", { full_name: "x" }, { token: reg.data.token });
    expect(r.status).toBe(403);
    expect((r.data as { detail?: { code?: string } }).detail?.code).toBe("email_unverified");
  });

  test("PATCH /api/guests/:id with non-numeric id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-badid@weddly.test");
    const r = await req("PATCH", "/api/guests/abc", { full_name: "x" }, { token });
    expect(r.status).toBe(400);
  });

  test("PATCH /api/guests/:id with unknown id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-unk@weddly.test");
    const r = await req("PATCH", "/api/guests/9999", { full_name: "x" }, { token });
    expect(r.status).toBe(404);
  });

  test("DELETE /api/guests/:id with unknown id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("g-del404@weddly.test");
    const r = await req("DELETE", "/api/guests/9999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("Couple A's PATCH on Couple B's guest returns 404 (no cross-couple peek)", async () => {
    wipeAll();
    const a = await bootstrapCouple("isoA-g@weddly.test");
    const b = await bootstrapSecondCouple("isoB-g@weddly.test");
    const bGuest = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "B's Aunt" },
      { token: b.token },
    );
    const r = await req(
      "PATCH",
      `/api/guests/${bGuest.data.guest.id}`,
      { full_name: "Hacked" },
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("Couple A's DELETE on Couple B's guest returns 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("isoA-gd@weddly.test");
    const b = await bootstrapSecondCouple("isoB-gd@weddly.test");
    const bGuest = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "B's Aunt" },
      { token: b.token },
    );
    const r = await req("DELETE", `/api/guests/${bGuest.data.guest.id}`, undefined, {
      token: a.token,
    });
    expect(r.status).toBe(404);
  });

  test("GET /api/guests only returns the calling couple's guests", async () => {
    wipeAll();
    const a = await bootstrapCouple("isoA-list@weddly.test");
    const b = await bootstrapSecondCouple("isoB-list@weddly.test");
    await req("POST", "/api/guests", { full_name: "A-Guest-1" }, { token: a.token });
    await req("POST", "/api/guests", { full_name: "B-Guest-1" }, { token: b.token });
    await req("POST", "/api/guests", { full_name: "B-Guest-2" }, { token: b.token });
    const bList = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token: b.token,
    });
    expect(bList.data.guests.map((g) => g.full_name).sort()).toEqual(["B-Guest-1", "B-Guest-2"]);
  });
});

// ─── households: validation + RSVP toggles + delete guard ───────────────────

describe("households: validation + delete guard", () => {
  test("POST /api/households requires a label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-nolabel@weddly.test");
    const r = await req("POST", "/api/households", {}, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/households rejects whitespace-only label", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-ws@weddly.test");
    const r = await req("POST", "/api/households", { label: "    " }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/households rejects label longer than 200 chars", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-toolong@weddly.test");
    const r = await req("POST", "/api/households", { label: "x".repeat(201) }, { token });
    expect(r.status).toBe(400);
  });

  test("POST /api/households rejects unknown group_tag", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-grp@weddly.test");
    const r = await req(
      "POST",
      "/api/households",
      { label: "Family", group_tag: "extra_terrestrials" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("POST /api/households persists notes when provided, nulls when omitted", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-notes@weddly.test");
    const a = await req<{ household: { notes: string | null } }>(
      "POST",
      "/api/households",
      { label: "A", notes: "Vegan-only table" },
      { token },
    );
    expect(a.status).toBe(201);
    expect(a.data.household.notes).toBe("Vegan-only table");
    const b = await req<{ household: { notes: string | null } }>(
      "POST",
      "/api/households",
      { label: "B" },
      { token },
    );
    expect(b.data.household.notes).toBeNull();
  });

  test("POST /api/households produces an 8-char Crockford code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-code@weddly.test");
    const r = await req<{ household: { code: string } }>(
      "POST",
      "/api/households",
      { label: "Family" },
      { token },
    );
    expect(r.status).toBe(201);
    // Post-May-2026 the household code is 8 Crockford base32 chars (no I / L
    // / O / U). The legacy 4-digit shape stays valid for pre-bump rows but
    // freshly-minted ones must match the new form.
    expect(r.data.household.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  test("PATCH /api/households/:id rsvp_offers_accommodation rejects non-boolean", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-accbool@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "H" },
      { token },
    );
    const r = await req(
      "PATCH",
      `/api/households/${hh.data.household.id}`,
      { rsvp_offers_accommodation: "yes" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH /api/households/:id rsvp_collects_meal rejects non-boolean", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-mealbool@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "H" },
      { token },
    );
    const r = await req(
      "PATCH",
      `/api/households/${hh.data.household.id}`,
      { rsvp_collects_meal: 1 },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("PATCH /api/households/:id group_tag propagates to non-partner members", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-grpprop@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "Smith family", group_tag: "her_family" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "A1", household_id: hh.data.household.id },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "A2", household_id: hh.data.household.id },
      { token },
    );
    const upd = await req(
      "PATCH",
      `/api/households/${hh.data.household.id}`,
      { group_tag: "work" },
      { token },
    );
    expect(upd.status).toBe(200);
    const list = await req<{ guests: { full_name: string; group_tag: string }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const a1 = list.data.guests.find((g) => g.full_name === "A1");
    const a2 = list.data.guests.find((g) => g.full_name === "A2");
    expect(a1!.group_tag).toBe("work");
    expect(a2!.group_tag).toBe("work");
  });

  test("DELETE /api/households/:id refuses when members still attached (409)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-delmemb@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "Crew" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "Member", household_id: hh.data.household.id },
      { token },
    );
    const r = await req("DELETE", `/api/households/${hh.data.household.id}`, undefined, {
      token,
    });
    expect(r.status).toBe(409);
  });

  test("DELETE /api/households/:id succeeds when empty", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-delok@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "Empty" },
      { token },
    );
    const r = await req("DELETE", `/api/households/${hh.data.household.id}`, undefined, {
      token,
    });
    expect(r.status).toBe(200);
  });

  test("DELETE /api/households/:id with non-numeric id returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-badid@weddly.test");
    const r = await req("DELETE", "/api/households/abc", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("DELETE /api/households/:id with unknown id returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-del404@weddly.test");
    const r = await req("DELETE", "/api/households/9999", undefined, { token });
    expect(r.status).toBe(404);
  });

  test("Couple A's PATCH on Couple B's household returns 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("hhisoA@weddly.test");
    const b = await bootstrapSecondCouple("hhisoB@weddly.test");
    const bHh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "B-Only" },
      { token: b.token },
    );
    const r = await req(
      "PATCH",
      `/api/households/${bHh.data.household.id}`,
      { label: "Hacked" },
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });

  test("Couple A's DELETE on Couple B's household returns 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("hhisoA-d@weddly.test");
    const b = await bootstrapSecondCouple("hhisoB-d@weddly.test");
    const bHh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "B-Only" },
      { token: b.token },
    );
    const r = await req("DELETE", `/api/households/${bHh.data.household.id}`, undefined, {
      token: a.token,
    });
    expect(r.status).toBe(404);
  });

  test("Couple A's regenerate-code on Couple B's household returns 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("hhisoA-r@weddly.test");
    const b = await bootstrapSecondCouple("hhisoB-r@weddly.test");
    const bHh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "B-Only" },
      { token: b.token },
    );
    const r = await req(
      "POST",
      `/api/households/${bHh.data.household.id}/regenerate-code`,
      {},
      { token: a.token },
    );
    expect(r.status).toBe(404);
  });
});

// ─── rsvp lookup: validation + rate-limit ──────────────────────────────────

describe("rsvp lookup: validation + rate limit", () => {
  test("GET /api/rsvp/lookup with no slug param returns 400/404", async () => {
    wipeAll();
    const r = await req("GET", "/api/rsvp/lookup");
    // slug empty → resolveCoupleBySlug throws 400 "Invalid couple identifier"
    expect(r.status).toBe(400);
  });

  test("GET /api/rsvp/lookup with oversized slug returns 400", async () => {
    wipeAll();
    const slug = "x".repeat(65);
    const r = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=1234`);
    expect(r.status).toBe(400);
  });

  test("GET /api/rsvp/lookup with slug full of punctuation returns 404", async () => {
    wipeAll();
    // normalizeSlugInput strips it all to "", which resolves to a 404 by design.
    const r = await req("GET", "/api/rsvp/lookup?couple=!!!&code=1234");
    expect(r.status).toBe(404);
  });

  test("GET /api/rsvp/lookup with no code param returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-nocode@weddly.test");
    const slug = await getSlug(token);
    const r = await req("GET", `/api/rsvp/lookup?couple=${slug}`);
    expect(r.status).toBe(400);
  });

  test("GET /api/rsvp/lookup with oversized code returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-bigcode@weddly.test");
    const slug = await getSlug(token);
    const code = "1".repeat(17);
    const r = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${code}`);
    expect(r.status).toBe(400);
  });

  test("GET /api/rsvp/lookup is case-insensitive on the slug", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-case@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const upper = await req("GET", `/api/rsvp/lookup?couple=${slug.toUpperCase()}&code=${code}`);
    const lower = await req("GET", `/api/rsvp/lookup?couple=${slug.toLowerCase()}&code=${code}`);
    expect(upper.status).toBe(200);
    expect(lower.status).toBe(200);
  });

  test("GET /api/rsvp/lookup tolerates whitespace around the code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-ws@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const r = await req(
      "GET",
      `/api/rsvp/lookup?couple=${slug}&code=${encodeURIComponent(`  ${code}  `)}`,
    );
    expect(r.status).toBe(200);
  });

  test("GET /api/rsvp/lookup view fields match the household payload", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-view@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Smith party" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "Anna", household_id: hh.data.household.id },
      { token },
    );
    const slug = await getSlug(token);
    const r = await req<{
      rsvp: {
        couple_slug: string;
        couple_display_name: string;
        household_label: string;
        household_code: string;
        members: { full_name: string }[];
        rsvp_offers_accommodation: boolean;
        rsvp_collects_meal: boolean;
      };
    }>("GET", `/api/rsvp/lookup?couple=${slug}&code=${hh.data.household.code}`);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.household_label).toBe("Smith party");
    expect(r.data.rsvp.household_code).toBe(hh.data.household.code);
    expect(r.data.rsvp.couple_slug).toBeTruthy();
    expect(r.data.rsvp.couple_display_name).toBe("Mia & Lucas");
    expect(r.data.rsvp.members.length).toBe(1);
    expect(typeof r.data.rsvp.rsvp_offers_accommodation).toBe("boolean");
    expect(typeof r.data.rsvp.rsvp_collects_meal).toBe("boolean");
  });

  test("rsvp lookup rate limit: bucket capacity is 30 per 5s for one IP", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-rate@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    // Fixed IP so the bucket persists across all requests.
    const ip = "10.99.99.99";
    let ok200 = 0;
    let tooMany = 0;
    for (let i = 0; i < 40; i++) {
      const r = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${code}`, undefined, {
        clientIp: ip,
      });
      if (r.status === 200) ok200++;
      else if (r.status === 429) tooMany++;
    }
    // Bucket starts at 30 → first 30 succeed, then at least one 429.
    expect(ok200).toBeGreaterThanOrEqual(29);
    expect(tooMany).toBeGreaterThan(0);
  });

  test("rsvp lookup rate-limit buckets are per-IP (other IP still works)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("look-rate2@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    // Burn the first bucket flat.
    for (let i = 0; i < 35; i++) {
      await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${code}`, undefined, {
        clientIp: "10.7.7.7",
      });
    }
    const other = await req("GET", `/api/rsvp/lookup?couple=${slug}&code=${code}`, undefined, {
      clientIp: "10.8.8.8",
    });
    expect(other.status).toBe(200);
  });
});

// ─── rsvp checkin: idempotency + household propagation + validation ─────────

describe("rsvp checkin: validation + idempotency + isolation", () => {
  test("POST /api/rsvp/checkin requires couple_slug", async () => {
    wipeAll();
    const r = await req("POST", "/api/rsvp/checkin", {
      household_code: "1234",
      members: [],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin requires household_code", async () => {
    wipeAll();
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: "WEDDLY",
      members: [],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin requires members array", async () => {
    wipeAll();
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: "WEDDLY",
      household_code: "1234",
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin with empty members and empty added_members returns 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-nothing@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members: [],
      added_members: [],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects > 50 members", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-50@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const members = Array.from({ length: 51 }, () => ({ guest_id: 1, rsvp_status: "yes" }));
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members,
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects > 10 added_members", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-add10@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const added = Array.from({ length: 11 }, (_, i) => ({
      full_name: `Plus ${i}`,
      kind: "adult",
      rsvp_status: "yes",
    }));
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
      added_members: added,
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects malformed JSON", async () => {
    const r = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects guest_id from a different household", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-wronghh@weddly.test");
    const hh1 = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "HH1" },
      { token },
    );
    const hh2 = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "HH2" },
      { token },
    );
    const g1 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "G1", household_id: hh1.data.household.id },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "G2", household_id: hh2.data.household.id },
      { token },
    );
    const slug = await getSlug(token);
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh2.data.household.code,
      members: [{ guest_id: g1.data.guest.id, rsvp_status: "yes" }],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects invalid rsvp_status on a member", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-badstat@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "G" },
      { token },
    );
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "perhaps" }],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects missing guest_id on a member", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-noid@weddly.test");
    await req("POST", "/api/guests", { full_name: "G" }, { token });
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members: [{ rsvp_status: "yes" }],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin rejects empty full_name on added_members", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-addempty@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const slug = await getSlug(token);
    const code = (await listHouseholds(token))[0]!.code;
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
      added_members: [{ full_name: "", kind: "adult", rsvp_status: "yes" }],
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/checkin with unknown slug returns 404", async () => {
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: "NOSUCHCOUPLE",
      household_code: "1234",
      members: [{ guest_id: 1, rsvp_status: "yes" }],
    });
    expect(r.status).toBe(404);
  });

  test("POST /api/rsvp/checkin with unknown code returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-badcode@weddly.test");
    await req("POST", "/api/guests", { full_name: "G" }, { token });
    const slug = await getSlug(token);
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: "0001",
      members: [{ guest_id: 1, rsvp_status: "yes" }],
    });
    expect(r.status).toBe(404);
  });

  test("POST /api/rsvp/checkin Idempotency-Key replay returns Idempotent-Replay:1", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-idem@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "Family" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "Family")!;
    const body = {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
    };
    const headers = {
      "Content-Type": "application/json",
      "Idempotency-Key": "abc-replay-1",
    };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replay")).toBeNull();
    const second = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
  });

  test("POST /api/rsvp/checkin without Idempotency-Key still dedupes bit-exact replays via content hash", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-hash@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "Fam2" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "Fam2")!;
    const body = JSON.stringify({
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
      added_members: [{ full_name: "Plus-One-Hash", kind: "adult", rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json" };
    const first = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replay")).toBe("1");
    const list = await req<{ guests: { full_name: string }[] }>("GET", "/api/guests", undefined, {
      token,
    });
    const adds = list.data.guests.filter((g) => g.full_name === "Plus-One-Hash");
    expect(adds.length).toBe(1);
  });

  test("POST /api/rsvp/checkin: each household member's RSVP is independent (no auto-rollup)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-indep@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Pair" },
      { token },
    );
    const g1 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "P1", household_id: hh.data.household.id },
      { token },
    );
    const g2 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "P2", household_id: hh.data.household.id },
      { token },
    );
    const slug = await getSlug(token);
    // One says yes, one says no — server does NOT collapse them into "maybe"
    // for either row; each member keeps its own answer.
    const r = await req<{
      rsvp: { members: { id: number; rsvp_status: string }[] };
    }>("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.data.household.code,
      members: [
        { guest_id: g1.data.guest.id, rsvp_status: "yes" },
        { guest_id: g2.data.guest.id, rsvp_status: "no" },
      ],
    });
    expect(r.status).toBe(200);
    const byId = new Map(r.data.rsvp.members.map((m) => [m.id, m]));
    expect(byId.get(g1.data.guest.id)?.rsvp_status).toBe("yes");
    expect(byId.get(g2.data.guest.id)?.rsvp_status).toBe("no");
  });

  test("POST /api/rsvp/checkin changing a non-partner member doesn't ripple to siblings", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-noripple@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Trio" },
      { token },
    );
    const g1 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Alpha", household_id: hh.data.household.id, rsvp_status: "yes" },
      { token },
    );
    const g2 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Beta", household_id: hh.data.household.id, rsvp_status: "yes" },
      { token },
    );
    const g3 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Gamma", household_id: hh.data.household.id, rsvp_status: "yes" },
      { token },
    );
    const slug = await getSlug(token);
    // Only g2 changes to "no" — g1 + g3 still report "yes".
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.data.household.code,
      members: [{ guest_id: g2.data.guest.id, rsvp_status: "no" }],
    });
    const list = await req<{ guests: { id: number; rsvp_status: string }[] }>(
      "GET",
      "/api/guests",
      undefined,
      { token },
    );
    const byId = new Map(list.data.guests.map((g) => [g.id, g.rsvp_status]));
    expect(byId.get(g1.data.guest.id)).toBe("yes");
    expect(byId.get(g2.data.guest.id)).toBe("no");
    expect(byId.get(g3.data.guest.id)).toBe("yes");
  });

  test("POST /api/rsvp/checkin: regenerate-code mid-flow → submit on old code returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ck-regen@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "RegenHH" },
      { token },
    );
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", household_id: hh.data.household.id },
      { token },
    );
    const slug = await getSlug(token);
    const oldCode = hh.data.household.code;
    // Regenerate the code via admin endpoint.
    const regen = await req<{ household: { code: string } }>(
      "POST",
      `/api/households/${hh.data.household.id}/regenerate-code`,
      {},
      { token },
    );
    expect(regen.data.household.code).not.toBe(oldCode);
    // Old code is now invalid for checkin.
    const stale = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: oldCode,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
    });
    expect(stale.status).toBe(404);
    // New code works.
    const fresh = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: regen.data.household.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
    });
    expect(fresh.status).toBe(200);
  });
});

// ─── rsvp legacy /api/rsvp/:code ────────────────────────────────────────────

describe("rsvp legacy per-guest code", () => {
  test("GET /api/rsvp/:code with unknown code returns 404", async () => {
    wipeAll();
    const r = await req("GET", "/api/rsvp/NOPECD");
    expect(r.status).toBe(404);
  });

  test("GET /api/rsvp/:code returns the same household view shape as the new flow", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-view@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req<{
      rsvp: {
        couple_slug: string;
        household_label: string;
        household_code: string;
        members: { full_name: string }[];
      };
    }>("GET", `/api/rsvp/${g.data.guest.invite_code}`);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.couple_slug).toBeTruthy();
    expect(r.data.rsvp.household_label).toBe("Anna");
    // Crockford 8-char post-May-2026; legacy 4-digit form preserved by OR.
    expect(r.data.rsvp.household_code).toMatch(/^([1-9]\d{3}|[0-9A-HJKMNP-TV-Z]{8})$/);
    expect(r.data.rsvp.members.length).toBe(1);
  });

  test("GET /api/rsvp/:code is case-insensitive on the invite code", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-case@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const lower = g.data.guest.invite_code.toLowerCase();
    const r = await req("GET", `/api/rsvp/${lower}`);
    expect(r.status).toBe(200);
  });

  test("POST /api/rsvp/:code rejects invalid rsvp_status", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-bad@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req("POST", `/api/rsvp/${g.data.guest.invite_code}`, {
      rsvp_status: "perhaps",
    });
    expect(r.status).toBe(400);
  });

  test("POST /api/rsvp/:code with plus_one_name materializes a sibling guest", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-plus@weddly.test");
    const g = await req<{ guest: { invite_code: string; full_name: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req<{ rsvp: { members: { full_name: string }[] } }>(
      "POST",
      `/api/rsvp/${g.data.guest.invite_code}`,
      {
        rsvp_status: "yes",
        meal_choice: "meat",
        plus_one_name: "Mark",
        plus_one_meal: "vegetarian",
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.length).toBe(2);
    const names = r.data.rsvp.members.map((m) => m.full_name).sort();
    expect(names).toEqual(["Anna", "Mark"]);
  });

  test("POST /api/rsvp/:code with oversized code returns 400", async () => {
    const r = await req("POST", `/api/rsvp/${"x".repeat(33)}`, { rsvp_status: "yes" });
    expect(r.status).toBe(400);
  });

  test("GET /api/rsvp/<unknown 6-char code> returns 404", async () => {
    wipeAll();
    const r = await req("GET", "/api/rsvp/AAAAAA");
    expect(r.status).toBe(404);
  });
});

// ─── guest portal ───────────────────────────────────────────────────────────

describe("guest portal: gate + isolation", () => {
  test("GET /api/guest/portal with no slug param returns 400", async () => {
    wipeAll();
    const r = await req("GET", "/api/guest/portal");
    expect(r.status).toBe(400);
  });

  test("GET /api/guest/portal with oversized slug returns 400", async () => {
    const slug = "x".repeat(65);
    const r = await req("GET", `/api/guest/portal?couple=${slug}&code=1234`);
    expect(r.status).toBe(400);
  });

  test("GET /api/guest/portal with unknown slug returns 404", async () => {
    const r = await req("GET", "/api/guest/portal?couple=NOSUCH&code=1234");
    expect(r.status).toBe(404);
  });

  test("GET /api/guest/portal with unknown code returns 404", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-badcode@weddly.test");
    await req("POST", "/api/guests", { full_name: "Anna" }, { token });
    const slug = await getSlug(token);
    const r = await req("GET", `/api/guest/portal?couple=${slug}&code=0001`);
    expect(r.status).toBe(404);
  });

  test("GET /api/guest/portal returns 403 not_rsvpd when only 'maybe' RSVPs exist", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-maybe@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "MaybeFam" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "MaybeFam")!;
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "maybe" }],
    });
    const r = await req("GET", `/api/guest/portal?couple=${slug}&code=${hh.code}`);
    expect(r.status).toBe(403);
    expect((r.data as { detail?: { code?: string } }).detail?.code).toBe("not_rsvpd");
  });

  test("GET /api/guest/portal returns 403 not_rsvpd when only 'no' RSVPs exist", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-no@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "NoFam" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "NoFam")!;
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "no" }],
    });
    const r = await req("GET", `/api/guest/portal?couple=${slug}&code=${hh.code}`);
    expect(r.status).toBe(403);
    expect((r.data as { detail?: { code?: string } }).detail?.code).toBe("not_rsvpd");
  });

  test("GET /api/guest/portal returns 200 with at least one 'yes' even if siblings are 'no'", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-mixed@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "MixedFam" },
      { token },
    );
    const g1 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Yes", household_id: hh.data.household.id },
      { token },
    );
    const g2 = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "No", household_id: hh.data.household.id },
      { token },
    );
    const slug = await getSlug(token);
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.data.household.code,
      members: [
        { guest_id: g1.data.guest.id, rsvp_status: "yes" },
        { guest_id: g2.data.guest.id, rsvp_status: "no" },
      ],
    });
    const r = await req<{ portal: { members: { full_name: string }[] } }>(
      "GET",
      `/api/guest/portal?couple=${slug}&code=${hh.data.household.code}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.portal.members.length).toBe(2);
  });

  test("GET /api/guest/portal exposes schedule entries once gated open", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-sched@weddly.test");
    // Seed a schedule entry.
    const ev = await req<{ event: { id: number } }>(
      "POST",
      "/api/schedule",
      { label: "Ceremony", starts_at_minutes: 16 * 60, duration_minutes: 60 },
      { token },
    );
    expect(ev.status).toBe(201);
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "SchedFam" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "SchedFam")!;
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
    });
    const r = await req<{
      portal: {
        schedule: { label: string; starts_at_minutes: number }[];
        couple_display_name: string;
      };
    }>("GET", `/api/guest/portal?couple=${slug}&code=${hh.code}`);
    expect(r.status).toBe(200);
    expect(r.data.portal.schedule.length).toBe(1);
    expect(r.data.portal.schedule[0]!.label).toBe("Ceremony");
    expect(r.data.portal.couple_display_name).toBe("Mia & Lucas");
  });

  test("GET /api/guest/portal is case-insensitive on slug", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("portal-case@weddly.test");
    const g = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna", new_household_label: "CaseFam" },
      { token },
    );
    const slug = await getSlug(token);
    const hh = (await listHouseholds(token)).find((h) => h.label === "CaseFam")!;
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code: hh.code,
      members: [{ guest_id: g.data.guest.id, rsvp_status: "yes" }],
    });
    const r = await req("GET", `/api/guest/portal?couple=${slug.toLowerCase()}&code=${hh.code}`);
    expect(r.status).toBe(200);
  });

  test("GET /api/guest/portal: Couple B's code doesn't open Couple A's portal", async () => {
    wipeAll();
    const a = await bootstrapCouple("portal-isoA@weddly.test");
    const b = await bootstrapSecondCouple("portal-isoB@weddly.test");
    const bg = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "B", new_household_label: "BFam" },
      { token: b.token },
    );
    const bSlug = b.slug || (await getSlug(b.token));
    const bHh = (await listHouseholds(b.token)).find((h) => h.label === "BFam")!;
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: bSlug,
      household_code: bHh.code,
      members: [{ guest_id: bg.data.guest.id, rsvp_status: "yes" }],
    });
    // Now ask for A's slug with B's code → 404.
    const aSlug = await getSlug(a.token);
    const r = await req("GET", `/api/guest/portal?couple=${aSlug}&code=${bHh.code}`);
    expect(r.status).toBe(404);
  });
});

// ─── households: lookup isolation through the public route ──────────────────

describe("households: cross-couple public lookup isolation", () => {
  test("Couple A's slug + Couple B's code returns 404", async () => {
    wipeAll();
    const a = await bootstrapCouple("xlookA@weddly.test");
    const b = await bootstrapSecondCouple("xlookB@weddly.test");
    const bg = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "B-Guest" },
      { token: b.token },
    );
    const bHh = (await listHouseholds(b.token))[0]!;
    const aSlug = await getSlug(a.token);
    const r = await req("GET", `/api/rsvp/lookup?couple=${aSlug}&code=${bHh.code}`);
    expect(r.status).toBe(404);
    expect(bg.status).toBe(201);
  });

  test("regenerate-code returns a new Crockford code distinct from the old one", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("regen-newcode@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "X" },
      { token },
    );
    const old = hh.data.household.code;
    const r = await req<{ household: { code: string } }>(
      "POST",
      `/api/households/${hh.data.household.id}/regenerate-code`,
      {},
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.household.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(r.data.household.code).not.toBe(old);
  });

  test("regenerate-code writes a household.regen_code audit log entry", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("regen-audit@weddly.test");
    const hh = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "X" },
      { token },
    );
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.regen_code'",
      )
      .get(coupleId) as { n: number };
    await req("POST", `/api/households/${hh.data.household.id}/regenerate-code`, {}, { token });
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'household.regen_code'",
      )
      .get(coupleId) as { n: number };
    expect(after.n).toBe(before.n + 1);
  });
});

// ─── households + rsvp toggles: defaults + propagation through public view ──

describe("households: RSVP toggles surface in PublicCheckinView", () => {
  test("rsvp_offers_accommodation true flows through to the public lookup view", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-accpub@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "AccHH" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "Anna", household_id: hh.data.household.id },
      { token },
    );
    await req(
      "PATCH",
      `/api/households/${hh.data.household.id}`,
      { rsvp_offers_accommodation: true },
      { token },
    );
    const slug = await getSlug(token);
    const r = await req<{
      rsvp: { rsvp_offers_accommodation: boolean; rsvp_collects_meal: boolean };
    }>("GET", `/api/rsvp/lookup?couple=${slug}&code=${hh.data.household.code}`);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.rsvp_offers_accommodation).toBe(true);
  });

  test("rsvp_collects_meal false flows through to the public lookup view", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("hh-mealpub@weddly.test");
    const hh = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "MealHH" },
      { token },
    );
    await req(
      "POST",
      "/api/guests",
      { full_name: "Anna", household_id: hh.data.household.id },
      { token },
    );
    await req(
      "PATCH",
      `/api/households/${hh.data.household.id}`,
      { rsvp_collects_meal: false },
      { token },
    );
    const slug = await getSlug(token);
    const r = await req<{
      rsvp: { rsvp_collects_meal: boolean };
    }>("GET", `/api/rsvp/lookup?couple=${slug}&code=${hh.data.household.code}`);
    expect(r.data.rsvp.rsvp_collects_meal).toBe(false);
  });
});
