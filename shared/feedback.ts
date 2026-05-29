// Feedback contract — public submission shape + admin list shape.

export type FeedbackSource = "landing" | "app";
export type FeedbackStatus = "new" | "read" | "resolved" | "dismissed";

export interface SubmitFeedbackInput {
  /** Where the dialog was opened from. Defaults server-side to "landing"
   *  for backwards compatibility with the public form. */
  source?: FeedbackSource;
  /** In-app route the dialog was opened from (e.g. "/app/media"). Lets
   *  admins see which surface the feedback is actually about — only the
   *  binary `source` was too coarse to tell "Photos" from "Budget".
   *  Null for landing-page submissions. */
  context?: string | null;
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
  reviewed_at: number | null;
  created_at: number;
}
