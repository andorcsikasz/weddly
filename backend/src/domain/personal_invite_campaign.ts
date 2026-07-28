// Personal-invite campaign: warm outreach to the founder's own contacts,
// imported from a CSV, telling them about Weddly with a "you (or someone you
// love) is getting married" note and a register CTA.
//
// This is a third sibling of domain/vendor_campaign.ts and
// domain/vendor_review_campaign.ts, deliberately parallel rather than a mode of
// them, because the audience is a FIXED imported list rather than a live query
// over the directory. One send row is seeded per contact at import (deduped
// against `users` and `email_optouts`); the paced sweep then drains 'queued'
// rows up to the rolling-24h daily_cap, RE-checking users/optouts at send time
// so anyone who registers or opts out between import and send is never mailed.
//
// It shares the genuinely generic plumbing with the vendor campaigns: the
// address-level email_optouts suppression (addOptOut/isOptedOut) and
// normalizeEmail. Conversion is attributed without click-tracking: the CTA
// carries a UTM the signup-acquisition capture reads, and `registered` is
// computed live from whether the address gained a `users` row.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CreatePersonalInviteCampaignInput,
  type ImportContact,
  PERSONAL_INVITE_DEFAULT_DAILY_CAP,
  PERSONAL_INVITE_MAX_DAILY_CAP,
  type PersonalInviteCampaign,
  type PersonalInviteCampaignDetail,
  type PersonalInviteCampaignSend,
  type PersonalInviteCampaignSendStatus,
  type PersonalInviteCampaignStats,
  type PersonalInviteCampaignStatus,
  type PersonalInviteImportResult,
  type UpdatePersonalInviteCampaignInput,
} from "@shared/personal_invite_campaign";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { sendKind } from "./emails/send";
import { addOptOut, isOptedOut, normalizeEmail } from "./vendor_campaign";

export { addOptOut, isOptedOut, normalizeEmail };

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

// ── Locale detection ──────────────────────────────────────────────────────────
// The list is overwhelmingly Hungarian personal contacts, so HU is the default
// and we only flip to EN on a STRONG non-HU signal: an email on a non-Hungarian
// country TLD. A Hungarian diacritic in the name reinforces HU. Everything else
// stays HU. This is deliberately conservative (a wrong guess sends a HU speaker
// English, which reads worse than the reverse), and the detected locale is
// surfaced per send so the operator can eyeball the split before launching.

const NON_HU_CCTLD = new Set([
  "uk",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "at",
  "ch",
  "us",
  "ca",
  "au",
  "ie",
  "be",
  "pt",
  "se",
  "no",
  "dk",
  "fi",
  "pl",
  "cz",
  "sk",
  "ro",
  "gr",
  "co",
  "io",
]);

const HU_DIACRITIC = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

export function detectLocale(name: string, email: string): "hu" | "en" {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain.endsWith(".hu")) return "hu";
  const tld = domain.split(".").pop() ?? "";
  if (NON_HU_CCTLD.has(tld)) return "en";
  if (HU_DIACRITIC.test(name)) return "hu";
  return "hu";
}

// ── Signed per-send opt-out token ─────────────────────────────────────────────
// The List-Unsubscribe link is `<sendId>.<hmac>`: worthless if leaked,
// unforgeable, and it resolves to the send row we suppress. Namespaced with
// "invite_" so a token minted here can never resolve against a vendor campaign.

function signInvite(purpose: string, sendId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`invite_${purpose}:${sendId}`)
    .digest("hex")
    .slice(0, 32);
}

function makeInviteToken(purpose: string, sendId: number): string {
  return `${sendId}.${signInvite(purpose, sendId)}`;
}

function verifyInviteToken(purpose: string, token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, sig] = parts as [string, string];
  const sendId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(sendId) || sendId <= 0) return null;
  const expected = signInvite(purpose, sendId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return sendId;
}

export const makeInviteOptOutToken = (sendId: number) => makeInviteToken("optout", sendId);
export const verifyInviteOptOutToken = (t: string) => verifyInviteToken("optout", t);

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

