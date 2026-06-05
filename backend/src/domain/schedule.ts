// Day-of run-of-show CRUD helpers. All queries take a coupleId so the caller
// is responsible for scoping to the authenticated couple via getCoupleForUser.

import type { ScheduleEvent, UpsertScheduleEventInput } from "@shared/schedule";
import {
  SCHEDULE_MAX_DURATION,
  SCHEDULE_MAX_LABEL_LEN,
  SCHEDULE_MAX_LOCATION_LEN,
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_MAX_NOTES_LEN,
  SCHEDULE_MAX_RESPONSIBLE_LEN,
  SCHEDULE_MAX_SUPPLIER_ID_LEN,
  SCHEDULE_MIN_DURATION,
} from "@shared/schedule";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

export interface ScheduleEventRow {
  id: number;
  couple_id: number;
  label: string;
  starts_at_minutes: number;
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
  responsible: string | null;
  couple_supplier_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export function toScheduleEvent(row: ScheduleEventRow): ScheduleEvent {
  return {
    id: row.id,
    couple_id: row.couple_id,
    label: row.label,
    starts_at_minutes: row.starts_at_minutes,
    duration_minutes: row.duration_minutes,
    location: row.location,
    notes: row.notes,
    responsible: row.responsible,
    couple_supplier_id: row.couple_supplier_id,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Strict-ish runtime validation. Returns the normalised values; throws
 *  HttpError(400) on any violation so the route layer can let it bubble. */
export interface ParsedScheduleEvent {
  label: string;
  starts_at_minutes: number;
  duration_minutes: number | null;
  location: string | null;
  notes: string | null;
  responsible: string | null;
  couple_supplier_id: string | null;
  sort_order: number;
}

function parseLabel(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "label required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "label required");
  if (trimmed.length > SCHEDULE_MAX_LABEL_LEN) {
    throw new HttpError(400, `label too long (max ${SCHEDULE_MAX_LABEL_LEN} chars)`);
  }
  return trimmed;
}

function parseStartsAt(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > SCHEDULE_MAX_MINUTES) {
    throw new HttpError(400, `starts_at_minutes must be an integer 0..${SCHEDULE_MAX_MINUTES}`);
  }
  return n;
}

function parseDuration(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < SCHEDULE_MIN_DURATION || n > SCHEDULE_MAX_DURATION) {
    throw new HttpError(
      400,
      `duration_minutes must be an integer ${SCHEDULE_MIN_DURATION}..${SCHEDULE_MAX_DURATION}`,
    );
  }
  return n;
}

function parseOptionalString(raw: unknown, max: number, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `${field} too long (max ${max} chars)`);
  return trimmed;
}

function parseSortOrder(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < -1_000_000 || n > 1_000_000) {
    throw new HttpError(400, "sort_order out of range");
  }
  return n;
}

/** Full parse for POST. Every required field must be present. */
export function parseUpsertCreate(body: Partial<UpsertScheduleEventInput>): ParsedScheduleEvent {
  return {
    label: parseLabel(body.label),
    starts_at_minutes: parseStartsAt(body.starts_at_minutes),
    duration_minutes: parseDuration(body.duration_minutes),
    location: parseOptionalString(body.location, SCHEDULE_MAX_LOCATION_LEN, "location"),
    notes: parseOptionalString(body.notes, SCHEDULE_MAX_NOTES_LEN, "notes"),
    responsible: parseOptionalString(body.responsible, SCHEDULE_MAX_RESPONSIBLE_LEN, "responsible"),
    couple_supplier_id: parseOptionalString(
      body.couple_supplier_id,
      SCHEDULE_MAX_SUPPLIER_ID_LEN,
      "couple_supplier_id",
    ),
    sort_order: parseSortOrder(body.sort_order, 0),
  };
}

/** Partial parse for PATCH — every missing field defaults to the existing
 *  row's value so the client can change just one field. */
export function parseUpsertPatch(
  body: Partial<UpsertScheduleEventInput>,
  existing: ScheduleEventRow,
): ParsedScheduleEvent {
  return {
    label: body.label === undefined ? existing.label : parseLabel(body.label),
    starts_at_minutes:
      body.starts_at_minutes === undefined
        ? existing.starts_at_minutes
        : parseStartsAt(body.starts_at_minutes),
    duration_minutes:
      body.duration_minutes === undefined
        ? existing.duration_minutes
        : parseDuration(body.duration_minutes),
    location:
      body.location === undefined
        ? existing.location
        : parseOptionalString(body.location, SCHEDULE_MAX_LOCATION_LEN, "location"),
    notes:
      body.notes === undefined
        ? existing.notes
        : parseOptionalString(body.notes, SCHEDULE_MAX_NOTES_LEN, "notes"),
    responsible:
      body.responsible === undefined
        ? existing.responsible
        : parseOptionalString(body.responsible, SCHEDULE_MAX_RESPONSIBLE_LEN, "responsible"),
    couple_supplier_id:
      body.couple_supplier_id === undefined
        ? existing.couple_supplier_id
        : parseOptionalString(
            body.couple_supplier_id,
            SCHEDULE_MAX_SUPPLIER_ID_LEN,
            "couple_supplier_id",
          ),
    sort_order: parseSortOrder(body.sort_order, existing.sort_order),
  };
}

export function listScheduleEvents(coupleId: number): ScheduleEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM schedule_events
         WHERE couple_id = ?
         ORDER BY starts_at_minutes ASC, sort_order ASC, id ASC`,
    )
    .all(coupleId) as ScheduleEventRow[];
  return rows.map(toScheduleEvent);
}

export function getScheduleEventScoped(id: number, coupleId: number): ScheduleEventRow | null {
  return (
    (db.prepare("SELECT * FROM schedule_events WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | ScheduleEventRow
      | undefined) ?? null
  );
}

export function insertScheduleEvent(
  coupleId: number,
  parsed: ParsedScheduleEvent,
): ScheduleEventRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO schedule_events
         (couple_id, label, starts_at_minutes, duration_minutes, location, notes,
          responsible, couple_supplier_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.label,
      parsed.starts_at_minutes,
      parsed.duration_minutes,
      parsed.location,
      parsed.notes,
      parsed.responsible,
      parsed.couple_supplier_id,
      parsed.sort_order,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM schedule_events WHERE id = ?").get(id) as ScheduleEventRow;
}

export function updateScheduleEvent(
  id: number,
  coupleId: number,
  parsed: ParsedScheduleEvent,
): ScheduleEventRow {
  const ts = now();
  db.prepare(
    `UPDATE schedule_events SET
       label = ?, starts_at_minutes = ?, duration_minutes = ?, location = ?,
       notes = ?, responsible = ?, couple_supplier_id = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.label,
    parsed.starts_at_minutes,
    parsed.duration_minutes,
    parsed.location,
    parsed.notes,
    parsed.responsible,
    parsed.couple_supplier_id,
    parsed.sort_order,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM schedule_events WHERE id = ?").get(id) as ScheduleEventRow;
}

export function deleteScheduleEvent(id: number, coupleId: number): boolean {
  const result = db
    .prepare("DELETE FROM schedule_events WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}
