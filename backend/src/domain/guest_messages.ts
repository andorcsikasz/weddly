// Guest-broadcast domain: recipient resolution, the per-head envelope tip
// computation, and the shared send routine reused by both the POST send-now
// path (routes/guest_messages.ts) and the scheduled sweep (emails/worker.ts).

import type { EnvelopeTip, GuestMessageAudience, GuestMessageTemplate } from "@shared/types";
import { CONFIG } from "../config";
import { db } from "../db";
import type { CoupleRow } from "./couples";
import { sendKind } from "./emails";

/** A guest eligible to receive a broadcast: has an email, isn't a supplier, and
 *  isn't the couple themselves. `household_code` is null for guests with no
 *  household (rare) — the invite template needs it, the info templates don't. */
export interface BroadcastRecipient {
  guestId: number;
  email: string;
  full_name: string;
  household_code: string | null;
}

/** Resolve the set of guests a broadcast should target for the given audience.
 *  Eligible = non-supplier, non-partner guests with an email that don't live in
 *  the couple's supplier household. Deduped by lowercased email so a couple that
 *  put the same address on two rows only gets one send. */
export function resolveRecipients(
  coupleId: number,
  audience: GuestMessageAudience,
): BroadcastRecipient[] {
  let audienceClause = "";
  if (audience === "pending") audienceClause = "AND g.rsvp_status IN ('pending','maybe')";
  else if (audience === "confirmed") audienceClause = "AND g.rsvp_status = 'yes'";

  const rows = db
    .prepare(
      `SELECT g.id AS guest_id, g.email AS email, g.full_name AS full_name,
              h.code AS household_code
         FROM guests g
         LEFT JOIN households h ON h.id = g.household_id
        WHERE g.couple_id = ?
          AND g.email IS NOT NULL AND g.email != ''
          AND g.is_supplier = 0
          AND g.partner_role IS NULL
          AND (h.id IS NULL OR h.is_supplier_household = 0)
          ${audienceClause}
        ORDER BY g.created_at ASC`,
    )
    .all(coupleId) as Array<{
    guest_id: number;
    email: string;
    full_name: string;
    household_code: string | null;
  }>;

  const seen = new Set<string>();
  const out: BroadcastRecipient[] = [];
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      guestId: r.guest_id,
      email: r.email,
      full_name: r.full_name,
      household_code: r.household_code,
    });
  }
  return out;
}

/** Compute the "what to put in the envelope" per-head figure for a couple.
 *  `auto` = total planned budget ÷ confirmed (rsvp yes, non-supplier, non-couple)
 *  guests, rounded; null when there's no budget or no confirmed guests. The
 *  couple's own bride/groom rows are excluded so "cost per guest" counts only
 *  the people who'd put something in an envelope (matches `resolveRecipients`). */
export function computeEnvelopeTip(couple: CoupleRow): EnvelopeTip {
  const budget = db
    .prepare("SELECT COALESCE(SUM(planned_huf), 0) AS total FROM budget_lines WHERE couple_id = ?")
    .get(couple.id) as { total: number };
  const confirmed = db
    .prepare(
      "SELECT COUNT(*) AS n FROM guests WHERE couple_id = ? AND rsvp_status = 'yes' AND is_supplier = 0 AND partner_role IS NULL",
    )
    .get(couple.id) as { n: number };

  const total = budget.total ?? 0;
  const heads = confirmed.n ?? 0;
  const auto = total > 0 && heads > 0 ? Math.round(total / heads) : null;
  const override = couple.envelope_tip_amount_override ?? null;
  const enabled = couple.envelope_tip_enabled == null ? true : Boolean(couple.envelope_tip_enabled);
  return { auto, override, effective: override ?? auto, enabled };
}

/** Format an integer amount in the couple's display currency. HUF couples get a
 *  hu-HU render, everyone else en-GB; whole units, no decimals. */
