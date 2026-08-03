// Google Calendar sync infra. App-agnostic plumbing: the OAuth2
// authorization-code dance + Google Calendar API v3 CRUD + the two READ calls
// the pull direction needs (calendar list, free/busy), plus AES-256-GCM token
// encryption. No domain imports: the sync logic (what to push or pull, when)
// lives in domain/google_calendar.ts and domain/vendor_external_busy.ts.
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
/** Google has refused the refresh token itself: the user revoked access, the
 *  grant expired (every refresh token issued while the OAuth app sits in
 *  Google's "Testing" publishing status dies after 7 days), or the token was
 *  reissued elsewhere. Distinguished from every other failure because only this
 *  one is unfixable by retrying — it needs the person back on the consent
 *  screen, and the connection has to SAY so instead of retrying forever behind a
 *  UI that still reads "connected". */
export class GoogleReauthRequiredError extends Error {
  constructor(detail: string) {
    super(`google refresh token rejected: ${detail}`);
    this.name = "GoogleReauthRequiredError";
  }
}

/** The sentinel both connection tables store in `last_error` for a dead grant.
 *  A sentinel rather than the raw message because the status payload is read by
 *  a UI that has to decide between "retrying, nothing to do" and "you must come
 *  back to Google", and a message string is not a decision. Mirrors the vendor
 *  side's existing `pro_required` parking value. */
export const GCAL_REAUTH_REQUIRED = "reauth_required";

/** What to store in `last_error` for a failed sync. Every catch goes through
 *  here so a dead grant is recorded the same way on both aggregates. */
export function calendarErrorForStore(e: unknown): string {
  if (e instanceof GoogleReauthRequiredError) return GCAL_REAUTH_REQUIRED;
  return String(e instanceof Error ? e.message : e).slice(0, 500);
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  if (CONFIG.googleCalendarFake) return fakeRefresh(refreshToken);
  const res = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: CONFIG.googleClientId,
    client_secret: CONFIG.googleClientSecret,
    grant_type: "refresh_token",
  });
  if (!res.ok) {
    const body = await res.text();
    // `invalid_grant` is Google's answer for a dead grant; a 400/401 on the
    // token endpoint means the same thing in practice. Anything else (429, 5xx,
    // a network blip) stays an ordinary error the worker may retry.
    if (res.status === 400 || res.status === 401 || body.includes("invalid_grant")) {
      throw new GoogleReauthRequiredError(`${res.status} ${body.slice(0, 200)}`);
    }
    throw new Error(`google token refresh ${res.status}: ${body}`);
  }
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

// ─── Reading the other direction: calendar list + free/busy ──────────────────
// The pull half of the two-way sync. Deliberately the two THINNEST reads Google
// offers: which calendars exist (so the vendor can pick), and when they are busy
// (start/end only). `events.list` is never called, so no title, attendee or
// location of a private appointment can reach Weddly even by accident.

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

/** The vendor's own calendars. Read-only entries (`freeBusyReader` and up) are
 *  included: reading busy time is exactly what we need them for. */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  if (CONFIG.googleCalendarFake) return fakeListCalendars();
  const res = await calFetch(accessToken, "GET", "/users/me/calendarList?maxResults=250");
  if (!res.ok) throw new Error(`gcal listCalendars ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    items?: Array<{ id?: string; summary?: string; primary?: boolean; deleted?: boolean }>;
  };
  return (data.items ?? [])
    .filter((i): i is { id: string; summary?: string; primary?: boolean } => !!i.id && !i.deleted)
    .map((i) => ({ id: i.id, summary: i.summary ?? i.id, primary: i.primary === true }));
}

/** One busy block, as Google reports it: RFC3339 instants, no content. */
export interface BusyRange {
  start: string;
  end: string;
}

/** Free/busy for up to 50 calendars in one call. Returns the merged busy ranges
 *  per calendar id; a calendar Google errors on (deleted, permission lost) is
 *  omitted rather than failing the whole query, because one stale id in the
 *  vendor's selection must not stop the other calendars from syncing. */
export async function queryFreeBusy(
  accessToken: string,
  input: { timeMin: string; timeMax: string; calendarIds: readonly string[] },
): Promise<Record<string, BusyRange[]>> {
  if (input.calendarIds.length === 0) return {};
  if (CONFIG.googleCalendarFake) return fakeFreeBusy(input);
  const res = await calFetch(accessToken, "POST", "/freeBusy", {
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    items: input.calendarIds.slice(0, 50).map((id) => ({ id })),
  });
  if (!res.ok) throw new Error(`gcal freeBusy ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: BusyRange[]; errors?: Array<{ reason?: string }> }>;
  };
  const out: Record<string, BusyRange[]> = {};
  for (const [id, entry] of Object.entries(data.calendars ?? {})) {
    if (entry.errors && entry.errors.length > 0) {
      log.warn("gcal.freebusy_calendar_error", { calendarId: id, reason: entry.errors[0]?.reason });
      continue;
    }
    out[id] = entry.busy ?? [];
  }
  return out;
}

