// Google Analytics 4 Data API transport.
//
// Pulls live traffic numbers for the admin dashboard's "Traffic" section. We
// talk to the Data API directly over fetch rather than pulling in the heavy
// `googleapis` / `google-auth-library` packages — the only thing those buy us
// is the service-account JWT dance, which Bun's Web Crypto does in ~40 lines.
// That keeps the dependency surface flat (the repo hand-rolls its router,
// auth and mailer for the same reason).
//
// Auth flow (OAuth2 "JWT bearer" grant for service accounts):
//   1. Build + RS256-sign a JWT asserting the service account identity.
//   2. Exchange it at oauth2.googleapis.com/token for a 1h access token.
//   3. Call analyticsdata.googleapis.com/.../:runReport with that token.
// The token is cached in-process until ~1 min before expiry.
//
// This module is pure infra: it knows nothing about our DTOs. The mapping
// from GA4 rows to AdminTrafficAnalytics lives in routes/admin_analytics.ts,
// next to the other rollups.

import { CONFIG } from "../config";
import { log } from "./logger";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta/properties";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** Minimal shape of the fields we read out of the service-account key JSON. */
interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** True when both the property id and a parseable service-account key are
 *  present. Cheap — callers gate on this before doing any network work. */
export function isGa4Configured(): boolean {
  return CONFIG.ga4PropertyId.length > 0 && parseServiceAccount() !== null;
}

let cachedAccount: ServiceAccount | null | undefined;
/** Parse + memoise the service-account JSON. Returns null (and logs once) on
 *  missing/blank/malformed input so a typo'd env var disables GA4 cleanly
 *  rather than throwing on every admin page load. */
function parseServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  const raw = CONFIG.ga4ServiceAccountJson.trim();
  if (!raw) {
    cachedAccount = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("missing client_email / private_key");
    }
    cachedAccount = {
      client_email: parsed.client_email,
      // Env-stored keys carry literal "\n" sequences; restore real newlines so
      // the PEM parses.
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch (err) {
    log.warn("ga4.bad_service_account", {
      note: "GA4_SERVICE_ACCOUNT_JSON did not parse as a service-account key — GA4 traffic disabled",
      error: err instanceof Error ? err.message : String(err),
    });
    cachedAccount = null;
  }
  return cachedAccount;
}

// ─── Token mint + cache ────────────────────────────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlString(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

/** Decode a PEM PKCS#8 private key into a CryptoKey usable for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Mint (or reuse) a Google access token for the service account. Throws on
 *  any auth failure — callers run this inside a try/catch that downgrades the
 *  whole section to an error card. */
async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const nowSec = Math.floor(now / 1000);
  const header = base64urlString(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64urlString(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const key = await importPrivateKey(account.private_key);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${base64url(new Uint8Array(sigBuf))}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`GA4 token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("GA4 token exchange returned no access_token");
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

// ─── runReport ─────────────────────────────────────────────────────────────

/** One row of a GA4 report: parallel dimension + metric value arrays. */
export interface Ga4Row {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

export interface Ga4ReportResponse {
  rows?: Ga4Row[];
  /** `runReport` echoes back the metric/dimension headers; we don't need them
   *  (we read positionally) but keep the field for debugging. */
  rowCount?: number;
}

/** A single GA4 report request body (the subset of `RunReportRequest` we use). */
export interface Ga4ReportRequest {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  metrics: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
  orderBys?: Array<Record<string, unknown>>;
  limit?: number;
}

/** Run one GA4 report against the configured property. Resolves to the raw
 *  (rows-only) response. Throws when GA4 isn't configured or the call fails —
 *  the caller decides how to degrade. */
export async function runGa4Report(request: Ga4ReportRequest): Promise<Ga4ReportResponse> {
  return runGa4(":runReport", request);
}

/** A single GA4 realtime report request (the subset of `RunRealtimeReportRequest`
 *  we use). Realtime has no `dateRanges` — it always covers the last 30 min. */
export interface Ga4RealtimeRequest {
  metrics: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
  orderBys?: Array<Record<string, unknown>>;
  limit?: number;
}

/** Run a GA4 *realtime* report (active users in the last 30 minutes). Same auth
 *  + error contract as `runGa4Report`. */
export async function runGa4RealtimeReport(
  request: Ga4RealtimeRequest,
): Promise<Ga4ReportResponse> {
  return runGa4(":runRealtimeReport", request);
}

/** Shared transport for both the standard and realtime Data API endpoints. */
async function runGa4(suffix: string, body: unknown): Promise<Ga4ReportResponse> {
  const account = parseServiceAccount();
  if (!account || !CONFIG.ga4PropertyId) {
    throw new Error("GA4 not configured");
  }
  const token = await getAccessToken(account);
  const res = await fetch(`${DATA_API_BASE}/${CONFIG.ga4PropertyId}${suffix}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GA4 ${suffix} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Ga4ReportResponse;
}

/** Test seam — reset the in-process token + account caches. Used by env-flip
 *  tests so a credential change is observed without a fresh process. */
export function _resetGa4CachesForTests(): void {
  tokenCache = null;
  cachedAccount = undefined;
}
