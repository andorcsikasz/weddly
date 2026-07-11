// Cron-driven lifecycle emails. Runs every hour and:
//   1. Nags users who registered > 24h ago and haven't onboarded a couple yet.
//   2. Fires milestone reminders at T-90 / T-30 / T-7 days before the wedding.
//   3. Sends a "today's the day" note on the wedding morning.
//
// All sends go through `sendKind`, which respects per-user `lifecycle_opt_out`
// and writes to `email_log`. Idempotency is enforced by the unique index on
// `email_dispatches(couple_id, user_id, kind)` — `markDispatched()` returns
// false on duplicate, in which case we skip.

import { toIsoDate } from "@shared/planning_timeline";
import { CONFIG } from "../../config";
import { db, now } from "../../db";
import { log } from "../../lib/logger";
import { reportError } from "../../lib/observability";
import { getCoupleById } from "../couples";
import { resolveRecipients, sendGuestMessage } from "../guest_messages";
import { countListingPackages, countListingPhotos, getListingByVendorAccountId } from "../listings";
import { insertCoupleNotification, listActionableTimelineTasks } from "../notifications";
import { type PlannerProfileRow, sendPlannerProfileReminder } from "../planner_profile";
import type { EmailKind } from "./kinds";
import { markDispatched, sendKind } from "./send";

// Max emails fired per sweep function per hourly run. Caps burst size so
// Resend never sees more than N concurrent requests from a single sweep,
// preventing 429 rate-limit failures when a cohort of accounts all become
// due at the same time. Remaining accounts are picked up in the next sweep.
const SENDS_PER_SWEEP_CAP = 8;

const ONBOARDING_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24; // 24h
const VENDOR_SHARE_NUDGE_AFTER_MS = 1000 * 60 * 60 * 2; // 2h
const ONBOARDING_NUDGE_WEEK_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
// A planner gets ~3 days to finish their profile on their own before the
// one-shot "your profile is missing info" nudge fires.
const PLANNER_PROFILE_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
const INVITE_PARTNER_AUTO_AFTER_MS = 1000 * 60 * 60 * 48; // 48h
// Solo workspaces are auto-nudged at the first 10:00 UTC at or after the 48h
// mark ("48h utáni legközelebbi 10:00"). The worker runs hourly, so the real
// send lands on the first sweep at/after that boundary, within the hour.
const INVITE_PARTNER_SEND_HOUR_UTC = 10;

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
export function runEmailSweep(): {
  nudges: number;
  nudgesWeek: number;
  invitePartnerAuto: number;
  vendorShareNudges: number;
  plannerProfileNudges: number;
  milestones: number;
  weddings: number;
  rsvpDeadlines: number;
  weddingFollowups: number;
  mealFollowups: number;
  adminDigests: number;
  rsvpDigests: number;
  timelineEscalations: number;
  scheduledGuestMessages: number;
} {
  const ts = now();
  const nudges = sweepOnboardingNudges(ts);
  const nudgesWeek = sweepOnboardingNudgesWeek(ts);
  const invitePartnerAuto = sweepInvitePartnerAuto(ts);
  const vendorShareNudges = sweepVendorProfileShareNudge(ts);
  const plannerProfileNudges = sweepPlannerProfileNudge(ts);
  const milestones = sweepMilestones(ts);
  const weddings = sweepWeddingDay(ts);
  const rsvpDeadlines = sweepRsvpDeadline(ts);
  const weddingFollowups = sweepWeddingFollowup(ts);
  const mealFollowups = sweepRsvpMealFollowup(ts);
  const adminDigests = sweepAdminModerationDigest(ts);
  const rsvpDigests = sweepRsvpWeeklyDigest(ts);
  const timelineEscalations = sweepTimelineEscalation(ts);
  const scheduledGuestMessages = sweepScheduledGuestMessages(ts);
  return {
    nudges,
    nudgesWeek,
    invitePartnerAuto,
    vendorShareNudges,
    plannerProfileNudges,
    milestones,
    weddings,
    rsvpDeadlines,
    weddingFollowups,
    mealFollowups,
    adminDigests,
    rsvpDigests,
    timelineEscalations,
    scheduledGuestMessages,
  };
}

