// Token-bucket rate limit per (client_ip, endpoint). Persisted so the limit
// survives a restart. Tests spoof IPs via `x-test-client-ip` so parallel cases
// don't share a bucket.

import { db, now } from "../db";
import { HttpError } from "./http";

interface BucketRow {
  bucket_key: string;
  tokens: number;
  updated_at: number;
}

interface BucketConfig {
  /** Bucket capacity (also the cold-start refill). */
  capacity: number;
  /** Tokens refilled per second. */
  refillRate: number;
}

export function rateLimit(clientIp: string | null, endpoint: string, cfg: BucketConfig): void {
  // Fall back to "anon" if we couldn't sniff an IP. Better than disabling the
  // limit entirely; abusive clients can still flood under that one bucket.
  const key = `${clientIp ?? "anon"}:${endpoint}`;
  const ts = now();
  const row = db.prepare("SELECT * FROM rate_limit_buckets WHERE bucket_key = ?").get(key) as
    | BucketRow
    | undefined;

  let tokens = row?.tokens ?? cfg.capacity;
  if (row) {
    const elapsedSec = Math.max(0, (ts - row.updated_at) / 1000);
    tokens = Math.min(cfg.capacity, tokens + elapsedSec * cfg.refillRate);
  }

  if (tokens < 1) {
    throw new HttpError(429, "Too many requests, slow down");
  }

  tokens -= 1;
  db.prepare(
    `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`,
  ).run(key, tokens, ts);
}

/** Tight bucket for auth endpoints — ~5 tries/min/IP, refills 1/12s. */
export const AUTH_BUCKET: BucketConfig = { capacity: 5, refillRate: 1 / 12 };

/** Company lookup (business registry proxy). A short burst covers a real
 *  onboarding session while keeping farm traffic off the upstream registries
 *  (the KVK open-data API in particular allows only ~1 query/min). */
export const COMPANY_LOOKUP_BUCKET: BucketConfig = { capacity: 8, refillRate: 1 / 4 };

// ─── Per-account failed-login throttle ──────────────────────────────────────
// The per-IP AUTH_BUCKET can't see a distributed credential-stuffing run (many
// IPs, one target account). This counts FAILED attempts per claimed email and
// resets on success, so a legit user fat-fingering their password never locks
// out once they get in, while a single account can't be hammered across a
// botnet. Keyed on the claimed email (existing or not) so it's not an
// enumeration oracle. Reuses the rate_limit_buckets table — `tokens` holds the
// failure count here. The threshold is intentionally looser than the per-IP
// bucket so single-IP abuse trips the IP limit first.
const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;

function loginFailKey(email: string): string {
  return `acct-fail:${email.trim().toLowerCase()}`;
}

/** Throw 429 if this account has hit the failed-login ceiling within the window.
 *  Call BEFORE looking the user up so existing/missing emails behave the same. */
export function assertLoginNotLocked(email: string): void {
  const row = db
    .prepare("SELECT tokens, updated_at FROM rate_limit_buckets WHERE bucket_key = ?")
    .get(loginFailKey(email)) as { tokens: number; updated_at: number } | undefined;
  if (!row) return;
  if (now() - row.updated_at > LOGIN_FAIL_WINDOW_MS) return; // stale window — treat as cleared
  if (row.tokens >= LOGIN_FAIL_LIMIT) {
    throw new HttpError(429, "Too many failed sign-in attempts, try again later");
  }
}

/** Record one failed login for an account (increments within the window). */
export function recordLoginFailure(email: string): void {
  const key = loginFailKey(email);
  const ts = now();
  const row = db
    .prepare("SELECT tokens, updated_at FROM rate_limit_buckets WHERE bucket_key = ?")
    .get(key) as { tokens: number; updated_at: number } | undefined;
  const fresh = !row || ts - row.updated_at > LOGIN_FAIL_WINDOW_MS;
  const count = (fresh ? 0 : row.tokens) + 1;
  db.prepare(
    `INSERT INTO rate_limit_buckets (bucket_key, tokens, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`,
  ).run(key, count, ts);
}

/** Clear an account's failed-login counter (call on successful login). */
export function clearLoginFailures(email: string): void {
  db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?").run(loginFailKey(email));
}

/** Delete buckets that haven't been touched in 24h. After that long every
 *  bucket has refilled to capacity, so dropping the row is equivalent to the
 *  cold-start state — but the table stops growing unbounded as random IPs hit
 *  auth endpoints once and never return. */
export function sweepStaleRateLimitBuckets(): { deleted: number } {
  const cutoff = now() - 24 * 60 * 60 * 1000;
  const r = db.prepare("DELETE FROM rate_limit_buckets WHERE updated_at < ?").run(cutoff);
  return { deleted: Number(r.changes) };
}
