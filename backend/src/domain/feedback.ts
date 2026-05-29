// Feedback submissions from the in-product Visszajelzés dialog. Public
// inserts (anon or authenticated); admins triage via /app/admin/feedback.

import type { FeedbackEntry, FeedbackSource, FeedbackStatus } from "@shared/feedback";
import { db, now } from "../db";

export interface FeedbackRow {
  id: number;
  source: string;
  context: string | null;
  user_id: number | null;
  message: string | null;
  rating: number | null;
  monthly_value_ft: number | null;
  from_email: string | null;
  locale: string | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  created_at: number;
}

function toSource(s: string): FeedbackSource {
  return s === "app" ? "app" : "landing";
}

function toStatus(s: string): FeedbackStatus {
  if (s === "read" || s === "resolved" || s === "dismissed") return s;
  return "new";
}

interface JoinedRow extends FeedbackRow {
  user_email: string | null;
  user_full_name: string | null;
}

export function toFeedbackEntry(row: JoinedRow): FeedbackEntry {
  return {
    id: row.id,
    source: toSource(row.source),
    context: row.context,
    user_id: row.user_id,
    user_email: row.user_email,
    user_full_name: row.user_full_name,
    message: row.message,
    rating: row.rating,
    monthly_value_ft: row.monthly_value_ft,
    from_email: row.from_email,
    locale: row.locale,
    status: toStatus(row.status),
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  };
}

export function listFeedback(): JoinedRow[] {
  return db
    .prepare(
      `SELECT f.*, u.email AS user_email, u.full_name AS user_full_name
         FROM feedback_submissions f
    LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC`,
    )
    .all() as JoinedRow[];
}

export function getFeedbackById(id: number): JoinedRow | null {
  return (
    (db
      .prepare(
        `SELECT f.*, u.email AS user_email, u.full_name AS user_full_name
           FROM feedback_submissions f
      LEFT JOIN users u ON u.id = f.user_id
          WHERE f.id = ?`,
      )
      .get(id) as JoinedRow | undefined) ?? null
  );
}

export function insertFeedback(input: {
  source: FeedbackSource;
  context: string | null;
  user_id: number | null;
  message: string | null;
  rating: number | null;
  monthly_value_ft: number | null;
  from_email: string | null;
  locale: string | null;
}): JoinedRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO feedback_submissions
         (source, context, user_id, message, rating, monthly_value_ft, from_email, locale, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      input.source,
      input.context,
      input.user_id,
      input.message,
      input.rating,
      input.monthly_value_ft,
      input.from_email,
      input.locale,
      ts,
    );
  const row = getFeedbackById(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to read inserted feedback row");
  return row;
}

export function setFeedbackStatus(
  id: number,
  status: FeedbackStatus,
  reviewerUserId: number,
): JoinedRow | null {
  db.prepare(
    `UPDATE feedback_submissions
        SET status = ?,
            reviewed_by_user_id = ?,
            reviewed_at = ?
      WHERE id = ?`,
  ).run(status, reviewerUserId, now(), id);
  return getFeedbackById(id);
}

export function deleteFeedback(id: number): boolean {
  const result = db.prepare("DELETE FROM feedback_submissions WHERE id = ?").run(id);
  return result.changes > 0;
}
