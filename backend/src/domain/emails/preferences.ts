// Per-user email preferences + unsubscribe-token lifecycle. Created lazily on
// first send so existing users (created before the table existed) auto-enroll.

import { randomBytes } from "node:crypto";
import { db, now } from "../../db";

export interface PreferencesRow {
  user_id: number;
  unsubscribe_token: string;
  lifecycle_opt_out: number;
  created_at: number;
  updated_at: number;
}

/** Get-or-create the preferences row for a user. Idempotent. */
export function ensurePreferences(userId: number): PreferencesRow {
  const existing = db.prepare("SELECT * FROM email_preferences WHERE user_id = ?").get(userId) as
    | PreferencesRow
    | undefined;
  if (existing) return existing;

  const token = randomBytes(24).toString("hex");
  const ts = now();
  db.prepare(
    `INSERT INTO email_preferences (user_id, unsubscribe_token, lifecycle_opt_out, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(userId, token, ts, ts);
  return {
    user_id: userId,
    unsubscribe_token: token,
    lifecycle_opt_out: 0,
    created_at: ts,
    updated_at: ts,
  };
}

export function getPreferencesByToken(token: string): PreferencesRow | null {
  if (!token || token.length < 16) return null;
  return (
    (db.prepare("SELECT * FROM email_preferences WHERE unsubscribe_token = ?").get(token) as
      | PreferencesRow
      | undefined) ?? null
  );
}

export function setLifecycleOptOut(userId: number, optOut: boolean): void {
  db.prepare(
    "UPDATE email_preferences SET lifecycle_opt_out = ?, updated_at = ? WHERE user_id = ?",
  ).run(optOut ? 1 : 0, now(), userId);
}
