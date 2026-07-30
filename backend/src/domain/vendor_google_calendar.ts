// Vendor calendar -> Google Calendar push-sync domain. Decides WHAT of a
// vendor's Weddly calendar to mirror into their dedicated Google calendar and
// reconciles it idempotently. OAuth/API plumbing + token crypto live in
// lib/google_calendar.ts; the insert/patch/delete diff is the shared
// `reconcileCalendarEvents`. This file never touches the network directly.
//
// A PARALLEL aggregate to domain/google_calendar.ts (couples), not a
// generalisation of it: the couple tables are keyed by a couple_id that is both
// PK and FK, so there was no additive path to a second owner type. Same reason
// vendor billing sits beside couple billing rather than inside it.
//
// TWO-WAY since 2026-07-30, and the two directions are deliberately unequal:
//
//   push (Weddly -> Google)   full events: what, who, when.
//   pull (Google -> Weddly)   FREE/BUSY ONLY, from the calendars the vendor
//                             ticked, stored as bare date + minute ranges.
//
// It used to be push-only, with two objections written down. Both are answered
// rather than ignored:
//
//   "a pull needs syncToken machinery"  -> free/busy needs none. It is a
//     stateless question about a window, so the pull is a periodic replace of
//     one horizon, not an incremental event feed.
//   "a dentist appointment would mark a wedding date busy" -> external busy is
//     measured against the vendor's WORKING HOURS (`externalBusyVerdict`), so it
//     only takes a date off the market when no workable minute survives. An hour
//     at the dentist reads as partly busy and the Saturday stays bookable.
//
// The other guard is structural: the pull NEVER queries our own pushed calendar
// (`conn.calendar_id` is filtered out of every selection), otherwise a booking
// we pushed would return as external busy and block the date it belongs to.