function toCampaignStatus(raw: string): PersonalInviteCampaignStatus {
  if (raw === "running" || raw === "done") return raw;
  return "paused";
}

function toCampaign(row: CampaignRow): PersonalInviteCampaign {
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
  if (raw == null) return PERSONAL_INVITE_DEFAULT_DAILY_CAP;
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > PERSONAL_INVITE_MAX_DAILY_CAP) {
    throw new HttpError(
      400,
      `daily_cap must be an integer between 1 and ${PERSONAL_INVITE_MAX_DAILY_CAP}`,
    );
  }
  return n;
}

export function createCampaign(
  input: CreatePersonalInviteCampaignInput,
  actorUserId: number | null,
): PersonalInviteCampaign {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    throw new HttpError(400, "slug must be 2-61 lowercase letters, digits or dashes");
  }
  const dailyCap = parseDailyCap(input.daily_cap);
  const ts = now();
  try {
    const row = db
      .prepare(
        `INSERT INTO personal_invite_campaigns (slug, status, daily_cap, created_by, created_at, updated_at)
         VALUES (?, 'paused', ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(slug, dailyCap, actorUserId, ts, ts) as CampaignRow;
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
    (db.prepare("SELECT * FROM personal_invite_campaigns WHERE id = ?").get(id) as
      | CampaignRow
      | undefined) ?? null
  );
}

export function listCampaigns(): PersonalInviteCampaign[] {
  const rows = db
    .prepare("SELECT * FROM personal_invite_campaigns ORDER BY created_at DESC")
    .all() as CampaignRow[];
  return rows.map(toCampaign);
}

export function updateCampaign(
  id: number,
  patch: UpdatePersonalInviteCampaignInput,
): PersonalInviteCampaign {
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
  const startedAt = status === "running" && row.started_at == null ? ts : row.started_at;
  const endedAt =
    status === "done" ? (row.ended_at ?? ts) : status === "running" ? null : row.ended_at;
  const updated = db
    .prepare(
      `UPDATE personal_invite_campaigns
          SET status = ?, daily_cap = ?, updated_at = ?, started_at = ?, ended_at = ?
        WHERE id = ? RETURNING *`,
    )
    .get(status, dailyCap, ts, startedAt, endedAt, id) as CampaignRow;
  return toCampaign(updated);
}

// ── Import ─────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a `name,email` CSV (with header) into contacts. Handles the UTF-8 BOM,
 *  double-quoted fields and quoted commas. Rows missing an email are dropped by
 *  the importer's invalid-email guard, not here. */
export function parseCsvContacts(csv: string): ImportContact[] {
  const out: ImportContact[] = [];
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const a = (cells[0] ?? "").trim();
    const b = (cells[1] ?? "").trim();
    // Skip a header row ("name,email" in any case).
    if (i === 0 && a.toLowerCase() === "name" && b.toLowerCase() === "email") continue;
    // Tolerate a single-column (email-only) file too.
    if (b) out.push({ name: a, email: b });
    else if (a.includes("@")) out.push({ name: "", email: a });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** True when an address already owns a Weddly account. */
function isRegistered(email: string): boolean {
  const row = db.prepare("SELECT 1 FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1").get(email) as
    | { 1: number }
    | undefined;
  return row != null;
}

/** Seed one queued send row per contact, deduping against already-registered
 *  addresses, opted-out addresses, duplicates within the file, and this
 *  campaign's own existing rows. Returns a per-reason breakdown. */
export function importContacts(
  campaignId: number,
  contacts: ImportContact[],
): PersonalInviteImportResult {
  const campaign = getCampaignRow(campaignId);
  if (!campaign) throw new HttpError(404, "Campaign not found");
  const result: PersonalInviteImportResult = {
    imported: 0,
    skipped_registered: 0,
    skipped_optout: 0,
    skipped_duplicate: 0,
    skipped_invalid: 0,
  };
  const ts = now();
  const seen = new Set<string>();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO personal_invite_campaign_sends
       (campaign_id, name, email, locale, status, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  );
  const tx = db.transaction((rows: ImportContact[]) => {
    for (const c of rows) {
      const email = normalizeEmail(c.email ?? "");
      const name = (c.name ?? "").trim();
      if (!EMAIL_RE.test(email)) {
        result.skipped_invalid++;
        continue;
      }
      if (seen.has(email)) {
        result.skipped_duplicate++;
        continue;
      }
      seen.add(email);
      if (isRegistered(email)) {
        result.skipped_registered++;
        continue;
      }
      if (isOptedOut(email)) {
        result.skipped_optout++;
        continue;
      }
      const locale = detectLocale(name, email);
      const res = insert.run(campaignId, name, email, locale, ts);
      if (res.changes === 1) result.imported++;
      else result.skipped_duplicate++; // already in this campaign (UNIQUE hit)
    }
  });
  tx(contacts);
  return result;
}

// ── Stats + listing ────────────────────────────────────────────────────────────

interface SendRow {
  id: number;
  campaign_id: number;
  name: string;
  email: string;
  locale: string;
  status: string;
  error: string | null;
  sent_at: number | null;
  created_at: number;
}

function toSendStatus(raw: string): PersonalInviteCampaignSendStatus {
  if (raw === "sent" || raw === "failed" || raw === "skipped") return raw;
  return "queued";
}

/** A send "converted" when its address now owns a Weddly account. A login-free
 *  proxy for the invite working, however the person actually signed up. */
const REGISTERED_EXISTS = `EXISTS (
  SELECT 1 FROM users u WHERE LOWER(TRIM(u.email)) = s.email
)`;

export function campaignStats(campaign: CampaignRow): PersonalInviteCampaignStats {
  const agg = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN s.status = 'queued'  THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN s.status = 'sent'    THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN s.status = 'failed'  THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
         SUM(CASE WHEN s.locale = 'hu' THEN 1 ELSE 0 END) AS hu,
         SUM(CASE WHEN s.locale = 'en' THEN 1 ELSE 0 END) AS en,
         SUM(CASE WHEN ${REGISTERED_EXISTS} THEN 1 ELSE 0 END) AS registered,
         SUM(CASE WHEN s.sent_at IS NOT NULL AND s.sent_at >= ? THEN 1 ELSE 0 END) AS sent_last_24h
       FROM personal_invite_campaign_sends s
      WHERE s.campaign_id = ?`,
    )
    .get(now() - ONE_DAY_MS, campaign.id) as Record<string, number | null>;
  return {
    total: agg.total ?? 0,
    queued: agg.queued ?? 0,
    sent: agg.sent ?? 0,
    failed: agg.failed ?? 0,
    skipped: agg.skipped ?? 0,
    hu: agg.hu ?? 0,
    en: agg.en ?? 0,
    registered: agg.registered ?? 0,
    sent_last_24h: agg.sent_last_24h ?? 0,
  };
}

