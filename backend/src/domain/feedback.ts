// Feedback submissions from the in-product Visszajelzés dialog. Public
// inserts (anon or authenticated); admins triage via /app/admin/feedback.

import type {
  FeedbackEntry,
  FeedbackPriority,
  FeedbackSource,
  FeedbackStatus,
} from "@shared/feedback";
import { db, now } from "../db";

export interface FeedbackRow {
  id: number;
  source: string;
  context: string | null;
  url: string | null;
  user_id: number | null;
  message: string | null;
  rating: number | null;
  monthly_value_ft: number | null;
  from_email: string | null;
  locale: string | null;
  status: string;
  priority: string | null;
  feature_area: string | null;
  admin_notes: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  created_at: number;
}

function toSource(s: string): FeedbackSource {
  return s === "app" ? "app" : "landing";
}

/** Normalise to the live status union. New rows only ever carry the six live
 *  states, but a legacy value that slipped past the db.ts migration (or a
 *  hand-edited row) is mapped here rather than leaking an off-union string. */
function toStatus(s: string): FeedbackStatus {
  switch (s) {
    case "reviewed":
    case "planned":
    case "fixed":
    case "rejected":
    case "archived":
      return s;
    case "read":
      return "reviewed";
    case "resolved":
      return "fixed";
    case "dismissed":
      return "rejected";
    default:
      return "new";
  }
}

function toPriority(s: string | null): FeedbackPriority | null {
  return s === "low" || s === "medium" || s === "high" ? s : null;
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
    url: row.url,
    user_id: row.user_id,
    user_email: row.user_email,
    user_full_name: row.user_full_name,
    message: row.message,
    rating: row.rating,
    monthly_value_ft: row.monthly_value_ft,
    from_email: row.from_email,
    locale: row.locale,
    status: toStatus(row.status),
    priority: toPriority(row.priority),
    feature_area: row.feature_area,
    admin_notes: row.admin_notes,
    device: row.device,
    browser: row.browser,
    os: row.os,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  };
}

/** Best-effort device/browser/os classification from a User-Agent string.
 *  Heuristic, not a full UA database — enough to triage "mobile Safari on
 *  iOS" vs "desktop Chrome on Windows" without pulling in a dependency. */
export function parseUserAgent(ua: string | null): {
  device: string | null;
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { device: null, browser: null, os: null };
  const s = ua.toLowerCase();

  let device: string;
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/.test(s)) device = "tablet";
  else if (/mobi|iphone|ipod|windows phone|blackberry/.test(s)) device = "mobile";
  else device = "desktop";

  let browser: string;
  if (/edg\//.test(s)) browser = "Edge";
  else if (/opr\/|opera/.test(s)) browser = "Opera";
  else if (/samsungbrowser/.test(s)) browser = "Samsung";
  else if (/firefox|fxios/.test(s)) browser = "Firefox";
  else if (/chrome|crios|chromium/.test(s)) browser = "Chrome";
  else if (/safari/.test(s)) browser = "Safari";
  else browser = "Other";

  let os: string;
  if (/windows/.test(s)) os = "Windows";
  else if (/iphone|ipad|ipod|; ios|os \d+_\d+ like mac/.test(s)) os = "iOS";
  else if (/mac os x|macintosh/.test(s)) os = "macOS";
  else if (/android/.test(s)) os = "Android";
  else if (/linux|x11|cros/.test(s)) os = "Linux";
  else os = "Other";

  return { device, browser, os };
}

/** Second path segment of the in-app route, used as the default product
 *  area: "/app/budget" → "budget", "/app/admin/users" → "admin". Null for
 *  landing rows or unrecognised shapes; the admin can always override. */
export function inferFeatureArea(context: string | null): string | null {
  if (!context) return null;
  const parts = context.split("/").filter(Boolean); // ["app","budget"]
  if (parts[0] !== "app") return null;
  return parts[1] ?? "dashboard";
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
  url: string | null;
  user_id: number | null;
  message: string | null;
  rating: number | null;
  monthly_value_ft: number | null;
  from_email: string | null;
  locale: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}): JoinedRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO feedback_submissions
         (source, context, url, user_id, message, rating, monthly_value_ft,
          from_email, locale, feature_area, device, browser, os, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    )
    .run(
      input.source,
      input.context,
      input.url,
      input.user_id,
      input.message,
      input.rating,
      input.monthly_value_ft,
      input.from_email,
      input.locale,
      inferFeatureArea(input.context),
      input.device,
      input.browser,
      input.os,
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

/** Update admin-set triage fields. Each field is optional: `undefined` means
 *  "leave as-is", an explicit `null` clears it. Stamps the reviewer + time so
 *  triage edits show as activity the same way a status change does. */
export function setFeedbackTriage(
  id: number,
  patch: {
    priority?: FeedbackPriority | null;
    feature_area?: string | null;
    admin_notes?: string | null;
  },
  reviewerUserId: number,
): JoinedRow | null {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.priority !== undefined) {
    sets.push("priority = ?");
    vals.push(patch.priority);
  }
  if (patch.feature_area !== undefined) {
    sets.push("feature_area = ?");
    vals.push(patch.feature_area);
  }
  if (patch.admin_notes !== undefined) {
    sets.push("admin_notes = ?");
    vals.push(patch.admin_notes);
  }
  if (sets.length === 0) return getFeedbackById(id);
  sets.push("reviewed_by_user_id = ?", "reviewed_at = ?");
  vals.push(reviewerUserId, now(), id);
  db.prepare(`UPDATE feedback_submissions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getFeedbackById(id);
}

export function deleteFeedback(id: number): boolean {
  const result = db.prepare("DELETE FROM feedback_submissions WHERE id = ?").run(id);
  return result.changes > 0;
}
