import { db, now } from "../../db";
import type { EmailKind } from "./kinds";

/** Five minutes absorbs double clicks, browser retries and two admins acting
 *  on the same row, while still allowing an intentional resend shortly after
 *  correcting an address or investigating delivery. */
export const ADMIN_EMAIL_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export interface AdminEmailSendReservation {
  kind: EmailKind;
  to_email: string;
  reserved_at: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Atomically reserve one admin send. A null result means this address already
 *  received (or another request already reserved) the same kind in the last
 *  five minutes. SQLite's conditional UPSERT is the concurrency boundary. */
export function reserveAdminEmailSend(
  kind: EmailKind,
  email: string,
): AdminEmailSendReservation | null {
  const to_email = normalizeEmail(email);
  const reserved_at = now();
  const result = db
    .prepare(
      `INSERT INTO admin_email_send_dedupe (to_email, kind, reserved_at)
       VALUES (?, ?, ?)
       ON CONFLICT(to_email, kind) DO UPDATE SET reserved_at = excluded.reserved_at
       WHERE admin_email_send_dedupe.reserved_at <= excluded.reserved_at - ?`,
    )
    .run(to_email, kind, reserved_at, ADMIN_EMAIL_DEDUPE_WINDOW_MS);

  return result.changes === 1 ? { kind, to_email, reserved_at } : null;
}

export function reservationMatches(
  reservation: AdminEmailSendReservation | undefined,
  kind: EmailKind,
  email: string,
): boolean {
  return (
    reservation?.kind === kind &&
    reservation.to_email === normalizeEmail(email) &&
    reservation.reserved_at > now() - ADMIN_EMAIL_DEDUPE_WINDOW_MS
  );
}
