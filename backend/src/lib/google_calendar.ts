// Google Calendar push-sync infra. App-agnostic plumbing: the OAuth2
// authorization-code dance + Google Calendar API v3 CRUD, plus AES-256-GCM
// token encryption. No domain imports — the sync logic (what to push, when)
// lives in domain/google_calendar.ts.
//
// The GSI Web client id (`CONFIG.googleClientId`, already used for sign-in) is
// reused as the OAuth `client_id`; `CONFIG.googleClientSecret` is its paired
// secret for the server-side code exchange. Scope is the FULL calendar scope so
// we can create a dedicated secondary calendar (a "sensitive" Google scope).
//
// When `CONFIG.googleCalendarFake` is on (E2E only) every network call is
// answered by a deterministic in-memory fake, so the whole connect -> sync ->
// disconnect pipeline runs without touching Google.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { CONFIG } from "../config";
import { log } from "./logger";

const OAUTH_SCOPE = "openid email https://www.googleapis.com/auth/calendar";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Where Google sends the browser back after consent. Must be registered as an
 *  authorised redirect URI on the OAuth client in Google Cloud Console. */
export function googleCalendarRedirectUri(): string {
  return `${CONFIG.frontendBaseUrl}/api/google-calendar/callback`;
}

/** A Google Calendar event body — all-day (`date`) or timed (`dateTime` +
 *  `timeZone`). Shared with the domain layer that builds these. */
export interface GoogleEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  /** `transparent` = "free" (doesn't block the day); tasks use this so the
   *  couple's day doesn't read as busy. */
  transparency?: "opaque" | "transparent";
}

/** Normalised token result. `refreshToken` is null on a refresh (Google only
 *  returns it on the first consent) and `email` is only present on the initial
 *  code exchange (parsed from the id_token). */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  email: string | null;
}

// ─── AES-256-GCM token-at-rest encryption ────────────────────────────────────
// Key is derived from JWT_SECRET (already required to be strong in prod), so no
// new secret to manage. Format: base64(iv):base64(tag):base64(ciphertext).

function tokenKey(): Buffer {
  return createHash("sha256").update(CONFIG.jwtSecret).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptToken(enc: string | null): string | null {
  if (!enc) return null;
  try {
    const [ivB, tagB, ctB] = enc.split(":");
    if (!ivB || !tagB || !ctB) return null;
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

/** Build the Google consent URL. `access_type=offline` + `prompt=consent`
 *  force a refresh_token even on re-consent, so long-lived background sync keeps
 *  working. `state` is our signed CSRF/binding token. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CONFIG.googleClientId,
    redirect_uri: googleCalendarRedirectUri(),
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Best-effort decode of the `email` claim out of a Google id_token (no
 *  signature check needed — it came straight from Google's token endpoint over
 *  TLS). Returns null on any malformed input. */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: string };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });
}

/** Exchange an authorization code for tokens (initial consent). */
export async function exchangeCode(code: string): Promise<OAuthTokens> {
  if (CONFIG.googleCalendarFake) return fakeExchange(code);
  const res = await postForm(TOKEN_URL, {
    code,
    client_id: CONFIG.googleClientId,
    client_secret: CONFIG.googleClientSecret,
    redirect_uri: googleCalendarRedirectUri(),
    grant_type: "authorization_code",
  });
  if (!res.ok) throw new Error(`google token exchange ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in,
    email: emailFromIdToken(data.id_token),
  };
}

/** Trade a refresh_token for a fresh access_token. Google does not return a new
 *  refresh_token here, so `refreshToken` is null. */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  if (CONFIG.googleCalendarFake) return fakeRefresh(refreshToken);
  const res = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: CONFIG.googleClientId,
    client_secret: CONFIG.googleClientSecret,
    grant_type: "refresh_token",
  });
  if (!res.ok) throw new Error(`google token refresh ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresInSec: data.expires_in,
    email: null,
  };
}

/** Revoke a token (best-effort, on disconnect). Never throws. */
export async function revokeToken(token: string): Promise<void> {
  if (CONFIG.googleCalendarFake) return;
  try {
    await postForm(REVOKE_URL, { token });
  } catch (e) {
    log.warn("gcal.revoke_failed", { err: String(e) });
  }
}

// ─── Calendar API v3 ─────────────────────────────────────────────────────────

