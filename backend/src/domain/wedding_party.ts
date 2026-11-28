// Wedding party: helpers and people with a job on the day (best man,
// bridesmaids, konferanszié, photographer...). Couple-scoped CRUD. A PATCH is
// partial: an absent key keeps the stored value, `null` clears it.
//
// A member can be linked to a guest (`guest_id`). Linked members take their
// name, email and phone from the guest at READ time (one-way: guest → party),
// so a guest correction shows up here without any write-through. The stored
// columns are the snapshot used once the link is gone.

import {
  WEDDING_PARTY_CEREMONIES,
  WEDDING_PARTY_ROLES,
  WEDDING_PARTY_STATUSES,
  type UpsertWeddingPartyInput,
  type WeddingPartyCeremony,
  type WeddingPartyMember,
  type WeddingPartyRole,
  type WeddingPartyStatus,
} from "@shared/types";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

const MAX_NAME_LEN = 120;
const MAX_ROLE_LABEL_LEN = 80;
const MAX_PHONE_LEN = 40;
const MAX_EMAIL_LEN = 200;
const MAX_NOTES_LEN = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The guest fields a linked member copies. Looked up scoped to the couple. */
export interface GuestLink {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export interface WeddingPartyRow {
  id: number;
  couple_id: number;
  guest_id: number | null;
  name: string;
  role: string;
  role_label: string | null;
  ceremony: string | null;
  status: string;
  status_at: number | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  /** From the LEFT JOIN on `guests`. Non-null exactly when the link resolves. */
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
}

export interface ParsedWeddingPartyMember {
  guest_id: number | null;
  name: string;
  role: WeddingPartyRole;
  role_label: string | null;
  ceremony: WeddingPartyCeremony | null;
  status: WeddingPartyStatus;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

/** Every member read goes through this join so the overlay is never skipped. */
const MEMBER_SELECT = `SELECT m.*, g.full_name AS guest_name, g.email AS guest_email,
    g.phone AS guest_phone
  FROM wedding_party_members m
  LEFT JOIN guests g ON g.id = m.guest_id AND g.couple_id = m.couple_id`;

export function toWeddingPartyMember(row: WeddingPartyRow): WeddingPartyMember {
  // A resolved guest wins over every stored copy. A null guest_name means the
  // link is gone (never set, or the guest was deleted), so the snapshot shows.
  const linked = row.guest_name !== null;
  return {
    id: row.id,
    couple_id: row.couple_id,
    guest_id: linked ? row.guest_id : null,
    name: row.guest_name ?? row.name,
    role: row.role as WeddingPartyRole,
    role_label: row.role_label,
    ceremony: row.ceremony as WeddingPartyCeremony | null,
    status: row.status as WeddingPartyStatus,
    status_at: row.status_at,
    phone: linked ? row.guest_phone : row.phone,
    email: linked ? row.guest_email : row.email,
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

function parseRole(raw: unknown): WeddingPartyRole {
  if (typeof raw !== "string" || !(WEDDING_PARTY_ROLES as readonly string[]).includes(raw)) {
    throw new HttpError(400, `role must be one of: ${WEDDING_PARTY_ROLES.join(", ")}`);
  }
  return raw as WeddingPartyRole;
}

function parseOptional(raw: unknown, max: number, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `${field} too long (max ${max} chars)`);
  return trimmed;
}

function parseEmail(raw: unknown): string | null {
  const value = parseOptional(raw, MAX_EMAIL_LEN, "email");
  if (value !== null && !EMAIL_RE.test(value)) throw new HttpError(400, "email looks invalid");
  return value;
}

function parseCeremony(raw: unknown): WeddingPartyCeremony | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !(WEDDING_PARTY_CEREMONIES as readonly string[]).includes(raw)) {
    throw new HttpError(400, `ceremony must be one of: ${WEDDING_PARTY_CEREMONIES.join(", ")}`);
  }
  return raw as WeddingPartyCeremony;
}

function parseStatus(raw: unknown): WeddingPartyStatus {
  if (typeof raw !== "string" || !(WEDDING_PARTY_STATUSES as readonly string[]).includes(raw)) {
    throw new HttpError(400, `status must be one of: ${WEDDING_PARTY_STATUSES.join(", ")}`);
  }
  return raw as WeddingPartyStatus;
}

/** `other` is the only role whose meaning lives in the label, so it must have one. */
function requireLabelForOther(role: WeddingPartyRole, label: string | null): string | null {
  if (role === "other" && !label) throw new HttpError(400, "role_label required for role 'other'");
  return role === "other" ? label : null;
}

function parseGuestId(raw: unknown): number {
  const id = Number(raw);
  if (typeof raw === "boolean" || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "guest_id must be a guest id or null");
  }
  return id;
}

/** Loads the guest a member is linked to. Couple-scoped, so another couple's
 *  guest id is refused the same way a missing one is. */
export function loadGuestLink(coupleId: number, guestId: number): GuestLink {
  const row = db
    .prepare("SELECT id, full_name, email, phone FROM guests WHERE id = ? AND couple_id = ?")
    .get(guestId, coupleId) as GuestLink | null | undefined;
  if (!row) throw new HttpError(400, "guest not found");
  return row;
}

