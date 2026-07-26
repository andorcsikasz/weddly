// T+14 send-off: the last mail a married couple ever gets from us.
//
// The behaviour that matters is the ORDER of two side effects. The mail is
// lifecycle, and the same sweep silences the recipient's lifecycle mail right
// after handing it off. Set the flag a moment too early and the dispatcher
// skips the very email it was supposed to close with, which is a bug you only
// notice in production by its absence. So: it goes out, and only then does the
// couple go quiet.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, wipeAll } from "../helpers";

const DAY = 86_400_000;
const isoUtcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function setWeddingDaysAgo(coupleId: number, days: number): void {
  db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(
    isoUtcDate(now() - days * DAY),
    coupleId,
  );
}

function logged(coupleId: number, kind: string): { status: string } | null {
  return db
    .prepare("SELECT status FROM email_log WHERE couple_id = ? AND kind = ? ORDER BY id DESC")
    .get(coupleId, kind) as { status: string } | null;
}

function optedOut(email: string): boolean {
  const row = db
    .prepare(
      `SELECT p.lifecycle_opt_out AS o
         FROM email_preferences p JOIN users u ON u.id = p.user_id
        WHERE u.email = ?`,
    )
    .get(email) as { o: number } | undefined;
  return row?.o === 1;
}

describe("wedding_farewell: the last email", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("fires exactly 14 days after the wedding", async () => {
    const { coupleId } = await bootstrapCouple("farewell@weddly.test");
    setWeddingDaysAgo(coupleId, 14);

    const sweep = runEmailSweep();
    expect(sweep.weddingFarewells).toBe(1);
    expect(logged(coupleId, "wedding_farewell")).toBeTruthy();
  });

  test("does not fire early — a T+13 couple is left alone", async () => {
    const { coupleId } = await bootstrapCouple("farewell-early@weddly.test");
    setWeddingDaysAgo(coupleId, 13);

    expect(runEmailSweep().weddingFarewells).toBe(0);
    expect(logged(coupleId, "wedding_farewell")).toBeNull();
  });

  test("catches up with couples already PAST T+14 — the launch-day backlog", async () => {
    // The reason this is a window and not a single-day match: on the day this
    // ships, most married couples are already weeks past their 14th day. A
    // one-day match would skip every one of them, permanently.
    const { coupleId } = await bootstrapCouple("farewell-backlog@weddly.test");
    setWeddingDaysAgo(coupleId, 36);

    expect(runEmailSweep().weddingFarewells).toBe(1);
    expect(logged(coupleId, "wedding_farewell")).toBeTruthy();
  });

  test("stops at 90 days — a long-past wedding gets no late goodbye", async () => {
    const { coupleId } = await bootstrapCouple("farewell-stale@weddly.test");
    setWeddingDaysAgo(coupleId, 120);

    expect(runEmailSweep().weddingFarewells).toBe(0);
    expect(logged(coupleId, "wedding_farewell")).toBeNull();
  });

  test("the mail goes out BEFORE the couple is silenced, not after", async () => {
    const EMAIL = "farewell-order@weddly.test";
    const { coupleId } = await bootstrapCouple(EMAIL);
    setWeddingDaysAgo(coupleId, 14);
    expect(optedOut(EMAIL)).toBe(false);

    runEmailSweep();
    // The send is fire-and-forget and the opt-out rides its continuation, so
    // yield once before asserting the flag.
    await Bun.sleep(50);

    // Not skipped: the dispatcher saw an opted-in recipient.
    expect(logged(coupleId, "wedding_farewell")?.status).not.toBe("skipped_opt_out");
    // And now they are quiet.
    expect(optedOut(EMAIL)).toBe(true);
  });

  test("after it, no further lifecycle mail reaches them", async () => {
    const EMAIL = "farewell-silence@weddly.test";
    const { coupleId } = await bootstrapCouple(EMAIL);
    setWeddingDaysAgo(coupleId, 14);
    runEmailSweep();
    await Bun.sleep(50);

    // Re-arm a lifecycle trigger the couple would otherwise qualify for by
    // moving the wedding to the milestone window, and clear the dispatch stamp
    // so idempotency is not what's doing the work.
    db.prepare("UPDATE couples SET wedding_date = ? WHERE id = ?").run(
      isoUtcDate(now() + 90 * DAY),
      coupleId,
    );
    db.prepare("DELETE FROM email_dispatches WHERE couple_id = ?").run(coupleId);

    runEmailSweep();
    await Bun.sleep(50);

    const lifecycleSends = db
      .prepare(
        `SELECT COUNT(*) AS n FROM email_log
          WHERE couple_id = ? AND category = 'lifecycle'
            AND kind != 'wedding_farewell' AND status != 'skipped_opt_out'`,
      )
      .get(coupleId) as { n: number };
    expect(lifecycleSends.n).toBe(0);
  });

  test("is idempotent — a second sweep the same day re-sends nothing", async () => {
    const { coupleId } = await bootstrapCouple("farewell-once@weddly.test");
    setWeddingDaysAgo(coupleId, 14);

    expect(runEmailSweep().weddingFarewells).toBe(1);
    expect(runEmailSweep().weddingFarewells).toBe(0);
  });
});
