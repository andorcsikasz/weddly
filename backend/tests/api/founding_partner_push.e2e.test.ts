// The founding-cohort push: 3 sends, 5 days apart, to solo workspaces, telling
// them the free-until-your-wedding-day plan needs BOTH partners on board.
//
// The rule this suite really guards is "never pitch an offer the grant would
// refuse": activatePartnerFreeWindow declines when the cohort is full, when the
// couple already pays, and on any non-anchor workspace, so the sweep must
// decline in exactly the same places. It also pins the cadence (grace, gap,
// cap), the stop-on-partner-join, and the invite link the mail carries.

import "../setup";

import { describe, expect, test } from "bun:test";
import { FOUNDING_CAP } from "@shared/billing";
import { db, now } from "../../src/db";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const DAY = 1000 * 60 * 60 * 24;
const KIND = "founding_partner_push";

/** Backdate the workspace past the 7-day grace so the first push is due. */
function ageCouple(coupleId: number, days: number): void {
  db.prepare("UPDATE couples SET created_at = ? WHERE id = ?").run(now() - days * DAY, coupleId);
}

/** Backdate the last send so the next one clears the 5-day gap. */
function agePush(coupleId: number, days: number): void {
  db.prepare("UPDATE couples SET founding_push_last_at = ? WHERE id = ?").run(
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

function pushCount(coupleId: number): number {
  const row = db
    .prepare("SELECT founding_push_count AS n FROM couples WHERE id = ?")
    .get(coupleId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Drive the series to completion, clearing the 5-day gap between each run. */
function runSeries(coupleId: number, runs: number): number[] {
  const counts: number[] = [];
  for (let i = 0; i < runs; i++) {
    counts.push(runEmailSweep().foundingPushes);
    agePush(coupleId, 6);
  }
  return counts;
}

describe("founding partner push", () => {
  test("fires 3 times, 5 days apart, then stops", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-cadence@weddly.test");
    ageCouple(coupleId, 8);

    // First send lands once the 7-day grace has passed.
    expect(runEmailSweep().foundingPushes).toBe(1);
    expect(sends(coupleId)).toBe(1);

    // A second sweep an hour later must NOT re-fire: the 5-day gap is unmet.
    expect(runEmailSweep().foundingPushes).toBe(0);
    expect(sends(coupleId)).toBe(1);

    // Clearing the gap releases sends 2 and 3, and then the cap holds forever.
    agePush(coupleId, 6);
    expect(runSeries(coupleId, 3)).toEqual([1, 1, 0]);
    expect(sends(coupleId)).toBe(3);
    expect(pushCount(coupleId)).toBe(3);
  });

  test("holds fire during the 7-day grace window", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-fresh@weddly.test");
    ageCouple(coupleId, 3); // inside the grace window

    expect(runEmailSweep().foundingPushes).toBe(0);
    expect(sends(coupleId)).toBe(0);
  });

  test("the mail carries a live invite link, reused across sends", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-link@weddly.test");
    ageCouple(coupleId, 8);
    runEmailSweep();

    const invites = db
      .prepare("SELECT token, source, invited_email FROM couple_invites WHERE couple_id = ?")
      .all(coupleId) as Array<{
      token: string;
      source: string | null;
      invited_email: string | null;
    }>;
    expect(invites.length).toBe(1);
    expect(invites[0]?.source).toBe("founding_push");
    expect(invites[0]?.invited_email).toBe(null);

    // The second send must REUSE that token, not mint a parallel one — two live
    // tokens would break the "max one outstanding invite per couple" invariant.
    agePush(coupleId, 6);
    runEmailSweep();
    const after = db
      .prepare("SELECT token FROM couple_invites WHERE couple_id = ?")
      .all(coupleId) as Array<{ token: string }>;
    expect(after.length).toBe(1);
    expect(after[0]?.token).toBe(invites[0]?.token as string);
  });

  test("a campaign-minted invite stays invisible to the dashboard", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("solo-hidden@weddly.test");
    ageCouple(coupleId, 8);
    runEmailSweep();

    // GET current-invite must not surface it: otherwise the dashboard collapses
    // its invite card and the "invite your partner" checklist ticks itself for
    // something the couple never did.
    const r = await req<{ invite: unknown }>("GET", "/api/couples/invites/current", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.invite).toBe(null);
  });

  test("inviting by email adopts the campaign token instead of 409ing", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("solo-adopt@weddly.test");
    ageCouple(coupleId, 8);
    runEmailSweep();
    const minted = db
      .prepare("SELECT token FROM couple_invites WHERE couple_id = ?")
      .get(coupleId) as { token: string };

    const r = await req<{ invite: { token: string; invited_email: string | null } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "partner-b@weddly.test" },
      { token },
    );
    expect(r.status).toBe(201);
    // Same token adopted (any copy already shared stays valid), now addressed,
    // and no second row.
    expect(r.data.invite.token).toBe(minted.token);
    expect(r.data.invite.invited_email).toBe("partner-b@weddly.test");
    const rows = db
      .prepare("SELECT source FROM couple_invites WHERE couple_id = ?")
      .all(coupleId) as Array<{ source: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.source).toBe(null); // adopted → now visible to the dashboard
  });

  test("stops the moment partner B joins", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-joined@weddly.test");
    ageCouple(coupleId, 8);
    expect(runEmailSweep().foundingPushes).toBe(1);

    // Partner B lands on the workspace: the pitch is now moot.
    db.prepare("UPDATE couples SET partner_b_id = ? WHERE id = ?").run(999_999, coupleId);
    agePush(coupleId, 6);
    expect(runEmailSweep().foundingPushes).toBe(0);
    expect(sends(coupleId)).toBe(1);
  });

  test("a paying couple is excluded, because the grant would refuse them", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-paying@weddly.test");
    ageCouple(coupleId, 8);
    // activatePartnerFreeWindow refuses on founding/active/past_due, so telling
    // these couples "invite your partner and it's free" would be a lie.
    for (const status of ["active", "founding", "past_due"]) {
      db.prepare("UPDATE couples SET subscription_status = ? WHERE id = ?").run(status, coupleId);
      expect(runEmailSweep().foundingPushes).toBe(0);
    }
    expect(sends(coupleId)).toBe(0);

    // Back on the trial, the same couple is a legitimate target.
    db.prepare("UPDATE couples SET subscription_status = 'trialing' WHERE id = ?").run(coupleId);
    expect(runEmailSweep().foundingPushes).toBe(1);
  });

  test("the whole sweep halts once the founding cohort is full", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("solo-capped@weddly.test");
    ageCouple(coupleId, 8);

    // Fill the cohort with granted badges. foundingSlotsUsed() counts these, and
    // a full cohort makes the offer unavailable, so the mail must not go out.
    const owner = db
      .prepare("SELECT partner_a_id AS id FROM couples WHERE id = ?")
      .get(coupleId) as {
      id: number;
    };
    const ins = db.prepare(
      `INSERT INTO couples (partner_a_id, display_name, is_demo, is_founding_member,
                            subscription_status, status, created_at, updated_at)
       VALUES (?, ?, 0, 1, 'founding', 'active', ?, ?)`,
    );
    const ts = now();
    for (let i = 0; i < FOUNDING_CAP; i++) ins.run(owner.id, `Founder ${i}`, ts, ts);

    expect(runEmailSweep().foundingPushes).toBe(0);
    expect(sends(coupleId)).toBe(0);
  });
});
