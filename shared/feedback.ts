// Feedback contract — public submission shape + admin triage shape.

export type FeedbackSource = "landing" | "app";

/** Triage lifecycle. `new` lands in the inbox; an admin moves it through
 *  `reviewed` (looked at) → `planned` (we'll act on it) → `fixed` (shipped)
 *  or `rejected` (won't do). `archived` retires anything fully handled out
 *  of the working view. Legacy rows written with the old four-state model
 *  (`read`/`resolved`/`dismissed`) are migrated to the matching new value in
 *  db.ts on boot, so this union only carries the live states. */
export type FeedbackStatus = "new" | "reviewed" | "planned" | "fixed" | "rejected" | "archived";

/** Triage priority. Null until an admin sets it. */
export type FeedbackPriority = "low" | "medium" | "high";

/** How an admin's reply to a submitter is delivered. `email` sends a branded
 *  transactional mail to the submitter's address; `notification` drops a bell
 *  message into their in-app workspace; `both` does the two. */
export type FeedbackReplyChannel = "email" | "notification" | "both";

/** One reply an admin sent back to a feedback submitter. Append-only history:
 *  an admin may reply more than once, so the panel renders a small thread. */
export interface FeedbackReplyEntry {
  id: number;
  message: string;
  channel: FeedbackReplyChannel;
  /** Outcome of the email leg when the channel included email: one of the
   *  mailer's SendResult statuses ("sent" | "failed" | "skipped_no_provider"
   *  | "skipped_opt_out" | "skipped_duplicate"). Null when email wasn't part
   *  of the channel. */
  email_status: string | null;
  /** True when an in-app bell notification was delivered to the submitter's
   *  workspace (the `notification` / `both` channels). */
  notified: boolean;
  /** Email of the admin who sent the reply, for the audit trail. */
  admin_email: string | null;
  created_at: number;
}

/** POST /api/admin/feedback/:id/reply body. */
export interface SendFeedbackReplyInput {
  message: string;
  /** Defaults to "email" server-side. */
  channel?: FeedbackReplyChannel;
}

export interface SubmitFeedbackInput {
  /** Where the dialog was opened from. Defaults server-side to "landing"
   *  for backwards compatibility with the public form. */
  source?: FeedbackSource;
  /** In-app route the dialog was opened from (e.g. "/app/media"). Lets
   *  admins see which surface the feedback is actually about — only the
   *  binary `source` was too coarse to tell "Photos" from "Budget".
   *  Null for landing-page submissions. */
  context?: string | null;
  /** Full URL the dialog was opened from (`window.location.href`), captured
   *  so admins can reproduce against the exact page + query string. */
  url?: string | null;
  message?: string | null;
  rating?: number | null;
  monthly_value_ft?: number | null;
  from_email?: string | null;
  locale?: string | null;
}

export interface FeedbackEntry {
  id: number;
  source: FeedbackSource;
  /** In-app route the feedback was opened from (e.g. "/app/media"). Null
   *  for landing-page submissions and for rows written before this shipped. */
  context: string | null;
  /** Full URL the dialog was opened from. Null for older rows. */
  url: string | null;
  /** Authenticated submitter, if any. Public-landing submissions are null. */
  user_id: number | null;
  /** Email of the authenticated submitter, surfaced for triage convenience.
   *  Null when anonymous. */
  user_email: string | null;
  /** Full name of the authenticated submitter, when known. */
  user_full_name: string | null;
  message: string | null;
  rating: number | null;
  monthly_value_ft: number | null;
  from_email: string | null;
  locale: string | null;
  status: FeedbackStatus;
  /** Triage fields — all admin-set, null until triaged. */
  priority: FeedbackPriority | null;
  /** Product area slug (e.g. "budget", "guests"). Auto-inferred from the
   *  in-app route at submission, admin-overridable. */
  feature_area: string | null;
  /** Internal admin-only triage notes. Never shown to the submitter. */
  admin_notes: string | null;
  /** Derived from the submitter's User-Agent at submission. Null for older
   *  rows or when the header was absent. */
  device: string | null;
  browser: string | null;
  os: string | null;
  reviewed_at: number | null;
  created_at: number;
  /** Admin replies sent back to the submitter, oldest-first. Empty until an
   *  admin uses the "Reply to submitter" composer in the triage panel. */
  replies: FeedbackReplyEntry[];
}
