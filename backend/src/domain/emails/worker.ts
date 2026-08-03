// Cron-driven lifecycle emails. Runs every hour and:
//   1. Nags users who registered > 24h ago and haven't onboarded a couple yet.
//   2. Fires milestone reminders at T-90 / T-30 / T-7 days before the wedding.
//   3. Sends a "today's the day" note on the wedding morning.
//
// All sends go through `sendKind`, which respects per-user `lifecycle_opt_out`
// and writes to `email_log`. Idempotency is enforced by the unique index on
// `email_dispatches(couple_id, user_id, kind)` — `markDispatched()` returns
// false on duplicate, in which case we skip.

import { FOUNDING_CAP, TRIAL_GRACE_MS, trialGraceEndsAt } from "@shared/billing";
import { toIsoDate } from "@shared/planning_timeline";
import { checkPartnerNames, NAME_REVIEW_GRACE_MS } from "@shared/real_names";
import { INVITE_TTL_MS } from "@shared/types";
import { CONFIG } from "../../config";
import { billingEnforcementOn, db, now } from "../../db";
import { log } from "../../lib/logger";
import { reportError } from "../../lib/observability";
import { foundingSlotsUsed, isFoundingEligible } from "../billing";
import { getCoupleById, isBillingAnchor } from "../couples";
import { generateInviteToken } from "../invite_codes";
import { resolveRecipients, sendGuestMessage } from "../guest_messages";
import { countListingPackages, countListingPhotos, getListingByVendorAccountId } from "../listings";
import { insertCoupleNotification, listActionableTimelineTasks } from "../notifications";
import { listCoupleVendorsToReview } from "../post_wedding_reviews";
import { setLifecycleOptOut } from "./preferences";
import { type PlannerProfileRow, sendPlannerProfileReminder } from "../planner_profile";
import { prepareDueSchedules } from "../campaign_schedules";
import { getCampaignRow, sendCampaignBatch, sendCampaignReminders } from "../vendor_campaign";
import {
  getCampaignRow as getOnboardingCampaignRow,
  sendCampaignBatch as sendOnboardingCampaignBatch,
  sendCampaignReminders as sendOnboardingCampaignReminders,
} from "../onboarding_campaign";
import {
  getCampaignRow as getPersonalInviteCampaignRow,
  sendCampaignBatch as sendPersonalInviteCampaignBatch,
} from "../personal_invite_campaign";
import {
  getCampaignRow as getReviewCampaignRow,
  sendCampaignBatch as sendReviewCampaignBatch,
  sendCampaignReminders as sendReviewCampaignReminders,
} from "../vendor_review_campaign";
import {
  isVendorListingIncomplete,
  sendVendorIncompleteReminder,
  vendorListingMissing,
} from "../vendor_profile";
import type { EmailKind } from "./kinds";
import { markDispatched, sendKind } from "./send";

// Max emails fired per sweep function per hourly run. Caps burst size so
// Resend never sees more than N concurrent requests from a single sweep,
// preventing 429 rate-limit failures when a cohort of accounts all become
// due at the same time. Remaining accounts are picked up in the next sweep.
const SENDS_PER_SWEEP_CAP = 8;

// The send-off window. Two weeks is long enough that the couple is back from
// the honeymoon and short enough that the day is still fresh; three months is
// where a goodbye stops being warm and starts being late.
const FAREWELL_AFTER_DAYS = 14;
const FAREWELL_MAX_AGE_DAYS = 90;

