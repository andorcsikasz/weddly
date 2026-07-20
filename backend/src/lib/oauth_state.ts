// Signed OAuth `state` for the Google Calendar consent flows.
//
// The OAuth callback is necessarily PUBLIC — Google sends the browser there as a
// top-level redirect, which cannot carry the session bearer — so the state is
// the only thing authenticating it. It's an HMAC-SHA256 over
// `${kind}.${userId}.${exp}`, keyed with JWT_SECRET.
//
// The `kind` is inside the SIGNED payload, not alongside it, and that is the
// whole point: couples and vendors share one redirect URI (so enabling the
// vendor flow needs no new Google Cloud Console entry), and without a signed
// discriminator a state minted by the couple flow could be replayed against the
// vendor callback to bind the wrong aggregate. Signing it means a mismatched
// flow fails verification like any other tampering.

import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { now } from "../db";

const STATE_TTL_MS = 10 * 60 * 1000;

/** Which consent flow a state belongs to. */
export type OAuthStateKind = "couple" | "vendor";

export interface OAuthStatePayload {
  kind: OAuthStateKind;
  userId: number;
}

function sign(payload: string): string {
  return createHmac("sha256", CONFIG.jwtSecret).update(payload).digest("base64url");
}

/** Mint a state binding this flow to this user for the next 10 minutes. */
export function signOAuthState(kind: OAuthStateKind, userId: number): string {
  const payload = Buffer.from(`${kind}.${userId}.${now() + STATE_TTL_MS}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify + decode a state. Returns null on a bad signature, a malformed or
 *  expired payload, or an unknown flow kind. The caller decides what to do with
 *  the `kind`; it is NOT checked against an expectation here, because the shared
 *  callback uses it to dispatch. */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [kind, uidStr, expStr] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  const uid = Number(uidStr);
  const exp = Number(expStr);
  if (kind !== "couple" && kind !== "vendor") return null;
  if (!Number.isInteger(uid) || !Number.isFinite(exp) || exp < now()) return null;
  return { kind, userId: uid };
}
