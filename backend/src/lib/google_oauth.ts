// Google ID-token verification. The frontend hands the backend a credential
// JWT from Google Identity Services; we verify the RS256 signature against
// Google's published JWKS, then check the standard issuer / audience / expiry
// claims. No third-party JWT library — `node:crypto` (which Bun re-exports
// natively) covers everything we need.
//
// Bypass mode: when CONFIG.googleTestBypass is on, accept a literal
// `test:<sub>:<email>:<name>:<email_verified>:<hmac>` string instead of a JWT
// so the E2E suite doesn't need to mint real Google credentials. The HMAC
// uses the same secret as session signing, so only callers with the secret
// can forge a bearer (and the flag itself is gated on NODE_ENV !== production).

import { createHmac, createPublicKey, createVerify, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { log } from "./logger";

export interface GoogleIdentity {
  /** Stable Google account id — the value we store in `users.google_sub`. */
  sub: string;
  email: string;
  /** Whether Google says the email has been verified on their side. */
  email_verified: boolean;
  /** Display name as Google has it. May be empty. */
  name: string;
}

const ALLOWED_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

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
// Google's `Cache-Control: max-age=…` is typically a few hours. We refresh
// every 60 minutes to keep things simple — well within the certificate
// rotation cadence.
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
  aud?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string | number;
  name?: string;
}

function checkPayload(payload: IdTokenPayload, clientId: string): GoogleIdentity {
  if (!payload.iss || !ALLOWED_ISSUERS.has(payload.iss)) {
    throw new Error("Bad issuer");
  }
  if (payload.aud !== clientId) throw new Error("Audience mismatch");
  const now = Math.floor(Date.now() / 1000);
  // Allow 60 seconds of clock skew on the exp check — same window Google's
  // own libraries use, so a slightly-drifted box doesn't reject legit tokens.
  if (typeof payload.exp !== "number" || payload.exp + 60 < now) {
    throw new Error("Token expired");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("Missing sub");
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new Error("Missing email");
  }
  const verified =
    payload.email_verified === true ||
    payload.email_verified === "true" ||
    payload.email_verified === 1;
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    email_verified: verified,
    name: typeof payload.name === "string" ? payload.name.trim() : "",
  };
}

function tryParseTestBypass(credential: string): GoogleIdentity | null {
  if (!CONFIG.googleTestBypass) return null;
  if (!credential.startsWith("test:")) return null;
  // Format: test:<sub>:<email>:<name>:<email_verified>:<hmac_hex>
  // The HMAC covers the first 5 segments joined with ":".
  const parts = credential.split(":");
  if (parts.length !== 6) throw new Error("Malformed test bearer");
  const [, sub, email, name, verifiedFlag, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const signedPart = `test:${sub}:${email}:${name}:${verifiedFlag}`;
  const expected = createHmac("sha256", CONFIG.jwtSecret).update(signedPart).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Bad test bearer signature");
  return {
    sub,
    email: decodeURIComponent(email).trim().toLowerCase(),
    email_verified: verifiedFlag === "1",
    name: decodeURIComponent(name).trim(),
  };
}

/** Verifies a Google ID-token credential (or a HMAC'd test bearer when the
 *  bypass flag is on) and returns the identity. Throws on any failure. */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const stub = tryParseTestBypass(credential);
  if (stub) return stub;

  if (!CONFIG.googleClientId) throw new Error("Google sign-in is not configured");

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
    // Google rotated keys since we last cached. Force a refresh and retry once.
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
  return checkPayload(payload, CONFIG.googleClientId);
}

/** Mints a test bearer the verifier above will accept when bypass is on. Used
 *  by the E2E suite — kept here so the format lives in one place. */
export function mintTestBearer(opts: {
  sub: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}): string {
  if (!CONFIG.googleTestBypass) {
    log.warn("google_oauth.test_bearer_minted_without_bypass");
  }
  const sub = opts.sub;
  const email = encodeURIComponent(opts.email);
  const name = encodeURIComponent(opts.name ?? "");
  const v = opts.emailVerified === false ? "0" : "1";
  const signedPart = `test:${sub}:${email}:${name}:${v}`;
  const sig = createHmac("sha256", CONFIG.jwtSecret).update(signedPart).digest("hex");
  return `${signedPart}:${sig}`;
}
