// A "verified visitor" is an email-verified party with NO Weddly login/session.
// They can suggest suppliers to the directory and write supplier reviews without
// ever creating an account. The pattern mirrors the newsletter double opt-in
// (own email-keyed table, hashed one-time verify token, 7-day TTL) but, unlike a
// couples signup, verifying NEVER mints a `users` row or a session.
//
// Persistence is "verify once per device": clicking the emailed link mints an
// opaque per-device token the browser stores; that token is replayed on the
// `X-Visitor-Token` header to authorize later suggestions/reviews, so the
// visitor never re-verifies on the same device.

/** Public view of a verified visitor. Never carries the email verify token or
 *  any device token — only the stable identity the frontend shows. */
export interface VerifiedVisitor {
  id: number;
  email: string;
  /** Optional display name they gave; falls back to a generic label in the UI. */
  full_name: string | null;
  /** Epoch ms of the moment their email was confirmed, or null while pending. */
  verified_at: number | null;
  created_at: number;
}

/** Returned when a device becomes verified (link consumed). `token` is the
 *  plaintext per-device token to store client-side and send back on
 *  `X-Visitor-Token`; it exists only in this response and is never recoverable
 *  from the DB (only its hash is stored). */
export interface VisitorSession {
  visitor: VerifiedVisitor;
  token: string;
}

/** Body for `POST /api/visitors/verify/request` — kicks off (or re-sends) the
 *  email confirmation. Always 200 so the endpoint can't probe who's verified. */
export interface RequestVisitorVerifyInput {
  email: string;
  /** Optional display name, shown as the review author when present. */
  full_name?: string;
  /** Recipient language for the confirmation email. Defaults to "en". */
  locale?: "hu" | "en";
}

/** HTTP header a verified visitor's browser sends to authorize its actions. */
export const VISITOR_TOKEN_HEADER = "X-Visitor-Token";
