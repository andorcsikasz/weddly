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
}
