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
import { sendEmail } from "../../lib/mailer";
import { reportError } from "../../lib/observability";
import { makeOpenTrackingToken } from "../../routes/email_track";
import { type EmailKind, KIND_CATEGORY } from "./kinds";
import { recordEmailAttempt } from "./log";
import { ensurePreferences } from "./preferences";
import type { RecipientLocale } from "./template";
import { buildEmail, type KindPayload } from "./templates";

/** Map a raw `users.locale` value to one of the two locales our templates
 *  cover. We have HU + EN copy today; anything else (DE/FR/ES …) renders as
 *  EN until per-locale copy lands. `null` falls back to bilingual HU+EN. */
function normalizeRecipientLocale(raw: string | null | undefined): RecipientLocale {
  if (raw == null) return null;
  const lc = raw.toLowerCase();
  if (lc === "hu" || lc.startsWith("hu-") || lc.startsWith("hu_")) return "hu";
  return "en";
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
   * RFC 8058 one-click unsubscribe target for mail that is NOT lifecycle and
   * therefore has no `email_preferences` token, i.e. cold outreach to an
   * address with no account. Gmail's bulk-sender rules want the header on any
   * high-volume send regardless of our internal category.
   */
  listUnsubscribeUrl?: string;
}

interface SendResult {
  status: "sent" | "failed" | "skipped_opt_out" | "skipped_no_provider";
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

  let unsubscribeToken: string | undefined;
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
  const primaryLocaleHint: "hu" | "en" | undefined =
    recipientLocale === null && target.submitterUserId
      ? (lookupUserLocale(target.submitterUserId) ?? undefined)
      : undefined;
  if (target.user) {
    const prefs = ensurePreferences(target.user.id);
    if (category === "lifecycle" && prefs.lifecycle_opt_out) {
      const built = buildEmail(kind, payload, {
        recipientName: recipient.name,
        unsubscribeToken: prefs.unsubscribe_token,
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
    unsubscribeToken = prefs.unsubscribe_token;
  }

  const trackingPixelUrl =
    target.trackingPixelUrl ??
    (target.guestId != null && target.couple_id != null
      ? `${CONFIG.frontendBaseUrl}/api/emails/track/open?t=${makeOpenTrackingToken(target.guestId, target.couple_id)}`
      : undefined);

  const built = buildEmail(kind, payload, {
    recipientName: recipient.name,
    unsubscribeToken,
    recipientLocale,
    primaryLocaleHint,
    trackingPixelUrl,
  });

  // RFC 8058 one-click unsubscribe headers. Gmail's bulk-sender requirements
  // (Feb 2024) require both `List-Unsubscribe` and `List-Unsubscribe-Post`
  // for any sender > 5k recipients/day. The header URL points at the backend
  // endpoint (no JS, returns a tiny HTML confirmation on GET, flips the flag
  // silently on POST) so Gmail's auto-unsubscribe bot can complete in one hit.
  // Per-kind `replyTo` overrides land in the same map — supplier_outreach
  // sets it to the couple owner's email so a vendor's reply lands in the
  // couple's inbox instead of `CONFIG.supportEmail`.
  const extraHeaders: Record<string, string> = {};
  if (category === "lifecycle" && unsubscribeToken) {
    extraHeaders["List-Unsubscribe"] =
      `<${CONFIG.frontendBaseUrl}/api/unsubscribe/${unsubscribeToken}>`;
    extraHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  } else if (target.listUnsubscribeUrl) {
    // Cold outreach: the recipient has no preferences row to hold a token, so
    // the caller supplies its own suppression endpoint.
    extraHeaders["List-Unsubscribe"] = `<${target.listUnsubscribeUrl}>`;
    extraHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (built.replyTo) {
    extraHeaders["Reply-To"] = built.replyTo;
  }
  const headers: Record<string, string> | undefined =
    Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined;

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
      to_email: recipient.email,
      subject: built.subject,
      status: "skipped_no_provider",
    });
    void sendEmail({
      to: recipient.email,
      subject: built.subject,
      html: built.rendered.html,
      text: built.rendered.text,
      headers,
    });
    return { status: "skipped_no_provider" };
  }

  try {
    await sendEmail({
      to: recipient.email,
      subject: built.subject,
      html: built.rendered.html,
      text: built.rendered.text,
      headers,
    });
    recordEmailAttempt({
      user_id: target.user?.id ?? null,
      couple_id: target.couple_id ?? null,
      kind,
      category,
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

/** Send a raw ad-hoc email without going through the template/kind system.
 *  Use ONLY for one-off outreach notifications that do not fit the kind
 *  catalogue (e.g. guest group-gift coordination). The caller is responsible
 *  for constructing both HTML and plain-text bodies and for wrapping the
 *  call in a fire-and-forget `void` + try/catch. Never throws. */
export async function sendRawEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  try {
    await sendEmail({ to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
  } catch {
    // Best-effort — mirror the never-throw contract of sendKind.
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
