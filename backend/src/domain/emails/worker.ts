// Cron-driven lifecycle emails. Runs every hour and:
//   1. Nags users who registered > 24h ago and haven't onboarded a couple yet.
//   2. Fires milestone reminders at T-90 / T-30 / T-7 days before the wedding.
//   3. Sends a "today's the day" note on the wedding morning.
//
// All sends go through `sendKind`, which respects per-user `lifecycle_opt_out`
// and writes to `email_log`. Idempotency is enforced by the unique index on
// `email_dispatches(couple_id, user_id, kind)` — `markDispatched()` returns
// false on duplicate, in which case we skip.

import { CONFIG } from "../../config";
import { db, now } from "../../db";
import { log } from "../../lib/logger";
import { reportError } from "../../lib/observability";
import type { EmailKind } from "./kinds";
import { markDispatched, sendKind } from "./send";

const ONBOARDING_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24; // 24h

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  couple_id: number | null;
  status: string;
  created_at: number;
}

interface CouplePartnerRow {
  couple_id: number;
  display_name: string;
  wedding_date: string;
  user_id: number;
  email: string;
  full_name: string;
  user_status: string;
}

/** Run all lifecycle sweeps. Returns counts so tests can assert behavior. */
export function runEmailSweep(): { nudges: number; milestones: number; weddings: number } {
  const ts = now();
  const nudges = sweepOnboardingNudges(ts);
  const milestones = sweepMilestones(ts);
  const weddings = sweepWeddingDay(ts);
  return { nudges, milestones, weddings };
}

function sweepOnboardingNudges(ts: number): number {
  // Users registered > 24h ago, no couple, not suspended, not already nudged.
  const cutoff = ts - ONBOARDING_NUDGE_AFTER_MS;
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.couple_id, u.status, u.created_at
         FROM users u
        WHERE u.couple_id IS NULL
          AND u.status = 'active'
          AND u.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM email_dispatches d
             WHERE d.user_id = u.id AND d.kind = 'onboarding_nudge'
          )`,
    )
    .all(cutoff) as UserRow[];

  let count = 0;
  for (const u of rows) {
    if (!markDispatched({ kind: "onboarding_nudge", couple_id: null, user_id: u.id })) continue;
    void sendKind(
      "onboarding_nudge",
      { onboardingUrl: `${CONFIG.frontendBaseUrl}/onboarding` },
      { user: { id: u.id, email: u.email, full_name: u.full_name } },
    );
    count++;
  }
  return count;
}

function sweepMilestones(ts: number): number {
  // For each (couple, partner) where wedding_date is exactly T-90/T-30/T-7
  // days from today (within a 24h window so we don't fire twice if the worker
  // restarts), send the milestone reminder.
  const today = startOfDayUtc(ts);
  const horizons: { kind: EmailKind; days: number }[] = [
    { kind: "milestone_t90", days: 90 },
    { kind: "milestone_t30", days: 30 },
    { kind: "milestone_t7", days: 7 },
  ];

  let count = 0;
  for (const h of horizons) {
    const target = ymd(today + h.days * 86_400_000);
    const rows = partnersForWeddingDate(target);
    for (const r of rows) {
      if (!markDispatched({ kind: h.kind, couple_id: r.couple_id, user_id: r.user_id })) continue;
      void sendKind(
        h.kind,
        {
          coupleDisplayName: r.display_name,
          weddingDate: r.wedding_date,
          dashboardUrl: `${CONFIG.frontendBaseUrl}/`,
        },
        {
          user: { id: r.user_id, email: r.email, full_name: r.full_name },
          couple_id: r.couple_id,
        },
      );
      count++;
    }
  }
  return count;
}

function sweepWeddingDay(ts: number): number {
  const target = ymd(startOfDayUtc(ts));
  const rows = partnersForWeddingDate(target);
  let count = 0;
  for (const r of rows) {
    if (!markDispatched({ kind: "wedding_today", couple_id: r.couple_id, user_id: r.user_id }))
      continue;
    void sendKind(
      "wedding_today",
      { coupleDisplayName: r.display_name },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;
  }
  return count;
}

function partnersForWeddingDate(date: string): CouplePartnerRow[] {
  return db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.wedding_date,
              u.id AS user_id, u.email, u.full_name, u.status AS user_status
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.wedding_date = ?
          AND u.status = 'active'`,
    )
    .all(date) as CouplePartnerRow[];
}

function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function ymd(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the hourly sweep. Idempotent. */
export function startEmailWorker(): void {
  if (timer) return;
  // Fire once on boot so a long downtime catches up immediately.
  try {
    const r = runEmailSweep();
    if (r.nudges + r.milestones + r.weddings > 0) {
      log.info("emails.boot_sweep", r);
    }
  } catch (e) {
    reportError("emails.boot_sweep_failed", e);
  }
  timer = setInterval(
    () => {
      try {
        const r = runEmailSweep();
        if (r.nudges + r.milestones + r.weddings > 0) {
          log.info("emails.hourly_sweep", r);
        }
      } catch (e) {
        reportError("emails.hourly_sweep_failed", e);
      }
    },
    1000 * 60 * 60,
  );
}

export function stopEmailWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
