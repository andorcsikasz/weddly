// Verified-visitor lifecycle: email-verify a party that never gets a login.
//
//   request → pending row + emailed confirm link
//   consume → status='verified' + a per-device token (mints a device session)
//   getVisitorBySessionToken → resolves the X-Visitor-Token header on later calls
//
// Unlike a couples signup this NEVER creates a `users` row or an app session.
// The pattern mirrors domain/newsletter.ts (own email-keyed table, single-use
// hashed verify token, 7-day TTL); the one addition is a device-session table so
// the visitor verifies once per device and then acts freely.

import type { VerifiedVisitor } from "@shared/verified_visitors";
import { VISITOR_TOKEN_HEADER } from "@shared/verified_visitors";
import { hashToken, mintToken } from "../auth/tokens";
import { db, now } from "../db";
import { type Ctx, HttpError } from "../lib/http";

export const VISITOR_VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches newsletter/email-verify

export interface VerifiedVisitorRow {
  id: number;
  email: string;
  full_name: string | null;
  locale: string;
  status: "pending" | "verified";
  verify_token_hash: string | null;
  verify_token_created_at: number | null;
  verified_at: number | null;
  created_at: number;
  updated_at: number;
}

export function toVerifiedVisitor(row: VerifiedVisitorRow): VerifiedVisitor {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    verified_at: row.verified_at,
    created_at: row.created_at,
  };
}

function byEmail(email: string): VerifiedVisitorRow | null {
  return (
    (db.prepare("SELECT * FROM verified_visitors WHERE email = ?").get(email) as
      | VerifiedVisitorRow
      | undefined) ?? null
  );
}

function byVerifyTokenHash(hash: string): VerifiedVisitorRow | null {
  return (
    (db.prepare("SELECT * FROM verified_visitors WHERE verify_token_hash = ?").get(hash) as
      | VerifiedVisitorRow
      | undefined) ?? null
  );
}

export function getVisitorById(id: number): VerifiedVisitorRow | null {
  return (
    (db.prepare("SELECT * FROM verified_visitors WHERE id = ?").get(id) as
      | VerifiedVisitorRow
      | undefined) ?? null
  );
}

/** Start (or re-send) an email confirmation. Always mints a fresh verify token
 *  — even for an already-verified address, so the owner can verify a NEW device
 *  by clicking a new link. Returns the plaintext token for the caller to email.
 *  A supplied name only fills a blank; it never overwrites a name already set
 *  (so a later suggestion can't quietly rename the visitor). */
export function requestVisitorVerify(input: {
  email: string;
  full_name: string | null;
  locale: "hu" | "en";
}): { row: VerifiedVisitorRow; token: string } {
  const token = mintToken();
  const ts = now();
  const existing = byEmail(input.email);
  if (existing) {
    db.prepare(
      `UPDATE verified_visitors
         SET verify_token_hash = ?, verify_token_created_at = ?,
             full_name = COALESCE(full_name, ?), locale = ?, updated_at = ?
       WHERE id = ?`,
    ).run(hashToken(token), ts, input.full_name, input.locale, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO verified_visitors
         (email, full_name, locale, status, verify_token_hash, verify_token_created_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).run(input.email, input.full_name, input.locale, hashToken(token), ts, ts, ts);
  }
  const row = byEmail(input.email);
  if (!row) throw new Error("verified_visitor row vanished mid-upsert");
  return { row, token };
}

export type ConsumeVisitorResult =
  | { ok: true; visitor: VerifiedVisitorRow; deviceToken: string }
  | { ok: false; reason: "invalid" | "expired" };

/** Redeem an emailed verify link: flip the visitor to 'verified' (first time)
 *  and mint a per-device token. Single-use — the verify token is cleared so the
 *  same link can't be replayed. Idempotent for an already-verified visitor
 *  clicking a fresh link: it just mints another device session. */
export function consumeVisitorVerify(token: string): ConsumeVisitorResult {
  const row = byVerifyTokenHash(hashToken(token));
  if (!row) return { ok: false, reason: "invalid" };
  if (
    row.verify_token_created_at !== null &&
    now() - row.verify_token_created_at > VISITOR_VERIFY_TTL_MS
  ) {
    return { ok: false, reason: "expired" };
  }
  const ts = now();
  const deviceToken = mintToken();
  db.transaction(() => {
    db.prepare(
      `UPDATE verified_visitors
         SET status = 'verified',
             verified_at = COALESCE(verified_at, ?),
             verify_token_hash = NULL, verify_token_created_at = NULL,
             updated_at = ?
       WHERE id = ?`,
    ).run(ts, ts, row.id);
    db.prepare(
      `INSERT INTO verified_visitor_sessions (visitor_id, token_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)`,
    ).run(row.id, hashToken(deviceToken), ts, ts);
  })();
  const fresh = getVisitorById(row.id);
  if (!fresh) throw new Error("verified_visitor row vanished mid-consume");
  return { ok: true, visitor: fresh, deviceToken };
}

/** Resolve an X-Visitor-Token device token to its verified visitor. Returns null
 *  for an unknown token or a visitor no longer marked verified. Touches
 *  last_seen_at so a future cleanup can prune idle device sessions. */
export function getVisitorBySessionToken(token: string): VerifiedVisitorRow | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const session = db
    .prepare("SELECT visitor_id FROM verified_visitor_sessions WHERE token_hash = ?")
    .get(hashToken(trimmed)) as { visitor_id: number } | undefined;
  if (!session) return null;
  const visitor = getVisitorById(session.visitor_id);
  if (!visitor || visitor.status !== "verified") return null;
  db.prepare("UPDATE verified_visitor_sessions SET last_seen_at = ? WHERE token_hash = ?").run(
    now(),
    hashToken(trimmed),
  );
  return visitor;
}

/** Resolve the verified visitor behind the current request's X-Visitor-Token
 *  device token, or null when the header is absent / unknown. Header lookup is
 *  case-insensitive (fetch spec), so callers need not worry about casing. */
export function optionalVerifiedVisitor(ctx: Ctx): VerifiedVisitorRow | null {
  const token = ctx.req.headers.get(VISITOR_TOKEN_HEADER);
  if (!token) return null;
  return getVisitorBySessionToken(token);
}

/** Require a verified visitor. Throws 401 with `code:"visitor_unverified"` so
 *  the frontend can prompt the one-time email confirmation instead of showing a
 *  generic error. Use to gate visitor-only mutations (suggest supplier, review). */
export function requireVerifiedVisitor(ctx: Ctx): VerifiedVisitorRow {
  const visitor = optionalVerifiedVisitor(ctx);
  if (!visitor) {
    throw new HttpError(401, "Visitor email not verified", { code: "visitor_unverified" });
  }
  return visitor;
}
