// Onboarding re-engagement campaign: an admin-run, paced blast to REGISTERED
// couple accounts that verified their email but never onboarded (no workspace:
// users.couple_id IS NULL).
//
// This is the manual counterpart to the automatic 24h + 1-week onboarding drip
// in domain/emails/worker.ts. That drip fires ONCE per user forever (guarded by
// email_dispatches), so a stale orphan cohort it already exhausted can only be
// re-nudged from here. It is a fourth sibling of the vendor / personal-invite
// campaigns, deliberately parallel.
//
// Unlike personal-invite (a fixed CSV list), the audience is a LIVE query over
// `users`: the operator "syncs" the current orphan segment into 'queued' send
// rows; the paced sweep then drains them up to the rolling-24h daily_cap,
// RE-checking onboarded/opt-out at send time so anyone who onboards or opts out
// between sync and send is never mailed. Conversion needs no click-tracking:
// the CTA carries a UTM the acquisition capture reads, and `converted` is
// computed live from whether the targeted user gained a couple_id. One reminder
// wave is gated on STILL-not-onboarded (not on opens/clicks, which are noisy).

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CreateOnboardingCampaignInput,
  ONBOARDING_CAMPAIGN_DEFAULT_DAILY_CAP,
  ONBOARDING_CAMPAIGN_MAX_DAILY_CAP,
  type OnboardingCampaign,
  type OnboardingCampaignDetail,
  type OnboardingCampaignSend,
  type OnboardingCampaignSendStatus,
  type OnboardingCampaignStats,
  type OnboardingCampaignStatus,
  type OnboardingCampaignSyncResult,
  type UpdateOnboardingCampaignInput,
} from "@shared/onboarding_campaign";
import { CONFIG } from "../config";
import { db, now, VISITOR_SYSTEM_USER_EMAIL } from "../db";
import { HttpError } from "../lib/http";
import { addOptOut, isOptedOut, normalizeEmail } from "./emails/optouts";
import { sendKind } from "./emails/send";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
// Gap before the single reminder wave. Lower-urgency than the vendor claim
// campaign's 2 days (that one races a cold outreach window); a dormant account
// deserves a slightly longer breather.
const REMINDER_AFTER_MS = 4 * ONE_DAY_MS;
const DEMO_EMAIL_SUFFIX = "@demo.weddly.local";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

// ── The eligible-orphan segment ───────────────────────────────────────────────
// A verified, active couple account with no workspace. Mirrors the admin
// "Munkaterület nélküli felhasználók" list (role != vendor, user_type !=
// planner, non-demo, non-purged, not the reserved visitor system user), and
// ADDS verified_email = 1: an unverified account can't log in (hard gate), so
// nudging it to "finish onboarding" would dead-end at the verify wall. Both
// role/user_type are NOT NULL DEFAULT, so `!=` is NULL-safe. `?1` binds the
// demo LIKE pattern, `?2` the visitor system email.
const ORPHAN_SEGMENT_SQL = `
  u.couple_id IS NULL
  AND u.role != 'vendor' AND u.user_type != 'planner'
  AND u.status = 'active'
  AND u.verified_email = 1
  AND u.email NOT LIKE '%@purged.local'
  AND u.email NOT LIKE ?1
  AND u.email != ?2`;

// ── Signed per-send opt-out token ─────────────────────────────────────────────
// The List-Unsubscribe link is `<sendId>.<hmac>`: worthless if leaked,
// unforgeable, resolves to the send row we suppress. Namespaced "onbcamp_" so a
// token minted here can never resolve against a vendor / personal-invite send.

function signOnb(purpose: string, sendId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`onbcamp_${purpose}:${sendId}`)
    .digest("hex")
    .slice(0, 32);
}

function makeOnbToken(purpose: string, sendId: number): string {
  return `${sendId}.${signOnb(purpose, sendId)}`;
}

