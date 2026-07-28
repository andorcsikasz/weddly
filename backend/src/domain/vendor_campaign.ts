// Vendor claim-invite campaign: cold outreach to the unclaimed half of the
// directory, asking each business to take over the profile that is already
// live on their behalf.
//
// The whole point is that the CTA is ONE click. `/api/vendor/claim/start`
// exists, but it asks the recipient to type their email and wait for a second
// mail before they can do anything. For an invite WE initiate that hop is pure
// drop-off, and it is unnecessary: we are already mailing the listing's
// contact_email, which is the exact address the start step would verify. So a
// send pre-mints the `listing_claims` row and the invite links straight at it.
//
// Ordering inside `sendOne` matters: the send row is inserted BEFORE the mail
// goes out, because the tracking pixel and the opt-out link are both signed
// with its id. A crash between insert and send leaves a 'queued' row, which the
// next sweep retries; the reverse order would leave mail in an inbox that no
// row accounts for.
//
// See shared/vendor_campaign.ts for why reminders gate on clicks rather than
// opens, and why sends are keyed by address rather than by listing.

import { createHmac, timingSafeEqual } from "node:crypto";
import { isVendorSelfServeBlocked, supplierCategoryLabel } from "@shared/suppliers";
import {
  type CreateVendorCampaignInput,
  type UpdateVendorCampaignInput,
  VENDOR_CAMPAIGN_DEFAULT_DAILY_CAP,
  VENDOR_CAMPAIGN_MAX_DAILY_CAP,
  VENDOR_CAMPAIGN_MONTHLY_VISITORS,
  VENDOR_CAMPAIGN_REMINDER_AFTER_MS,
  type VendorCampaign,
  type VendorCampaignDetail,
  type VendorCampaignSend,
  type VendorCampaignSendStatus,
  type VendorCampaignStats,
  type VendorCampaignSegments,
  type VendorCampaignStatus,
  type VendorCampaignTarget,
} from "@shared/vendor_campaign";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { sendKind } from "./emails/send";
import { createClaim, expireStaleClaim, getClaimByToken } from "./listing_claims";
import { curatedCountry } from "./suppliers_data";
import { currentVendorOffer } from "./vendor_billing";

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

// ── Country + locale ────────────────────────────────────────────────────────

interface ListingTargetRow {
  id: string;
  source: string;
  name: string;
  category: string;
  city: string;
  contact_email: string;
}

/** ISO alpha-2 for any listing. Curated rows go through the directory's own
 *  resolver (city ", XX" suffix, then the id-anchored Slovak/Austrian sets,
 *  else HU). Community submissions carry no country capture at all and are
 *  Hungary-only in practice, which is the same assumption the public directory
 *  card already makes for them. */
export function resolveListingCountry(row: { id: string; source: string; city: string }): string {
  if (row.source === "curated") return curatedCountry(row.id, row.city);
  return "HU";
}

/** Which language we write to a business in this country. Only HU and EN copy
 *  exists, so everywhere outside Hungary gets English rather than a Hungarian
 *  mail nobody in the office can read. */
export function localeForCountry(country: string): "hu" | "en" {
  return country.toUpperCase() === "HU" ? "hu" : "en";
}

/** `listings.city` carries a ", XX" country suffix on the international curated
 *  batches ("Lake Como, IT"), which is the very thing `resolveListingCountry`
 *  reads. It's a data marker, not a place name, so strip it before the town
 *  goes into a sentence a human reads. */
export function displayCity(city: string): string {
  return city.replace(/,\s*[A-Z]{2}$/, "").trim();
}

// ── Signed per-send tokens ──────────────────────────────────────────────────
// The pixel and the opt-out link are handed to mail clients and image proxies,
// so they must not carry the claim token (that one is a bearer credential for
// creating an account). Both are `<sendId>.<hmac>` instead: worthless if
// leaked, unforgeable, and they resolve to the send row we need.

function signSend(purpose: string, sendId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`${purpose}:${sendId}`)
    .digest("hex")
    .slice(0, 32);
}

function makeSendToken(purpose: string, sendId: number): string {
  return `${sendId}.${signSend(purpose, sendId)}`;
}

function verifySendToken(purpose: string, token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, sig] = parts as [string, string];
  const sendId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(sendId) || sendId <= 0) return null;
  const expected = signSend(purpose, sendId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return sendId;
}

export const makeCampaignPixelToken = (sendId: number) => makeSendToken("pixel", sendId);
export const verifyCampaignPixelToken = (t: string) => verifySendToken("pixel", t);
export const makeCampaignOptOutToken = (sendId: number) => makeSendToken("optout", sendId);
export const verifyCampaignOptOutToken = (t: string) => verifySendToken("optout", t);