async function calFetch(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${CAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
}

/** Create a dedicated secondary calendar; returns its id. */
export async function createCalendar(
  accessToken: string,
  summary: string,
  timeZone: string,
): Promise<string> {
  if (CONFIG.googleCalendarFake) return fakeCreateCalendar(summary, timeZone);
  const res = await calFetch(accessToken, "POST", "/calendars", { summary, timeZone });
  if (!res.ok) throw new Error(`gcal createCalendar ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Delete an entire secondary calendar (used on disconnect). */
export async function deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
  if (CONFIG.googleCalendarFake) return fakeDeleteCalendar(calendarId);
  const res = await calFetch(accessToken, "DELETE", `/calendars/${encodeURIComponent(calendarId)}`);
  // 404/410 = already gone; treat as success.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`gcal deleteCalendar ${res.status}: ${await res.text()}`);
  }
}

/** Insert an event; returns the created event id. */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventBody,
): Promise<string> {
  if (CONFIG.googleCalendarFake) return fakeInsertEvent(calendarId, body);
  const res = await calFetch(
    accessToken,
    "POST",
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    body,
  );
  if (!res.ok) throw new Error(`gcal insertEvent ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Patch an existing event. */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody,
): Promise<void> {
  if (CONFIG.googleCalendarFake) return fakePatchEvent(calendarId, eventId, body);
  const res = await calFetch(
    accessToken,
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    body,
  );
  if (!res.ok) throw new Error(`gcal patchEvent ${res.status}: ${await res.text()}`);
}

/** Delete a single event. 404/410 tolerated. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  if (CONFIG.googleCalendarFake) return fakeDeleteEvent(calendarId, eventId);
  const res = await calFetch(
    accessToken,
    "DELETE",
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`gcal deleteEvent ${res.status}: ${await res.text()}`);
  }
}

// ─── Country → IANA timezone (for the dedicated calendar + timed run-sheet) ───
// Weddly's markets, mapped to a representative zone. Unknown/absent country
// falls back to Europe/Budapest (the launch market).

const COUNTRY_TZ: Record<string, string> = {
  HU: "Europe/Budapest",
  AT: "Europe/Vienna",
  SK: "Europe/Bratislava",
  CZ: "Europe/Prague",
  PL: "Europe/Warsaw",
  DE: "Europe/Berlin",
  CH: "Europe/Zurich",
  RO: "Europe/Bucharest",
  HR: "Europe/Zagreb",
  SI: "Europe/Ljubljana",
  RS: "Europe/Belgrade",
  BG: "Europe/Sofia",
  GR: "Europe/Athens",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  LU: "Europe/Luxembourg",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
  IT: "Europe/Rome",
  IE: "Europe/Dublin",
  GB: "Europe/London",
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  FI: "Europe/Helsinki",
  NO: "Europe/Oslo",
};

export function countryToTimeZone(country: string | null): string {
  if (!country) return "Europe/Budapest";
  return COUNTRY_TZ[country.toUpperCase()] ?? "Europe/Budapest";
}

// ─── Deterministic in-memory fake (E2E only) ─────────────────────────────────

interface FakeCalendar {
  id: string;
  summary: string;
  timeZone: string;
  events: Map<string, GoogleEventBody>;
}
const fakeCalendars = new Map<string, FakeCalendar>();
let fakeSeq = 0;

/** Reset the fake store — tests call this alongside DB wipes so calendars from
 *  a prior case don't leak into the next. */
export function __resetGoogleCalendarFake(): void {
  fakeCalendars.clear();
  fakeSeq = 0;
}

/** Read-only peek at a fake calendar's events, for test assertions. */
export function __fakeCalendarEvents(calendarId: string): GoogleEventBody[] {
  return [...(fakeCalendars.get(calendarId)?.events.values() ?? [])];
}

function fakeExchange(code: string): OAuthTokens {
  return {
    accessToken: `fake-access-${code}`,
    refreshToken: `fake-refresh-${code}`,
    expiresInSec: 3600,
    email: "weddly.fake@gmail.com",
  };
}

function fakeRefresh(refreshToken: string): OAuthTokens {
  return {
    accessToken: `fake-access-refreshed-${refreshToken.slice(-6)}`,
    refreshToken: null,
    expiresInSec: 3600,
    email: null,
  };
}

function fakeCreateCalendar(summary: string, timeZone: string): string {
  fakeSeq += 1;
  const id = `fake-cal-${fakeSeq}`;
  fakeCalendars.set(id, { id, summary, timeZone, events: new Map() });
  return id;
}

function fakeDeleteCalendar(calendarId: string): void {
  fakeCalendars.delete(calendarId);
}

function fakeInsertEvent(calendarId: string, body: GoogleEventBody): string {
  const cal = fakeCalendars.get(calendarId);
  if (!cal) throw new Error(`fake gcal: unknown calendar ${calendarId}`);
  fakeSeq += 1;
  const id = `fake-evt-${fakeSeq}`;
  cal.events.set(id, body);
  return id;
}

function fakePatchEvent(calendarId: string, eventId: string, body: GoogleEventBody): void {
  fakeCalendars.get(calendarId)?.events.set(eventId, body);
}

function fakeDeleteEvent(calendarId: string, eventId: string): void {
  fakeCalendars.get(calendarId)?.events.delete(eventId);
}