function verifyOnbToken(purpose: string, token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, sig] = parts as [string, string];
  const sendId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(sendId) || sendId <= 0) return null;
  const expected = signOnb(purpose, sendId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return sendId;
}

export const makeOnboardingOptOutToken = (sendId: number) => makeOnbToken("optout", sendId);
export const verifyOnboardingOptOutToken = (t: string) => verifyOnbToken("optout", t);

// ── Campaign CRUD ─────────────────────────────────────────────────────────────

interface CampaignRow {
  id: number;
  slug: string;
  status: string;
  daily_cap: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

function toCampaignStatus(raw: string): OnboardingCampaignStatus {
  return raw === "running" || raw === "done" ? raw : "paused";
}

function toCampaign(row: CampaignRow): OnboardingCampaign {
  return {
    id: row.id,
    slug: row.slug,
    status: toCampaignStatus(row.status),
    daily_cap: row.daily_cap,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

function parseDailyCap(raw: unknown): number {
  if (raw === undefined || raw === null) return ONBOARDING_CAMPAIGN_DEFAULT_DAILY_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > ONBOARDING_CAMPAIGN_MAX_DAILY_CAP) {
    throw new HttpError(
      400,
      `daily_cap must be an integer 1..${ONBOARDING_CAMPAIGN_MAX_DAILY_CAP}`,
    );
  }
  return n;
}

export function createCampaign(
  input: CreateOnboardingCampaignInput,
  actorUserId: number | null,
): OnboardingCampaign {
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(400, "slug must be 2..61 chars, lowercase letters/digits/hyphens", {
      code: "bad_slug",
    });
  }
  const dailyCap = parseDailyCap(input.daily_cap);
  const ts = now();
  try {
    const res = db
      .prepare(
        `INSERT INTO onboarding_campaigns (slug, status, daily_cap, created_by, created_at, updated_at)
         VALUES (?, 'paused', ?, ?, ?, ?)`,
      )
      .run(slug, dailyCap, actorUserId, ts, ts);
    return toCampaign(getCampaignRow(Number(res.lastInsertRowid)) as CampaignRow);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      throw new HttpError(409, "A campaign with that slug already exists", { code: "slug_taken" });
    }
    throw e;
  }
}

export function getCampaignRow(id: number): CampaignRow | null {
  return (
    (db.prepare("SELECT * FROM onboarding_campaigns WHERE id = ?").get(id) as CampaignRow) ?? null
  );
}

export function listCampaigns(): OnboardingCampaign[] {
  return (
    db.prepare("SELECT * FROM onboarding_campaigns ORDER BY created_at DESC").all() as CampaignRow[]
  ).map(toCampaign);
}

