// Google Calendar push-sync domain. Decides WHAT to mirror into a couple's
// dedicated Google calendar (dated tasks + the wedding day + the day-of run
// sheet) and reconciles it idempotently. The OAuth/API plumbing + token crypto
// live in lib/google_calendar.ts; this file never talks to the network except
// through those helpers.
//
// Sync is one-way (Weddly -> Google). A mutating write on planning/schedule
// calls `markCoupleCalendarDirty`; the background worker (or "Sync now") then
// runs `syncCoupleCalendar`, which diffs desired events against the event map
// and inserts/patches/deletes only what changed.

import { createHash } from "node:crypto";
import { db, now } from "../db";
import {
  countryToTimeZone,
  createCalendar,
  decryptToken,
  deleteCalendar,
  deleteEvent,
  encryptToken,
  type GoogleEventBody,
  insertEvent,
  patchEvent,
  refreshAccessToken,
  revokeToken,
} from "../lib/google_calendar";
import { log } from "../lib/logger";
import { listPlanningItemsByCouple } from "./planning";
import { listScheduleEvents } from "./schedule";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EVENT_MINUTES = 30;

export interface GoogleCalendarConnectionRow {
  couple_id: number;
  connected_user_id: number;
  google_email: string;
  calendar_id: string | null;
  time_zone: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expiry: number | null;
  sync_state: string;
  last_synced_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface CoupleFacts {
  bride_name: string;
  groom_name: string;
  wedding_date: string | null;
  country: string | null;
}

interface EventMapRow {
  source_kind: string;
  source_id: string;
  google_event_id: string;
  content_hash: string;
}

interface DesiredEvent {
  sourceKind: "task" | "wedding_day" | "schedule";
  sourceId: string;
  hash: string;
  body: GoogleEventBody;
}

// ─── Connection accessors ────────────────────────────────────────────────────

export function getConnectionRow(coupleId: number): GoogleCalendarConnectionRow | null {
  return (
    (db.prepare("SELECT * FROM google_calendar_connections WHERE couple_id = ?").get(coupleId) as
      | GoogleCalendarConnectionRow
      | undefined) ?? null
  );
}

/** Insert/replace a connection after a successful OAuth exchange. Preserves the
 *  existing `calendar_id` (so a re-consent reuses the same calendar) and keeps
 *  the prior refresh_token when Google omits a fresh one. Always leaves the row
 *  `dirty` so the next sync pushes a full initial set. */
export function saveConnection(input: {
  coupleId: number;
  connectedUserId: number;
  email: string;
  timeZone: string;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
}): void {
  const ts = now();
  const accessEnc = encryptToken(input.accessToken);
  const refreshEnc = input.refreshToken ? encryptToken(input.refreshToken) : null;
  const expiry = ts + input.expiresInSec * 1000;
  db.prepare(
    `INSERT INTO google_calendar_connections
       (couple_id, connected_user_id, google_email, calendar_id, time_zone,
        access_token_enc, refresh_token_enc, token_expiry, sync_state,
        last_synced_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'dirty', NULL, NULL, ?, ?)
     ON CONFLICT(couple_id) DO UPDATE SET
       connected_user_id = excluded.connected_user_id,
       google_email      = excluded.google_email,
       time_zone         = excluded.time_zone,
       access_token_enc  = excluded.access_token_enc,
       refresh_token_enc = COALESCE(excluded.refresh_token_enc, google_calendar_connections.refresh_token_enc),
       token_expiry      = excluded.token_expiry,
       sync_state        = 'dirty',
       last_error        = NULL,
       updated_at        = excluded.updated_at`,
  ).run(
    input.coupleId,
    input.connectedUserId,
    input.email,
    input.timeZone,
    accessEnc,
    refreshEnc,
    expiry,
    ts,
    ts,
  );
}

/** Flag a couple's calendar as needing a re-sync. No-op (0 rows) when the couple
 *  isn't connected, so mutating routes can call it unconditionally + cheaply. */
export function markCoupleCalendarDirty(coupleId: number): void {
  db.prepare(
    "UPDATE google_calendar_connections SET sync_state = 'dirty', updated_at = ? WHERE couple_id = ?",
  ).run(now(), coupleId);
}

/** Couple ids with pending changes — the worker's work queue. */
export function listDirtyConnectionCoupleIds(): number[] {
  const rows = db
    .prepare("SELECT couple_id FROM google_calendar_connections WHERE sync_state = 'dirty'")
    .all() as { couple_id: number }[];
  return rows.map((r) => r.couple_id);
}

function coupleFacts(coupleId: number): CoupleFacts | null {
  return (
    (db
      .prepare("SELECT bride_name, groom_name, wedding_date, country FROM couples WHERE id = ?")
      .get(coupleId) as CoupleFacts | undefined) ?? null
  );
}

function listEventMap(coupleId: number): Map<string, EventMapRow> {
  const rows = db
    .prepare(
      "SELECT source_kind, source_id, google_event_id, content_hash FROM google_calendar_event_map WHERE couple_id = ?",
    )
    .all(coupleId) as EventMapRow[];
  const map = new Map<string, EventMapRow>();
  for (const r of rows) map.set(`${r.source_kind}:${r.source_id}`, r);
  return map;
}

function upsertEventMap(
  coupleId: number,
  kind: string,
  id: string,
  eventId: string,
  hash: string,
): void {
  db.prepare(
    `INSERT INTO google_calendar_event_map
       (couple_id, source_kind, source_id, google_event_id, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(couple_id, source_kind, source_id) DO UPDATE SET
       google_event_id = excluded.google_event_id,
       content_hash    = excluded.content_hash,
       updated_at      = excluded.updated_at`,
  ).run(coupleId, kind, id, eventId, hash, now());
}

function deleteEventMapRow(coupleId: number, kind: string, id: string): void {
  db.prepare(
    "DELETE FROM google_calendar_event_map WHERE couple_id = ? AND source_kind = ? AND source_id = ?",
  ).run(coupleId, kind, id);
}

// ─── Desired-event construction ──────────────────────────────────────────────

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  dt.setUTCDate(dt.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

function hashBody(body: GoogleEventBody): string {
  return createHash("sha1").update(JSON.stringify(body)).digest("hex");
}

function coupleTitle(facts: CoupleFacts): string {
  const names = [facts.bride_name, facts.groom_name].map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? `💍 ${names.join(" & ")}` : "💍 Wedding";
}

/** The full set of events that SHOULD exist in the couple's Google calendar
 *  right now. Pure read from the DB — the reconciler diffs this against the
 *  event map. */
export function buildDesiredEvents(coupleId: number, timeZone: string): DesiredEvent[] {
  const facts = coupleFacts(coupleId);
  if (!facts) return [];
  const out: DesiredEvent[] = [];

  // 1. Dated planning tasks -> all-day event on the due date.
  for (const item of listPlanningItemsByCouple(coupleId)) {
    if (item.kind !== "task" || !item.due_date || !ISO_DATE.test(item.due_date)) continue;
    const body: GoogleEventBody = {
      summary: item.title,
      start: { date: item.due_date },
      end: { date: addDaysIso(item.due_date, 1) },
      transparency: "transparent",
    };
    out.push({ sourceKind: "task", sourceId: String(item.id), hash: hashBody(body), body });
  }

  // 2. The wedding day -> all-day anchor.
  if (facts.wedding_date && ISO_DATE.test(facts.wedding_date)) {
    const body: GoogleEventBody = {
      summary: coupleTitle(facts),
      start: { date: facts.wedding_date },
      end: { date: addDaysIso(facts.wedding_date, 1) },
    };
    out.push({ sourceKind: "wedding_day", sourceId: "wedding", hash: hashBody(body), body });
  }

  // 3. Day-of run sheet -> timed events on the wedding date (needs a date to
  //    anchor `starts_at_minutes` against).
  if (facts.wedding_date && ISO_DATE.test(facts.wedding_date)) {
    for (const ev of listScheduleEvents(coupleId)) {
      const startMin = ev.starts_at_minutes;
      const endMin = startMin + (ev.duration_minutes ?? DEFAULT_EVENT_MINUTES);
      const start = minutesToLocal(facts.wedding_date, startMin);
      const end = minutesToLocal(facts.wedding_date, endMin);
      const descParts = [ev.responsible, ev.notes].filter((s): s is string => !!s && !!s.trim());
      const body: GoogleEventBody = {
        summary: ev.label,
        start: { dateTime: start, timeZone },
        end: { dateTime: end, timeZone },
        ...(ev.location ? { location: ev.location } : {}),
        ...(descParts.length ? { description: descParts.join("\n") } : {}),
      };
      out.push({ sourceKind: "schedule", sourceId: String(ev.id), hash: hashBody(body), body });
    }
  }

  return out;
}

/** `starts_at_minutes` is minutes from the wedding-day's local midnight and can
 *  exceed 1440 (post-midnight beats), so it may roll into the next calendar day.
 *  Returns a `YYYY-MM-DDTHH:MM:SS` local string to pair with an explicit
 *  timeZone. */
function minutesToLocal(weddingIso: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const dateStr = addDaysIso(weddingIso, dayOffset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dateStr}T${p(Math.floor(minuteOfDay / 60))}:${p(minuteOfDay % 60)}:00`;
}

// ─── Token freshness ─────────────────────────────────────────────────────────

async function ensureFreshAccessToken(conn: GoogleCalendarConnectionRow): Promise<string> {
  const nowMs = now();
  const current = decryptToken(conn.access_token_enc);
  // 60s skew buffer so a token that expires mid-request is refreshed first.
  if (current && conn.token_expiry && conn.token_expiry - 60_000 > nowMs) return current;

  const refresh = decryptToken(conn.refresh_token_enc);
  if (!refresh) {
    if (current) return current;
    throw new Error("google calendar connection has no usable token");
  }
  const t = await refreshAccessToken(refresh);
  db.prepare(
    "UPDATE google_calendar_connections SET access_token_enc = ?, token_expiry = ?, updated_at = ? WHERE couple_id = ?",
  ).run(encryptToken(t.accessToken), nowMs + t.expiresInSec * 1000, nowMs, conn.couple_id);
  return t.accessToken;
}

// ─── Reconcile ───────────────────────────────────────────────────────────────

/** Idempotent one-way reconcile of a couple's Google calendar. Creates the
 *  dedicated calendar on first run, then inserts new / patches changed / deletes
 *  removed events by diffing `buildDesiredEvents` against the event map. On any
 *  Google failure it records `last_error` and LEAVES the row dirty so the worker
 *  retries; it never throws. */
export async function syncCoupleCalendar(coupleId: number): Promise<void> {
  const conn = getConnectionRow(coupleId);
  if (!conn) return;
  try {
    const accessToken = await ensureFreshAccessToken(conn);

    let calendarId = conn.calendar_id;
    if (!calendarId) {
      const facts = coupleFacts(coupleId);
      const summary = facts ? `Weddly – ${namesFor(facts)}` : "Weddly";
      calendarId = await createCalendar(accessToken, summary, conn.time_zone);
      db.prepare(
        "UPDATE google_calendar_connections SET calendar_id = ?, updated_at = ? WHERE couple_id = ?",
      ).run(calendarId, now(), coupleId);
    }

    const desired = buildDesiredEvents(coupleId, conn.time_zone);
    const existing = listEventMap(coupleId);
    const desiredKeys = new Set(desired.map((d) => `${d.sourceKind}:${d.sourceId}`));

    for (const d of desired) {
      const key = `${d.sourceKind}:${d.sourceId}`;
      const prev = existing.get(key);
      if (!prev) {
        const evtId = await insertEvent(accessToken, calendarId, d.body);
        upsertEventMap(coupleId, d.sourceKind, d.sourceId, evtId, d.hash);
      } else if (prev.content_hash !== d.hash) {
        await patchEvent(accessToken, calendarId, prev.google_event_id, d.body);
        upsertEventMap(coupleId, d.sourceKind, d.sourceId, prev.google_event_id, d.hash);
      }
    }

    for (const [key, prev] of existing) {
      if (!desiredKeys.has(key)) {
        await deleteEvent(accessToken, calendarId, prev.google_event_id);
        deleteEventMapRow(coupleId, prev.source_kind, prev.source_id);
      }
    }

    db.prepare(
      "UPDATE google_calendar_connections SET sync_state = 'idle', last_synced_at = ?, last_error = NULL, updated_at = ? WHERE couple_id = ?",
    ).run(now(), now(), coupleId);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
    db.prepare(
      "UPDATE google_calendar_connections SET last_error = ?, updated_at = ? WHERE couple_id = ?",
    ).run(msg, now(), coupleId);
    log.error("gcal.sync_failed", { coupleId, err: msg });
  }
}

function namesFor(facts: CoupleFacts): string {
  const names = [facts.bride_name, facts.groom_name].map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? names.join(" & ") : "Wedding";
}

/** Tear down a connection: best-effort delete the dedicated calendar + revoke
 *  the token, then drop the local rows. Safe to call when not connected. */
export async function disconnectCoupleCalendar(coupleId: number): Promise<void> {
  const conn = getConnectionRow(coupleId);
  if (!conn) return;
  try {
    if (conn.calendar_id) {
      const token = await ensureFreshAccessToken(conn).catch(() =>
        decryptToken(conn.access_token_enc),
      );
      if (token) await deleteCalendar(token, conn.calendar_id);
    }
  } catch (e) {
    log.warn("gcal.disconnect_delete_failed", { coupleId, err: String(e) });
  }
  const refresh = decryptToken(conn.refresh_token_enc);
  if (refresh) await revokeToken(refresh);
  db.prepare("DELETE FROM google_calendar_event_map WHERE couple_id = ?").run(coupleId);
  db.prepare("DELETE FROM google_calendar_connections WHERE couple_id = ?").run(coupleId);
}

/** Derive the calendar time zone for a couple from their country. Used by the
 *  callback when first saving the connection. */
export function timeZoneForCouple(coupleId: number): string {
  return countryToTimeZone(coupleFacts(coupleId)?.country ?? null);
}
