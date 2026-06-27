// Lodgings the couple offers their guests. Couple-scoped CRUD; assignment
// happens via guests.accommodation_id (see guests.ts patch path). Schema
// mirrors `shared/types.ts → Accommodation`.

import type {
  Accommodation,
  AccommodationRoom,
  UpsertAccommodationInput,
  UpsertAccommodationRoomInput,
} from "@shared/types";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

const MAX_NAME_LEN = 120;
const MAX_ADDRESS_LEN = 500;
const MAX_LINK_LEN = 500;
const MAX_CONTACT_LEN = 200;
const MAX_NOTES_LEN = 2000;
const MAX_CAPACITY = 100;
const MAX_PRICE_HUF = 100_000_000;

export interface AccommodationRow {
  id: number;
  couple_id: number;
  name: string;
  address: string | null;
  capacity: number;
  price_huf: number | null;
  link: string | null;
  contact: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function toAccommodation(row: AccommodationRow): Accommodation {
  return {
    id: row.id,
    couple_id: row.couple_id,
    name: row.name,
    address: row.address,
    capacity: row.capacity,
    price_huf: row.price_huf,
    link: row.link,
    contact: row.contact,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "name required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "name required");
  if (trimmed.length > MAX_NAME_LEN) {
    throw new HttpError(400, `name too long (max ${MAX_NAME_LEN} chars)`);
  }
  return trimmed;
}

function parseOptionalString(raw: unknown, max: number, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `${field} too long (max ${max} chars)`);
  return trimmed;
}

/** Optional URL field: same length/empty rules as parseOptionalString, but
 *  also enforces an http(s) scheme and stores the normalized href. Without
 *  the scheme guard a `javascript:` value would render as a live href in the
 *  workspace (LogisticsPage anchors it directly). */
function parseOptionalUrl(raw: unknown, max: number, field: string): string | null {
  const trimmed = parseOptionalString(raw, max, field);
  if (trimmed === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, `${field} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${field} must be http(s)`);
  }
  return parsed.href;
}

function parseCapacity(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
    throw new HttpError(400, `capacity must be 1..${MAX_CAPACITY}`);
  }
  return n;
}

function parsePriceHuf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_HUF) {
    throw new HttpError(400, "price_huf out of range");
  }
  return Math.round(n);
}

export interface ParsedAccommodation {
  name: string;
  address: string | null;
  capacity: number;
  price_huf: number | null;
  link: string | null;
  contact: string | null;
  notes: string | null;
}