// ── Suppression ─────────────────────────────────────────────────────────────
//
// These moved to domain/emails/optouts.ts when `send.ts` started enforcing
// suppression for every outbound kind, not just campaign targeting: the
// dispatcher cannot import a campaign module without closing an import cycle.
// Re-exported here so the campaigns, routes and admin console that already
// import them from this module keep working.
import { normalizeEmail } from "./emails/optouts";
export { addOptOut, isOptedOut, normalizeEmail } from "./emails/optouts";

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

function toCampaignStatus(raw: string): VendorCampaignStatus {
  if (raw === "running" || raw === "done") return raw;
  return "paused";
}

function toCampaign(row: CampaignRow): VendorCampaign {
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
  if (raw == null) return VENDOR_CAMPAIGN_DEFAULT_DAILY_CAP;
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > VENDOR_CAMPAIGN_MAX_DAILY_CAP) {
    throw new HttpError(
      400,
      `daily_cap must be an integer between 1 and ${VENDOR_CAMPAIGN_MAX_DAILY_CAP}`,
    );
  }
  return n;
}

export function createCampaign(
  input: CreateVendorCampaignInput,
  actorUserId: number | null,
): VendorCampaign {
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
        `INSERT INTO vendor_claim_campaigns (slug, status, daily_cap, country, created_by, created_at, updated_at)
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
    (db.prepare("SELECT * FROM vendor_claim_campaigns WHERE id = ?").get(id) as
      | CampaignRow
      | undefined) ?? null
  );
}

export function listCampaigns(): VendorCampaign[] {
  const rows = db
    .prepare("SELECT * FROM vendor_claim_campaigns ORDER BY created_at DESC")
    .all() as CampaignRow[];
  return rows.map(toCampaign);
}

export function updateCampaign(id: number, patch: UpdateVendorCampaignInput): VendorCampaign {
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
      `UPDATE vendor_claim_campaigns
          SET status = ?, daily_cap = ?, updated_at = ?, started_at = ?, ended_at = ?
        WHERE id = ? RETURNING *`,
    )
    .get(status, dailyCap, ts, startedAt, endedAt, id) as CampaignRow;
  return toCampaign(updated);
}

// ── Targeting ───────────────────────────────────────────────────────────────

/** Eligible addresses this campaign has not written to yet, in id order so
 *  successive batches walk the directory deterministically.
 *
 *  Exclusions, each for a concrete reason:
 *    - claimed listings: there is nothing to invite them to
 *    - non-active listings: hidden / pending-moderation rows aren't public
 *    - no contact_email: nothing to send to
 *    - opted out: permanent suppression
 *    - already written to in THIS campaign: one mail per address
 *    - an address that already has a `users` row: claim-complete refuses those
 *      with 409 email_taken, so the invite would dead-end at the form
 *    - wedding planners: the mail's whole promise is "take over your vendor
 *      profile", and claim now refuses their category. Inviting them was how a
 *      planner ended up holding a vendor account in the first place.
 *
 *  The country filter is applied in TS rather than SQL because country is
 *  derived from the id + city, not stored on the row. */
function eligibleTargets(opts: {
  /** Campaign whose already-written addresses to exclude. Null = "what would a
   *  brand-new campaign see?", which is what the create form previews. */
  excludeCampaignId: number | null;
  country: string | null;
  limit: number;
}): VendorCampaignTarget[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.source, l.name, l.category, l.city, l.contact_email
         FROM listings l
        WHERE l.vendor_account_id IS NULL
          AND l.status = 'active'
          AND l.contact_email IS NOT NULL
          AND TRIM(l.contact_email) != ''
          AND LOWER(TRIM(l.contact_email)) NOT IN (SELECT email FROM email_optouts)
          AND LOWER(TRIM(l.contact_email)) NOT IN (
                SELECT email FROM vendor_claim_campaign_sends WHERE campaign_id = ?)
          AND LOWER(TRIM(l.contact_email)) NOT IN (SELECT LOWER(email) FROM users)
        ORDER BY l.id ASC`,
    )
    .all(opts.excludeCampaignId ?? -1) as ListingTargetRow[];

  const out: VendorCampaignTarget[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= opts.limit) break;
    if (isVendorSelfServeBlocked(row.category)) continue;
    const email = normalizeEmail(row.contact_email);
    // Two listings can share one inbox (a venue group, a studio with a second
    // brand). The UNIQUE index would reject the second insert anyway; skipping
    // here keeps the preview honest about how many mails actually go out.
    if (seen.has(email)) continue;
    const country = resolveListingCountry(row);
    if (opts.country != null && country !== opts.country) continue;
    seen.add(email);
    out.push({
      listing_id: row.id,
      listing_name: row.name,
      email,
      category: row.category,
      city: displayCity(row.city),
      country,
      locale: localeForCountry(country),
    });
  }
  return out;
}

