// The three-week win-back mail: one note to a workspace nobody has opened in
// 21 days, listing what shipped while they were away.
//
// The rules that carry the risk: the unit is the WORKSPACE (one active partner
// keeps the whole couple off the list), it stops a fortnight before the wedding
// and never fires after it, and it is one-shot per person so an absent couple
// isn't dripped at.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { ensurePreferences, setLifecycleOptOut } from "../../src/domain/emails/preferences";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, registerAndVerify, wipeAll } from "../helpers";

const DAY = 86_400_000;
const KIND = "comeback_nudge";

function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function ymd(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Put the wedding exactly N days out (UTC). Far-future by default in these
 *  tests so the milestone + honeymoon sweeps stay out of the way. */
function setWedding(coupleId: number, daysFromToday: number): void {
  db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(
    ymd(startOfDayUtc(now()) + daysFromToday * DAY),
    coupleId,
  );
}

/** Nobody in the workspace has been seen for `days` days. */
function idleFor(coupleId: number, days: number): void {
  db.prepare("UPDATE users SET last_seen_at = ? WHERE couple_id = ?").run(
    now() - days * DAY,
    coupleId,
  );
}

function sends(coupleId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = ?")
    .get(coupleId, KIND) as { n: number };
  return row.n;
}

/** A dormant couple with a far-off wedding: the plain case every test starts
 *  from, minus whatever it then changes. */
async function dormantCouple(email: string, idleDays = 24) {
  const c = await bootstrapCouple(email);
  setWedding(c.coupleId, 300);
  idleFor(c.coupleId, idleDays);
  return c;
}

describe("comeback nudge", () => {
  test("fires once after three quiet weeks, never twice", async () => {
    wipeAll();
    const { coupleId } = await dormantCouple("cb-basic@weddly.test");

    expect(runEmailSweep().comebackNudges).toBe(1);
    expect(sends(coupleId)).toBe(1);

    // One-shot via email_dispatches: still dormant tomorrow, still one mail.
    idleFor(coupleId, 40);
    expect(runEmailSweep().comebackNudges).toBe(0);
    expect(sends(coupleId)).toBe(1);
  });

  test("leaves a couple who was here last week alone", async () => {
    wipeAll();
    const { coupleId } = await dormantCouple("cb-recent@weddly.test", 7);

    expect(runEmailSweep().comebackNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);

    // Cross the 21-day line and it goes out.
    idleFor(coupleId, 22);
    expect(runEmailSweep().comebackNudges).toBe(1);
  });

  test("one active partner keeps the whole workspace off the list", async () => {
    // The mail says "nothing has happened here in three weeks". If either
    // partner is in the budget every evening, that is simply false.
    wipeAll();
    const { coupleId } = await dormantCouple("cb-owner@weddly.test", 30);

    const partner = await registerAndVerify({
      email: "cb-partner@weddly.test",
      password: "supersafe123",
      full_name: "Partner B",
    });
    expect(partner.status).toBe(201);
    db.prepare("UPDATE users SET couple_id = ?, last_seen_at = ? WHERE email = ?").run(
      coupleId,
      now() - 2 * DAY,
      "cb-partner@weddly.test",
    );

    expect(runEmailSweep().comebackNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);

    // Once that partner also goes quiet, BOTH of them hear from us.
    idleFor(coupleId, 25);
    expect(runEmailSweep().comebackNudges).toBe(2);
    expect(sends(coupleId)).toBe(2);
  });

  test("stops a fortnight out, and never fires after the wedding", async () => {
    // Three separate couples on purpose: a wedding 30 days ago sets off the
    // farewell sweep, which both writes a lifecycle mail and opts the couple
    // out, so reusing one couple would test that instead of the date window.
    wipeAll();
    const soon = await dormantCouple("cb-soon@weddly.test");
    const past = await dormantCouple("cb-past@weddly.test");
    const ahead = await dormantCouple("cb-ahead@weddly.test");

    setWedding(soon.coupleId, 10); // executing, not planning
    setWedding(past.coupleId, -30); // their arc ended with the farewell
    setWedding(ahead.coupleId, 200); // outside the honeymoon nudge's 90-day window

    expect(runEmailSweep().comebackNudges).toBe(1);
    expect(sends(soon.coupleId)).toBe(0);
    expect(sends(past.coupleId)).toBe(0);
    expect(sends(ahead.coupleId)).toBe(1);
  });

  test("a couple with no wedding date still gets it", async () => {
    // No date is not a reason to go silent, it's a reason to come back and set
    // one. The template drops the countdown line for these.
    wipeAll();
    const { coupleId } = await dormantCouple("cb-nodate@weddly.test");
    db.prepare("UPDATE couples SET wedding_date = NULL WHERE id = ?").run(coupleId);

    expect(runEmailSweep().comebackNudges).toBe(1);
    expect(sends(coupleId)).toBe(1);
  });

  test("yields when another lifecycle mail already went out today", async () => {
    wipeAll();
    const { coupleId } = await dormantCouple("cb-quiet@weddly.test");

    const ts = now();
    db.prepare(
      `INSERT INTO email_log (user_id, couple_id, kind, category, to_email, subject, status, created_at)
       VALUES (NULL, ?, 'partner_invite_reminder', 'lifecycle', 'x@y.z', 's', 'sent', ?)`,
    ).run(coupleId, ts);

    expect(runEmailSweep().comebackNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);

    // A day later the inbox is quiet again and the nudge is free to go.
    db.prepare(
      "UPDATE email_log SET created_at = ? WHERE couple_id = ? AND kind = 'partner_invite_reminder'",
    ).run(ts - 2 * DAY, coupleId);
    expect(runEmailSweep().comebackNudges).toBe(1);
  });

  test("skips a paused workspace and an opted-out user", async () => {
    wipeAll();
    const paused = await dormantCouple("cb-paused@weddly.test");
    db.prepare("UPDATE couples SET status = 'paused' WHERE id = ?").run(paused.coupleId);
    expect(runEmailSweep().comebackNudges).toBe(0);

    // Opt-out is enforced one layer down, in sendKind: the sweep still counts
    // the send, but the dispatcher logs it as suppressed instead of delivering.
    // The user id comes from the DB rather than /api/auth/me on purpose — an
    // authed request stamps last_seen_at and would un-dormant the couple.
    wipeAll();
    const quiet = await dormantCouple("cb-optout@weddly.test");
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get("cb-optout@weddly.test") as {
      id: number;
    };
    ensurePreferences(u.id);
    setLifecycleOptOut(u.id, true);

    runEmailSweep();
    const logged = db
      .prepare("SELECT status FROM email_log WHERE couple_id = ? AND kind = ?")
      .get(quiet.coupleId, KIND) as { status: string } | undefined;
    expect(logged?.status).toBe("skipped_opt_out");
  });
});
