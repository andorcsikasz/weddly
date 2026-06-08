// Apple ID-token verification. The frontend runs "Sign in with Apple JS"
// (AppleID.auth.signIn) which hands the backend the `id_token` JWT from the
// authorization response; we verify the RS256 signature against Apple's
// published JWKS, then check the standard issuer / audience / expiry claims.
// Same shape as google_oauth.ts — no third-party JWT library, `node:crypto`
// (which Bun re-exports natively) covers everything.
//
// Apple-specific notes:
//   - The display name is NOT in the id_token. Apple only returns it once, in
//     the JS `user` object on the very first authorization. The route accepts
//     that name separately as a display-only field; this verifier never sees
//     it and never trusts it for identity.
//   - `email_verified` / `is_private_email` arrive as the STRING "true"/"false"
//     (not booleans), so checkPayload coerces both forms.
//   - The email may be an Apple private-relay address
//     (`…@privaterelay.appleid.com`) when the user chose "Hide My Email". We
//     store it verbatim — it's a stable, deliverable address Apple relays.
//
// Bypass mode: when CONFIG.appleTestBypass is on, accept a literal
// `apple-test:<sub>:<email>:<email_verified>:<hmac>` string instead of a JWT
// so the E2E suite doesn't need to mint real Apple credentials. The HMAC uses
// the same secret as session signing, so only callers with the secret can
// forge a bearer (and the flag itself is gated on NODE_ENV !== production).

import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { log } from "./logger";

export interface AppleIdentity {
  /** Stable Apple account id — the value we store in `users.apple_sub`. */
  sub: string;
  email: string;
  /** Whether Apple says the email has been verified on their side. */
  email_verified: boolean;
}

const ALLOWED_ISSUERS = new Set(["https://appleid.apple.com"]);
const JWKS_URL = "https://appleid.apple.com/auth/keys";

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

interface JwksCache {
  fetchedAt: number;
  keys: Map<string, Jwk>;
}

let jwksCache: JwksCache | null = null;
let inflight: Promise<JwksCache> | null = null;
// Apple's keys rotate infrequently; refresh hourly to keep things simple and
// well within the rotation cadence (a missed kid forces an immediate refresh
// below regardless).
const JWKS_TTL_MS = 60 * 60 * 1000;

async function loadJwks(): Promise<JwksCache> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache;
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const json = (await res.json()) as { keys: Jwk[] };
    const keys = new Map<string, Jwk>();
    for (const k of json.keys ?? []) {
      if (k.kty === "RSA" && k.kid) keys.set(k.kid, k);
    }
    jwksCache = { fetchedAt: Date.now(), keys };
    return jwksCache;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

function base64UrlToBuffer(s: string): Buffer {
  // JWT spec uses URL-safe base64 without padding.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

interface IdTokenPayload {
  iss?: string;
  /** Apple sends a single Services ID string; the spec also permits an array. */
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string | number;
}

function audMatches(aud: IdTokenPayload["aud"], clientId: string): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) return aud.includes(clientId);
  return false;
}

function checkPayload(payload: IdTokenPayload, clientId: string): AppleIdentity {
  if (!payload.iss || !ALLOWED_ISSUERS.has(payload.iss)) {
    throw new Error("Bad issuer");
  }
  if (!audMatches(payload.aud, clientId)) throw new Error("Audience mismatch");
  const now = Math.floor(Date.now() / 1000);
  // Allow 60 seconds of clock skew on the exp check — same window Apple's own
  // libraries use, so a slightly-drifted box doesn't reject legit tokens.
  if (typeof payload.exp !== "number" || payload.exp + 60 < now) {
    throw new Error("Token expired");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("Missing sub");
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new Error("Missing email");
  }
  // Apple sends booleans as the strings "true"/"false".
  const verified =
    payload.email_verified === true ||
    payload.email_verified === "true" ||
    payload.email_verified === 1;
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    email_verified: verified,
  };
}

function tryParseTestBypass(credential: string): AppleIdentity | null {
  if (!CONFIG.appleTestBypass) return null;
  if (!credential.startsWith("apple-test:")) return null;
  // Format: apple-test:<sub>:<email>:<email_verified>:<hmac_hex>
  // The HMAC covers the first 4 segments joined with ":".
  const parts = credential.split(":");
  if (parts.length !== 5) throw new Error("Malformed test bearer");
  const [, sub, email, verifiedFlag, sig] = parts as [string, string, string, string, string];
  const signedPart = `apple-test:${sub}:${email}:${verifiedFlag}`;
  const expected = createHmac("sha256", CONFIG.jwtSecret).update(signedPart).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Bad test bearer signature");
  return {
    sub,
    email: decodeURIComponent(email).trim().toLowerCase(),
    email_verified: verifiedFlag === "1",
  };
}

/** Verifies an Apple ID-token credential (or a HMAC'd test bearer when the
 *  bypass flag is on) and returns the identity. Throws on any failure. */
export async function verifyAppleCredential(credential: string): Promise<AppleIdentity> {
  const stub = tryParseTestBypass(credential);
  if (stub) return stub;

  if (!CONFIG.appleClientId) throw new Error("Apple sign-in is not configured");

  const segments = credential.split(".");
  if (segments.length !== 3) throw new Error("Malformed JWT");
  const [headerB64, payloadB64, sigB64] = segments as [string, string, string];

  const header = JSON.parse(base64UrlToBuffer(headerB64).toString("utf8")) as {
    alg?: string;
    kid?: string;
    typ?: string;
  };
  if (header.alg !== "RS256") throw new Error(`Unsupported alg: ${header.alg}`);
  if (!header.kid) throw new Error("Missing kid");

  let jwks = await loadJwks();
  let jwk = jwks.keys.get(header.kid);
  if (!jwk) {
    // Apple rotated keys since we last cached. Force a refresh and retry once.
    jwksCache = null;
    jwks = await loadJwks();
    jwk = jwks.keys.get(header.kid);
    if (!jwk) throw new Error("Unknown signing key");
  }

  const pubKey = createPublicKey({ key: jwk, format: "jwk" });
  const signingInput = `${headerB64}.${payloadB64}`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  const ok = verifier.verify(pubKey, base64UrlToBuffer(sigB64));
  if (!ok) throw new Error("Bad signature");

  const payload = JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8")) as IdTokenPayload;
  return checkPayload(payload, CONFIG.appleClientId);
}

/** Mints a test bearer the verifier above will accept when bypass is on. Used
 *  by the E2E suite — kept here so the format lives in one place. */
export function mintAppleTestBearer(opts: {
  sub: string;
  email: string;
  emailVerified?: boolean;
}): string {
  if (!CONFIG.appleTestBypass) {
    log.warn("apple_oauth.test_bearer_minted_without_bypass");
  }
  const sub = opts.sub;
  const email = encodeURIComponent(opts.email);
  const v = opts.emailVerified === false ? "0" : "1";
  const signedPart = `apple-test:${sub}:${email}:${v}`;
  const sig = createHmac("sha256", CONFIG.jwtSecret).update(signedPart).digest("hex");
  return `${signedPart}:${sig}`;
}
