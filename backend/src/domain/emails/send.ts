// Email dispatcher — the single chokepoint every flow goes through.
//
//   await sendKind("welcome_verify", payload, { user, couple });
//
// Responsibilities (in order):
//   1. Look up the user's preferences (or the implicit prefs of a guest).
//   2. For lifecycle mail, short-circuit if the user is opted out — log it.
//   3. Build the rendered email (template.ts → templates.ts).
//   4. Hand off to the underlying `sendEmail` (lib/mailer.ts).
//   5. Record the attempt in `email_log`, success or fail.
//   6. Best-effort idempotency stamp in `email_dispatches` for cron-driven kinds.
//
// Errors never propagate to the caller — every send is fire-and-forget; the
// log table is the source of truth for "did it actually go out?".

import { CONFIG } from "../../config";
import { db, now } from "../../db";
import { sendEmail, type SendEmailInput } from "../../lib/mailer";
import { reportError } from "../../lib/observability";
import { makeOpenTrackingToken } from "../../routes/email_track";
import { type EmailKind, type EmailSender, KIND_CATEGORY, senderForKind } from "./kinds";
import { recordEmailAttempt } from "./log";
import { isOptedOut } from "./optouts";
import { ensurePreferences } from "./preferences";
import { isUiLocale } from "@shared/locales";
import type { RecipientLocale } from "./template";
import { buildEmail, type KindPayload } from "./templates";
import {
  type AdminEmailSendReservation,
  reservationMatches,
  reserveAdminEmailSend,
} from "./admin_dedupe";

/** Deliver an exceptional transactional message through the same module
 * boundary as templated product mail. Legal case notifications have dynamic
 * case text and therefore do not map to a marketing/lifecycle EmailKind, but
 * callers must still not bypass this central dispatch boundary. */
export async function sendTransactionalMessage(input: SendEmailInput): Promise<void> {
  await sendEmail(input);
}

/** Map a raw `users.locale` value to one of the two locales our templates
 *  cover. We have HU + EN copy today; anything else (DE/FR/ES …) renders as
 *  EN until per-locale copy lands. `null` falls back to bilingual HU+EN. */
/** A stored / supplied locale string → the language this mail renders in.
 *
 *  Anything we ship a UI in is honoured, including regional tags (`de-AT` is a
 *  German reader). Everything else lands on EN rather than null: null means
 *  "we do not know", which is what the bilingual HU+EN stack is for, and a
 *  recipient who told us `fr` has told us something — just not something we
 *  have copy for. */
function normalizeRecipientLocale(raw: string | null | undefined): RecipientLocale {
  if (raw == null) return null;
  const lc = raw.toLowerCase();
  const base = lc.split(/[-_]/)[0] ?? lc;
  return isUiLocale(base) ? base : "en";
}

interface UserLocaleRow {
  locale: string | null;
}

function lookupUserLocale(userId: number): RecipientLocale {
  const row = db.prepare("SELECT locale FROM users WHERE id = ?").get(userId) as
    | UserLocaleRow
    | undefined;
  return normalizeRecipientLocale(row?.locale ?? null);
}

export interface SendTarget {
  /** The user who owns the inbox. `null` for guest-bound mail (no Weddly account). */
  user: { id: number; email: string; full_name: string } | null;
  /**
   * Recipient who filled in the register form but has no `users` row yet — the
   * signup is parked in `pending_signups` until this very mail's link is
   * clicked (see domain/pending_signups.ts). Carries its own locale because
   * there is no `users.locale` to look up.
   *
   * Set alongside `user: null`. No opt-out check runs for these: the only mail
   * on this path is the transactional welcome/verify link, and a pending signup
   * has no preferences row to consult anyway.
   */
  pending?: { email: string; full_name: string; locale: string | null } | null;
  /** Couple this email relates to, used for the email_log row + scoping. */
  couple_id?: number | null;
  /**
   * For guest-bound mail (RSVP thanks), the recipient is a guest, not a user.
   * Provide their address + name explicitly.
   */
  guest?: { email: string; full_name: string } | null;
  /**
   * User id whose `users.locale` should bias the bilingual render order
   * when the recipient's own locale is unknown. Used for outreach mail
   * (community supplier verify, vendor claim verify) — the submitter is
   * a known Weddly user; the recipient isn't. Surface the submitter's
   * language on top of the stack so a HU-using couple's submission lands
   * a HU-first mail on the vendor's inbox.
   */
  submitterUserId?: number;
  /**
   * When set alongside `couple_id`, a tracking pixel is embedded in the
   * rendered HTML (guest_invite only). The pixel endpoint stamps
   * `guests.invitation_opened_at` when the image loads.
   */
  guestId?: number;
  /**
   * Language for a `guest` send whose recipient we DO know the language of even
   * though they have no `users` row, e.g. the claim-invite campaign, which
   * resolves it from the listing's country. Without this a guest send falls
   * back to the bilingual HU+EN stack, which reads as spam to a vendor in
   * Portugal. Ignored when `user`/`pending` is set (their own locale wins).
   */
  guestLocale?: string | null;
  /**
   * Explicit tracking-pixel URL, for campaigns that own their own open-tracking
   * table. Takes precedence over the `guestId` + `couple_id` pixel above; the
   * caller is responsible for signing whatever token it embeds.
   */
  trackingPixelUrl?: string;
  /**
   * Force the FROM mailbox for this one send. Only needed for a kind the
   * worker also fires on its own (verify_resend, partner_invite_reminder,
   * planner_profile_incomplete): the admin call site passes `"admin"` so a
   * hand-sent nudge comes from the support mailbox while the automatic sweep
   * keeps the automatic sender. Kinds that are admin-only carry it on the kind
   * itself — see `ADMIN_CONSOLE_KINDS`.
   */
  sender?: EmailSender;
  /** A reservation acquired by an admin route before it rotates a one-time
   *  link. Most callers omit this and let the dispatcher reserve immediately
   *  before delivery. */
  adminEmailReservation?: AdminEmailSendReservation;
}

