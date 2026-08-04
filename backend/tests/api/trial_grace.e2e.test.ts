// The trial boundary: what a couple keeps when their trial window closes, and
// the one mail that tells them about it.
//
// The shape being tested is a 7-day GRACE period. `computeEntitlement` keeps a
// lapsed trial editable for TRIAL_GRACE_MS with reason 'trial_grace', and the
// `trial_ended` mail goes out at the boundary naming the two ways on: invite
// your partner (the workspace stays open at no cost), or add payment details
// before the grace ends. The two must agree — a mail promising seven days over
// a workspace that is already frozen is worse than no mail at all.
//
// Covers (major-change rule — state machine + money flow):
//   - inside the grace window: entitled, reason 'trial_grace'
//   - past it: not entitled, reason 'trial_expired'
//   - the sweep sends once per couple, and never twice
//   - a couple whose grace has already run out is NOT mailed (a deadline notice
//     that arrives after the deadline is just noise)
//   - a secondary event workspace is not mailed about its own "trial"

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  computeEntitlement,
  PAID_LAUNCH_DATE,
  TRIAL_GRACE_MS,
  trialGraceEndsAt,
} from "@shared/billing";
import { db, now } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { runEmailSweep } from "../../src/domain/emails/worker";
import {
  bootstrapCouple,
  enableBillingEnforcement,
  expireTrialGraceWindow,
  req,
  wipeAll,
} from "../helpers";

const DAY = 1000 * 60 * 60 * 24;

function setTrialEnd(coupleId: number, at: number): void {
  db.prepare(
    "UPDATE couples SET subscription_status = 'trialing', trial_ends_at = ? WHERE id = ?",
  ).run(at, coupleId);
}

function mailCount(coupleId: number): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = 'trial_ended'")
    .get(coupleId) as { n: number };
  return r.n;
}

describe("trial grace window", () => {
  test("the trial runs to the end of August, not into it", () => {
    // PAID_LAUNCH_DATE is the instant August ENDS, so a couple has the whole of
    // the 31st. Pinned as a test because the difference between "1 August" and
    // "end of August" is a month of access for every pre-launch workspace.
    const d = new Date(PAID_LAUNCH_DATE);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // September, i.e. August is over
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
  });

  test("entitlement survives the trial end for exactly the grace window", () => {
    const ends = Date.UTC(2026, 8, 1);
    // The grace is OPT-IN per aggregate. Couples pass it (toCoupleBilling);
    // vendors and planners deliberately do not, so their own trials keep a hard
    // boundary — see the sibling test below.
    const opts = { trial_ends_at: ends, founding_until: null, trialGraceMs: TRIAL_GRACE_MS };

    // Inside the trial.
    expect(computeEntitlement("trialing", { ...opts, nowMs: ends - DAY })).toEqual({
      entitled: true,
      reason: "trialing",
    });
    // The moment it closes: still editable, but the reason changes, which is
    // what the banner and the mail key on.
    expect(computeEntitlement("trialing", { ...opts, nowMs: ends + 1 })).toEqual({
      entitled: true,
      reason: "trial_grace",
    });
    expect(computeEntitlement("trialing", { ...opts, nowMs: ends + 6 * DAY })).toEqual({
      entitled: true,
      reason: "trial_grace",
    });
    // And it really does end.
    expect(computeEntitlement("trialing", { ...opts, nowMs: trialGraceEndsAt(ends) })).toEqual({
      entitled: false,
      reason: "trial_expired",
    });
  });

  test("a trial with no end date is not handed a grace window off a NULL", () => {
    expect(
      computeEntitlement("trialing", {
        trial_ends_at: null,
        founding_until: null,
        nowMs: Date.now(),
        trialGraceMs: TRIAL_GRACE_MS,
      }),
    ).toEqual({ entitled: false, reason: "trial_expired" });
  });

  test("the grace is couples-only: an aggregate that asks for none gets none", () => {
    // Regression guard. The grace first went in as a constant inside
    // computeEntitlement, which is SHARED by couples, vendors and planners — so
    // it silently stretched the vendor 3-day trial to ten days and moved a
    // freemium funnel nobody asked to change. Default 0 is what keeps that a
    // couples-side decision.
    const ends = Date.UTC(2026, 8, 1);
    const justPast = { trial_ends_at: ends, founding_until: null, nowMs: ends + 1 };
    expect(computeEntitlement("trialing", justPast)).toEqual({
      entitled: false,
      reason: "trial_expired",
    });
    expect(computeEntitlement("trialing", { ...justPast, trialGraceMs: 0 })).toEqual({
      entitled: false,
      reason: "trial_expired",
    });
  });

  test("a couple in grace can still edit; past it they cannot", async () => {
    wipeAll();
    // Enforcement must be ON, or the deferred freeze would keep every couple
    // editable and the gate under test would never be reached.
    enableBillingEnforcement();
    const { token, coupleId } = await bootstrapCouple("grace-edit@weddly.test");

    setTrialEnd(coupleId, now() - DAY);
    const inGrace = await req(
      "PATCH",
      "/api/couples/current",
      { display_name: "Still here" },
      {
        token,
      },
    );
    expect(inGrace.status).toBe(200);

    // Past the week: both the trial AND the wall have to be older than the
    // window, or the flip itself would still be handing out grace.
    setTrialEnd(coupleId, now() - (TRIAL_GRACE_MS + DAY));
    expireTrialGraceWindow();
    const afterGrace = await req(
      "POST",
      "/api/guests",
      { full_name: "Too late", side: "both" },
      { token },
    );
    expect(afterGrace.status).toBe(402);
  });
});