export function getCampaignDetail(id: number): PersonalInviteCampaignDetail | null {
  const row = getCampaignRow(id);
  if (!row) return null;
  return { campaign: toCampaign(row), stats: campaignStats(row) };
}

export function listSends(campaignId: number, limit: number): PersonalInviteCampaignSend[] {
  const rows = db
    .prepare(
      `SELECT s.*, (CASE WHEN ${REGISTERED_EXISTS} THEN 1 ELSE 0 END) AS registered
         FROM personal_invite_campaign_sends s
        WHERE s.campaign_id = ?
        ORDER BY s.id ASC
        LIMIT ?`,
    )
    .all(campaignId, limit) as Array<SendRow & { registered: number }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    locale: row.locale === "en" ? "en" : "hu",
    status: toSendStatus(row.status),
    error: row.error,
    sent_at: row.sent_at,
    registered: row.registered === 1,
    created_at: row.created_at,
  }));
}

export function getInviteSendById(sendId: number): SendRow | null {
  return (
    (db.prepare("SELECT * FROM personal_invite_campaign_sends WHERE id = ?").get(sendId) as
      | SendRow
      | undefined) ?? null
  );
}

// ── Sending ────────────────────────────────────────────────────────────────────

/** The register CTA, carrying a UTM the signup-acquisition capture reads so a
 *  signup that came from this campaign is attributable without any click
 *  redirect. */