export function listTargets(campaign: CampaignRow, limit: number): VendorCampaignTarget[] {
  return eligibleTargets({
    excludeCampaignId: campaign.id,
    country: campaign.country,
    limit,
  });
}

/** Every address a brand-new, unsegmented campaign would write to. The campaign
 *  scheduler (domain/campaign_schedules.ts) needs the addresses themselves, not
 *  a count, because it subtracts the ones this family mailed inside its
 *  cooldown window before deciding a round is worth composing. */
export function eligibleCampaignEmails(): string[] {
  return eligibleTargets({
    excludeCampaignId: null,
    country: null,
    limit: Number.MAX_SAFE_INTEGER,
  }).map((t) => t.email);
}

/** Reachable audience broken down by country, for the create form. An operator
 *  picking a country segment should not have to guess a 2-letter code and hope
 *  it matches something: this is the actual menu, with the actual counts, as a
 *  brand-new campaign would see it. */
export function listSegments(): VendorCampaignSegments {
  const all = eligibleTargets({
    excludeCampaignId: null,
    country: null,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const byCountry = new Map<string, number>();
  for (const t of all) byCountry.set(t.country, (byCountry.get(t.country) ?? 0) + 1);
  const segments = [...byCountry.entries()]
    .map(([country, addresses]) => ({
      country,
      addresses,
      locale: localeForCountry(country),
    }))
    .sort((a, b) => b.addresses - a.addresses || a.country.localeCompare(b.country));
  return { total: all.length, segments };
}

// ── Stats + listing ─────────────────────────────────────────────────────────

interface SendRow {
  id: number;
  campaign_id: number;
  listing_id: string;
  email: string;
  locale: string;
  country: string | null;
  category: string;
  claim_token: string | null;
  status: string;
  error: string | null;
  sent_at: number | null;
  opened_at: number | null;
  clicked_at: number | null;
  reminder_sent_at: number | null;
  created_at: number;
}

function toSendStatus(raw: string): VendorCampaignSendStatus {
  if (raw === "sent" || raw === "failed" || raw === "skipped") return raw;
  return "queued";
}

export function campaignStats(campaign: CampaignRow): VendorCampaignStats {
  const agg = db
    .prepare(
      `SELECT
         SUM(CASE WHEN s.status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN s.status = 'sent'   THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN s.opened_at  IS NOT NULL THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN s.clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN s.reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
         -- Converted = the invited listing now has an owner, however they got
         -- there. Read live off the listings table so a claim that came in
         -- through the public modal still counts as this campaign's win.
         SUM(CASE WHEN l.vendor_account_id IS NOT NULL THEN 1 ELSE 0 END) AS claimed,
         SUM(CASE WHEN s.sent_at IS NOT NULL AND s.sent_at >= ? THEN 1 ELSE 0 END) AS sent_last_24h
       FROM vendor_claim_campaign_sends s
       LEFT JOIN listings l ON l.id = s.listing_id
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
    claimed: agg.claimed ?? 0,
    sent_last_24h: agg.sent_last_24h ?? 0,
  };
}

export function getCampaignDetail(id: number): VendorCampaignDetail | null {
  const row = getCampaignRow(id);
  if (!row) return null;
  return { campaign: toCampaign(row), stats: campaignStats(row), offer: currentVendorOffer() };
}

export function listSends(campaignId: number, limit: number): VendorCampaignSend[] {
  const rows = db
    .prepare(
      `SELECT s.*, l.name AS listing_name, l.vendor_account_id
         FROM vendor_claim_campaign_sends s
         LEFT JOIN listings l ON l.id = s.listing_id
        WHERE s.campaign_id = ?
        ORDER BY s.id DESC
        LIMIT ?`,
    )
    .all(campaignId, limit) as Array<
    SendRow & { listing_name: string | null; vendor_account_id: number | null }
  >;
  return rows.map((row) => ({
    id: row.id,
    listing_id: row.listing_id,
    listing_name: row.listing_name ?? row.listing_id,
    email: row.email,
    locale: row.locale === "hu" ? "hu" : "en",
    country: row.country,
    category: row.category,
    status: toSendStatus(row.status),
    error: row.error,
    sent_at: row.sent_at,
    opened_at: row.opened_at,
    clicked_at: row.clicked_at,
    reminder_sent_at: row.reminder_sent_at,
    claimed: row.vendor_account_id != null,
  }));
}

// ── Sending ─────────────────────────────────────────────────────────────────

function inviteUrl(claimToken: string): string {
  return `${CONFIG.frontendBaseUrl}/r/vendor-invite/${encodeURIComponent(claimToken)}`;
}

function pixelUrl(sendId: number): string {
  return `${CONFIG.frontendBaseUrl}/api/emails/track/campaign?t=${makeCampaignPixelToken(sendId)}`;
}

function optOutUrl(sendId: number): string {
  return `${CONFIG.frontendBaseUrl}/email-optout/${makeCampaignOptOutToken(sendId)}`;
}

/** Free-window promise for the invite copy, in months. The claim itself calls
 *  `initVendorBilling`, which re-resolves the tier at that moment, so a mail
 *  sent on the last founding slot can promise a year that the claim no longer
 *  grants. The copy hedges accordingly (it names the offer, and the claim page
 *  shows the live one), and the reminder re-reads it. */
function offerMonths(): number {
  const offer = currentVendorOffer();
  if (offer.tier === "founding") return 12;
  if (offer.tier === "early") return 3;
  return 0;
}

/** Send (or re-send) one invite. Returns the resulting row status. Never
 *  throws: a single bad address must not abort the batch. */
async function sendOne(
  campaign: CampaignRow,
  target: VendorCampaignTarget,
  ts: number,
): Promise<VendorCampaignSendStatus> {
  // Claim rows are per-send: the token in the mail is the one thing that makes
  // the CTA one-click, and it must be tied to THIS listing's contact address.
  const claim = createClaim(target.listing_id, target.email, null);
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO vendor_claim_campaign_sends
         (campaign_id, listing_id, email, locale, country, category, claim_token, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      campaign.id,
      target.listing_id,
      target.email,
      target.locale,
      target.country,
      target.category,
      claim.token,
      ts,
    );
  if (inserted.changes !== 1) {
    // Lost a race against a concurrent batch for the same address. The other
    // one owns the send; drop this claim token on the floor rather than mail
    // twice.
    return "skipped";
  }
  const sendId = Number(inserted.lastInsertRowid);

  const result = await sendKind(
    "vendor_claim_campaign",
    {
      listingName: target.listing_name,
      categoryLabel: supplierCategoryLabel(target.category, target.locale),
      city: target.city,
      inviteUrl: inviteUrl(claim.token),
      optOutUrl: optOutUrl(sendId),
      monthlyVisitors: VENDOR_CAMPAIGN_MONTHLY_VISITORS,
      freeMonths: offerMonths(),
      locale: target.locale,
    },
    {
      user: null,
      guest: { email: target.email, full_name: target.listing_name },
      guestLocale: target.locale,
      trackingPixelUrl: pixelUrl(sendId),
      listUnsubscribeUrl: `${CONFIG.frontendBaseUrl}/api/emails/optout/${makeCampaignOptOutToken(sendId)}`,
    },
  );

  // `skipped_no_provider` is the dev/test path (no RESEND_API_KEY). Treat it as
  // sent so local runs exercise the whole funnel, matching what every other
  // sweep in this codebase does.
  const ok = result.status === "sent" || result.status === "skipped_no_provider";
  db.prepare(
    "UPDATE vendor_claim_campaign_sends SET status = ?, sent_at = ?, error = ? WHERE id = ?",
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
      `SELECT COUNT(*) AS n FROM vendor_claim_campaign_sends
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
      "UPDATE vendor_claim_campaigns SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?",
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

/** One nudge per recipient, VENDOR_CAMPAIGN_REMINDER_AFTER_MS after the first
 *  mail, to everyone who has not CLICKED (see the header note on why opens are
 *  the wrong gate). Skips anyone whose listing has since been claimed, and
 *  anyone who opted out in between.
 *
 *  The reminder re-uses the ORIGINAL claim token, not a fresh one: the token is
 *  the lookup key for click-tracking, and re-minting would orphan the link in
 *  the first mail. The redirect route heals an expired claim on the way
 *  through, so the older link keeps working regardless. */
export async function sendCampaignReminders(limit: number, ts: number = now()): Promise<number> {
  const rows = db
    .prepare(
      `SELECT s.* FROM vendor_claim_campaign_sends s
         JOIN vendor_claim_campaigns c ON c.id = s.campaign_id
         LEFT JOIN listings l ON l.id = s.listing_id
        WHERE s.status = 'sent'
          AND s.sent_at IS NOT NULL
          AND s.sent_at <= ?
          AND s.reminder_sent_at IS NULL
          AND s.clicked_at IS NULL
          AND s.claim_token IS NOT NULL
          AND l.vendor_account_id IS NULL
          AND s.email NOT IN (SELECT email FROM email_optouts)
          -- Pause is the emergency brake. If an operator stops a campaign
          -- because something is wrong with it, letting the follow-up wave keep
          -- going would compound exactly the mistake they just halted. 'done'
          -- is the normal end state (everyone written to), so it must NOT stop
          -- the reminders those sends are still owed.
          AND c.status != 'paused'
        ORDER BY s.sent_at ASC
        LIMIT ?`,
    )
    .all(ts - VENDOR_CAMPAIGN_REMINDER_AFTER_MS, limit) as SendRow[];

  let sent = 0;
  for (const row of rows) {
    const listing = db
      .prepare("SELECT name, city FROM listings WHERE id = ?")
      .get(row.listing_id) as { name: string; city: string } | undefined;
    if (!listing) continue;
    const locale = row.locale === "hu" ? "hu" : "en";
    const result = await sendKind(
      "vendor_claim_campaign_reminder",
      {
        listingName: listing.name,
        categoryLabel: supplierCategoryLabel(row.category, locale),
        city: displayCity(listing.city),
        inviteUrl: inviteUrl(row.claim_token as string),
        optOutUrl: optOutUrl(row.id),
        monthlyVisitors: VENDOR_CAMPAIGN_MONTHLY_VISITORS,
        freeMonths: offerMonths(),
        locale,
      },
      {
        user: null,
        guest: { email: row.email, full_name: listing.name },
        guestLocale: locale,
        trackingPixelUrl: pixelUrl(row.id),
        listUnsubscribeUrl: `${CONFIG.frontendBaseUrl}/api/emails/optout/${makeCampaignOptOutToken(row.id)}`,
      },
    );
    // Stamp regardless of outcome: this is a one-shot nudge, and retrying a
    // hard-bouncing address every hour is exactly how a sender gets blocked.
    db.prepare("UPDATE vendor_claim_campaign_sends SET reminder_sent_at = ? WHERE id = ?").run(
      ts,
      row.id,
    );
    if (result.status === "sent" || result.status === "skipped_no_provider") sent++;
  }
  return sent;
}

// ── Tracking write-backs ────────────────────────────────────────────────────

/** First open wins: COALESCE keeps the original timestamp so a mail re-opened
 *  a week later doesn't rewrite history. */
export function markCampaignOpened(sendId: number, ts: number = now()): void {
  db.prepare(
    "UPDATE vendor_claim_campaign_sends SET opened_at = COALESCE(opened_at, ?) WHERE id = ?",
  ).run(ts, sendId);
}

export function getSendByClaimToken(token: string): SendRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_claim_campaign_sends WHERE claim_token = ?").get(token) as
      | SendRow
      | undefined) ?? null
  );
}

export function getSendById(sendId: number): SendRow | null {
  return (
    (db.prepare("SELECT * FROM vendor_claim_campaign_sends WHERE id = ?").get(sendId) as
      | SendRow
      | undefined) ?? null
  );
}

/** Resolve an invite click to a LIVE claim token, healing an expired one on the
 *  way. A cold-outreach link that 410s two weeks later is a wasted lead: the
 *  recipient's intent is unambiguous, and the address that proves ownership has
 *  not changed, so minting a fresh claim for the same listing is safe.
 *  Returns null when the listing has since been claimed or deleted. */
export function resolveInviteClaimToken(token: string, ts: number = now()): string | null {
  const send = getSendByClaimToken(token);
  if (send) {
    db.prepare(
      "UPDATE vendor_claim_campaign_sends SET clicked_at = COALESCE(clicked_at, ?) WHERE id = ?",
    ).run(ts, send.id);
  }
  const listingId = send?.listing_id ?? getClaimByToken(token)?.listing_id;
  if (!listingId) return null;
  const listing = db
    .prepare("SELECT contact_email, vendor_account_id FROM listings WHERE id = ?")
    .get(listingId) as
    | { contact_email: string | null; vendor_account_id: number | null }
    | undefined;
  if (!listing || listing.vendor_account_id != null) return null;

  const existing = getClaimByToken(token);
  if (existing) {
    const fresh = expireStaleClaim(existing);
    if (fresh.status === "pending") return fresh.token;
  }
  const contact = send?.email ?? listing.contact_email;
  if (!contact) return null;
  return createClaim(listingId, contact, null).token;
}