const ONBOARDING_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24; // 24h
const VENDOR_SHARE_NUDGE_AFTER_MS = 1000 * 60 * 60 * 2; // 2h
const ONBOARDING_NUDGE_WEEK_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
// A planner gets ~3 days to finish their profile on their own before the
// one-shot "your profile is missing info" nudge fires.
const PLANNER_PROFILE_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
// Recurring "your listing is still incomplete" reminder. A vendor gets a 2-day
// grace after signup, then a VARYING 2-4 day gap between reminders (so the
// series doesn't feel robotic), capped at MAX sends. Copy variant rotates by
// send count. The gap before the (count+1)-th reminder is indexed by count.
const VENDOR_INCOMPLETE_GRACE_MS = 1000 * 60 * 60 * 24 * 2; // 2 days after signup
const VENDOR_INCOMPLETE_MAX_NUDGES = 5;
const VENDOR_INCOMPLETE_INTERVAL_DAYS = [2, 3, 4, 2, 3];
const INVITE_PARTNER_AUTO_AFTER_MS = 1000 * 60 * 60 * 48; // 48h
// Solo workspaces are auto-nudged at the first 10:00 UTC at or after the 48h
// mark ("48h utáni legközelebbi 10:00"). The worker runs hourly, so the real
// send lands on the first sweep at/after that boundary, within the hour.
const INVITE_PARTNER_SEND_HOUR_UTC = 10;
// Founding-cohort push. Picks up 5 days AFTER the one-shot invite reminder
// above (which itself fires at ~48h), so the couple sees a clean 5-day rhythm
// at roughly day 7 / 12 / 17 rather than two invite mails in the same week.
const FOUNDING_PUSH_GRACE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days after signup
const FOUNDING_PUSH_GAP_MS = 1000 * 60 * 60 * 24 * 5; // 5 days between sends
const FOUNDING_PUSH_MAX_SENDS = 3;
// Honeymoon-planner nudge window. Upper bound is the "within 90 days" ask;
// the lower bound keeps us from asking a couple two weeks out whether they've
// thought about their honeymoon yet.
const HONEYMOON_NUDGE_MIN_DAYS = 14;
const HONEYMOON_NUDGE_MAX_DAYS = 90;
// Win-back for a workspace nobody has opened in three weeks. Three is the
// shortest gap that can't be a holiday or a busy fortnight at work, so the mail
// reads as "we noticed" rather than "we're counting your logins".
const COMEBACK_NUDGE_AFTER_MS = 1000 * 60 * 60 * 24 * 21; // 21 days
// ...but not in the last fortnight before the wedding. "Come and have a look
// around" is a planning message, and by then the couple is executing.
const COMEBACK_MIN_DAYS_BEFORE_WEDDING = 14;
// The exact offsets sweepMilestones owns. The honeymoon nudge yields on these
// days so a couple never gets two lifecycle mails from us at once.
const MILESTONE_DAYS: ReadonlySet<number> = new Set([90, 30, 7]);

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
  foundingPushes: number;
  vendorShareNudges: number;
  vendorIncompleteNudges: number;
  plannerProfileNudges: number;
  honeymoonNudges: number;
  comebackNudges: number;
  milestones: number;
  weddings: number;
  rsvpDeadlines: number;
  weddingFollowups: number;
  weddingFarewells: number;
  mealFollowups: number;
  adminDigests: number;
  rsvpDigests: number;
  timelineEscalations: number;
  scheduledGuestMessages: number;
  nameReviewNotices: number;
  trialEnded: number;
} {
  const ts = now();
  const nudges = sweepOnboardingNudges(ts);
  const nudgesWeek = sweepOnboardingNudgesWeek(ts);
  const invitePartnerAuto = sweepInvitePartnerAuto(ts);
  const foundingPushes = sweepFoundingPartnerPush(ts);
  const trialEnded = sweepTrialEnded(ts);
  const vendorShareNudges = sweepVendorProfileShareNudge(ts);
  const vendorIncompleteNudges = sweepVendorProfileIncomplete(ts);
  const plannerProfileNudges = sweepPlannerProfileNudge(ts);
  const milestones = sweepMilestones(ts);
  const weddings = sweepWeddingDay(ts);
  const rsvpDeadlines = sweepRsvpDeadline(ts);
  const weddingFollowups = sweepWeddingFollowup(ts);
  const weddingFarewells = sweepWeddingFarewell(ts);
  const mealFollowups = sweepRsvpMealFollowup(ts);
  const adminDigests = sweepAdminModerationDigest(ts);
  const rsvpDigests = sweepRsvpWeeklyDigest(ts);
  const timelineEscalations = sweepTimelineEscalation(ts);
  const scheduledGuestMessages = sweepScheduledGuestMessages(ts);
  const nameReviewNotices = sweepNameReviewNotice(ts);
  // Deliberately LAST, both of them. These two are the sweeps that yield to the
  // others: they skip any couple already written to today, so they have to run
  // once everyone else has logged their sends. The honeymoon nudge goes first
  // of the pair because it is the more specific mail (a window, a feature, a
  // deadline) and the comeback nudge is the catch-all.
  const honeymoonNudges = sweepHoneymoonNudge(ts);
  const comebackNudges = sweepComebackNudge(ts);
  return {
    nudges,
    nudgesWeek,
    invitePartnerAuto,
    foundingPushes,
    vendorShareNudges,
    vendorIncompleteNudges,
    plannerProfileNudges,
    honeymoonNudges,
    comebackNudges,
    milestones,
    weddings,
    rsvpDeadlines,
    weddingFollowups,
    weddingFarewells,
    mealFollowups,
    adminDigests,
    rsvpDigests,
    timelineEscalations,
    scheduledGuestMessages,
    nameReviewNotices,
    trialEnded,
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

// A "couple-audience" account for the couple onboarding nudges: a real couple
// user, NOT a vendor listing and NOT a planner. Both flags are NOT NULL DEFAULT
// (role→'owner', user_type→'couple'), so `!=` is NULL-safe. Vendors keep the
// default user_type='couple' (only `role` is set to 'vendor'), so filtering on
// role is what actually excludes them — a vendor with couple_id NULL was
// otherwise treated as an un-onboarded couple and emailed "finish setting up
// your wedding" with a /onboarding CTA. Mirrors domain/planner_conversion.ts.
const COUPLE_AUDIENCE_SQL = "u.role != 'vendor' AND u.user_type != 'planner'";

function sweepOnboardingNudges(ts: number): number {
  // Couple users registered > 24h ago, no couple, not suspended, not nudged.
  const cutoff = ts - ONBOARDING_NUDGE_AFTER_MS;
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.couple_id, u.status, u.created_at
         FROM users u
        WHERE u.couple_id IS NULL
          AND ${COUPLE_AUDIENCE_SQL}
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
          AND ${COUPLE_AUDIENCE_SQL}
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
  for (const r of rows) {
    const listing = getListingByVendorAccountId(r.account_id);
    // The listing's OWN id, for the same reason `vendorListingMissing` uses it:
    // a claimed listing keeps its imported id, so `v<accountId>` counted nothing
    // for two thirds of vendors AND put a dead link in the share mail — the one
    // mail whose entire job is handing the vendor their own URL.
    const listingId = listing?.id ?? `v${r.account_id}`;
    const missing = {
      photos: !listing?.hero_image_url && countListingPhotos(listingId) === 0,
      bio: !(listing?.blurb_hu || listing?.blurb_en),
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

interface VendorIncompleteRow {
  account_id: number;
  display_name: string;
  created_at: number;
  profile_nudge_last_at: number | null;
  profile_nudge_count: number;
  owner_user_id: number;
  email: string;
  full_name: string;
}

function sweepVendorProfileIncomplete(ts: number): number {
  // Recurring reminder to verified, active vendors whose public listing is still
  // missing photo / bio / pricing / packages / availability. First send waits a
  // 2-day grace after signup; later sends wait a VARYING 2-4 day gap keyed on
  // how many already went out; the whole series is capped at
  // VENDOR_INCOMPLETE_MAX_NUDGES. Copy variant rotates by send count so no two
  // reminders read the same. Cadence + count live on vendor_accounts; the
  // lifecycle opt-out + one-click unsubscribe are honoured by sendKind. Demo +
  // purged owners excluded. A vendor whose profile is already complete is picked
  // up by the query but skipped WITHOUT advancing the count, so completing then
  // re-emptying a section resumes the series where it left off.
  const rows = db
    .prepare(
      `SELECT va.id AS account_id, va.display_name, va.created_at,
              va.profile_nudge_last_at, va.profile_nudge_count,
              u.id AS owner_user_id, u.email, u.full_name
         FROM vendor_accounts va
         JOIN users u ON u.id = va.owner_user_id
        WHERE u.status = 'active'
          AND u.verified_email = 1
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND va.profile_nudge_count < ?`,
    )
    .all(VENDOR_INCOMPLETE_MAX_NUDGES) as VendorIncompleteRow[];

  let count = 0;
  for (const r of rows) {
    // Cadence gate: the first send waits out the grace window from signup; every
    // later send waits a varying 2-4 day gap indexed by the count so far.
    if (r.profile_nudge_last_at === null) {
      if (r.created_at > ts - VENDOR_INCOMPLETE_GRACE_MS) continue;
    } else {
      const gapDays =
        VENDOR_INCOMPLETE_INTERVAL_DAYS[
          r.profile_nudge_count % VENDOR_INCOMPLETE_INTERVAL_DAYS.length
        ] ?? 3;
      if (r.profile_nudge_last_at > ts - gapDays * 86_400_000) continue;
    }

    // A reminder is only owed on a listing that is LIVE and finishable. No
    // listing at all means the account is still mid-onboarding, and the mail's
    // own CTA would land on an editor that 404s; a hidden listing is a vendor
    // who took their page down on purpose, and "finish the profile nobody can
    // see" answers a question they didn't ask. Both keep their nudge count
    // untouched, so the series resumes if the listing arrives or comes back.
    const listing = getListingByVendorAccountId(r.account_id);
    if (!listing || listing.status !== "active") continue;

    // Only email if a public-facing section is actually empty. The completeness
    // definition + the stamp-then-send live in domain/vendor_profile.ts, which
    // derives it from the same checklist the vendor's own setup ring draws — so
    // the mail can never name a section the portal calls done.
    const missing = vendorListingMissing(r.account_id);
    if (!isVendorListingIncomplete(missing)) continue; // complete — count untouched
    sendVendorIncompleteReminder(
      {
        id: r.account_id,
        display_name: r.display_name,
        owner_user_id: r.owner_user_id,
        email: r.email,
        full_name: r.full_name,
        profile_nudge_count: r.profile_nudge_count,
      },
      missing,
      ts,
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

interface FoundingPushRow {
  couple_id: number;
  display_name: string | null;
  created_at: number;
  founding_push_count: number;
  founding_push_last_at: number | null;
  user_id: number;
  email: string;
  full_name: string;
}

/** The live `/invite/{token}` link for a couple, so the founding-push mail can
 *  carry something the recipient can actually copy and send. Reuses any
 *  unconsumed, unexpired invite (including one the couple made themselves)
 *  and only mints when there is none, which preserves the "max one outstanding
 *  invite per couple" invariant that handleCreateInvite enforces. A minted row
 *  is marked `source='founding_push'` so it stays invisible to the dashboard
 *  and gets adopted rather than 409'd if the couple later invites by email. */
function foundingPushInviteToken(coupleId: number, inviterUserId: number, ts: number): string {
  const live = db
    .prepare(
      `SELECT token FROM couple_invites
        WHERE couple_id = ? AND consumed_at IS NULL AND expires_at > ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(coupleId, ts) as { token: string } | undefined;
  if (live) return live.token;

  const token = generateInviteToken();
  db.prepare(
    `INSERT INTO couple_invites
      (couple_id, token, invited_email, invited_by_user_id, consumed_at, expires_at, created_at, source)
     VALUES (?, ?, NULL, ?, NULL, ?, ?, 'founding_push')`,
  ).run(coupleId, token, inviterUserId, ts + INVITE_TTL_MS, ts);
  return token;
}

function sweepFoundingPartnerPush(ts: number): number {
  // Recurring push (FOUNDING_PUSH_MAX_SENDS sends, 5 days apart, rotating copy)
  // telling a solo workspace that the free-until-your-wedding-day founding plan
  // needs BOTH partners on board.
  //
  // The audience is deliberately narrow, because every exclusion here mirrors a
  // refusal inside activatePartnerFreeWindow — we never pitch an offer the
  // grant would decline:
  //   - founding slots exhausted     → isFoundingEligible() gates the whole sweep
  //   - already founding/active/past_due → the grant refuses, so the promise is void
  //   - not the billing anchor       → founding is a per-owner grant earned once
  //                                    on the oldest workspace, so a secondary
  //                                    event must not be pitched at all
  // Demo workspaces, purged users, vendors and planners are excluded as usual.
  if (!isFoundingEligible()) return 0;
  const spotsLeft = Math.max(0, FOUNDING_CAP - foundingSlotsUsed());

  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.created_at,
              c.founding_push_count, c.founding_push_last_at,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND c.partner_b_id IS NULL
          AND c.founding_push_count < ?
          AND c.subscription_status NOT IN ('founding', 'active', 'past_due')
          AND u.status = 'active'
          AND u.verified_email = 1
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND ${COUPLE_AUDIENCE_SQL}
          AND (SELECT COUNT(*) FROM couple_members cm
                 JOIN users mu ON mu.id = cm.user_id
                WHERE cm.couple_id = c.id AND mu.status = 'active') = 1`,
    )
    .all(FOUNDING_PUSH_MAX_SENDS) as FoundingPushRow[];

  let count = 0;
  const stamp = db.prepare(
    `UPDATE couples
        SET founding_push_last_at = ?, founding_push_count = founding_push_count + 1
      WHERE id = ?`,
  );
  for (const r of rows) {
    // Cadence gate: the first push waits out the grace window from signup, then
    // every later one waits a fixed 5 days from the previous send.
    if (r.founding_push_last_at === null) {
      if (r.created_at > ts - FOUNDING_PUSH_GRACE_MS) continue;
    } else if (r.founding_push_last_at > ts - FOUNDING_PUSH_GAP_MS) {
      continue;
    }

    // Founding is earned once per owner on their oldest workspace, so a
    // secondary event workspace can never be granted it (isBillingAnchor
    // guards activatePartnerFreeWindow). Pitching it there would be a lie.
    const couple = getCoupleById(r.couple_id);
    if (!couple || !isBillingAnchor(couple)) continue;

    const token = foundingPushInviteToken(r.couple_id, r.user_id, ts);
    const inviteUrl = `${CONFIG.frontendBaseUrl}/invite/${token}`;
    const coupleDisplayName =
      r.display_name && r.display_name !== "Purged workspace" ? r.display_name : undefined;

    // Stamp BEFORE the fire-and-forget send: a silent mailer hiccup should skip
    // this couple, not re-send to them on the next hourly sweep.
    stamp.run(ts, r.couple_id);
    void sendKind(
      "founding_partner_push",
      {
        invitePartnerUrl: `${CONFIG.frontendBaseUrl}/app#invite-partner`,
        inviteUrl,
        shareMailtoUrl: foundingPushMailto(inviteUrl),
        spotsLeft,
        coupleDisplayName,
        variant: r.founding_push_count,
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

interface TrialEndedRow {
  couple_id: number;
  display_name: string | null;
  trial_ends_at: number;
  user_id: number;
  email: string;
  full_name: string | null;
  locale: string | null;
}

/** The trial-boundary notice: once per couple, at the moment the window closes,
 *  naming the two ways on and the date the grace period ends.
 *
 *  Audience rules, each mirroring something the billing code actually does:
 *    - `trialing` with a trial_ends_at in the PAST, and still inside the grace
 *      window. Past the grace there is nothing to offer a deadline about, and a
 *      late first contact would arrive after the freeze, which is the one order
 *      that makes the mail useless.
 *    - Billing anchor only. A secondary event rides its anchor's verdict
 *      (billingAnchorRow), so mailing about "your trial" per workspace would
 *      write three times about one wedding.
 *    - Not demo, not purged, verified, couple audience: the usual exclusions.
 *
 *  Deliberately NOT gated on having a partner. A couple who already invited
 *  their partner but never got founding (the cohort filled) still has a real
 *  deadline, and the mail's second route is the one that applies to them.
 *
 *  ONE recipient per couple, the OWNER. `email_dispatches` is unique on
 *  (couple_id, user_id, kind), so joining every member would mail both partners
 *  the same deadline inside a single sweep. The owner is also the person who can
 *  act on route two, since they hold the subscription.
 *
 *  SILENT while the global go-live switch is off. The mail's second route says
 *  "add payment details by this date and the workspace keeps editing without a
 *  break", which is only true if something would otherwise break it. With the
 *  freeze deferred nothing does, so the deadline would be a threat we are not
 *  carrying out, sent to couples who then find the app works fine either way.
 *  That teaches them to ignore the next one. */
function sweepTrialEnded(ts: number): number {
  if (!billingEnforcementOn()) return 0;
  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.trial_ends_at,
              u.id AS user_id, u.email, u.full_name, u.locale
         FROM couples c
         JOIN users u ON u.id = COALESCE(
               (SELECT o.user_id FROM couple_members o
                 WHERE o.couple_id = c.id AND o.role = 'owner'
                 ORDER BY o.created_at ASC, o.user_id ASC LIMIT 1),
               c.partner_a_id)
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND c.subscription_status = 'trialing'
          AND c.trial_ends_at IS NOT NULL
          AND c.trial_ends_at <= ?
          AND c.trial_ends_at > ?
          AND u.status = 'active'
          AND u.verified_email = 1
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND ${COUPLE_AUDIENCE_SQL}
          AND NOT EXISTS (
            SELECT 1 FROM email_dispatches d
             WHERE d.couple_id = c.id AND d.kind = 'trial_ended'
          )`,
    )
    .all(ts, ts - TRIAL_GRACE_MS) as TrialEndedRow[];

  let count = 0;
  for (const r of rows) {
    const couple = getCoupleById(r.couple_id);
    if (!couple || !isBillingAnchor(couple)) continue;

    const graceEnd = trialGraceEndsAt(r.trial_ends_at);
    // Round UP: with 6 days and 4 hours left, "6 days" reads as a day more than
    // the couple has on the last afternoon, and a deadline must never overstate
    // the room left.
    const graceDays = Math.max(1, Math.ceil((graceEnd - ts) / (1000 * 60 * 60 * 24)));
    const hu = (r.locale ?? "").toLowerCase().startsWith("hu");
    const graceEndsLabel = new Intl.DateTimeFormat(hu ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(graceEnd));

    if (!markDispatched({ kind: "trial_ended", couple_id: r.couple_id, user_id: r.user_id })) {
      continue;
    }
    void sendKind(
      "trial_ended",
      {
        inviteUrl: `${CONFIG.frontendBaseUrl}/app#invite-partner`,
        billingUrl: `${CONFIG.frontendBaseUrl}/app/settings?tab=subscription`,
        graceEndsLabel,
        graceDays,
        coupleDisplayName:
          r.display_name && r.display_name !== "Purged workspace" ? r.display_name : null,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name ?? "" },
        couple_id: r.couple_id,
      },
    );
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

/** Prefilled hand-off mail, partner A → partner B. Bilingual on purpose: the
 *  sender's locale is known but the partner's isn't, and this body is what
 *  lands in a stranger's inbox. No couple display name in the copy: it reads
 *  as a label ("planning Mia & Lucas wedding") in at least one of the two
 *  languages no matter how it's phrased, and "our wedding" is what a person
 *  writing to their fiancé would actually say. */
function foundingPushMailto(inviteUrl: string): string {
  const subject = "Csatlakozol az esküvőnk tervezéséhez? / Join our wedding planner";
  const body = [
    "Szia! Elkezdtem az esküvőnk tervezését a Weddly-n, és szeretnélek téged is ott tudni.",
    "Ezen a linken tudsz csatlakozni:",
    inviteUrl,
    "",
    "Hi! I've started planning our wedding on Weddly and I'd like you on it with me.",
    "You can join here:",
    inviteUrl,
  ].join("\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

interface HoneymoonNudgeRow {
  couple_id: number;
  display_name: string | null;
  wedding_date: string;
  user_id: number;
  email: string;
  full_name: string;
}

function sweepHoneymoonNudge(ts: number): number {
  // One-shot nudge into /app/honeymoon for couples inside the 90-day window who
  // have never touched the planner. Adoption is the reason this exists: the
  // admin dashboard can't even draw its charts yet (they unlock at 10 couples
  // with a destination).
  //
  // Two deliberate boundaries:
  //   - Days 90, 30 and 7 are skipped. The milestone mails that fire on exactly
  //     those days promise in their own footnote that we only write at 90/30/7,
  //     so landing a second lifecycle mail the same day would break that. The
  //     send is one-shot, not date-pinned, so a couple skipped today simply
  //     gets it tomorrow.
  //   - The window bottoms out at HONEYMOON_NUDGE_MIN_DAYS. Closer in, "have
  //     you planned your honeymoon?" stops being a helpful nudge and starts
  //     being a source of panic, and the fares it would show are the expensive
  //     ones.
  //
  // "Never touched" is stricter than the dashboard's adoption metric (which
  // only looks at honeymoon_destination): a couple who priced the trip or ran
  // the task wand HAS used the feature, and would read this as us not paying
  // attention.
  //
  // The budget check keys on `preset_key`, NOT on the mere existence of a
  // honeymoon budget line. Onboarding seeds every couple a "Honeymoon" line at
  // 300k planned, so "has a honeymoon budget row" is true for literally
  // everyone and would silence the sweep completely. `preset_key` is only set
  // by the honeymoon page itself, by a cost-preset chip or by saving a flight
  // offer, so it means a human was actually on that screen.
  const today = startOfDayUtc(ts);
  const from = ymd(today + HONEYMOON_NUDGE_MIN_DAYS * 86_400_000);
  const to = ymd(today + HONEYMOON_NUDGE_MAX_DAYS * 86_400_000);

  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.wedding_date,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND c.wedding_date BETWEEN ? AND ?
          AND u.status = 'active'
          AND u.verified_email = 1
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND ${COUPLE_AUDIENCE_SQL}
          AND COALESCE(TRIM(c.honeymoon_destination), '') = ''
          AND COALESCE(TRIM(c.honeymoon_start_date), '') = ''
          AND COALESCE(TRIM(c.honeymoon_end_date), '') = ''
          AND COALESCE(TRIM(c.honeymoon_origin_iata), '') = ''
          AND c.honeymoon_cover_path IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM budget_lines bl
                 WHERE bl.couple_id = c.id AND bl.category = 'honeymoon'
                   AND bl.preset_key IS NOT NULL)
          AND NOT EXISTS (
                SELECT 1 FROM planning_items pi
                 WHERE pi.couple_id = c.id AND pi.topic = 'honeymoon')`,
    )
    .all(from, to) as HoneymoonNudgeRow[];

  // Has this couple already had a lifecycle mail from us in the last 24h? This
  // nudge is one-shot and not date-critical, so it always yields rather than
  // arriving as the second marketing email of the day. Transactional mail
  // (verify, password reset) doesn't count, since that's mail the user asked
  // for and expects.
  const wroteToday = db.prepare(
    `SELECT 1 FROM email_log
      WHERE couple_id = ? AND category = 'lifecycle' AND created_at > ?
      LIMIT 1`,
  );

  let count = 0;
  for (const r of rows) {
    const daysUntil = Math.round((Date.parse(`${r.wedding_date}T00:00:00Z`) - today) / 86_400_000);
    if (!Number.isFinite(daysUntil)) continue;
    // Kept as an explicit guard on top of the 24h check below: it holds even if
    // this sweep is ever reordered ahead of sweepMilestones.
    if (MILESTONE_DAYS.has(daysUntil)) continue;
    if (wroteToday.get(r.couple_id, ts - 86_400_000)) continue;
    if (!markDispatched({ kind: "honeymoon_nudge", couple_id: r.couple_id, user_id: r.user_id })) {
      continue;
    }
    void sendKind(
      "honeymoon_nudge",
      {
        honeymoonUrl: `${CONFIG.frontendBaseUrl}/app/honeymoon`,
        daysUntil,
        coupleDisplayName:
          r.display_name && r.display_name !== "Purged workspace" ? r.display_name : undefined,
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

interface ComebackNudgeRow {
  couple_id: number;
  display_name: string | null;
  wedding_date: string | null;
  user_id: number;
  email: string;
  full_name: string;
  /** Newest `last_seen_at` across EVERYONE in the workspace. */
  last_seen: number;
}

function sweepComebackNudge(ts: number): number {
  // One win-back mail to a workspace nobody has opened in three weeks: what
  // shipped while they were away, and a way back in.
  //
  // The unit is the WORKSPACE, not the person. `last_seen` is the newest
  // last_seen_at across every member, so a couple where one partner is in the
  // budget every evening never gets told nothing is happening. When it does
  // fire, both partners hear it, same as the milestone mails.
  //
  // Two guards keep this from becoming noise:
  //   - It stops COMEBACK_MIN_DAYS_BEFORE_WEDDING out. Inside that fortnight the
  //     couple is executing, not planning, and the T-7 milestone owns the
  //     relationship. A wedding already behind them is excluded outright: their
  //     arc ends with wedding_today_followup and the farewell.
  //   - It yields to any lifecycle mail from the last 24h, like the honeymoon
  //     nudge. Being away three weeks is not urgent, so it can wait for a quiet
  //     day rather than being the second marketing mail of one.
  //
  // One-shot per (couple, user) via email_dispatches, deliberately. A couple who
  // stays away is making a choice, and a drip that keeps reminding them they're
  // absent is the fastest way to earn an unsubscribe. If a second, later touch
  // is ever wanted, it should be its own kind with its own copy.
  const cutoff = ts - COMEBACK_NUDGE_AFTER_MS;
  const today = startOfDayUtc(ts);
  const earliestWedding = ymd(today + COMEBACK_MIN_DAYS_BEFORE_WEDDING * 86_400_000);

  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.wedding_date,
              u.id AS user_id, u.email, u.full_name,
              (SELECT MAX(COALESCE(u2.last_seen_at, u2.created_at))
                 FROM users u2 WHERE u2.couple_id = c.id) AS last_seen
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.is_demo = 0
          AND u.status = 'active'
          AND u.verified_email = 1
          AND u.email NOT LIKE '%@purged.local'
          AND u.email NOT LIKE '%@demo.weddly.local'
          AND ${COUPLE_AUDIENCE_SQL}
          AND (c.wedding_date IS NULL OR TRIM(c.wedding_date) = '' OR c.wedding_date >= ?)
          AND last_seen <= ?
        ORDER BY last_seen ASC`,
    )
    .all(earliestWedding, cutoff) as ComebackNudgeRow[];

  const wroteToday = db.prepare(
    `SELECT 1 FROM email_log
      WHERE couple_id = ? AND category = 'lifecycle' AND created_at > ?
      LIMIT 1`,
  );

  // Grouped by workspace, because the quiet-day check is a WORKSPACE question.
  // Asked per row it answers itself: the first partner's send lands in
  // email_log before the loop reaches the second, and the couple's other half
  // silently never hears from us.
  const byCouple = new Map<number, ComebackNudgeRow[]>();
  for (const r of rows) {
    const list = byCouple.get(r.couple_id);
    if (list) list.push(r);
    else byCouple.set(r.couple_id, [r]);
  }

  let count = 0;
  for (const [coupleId, members] of byCouple) {
    // Checked at the workspace boundary, not per member, so a couple is always
    // mailed whole. Overshooting the cap by one partner beats a household where
    // one of them got the mail and the other is left waiting an hour.
    if (count >= SENDS_PER_SWEEP_CAP) break;
    if (wroteToday.get(coupleId, ts - 86_400_000)) continue;
    for (const r of members) {
      if (!markDispatched({ kind: "comeback_nudge", couple_id: coupleId, user_id: r.user_id })) {
        continue;
      }
      const daysUntil =
        r.wedding_date && r.wedding_date.trim()
          ? Math.round((Date.parse(`${r.wedding_date}T00:00:00Z`) - today) / 86_400_000)
          : null;
      void sendKind(
        "comeback_nudge",
        {
          appUrl: `${CONFIG.frontendBaseUrl}/app`,
          daysAway: Math.floor((ts - r.last_seen) / 86_400_000),
          ...(daysUntil !== null && Number.isFinite(daysUntil)
            ? { daysUntilWedding: daysUntil }
            : {}),
          coupleDisplayName:
            r.display_name && r.display_name !== "Purged workspace" ? r.display_name : undefined,
        },
        {
          user: { id: r.user_id, email: r.email, full_name: r.full_name },
          couple_id: coupleId,
        },
      );
      count++;
    }
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
  // T+7 days after the wedding, the trailing-edge touch. Mirrors sweepWeddingDay
  // but a week later (the couple row is still active — we don't purge after the
  // wedding). When the couple actually picked vendors, this becomes the
  // actionable "rate the vendors you used" prompt (email + in-app notification,
  // one-click stars on /app/rate-vendors) instead of the generic "how was it?"
  // NPS — that is what a post-wedding email should drive, and it keeps the T+7
  // touch to a single mail. Couples with no concrete vendor to rate still get
  // the NPS.
  const today = startOfDayUtc(ts);
  const target = ymd(today - 7 * 86_400_000);
  const rows = partnersForWeddingDate(target);
  let count = 0;
  const notified = new Set<number>();
  for (const r of rows) {
    const vendors = listCoupleVendorsToReview(r.couple_id);
    if (vendors.length > 0) {
      if (
        !markDispatched({
          kind: "post_wedding_review_request",
          couple_id: r.couple_id,
          user_id: r.user_id,
        })
      )
        continue;
      // One in-app notification per couple (both partners share the feed).
      if (!notified.has(r.couple_id)) {
        insertCoupleNotification({
          couple_id: r.couple_id,
          kind: "review_vendors",
          data: { count: vendors.length },
          link: "/app/rate-vendors",
          dedupe_key: `review_vendors:${r.couple_id}`,
        });
        notified.add(r.couple_id);
      }
      void sendKind(
        "post_wedding_review_request",
        {
          ctaUrl: `${CONFIG.frontendBaseUrl}/app/rate-vendors`,
          vendorNames: vendors.slice(0, 8).map((v) => v.name),
        },
        {
          user: { id: r.user_id, email: r.email, full_name: r.full_name },
          couple_id: r.couple_id,
        },
      );
    } else {
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
    }
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

// T+14, the send-off. A week after the rate-your-vendors touch, we congratulate
// the couple, ask twice (feedback + vendor stars) and then stop writing for
// good: each recipient is flipped to `lifecycle_opt_out` the moment their mail
// is handed off. There is no follow-up and no reminder by design — a couple
// whose wedding is behind them has no reason to keep hearing from a planning
// tool, and the goodwill of a clean exit is worth more than another nudge.
//
// Note the opt-out is user-keyed, so a person who later plans a SECOND event
// starts out silenced. That is the right trade at this size (it is one
// checkbox in Profile to undo, and re-engaging someone who asked for nothing is
// the worse failure), but it is the thing to revisit if second weddings become
// common.
function sweepWeddingFarewell(ts: number): number {
  const today = startOfDayUtc(ts);
  // A WINDOW, not the single T+14 day the other wedding sweeps match on. A
  // one-day match only ever reaches couples whose 14th day falls after this
  // code ships; every couple already married by then would silently never get
  // a send-off, which is most of the cohort on the day it launches. The window
  // drains that backlog once (markDispatched + the opt-out make it once-only)
  // and afterwards only ever matches couples crossing T+14 normally.
  //
  // The far edge matters as much as the near one: past ~3 months a "the big day
  // is behind you, here's our goodbye" mail stops reading as thoughtful and
  // starts reading as a system that lost track of time. Those couples get
  // nothing rather than something awkward.
  const rows = partnersForWeddingDateRange(
    ymd(today - FAREWELL_MAX_AGE_DAYS * 86_400_000),
    ymd(today - FAREWELL_AFTER_DAYS * 86_400_000),
  );
  let count = 0;
  for (const r of rows) {
    if (!markDispatched({ kind: "wedding_farewell", couple_id: r.couple_id, user_id: r.user_id }))
      continue;
    // Only offer the review link when there is actually something left to rate;
    // the T+7 mail may already have collected them all.
    const hasVendors = listCoupleVendorsToReview(r.couple_id).length > 0;
    void sendKind(
      "wedding_farewell",
      {
        coupleDisplayName: r.display_name,
        ctaUrl: `${CONFIG.frontendBaseUrl}/app?feedback=1`,
        reviewUrl: hasVendors ? `${CONFIG.frontendBaseUrl}/app/rate-vendors` : null,
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    ).then(() => {
      // AFTER the handoff, never before: `lifecycle_opt_out` makes the
      // dispatcher skip lifecycle mail, so setting it first would suppress this
      // very email. `sendKind` never rejects, so this always runs.
      setLifecycleOptOut(r.user_id, true);
    });
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  return count;
}

interface NameReviewCoupleRow {
  couple_id: number;
  bride_name: string;
  groom_name: string;
  name_flagged_at: number;
  user_id: number;
  email: string;
  full_name: string;
}

/**
 * Tell a flagged couple their names read as placeholders and name the date.
 *
 * BOTH partners get it, because either of them can fix it and a notice that
 * reaches only the one who is not reading their email is no notice at all.
 * `couples.name_notice_sent_at` is stamped once per workspace so the second
 * partner's send doesn't re-arm the first; `markDispatched` then makes it
 * once-per-user on top of that.
 *
 * The names are re-checked HERE rather than trusted from the flag, so a couple
 * who fixed theirs between the backfill and the sweep is never written to.
 */
function sweepNameReviewNotice(ts: number): number {
  const rows = db
    .prepare(
      `SELECT c.id AS couple_id, c.bride_name, c.groom_name, c.name_flagged_at,
              u.id AS user_id, u.email, u.full_name
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.name_flagged_at IS NOT NULL
          AND c.name_notice_sent_at IS NULL
          AND c.status = 'active'
          AND c.is_demo = 0
          AND u.status = 'active'`,
    )
    .all() as NameReviewCoupleRow[];

  let count = 0;
  const notified = new Set<number>();
  for (const r of rows) {
    if (checkPartnerNames(r).length === 0) continue;
    if (!markDispatched({ kind: "name_review_notice", couple_id: r.couple_id, user_id: r.user_id }))
      continue;
    const deadline = new Date(r.name_flagged_at + NAME_REVIEW_GRACE_MS);
    void sendKind(
      "name_review_notice",
      {
        currentNames: `${r.bride_name} & ${r.groom_name}`,
        deadlineDateHu: deadline.toLocaleDateString("hu-HU", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        deadlineDateEn: deadline.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      },
      {
        user: { id: r.user_id, email: r.email, full_name: r.full_name },
        couple_id: r.couple_id,
      },
    );
    notified.add(r.couple_id);
    count++;
    if (count >= SENDS_PER_SWEEP_CAP) break;
  }
  // Stamped after the loop, so both partners of one workspace are written to on
  // the same pass rather than the second being skipped by the first's stamp.
  const stamp = db.prepare("UPDATE couples SET name_notice_sent_at = ? WHERE id = ?");
  for (const coupleId of notified) stamp.run(ts, coupleId);
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

/** Partners of every active couple whose wedding falls in a closed date range.
 *  The farewell needs a WINDOW rather than the single-day match the other
 *  wedding sweeps use — see `sweepWeddingFarewell`. */
function partnersForWeddingDateRange(fromDate: string, toDate: string): CouplePartnerRow[] {
  return db
    .prepare(
      `SELECT c.id AS couple_id, c.display_name, c.wedding_date,
              u.id AS user_id, u.email, u.full_name, u.status AS user_status
         FROM couples c
         JOIN users u ON u.couple_id = c.id
        WHERE c.status = 'active'
          AND c.wedding_date >= ?
          AND c.wedding_date <= ?
          AND u.status = 'active'
        ORDER BY c.wedding_date DESC`,
    )
    .all(fromDate, toDate) as CouplePartnerRow[];
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

/** Total sends across every sweep, used only to decide whether a run is worth
 *  a log line. Summed over the values rather than a hand-written chain: the
 *  chain was maintained by hand and had already drifted (vendorIncompleteNudges
 *  and plannerProfileNudges were missing from one or both call sites), so a new
 *  sweep silently failed to count. Every field of the return type is a count. */
function sweepTotal(r: Record<string, number>): number {
  return Object.values(r).reduce((sum, n) => sum + n, 0);
}

/** Start the hourly sweep. Idempotent. */
// ── Vendor claim-invite campaign ────────────────────────────────────────────
// Kept OUT of `runEmailSweep` and awaited separately: every other sweep fires
// `void sendKind(...)` and counts what it queued, but a campaign send has to
// await its own result to record delivered-vs-failed per recipient. Making the
// whole sweep async for one caller would be the wrong trade.

/** Per-sweep slice of a campaign's daily budget. The worker ticks hourly, so
 *  ceil(cap/24) spreads the day's volume evenly instead of firing the whole
 *  allowance in the first hour: a smooth trickle is what keeps a cold campaign
 *  out of spam folders. Never exceeds the general per-sweep burst cap. */
function campaignSlicePerSweep(dailyCap: number): number {
  return Math.max(1, Math.min(SENDS_PER_SWEEP_CAP, Math.ceil(dailyCap / 24)));
}

/** Pace out every running claim-invite campaign, then fire the one-shot 2-day
 *  reminders. Returns counts so tests can assert without wall-clock waits. */
export async function runCampaignSweep(
  ts: number = now(),
): Promise<{ invites: number; reminders: number }> {
  let invites = 0;
  const running = db
    .prepare("SELECT * FROM vendor_claim_campaigns WHERE status = 'running' ORDER BY id ASC")
    .all() as Array<{ id: number; daily_cap: number; country: string | null; status: string }>;
  for (const row of running) {
    const campaign = getCampaignRow(row.id);
    if (!campaign) continue;
    invites += await sendCampaignBatch(campaign, campaignSlicePerSweep(campaign.daily_cap), ts);
  }
  const reminders = await sendCampaignReminders(SENDS_PER_SWEEP_CAP, ts);
  return { invites, reminders };
}

/** Pace out every running review-invite campaign, then fire the one-shot 7-day
 *  reminders. Sibling of runCampaignSweep against the review-campaign tables. */
export async function runReviewCampaignSweep(
  ts: number = now(),
): Promise<{ invites: number; reminders: number }> {
  let invites = 0;
  const running = db
    .prepare("SELECT * FROM vendor_review_campaigns WHERE status = 'running' ORDER BY id ASC")
    .all() as Array<{ id: number; daily_cap: number }>;
  for (const row of running) {
    const campaign = getReviewCampaignRow(row.id);
    if (!campaign) continue;
    invites += await sendReviewCampaignBatch(
      campaign,
      campaignSlicePerSweep(campaign.daily_cap),
      ts,
    );
  }
  const reminders = await sendReviewCampaignReminders(SENDS_PER_SWEEP_CAP, ts);
  return { invites, reminders };
}

/** Pace out every running personal-invite campaign. No reminders on this
 *  family: it's a one-shot note to the founder's own contacts. Sibling of the
 *  two runners above against the personal_invite tables. */
export async function runPersonalInviteCampaignSweep(
  ts: number = now(),
): Promise<{ invites: number }> {
  let invites = 0;
  const running = db
    .prepare("SELECT * FROM personal_invite_campaigns WHERE status = 'running' ORDER BY id ASC")
    .all() as Array<{ id: number; daily_cap: number }>;
  for (const row of running) {
    const campaign = getPersonalInviteCampaignRow(row.id);
    if (!campaign) continue;
    invites += await sendPersonalInviteCampaignBatch(
      campaign,
      campaignSlicePerSweep(campaign.daily_cap),
      ts,
    );
  }
  return { invites };
}

/** Pace out every running onboarding re-engagement campaign, then send the one
 *  reminder wave across non-paused campaigns. Sibling of the runners above
 *  against the onboarding_campaign tables. */
export async function runOnboardingCampaignSweep(
  ts: number = now(),
): Promise<{ invites: number; reminders: number }> {
  let invites = 0;
  const running = db
    .prepare("SELECT * FROM onboarding_campaigns WHERE status = 'running' ORDER BY id ASC")
    .all() as Array<{ id: number; daily_cap: number }>;
  for (const row of running) {
    const campaign = getOnboardingCampaignRow(row.id);
    if (!campaign) continue;
    invites += await sendOnboardingCampaignBatch(
      campaign,
      campaignSlicePerSweep(campaign.daily_cap),
      ts,
    );
  }
  const reminders = await sendOnboardingCampaignReminders(SENDS_PER_SWEEP_CAP, ts);
  return { invites, reminders };
}

function kickCampaignSweep(label: string): void {
  // Compose what the plan says is due BEFORE the send pass, so a campaign that
  // becomes due this hour and has auto_start on goes out on this tick rather
  // than idling until the next one. Synchronous and mail-free (it only creates
  // paused campaigns), so it cannot delay the sends behind it.
  try {
    const { prepared } = prepareDueSchedules();
    if (prepared > 0) log.info("campaign_schedules.prepared_due", { prepared });
  } catch (e) {
    reportError("campaign_schedules.prepare_failed", e);
  }
  // Fire-and-forget at the timer boundary: the interval callback is sync, and a
  // campaign batch can take seconds. Failures are reported, never thrown. All
  // campaign families (claim-invite + review-invite + personal-invite +
  // onboarding) ride the same tick.
  void Promise.all([
    runCampaignSweep(),
    runReviewCampaignSweep(),
    runPersonalInviteCampaignSweep(),
    runOnboardingCampaignSweep(),
  ])
    .then(([claim, review, personal, onboarding]) => {
      const total =
        claim.invites +
        claim.reminders +
        review.invites +
        review.reminders +
        personal.invites +
        onboarding.invites +
        onboarding.reminders;
      if (total > 0) log.info(label, { claim, review, personal, onboarding });
    })
    .catch((e) => reportError("emails.campaign_sweep_failed", e));
}

export function startEmailWorker(): void {
  if (timer) return;
  // Fire once on boot so a long downtime catches up immediately.
  try {
    const r = runEmailSweep();
    if (sweepTotal(r) > 0) {
      log.info("emails.boot_sweep", r);
    }
  } catch (e) {
    reportError("emails.boot_sweep_failed", e);
  }
  kickCampaignSweep("emails.boot_campaign_sweep");
  timer = setInterval(
    () => {
      try {
        const r = runEmailSweep();
        if (sweepTotal(r) > 0) {
          log.info("emails.hourly_sweep", r);
        }
      } catch (e) {
        reportError("emails.hourly_sweep_failed", e);
      }
      kickCampaignSweep("emails.hourly_campaign_sweep");
    },
    1000 * 60 * 60,
  );
}

export function stopEmailWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