interface SendResult {
  status: "sent" | "failed" | "skipped_opt_out" | "skipped_no_provider" | "skipped_duplicate";
  error?: string;
}

export async function sendKind<K extends EmailKind>(
  kind: K,
  payload: KindPayload[K],
  target: SendTarget,
): Promise<SendResult> {
  // Honour the module's never-throw contract for the WHOLE body, not just the
  // network send. Pre-send work — lookupUserLocale, ensurePreferences (DB
  // reads), buildEmail (template render) — runs before the inner try block and
  // can throw (SQLITE_BUSY, a template bug). Without this guard a throw there
  // rejects the fire-and-forget `void sendKind(...)` and surfaces only as a
  // context-less process-level unhandledRejection.
  try {
    return await sendKindInner(kind, payload, target);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    try {
      recordEmailAttempt({
        user_id: target.user?.id ?? null,
        couple_id: target.couple_id ?? null,
        kind,
        category: KIND_CATEGORY[kind],
        to_email: "",
        subject: "",
        status: "failed",
        error: errMsg.slice(0, 500),
      });
      reportError("mailer.send_failed_pre_dispatch", e, {
        kind,
        couple_id: target.couple_id ?? null,
      });
    } catch {
      // Best-effort bookkeeping — never let the failure path throw either.
    }
    return { status: "failed", error: errMsg };
  }
}