interface ScheduledGuestMessageRow {
  id: number;
  couple_id: number;
  template: string;
  subject: string | null;
  body: string | null;
  include_envelope_tip: number;
  audience: string;
}

function sweepScheduledGuestMessages(ts: number): number {
  // Couple-composed broadcasts queued for a future send. Each row is picked up
  // once its scheduled_at passes, re-resolves its recipients (so a list that
  // changed since scheduling still hits the right people), and flips to sent.
  // A throw on any single message marks just that row failed and moves on.
  const rows = db
    .prepare(
      `SELECT id, couple_id, template, subject, body, include_envelope_tip, audience
         FROM guest_messages
        WHERE status = 'scheduled' AND scheduled_at <= ?
        ORDER BY scheduled_at ASC
        LIMIT ?`,
    )
    .all(ts, SENDS_PER_SWEEP_CAP) as ScheduledGuestMessageRow[];

  let count = 0;
  for (const m of rows) {
    try {
      const couple = getCoupleById(m.couple_id);
      if (!couple) {
        db.prepare("UPDATE guest_messages SET status = 'failed', updated_at = ? WHERE id = ?").run(
          ts,
          m.id,
        );
        count++;
        continue;
      }
      const recipients = resolveRecipients(
        m.couple_id,
        m.audience as "all" | "pending" | "confirmed",
      );
      const { sent, envelopeAmount } = sendGuestMessage(
        couple,
        {
          template: m.template as "invite" | "major_update" | "pre_wedding_info",
          subject: m.subject,
          body: m.body,
          include_envelope_tip: Boolean(m.include_envelope_tip),
        },
        recipients,
        null,
      );
      db.prepare(
        `UPDATE guest_messages
            SET status = 'sent', sent_at = ?, recipient_count = ?, envelope_amount = ?, updated_at = ?
          WHERE id = ?`,
      ).run(ts, sent, envelopeAmount, ts, m.id);
      count++;
    } catch (e) {
      reportError("emails.scheduled_guest_message_failed", e, { guest_message_id: m.id });
      db.prepare("UPDATE guest_messages SET status = 'failed', updated_at = ? WHERE id = ?").run(
        ts,
        m.id,
      );
      count++;
    }
  }
  return count;
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
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function sweepOnboardingNudgesWeek(ts: number): number {
  // Second, warmer nudge for users still without a workspace a week after
  // signup. Distinct kind from the 24h nudge, so the email_dispatches index
  // lets both fire once each — a 24h + 1-week drip. A user who created a
  // couple in between is excluded by `couple_id IS NULL`.
  const cutoff = ts - ONBOARDING_NUDGE_WEEK_AFTER_MS;
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.couple_id, u.status, u.created_at
         FROM users u
        WHERE u.couple_id IS NULL
          AND u.status = 'active'
          AND u.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM email_dispatches d
             WHERE d.user_id = u.id AND d.kind = 'onboarding_nudge_week'
          )`,
    )
    .all(cutoff) as UserRow[];

  let count = 0;
  for (const u of rows) {
    if (!markDispatched({ kind: "onboarding_nudge_week", couple_id: null, user_id: u.id }))
      continue;
    void sendKind(
      "onboarding_nudge_week",
      { onboardingUrl: `${CONFIG.frontendBaseUrl}/onboarding` },
      { user: { id: u.id, email: u.email, full_name: u.full_name } },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface VendorShareNudgeRow {
  account_id: number;
  display_name: string;
  owner_user_id: number;
  email: string;
  full_name: string;
}

function sweepVendorProfileShareNudge(ts: number): number {
  // ~2h after a vendor sets up their profile, send a one-shot nudge that
  // highlights the shareable public link (`/vendors/v{id}`) and names any
  // still-empty sections (photos / bio / calendar / packages). One-shot via
  // vendor_accounts.share_nudge_sent_at (stamped BEFORE the fire-and-forget
  // send, so a silent mailer hiccup skips rather than re-sends). Pre-existing
  // vendors were backfilled at migration (db.ts), so only accounts created
  // after this shipped are ever eligible. Demo + purged owners excluded.
  const cutoff = ts - VENDOR_SHARE_NUDGE_AFTER_MS;
  const rows = db
    .prepare(
      `SELECT va.id AS account_id, va.display_name,
              u.id AS owner_user_id, u.email, u.full_name
         FROM vendor_accounts va
         JOIN users u ON u.id = va.owner_user_id
        WHERE va.share_nudge_sent_at IS NULL
          AND va.created_at <= ?
          AND u.status = 'active'
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'`,
    )
    .all(cutoff) as VendorShareNudgeRow[];

  let count = 0;
  const stamp = db.prepare("UPDATE vendor_accounts SET share_nudge_sent_at = ? WHERE id = ?");
  const blockedDates = db.prepare(
    "SELECT COUNT(*) AS n FROM vendor_unavailable_dates WHERE vendor_account_id = ?",
  );
  for (const r of rows) {
    const listingId = `v${r.account_id}`;
    const listing = getListingByVendorAccountId(r.account_id);
    const missing = {
      photos: !listing?.hero_image_url && countListingPhotos(listingId) === 0,
      bio: !(listing?.blurb_hu || listing?.blurb_en),
      calendar: (blockedDates.get(r.account_id) as { n: number }).n === 0,
      packages: countListingPackages(listingId) === 0,
    };
    // Stamp BEFORE the fire-and-forget send — a true one-shot.
    stamp.run(ts, r.account_id);
    void sendKind(
      "vendor_profile_share",
      {
        businessName: r.display_name,
        shareUrl: `${CONFIG.frontendBaseUrl}/vendors/${listingId}`,
        editUrl: `${CONFIG.frontendBaseUrl}/vendor/listing`,
        reviewsUrl: `${CONFIG.frontendBaseUrl}/vendor/reviews`,
        missing,
      },
      { user: { id: r.owner_user_id, email: r.email, full_name: r.full_name }, couple_id: null },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface SoloCoupleRow {
  couple_id: number;
  display_name: string | null;
  created_at: number;
  user_id: number;
  email: string;
  full_name: string;
}

/** First 10:00 UTC at or after `createdAt + 48h`. Exported for tests. */
export function autoInviteDueAt(createdAt: number): number {
  const mark = createdAt + INVITE_PARTNER_AUTO_AFTER_MS;
  const d = new Date(mark);
  const tenAm = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    INVITE_PARTNER_SEND_HOUR_UTC,
  );
  return tenAm >= mark ? tenAm : tenAm + 86_400_000;
}

function sweepPlannerProfileNudge(ts: number): number {
  // Planners who registered > 3 days ago, are live (active + verified email),
  // but still can't be listed in the directory because their business name or
  // city is empty. One-shot via email_dispatches (kind 'planner_profile_incomplete')
  // so a planner is nudged at most once automatically — the admin can still
  // re-send by hand. Demo + purged owners excluded.
  const cutoff = ts - PLANNER_PROFILE_NUDGE_AFTER_MS;
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.business_name, u.planner_city,
              u.planner_bio, u.planner_styles
         FROM users u
        WHERE u.user_type = 'planner'
          AND u.status = 'active'
          AND u.verified_email = 1
          AND u.created_at <= ?
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND (TRIM(COALESCE(u.business_name, '')) = ''
               OR TRIM(COALESCE(u.planner_city, '')) = '')
          AND NOT EXISTS (
            SELECT 1 FROM email_dispatches d
             WHERE d.user_id = u.id AND d.kind = 'planner_profile_incomplete'
          )`,
    )
    .all(cutoff) as PlannerProfileRow[];

  let count = 0;
  for (const r of rows) {
    if (!markDispatched({ kind: "planner_profile_incomplete", couple_id: null, user_id: r.id })) {
      continue;
    }
    sendPlannerProfileReminder(r);
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function sweepInvitePartnerAuto(ts: number): number {
  // Auto-nudge solo workspaces (one active member, partner_b_id IS NULL) to
  // invite their partner. Holds until the first 10:00 UTC at or after the 48h
  // mark since creation. One-shot per workspace via
  // couples.invite_partner_reminded_at, the SAME stamp the manual admin
  // button writes, so the two never double-fire and the admin "sent" icon
  // flips automatically. Already-nudged workspaces (stamp non-null) and ones
  // that gained a partner (partner_b_id non-null) are skipped by the WHERE
  // clause. Demo workspaces and purged users are excluded.
  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.created_at,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND c.partner_b_id IS NULL
          AND c.invite_partner_reminded_at IS NULL
          AND u.status = 'active'
          AND u.email NOT LIKE '%@purged.local'
          AND (SELECT COUNT(*) FROM users m
                WHERE m.couple_id = c.id AND m.status = 'active') = 1`,
    )
    .all() as SoloCoupleRow[];

  let count = 0;
  const stamp = db.prepare("UPDATE couples SET invite_partner_reminded_at = ? WHERE id = ?");
  for (const r of rows) {
    if (ts < autoInviteDueAt(r.created_at)) continue;
    // Stamp BEFORE the fire-and-forget send so a silent mailer hiccup skips
    // rather than re-sends on the next sweep, a true one-shot.
    stamp.run(ts, r.couple_id);
    const coupleDisplayName =
      r.display_name && r.display_name !== "Purged workspace" ? r.display_name : undefined;
    void sendKind(
      "partner_invite_reminder",
      {
        invitePartnerUrl: `${CONFIG.frontendBaseUrl}/app#invite-partner`,
        coupleDisplayName,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
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
      if (count >= SENDS_PER_SWEEP_CAP) break;
    }
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function sweepRsvpDeadline(ts: number): number {
  // T-14 RSVP nudge — runs once per (couple, partner). Sent only when there
  // are still pending RSVPs (no guests = nothing to chase; everyone-replied
  // = nothing useful to say). The unique index on email_dispatches enforces
  // single-fire idempotency, so a restart inside the day's window doesn't
  // double-send.
  const today = startOfDayUtc(ts);
  const target = ymd(today + 14 * 86_400_000);
  const rows = partnersForWeddingDate(target);
  let count = 0;
  for (const r of rows) {
    if (
      !markDispatched({
        kind: "rsvp_deadline_approaching",
        couple_id: r.couple_id,
        user_id: r.user_id,
      })
    )
      continue;
    const pending = countPendingGuests(r.couple_id);
    if (pending <= 0) continue;
    void sendKind(
      "rsvp_deadline_approaching",
      {
        coupleDisplayName: r.display_name,
        weddingDate: r.wedding_date,
        pendingCount: pending,
        guestsUrl: `${CONFIG.frontendBaseUrl}/app/guests`,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function countPendingGuests(coupleId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM guests
        WHERE couple_id = ?
          AND (rsvp_status IS NULL OR rsvp_status = 'pending')`,
    )
    .get(coupleId) as { n: number };
  return row.n;
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
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function sweepWeddingFollowup(ts: number): number {
  // T+7 days after the wedding — NPS / "how was it?" nudge. Mirrors
  // sweepWeddingDay but on the trailing edge. The couple row is still
  // active (we don't purge after the wedding date), so partnersForWeddingDate
  // returns the same partner pairs that ran through the T+0 sweep a week
  // earlier.
  const today = startOfDayUtc(ts);
  const target = ymd(today - 7 * 86_400_000);
  const rows = partnersForWeddingDate(target);
  let count = 0;
  for (const r of rows) {
    if (
      !markDispatched({
        kind: "wedding_today_followup",
        couple_id: r.couple_id,
        user_id: r.user_id,
      })
    )
      continue;
    void sendKind(
      "wedding_today_followup",
      {
        coupleDisplayName: r.display_name,
        feedbackUrl: `${CONFIG.frontendBaseUrl}/app?feedback=1`,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface DigestCoupleRow {
  couple_id: number;
  display_name: string;
  user_id: number;
  email: string;
  full_name: string;
}

function sweepRsvpWeeklyDigest(ts: number): number {
  // Weekly RSVP rollup for couples that flipped rsvp_digest_mode = 'weekly'
  // in Profile. Same Monday + 7-day cooldown pattern as admin_moderation_digest.
  // Skips couples whose roll-up window had zero new RSVPs — no value in a
  // "0 yes / 0 no" mail.
  const todayUtc = new Date(ts);
  const isMonday = todayUtc.getUTCDay() === 1;
  const force = process.env.EMAIL_TEST_FORCE_RSVP_DIGEST === "1";
  if (!isMonday && !force) return 0;

  const oneWeekAgo = ts - 7 * 24 * 60 * 60 * 1000;
  // One row per (couple, partner). The same couple can produce 2 mails — one
  // per partner — because the email_dispatches index is keyed on user_id too.
  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.rsvp_digest_mode = 'weekly'
          AND u.status = 'active'`,
    )
    .all() as DigestCoupleRow[];

  let count = 0;
  for (const r of rows) {
    const lastSent = db
      .prepare(
        "SELECT MAX(dispatched_at) AS at FROM email_dispatches WHERE kind = 'rsvp_weekly_digest_for_couple' AND user_id = ?",
      )
      .get(r.user_id) as { at: number | null };
    if (lastSent.at !== null && lastSent.at > oneWeekAgo) continue;

    const counts = db
      .prepare(
        `SELECT
            SUM(CASE WHEN rsvp_status = 'yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN rsvp_status = 'no' THEN 1 ELSE 0 END) AS no_count,
            SUM(CASE WHEN rsvp_status = 'maybe' THEN 1 ELSE 0 END) AS maybe_count
           FROM guests
          WHERE couple_id = ?
            AND rsvp_responded_at IS NOT NULL
            AND rsvp_responded_at > ?`,
      )
      .get(r.couple_id, oneWeekAgo) as {
      yes_count: number | null;
      no_count: number | null;
      maybe_count: number | null;
    };
    const yesCount = counts.yes_count ?? 0;
    const noCount = counts.no_count ?? 0;
    const maybeCount = counts.maybe_count ?? 0;
    if (yesCount + noCount + maybeCount === 0) continue;

    db.prepare(
      `INSERT OR REPLACE INTO email_dispatches (couple_id, user_id, kind, dispatched_at)
       VALUES (?, ?, 'rsvp_weekly_digest_for_couple', ?)`,
    ).run(r.couple_id, r.user_id, ts);
    void sendKind(
      "rsvp_weekly_digest_for_couple",
      {
        coupleDisplayName: r.display_name,
        yesCount,
        noCount,
        maybeCount,
        guestsUrl: `${CONFIG.frontendBaseUrl}/app/guests`,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface AdminUserRow {
  id: number;
  email: string;
  full_name: string | null;
}

function sweepAdminModerationDigest(ts: number): number {
  // Weekly digest to every admin on the allowlist. Day-of-week gate (Monday)
  // + a 7-day idempotency window via email_dispatches MAX(dispatched_at) so
  // the hourly cron only fires once per admin per week. Production runs
  // hourly; in tests callers usually invoke runEmailSweep directly so the
  // day-of-week check would block them — `EMAIL_TEST_FORCE_ADMIN_DIGEST=1`
  // is the test escape hatch.
  const todayUtc = new Date(ts);
  const isMonday = todayUtc.getUTCDay() === 1;
  const force = process.env.EMAIL_TEST_FORCE_ADMIN_DIGEST === "1";
  if (!isMonday && !force) return 0;

  const adminEmails = CONFIG.adminEmails;
  if (adminEmails.length === 0) return 0;

  // Pull counts ONCE (not per-admin) — the same queue applies to every
  // recipient.
  const awaitingReviewSuppliers = scalar(
    "SELECT COUNT(*) AS n FROM community_suppliers WHERE status = 'awaiting_review'",
  );
  const newVendorWaitlistEntries = scalar(
    "SELECT COUNT(*) AS n FROM vendor_waitlist WHERE status = 'new'",
  );
  const pendingListingClaims = scalar(
    "SELECT COUNT(*) AS n FROM listing_claims WHERE status = 'pending'",
  );
  const unresolvedUserFlags = scalar(
    "SELECT COUNT(*) AS n FROM user_flags WHERE resolved_at IS NULL",
  );
  const total =
    awaitingReviewSuppliers + newVendorWaitlistEntries + pendingListingClaims + unresolvedUserFlags;
  // Skip the mail entirely when the queue is empty — admins don't need a
  // ping that says "nothing to do".
  if (total === 0) return 0;

  const oneWeekAgo = ts - 7 * 24 * 60 * 60 * 1000;
  const twoWeeksAgo = ts - 14 * 24 * 60 * 60 * 1000;
  const newCouplesThisWeek = (
    db
      .prepare("SELECT COUNT(*) AS n FROM couples WHERE created_at >= ? AND is_demo = 0")
      .get(oneWeekAgo) as { n: number }
  ).n;
  const newCouplesLastWeek = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM couples WHERE created_at >= ? AND created_at < ? AND is_demo = 0",
      )
      .get(twoWeeksAgo, oneWeekAgo) as { n: number }
  ).n;
  const newUsersThisWeek = (
    db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND role = 'owner'")
      .get(oneWeekAgo) as { n: number }
  ).n;
  const newUsersLastWeek = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ? AND role = 'owner'",
      )
      .get(twoWeeksAgo, oneWeekAgo) as { n: number }
  ).n;
  let count = 0;
  for (const email of adminEmails) {
    const userRow = db
      .prepare("SELECT id, email, full_name FROM users WHERE LOWER(email) = ?")
      .get(email) as AdminUserRow | undefined;
    if (!userRow) continue;
    // Per-admin 7-day cooldown via email_dispatches. Different from the
    // markDispatched-style hard idempotency because we DO want to fire every
    // week — just not multiple times in the same week.
    const lastSent = db
      .prepare(
        "SELECT MAX(dispatched_at) AS at FROM email_dispatches WHERE kind = 'admin_moderation_digest' AND user_id = ?",
      )
      .get(userRow.id) as { at: number | null };
    if (lastSent.at !== null && lastSent.at > oneWeekAgo) continue;

    // NULL couple_id means SQLite's UNIQUE constraint won't deduplicate; delete
    // the old row first so we don't accumulate one row per sweep indefinitely.
    db.prepare(
      "DELETE FROM email_dispatches WHERE couple_id IS NULL AND user_id = ? AND kind = 'admin_moderation_digest'",
    ).run(userRow.id);
    db.prepare(
      `INSERT INTO email_dispatches (couple_id, user_id, kind, dispatched_at)
       VALUES (NULL, ?, 'admin_moderation_digest', ?)`,
    ).run(userRow.id, ts);
    void sendKind(
      "admin_moderation_digest",
      {
        awaitingReviewSuppliers,
        newVendorWaitlistEntries,
        pendingListingClaims,
        unresolvedUserFlags,
        adminUrl: `${CONFIG.frontendBaseUrl}/app/admin`,
        newCouplesThisWeek,
        newCouplesLastWeek,
        newUsersThisWeek,
        newUsersLastWeek,
      },
      {
        user: { id: userRow.id, email: userRow.email, full_name: userRow.full_name ?? "" },
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface TimelineEscalationRow {
  couple_id: number;
  display_name: string;
  mode: string;
  user_id: number;
  email: string;
  full_name: string;
}

function sweepTimelineEscalation(ts: number): number {
  // Proactive-timeline EMAIL push. The in-app bell is always on; this only
  // fires email when a couple opted in (couples.timeline_email_escalation !=
  // 'off') AND has tasks in the configured trigger set. Re-nudges at most
  // weekly per partner via the digest-style 7-day cooldown (NOT markDispatched,
  // which is once-forever — we want to keep reminding a couple who stays behind).
  const todayIso = toIsoDate(new Date(ts));
  const oneWeekAgo = ts - 7 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.timeline_email_escalation AS mode,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND c.timeline_email_escalation != 'off'
          AND u.status = 'active'
          AND u.email NOT LIKE '%@purged.local'`,
    )
    .all() as TimelineEscalationRow[];

  let count = 0;
  for (const r of rows) {
    const lastSent = db
      .prepare(
        "SELECT MAX(dispatched_at) AS at FROM email_dispatches WHERE kind = 'timeline_escalation' AND user_id = ?",
      )
      .get(r.user_id) as { at: number | null };
    if (lastSent.at !== null && lastSent.at > oneWeekAgo) continue;

    const tasks = listActionableTimelineTasks(r.couple_id, todayIso);
    const overdue = tasks.filter((t) => t.status === "overdue");
    const dueSoon = tasks.filter((t) => t.status === "due_soon");
    const trigger = r.mode === "overdue_due_soon" ? [...overdue, ...dueSoon] : overdue;
    if (trigger.length === 0) continue;

    // Stamp the dispatch BEFORE the fire-and-forget send so a silent mailer
    // hiccup skips rather than re-sends on the next sweep.
    db.prepare(
      "INSERT OR REPLACE INTO email_dispatches (couple_id, user_id, kind, dispatched_at) VALUES (?, ?, 'timeline_escalation', ?)",
    ).run(r.couple_id, r.user_id, ts);
    void sendKind(
      "timeline_escalation",
      {
        coupleDisplayName: r.display_name,
        overdueCount: overdue.length,
        dueSoonCount: r.mode === "overdue_due_soon" ? dueSoon.length : 0,
        sampleTitles: trigger.slice(0, 4).map((t) => t.title),
        timelineUrl: `${CONFIG.frontendBaseUrl}/app/timeline`,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    count++;

    // In-app trace so the bell reflects "we emailed you about the timeline".
    // One couple-scoped row per week (deduped) so both partners' sends don't
    // double it.
    insertCoupleNotification({
      couple_id: r.couple_id,
      kind: "timeline_email_sent",
      data: { overdueCount: overdue.length },
      link: "/app/timeline",
      dedupe_key: `timeline_email:${Math.floor(ts / (7 * 24 * 60 * 60 * 1000))}`,
    });
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

function scalar(sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

interface MealFollowupRow {
  guest_id: number;
  guest_email: string;
  guest_name: string;
  invite_code: string;
  couple_id: number;
  couple_display_name: string;
}

function sweepRsvpMealFollowup(ts: number): number {
  // One-shot nudge to guests who RSVP'd yes but skipped the meal pick. The
  // 24h cooldown after rsvp_responded_at gives second-attempt RSVPs (where
  // the guest just submits then re-opens to add the meal) a chance to land
  // naturally. meal_followup_sent_at is the one-shot stamp — once set, the
  // sweep ignores the row forever.
  const cooldownCutoff = ts - 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT g.id AS guest_id, g.email AS guest_email, g.full_name AS guest_name,
              g.invite_code, c.id AS couple_id, c.display_name AS couple_display_name
         FROM guests g
         JOIN couples c ON c.id = g.couple_id
        WHERE g.rsvp_status = 'yes'
          AND (g.meal_choice IS NULL OR g.meal_choice = '')
          AND g.email IS NOT NULL AND g.email != ''
          AND g.meal_followup_sent_at IS NULL
          AND g.rsvp_responded_at IS NOT NULL
          AND g.rsvp_responded_at <= ?
          AND c.status = 'active'`,
    )
    .all(cooldownCutoff) as MealFollowupRow[];

  let count = 0;
  const stampUpdate = db.prepare("UPDATE guests SET meal_followup_sent_at = ? WHERE id = ?");
  for (const r of rows) {
    // Stamp BEFORE fire-and-forget — if the mailer hiccups silently, we'd
    // rather skip than spam. The stamp turns this into a true one-shot.
    stampUpdate.run(ts, r.guest_id);
    void sendKind(
      "rsvp_followup_missing_meal",
      {
        coupleDisplayName: r.couple_display_name,
        rsvpPageUrl: `${CONFIG.frontendBaseUrl}/rsvp/${r.invite_code}`,
      },
      {
        user: null,
        guest: { email: r.guest_email, full_name: r.guest_name },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
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
    if (
      r.nudges +
        r.nudgesWeek +
        r.invitePartnerAuto +
        r.vendorShareNudges +
        r.milestones +
        r.weddings +
        r.rsvpDeadlines +
        r.weddingFollowups +
        r.mealFollowups +
        r.adminDigests +
        r.rsvpDigests +
        r.timelineEscalations +
        r.scheduledGuestMessages >
      0
    ) {
      log.info("emails.boot_sweep", r);
    }
  } catch (e) {
    reportError("emails.boot_sweep_failed", e);
  }
  timer = setInterval(
    () => {
      try {
        const r = runEmailSweep();
        if (
          r.nudges +
            r.nudgesWeek +
            r.invitePartnerAuto +
            r.vendorShareNudges +
            r.milestones +
            r.weddings +
            r.rsvpDeadlines +
            r.weddingFollowups +
            r.mealFollowups +
            r.adminDigests +
            r.rsvpDigests +
            r.timelineEscalations +
            r.scheduledGuestMessages >
          0
        ) {
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