/** Which guest, if any, a write leaves the member linked to. An absent key
 *  keeps the stored link; `null` unlinks. */
export function resolveGuestLinkForWrite(
  coupleId: number,
  raw: unknown,
  storedGuestId: number | null,
): GuestLink | null {
  const guestId = raw === undefined ? storedGuestId : raw === null ? null : parseGuestId(raw);
  return guestId === null ? null : loadGuestLink(coupleId, guestId);
}

export function parseWeddingPartyCreate(
  body: Partial<UpsertWeddingPartyInput>,
  link: GuestLink | null,
): ParsedWeddingPartyMember {
  const role = parseRole(body.role);
  const roleLabel = parseOptional(body.role_label, MAX_ROLE_LABEL_LEN, "role_label");
  return {
    guest_id: link?.id ?? null,
    name: link ? link.full_name : parseName(body.name),
    role,
    role_label: requireLabelForOther(role, roleLabel),
    ceremony: parseCeremony(body.ceremony),
    status: body.status === undefined ? "not_asked" : parseStatus(body.status),
    phone: link ? link.phone : parseOptional(body.phone, MAX_PHONE_LEN, "phone"),
    email: link ? link.email : parseEmail(body.email),
    notes: parseOptional(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

/** Partial merge: every key the body leaves out keeps the stored value. While
 *  the member is linked (`link` set), name/email/phone come from the guest and
 *  the body's copies are ignored, so an edit cannot fork from the guest list. */
export function parseWeddingPartyPatch(
  body: Partial<UpsertWeddingPartyInput>,
  existing: WeddingPartyRow,
  link: GuestLink | null,
): ParsedWeddingPartyMember {
  const role = body.role === undefined ? (existing.role as WeddingPartyRole) : parseRole(body.role);
  const roleLabel =
    body.role_label === undefined
      ? existing.role_label
      : parseOptional(body.role_label, MAX_ROLE_LABEL_LEN, "role_label");
  return {
    guest_id: link?.id ?? null,
    name: link ? link.full_name : body.name === undefined ? existing.name : parseName(body.name),
    role,
    role_label: requireLabelForOther(role, roleLabel),
    ceremony:
      body.ceremony === undefined
        ? (existing.ceremony as WeddingPartyCeremony | null)
        : parseCeremony(body.ceremony),
    status:
      body.status === undefined
        ? (existing.status as WeddingPartyStatus)
        : parseStatus(body.status),
    phone: link
      ? link.phone
      : body.phone === undefined
        ? existing.phone
        : parseOptional(body.phone, MAX_PHONE_LEN, "phone"),
    email: link ? link.email : body.email === undefined ? existing.email : parseEmail(body.email),
    notes:
      body.notes === undefined ? existing.notes : parseOptional(body.notes, MAX_NOTES_LEN, "notes"),
  };
}

export function listWeddingParty(coupleId: number): WeddingPartyMember[] {
  const rows = db
    .prepare(`${MEMBER_SELECT} WHERE m.couple_id = ? ORDER BY m.created_at ASC, m.id ASC`)
    .all(coupleId) as WeddingPartyRow[];
  return rows.map(toWeddingPartyMember);
}

function readMemberRow(id: number): WeddingPartyRow {
  return db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(id) as WeddingPartyRow;
}

export function getWeddingPartyScoped(id: number, coupleId: number): WeddingPartyRow | null {
  return (
    (db.prepare(`${MEMBER_SELECT} WHERE m.id = ? AND m.couple_id = ?`).get(id, coupleId) as
      | WeddingPartyRow
      | undefined) ?? null
  );
}

export function insertWeddingPartyMember(
  coupleId: number,
  parsed: ParsedWeddingPartyMember,
): WeddingPartyRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO wedding_party_members
         (couple_id, guest_id, name, role, role_label, ceremony, status, status_at, phone, email,
          notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.guest_id,
      parsed.name,
      parsed.role,
      parsed.role_label,
      parsed.ceremony,
      parsed.status,
      // A row born already "said yes" still records when that became true.
      parsed.status === "not_asked" ? null : ts,
      parsed.phone,
      parsed.email,
      parsed.notes,
      ts,
      ts,
    );
  return readMemberRow(Number(result.lastInsertRowid));
}

/** `status_at` moves only when the status actually changes, so a typo fix in the notes keeps the date. */
export function updateWeddingPartyMember(
  id: number,
  coupleId: number,
  existing: WeddingPartyRow,
  parsed: ParsedWeddingPartyMember,
): WeddingPartyRow {
  const ts = now();
  const statusAt = parsed.status === existing.status ? existing.status_at : ts;
  db.prepare(
    `UPDATE wedding_party_members SET
       guest_id = ?, name = ?, role = ?, role_label = ?, ceremony = ?, status = ?, status_at = ?,
       phone = ?, email = ?, notes = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.guest_id,
    parsed.name,
    parsed.role,
    parsed.role_label,
    parsed.ceremony,
    parsed.status,
    statusAt,
    parsed.phone,
    parsed.email,
    parsed.notes,
    ts,
    id,
    coupleId,
  );
  return readMemberRow(id);
}

export function deleteWeddingPartyMember(id: number, coupleId: number): boolean {
  const result = db
    .prepare("DELETE FROM wedding_party_members WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}