async function sendKindInner<K extends EmailKind>(
  kind: K,
  payload: KindPayload[K],
  target: SendTarget,
): Promise<SendResult> {
  const category = KIND_CATEGORY[kind];

  // Resolve recipient + display name + unsubscribe token.
  const recipient = resolveRecipient(target);
  if (!recipient) {
    // No address — nothing we can do. Log and bail without firing.
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
      to_email: "",
      subject: "",
      status: "failed",
      error: "no recipient address",
    });
    return { status: "failed", error: "no recipient" };
  }

  // Address-level suppression, enforced for EVERY kind before we render or
  // send anything. Until now `email_optouts` was only consulted by campaign
  // targeting, which meant an unsubscribed address could still be reached by
  // any other outreach path — and a business that writes in asking us to stop
  // has asked about all of it, not one campaign. See domain/emails/optouts.ts.
  //
  // Transactional is the one carve-out: those are mails the recipient just
  // triggered and is waiting on (verify link, password reset, RSVP receipt).
  // Blocking them would mean a suppressed address that later decides to sign
  // up on its own could never complete the signup, which serves nobody.
  if (category !== "transactional" && isOptedOut(recipient.email)) {
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
      to_email: recipient.email,
      subject: "",
      status: "skipped_opt_out",
    });
    return { status: "skipped_opt_out" };
  }

  // Guest-bound mail (no user) keeps `null` → bilingual fallback render until
  // we capture a per-guest locale. Lookup happens against `users.locale`.
  // A pending signup has no users row yet but did tell us its locale on the
  // register form — use it directly so the welcome mail lands in their language.
  const recipientLocale: RecipientLocale = target.user
    ? lookupUserLocale(target.user.id)
    : target.pending
      ? normalizeRecipientLocale(target.pending.locale)
      : target.guestLocale != null
        ? normalizeRecipientLocale(target.guestLocale)
        : null;
  // For guest sends with a known submitter, resolve the submitter's locale
  // and bias the bilingual order toward it. Doesn't replace the bilingual
  // fallback — just reorders.
  // Only ever reorders the BILINGUAL stack, which is HU+EN, so a submitter on
  // any other language leaves the historical HU-first order alone.
  const submitterLocale =
    recipientLocale === null && target.submitterUserId
      ? lookupUserLocale(target.submitterUserId)
      : null;
  const primaryLocaleHint: "hu" | "en" | undefined =
    submitterLocale === "hu" || submitterLocale === "en" ? submitterLocale : undefined;
  if (target.user) {
    const prefs = ensurePreferences(target.user.id);
    if (category === "lifecycle" && prefs.lifecycle_opt_out) {
      const built = buildEmail(kind, payload, {
        recipientName: recipient.name,
        recipientLocale,
        primaryLocaleHint,
      });
      recordEmailAttempt({
        user_id: target.user.id,
        couple_id: target.couple_id ?? null,
        kind,
        category,
        to_email: recipient.email,
        subject: built.subject,
        status: "skipped_opt_out",
      });
      return { status: "skipped_opt_out" };
    }
  }

  const trackingPixelUrl =
    target.trackingPixelUrl ??
    (target.guestId != null && target.couple_id != null
      ? `${CONFIG.frontendBaseUrl}/api/emails/track/open?t=${makeOpenTrackingToken(target.guestId, target.couple_id)}`
      : undefined);

  const built = buildEmail(kind, payload, {
    recipientName: recipient.name,
    recipientLocale,
    primaryLocaleHint,
    trackingPixelUrl,
  });

  // Where a reply lands. A per-kind override (supplier_outreach points it at
  // the couple owner so a vendor's answer skips us entirely) wins; otherwise
  // the mailer falls back to CONFIG.supportEmail. Passed as its own field
  // rather than a header — Resend drops a Reply-To it finds in `headers`.
  const replyTo = built.replyTo;

  // Who this comes FROM. Resolved here, in the one chokepoint, rather than at
  // the call sites — a mailbox chosen per route is a mailbox that drifts.
  const sender = senderForKind(kind, target.sender);
  const fromEmail = sender === "admin" ? CONFIG.emailFromAdmin : CONFIG.emailFrom;

  // Admin sends are human-triggered and therefore especially exposed to a
  // double click, browser retry, or two operators acting on the same row. The
  // DB reservation is acquired before the provider call, so concurrent
  // requests cannot both leave the building. Automatic mail keeps its own
  // occurrence-based email_dispatches semantics and never enters this guard.
  if (sender === "admin") {
    const hasReservation = reservationMatches(target.adminEmailReservation, kind, recipient.email);
    if (!hasReservation && !reserveAdminEmailSend(kind, recipient.email)) {
      recordEmailAttempt({
        user_id: target.user?.id ?? null,
        couple_id: target.couple_id ?? null,
        kind,
        category,
        from_email: fromEmail,
        to_email: recipient.email,
        subject: built.subject,
        status: "skipped_duplicate",
        error: "duplicate admin send blocked within 5 minutes",
      });
      return { status: "skipped_duplicate" };
    }
  }

  if (!CONFIG.resendApiKey) {
    // Dev/test: mailer.ts just logs to stdout, never throws. Record the
    // attempt SYNCHRONOUSLY (before any await) so callers using fire-and-forget
    // `void sendKind(...)` can still observe the log row right after — tests
    // assume this. The actual stdout log is purely cosmetic.
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
      from_email: fromEmail,
      to_email: recipient.email,
      subject: built.subject,
      status: "skipped_no_provider",
    });
    void sendEmail({
      from: fromEmail,
      to: recipient.email,
      subject: built.subject,
      html: built.rendered.html,
      text: built.rendered.text,
      replyTo,
    });
    return { status: "skipped_no_provider" };
  }

  try {
    await sendEmail({
      from: fromEmail,
      to: recipient.email,
      subject: built.subject,
      html: built.rendered.html,
      text: built.rendered.text,
      replyTo,
    });
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
      from_email: fromEmail,
      to_email: recipient.email,
      subject: built.subject,
      status: "sent",
    });
    return { status: "sent" };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
      from_email: fromEmail,
      to_email: recipient.email,
      subject: built.subject,
      status: "failed",
      error: errMsg.slice(0, 500),
    });
    reportError("mailer.send_failed", e, {
      kind,
      to: recipient.email,
      couple_id: target.couple_id ?? null,
    });
    return { status: "failed", error: errMsg };
  }
}

/** Mark a `(couple_id, user_id, kind)` triplet as dispatched. Used by cron-
 *  driven sends so a worker crash or a re-run doesn't double-fire. The unique
 *  index in schema.sql makes this idempotent at the DB layer. */
export function markDispatched(opts: {
  kind: EmailKind;
  couple_id: number | null;
  user_id: number | null;
}): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO email_dispatches (couple_id, user_id, kind, dispatched_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(opts.couple_id, opts.user_id, opts.kind, now());
  return result.changes === 1;
}

function resolveRecipient(target: SendTarget): { email: string; name: string } | null {
  if (target.guest) {
    if (!target.guest.email) return null;
    return { email: target.guest.email, name: target.guest.full_name || "" };
  }
  if (target.user) {
    return { email: target.user.email, name: target.user.full_name || "" };
  }
  if (target.pending) {
    if (!target.pending.email) return null;
    return { email: target.pending.email, name: target.pending.full_name || "" };
  }
  return null;
}
