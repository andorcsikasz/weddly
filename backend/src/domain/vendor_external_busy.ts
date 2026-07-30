// Busy time pulled OUT of a vendor's own Google calendars: storage, and the
// question every availability read asks of it ("does this date still have
// workable time left?").
//
// Deliberately a LEAF module: db + shared only, no Google imports. The syncing
// half lives in domain/vendor_google_calendar.ts, which already owns the tokens
// and the connection row. Inverted that way because `domain/vendor_clients.ts`
// imports supplier_bookings, so a Google import here would close an import cycle
// the moment supplier_bookings started reading external busy.
//
// What lands here is only ever a date and a minute range (see the table comment
// in schema.sql): free/busy is the only Google endpoint involved, so there is no
// title or attendee to leak, in the app or in a log line.

import {
  DAY_MINUTES,
  externalBusyVerdict,
  isoWeekday,
  normalizeIntervals,
  type WeeklyHours,
  type WorkInterval,
} from "@shared/vendor_availability";
import { db, now } from "../db";

export interface ExternalBusyRow {
  busy_date: string;
  start_min: number;
  end_min: number;
}

/** Local wall-clock date + minutes for an instant, in an IANA zone. Uses the
 *  platform's own tz database via Intl rather than a fixed offset, so a busy
 *  block that straddles a DST change lands on the dates the vendor sees. */
export function zonedParts(ms: number, timeZone: string): { date: string; min: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    min: Number(pick("hour")) * 60 + Number(pick("minute")),
  };
}

function nextIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Split one busy instant-range into per-local-date minute ranges. A multi-day
 *  block becomes one row per date it touches; a range ending exactly at local
 *  midnight contributes nothing to the following date, which is what keeps an
 *  ordinary all-day event from bleeding into the morning after. */
export function splitBusyRange(
  startMs: number,
  endMs: number,
  timeZone: string,
  maxDays = 400,
): ExternalBusyRow[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const from = zonedParts(startMs, timeZone);
  const to = zonedParts(endMs, timeZone);
  if (from.date === to.date) {
    return to.min > from.min
      ? [{ busy_date: from.date, start_min: from.min, end_min: to.min }]
      : [];
  }
  const out: ExternalBusyRow[] = [
    { busy_date: from.date, start_min: from.min, end_min: DAY_MINUTES },
  ];
  let cursor = nextIsoDate(from.date);
  let guard = 0;
  while (cursor < to.date && guard < maxDays) {
    out.push({ busy_date: cursor, start_min: 0, end_min: DAY_MINUTES });
    cursor = nextIsoDate(cursor);
    guard += 1;
  }
  if (to.min > 0) out.push({ busy_date: to.date, start_min: 0, end_min: to.min });
  return out;
}

/** Days since the epoch for an ISO date, so a dated minute range can be treated
 *  as one number line and padded across midnight without timezone maths (we are
 *  already in the vendor's local calendar here). */
function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y as number, (m as number) - 1, d as number) / 86_400_000);
}