export function parseAccommodationCreate(
  body: Partial<UpsertAccommodationInput>,
): ParsedAccommodation {
  return {
    name: parseName(body.name),
    address: parseOptionalString(body.address, MAX_ADDRESS_LEN, "address"),
    capacity: parseCapacity(body.capacity, 2),
    price_huf: parsePriceHuf(body.price_huf),
    link: parseOptionalUrl(body.link, MAX_LINK_LEN, "link"),
    contact: parseOptionalString(body.contact, MAX_CONTACT_LEN, "contact"),
    notes: parseOptionalString(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

export function parseAccommodationPatch(
  body: Partial<UpsertAccommodationInput>,
  existing: AccommodationRow,
): ParsedAccommodation {
  return {
    name: body.name === undefined ? existing.name : parseName(body.name),
    address:
      body.address === undefined
        ? existing.address
        : parseOptionalString(body.address, MAX_ADDRESS_LEN, "address"),
    capacity: parseCapacity(body.capacity, existing.capacity),
    price_huf: body.price_huf === undefined ? existing.price_huf : parsePriceHuf(body.price_huf),
    link:
      body.link === undefined ? existing.link : parseOptionalUrl(body.link, MAX_LINK_LEN, "link"),
    contact:
      body.contact === undefined
        ? existing.contact
        : parseOptionalString(body.contact, MAX_CONTACT_LEN, "contact"),
    notes:
      body.notes === undefined
        ? existing.notes
        : parseOptionalString(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

export function listAccommodations(coupleId: number): Accommodation[] {
  const rows = db
    .prepare("SELECT * FROM accommodations WHERE couple_id = ? ORDER BY created_at ASC, id ASC")
    .all(coupleId) as AccommodationRow[];
  return rows.map(toAccommodation);
}

export function getAccommodationScoped(id: number, coupleId: number): AccommodationRow | null {
  return (
    (db.prepare("SELECT * FROM accommodations WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | AccommodationRow
      | undefined) ?? null
  );
}

export function insertAccommodation(
  coupleId: number,
  parsed: ParsedAccommodation,
): AccommodationRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO accommodations
         (couple_id, name, address, capacity, price_huf, link, contact, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.name,
      parsed.address,
      parsed.capacity,
      parsed.price_huf,
      parsed.link,
      parsed.contact,
      parsed.notes,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM accommodations WHERE id = ?").get(id) as AccommodationRow;
}

export function updateAccommodation(
  id: number,
  coupleId: number,
  parsed: ParsedAccommodation,
): AccommodationRow {
  const ts = now();
  db.prepare(
    `UPDATE accommodations SET
       name = ?, address = ?, capacity = ?, price_huf = ?, link = ?, contact = ?,
       notes = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.name,
    parsed.address,
    parsed.capacity,
    parsed.price_huf,
    parsed.link,
    parsed.contact,
    parsed.notes,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM accommodations WHERE id = ?").get(id) as AccommodationRow;
}

export function deleteAccommodation(id: number, coupleId: number): boolean {
  // ON DELETE SET NULL on guests.accommodation_id keeps the guest rows intact;
  // the FK on guests.accommodation_room_id does the same as rooms cascade-delete.
  const result = db
    .prepare("DELETE FROM accommodations WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}

// ── Rooms ─────────────────────────────────────────────────────────────────
// Optional subdivision of an accommodation. When an accommodation has rooms,
// guests are placed into a specific room and the cap is enforced per room.

export interface AccommodationRoomRow {
  id: number;
  couple_id: number;
  accommodation_id: number;
  name: string;
  capacity: number;
  created_at: number;
  updated_at: number;
}

export function toAccommodationRoom(row: AccommodationRoomRow): AccommodationRoom {
  return {
    id: row.id,
    couple_id: row.couple_id,
    accommodation_id: row.accommodation_id,
    name: row.name,
    capacity: row.capacity,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ParsedRoom {
  name: string;
  capacity: number;
}

export function parseRoomCreate(body: Partial<UpsertAccommodationRoomInput>): ParsedRoom {
  return { name: parseName(body.name), capacity: parseCapacity(body.capacity, 2) };
}

export function parseRoomPatch(
  body: Partial<UpsertAccommodationRoomInput>,
  existing: AccommodationRoomRow,
): ParsedRoom {
  return {
    name: body.name === undefined ? existing.name : parseName(body.name),
    capacity: parseCapacity(body.capacity, existing.capacity),
  };
}

/** All rooms across the couple's accommodations — the LogisticsPage fetches
 *  these once and groups them client-side by accommodation_id. */
export function listRoomsForCouple(coupleId: number): AccommodationRoom[] {
  const rows = db
    .prepare(
      "SELECT * FROM accommodation_rooms WHERE couple_id = ? ORDER BY accommodation_id ASC, created_at ASC, id ASC",
    )
    .all(coupleId) as AccommodationRoomRow[];
  return rows.map(toAccommodationRoom);
}

export function getRoomScoped(id: number, coupleId: number): AccommodationRoomRow | null {
  return (
    (db
      .prepare("SELECT * FROM accommodation_rooms WHERE id = ? AND couple_id = ?")
      .get(id, coupleId) as AccommodationRoomRow | undefined) ?? null
  );
}

export function insertRoom(
  coupleId: number,
  accommodationId: number,
  parsed: ParsedRoom,
): AccommodationRoomRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO accommodation_rooms
         (couple_id, accommodation_id, name, capacity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(coupleId, accommodationId, parsed.name, parsed.capacity, ts, ts);
  const id = Number(result.lastInsertRowid);
  return db
    .prepare("SELECT * FROM accommodation_rooms WHERE id = ?")
    .get(id) as AccommodationRoomRow;
}

export function updateRoom(id: number, coupleId: number, parsed: ParsedRoom): AccommodationRoomRow {
  db.prepare(
    "UPDATE accommodation_rooms SET name = ?, capacity = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(parsed.name, parsed.capacity, now(), id, coupleId);
  return db
    .prepare("SELECT * FROM accommodation_rooms WHERE id = ?")
    .get(id) as AccommodationRoomRow;
}

export function deleteRoom(id: number, coupleId: number): boolean {
  // Clear both assignment columns for guests in this room before dropping it.
  // The FK only nulls accommodation_room_id; accommodation_id would otherwise
  // be left dangling on a now-roomless guest.
  db.prepare(
    "UPDATE guests SET accommodation_id = NULL, accommodation_room_id = NULL, updated_at = ? WHERE accommodation_room_id = ? AND couple_id = ?",
  ).run(now(), id, coupleId);
  const result = db
    .prepare("DELETE FROM accommodation_rooms WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}