export function formatEnvelopeAmount(couple: CoupleRow, amount: number): string {
  const currency = couple.currency ?? "HUF";
  const locale = currency === "HUF" ? "hu-HU" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** The tasteful Hungarian envelope-tip sentence rendered verbatim as the last
 *  paragraph of a pre-wedding info mail. No em-dash by project rule. */
export function envelopeTipSentence(couple: CoupleRow, amount: number): string {
  const formatted = formatEnvelopeAmount(couple, amount);
  return `Tipp a Weddlytől: egy vendég nálunk nagyjából ${formatted}. Ha gondolod, ennyi jó kiindulópont a borítékba.`;
}

/** Split a couple-authored body into paragraphs (blank-line separated). Empty
 *  body yields an empty array so the email template falls back to its default. */
export function bodyToParagraphs(body: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export interface GuestMessageContent {
  template: GuestMessageTemplate;
  subject: string | null;
  body: string | null;
  include_envelope_tip: boolean;
}

export interface GuestMessageSendResult {
  /** Number of recipients actually dispatched to. */
  sent: number;
  /** Envelope per-head amount snapshotted into the row (pre_wedding_info only). */
  envelopeAmount: number | null;
}

/** Send one composed broadcast to every resolved recipient. Shared by the
 *  immediate POST path and the scheduled worker sweep so the per-template
 *  dispatch logic lives in exactly one place. Fire-and-forget per recipient
 *  (sendKind never throws) — the returned `sent` count is the number of
 *  recipients we attempted a dispatch for. */
export function sendGuestMessage(
  couple: CoupleRow,
  content: GuestMessageContent,
  recipients: BroadcastRecipient[],
  submitterUserId: number | null,
): GuestMessageSendResult {
  const paragraphs = bodyToParagraphs(content.body);

  // Pre-wedding info can carry the per-head envelope tip. Compute + snapshot the
  // effective amount once and render the same sentence into every recipient's
  // mail so the figure can't drift mid-batch.
  let envelopeAmount: number | null = null;
  let envelopeSentence: string | null = null;
  if (content.template === "pre_wedding_info" && content.include_envelope_tip) {
    const tip = computeEnvelopeTip(couple);
    if (tip.effective != null) {
      envelopeAmount = tip.effective;
      envelopeSentence = envelopeTipSentence(couple, tip.effective);
    }
  }

  let sent = 0;
  for (const r of recipients) {
    if (content.template === "invite") {
      // Invite reuses the households batch shape: skip guests with no household
      // code (can't build a check-in link for them).
      if (!r.household_code || !couple.slug) continue;
      const rsvpUrl = `${CONFIG.frontendBaseUrl}/rsvp?couple=${couple.slug}&code=${r.household_code}`;
      void sendKind(
        "guest_invite",
        {
          coupleDisplayName: couple.display_name,
          guestName: r.full_name,
          weddingDate: couple.wedding_date,
          rsvpUrl,
        },
        {
          user: null,
          guest: { email: r.email, full_name: r.full_name },
          couple_id: couple.id,
          submitterUserId: submitterUserId ?? undefined,
          guestId: r.guestId,
        },
      );
      sent++;
      continue;
    }

    const infoUrl = r.household_code
      ? `${CONFIG.frontendBaseUrl}/w/${couple.slug}/${r.household_code}`
      : `${CONFIG.frontendBaseUrl}/w/${couple.slug}`;

    if (content.template === "major_update") {
      void sendKind(
        "guest_major_update",
        {
          coupleDisplayName: couple.display_name,
          guestName: r.full_name,
          weddingDate: couple.wedding_date,
          infoUrl,
          subject: content.subject,
          bodyParagraphs: paragraphs,
        },
        {
          user: null,
          guest: { email: r.email, full_name: r.full_name },
          couple_id: couple.id,
          submitterUserId: submitterUserId ?? undefined,
        },
      );
      sent++;
      continue;
    }

    // pre_wedding_info
    void sendKind(
      "guest_pre_wedding_info",
      {
        coupleDisplayName: couple.display_name,
        guestName: r.full_name,
        weddingDate: couple.wedding_date,
        infoUrl,
        subject: content.subject,
        bodyParagraphs: paragraphs,
        envelopeTip: envelopeSentence,
      },
      {
        user: null,
        guest: { email: r.email, full_name: r.full_name },
        couple_id: couple.id,
        submitterUserId: submitterUserId ?? undefined,
      },
    );
    sent++;
  }

  return { sent, envelopeAmount };
}
