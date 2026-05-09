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