import { createHash } from "node:crypto";
import { db, now } from "../db";
import {
  type CalendarEventMapRow,
  countryToTimeZone,
  createCalendar,
  decryptToken,
  deleteCalendar,
  deleteEvent,
  type DesiredCalendarEvent,
  encryptToken,
  type GoogleCalendarListEntry,
  type GoogleEventBody,
  listCalendars,
  queryFreeBusy,
  reconcileCalendarEvents,
  refreshAccessToken,
  revokeToken,
} from "../lib/google_calendar";
import { log } from "../lib/logger";
import {
  clearVendorExternalBusy,
  type ExternalBusyRow,
  replaceVendorExternalBusy,
  splitBusyRange,
} from "./vendor_external_busy";
import { vendorPlanForAccount } from "./vendor_clients";
import { isVendorFeatureEnabled } from "@shared/vendor_plan";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface VendorGoogleCalendarConnectionRow {
  vendor_account_id: number;
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
  /** The pull direction's master switch. 1 by default: a vendor who connects a
   *  calendar wants it respected. */
  pull_enabled: number;
  /** JSON array of Google calendar ids to read free/busy from. NULL = not
   *  chosen yet, which resolves to their primary calendar only. */
  selected_calendar_ids: string | null;
  /** Last successful free/busy pull. Separate from `last_synced_at` so the pull
   *  is paced independently of the push queue. */
  busy_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

interface VendorFacts {
  display_name: string;
  country: string | null;
  locale: string | null;
}

// The vendor's own calendar, so labels follow the account owner's locale the
// same way outbound email does. Only HU/EN copy exists app-wide; anything else
// resolves to EN.
interface EventLabels {
  inquiry: string;
  blocked: string;
  task: string;
  confirmed: string;
}

const LABELS: Record<"hu" | "en", EventLabels> = {
  hu: { inquiry: "Megkeresés", blocked: "Nem elérhető", task: "Teendő", confirmed: "Esküvő" },
  en: { inquiry: "Inquiry", blocked: "Unavailable", task: "To-do", confirmed: "Wedding" },
};

function labelsFor(locale: string | null): EventLabels {
  return locale?.toLowerCase().startsWith("hu") ? LABELS.hu : LABELS.en;
}

// ─── Connection accessors ────────────────────────────────────────────────────

export function getVendorConnectionRow(
  vendorAccountId: number,
): VendorGoogleCalendarConnectionRow | null {
  return (
    (db
      .prepare("SELECT * FROM vendor_google_calendar_connections WHERE vendor_account_id = ?")
      .get(vendorAccountId) as VendorGoogleCalendarConnectionRow | undefined) ?? null
  );
}

/** Insert/replace a connection after a successful OAuth exchange. Preserves the
 *  existing `calendar_id` (a re-consent reuses the same calendar) and keeps the
 *  prior refresh token when Google omits a fresh one. Always leaves the row
 *  `dirty` so the next sync pushes a full initial set. */
export function saveVendorConnection(input: {
  vendorAccountId: number;
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
    `INSERT INTO vendor_google_calendar_connections
       (vendor_account_id, connected_user_id, google_email, calendar_id, time_zone,
        access_token_enc, refresh_token_enc, token_expiry, sync_state,
        last_synced_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'dirty', NULL, NULL, ?, ?)
     ON CONFLICT(vendor_account_id) DO UPDATE SET
       connected_user_id = excluded.connected_user_id,
       google_email      = excluded.google_email,
       time_zone         = excluded.time_zone,
       access_token_enc  = excluded.access_token_enc,
       refresh_token_enc = COALESCE(excluded.refresh_token_enc, vendor_google_calendar_connections.refresh_token_enc),
       token_expiry      = excluded.token_expiry,
       sync_state        = 'dirty',
       last_error        = NULL,
       updated_at        = excluded.updated_at`,
  ).run(
    input.vendorAccountId,
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

/** Flag a vendor's calendar as needing a re-sync. No-op (0 rows) when the vendor
 *  isn't connected, so mutating routes call it unconditionally + cheaply. */
export function markVendorCalendarDirty(vendorAccountId: number | null): void {
  if (vendorAccountId == null) return;
  db.prepare(
    "UPDATE vendor_google_calendar_connections SET sync_state = 'dirty', updated_at = ? WHERE vendor_account_id = ?",
  ).run(now(), vendorAccountId);
}

/** Vendor account ids with pending changes — the worker's work queue. */
export function listDirtyVendorAccountIds(): number[] {
  const rows = db
    .prepare(
      "SELECT vendor_account_id FROM vendor_google_calendar_connections WHERE sync_state = 'dirty'",
    )
    .all() as { vendor_account_id: number }[];
  return rows.map((r) => r.vendor_account_id);
}

function vendorFacts(vendorAccountId: number): VendorFacts | null {
  return (
    (db
      .prepare(
        `SELECT va.display_name AS display_name, va.country AS country, u.locale AS locale
           FROM vendor_accounts va
           JOIN users u ON u.id = va.owner_user_id
          WHERE va.id = ?`,
      )
      .get(vendorAccountId) as VendorFacts | undefined) ?? null
  );
}

function eventStore(vendorAccountId: number) {
  return {
    list(): Map<string, CalendarEventMapRow> {
      const rows = db
        .prepare(
          "SELECT source_kind, source_id, google_event_id, content_hash FROM vendor_google_calendar_event_map WHERE vendor_account_id = ?",
        )
        .all(vendorAccountId) as CalendarEventMapRow[];
      const map = new Map<string, CalendarEventMapRow>();
      for (const r of rows) map.set(`${r.source_kind}:${r.source_id}`, r);
      return map;
    },
    upsert(kind: string, id: string, googleEventId: string, hash: string): void {
      db.prepare(
        `INSERT INTO vendor_google_calendar_event_map
           (vendor_account_id, source_kind, source_id, google_event_id, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(vendor_account_id, source_kind, source_id) DO UPDATE SET
           google_event_id = excluded.google_event_id,
           content_hash    = excluded.content_hash,
           updated_at      = excluded.updated_at`,
      ).run(vendorAccountId, kind, id, googleEventId, hash, now());
    },
    remove(kind: string, id: string): void {
      db.prepare(
        "DELETE FROM vendor_google_calendar_event_map WHERE vendor_account_id = ? AND source_kind = ? AND source_id = ?",
      ).run(vendorAccountId, kind, id);
    },
  };
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

/** Same degrade-to-full-day rule as domain/supplier_bookings.ts: a corrupt or
 *  empty `blocked_hours` cell must never read as "available". */
function parseBlockedHours(raw: string | null): number[] | null {
  if (raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const hours = parsed
      .filter((h): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23)
      .sort((a, b) => a - b);
    return hours.length > 0 ? Array.from(new Set(hours)) : null;
  } catch {
    return null;
  }
}

interface BookingSourceRow {
  id: number;
  event_date: string;
  status: string;
  couple_display_name: string | null;
}

interface BlockedSourceRow {
  blocked_date: string;
  blocked_hours: string | null;
  reason: string | null;
}

interface TaskSourceRow {
  id: number;
  title: string;
  due_date: string | null;
  board_status: string;
}

/** Everything the vendor's Google calendar should contain, from the same four
 *  sources the in-app calendar draws (see VendorCalendarPage):
 *
 *   - confirmed bookings  -> all-day, OPAQUE. The date is genuinely taken.
 *   - pending inquiries   -> all-day, TRANSPARENT. A request is not a commitment,
 *                            so it must not make the vendor look busy to anyone
 *                            reading their free/busy.
 *   - blocked days        -> whole-day blocks are all-day OPAQUE; PARTIAL blocks
 *                            become a TIMED event over the blocked range, because
 *                            a partial block deliberately leaves the day bookable
 *                            in Weddly and an all-day event would misrepresent it.
 *   - task due dates      -> all-day, TRANSPARENT. A deadline is not busy time.
 *
 *  Statuses the in-app calendar hides (declined / cancelled / expired) are simply
 *  absent here, which the reconciler turns into a DELETE of any event previously
 *  pushed for them. */
export function buildVendorDesiredEvents(
  vendorAccountId: number,
  timeZone: string,
): DesiredCalendarEvent[] {
  const facts = vendorFacts(vendorAccountId);
  const t = labelsFor(facts?.locale ?? null);
  const out: DesiredCalendarEvent[] = [];

  const bookings = db
    .prepare(
      `SELECT b.id AS id, b.event_date AS event_date, b.status AS status,
              c.display_name AS couple_display_name
         FROM supplier_bookings b
         LEFT JOIN couples c ON c.id = b.couple_id
        WHERE b.vendor_account_id = ?
          AND b.status IN ('confirmed', 'requested', 'vendor_seen')`,
    )
    .all(vendorAccountId) as BookingSourceRow[];

  for (const b of bookings) {
    if (!ISO_DATE.test(b.event_date)) continue;
    const who = (b.couple_display_name ?? "").trim();
    const confirmed = b.status === "confirmed";
    const body: GoogleEventBody = {
      summary: confirmed
        ? `💍 ${who || t.confirmed}`
        : `${t.inquiry}: ${who || t.confirmed}`.trim(),
      start: { date: b.event_date },
      end: { date: addDaysIso(b.event_date, 1) },
      transparency: confirmed ? "opaque" : "transparent",
    };
    const sourceKind = confirmed ? "booking" : "inquiry";
    out.push({ sourceKind, sourceId: String(b.id), hash: hashBody(body), body });
  }

  // `is_available = 0` only: a row with is_available = 1 is the OPPOSITE of a
  // block (an "exceptionally working" day), so pushing it as ⛔ would tell the
  // vendor's Google calendar the exact inverse of the truth.
  //
  // Note what is deliberately NOT pushed: days the vendor is unavailable purely
  // because of their weekly pattern. A vendor who only works weekends would
  // otherwise get four all-day "Unavailable" events every week, forever. The
  // pattern is a standing rule, not an event.
  const blocked = db
    .prepare(
      "SELECT blocked_date, blocked_hours, reason FROM vendor_unavailable_dates WHERE vendor_account_id = ? AND is_available = 0",
    )
    .all(vendorAccountId) as BlockedSourceRow[];

  for (const row of blocked) {
    if (!ISO_DATE.test(row.blocked_date)) continue;
    const hours = parseBlockedHours(row.blocked_hours);
    const reason = (row.reason ?? "").trim();
    const summary = `⛔ ${reason || t.blocked}`;
    // The editor only ever produces a contiguous range, so [min, max+1) is the
    // faithful reconstruction (24 = midnight).
    const body: GoogleEventBody =
      hours === null
        ? {
            summary,
            start: { date: row.blocked_date },
            end: { date: addDaysIso(row.blocked_date, 1) },
            transparency: "opaque",
          }
        : {
            summary,
            start: { dateTime: atHour(row.blocked_date, hours[0] as number), timeZone },
            end: {
              dateTime: atHour(row.blocked_date, (hours[hours.length - 1] as number) + 1),
              timeZone,
            },
            transparency: "opaque",
          };
    out.push({
      sourceKind: "blocked",
      sourceId: row.blocked_date,
      hash: hashBody(body),
      body,
    });
  }

  const tasks = db
    .prepare(
      "SELECT id, title, due_date, board_status FROM vendor_tasks WHERE vendor_account_id = ? AND due_date IS NOT NULL AND board_status != 'done'",
    )
    .all(vendorAccountId) as TaskSourceRow[];

  for (const task of tasks) {
    const due = task.due_date;
    if (!due || !ISO_DATE.test(due)) continue;
    const body: GoogleEventBody = {
      summary: `${t.task}: ${task.title}`,
      start: { date: due },
      end: { date: addDaysIso(due, 1) },
      transparency: "transparent",
    };
    out.push({ sourceKind: "task", sourceId: String(task.id), hash: hashBody(body), body });
  }

  return out;
}

/** `YYYY-MM-DDTHH:00:00` local, to pair with an explicit timeZone. Hour 24 rolls
 *  into midnight of the next day. */
function atHour(iso: string, hour: number): string {
  const dayOffset = Math.floor(hour / 24);
  const h = hour % 24;
  const date = dayOffset > 0 ? addDaysIso(iso, dayOffset) : iso;
  return `${date}T${String(h).padStart(2, "0")}:00:00`;
}

// ─── Token freshness ─────────────────────────────────────────────────────────

async function ensureFreshAccessToken(conn: VendorGoogleCalendarConnectionRow): Promise<string> {
  const nowMs = now();
  const current = decryptToken(conn.access_token_enc);
  // 60s skew buffer so a token that expires mid-request is refreshed first.
  if (current && conn.token_expiry && conn.token_expiry - 60_000 > nowMs) return current;

  const refresh = decryptToken(conn.refresh_token_enc);
  if (!refresh) {
    if (current) return current;
    throw new Error("vendor google calendar connection has no usable token");
  }
  const t = await refreshAccessToken(refresh);
  db.prepare(
    "UPDATE vendor_google_calendar_connections SET access_token_enc = ?, token_expiry = ?, updated_at = ? WHERE vendor_account_id = ?",
  ).run(encryptToken(t.accessToken), nowMs + t.expiresInSec * 1000, nowMs, conn.vendor_account_id);
  return t.accessToken;
}

/** The calendar is an extension of the availability calendar, which is a PRO
 *  feature — so syncing follows the same entitlement. */
export function vendorCalendarSyncEntitled(vendorAccountId: number): boolean {
  return isVendorFeatureEnabled(vendorPlanForAccount(vendorAccountId), "calendar_availability");
}

// ─── Reconcile ───────────────────────────────────────────────────────────────

/** Idempotent one-way reconcile of a vendor's Google calendar. Creates the
 *  dedicated calendar on first run, then defers the diff to the shared
 *  reconciler. On any Google failure it records `last_error` and LEAVES the row
 *  dirty so the worker retries; it never throws. */
export async function syncVendorCalendar(vendorAccountId: number): Promise<void> {
  const conn = getVendorConnectionRow(vendorAccountId);
  if (!conn) return;

  // A lapsed vendor keeps the connection and the Google calendar (data is never
  // destroyed on downgrade — same principle as the couple read-only gate), but
  // stops receiving updates. Parked as idle rather than left dirty so the worker
  // doesn't spin on it every 30s; any later mutation, or "Sync now" after an
  // upgrade, re-dirties it.
  if (!vendorCalendarSyncEntitled(vendorAccountId)) {
    db.prepare(
      "UPDATE vendor_google_calendar_connections SET sync_state = 'idle', last_error = ?, updated_at = ? WHERE vendor_account_id = ?",
    ).run("pro_required", now(), vendorAccountId);
    return;
  }

  try {
    const accessToken = await ensureFreshAccessToken(conn);

    let calendarId = conn.calendar_id;
    if (!calendarId) {
      const facts = vendorFacts(vendorAccountId);
      const summary = facts?.display_name ? `Weddly – ${facts.display_name}` : "Weddly";
      calendarId = await createCalendar(accessToken, summary, conn.time_zone);
      db.prepare(
        "UPDATE vendor_google_calendar_connections SET calendar_id = ?, updated_at = ? WHERE vendor_account_id = ?",
      ).run(calendarId, now(), vendorAccountId);
    }

    await reconcileCalendarEvents({
      accessToken,
      calendarId,
      desired: buildVendorDesiredEvents(vendorAccountId, conn.time_zone),
      store: eventStore(vendorAccountId),
    });

    db.prepare(
      "UPDATE vendor_google_calendar_connections SET sync_state = 'idle', last_synced_at = ?, last_error = NULL, updated_at = ? WHERE vendor_account_id = ?",
    ).run(now(), now(), vendorAccountId);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
    db.prepare(
      "UPDATE vendor_google_calendar_connections SET last_error = ?, updated_at = ? WHERE vendor_account_id = ?",
    ).run(msg, now(), vendorAccountId);
    log.error("gcal.vendor_sync_failed", { vendorAccountId, err: msg });
  }
}

// ─── Pull direction: the vendor's own calendars, free/busy only ──────────────

/** How far ahead the pull looks. A YEAR, deliberately: this is a wedding
 *  calendar, couples book 12 to 18 months out, and `nextAvailableDate` scans 365
 *  days. A shorter horizon would leave exactly the dates couples are asking
 *  about unchecked while looking like it worked. */
const BUSY_HORIZON_DAYS = 365;
/** Google answers free/busy per window; 90-day chunks keep every request small
 *  and well inside the documented limits. Five calls per pull. */
const BUSY_CHUNK_DAYS = 90;

/** Which calendars the pull reads. Ours is ALWAYS excluded: it holds what we
 *  pushed, so reading it back would turn every booking into external busy on its
 *  own date. An unchosen selection means the primary calendar only. */
export function pullCalendarIds(conn: VendorGoogleCalendarConnectionRow): string[] {
  let ids: string[] = [];
  if (conn.selected_calendar_ids) {
    try {
      const parsed = JSON.parse(conn.selected_calendar_ids);
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      ids = [];
    }
  }
  if (ids.length === 0) ids = ["primary"];
  return ids.filter((id) => id !== conn.calendar_id);
}

/** The vendor's Google calendars, for the picker. Ours is filtered out: it is
 *  Weddly's own output, not something the vendor should be asked about. */
export async function listVendorGoogleCalendars(
  vendorAccountId: number,
): Promise<GoogleCalendarListEntry[]> {
  const conn = getVendorConnectionRow(vendorAccountId);
  if (!conn) return [];
  const accessToken = await ensureFreshAccessToken(conn);
  const all = await listCalendars(accessToken);
  return all.filter((c) => c.id !== conn.calendar_id);
}

/** Persist the vendor's picker choices. Storing the ids rather than a per-row
 *  join keeps this a settings field: a calendar the vendor loses access to just
 *  stops answering free/busy (the lib drops it), no dangling row to clean up. */
export function setVendorPullSelection(
  vendorAccountId: number,
  input: { calendarIds: readonly string[]; pullEnabled: boolean },
): void {
  const ids = [...new Set(input.calendarIds.filter((id) => typeof id === "string" && id !== ""))];
  db.prepare(
    `UPDATE vendor_google_calendar_connections
        SET selected_calendar_ids = ?, pull_enabled = ?, updated_at = ?
      WHERE vendor_account_id = ?`,
  ).run(
    ids.length > 0 ? JSON.stringify(ids) : null,
    input.pullEnabled ? 1 : 0,
    now(),
    vendorAccountId,
  );
}

/** Pull free/busy for the selected calendars and replace the vendor's external
 *  busy set. Never throws: like the push, a Google failure is recorded on the
 *  connection and retried on the next pass, because a half-applied pull would be
 *  worse than a stale one.
 *
 *  Switching the pull off CLEARS what was pulled. Stale busy from a calendar
 *  Weddly no longer reads would go on blocking dates with nothing in the UI to
 *  explain it. */
export async function syncVendorExternalBusy(vendorAccountId: number): Promise<void> {
  const conn = getVendorConnectionRow(vendorAccountId);
  if (!conn) return;

  if (conn.pull_enabled !== 1) {
    clearVendorExternalBusy(vendorAccountId);
    db.prepare(
      "UPDATE vendor_google_calendar_connections SET busy_synced_at = ?, updated_at = ? WHERE vendor_account_id = ?",
    ).run(now(), now(), vendorAccountId);
    return;
  }
  // Same entitlement as the push half: this feeds the availability calendar.
  if (!vendorCalendarSyncEntitled(vendorAccountId)) return;

  try {
    const accessToken = await ensureFreshAccessToken(conn);
    const calendarIds = pullCalendarIds(conn);
    const rows: ExternalBusyRow[] = [];
    const startMs = now();
    for (let offset = 0; offset < BUSY_HORIZON_DAYS; offset += BUSY_CHUNK_DAYS) {
      const from = startMs + offset * 86_400_000;
      const to = Math.min(
        startMs + (offset + BUSY_CHUNK_DAYS) * 86_400_000,
        startMs + BUSY_HORIZON_DAYS * 86_400_000,
      );
      const result = await queryFreeBusy(accessToken, {
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        calendarIds,
      });
      for (const ranges of Object.values(result)) {
        for (const r of ranges) {
          rows.push(...splitBusyRange(Date.parse(r.start), Date.parse(r.end), conn.time_zone));
        }
      }
    }
    replaceVendorExternalBusy(vendorAccountId, rows);
    db.prepare(
      "UPDATE vendor_google_calendar_connections SET busy_synced_at = ?, last_error = NULL, updated_at = ? WHERE vendor_account_id = ?",
    ).run(now(), now(), vendorAccountId);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
    db.prepare(
      "UPDATE vendor_google_calendar_connections SET last_error = ?, updated_at = ? WHERE vendor_account_id = ?",
    ).run(msg, now(), vendorAccountId);
    log.error("gcal.vendor_busy_pull_failed", { vendorAccountId, err: msg });
  }
}

/** Connections whose pulled busy set is older than `maxAgeMs` — the pull
 *  worker's queue. Unlike the push queue this is time-based, not dirty-flag
 *  based: nothing in Weddly knows when the vendor edits their Google calendar. */
export function listVendorAccountIdsNeedingBusyPull(maxAgeMs: number): number[] {
  const cutoff = now() - maxAgeMs;
  const rows = db
    .prepare(
      `SELECT vendor_account_id FROM vendor_google_calendar_connections
        WHERE pull_enabled = 1 AND (busy_synced_at IS NULL OR busy_synced_at < ?)`,
    )
    .all(cutoff) as { vendor_account_id: number }[];
  return rows.map((r) => r.vendor_account_id);
}

/** Tear down a connection: best-effort delete the dedicated calendar + revoke
 *  the token, then drop the local rows. Safe to call when not connected. */
export async function disconnectVendorCalendar(vendorAccountId: number): Promise<void> {
  const conn = getVendorConnectionRow(vendorAccountId);
  if (!conn) return;
  try {
    if (conn.calendar_id) {
      const token = await ensureFreshAccessToken(conn).catch(() =>
        decryptToken(conn.access_token_enc),
      );
      if (token) await deleteCalendar(token, conn.calendar_id);
    }
  } catch (e) {
    log.warn("gcal.vendor_disconnect_delete_failed", { vendorAccountId, err: String(e) });
  }
  const refresh = decryptToken(conn.refresh_token_enc);
  if (refresh) await revokeToken(refresh);
  db.prepare("DELETE FROM vendor_google_calendar_event_map WHERE vendor_account_id = ?").run(
    vendorAccountId,
  );
  // The pulled busy set goes with the connection. Keeping it would leave dates
  // blocked by a calendar Weddly can no longer read, with nothing in the UI to
  // explain why.
  clearVendorExternalBusy(vendorAccountId);
  db.prepare("DELETE FROM vendor_google_calendar_connections WHERE vendor_account_id = ?").run(
    vendorAccountId,
  );
}

/** Calendar time zone for a vendor, from their account country. */
export function timeZoneForVendor(vendorAccountId: number): string {
  return countryToTimeZone(vendorFacts(vendorAccountId)?.country ?? null);
}