export function updateCampaign(
  id: number,
  patch: UpdateOnboardingCampaignInput,
): OnboardingCampaign {
  const row = getCampaignRow(id);
  if (!row) throw new HttpError(404, "Campaign not found");
  const ts = now();

  let status = row.status;
  if (patch.status !== undefined) {
    const next = String(patch.status);
    if (next !== "running" && next !== "paused" && next !== "done") {
      throw new HttpError(400, "status must be running | paused | done");
    }
    status = next;
  }
  const dailyCap = patch.daily_cap !== undefined ? parseDailyCap(patch.daily_cap) : row.daily_cap;

  // started_at is stamped once on first launch and never overwritten; ended_at
  // is set when retiring to 'done' and cleared on a re-launch.
  const startedAt = status === "running" && row.started_at === null ? ts : row.started_at;
  const endedAt =
    status === "done" ? (row.ended_at ?? ts) : status === "running" ? null : row.ended_at;

  db.prepare(
    `UPDATE onboarding_campaigns
        SET status = ?, daily_cap = ?, started_at = ?, ended_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(status, dailyCap, startedAt, endedAt, ts, id);
  return toCampaign(getCampaignRow(id) as CampaignRow);
}

// ── Target sync (live orphan query → 'queued' send rows) ──────────────────────

interface OrphanUserRow {
  id: number;
  full_name: string | null;
  email: string;
  locale: string | null;
}

function localeFor(raw: string | null): "hu" | "en" {
  return (raw ?? "").toLowerCase().startsWith("hu") ? "hu" : "en";
}

/** Snapshot the current orphan segment into this campaign's send rows. Skips
 *  opted-out addresses and rows already present (UNIQUE(campaign_id, email)).
 *  Idempotent and re-runnable — a later sync pulls in newly stalled accounts. */
export function syncTargets(campaignId: number): OnboardingCampaignSyncResult {
  const eligible = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.locale
         FROM users u
        WHERE ${ORPHAN_SEGMENT_SQL}
        ORDER BY u.created_at ASC`,
    )
    .all(`%${DEMO_EMAIL_SUFFIX}`, VISITOR_SYSTEM_USER_EMAIL) as OrphanUserRow[];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO onboarding_campaign_sends
       (campaign_id, user_id, name, email, locale, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  );
  let added = 0;
  let skippedOptout = 0;
  let skippedExisting = 0;
  const ts = now();
  const tx = db.transaction(() => {
    for (const u of eligible) {
      const email = normalizeEmail(u.email);
      if (!email) continue;
      if (isOptedOut(email)) {
        skippedOptout++;
        continue;
      }
      const res = insert.run(campaignId, u.id, u.full_name ?? "", email, localeFor(u.locale), ts);
      if (res.changes === 1) added++;
      else skippedExisting++;
    }
  });
  tx();
  return {
    added,
    skipped_optout: skippedOptout,
    skipped_existing: skippedExisting,
    eligible_total: eligible.length,
  };
}

/** How many eligible orphans are NOT yet in this campaign (what a Sync would add
 *  right now), excluding opted-out addresses. */
function eligibleUnsyncedCount(campaignId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM users u
        WHERE ${ORPHAN_SEGMENT_SQL}
          AND LOWER(TRIM(u.email)) NOT IN (
                SELECT email FROM onboarding_campaign_sends WHERE campaign_id = ?3)
          AND LOWER(TRIM(u.email)) NOT IN (SELECT email FROM email_optouts)`,
    )
    .get(`%${DEMO_EMAIL_SUFFIX}`, VISITOR_SYSTEM_USER_EMAIL, campaignId) as { n: number };
  return row.n;
}

// ── Stats + listing ───────────────────────────────────────────────────────────

interface SendRow {
  id: number;
  campaign_id: number;
  user_id: number | null;
  name: string;
  email: string;
  locale: string;
  status: string;
  error: string | null;
  sent_at: number | null;
  reminder_sent_at: number | null;
  created_at: number;
}

// A targeted user counts as "converted" once it has a workspace.
const CONVERTED_EXISTS =
  "EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.couple_id IS NOT NULL)";

function toSendStatus(raw: string): OnboardingCampaignSendStatus {
  return raw === "sent" || raw === "failed" || raw === "skipped" ? raw : "queued";
}

export function campaignStats(campaign: CampaignRow): OnboardingCampaignStats {
  const ts = now();
  const agg = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN s.status = 'queued'  THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN s.status = 'sent'    THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN s.status = 'failed'  THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
         SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
         SUM(CASE WHEN s.locale = 'hu' THEN 1 ELSE 0 END) AS hu,
         SUM(CASE WHEN s.locale = 'en' THEN 1 ELSE 0 END) AS en,
         SUM(CASE WHEN ${CONVERTED_EXISTS} THEN 1 ELSE 0 END) AS converted,
         SUM(CASE WHEN s.sent_at IS NOT NULL AND s.sent_at >= ? THEN 1 ELSE 0 END) AS sent_last_24h
       FROM onboarding_campaign_sends s
      WHERE s.campaign_id = ?`,
    )
    .get(ts - ONE_DAY_MS, campaign.id) as Record<string, number | null>;

  return {
    total: agg.total ?? 0,
    queued: agg.queued ?? 0,
    sent: agg.sent ?? 0,
    failed: agg.failed ?? 0,
    skipped: agg.skipped ?? 0,
    reminded: agg.reminded ?? 0,
    hu: agg.hu ?? 0,
    en: agg.en ?? 0,
    converted: agg.converted ?? 0,
    sent_last_24h: agg.sent_last_24h ?? 0,
    eligible_unsynced: eligibleUnsyncedCount(campaign.id),
  };
}

