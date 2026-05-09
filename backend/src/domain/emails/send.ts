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
import { buildEmail, type KindPayload } from "./templates";

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
  if (target.user) {
    const prefs = ensurePreferences(target.user.id);
    if (category === "lifecycle" && prefs.lifecycle_opt_out) {
      const built = buildEmail(kind, payload, {
        recipientName: recipient.name,
        unsubscribeToken: prefs.unsubscribe_token,
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
  });

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
    });
    return { status: "skipped_no_provider" };
  }

  try {
    await sendEmail({
      to: recipient.email,
      subject: built.subject,
      html: built.rendered.html,
      text: built.rendered.text,
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