export function registerUrl(slug: string): string {
  return `${CONFIG.frontendBaseUrl}/?utm_source=invite&utm_medium=email&utm_campaign=${encodeURIComponent(slug)}`;
}

/** Send one invite for an already-seeded 'queued' row. Never throws: a single
 *  bad address must not abort the batch. Returns the resulting status. */
async function sendOne(
  campaign: CampaignRow,
  row: SendRow,
  ts: number,
): Promise<PersonalInviteCampaignSendStatus> {
  const locale = row.locale === "en" ? "en" : "hu";
  const result = await sendKind(
    "personal_invite",
    {
      name: row.name,
      ctaUrl: registerUrl(campaign.slug),
      locale,
    },
    {
      user: null,
      guest: { email: row.email, full_name: row.name || row.email },
      guestLocale: locale,
    },
  );
  if (result.status === "skipped_opt_out") {
    db.prepare("UPDATE personal_invite_campaign_sends SET status = 'skipped' WHERE id = ?").run(
      row.id,
    );
    return "skipped";
  }
  const ok = result.status === "sent" || result.status === "skipped_no_provider";
  db.prepare(
    "UPDATE personal_invite_campaign_sends SET status = ?, sent_at = ?, error = ? WHERE id = ?",
  ).run(
    ok ? "sent" : "failed",
    ok ? ts : null,
    ok ? null : (result.error ?? "send failed"),
    row.id,
  );
  return ok ? "sent" : "failed";
}

/** How many more mails this campaign may send right now, from its rolling-24h
 *  budget. */
export function remainingDailyBudget(campaign: CampaignRow, ts: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM personal_invite_campaign_sends
        WHERE campaign_id = ? AND sent_at IS NOT NULL AND sent_at >= ?`,
    )
    .get(campaign.id, ts - ONE_DAY_MS) as { n: number };
  return Math.max(0, campaign.daily_cap - row.n);
}

/** Send up to `limit` invites for one campaign, honouring its daily budget.
 *  Retires the campaign to Done when the queue is empty. Returns how many
 *  actually went out. */
export async function sendCampaignBatch(
  campaign: CampaignRow,
  limit: number,
  ts: number = now(),
): Promise<number> {
  // Drop any queued rows that became ineligible since import (registered or
  // opted out in the meantime) so they leave the queue and can't block it.
  db.prepare(
    `UPDATE personal_invite_campaign_sends
        SET status = 'skipped'
      WHERE campaign_id = ? AND status = 'queued'
        AND (email IN (SELECT email FROM email_optouts)
             OR email IN (SELECT LOWER(TRIM(email)) FROM users WHERE email IS NOT NULL))`,
  ).run(campaign.id);

  const budget = Math.min(limit, remainingDailyBudget(campaign, ts));
  if (budget <= 0) return 0;

  const rows = db
    .prepare(
      `SELECT * FROM personal_invite_campaign_sends
        WHERE campaign_id = ? AND status = 'queued'
        ORDER BY id ASC LIMIT ?`,
    )
    .all(campaign.id, budget) as SendRow[];

  if (rows.length === 0) {
    const left = db
      .prepare(
        "SELECT COUNT(*) AS n FROM personal_invite_campaign_sends WHERE campaign_id = ? AND status = 'queued'",
      )
      .get(campaign.id) as { n: number };
    if (left.n === 0) {
      db.prepare(
        "UPDATE personal_invite_campaigns SET status = 'done', ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?",
      ).run(ts, ts, campaign.id);
    }
    return 0;
  }

  let sent = 0;
  for (const row of rows) {
    const status = await sendOne(campaign, row, ts);
    if (status === "sent") sent++;
  }
  return sent;
}
