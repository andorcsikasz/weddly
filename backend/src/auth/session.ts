// Opaque session tokens: random 24-byte id + HMAC-SHA256 signature. No JWT.
// `users.status` is checked on every verify so suspensions take immediate effect.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { db, now } from "../db";

interface SessionRow {
  id: string;
  user_id: number;
  created_at: number;
  expires_at: number;
}

function sign(id: string): string {
  return createHmac("sha256", CONFIG.jwtSecret).update(id).digest("hex");
}

export function issueSession(userId: number): string {
  const id = randomBytes(24).toString("hex");
  const created = now();
  const expires = created + CONFIG.sessionTtlMs;
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    id,
    userId,
    created,
    expires,
  );
  return `${id}.${sign(id)}`;
}

export function verifySessionToken(token: string): number | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  const u = db.prepare("SELECT status, last_seen_at FROM users WHERE id = ?").get(row.user_id) as
    | { status: string | null; last_seen_at: number | null }
    | undefined;
  if (!u || u.status === "suspended") return null;

  // Stamp `last_seen_at`, but throttle to one write per 5 minutes per user so
  // a chatty client doesn't pound the row on every API call. The admin
  // "Last active" column only needs minute-level resolution.
  const ts = now();
  if (!u.last_seen_at || ts - u.last_seen_at > 5 * 60 * 1000) {
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(ts, row.user_id);
  }

  return row.user_id;
}

export function revokeSession(token: string): void {
  const dot = token.indexOf(".");
  if (dot < 0) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token.slice(0, dot));
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}