describe("trial_ended mail", () => {
  test("goes out once at the boundary and never twice", async () => {
    wipeAll();
    enableBillingEnforcement();
    const { coupleId } = await bootstrapCouple("grace-mail@weddly.test");
    setTrialEnd(coupleId, now() - DAY);

    const first = runEmailSweep();
    expect(first.trialEnded).toBe(1);
    expect(mailCount(coupleId)).toBe(1);

    // The couple is still inside the grace window on the next hourly sweep, so
    // the only thing stopping a second send is the dispatch record.
    const second = runEmailSweep();
    expect(second.trialEnded).toBe(0);
    expect(mailCount(coupleId)).toBe(1);
  });

  test("nothing is sent while the freeze is deferred", async () => {
    // The mail's deadline only means something if the wall behind it is up. The
    // go-live switch is OFF in production today, so a couple mailed now would
    // find the app works fine past the date and learn to ignore the next one.
    wipeAll();
    const { coupleId } = await bootstrapCouple("grace-deferred@weddly.test");
    setTrialEnd(coupleId, now() - DAY);

    expect(runEmailSweep().trialEnded).toBe(0);
    expect(mailCount(coupleId)).toBe(0);

    // Flipping the switch is what releases it, on the very next sweep.
    enableBillingEnforcement();
    expect(runEmailSweep().trialEnded).toBe(1);
    expect(mailCount(coupleId)).toBe(1);
  });

  test("go-live day reaches the couples whose trial lapsed months ago", async () => {
    // The whole point of the notice is a week of warning before the freeze. The
    // freeze has been deferred since launch, so on go-live day most couples'
    // trials are long past: counting their week from the trial end would freeze
    // them the instant the switch is flipped, having sent them nothing. Their
    // week runs from the WALL instead, so they are mailed and stay editable.
    wipeAll();
    const { coupleId, token } = await bootstrapCouple("grace-backlog@weddly.test");
    setTrialEnd(coupleId, now() - 120 * DAY);

    // Deferred: no mail, and nothing frozen.
    expect(runEmailSweep().trialEnded).toBe(0);

    enableBillingEnforcement();
    expect(runEmailSweep().trialEnded).toBe(1);
    expect(mailCount(coupleId)).toBe(1);

    // And they can still edit, because their week started at the flip rather
    // than four months ago.
    const edit = await req(
      "PATCH",
      "/api/couples/current",
      { display_name: "Still editable" },
      { token },
    );
    expect(edit.status).toBe(200);
  });

  test("a couple whose grace already ran out is not mailed", async () => {
    wipeAll();
    enableBillingEnforcement();
    const { coupleId } = await bootstrapCouple("grace-late@weddly.test");
    // Past the grace: the mail's whole content is a deadline that has gone, and
    // the workspace is already read-only. Sending it would be a notice about
    // something the couple can no longer act on in time. Needs the WALL to be
    // old too, since the week counts from whichever came later.
    setTrialEnd(coupleId, now() - (TRIAL_GRACE_MS + DAY));
    expireTrialGraceWindow();

    expect(runEmailSweep().trialEnded).toBe(0);
    expect(mailCount(coupleId)).toBe(0);
  });

  test("a couple still inside its trial is not mailed", async () => {
    wipeAll();
    enableBillingEnforcement();
    const { coupleId } = await bootstrapCouple("grace-early@weddly.test");
    setTrialEnd(coupleId, now() + 5 * DAY);

    expect(runEmailSweep().trialEnded).toBe(0);
    expect(mailCount(coupleId)).toBe(0);
  });

  test("the mail names both routes and a real deadline", () => {
    // Rendered directly rather than read back from email_log, which stores the
    // payload and not the body.
    const built = buildEmail(
      "trial_ended",
      {
        inviteUrl: "https://example.test/app#invite-partner",
        billingUrl: "https://example.test/app/settings?tab=subscription",
        graceEndsLabel: "9 September 2026",
        graceDays: 7,
        coupleDisplayName: "Mia & Lucas",
      },
      { recipientName: "Owner", recipientLocale: "en" },
    );
    const text = built.rendered.text;

    // Route one is the partner, and it is the CTA. Route two is payment, and it
    // is present too: a deadline with only one way out is a wall, not a choice.
    expect(text).toContain("Invite my partner");
    expect(text).toContain("#invite-partner");
    expect(text).toContain("tab=subscription");
    // The deadline is stated as a date AND a day count, from one computed end.
    expect(text).toContain("9 September 2026");
    expect(text).toContain("7 days");
    // Framed as hospitality, never as a giveaway (the rule enforced across
    // templates.ts by email_integrity.e2e.test.ts).
    expect(text).toContain("our guests");
    expect(text.toLowerCase()).not.toContain("gratis");
    expect(built.subject).toContain("trial has ended");
  });
});
