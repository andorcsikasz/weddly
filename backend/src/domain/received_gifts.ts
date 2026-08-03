// Received-gifts ledger CRUD helpers. Couple-scoped, every query takes a
// coupleId and the route layer derives it from the session via
// getCoupleForUser, same contract as wishlist.ts / schedule.ts. Private,
// couple-only data: never surfaced on the guest page. No money moves.

import { type Currency, minorUnitFactor } from "@shared/currency";
import {
  RECEIVED_GIFT_CATEGORIES,
  RECEIVED_GIFT_MAX_NOTE_LEN,
  RECEIVED_GIFT_MAX_TITLE_LEN,
  type ReceivedGift,
  type ReceivedGiftCategory,
  type UpsertReceivedGiftInput,
} from "@shared/received_gifts";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

export interface ReceivedGiftRow {
  id: number;
  couple_id: number;
  household_id: number | null;
  guest_id: number | null;
  title: string;
  note: string | null;
  category: ReceivedGiftCategory;
  amount_minor: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export function toReceivedGift(row: ReceivedGiftRow): ReceivedGift {
  return {
    id: row.id,
    couple_id: row.couple_id,
    household_id: row.household_id,
    guest_id: row.guest_id,
    title: row.title,
    note: row.note,
    category: row.category ?? "gift",
    amount_minor: row.amount_minor,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Boundary validation (hand-written, no Zod). Mirrors wishlist.ts. ──────────

export interface ParsedReceivedGift {
  household_id: number | null;
  guest_id: number | null;
  title: string;
  note: string | null;
  category: ReceivedGiftCategory;
  amount_minor: number | null;
  sort_order: number;
}

/** Resolve a guest id, ensuring it belongs to THIS couple, a cross-couple id
 *  is rejected so the allocation can't leak another workspace's guest. Null /
 *  undefined / "" all mean "unallocated". */
function parseGuestId(raw: unknown, coupleId: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new HttpError(400, "guest_id must be a positive integer");
  const owned = db
    .prepare("SELECT 1 FROM guests WHERE id = ? AND couple_id = ? LIMIT 1")
    .get(n, coupleId) as { 1: number } | null;
  if (owned == null) throw new HttpError(400, "guest_id not in this couple's guest list");
  return n;
}

/** Same as parseGuestId, but scoped to the couple's households. */
function parseHouseholdId(raw: unknown, coupleId: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new HttpError(400, "household_id must be a positive integer");
  const owned = db
    .prepare("SELECT 1 FROM households WHERE id = ? AND couple_id = ? LIMIT 1")
    .get(n, coupleId) as { 1: number } | null;
  if (owned == null) throw new HttpError(400, "household_id not in this couple's households");
  return n;
}

/** Resolve the household/guest attribution. They are mutually exclusive: a
 *  gift comes from a whole household OR one named guest. Setting one explicitly
 *  (non-null) clears the other, so the auto-saving grid can swap between them by
 *  sending just the changed dimension; sending BOTH non-null is a client bug. */
function resolveAllocation(
  body: Partial<UpsertReceivedGiftInput>,
  existing: ReceivedGiftRow | null,
  coupleId: number,
): { household_id: number | null; guest_id: number | null } {
  const hExplicit = body.household_id !== undefined;
  const gExplicit = body.guest_id !== undefined;
  let household_id = hExplicit
    ? parseHouseholdId(body.household_id, coupleId)
    : (existing?.household_id ?? null);
  let guest_id = gExplicit ? parseGuestId(body.guest_id, coupleId) : (existing?.guest_id ?? null);
  // Setting one dimension clears the other ONLY when the other wasn't sent in
  // the same request, so a single-field PATCH swaps cleanly, but a request
  // that names both non-null is a real conflict (falls through to the 400).
  if (hExplicit && household_id !== null && !gExplicit) guest_id = null;
  if (gExplicit && guest_id !== null && !hExplicit) household_id = null;
  if (household_id !== null && guest_id !== null) {
    throw new HttpError(400, "attribute a gift to a household OR a guest, not both");
  }
  return { household_id, guest_id };
}

/** Gift name, optional here (a row may carry only a guest + note), capped. */
function parseTitle(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") throw new HttpError(400, "title must be a string");
  const trimmed = raw.trim();
  if (trimmed.length > RECEIVED_GIFT_MAX_TITLE_LEN) {
    throw new HttpError(400, `title too long (max ${RECEIVED_GIFT_MAX_TITLE_LEN} chars)`);
  }
  return trimmed;
}

function parseNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "note must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > RECEIVED_GIFT_MAX_NOTE_LEN) {
    throw new HttpError(400, `note too long (max ${RECEIVED_GIFT_MAX_NOTE_LEN} chars)`);
  }
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

function parseCategory(raw: unknown, fallback: ReceivedGiftCategory): ReceivedGiftCategory {
  if (raw === undefined || raw === null) return fallback;
  if (!RECEIVED_GIFT_CATEGORIES.includes(raw as ReceivedGiftCategory)) {
    throw new HttpError(400, `category must be one of: ${RECEIVED_GIFT_CATEGORIES.join(", ")}`);
  }
  return raw as ReceivedGiftCategory;
}

function parseAmountMinor(raw: unknown, category: ReceivedGiftCategory): number | null {
  if (category !== "money") return null;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) {
    throw new HttpError(400, "amount_minor must be a non-negative integer");
  }
  return n;
}

/** A row must carry at least one meaningful field, the grid only persists a
 *  row once it gains content, so an all-empty create is a client bug. */
function ensureNonEmpty(p: ParsedReceivedGift): void {
  if (p.household_id === null && p.guest_id === null && p.title === "" && p.note === null) {
    throw new HttpError(400, "received gift must have a household, a guest, a name, or a note");
  }
}

export function parseCreate(
  body: Partial<UpsertReceivedGiftInput>,
  coupleId: number,
): ParsedReceivedGift {
  const alloc = resolveAllocation(body, null, coupleId);
  const category = parseCategory(body.category, "gift");
  const parsed: ParsedReceivedGift = {
    household_id: alloc.household_id,
    guest_id: alloc.guest_id,
    title: parseTitle(body.title),
    note: parseNote(body.note),
    category,
    amount_minor: parseAmountMinor(body.amount_minor, category),
    sort_order: parseSortOrder(body.sort_order, 0),
  };
  ensureNonEmpty(parsed);
  return parsed;
}

/** Partial parse for PATCH, missing fields keep the existing row's value. */
export function parsePatch(
  body: Partial<UpsertReceivedGiftInput>,
  existing: ReceivedGiftRow,
  coupleId: number,
): ParsedReceivedGift {
  const alloc = resolveAllocation(body, existing, coupleId);
  const category = parseCategory(body.category, existing.category ?? "gift");
  return {
    household_id: alloc.household_id,
    guest_id: alloc.guest_id,
    title: body.title === undefined ? existing.title : parseTitle(body.title),
    note: body.note === undefined ? existing.note : parseNote(body.note),
    category,
    amount_minor:
      body.amount_minor === undefined
        ? category === "money"
          ? existing.amount_minor
          : null
        : parseAmountMinor(body.amount_minor, category),
    sort_order: parseSortOrder(body.sort_order, existing.sort_order),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listReceivedGifts(coupleId: number): ReceivedGift[] {
  const rows = db
    .prepare(
      `SELECT * FROM received_gifts
         WHERE couple_id = ?
         ORDER BY sort_order ASC, id ASC`,
    )
    .all(coupleId) as ReceivedGiftRow[];
  return rows.map(toReceivedGift);
}

export function getReceivedGiftScoped(id: number, coupleId: number): ReceivedGiftRow | null {
  return (
    (db.prepare("SELECT * FROM received_gifts WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | ReceivedGiftRow
      | undefined) ?? null
  );
}

export function insertReceivedGift(coupleId: number, parsed: ParsedReceivedGift): ReceivedGiftRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO received_gifts (couple_id, household_id, guest_id, title, note, category, amount_minor, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.household_id,
      parsed.guest_id,
      parsed.title,
      parsed.note,
      parsed.category,
      parsed.amount_minor,
      parsed.sort_order,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM received_gifts WHERE id = ?").get(id) as ReceivedGiftRow;
}

export function updateReceivedGift(
  id: number,
  coupleId: number,
  parsed: ParsedReceivedGift,
): ReceivedGiftRow {
  const ts = now();
  db.prepare(
    `UPDATE received_gifts SET household_id = ?, guest_id = ?, title = ?, note = ?, category = ?, amount_minor = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.household_id,
    parsed.guest_id,
    parsed.title,
    parsed.note,
    parsed.category,
    parsed.amount_minor,
    parsed.sort_order,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM received_gifts WHERE id = ?").get(id) as ReceivedGiftRow;
}

export function deleteReceivedGift(id: number, coupleId: number): boolean {
  const result = db
    .prepare("DELETE FROM received_gifts WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}

// ── Carry-over from the budget page's old money-in ledger ────────────────────

/** Move every `couple_income` row into this ledger as a `money` gift.
 *
 *  The budget page used to keep its OWN money-in table, so a couple who logged
 *  a cash gift on the wishlist saw the budget's "Összesen befolyt" report 0,
 *  and vice versa: two grids, two tables, and two headline numbers that
 *  contradicted each other. This ledger is the single source of truth now, and
 *  the budget renders a read-only rollup of it, so the old rows have to arrive
 *  here or the couple's money silently disappears from the page that reports it.
 *
 *  Idempotent via the UNIQUE `income_id` index, so it is safe on every boot:
 *  a row already carried over loses the INSERT race to the index and is skipped.
 *  Nothing is deleted — `couple_income` keeps its rows as the audit trail, and
 *  the route stays mounted so a client mid-deploy can still read them.
 *
 *  The unit conversion is the part worth being careful about: `amount_huf` is
 *  WHOLE units of the couple's currency, `amount_minor` is minor units, so a
 *  straight copy is correct in HUF and inflates every EUR figure 100x. */
export function backfillIncomeIntoReceivedGifts(): { carried: number } {
  const rows = db
    .prepare(
      `SELECT i.id, i.couple_id, i.label, i.amount_huf, i.notes, i.created_at, i.updated_at,
              c.currency AS currency
         FROM couple_income i
         JOIN couples c ON c.id = i.couple_id
        WHERE NOT EXISTS (SELECT 1 FROM received_gifts g WHERE g.income_id = i.id)
        ORDER BY i.couple_id ASC, i.id ASC`,
    )
    .all() as {
    id: number;
    couple_id: number;
    label: string;
    amount_huf: number;
    notes: string | null;
    created_at: number;
    updated_at: number;
    currency: Currency;
  }[];
  if (rows.length === 0) return { carried: 0 };

  // Append after whatever the couple already has, so the carried rows land at
  // the bottom of the grid instead of interleaving with their own entries.
  const maxSort = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM received_gifts WHERE couple_id = ?",
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO received_gifts
       (couple_id, household_id, guest_id, title, note, category, amount_minor, sort_order, income_id, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, ?, 'money', ?, ?, ?, ?, ?)`,
  );

  let carried = 0;
  const nextSort = new Map<number, number>();
  const run = db.transaction(() => {
    for (const r of rows) {
      let sort = nextSort.get(r.couple_id);
      if (sort === undefined) {
        sort = Number((maxSort.get(r.couple_id) as { m: number }).m) + 1;
      }
      const result = insert.run(
        r.couple_id,
        r.label.slice(0, RECEIVED_GIFT_MAX_TITLE_LEN),
        r.notes ? r.notes.slice(0, RECEIVED_GIFT_MAX_NOTE_LEN) : null,
        Math.round(r.amount_huf * minorUnitFactor(r.currency)),
        sort,
        r.id,
        r.created_at,
        r.updated_at,
      );
      if (result.changes > 0) carried += 1;
      nextSort.set(r.couple_id, sort + 1);
    }
  });
  run();
  return { carried };
}
