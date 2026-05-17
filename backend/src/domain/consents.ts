// Append-only consent ledger. Stores who accepted which policy version,
// when, from which IP / user-agent. GDPR Art. 7(1) requires the
// controller to be able to demonstrate that consent was given — without
// this row, the click-box on the form is unauditable.

import { db, now } from "../db";

export type ConsentDocument = "privacy" | "terms" | "vendor_beta_notice";

interface RecordConsentInput {
  /** Authenticated user id when known (registration flow). Pass null for
   *  anonymous pre-auth captures (vendor waitlist). */
  subjectUserId: number | null;
  /** What kind of actor accepted: a real `users` row or an anonymous
   *  submission row. */
  subjectKind: "user" | "vendor_waitlist";
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
