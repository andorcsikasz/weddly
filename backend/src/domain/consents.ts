// Append-only consent ledger. Stores who accepted which policy version,
// when, from which IP / user-agent. GDPR Art. 7(1) requires the
// controller to be able to demonstrate that consent was given — without
// this row, the click-box on the form is unauditable.

import { db, now } from "../db";

export type ConsentDocument =
  | "privacy"
  | "terms"
  | "vendor_terms"
  | "vendor_terms_highlighted"
  | "couple_subscription_terms"
  | "planner_subscription_terms"
  | "guest_health"
  | "guest_health_withdrawn"
  | "guest_photo_marketing"
  | "vendor_beta_notice";

interface RecordConsentInput {
  /** Authenticated user id when known (registration flow). Pass null for
   *  anonymous pre-auth captures (vendor waitlist). */
  subjectUserId: number | null;
  /** What kind of actor accepted: a real `users` row or an anonymous
   *  submission row. */
  subjectKind: "user" | "vendor_waitlist" | "newsletter" | "guest";
  /** Ref to the non-user subject row (e.g. stringified vendor_waitlist.id). */
  subjectRef: string | null;
  document: ConsentDocument;
  version: string;
  ip: string | null;
  userAgent: string | null;
}

export function recordConsent(input: RecordConsentInput): void {
  db.prepare(
    `INSERT INTO user_consents
       (subject_user_id, subject_kind, subject_ref, document, version, ip, user_agent, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.subjectUserId,
    input.subjectKind,
    input.subjectRef,
    input.document,
    input.version,
    input.ip,
    input.userAgent,
    now(),
  );
}

/** True when a `subject_kind = 'user'` row already accepted this exact
 *  document/version. Point-of-purchase checkout handlers use this to skip
 *  re-prompting a user who already accepted the current terms — only a
 *  version bump (a real content change) should ask again. */
export function hasAcceptedCurrentVersion(
  subjectUserId: number,
  document: ConsentDocument,
  version: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM user_consents
        WHERE subject_user_id = ? AND subject_kind = 'user'
          AND document = ? AND version = ? LIMIT 1`,
    )
    .get(subjectUserId, document, version);
  return row != null;
}