export function getCampaignDetail(id: number): OnboardingCampaignDetail | null {
  const row = getCampaignRow(id);
  if (!row) return null;
  return { campaign: toCampaign(row), stats: campaignStats(row) };
}

export function listSends(campaignId: number, limit: number): OnboardingCampaignSend[] {
  const rows = db
    .prepare(
      `SELECT s.*,
              ${CONVERTED_EXISTS} AS converted
         FROM onboarding_campaign_sends s
        WHERE s.campaign_id = ?
        ORDER BY s.id ASC
        LIMIT ?`,
    )
    .all(campaignId, limit) as (SendRow & { converted: number })[];
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    email: r.email,
    locale: r.locale === "en" ? "en" : "hu",
    status: toSendStatus(r.status),
    error: r.error,
    sent_at: r.sent_at,
    reminded: r.reminder_sent_at !== null,
    converted: Boolean(r.converted),
    created_at: r.created_at,
  }));
}

export function getOnboardingSendById(sendId: number): SendRow | null {
  return (
    (db.prepare("SELECT * FROM onboarding_campaign_sends WHERE id = ?").get(sendId) as SendRow) ??
    null
  );
}

// ── Sending (the paced sweep primitives) ──────────────────────────────────────

function onboardingUrl(slug: string, reminder: boolean): string {
  const params = new URLSearchParams({
    utm_source: "onboarding_campaign",
    utm_medium: "email",
    utm_campaign: slug,
    utm_content: reminder ? "reminder" : "initial",
  });
  return `${CONFIG.frontendBaseUrl}/onboarding?${params.toString()}`;
}

function optOutUrl(sendId: number): string {
  return `${CONFIG.frontendBaseUrl}/api/emails/optout-onboarding/${makeOnboardingOptOutToken(sendId)}`;
}

/** Send one row's initial nudge (reminder=false) or its reminder (reminder=true)
 *  and stamp the row. Never throws — a delivery failure is recorded, not raised.
 *  A reminder ALWAYS stamps reminder_sent_at afterwards (one attempt only), so a
 *  bad address can't loop the reminder sweep. */
async function sendOne(
  campaign: CampaignRow,
  row: SendRow,
  ts: number,
  reminder: boolean,
): Promise<OnboardingCampaignSendStatus> {
  const locale: "hu" | "en" = row.locale === "en" ? "en" : "hu";
  const result = await sendKind(
    reminder ? "onboarding_campaign_reminder" : "onboarding_campaign",
    { name: row.name, ctaUrl: onboardingUrl(campaign.slug, reminder), locale },
    {
      user: null,
      guest: { email: row.email, full_name: row.name || row.email },
      guestLocale: locale,
      listUnsubscribeUrl: optOutUrl(row.id),
    },
  );
  const status = result.status;
  const ok = status === "sent" || status === "skipped_no_provider";

  if (reminder) {
    db.prepare("UPDATE onboarding_campaign_sends SET reminder_sent_at = ? WHERE id = ?").run(
      ts,
      row.id,
    );
    if (status === "skipped_opt_out") return "skipped";
    return ok ? "sent" : "failed";
  }

  if (status === "skipped_opt_out") {
    db.prepare(
      "UPDATE onboarding_campaign_sends SET status = 'skipped', error = 'opt_out' WHERE id = ?",
    ).run(row.id);
    return "skipped";
  }
  db.prepare(
    "UPDATE onboarding_campaign_sends SET status = ?, sent_at = ?, error = ? WHERE id = ?",
  ).run(ok ? "sent" : "failed", ok ? ts : null, ok ? null : status, row.id);
  return ok ? "sent" : "failed";
}

