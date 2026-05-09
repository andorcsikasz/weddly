// Append-only email send log. One row per send attempt. Used for support
// ("did the verify email actually go out?") and for re-send tooling later.

import { db, now } from "../../db";
import type { EmailCategory, EmailKind } from "./kinds";

export type EmailLogStatus = "sent" | "failed" | "skipped_opt_out" | "skipped_no_provider";

export interface EmailLogInput {
  user_id: number | null;
  couple_id: number | null;
  kind: EmailKind;
  category: EmailCategory;
  to_email: string;
  subject: string;
  status: EmailLogStatus;
  error?: string | null;
  /** Free-form payload for debugging — keep it small + redacted. Tokens
   *  themselves are NOT logged here; their tables (email_verification_tokens,
   *  password_reset_tokens) already store them. */
  payload?: Record<string, unknown> | null;
}

export function recordEmailAttempt(input: EmailLogInput): void {
  db.prepare(
    `INSERT INTO email_log
       (user_id, couple_id, kind, category, to_email, subject, status, error, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.user_id,
    input.couple_id,
    input.kind,
    input.category,
    input.to_email,
    input.subject,
    input.status,
    input.error ?? null,
    input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
    now(),
  );
}