function isoFromDayIndex(index: number): string {
  const dt = new Date(index * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Pad every dated interval by the vendor's setup/teardown buffers, spilling
 *  onto the neighbouring dates when it crosses midnight. This is the whole
 *  mechanism behind "a Saturday wedding takes Sunday morning with it": the
 *  padded ranges then go through the SAME verdict as everything else, so a
 *  2-hour teardown that lands before the vendor's next working day changes
 *  nothing, and a 12-hour one takes the morning. */
export function expandWithBuffer(
  rows: readonly ExternalBusyRow[],
  beforeMin: number,
  afterMin: number,
): ExternalBusyRow[] {
  if (beforeMin <= 0 && afterMin <= 0) return rows.map((r) => ({ ...r }));
  const out: ExternalBusyRow[] = [];
  for (const r of rows) {
    const base = dayIndex(r.busy_date) * DAY_MINUTES;
    let from = base + r.start_min - Math.max(0, beforeMin);
    const to = base + r.end_min + Math.max(0, afterMin);
    while (from < to) {
      const day = Math.floor(from / DAY_MINUTES);
      const dayEnd = (day + 1) * DAY_MINUTES;
      const chunkEnd = Math.min(to, dayEnd);
      out.push({
        busy_date: isoFromDayIndex(day),
        start_min: from - day * DAY_MINUTES,
        end_min: chunkEnd - day * DAY_MINUTES,
      });
      from = chunkEnd;
    }
  }
  return out;
}

/** Group dated rows into the per-date map every availability read consumes,
 *  merging overlaps so two padded events on one afternoon count once. */
export function groupBusyRows(rows: readonly ExternalBusyRow[]): Map<string, WorkInterval[]> {
  const out = new Map<string, WorkInterval[]>();
  for (const r of rows) {
    const list = out.get(r.busy_date) ?? [];
    list.push({ start_min: r.start_min, end_min: r.end_min });
    out.set(r.busy_date, list);
  }
  for (const [date, list] of out) out.set(date, normalizeIntervals(list));
  return out;
}

/** Replace the vendor's whole external-busy set. Wholesale rather than diffed
 *  because free/busy has no stable per-block identity to diff against: the same
 *  Google event moved by an hour is simply a different range, and a deleted one
 *  is an absence. Anything the new pull didn't report is therefore gone, which
 *  is exactly the behaviour a vendor expects after deleting an appointment. */
export function replaceVendorExternalBusy(vendorAccountId: number, rows: ExternalBusyRow[]): void {
  const ts = now();
  // Merge per date first: two calendars overlapping on the same afternoon must
  // not store two rows that later count as two blocks.
  const byDate = new Map<string, WorkInterval[]>();
  for (const r of rows) {
    const list = byDate.get(r.busy_date) ?? [];
    list.push({ start_min: r.start_min, end_min: r.end_min });
    byDate.set(r.busy_date, list);
  }

  const write = db.transaction(() => {
    db.prepare("DELETE FROM vendor_external_busy WHERE vendor_account_id = ?").run(vendorAccountId);
    const insert = db.prepare(
      `INSERT INTO vendor_external_busy (vendor_account_id, busy_date, start_min, end_min, synced_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [date, list] of byDate) {
      for (const iv of normalizeIntervals(list)) {
        insert.run(vendorAccountId, date, iv.start_min, iv.end_min, ts);
      }
    }
  });
  write();
}

/** Drop everything pulled for a vendor. Used when the vendor switches the pull
 *  off or disconnects: leaving stale busy behind would keep blocking dates from
 *  a calendar Weddly no longer reads. */
export function clearVendorExternalBusy(vendorAccountId: number): void {
  db.prepare("DELETE FROM vendor_external_busy WHERE vendor_account_id = ?").run(vendorAccountId);
}

/** Every pulled busy block, keyed by date. One query: callers scanning a year
 *  of dates (next-free) must not do 365 of them. */
export function listVendorExternalBusy(vendorAccountId: number): Map<string, WorkInterval[]> {
  const rows = db
    .prepare(
      `SELECT busy_date, start_min, end_min FROM vendor_external_busy
        WHERE vendor_account_id = ?
        ORDER BY busy_date ASC, start_min ASC`,
    )
    .all(vendorAccountId) as ExternalBusyRow[];
  const out = new Map<string, WorkInterval[]>();
  for (const r of rows) {
    const list = out.get(r.busy_date) ?? [];
    list.push({ start_min: r.start_min, end_min: r.end_min });
    out.set(r.busy_date, list);
  }
  return out;
}

export function countVendorExternalBusy(vendorAccountId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM vendor_external_busy WHERE vendor_account_id = ?")
    .get(vendorAccountId) as { c: number };
  return row.c;
}

/** The verdict for one date: how much of that weekday's working time the
 *  external calendar takes. This is the ONLY place the two layers meet, and the
 *  measurement is against WORKING HOURS rather than the day, which is what stops
 *  a one-hour appointment from taking a whole wedding date off the market. */
export function externalVerdictFor(input: {
  date: string;
  busy: Map<string, WorkInterval[]>;
  hours: WeeklyHours;
}): "none" | "partial" | "full" {
  const busy = input.busy.get(input.date);
  if (!busy || busy.length === 0) return "none";
  return externalBusyVerdict(busy, input.hours[isoWeekday(input.date)]);
}
