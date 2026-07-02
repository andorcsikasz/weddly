// Newsletter subscription lifecycle (double opt-in).
//
// subscribe → pending row + emailed confirm link → confirm → 'confirmed'.
// Unsubscribe flips to 'unsubscribed' but keeps the row as a suppression
// record, so a later bulk send can never accidentally re-include the address.
// The same token serves confirm and unsubscribe (it's in every email we send
// to the address), stored hashed at rest like every other emailed credential.

import { hashToken, mintToken } from "../auth/tokens";
import { db, now } from "../db";

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewsletterSubscriberRow {
  id: number;
  email: string;
  locale: string;
  status: "pending" | "confirmed" | "unsubscribed";
  token_hash: string | null;
  token_created_at: number | null;
  source: string | null;
  created_at: number;
  confirmed_at: number | null;
  unsubscribed_at: number | null;
}

function byEmail(email: string): NewsletterSubscriberRow | null {
  return (
    (db
      .prepare("SELECT * FROM newsletter_subscribers WHERE email = ?")
      .get(email) as NewsletterSubscriberRow | null) ?? null
  );
}

function byTokenHash(hash: string): NewsletterSubscriberRow | null {
  return (
    (db
      .prepare("SELECT * FROM newsletter_subscribers WHERE token_hash = ?")
      .get(hash) as NewsletterSubscriberRow | null) ?? null
  );
}

/** Upsert a subscription attempt. Returns the plaintext confirm token when a
 *  confirmation email should go out, or null when the address is already
 *  confirmed (silently idempotent — the caller responds 200 either way so the
 *  endpoint can't be used to probe who is subscribed). */
export function subscribeEmail(input: {
  email: string;
  locale: "hu" | "en";
  source: string | null;
}): { row: NewsletterSubscriberRow; token: string | null } {
  const existing = byEmail(input.email);
  if (existing?.status === "confirmed") return { row: existing, token: null };

  const token = mintToken();
  const ts = now();
  if (existing) {
    // pending (re-request: re-mint so the newest link always works) or
    // unsubscribed (they changed their mind: back through double opt-in).
    db.prepare(
      `UPDATE newsletter_subscribers
         SET status = 'pending', token_hash = ?, token_created_at = ?,
             locale = ?, source = ?, unsubscribed_at = NULL
       WHERE id = ?`,
    ).run(hashToken(token), ts, input.locale, input.source, existing.id);
    const row = byEmail(input.email);
    if (!row) throw new Error("newsletter row vanished mid-update");
    return { row, token };
  }
  db.prepare(
    `INSERT INTO newsletter_subscribers
       (email, locale, status, token_hash, token_created_at, source, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(input.email, input.locale, hashToken(token), ts, input.source, ts);
  const row = byEmail(input.email);
  if (!row) throw new Error("newsletter row vanished mid-insert");
  return { row, token };
}

export type ConfirmResult = "confirmed" | "already_confirmed" | "expired" | "invalid";

export function confirmByToken(token: string): ConfirmResult {
  const row = byTokenHash(hashToken(token));
  if (!row) return "invalid";
  if (row.status === "confirmed") return "already_confirmed";
  if (row.token_created_at !== null && now() - row.token_created_at > CONFIRM_TTL_MS) {
    return "expired";
  }
  // Also covers status='unsubscribed': re-subscribing minted a fresh token and
  // reset the row to pending, so an old (pre-unsubscribe) token no longer
  // matches token_hash and lands in 'invalid' above.
  db.prepare(
    "UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
  ).run(now(), row.id);
  return "confirmed";
}

export type UnsubscribeResult = "unsubscribed" | "already_unsubscribed" | "invalid";

/** Unsubscribe never expires — a years-old newsletter footer link must keep
 *  working (Grtv. one-click opt-out). */
export function unsubscribeByToken(token: string): UnsubscribeResult {
  const row = byTokenHash(hashToken(token));
  if (!row) return "invalid";
  if (row.status === "unsubscribed") return "already_unsubscribed";
  db.prepare(
    "UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?",
  ).run(now(), row.id);
  return "unsubscribed";
}
