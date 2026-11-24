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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { now } from "../db";

const STATE_TTL_MS = 10 * 60 * 1000;

// ─── Browser binding + PKCE ──────────────────────────────────────────────────
//
// The signed state proves WHICH user and flow a callback belongs to, but it is
// not bound to the browser that started the flow: anyone holding a valid state
// and a code could complete it. So every /connect also sets an httpOnly cookie
// carrying the same state plus a PKCE verifier (RFC 7636, S256). The callback
// must find that cookie with a matching state, and the verifier goes into the
// token exchange, so a code minted for one browser cannot be redeemed by another.
// SameSite=Lax is what lets the cookie ride Google's top-level redirect back.

/** Cookie name for the consent round-trip binding. */
export const OAUTH_BINDING_COOKIE = "weddly_gcal_oauth";
/** Both flows return to this one path, so the cookie is scoped to it. */
export const OAUTH_BINDING_PATH = "/api/google-calendar/callback";
const BINDING_TTL_S = 10 * 60;

/** A fresh RFC 7636 PKCE pair (43-char verifier, S256 challenge). */
export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallengeFor(verifier) };
}

/** S256 code challenge for a verifier. */
export function pkceChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function bindingCookie(value: string, maxAgeS: number): string {
  const secure = CONFIG.frontendBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `${OAUTH_BINDING_COOKIE}=${value}; Path=${OAUTH_BINDING_PATH}; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure}`;
}

/** `Set-Cookie` value binding `state` and the PKCE `verifier` to this browser. */
export function oauthBindingSetCookie(state: string, verifier: string): string {
  // `~` is outside base64url and the state's `.` separators, so it splits cleanly.
  return bindingCookie(`${state}~${verifier}`, BINDING_TTL_S);
}

/** `Set-Cookie` value that removes the binding. Sent on every callback outcome. */
export function oauthBindingClearCookie(): string {
  return bindingCookie("", 0);
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Return the PKCE verifier from the binding cookie, but only if the cookie was
 *  set for this exact `state`. Null when the cookie is absent, malformed, or
 *  belongs to a different flow. */
export function readOAuthBinding(req: Request, state: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== OAUTH_BINDING_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    const tilde = raw.indexOf("~");
    if (tilde < 0) return null;
    const verifier = raw.slice(tilde + 1);
    if (!verifier || !constantTimeEqual(raw.slice(0, tilde), state)) return null;
    return verifier;
  }
  return null;
}

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
