// Vendor review-invite campaign: warm outreach to the CLAIMED half of the
// directory. Every recipient already runs a Weddly vendor account; the mail
// tells them supplier reviews are now open to anyone (not just logged-in
// couples) and hands them their own public review link to forward to past
// clients. The ask is "collect a few honest 5-star reviews so couples who don't
// know you yet can trust you".
//
// This is a deliberate parallel of domain/vendor_campaign.ts rather than a
// second mode of it: the audience inverts (claimed vs unclaimed, every
// recipient HAS a users row, so the claim campaign's `NOT IN users` exclusion
// would drop everyone), the win metric is "a review landed" not "the listing
// got claimed", and the reminder gate is stricter (not-clicked AND not-opened).
// It shares the genuinely generic plumbing with the claim campaign: the
// address-level email_optouts suppression and the country→locale helper.
//
// Ordering inside `sendOne` matters, same as the claim campaign: the send row
// is inserted BEFORE the mail goes out, because the tracking pixel, the click
// redirect and the opt-out link are all signed with its id. A crash between
// insert and send leaves a 'queued' row the next sweep retries.

import { createHmac, timingSafeEqual } from "node:crypto";
import { isUiLocale, type UiLocale } from "@shared/locales";
import { vendorPublicId } from "@shared/vendor_slug";
import {
  type CreateVendorReviewCampaignInput,
  type UpdateVendorReviewCampaignInput,
  VENDOR_REVIEW_CAMPAIGN_DEFAULT_DAILY_CAP,
  VENDOR_REVIEW_CAMPAIGN_MAX_DAILY_CAP,
  VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS,
  type VendorReviewCampaign,
  type VendorReviewCampaignDetail,
  type VendorReviewCampaignSegments,
  type VendorReviewCampaignSend,
  type VendorReviewCampaignSendStatus,
  type VendorReviewCampaignStats,
  type VendorReviewCampaignStatus,
  type VendorReviewCampaignTarget,
} from "@shared/vendor_review_campaign";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { sendKind } from "./emails/send";
// Shared, genuinely generic bits: address-level suppression + country→locale.
import {
  addOptOut,
  displayCity,
  isOptedOut,
  localeForCountry,
  mailContentLocale,
  normalizeEmail,
} from "./vendor_campaign";

export { addOptOut, isOptedOut, normalizeEmail };

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

// ── Country + locale ────────────────────────────────────────────────────────

/** ISO alpha-2 for a claimed vendor. `vendor_accounts.country` is the
 *  authoritative field once a vendor has filled in their business details; when
 *  it is absent or not a 2-letter code we fall back to HU, the home market. */
export function resolveVendorCountry(vaCountry: string | null): string {
  if (vaCountry && /^[a-z]{2}$/i.test(vaCountry.trim())) return vaCountry.trim().toUpperCase();
  return "HU";
}

/** Which language we write to this vendor in. Their account locale (captured at
 *  signup) wins, because it is the most reliable signal of what they can read;
 *  we fall back to the country only when the account has no locale. */
export function localeForVendor(userLocale: string | null, country: string): UiLocale {
  if (userLocale && userLocale.trim().length > 0) {
    // The account locale is the strongest signal there is: the vendor picked
    // it themselves. Take it whenever it names a language we ship, and only
    // then fall back to guessing from the country.
    const base = userLocale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    if (isUiLocale(base)) return base;
    return "en";
  }
  return localeForCountry(country);
}

// ── Signed per-send tokens ──────────────────────────────────────────────────
// Pixel, click-redirect and opt-out links are all `<sendId>.<hmac>`: worthless
// if leaked, unforgeable, and they resolve to the send row we need. The purpose
// string is namespaced with "review_" so a token minted for the claim campaign
// can never resolve against this table and vice versa.

function signReviewSend(purpose: string, sendId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`review_${purpose}:${sendId}`)
    .digest("hex")
    .slice(0, 32);
}

function makeReviewSendToken(purpose: string, sendId: number): string {
  return `${sendId}.${signReviewSend(purpose, sendId)}`;
}

function verifyReviewSendToken(purpose: string, token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, sig] = parts as [string, string];
  const sendId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(sendId) || sendId <= 0) return null;
  const expected = signReviewSend(purpose, sendId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return sendId;
}