// ─── Idempotent event reconcile ──────────────────────────────────────────────
// The insert / patch-if-changed / delete-orphans diff, shared by every aggregate
// that pushes a calendar (couples and vendors today). Kept here rather than
// duplicated per domain because it is the part with real logic; the caller
// supplies WHAT it wants on the calendar and how to persist the source→event
// mapping, and this owns the "make Google match that, changing as little as
// possible" algorithm.
//
// Still app-agnostic: it never learns what a couple or a vendor is — the store
// is injected, so lib/ keeps its no-imports-from-domain rule.

/** One event the caller wants to exist, keyed by a stable source identity. */
export interface DesiredCalendarEvent {
  sourceKind: string;
  sourceId: string;
  /** Hash of `body`. An unchanged hash skips the API call entirely. */
  hash: string;
  body: GoogleEventBody;
}

/** A row of the caller's source→Google-event mapping table. */
export interface CalendarEventMapRow {
  source_kind: string;
  source_id: string;
  google_event_id: string;
  content_hash: string;
}

/** Persistence hooks for the mapping table, keyed `"${kind}:${id}"`. */
export interface CalendarEventStore {
  list(): Map<string, CalendarEventMapRow>;
  upsert(kind: string, id: string, googleEventId: string, hash: string): void;
  remove(kind: string, id: string): void;
}

/** Make `calendarId` match `desired`, touching only what changed: insert events
 *  with no mapping, patch those whose content hash moved (reusing the existing
 *  Google event id so a re-sync never duplicates), and delete mapped events that
 *  are no longer desired. Throws on the first Google failure — callers are
 *  expected to leave their connection dirty and retry, which is safe because
 *  every write here is idempotent and the next pass re-diffs. */
export async function reconcileCalendarEvents(input: {
  accessToken: string;
  calendarId: string;
  desired: readonly DesiredCalendarEvent[];
  store: CalendarEventStore;
}): Promise<void> {
  const { accessToken, calendarId, desired, store } = input;
  const existing = store.list();
  const desiredKeys = new Set(desired.map((d) => `${d.sourceKind}:${d.sourceId}`));

  for (const d of desired) {
    const key = `${d.sourceKind}:${d.sourceId}`;
    const prev = existing.get(key);
    if (!prev) {
      const evtId = await insertEvent(accessToken, calendarId, d.body);
      store.upsert(d.sourceKind, d.sourceId, evtId, d.hash);
    } else if (prev.content_hash !== d.hash) {
      await patchEvent(accessToken, calendarId, prev.google_event_id, d.body);
      store.upsert(d.sourceKind, d.sourceId, prev.google_event_id, d.hash);
    }
  }

  for (const [key, prev] of existing) {
    if (!desiredKeys.has(key)) {
      await deleteEvent(accessToken, calendarId, prev.google_event_id);
      store.remove(prev.source_kind, prev.source_id);
    }
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
/** Busy ranges the test seeded per calendar id, answered by the fake free/busy
 *  query. Separate from `fakeCalendars.events`: free/busy is a different read,
 *  and a test asserting the PULL direction should not have to write events. */
const fakeBusy = new Map<string, BusyRange[]>();
/** Calendars that exist in the fake Google account but were not created by us
 *  (the vendor's personal ones), so `listCalendars` has something to return. */
const fakeExternalCalendars: GoogleCalendarListEntry[] = [];

/** Reset the fake store — tests call this alongside DB wipes so calendars from
 *  a prior case don't leak into the next. */
export function __resetGoogleCalendarFake(): void {
  fakeCalendars.clear();
  fakeBusy.clear();
  fakeExternalCalendars.length = 0;
  fakeSeq = 0;
}

/** Seed a personal calendar into the fake account (id, name, primary flag). */
export function __fakeAddCalendar(entry: GoogleCalendarListEntry): void {
  fakeExternalCalendars.push(entry);
}

/** Seed busy ranges for a calendar id, as Google's free/busy would report them. */
export function __fakeSetBusy(calendarId: string, ranges: BusyRange[]): void {
  fakeBusy.set(calendarId, ranges);
}

function fakeListCalendars(): GoogleCalendarListEntry[] {
  // Our own pushed calendars are part of the account too, exactly as they would
  // be in the real API. Filtering ours out is the CALLER's job, and that filter
  // is what stops a pushed booking coming back as external busy.
  const ours = [...fakeCalendars.values()].map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: false,
  }));
  return [...fakeExternalCalendars, ...ours];
}

function fakeFreeBusy(input: {
  timeMin: string;
  timeMax: string;
  calendarIds: readonly string[];
}): Record<string, BusyRange[]> {
  const min = Date.parse(input.timeMin);
  const max = Date.parse(input.timeMax);
  const out: Record<string, BusyRange[]> = {};
  for (const id of input.calendarIds) {
    out[id] = (fakeBusy.get(id) ?? []).filter(
      (r) => Date.parse(r.end) > min && Date.parse(r.start) < max,
    );
  }
  return out;
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

/** The fake refuses a token whose id says so, which is how a test reaches the
 *  dead-grant path without a network. Real life gets there three ways: the user
 *  revoked access, the grant expired (7 days while the OAuth app is in Google's
 *  Testing status), or the refresh token was superseded. */
export const FAKE_REVOKED_REFRESH_MARKER = "revoked";

function fakeRefresh(refreshToken: string): OAuthTokens {
  if (refreshToken.includes(FAKE_REVOKED_REFRESH_MARKER)) {
    throw new GoogleReauthRequiredError("400 invalid_grant (fake)");
  }
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
