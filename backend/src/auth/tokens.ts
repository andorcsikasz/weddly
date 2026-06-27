// Single-use credential tokens (password reset, email verify, email change).
//
// The token handed to the user (in the emailed link) is 32 random bytes of
// hex — 256 bits of entropy. We store only its SHA-256 hash in the DB and
// compare hashes on redemption, so a read of the SQLite file (or, now that
// `domain/backup.ts` ships the whole DB to R2, a read of a `backups/*` object)
// no longer exposes live, replayable account-takeover tokens. The token
// entropy is high enough that the plain `WHERE token_hash = ?` equality lookup
// is not a meaningful timing oracle, so a constant-time compare isn't needed
// here — the win is purely "no plaintext secret at rest".

import { createHash, randomBytes } from "node:crypto";

// TEST-ONLY plaintext capture. In production the plaintext token exists only in
// the emailed link and is never recoverable from the DB (that's the point). The
// E2E suite, however, simulates "user clicks the link" by reading the stored
// row — so under NODE_ENV=test we keep an in-process hash→plaintext map the
// test helpers can resolve through. Never populated outside test.
const CAPTURE_PLAINTEXT = process.env.NODE_ENV === "test";
const TEST_PLAINTEXT_BY_HASH = new Map<string, string>();

/** Mint a fresh opaque token (256-bit) for use in an emailed link. */
export function mintToken(): string {
  const token = randomBytes(32).toString("hex");
  if (CAPTURE_PLAINTEXT) TEST_PLAINTEXT_BY_HASH.set(hashToken(token), token);
  return token;
}

/** TEST-ONLY: recover the plaintext for a stored token hash. Returns undefined
 *  outside test or for an unknown hash. Used by the E2E token-flow helpers. */
export function __testPlaintextForHash(hash: string): string | undefined {
  return TEST_PLAINTEXT_BY_HASH.get(hash);
}

/** Hash a token for storage / lookup. Deterministic, unkeyed SHA-256 — the
 *  token itself is the secret, so a keyed HMAC buys nothing here. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