export function remainingDailyBudget(campaign: CampaignRow, ts: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM onboarding_campaign_sends WHERE campaign_id = ? AND sent_at >= ?",
    )
    .get(campaign.id, ts - ONE_DAY_MS) as { n: number };
  return Math.max(0, campaign.daily_cap - row.n);
}

/** Paced initial-send core. Re-checks eligibility (skip queued rows whose user
 *  onboarded or opted out since sync), sends up to min(limit, daily budget)
 *  'queued' rows oldest-first, and retires the campaign to 'done' when the
 *  queue is fully drained. Returns how many were actually sent. */
export async function sendCampaignBatch(
  campaign: CampaignRow,
  limit: number,
  ts: number = now(),
): Promise<number> {
  // Anyone who onboarded or opted out between sync and now is dropped, never mailed.
  db.prepare(
    `UPDATE onboarding_campaign_sends
        SET status = 'skipped', error = 'onboarded_or_optout'
      WHERE campaign_id = ?
        AND status = 'queued'
        AND (
          EXISTS (SELECT 1 FROM users u
                   WHERE u.id = onboarding_campaign_sends.user_id AND u.couple_id IS NOT NULL)
          OR email IN (SELECT email FROM email_optouts)
        )`,
  ).run(campaign.id);

  const budget = Math.min(limit, remainingDailyBudget(campaign, ts));
  if (budget <= 0) return 0;

  const rows = db
    .prepare(
      "SELECT * FROM onboarding_campaign_sends WHERE campaign_id = ? AND status = 'queued' ORDER BY id ASC LIMIT ?",
    )
    .all(campaign.id, budget) as SendRow[];

  if (rows.length === 0) {
    const remaining = db
      .prepare(
        "SELECT COUNT(*) AS n FROM onboarding_campaign_sends WHERE campaign_id = ? AND status = 'queued'",
      )
      .get(campaign.id) as { n: number };
    if (remaining.n === 0) {
      db.prepare(
        "UPDATE onboarding_campaigns SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?",
      ).run(ts, ts, campaign.id);
    }
    return 0;
  }

  let sent = 0;
  for (const row of rows) {
    if ((await sendOne(campaign, row, ts, false)) === "sent") sent++;
  }
  return sent;
}

/** One reminder wave across all NON-paused campaigns (running + done: the send
 *  is still owed; only pausing halts it). Targets 'sent' rows aged past
 *  REMINDER_AFTER_MS, not yet reminded, whose user is STILL not onboarded and
 *  not opted out. Returns how many reminders were sent. */
export async function sendCampaignReminders(limit: number, ts: number = now()): Promise<number> {
  const rows = db
    .prepare(
      `SELECT s.*
         FROM onboarding_campaign_sends s
         JOIN onboarding_campaigns c ON c.id = s.campaign_id
        WHERE c.status != 'paused'
          AND s.status = 'sent'
          AND s.reminder_sent_at IS NULL
          AND s.sent_at IS NOT NULL
          AND s.sent_at <= ?
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.couple_id IS NOT NULL)
          AND s.email NOT IN (SELECT email FROM email_optouts)
        ORDER BY s.sent_at ASC
        LIMIT ?`,
    )
    .all(ts - REMINDER_AFTER_MS, limit) as SendRow[];

  let reminded = 0;
  for (const row of rows) {
    const campaign = getCampaignRow(row.campaign_id);
    if (!campaign) continue;
    if ((await sendOne(campaign, row, ts, true)) === "sent") reminded++;
  }
  return reminded;
}
