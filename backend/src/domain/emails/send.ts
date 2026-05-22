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
  const recipientLocale: RecipientLocale = target.user ? lookupUserLocale(target.user.id) : null;
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

  const built = buildEmail(kind, payload, {
    recipientName: recipient.name,
    unsubscribeToken,
    recipientLocale,
    primaryLocaleHint,
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
  return null;
}
