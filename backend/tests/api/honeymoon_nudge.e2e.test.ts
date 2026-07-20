// The honeymoon-planner nudge: one mail, inside the 90-day window, only to
// couples who have never touched /app/honeymoon.
//
// Two rules carry the risk here. "Never touched" is stricter than the admin
// dashboard's adoption metric (destination only) because a couple who added a
// honeymoon budget line or ran the task wand HAS used the feature. And the
// sweep must yield on days 90/30/7, since the milestone mails that fire on
// exactly those days promise we only write at 90, 30 and 7 days out.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, wipeAll } from "../helpers";

const DAY = 86_400_000;
const KIND = "honeymoon_nudge";

function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function ymd(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Put the wedding exactly N days from today (UTC), so the sweep's computed
 *  daysUntil is exactly N. */
function setWedding(coupleId: number, daysFromToday: number): void {
  db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(
    ymd(startOfDayUtc(now()) + daysFromToday * DAY),
    coupleId,
  );
}

function sends(coupleId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = ?")
    .get(coupleId, KIND) as { n: number };
  return row.n;
}

describe("honeymoon nudge", () => {
  test("fires once inside the window, never twice", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-basic@weddly.test");
    setWedding(coupleId, 60);

    expect(runEmailSweep().honeymoonNudges).toBe(1);
    expect(sends(coupleId)).toBe(1);

    // One-shot via email_dispatches: sweeping again changes nothing.
    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(coupleId)).toBe(1);
  });

  test("respects the window edges", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-window@weddly.test");

    // Too far out.
    setWedding(coupleId, 120);
    expect(runEmailSweep().honeymoonNudges).toBe(0);

    // Too close: asking now would be panic, not help.
    setWedding(coupleId, 5);
    expect(runEmailSweep().honeymoonNudges).toBe(0);

    // A wedding already behind them.
    setWedding(coupleId, -10);
    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);

    // Inside the window it fires.
    setWedding(coupleId, 89);
    expect(runEmailSweep().honeymoonNudges).toBe(1);
  });

  test("yields on the 90/30/7 milestone days, then sends the next day", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-milestone@weddly.test");

    for (const d of [90, 30]) {
      setWedding(coupleId, d);
      expect(runEmailSweep().honeymoonNudges).toBe(0);
      expect(sends(coupleId)).toBe(0);
    }

    // Those sweeps really did send the milestone mails, which is the whole
    // reason to yield. Age them so we're modelling a later, quiet day rather
    // than re-testing the 24h guard covered above.
    db.prepare("UPDATE email_log SET created_at = ? WHERE couple_id = ?").run(
      now() - 3 * DAY,
      coupleId,
    );

    // One day off the collision, on a quiet day, the nudge goes out normally.
    setWedding(coupleId, 89);
    expect(runEmailSweep().honeymoonNudges).toBe(1);
    expect(sends(coupleId)).toBe(1);
  });

  test("yields when another lifecycle mail already went out today", async () => {
    // Regression: this sweep once ran alongside the 48h partner-invite reminder
    // and delivered a couple two marketing emails in a single sweep. It is
    // one-shot and not date-critical, so it waits for a quiet day instead.
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-quiet@weddly.test");
    setWedding(coupleId, 60);

    const ts = now();
    db.prepare(
      `INSERT INTO email_log (user_id, couple_id, kind, category, to_email, subject, status, created_at)
       VALUES (NULL, ?, 'partner_invite_reminder', 'lifecycle', 'x@y.z', 's', 'sent', ?)`,
    ).run(coupleId, ts);

    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);

    // Once that mail is a day old, the nudge is free to go.
    db.prepare(
      "UPDATE email_log SET created_at = ? WHERE couple_id = ? AND kind = 'partner_invite_reminder'",
    ).run(ts - 2 * DAY, coupleId);
    expect(runEmailSweep().honeymoonNudges).toBe(1);
  });

  test("skips a couple that already set a destination", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-dest@weddly.test");
    setWedding(coupleId, 60);
    db.prepare("UPDATE couples SET honeymoon_destination = 'Santorini' WHERE id = ?").run(coupleId);

    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);
  });

  test("skips a couple who used the planner WITHOUT naming a destination", async () => {
    // This is the case the admin adoption metric misses. Both of these couples
    // have used the feature, so neither should be told to go start it.
    // preset_key is what marks a line as coming from the honeymoon page (a cost
    // chip, or saving a flight offer), which is why the sweep keys on it.
    wipeAll();
    const budget = await bootstrapCouple("hm-budget@weddly.test");
    const tasks = await bootstrapCouple("hm-tasks@weddly.test");
    setWedding(budget.coupleId, 60);
    setWedding(tasks.coupleId, 60);

    const ts = now();
    db.prepare(
      `INSERT INTO budget_lines (couple_id, category, label, planned_huf, actual_huf, preset_key, created_at, updated_at)
       VALUES (?, 'honeymoon', 'Szállás', 200000, 0, 'lodging', ?, ?)`,
    ).run(budget.coupleId, ts, ts);
    db.prepare(
      `INSERT INTO planning_items (couple_id, kind, title, topic, created_at, updated_at)
       VALUES (?, 'task', 'Útlevél megújítása', 'honeymoon', ?, ?)`,
    ).run(tasks.coupleId, ts, ts);

    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(budget.coupleId)).toBe(0);
    expect(sends(tasks.coupleId)).toBe(0);
  });

  test("the budget line onboarding seeds for EVERYONE does not silence the sweep", async () => {
    // Regression guard for the bug this sweep shipped with: onboarding creates
    // a "Honeymoon" budget line at 300k for every couple, so keying on the mere
    // existence of a honeymoon budget row matched all of them and sent nothing.
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-seeded@weddly.test");
    setWedding(coupleId, 60);

    const seeded = db
      .prepare(
        "SELECT COUNT(*) AS n FROM budget_lines WHERE couple_id = ? AND category = 'honeymoon' AND preset_key IS NULL",
      )
      .get(coupleId) as { n: number };
    expect(seeded.n).toBeGreaterThan(0); // the seed is really there

    expect(runEmailSweep().honeymoonNudges).toBe(1);
    expect(sends(coupleId)).toBe(1);
  });

  test("dates alone, with no destination, still count as using the planner", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("hm-dates@weddly.test");
    setWedding(coupleId, 60);
    db.prepare(
      "UPDATE couples SET honeymoon_start_date = '2026-09-20', honeymoon_end_date = '2026-09-28' WHERE id = ?",
    ).run(coupleId);

    expect(runEmailSweep().honeymoonNudges).toBe(0);
    expect(sends(coupleId)).toBe(0);
  });
});