export const makeReviewPixelToken = (sendId: number) => makeReviewSendToken("pixel", sendId);
export const verifyReviewPixelToken = (t: string) => verifyReviewSendToken("pixel", t);
export const makeReviewClickToken = (sendId: number) => makeReviewSendToken("click", sendId);
export const verifyReviewClickToken = (t: string) => verifyReviewSendToken("click", t);
export const makeReviewOptOutToken = (sendId: number) => makeReviewSendToken("optout", sendId);
export const verifyReviewOptOutToken = (t: string) => verifyReviewSendToken("optout", t);

// ── Campaign CRUD ───────────────────────────────────────────────────────────

interface CampaignRow {
  id: number;
  slug: string;
  status: string;
  daily_cap: number;
  country: string | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

function toCampaignStatus(raw: string): VendorReviewCampaignStatus {
  if (raw === "running" || raw === "done") return raw;
  return "paused";
}

function toCampaign(row: CampaignRow): VendorReviewCampaign {
  return {
    id: row.id,
    slug: row.slug,
    status: toCampaignStatus(row.status),
    daily_cap: row.daily_cap,
    country: row.country,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

function parseDailyCap(raw: unknown): number {
  if (raw == null) return VENDOR_REVIEW_CAMPAIGN_DEFAULT_DAILY_CAP;
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > VENDOR_REVIEW_CAMPAIGN_MAX_DAILY_CAP) {
    throw new HttpError(
      400,
      `daily_cap must be an integer between 1 and ${VENDOR_REVIEW_CAMPAIGN_MAX_DAILY_CAP}`,
    );
  }
  return n;
}

export function createCampaign(
  input: CreateVendorReviewCampaignInput,
  actorUserId: number | null,
): VendorReviewCampaign {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    throw new HttpError(400, "slug must be 2-61 lowercase letters, digits or dashes");
  }
  const dailyCap = parseDailyCap(input.daily_cap);
  const country =
    typeof input.country === "string" && input.country.trim().length > 0
      ? input.country.trim().toUpperCase()
      : null;
  if (country != null && !/^[A-Z]{2}$/.test(country)) {
    throw new HttpError(400, "country must be an ISO alpha-2 code");
  }
  const ts = now();
  try {
    const row = db
      .prepare(
        `INSERT INTO vendor_review_campaigns (slug, status, daily_cap, country, created_by, created_at, updated_at)
         VALUES (?, 'paused', ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(slug, dailyCap, country, actorUserId, ts, ts) as CampaignRow;
    return toCampaign(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      throw new HttpError(409, "A campaign with this slug already exists", { code: "slug_taken" });
    }
    throw e;
  }
}

export function getCampaignRow(id: number): CampaignRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_review_campaigns WHERE id = ?").get(id) as
      | CampaignRow
      | undefined) ?? null
  );
}

export function listCampaigns(): VendorReviewCampaign[] {
  const rows = db
    .prepare("SELECT * FROM vendor_review_campaigns ORDER BY created_at DESC")
    .all() as CampaignRow[];
  return rows.map(toCampaign);
}

export function updateCampaign(
  id: number,
  patch: UpdateVendorReviewCampaignInput,
): VendorReviewCampaign {
  const row = getCampaignRow(id);
  if (!row) throw new HttpError(404, "Campaign not found");
  const status =
    patch.status == null
      ? row.status
      : patch.status === "running" || patch.status === "paused" || patch.status === "done"
        ? patch.status
        : (() => {
            throw new HttpError(400, "status must be running, paused or done");
          })();
  const dailyCap = patch.daily_cap == null ? row.daily_cap : parseDailyCap(patch.daily_cap);
  const ts = now();
  // Launch is the first time it runs (never re-stamped); a re-launch clears the
  // end mark, and going Done stamps the end.
  const startedAt = status === "running" && row.started_at == null ? ts : row.started_at;
  const endedAt =
    status === "done" ? (row.ended_at ?? ts) : status === "running" ? null : row.ended_at;
  const updated = db
    .prepare(
      `UPDATE vendor_review_campaigns
          SET status = ?, daily_cap = ?, updated_at = ?, started_at = ?, ended_at = ?
        WHERE id = ? RETURNING *`,
    )
    .get(status, dailyCap, ts, startedAt, endedAt, id) as CampaignRow;
  return toCampaign(updated);
}

// ── Targeting ───────────────────────────────────────────────────────────────

interface VendorTargetRow {
  vendor_account_id: number;
  listing_id: string;
  listing_name: string;
  city: string;
  email: string;
  user_locale: string | null;
  va_country: string | null;
}

/** Eligible addresses this campaign has not written to yet, in listing-id order
 *  so successive batches walk the directory deterministically.
 *
 *  Exclusions, each for a concrete reason:
 *    - unclaimed listings (`vendor_account_id IS NULL`): the claim campaign's
 *      job, and they have no account to greet
 *    - non-active listings: hidden / pending-moderation rows aren't public, so
 *      there is no review link to share
 *    - suspended owners: we don't nudge accounts we've frozen
 *    - no owner email: nothing to send to
 *    - opted out: permanent suppression (shared email_optouts)
 *    - already written to in THIS campaign: one mail per address
 *
 *  The country filter is applied in TS because it is resolved from
 *  vendor_accounts.country with an HU fallback, not read straight off a column. */
function eligibleTargets(opts: {
  excludeCampaignId: number | null;
  country: string | null;
  limit: number;
}): VendorReviewCampaignTarget[] {
  const rows = db
    .prepare(
      `SELECT va.id AS vendor_account_id,
              l.id AS listing_id,
              l.name AS listing_name,
              l.city AS city,
              LOWER(TRIM(u.email)) AS email,
              u.locale AS user_locale,
              va.country AS va_country
         FROM listings l
         JOIN vendor_accounts va ON va.id = l.vendor_account_id
         JOIN users u ON u.id = va.owner_user_id
        WHERE l.vendor_account_id IS NOT NULL
          AND l.status = 'active'
          AND u.status = 'active'
          AND u.email IS NOT NULL
          AND TRIM(u.email) != ''
          AND LOWER(TRIM(u.email)) NOT IN (SELECT email FROM email_optouts)
          -- Respect an account-level opt-out too: a vendor who muted our
          -- product mail shouldn't get a campaign nudge just because it rides a
          -- different (outreach) send path.
          AND NOT EXISTS (
                SELECT 1 FROM email_preferences ep
                 WHERE ep.user_id = u.id AND ep.lifecycle_opt_out = 1)
          AND LOWER(TRIM(u.email)) NOT IN (
                SELECT email FROM vendor_review_campaign_sends WHERE campaign_id = ?)
        ORDER BY l.id ASC`,
    )
    .all(opts.excludeCampaignId ?? -1) as VendorTargetRow[];

  const out: VendorReviewCampaignTarget[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= opts.limit) break;
    const email = normalizeEmail(row.email);
    // Two accounts sharing one login inbox is unusual but the UNIQUE index would
    // reject the second insert anyway; skipping here keeps the preview honest.
    if (seen.has(email)) continue;
    const country = resolveVendorCountry(row.va_country);
    if (opts.country != null && country !== opts.country) continue;
    seen.add(email);
    out.push({
      vendor_account_id: row.vendor_account_id,
      listing_id: row.listing_id,
      listing_name: row.listing_name,
      email,
      city: displayCity(row.city ?? ""),
      country,
      locale: localeForVendor(row.user_locale, country),
    });
  }
  return out;
}

export function listTargets(campaign: CampaignRow, limit: number): VendorReviewCampaignTarget[] {
  return eligibleTargets({ excludeCampaignId: campaign.id, country: campaign.country, limit });
}

/** Every address a brand-new, unsegmented campaign would write to. Sibling of
 *  the claim campaign's helper, for the scheduler's cooldown arithmetic. */
export function eligibleCampaignEmails(): string[] {
  return eligibleTargets({
    excludeCampaignId: null,
    country: null,
    limit: Number.MAX_SAFE_INTEGER,
  }).map((t) => t.email);
}

/** Reachable audience broken down by country, for the create form. */
export function listSegments(): VendorReviewCampaignSegments {
  const all = eligibleTargets({
    excludeCampaignId: null,
    country: null,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const byCountry = new Map<string, number>();
  for (const t of all) byCountry.set(t.country, (byCountry.get(t.country) ?? 0) + 1);
  const segments = [...byCountry.entries()]
    .map(([country, addresses]) => ({ country, addresses, locale: localeForCountry(country) }))
    .sort((a, b) => b.addresses - a.addresses || a.country.localeCompare(b.country));
  return { total: all.length, segments };
}

// ── Stats + listing ─────────────────────────────────────────────────────────

interface SendRow {
  id: number;
  campaign_id: number;
  vendor_account_id: number;
  listing_id: string;
  email: string;
  locale: string;
  country: string | null;
  review_url: string;
  status: string;
  error: string | null;
  sent_at: number | null;
  opened_at: number | null;
  clicked_at: number | null;
  reminder_sent_at: number | null;
  created_at: number;
}

function toSendStatus(raw: string): VendorReviewCampaignSendStatus {
  if (raw === "sent" || raw === "failed" || raw === "skipped") return raw;
  return "queued";
}

/** A send "converted" when the vendor's listing gained at least one published,
 *  non-deleted review dated after we wrote to them — however that review got
 *  there. Read live off supplier_reviews so any route counts. */
const COLLECTED_EXISTS = `EXISTS (
  SELECT 1 FROM supplier_reviews r
   WHERE r.supplier_id = s.listing_id
     AND r.published = 1
     AND r.deleted_at IS NULL
     AND s.sent_at IS NOT NULL
     AND r.created_at > s.sent_at
)`;

export function campaignStats(campaign: CampaignRow): VendorReviewCampaignStats {
  const agg = db
    .prepare(
      `SELECT
         SUM(CASE WHEN s.status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN s.status = 'sent'   THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN s.opened_at  IS NOT NULL THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
         SUM(CASE WHEN ${COLLECTED_EXISTS} THEN 1 ELSE 0 END) AS collected,
         SUM(CASE WHEN s.sent_at IS NOT NULL AND s.sent_at >= ? THEN 1 ELSE 0 END) AS sent_last_24h
       FROM vendor_review_campaign_sends s
      WHERE s.campaign_id = ?`,
    )
    .get(now() - ONE_DAY_MS, campaign.id) as Record<string, number | null>;
  return {
    remaining: listTargets(campaign, Number.MAX_SAFE_INTEGER).length,
    queued: agg.queued ?? 0,
    sent: agg.sent ?? 0,
    failed: agg.failed ?? 0,
    opened: agg.opened ?? 0,
    clicked: agg.clicked ?? 0,
    reminded: agg.reminded ?? 0,
    collected: agg.collected ?? 0,
    sent_last_24h: agg.sent_last_24h ?? 0,
  };
}

export function getCampaignDetail(id: number): VendorReviewCampaignDetail | null {
  const row = getCampaignRow(id);
  if (!row) return null;
  return { campaign: toCampaign(row), stats: campaignStats(row) };
}

export function listSends(campaignId: number, limit: number): VendorReviewCampaignSend[] {
  const rows = db
    .prepare(
      `SELECT s.*, l.name AS listing_name,
              (CASE WHEN ${COLLECTED_EXISTS} THEN 1 ELSE 0 END) AS collected
         FROM vendor_review_campaign_sends s
         LEFT JOIN listings l ON l.id = s.listing_id
        WHERE s.campaign_id = ?
        ORDER BY s.id DESC
        LIMIT ?`,
    )
    .all(campaignId, limit) as Array<SendRow & { listing_name: string | null; collected: number }>;
  return rows.map((row) => ({
    id: row.id,
    vendor_account_id: row.vendor_account_id,
    listing_id: row.listing_id,
    listing_name: row.listing_name ?? row.listing_id,
    email: row.email,
    locale: row.locale === "hu" ? "hu" : "en",
    country: row.country,
    review_url: row.review_url,
    status: toSendStatus(row.status),
    error: row.error,
    sent_at: row.sent_at,
    opened_at: row.opened_at,
    clicked_at: row.clicked_at,
    reminder_sent_at: row.reminder_sent_at,
    collected: row.collected === 1,
  }));
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** The vendor's own public page — the shareable review link the whole mail is
 *  built around. Pretty, name-prefixed id so it reads well when they paste it. */
export function reviewUrlFor(listingId: string, listingName: string): string {
  return `${CONFIG.frontendBaseUrl}/vendors/${vendorPublicId(listingId, listingName)}`;
}

/** The `?review=1` variant deep-links a past client straight to the review
 *  composer on the public page, so a forwarded link is one step from leaving a
 *  rating. */
function shareUrlFor(reviewUrl: string): string {
  return `${reviewUrl}?review=1`;
}

function clickUrl(sendId: number): string {
  return `${CONFIG.frontendBaseUrl}/r/vendor-review/${makeReviewClickToken(sendId)}`;
}

function pixelUrl(sendId: number): string {
  return `${CONFIG.frontendBaseUrl}/api/emails/track/review-campaign?t=${makeReviewPixelToken(sendId)}`;
}

/** Pre-filled share affordances the vendor taps to forward their link to a past
 *  client. WhatsApp and a mailto draft both work from inside an email client
 *  with no clipboard JS. */
function shareLinks(shareUrl: string, locale: "hu" | "en"): { whatsapp: string; mailto: string } {
  const msg =
    locale === "hu"
      ? `Szia! Ha elégedett voltál a közös munkánkkal, sokat segítenél egy rövid értékeléssel a Weddly-n: ${shareUrl}`
      : `Hi! If you enjoyed working with us, a short review on Weddly would mean a lot: ${shareUrl}`;
  const subject = locale === "hu" ? "Egy rövid értékelés?" : "A quick review?";
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(msg)}`,
    mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`,
  };
}

/** Send (or re-send) one invite. Returns the resulting row status. Never
 *  throws: a single bad address must not abort the batch. */
async function sendOne(
  campaign: CampaignRow,
  target: VendorReviewCampaignTarget,
  ts: number,
): Promise<VendorReviewCampaignSendStatus> {
  const reviewUrl = reviewUrlFor(target.listing_id, target.listing_name);
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO vendor_review_campaign_sends
         (campaign_id, vendor_account_id, listing_id, email, locale, country, review_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      campaign.id,
      target.vendor_account_id,
      target.listing_id,
      target.email,
      target.locale,
      target.country,
      reviewUrl,
      ts,
    );
  if (inserted.changes !== 1) {
    // Lost a race against a concurrent batch for the same address.
    return "skipped";
  }
  const sendId = Number(inserted.lastInsertRowid);
  const share = shareUrlFor(reviewUrl);
  const links = shareLinks(share, mailContentLocale(target.locale));

  const result = await sendKind(
    "vendor_review_campaign",
    {
      businessName: target.listing_name,
      reviewUrl,
      shareUrl: share,
      ctaUrl: clickUrl(sendId),
      whatsappUrl: links.whatsapp,
      mailtoUrl: links.mailto,
      dashboardUrl: `${CONFIG.frontendBaseUrl}/vendor/reviews`,
      locale: mailContentLocale(target.locale),
    },
    {
      user: null,
      guest: { email: target.email, full_name: target.listing_name },
      guestLocale: target.locale,
      trackingPixelUrl: pixelUrl(sendId),
    },
  );

  const ok = result.status === "sent" || result.status === "skipped_no_provider";
  db.prepare(
    "UPDATE vendor_review_campaign_sends SET status = ?, sent_at = ?, error = ? WHERE id = ?",
  ).run(
    ok ? "sent" : "failed",
    ok ? ts : null,
    ok ? null : (result.error ?? "send failed"),
    sendId,
  );
  return ok ? "sent" : "failed";
}

/** How many more mails this campaign may send right now, from its rolling-24h
 *  budget. */
export function remainingDailyBudget(campaign: CampaignRow, ts: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM vendor_review_campaign_sends
        WHERE campaign_id = ? AND sent_at IS NOT NULL AND sent_at >= ?`,
    )
    .get(campaign.id, ts - ONE_DAY_MS) as { n: number };
  return Math.max(0, campaign.daily_cap - row.n);
}

/** Send up to `limit` invites for one campaign, honouring its daily budget.
 *  Returns how many actually went out. */
export async function sendCampaignBatch(
  campaign: CampaignRow,
  limit: number,
  ts: number = now(),
): Promise<number> {
  const budget = Math.min(limit, remainingDailyBudget(campaign, ts));
  if (budget <= 0) return 0;
  const targets = listTargets(campaign, budget);
  if (targets.length === 0) {
    // Nothing left to write to: retire the campaign so the worker stops
    // re-querying it every hour forever, and stamp when it ended.
    db.prepare(
      "UPDATE vendor_review_campaigns SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?",
    ).run(ts, ts, campaign.id);
    return 0;
  }
  let sent = 0;
  for (const target of targets) {
    const status = await sendOne(campaign, target, ts);
    if (status === "sent") sent++;
  }
  return sent;
}

// ── Reminders ───────────────────────────────────────────────────────────────

/** One nudge per recipient, VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS after the
 *  first mail, to everyone who has NEITHER clicked NOR opened it. This is the
 *  operator's explicit call: a vendor who read the mail but hasn't shared their
 *  link yet is left alone. Opens are inflated (Apple MPP / Gmail proxy), so
 *  gating on them too errs toward NOT nudging, which is the right direction for
 *  people we already have a relationship with.
 *
 *  Also skips anyone who has already collected a review since the send (the ask
 *  is done), anyone who opted out in between, and — like the claim campaign —
 *  respects `paused` as the emergency brake while letting `done` still owe its
 *  reminders. */
export async function sendCampaignReminders(limit: number, ts: number = now()): Promise<number> {
  const rows = db
    .prepare(
      `SELECT s.* FROM vendor_review_campaign_sends s
         JOIN vendor_review_campaigns c ON c.id = s.campaign_id
        WHERE s.status = 'sent'
          AND s.sent_at IS NOT NULL
          AND s.sent_at <= ?
          AND s.reminder_sent_at IS NULL
          AND s.clicked_at IS NULL
          AND s.opened_at IS NULL
          AND s.email NOT IN (SELECT email FROM email_optouts)
          AND c.status != 'paused'
          AND NOT ${COLLECTED_EXISTS}
        ORDER BY s.sent_at ASC
        LIMIT ?`,
    )
    .all(ts - VENDOR_REVIEW_CAMPAIGN_REMINDER_AFTER_MS, limit) as SendRow[];

  let sent = 0;
  for (const row of rows) {
    const listing = db.prepare("SELECT name FROM listings WHERE id = ?").get(row.listing_id) as
      | { name: string }
      | undefined;
    const businessName = listing?.name ?? row.listing_id;
    const locale = row.locale === "hu" ? "hu" : "en";
    const share = shareUrlFor(row.review_url);
    const links = shareLinks(share, locale);
    const result = await sendKind(
      "vendor_review_campaign_reminder",
      {
        businessName,
        reviewUrl: row.review_url,
        shareUrl: share,
        ctaUrl: clickUrl(row.id),
        whatsappUrl: links.whatsapp,
        mailtoUrl: links.mailto,
        dashboardUrl: `${CONFIG.frontendBaseUrl}/vendor/reviews`,
        locale,
      },
      {
        user: null,
        guest: { email: row.email, full_name: businessName },
        guestLocale: locale,
        trackingPixelUrl: pixelUrl(row.id),
      },
    );
    // Stamp regardless of outcome: one-shot nudge, no retrying a bouncing
    // address every hour.
    db.prepare("UPDATE vendor_review_campaign_sends SET reminder_sent_at = ? WHERE id = ?").run(
      ts,
      row.id,
    );
    if (result.status === "sent" || result.status === "skipped_no_provider") sent++;
  }
  return sent;
}

// ── Tracking write-backs ────────────────────────────────────────────────────

/** First open wins. */
export function markReviewCampaignOpened(sendId: number, ts: number = now()): void {
  db.prepare(
    "UPDATE vendor_review_campaign_sends SET opened_at = COALESCE(opened_at, ?) WHERE id = ?",
  ).run(ts, sendId);
}

export function getReviewSendById(sendId: number): SendRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_review_campaign_sends WHERE id = ?").get(sendId) as
      | SendRow
      | undefined) ?? null
  );
}

/** Stamp the click and return where to send the vendor: their own public page.
 *  Returns null when the send is unknown or its listing is gone, so the route
 *  can fall back to a safe default. */
export function markReviewCampaignClicked(sendId: number, ts: number = now()): string | null {
  const send = getReviewSendById(sendId);
  if (!send) return null;
  db.prepare(
    "UPDATE vendor_review_campaign_sends SET clicked_at = COALESCE(clicked_at, ?) WHERE id = ?",
  ).run(ts, send.id);
  return send.review_url;
}
