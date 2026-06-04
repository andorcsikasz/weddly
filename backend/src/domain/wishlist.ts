// Wishlist / gift-registry CRUD helpers. All queries take a coupleId so the
// caller is responsible for scoping to the authenticated couple via
// getCoupleForUser — same contract as schedule.ts. No money ever moves
// in-app; `target_amount_minor` is purely informational (integer minor units
// in the couple's native currency, non-negative or null).
//
// The guest-side soft "I'd like to help" tap lives in wishlist_interests:
// idempotent per household via UNIQUE(item_id, household_id) — toggleInterest
// inserts if absent, deletes if present. Only 'group_gift' items surface it on
// the guest page (the route layer enforces that), but the helpers here are
// kind-agnostic.

import {
  WISHLIST_KINDS,
  WISHLIST_MAX_DESC_LEN,
  WISHLIST_MAX_TITLE_LEN,
  WISHLIST_MAX_URL_LEN,
  type UpsertWishlistItemInput,
  type WishlistEntry,
  type WishlistItem,
  type WishlistKind,
} from "@shared/wishlist";
import { db, now } from "../db";
import type { HouseholdRow } from "./households";
import { HttpError } from "../lib/http";

export interface WishlistItemRow {
  id: number;
  couple_id: number;
  title: string;
  description: string | null;
  kind: string;
  target_amount_minor: number | null;
  url: string | null;
  image_url: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function normalizeKind(raw: string): WishlistKind {
  return (WISHLIST_KINDS as readonly string[]).includes(raw) ? (raw as WishlistKind) : "item";
}

/** Couple-facing DTO returned by GET/POST/PATCH /api/wishlist. */
export function toWishlistItem(row: WishlistItemRow): WishlistItem {
  return {
    id: row.id,
    couple_id: row.couple_id,
    title: row.title,
    description: row.description,
    kind: normalizeKind(row.kind),
    target_amount_minor: row.target_amount_minor,
    url: row.url,
    image_url: row.image_url,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Guest-facing DTO embedded in the public-wedding response at the confirmed
 *  tier. Strips couple_id / sort_order / timestamps and folds in the soft
 *  interest signal. `interest_count` / `viewer_has_interest` are only
 *  meaningful for kind === "group_gift" (the caller passes 0 / false for the
 *  other kinds). */
export function toWishlistEntry(
  row: WishlistItemRow,
  interestCount: number,
  viewerHasInterest: boolean,
): WishlistEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: normalizeKind(row.kind),
    target_amount_minor: row.target_amount_minor,
    url: row.url,
    image_url: row.image_url,
    interest_count: interestCount,
    viewer_has_interest: viewerHasInterest,
  };
}

// ── Boundary validation (hand-written, no Zod). Mirrors schedule.ts. ─────────

export interface ParsedWishlistItem {
  title: string;
  description: string | null;
  kind: WishlistKind;
  target_amount_minor: number | null;
  url: string | null;
  image_url: string | null;
  sort_order: number;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "title required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "title required");
  if (trimmed.length > WISHLIST_MAX_TITLE_LEN) {
    throw new HttpError(400, `title too long (max ${WISHLIST_MAX_TITLE_LEN} chars)`);
  }
  return trimmed;
}

function parseDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "description must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > WISHLIST_MAX_DESC_LEN) {
    throw new HttpError(400, `description too long (max ${WISHLIST_MAX_DESC_LEN} chars)`);
  }
  return trimmed;
}

function parseKind(raw: unknown): WishlistKind {
  if (raw === null || raw === undefined) return "item";
  if (typeof raw !== "string" || !(WISHLIST_KINDS as readonly string[]).includes(raw)) {
    throw new HttpError(400, `kind must be one of ${WISHLIST_KINDS.join(", ")}`);
  }
  return raw as WishlistKind;
}

function parseTargetAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "target_amount_minor must be a non-negative integer or null");
  }
  return n;
}

function parseUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "url must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > WISHLIST_MAX_URL_LEN) {
    throw new HttpError(400, `url too long (max ${WISHLIST_MAX_URL_LEN} chars)`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, "url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "url must be a valid http(s) URL");
  }
  return trimmed;
}

/** Same http(s) + length validation as the user-facing `url`, used for the
 *  server-resolved `image_url`. Kept separate so a future image-specific rule
 *  (e.g. extension allowlist) has a home. */
function parseImageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "image_url must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > WISHLIST_MAX_URL_LEN) {
    throw new HttpError(400, `image_url too long (max ${WISHLIST_MAX_URL_LEN} chars)`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, "image_url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "image_url must be a valid http(s) URL");
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

/** Full parse for POST. `title` is the only required field. */
export function parseUpsertCreate(body: Partial<UpsertWishlistItemInput>): ParsedWishlistItem {
  return {
    title: parseTitle(body.title),
    description: parseDescription(body.description),
    kind: parseKind(body.kind),
    target_amount_minor: parseTargetAmount(body.target_amount_minor),
    url: parseUrl(body.url),
    image_url: parseImageUrl(body.image_url),
    sort_order: parseSortOrder(body.sort_order, 0),
  };
}

/** Partial parse for PATCH — every missing field defaults to the existing
 *  row's value so the client can change just one field. */
export function parseUpsertPatch(
  body: Partial<UpsertWishlistItemInput>,
  existing: WishlistItemRow,
): ParsedWishlistItem {
  return {
    title: body.title === undefined ? existing.title : parseTitle(body.title),
    description:
      body.description === undefined ? existing.description : parseDescription(body.description),
    kind: body.kind === undefined ? normalizeKind(existing.kind) : parseKind(body.kind),
    target_amount_minor:
      body.target_amount_minor === undefined
        ? existing.target_amount_minor
        : parseTargetAmount(body.target_amount_minor),
    url: body.url === undefined ? existing.url : parseUrl(body.url),
    image_url: body.image_url === undefined ? existing.image_url : parseImageUrl(body.image_url),
    sort_order: parseSortOrder(body.sort_order, existing.sort_order),
  };
}

// ── Item CRUD ────────────────────────────────────────────────────────────────

export function listWishlistItems(coupleId: number): WishlistItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM wishlist_items
         WHERE couple_id = ?
         ORDER BY sort_order ASC, id ASC`,
    )
    .all(coupleId) as WishlistItemRow[];
  return rows.map(toWishlistItem);
}

/** Raw rows (not DTOs) for the guest-side embed mapper. Same ordering. */
export function listWishlistItemRows(coupleId: number): WishlistItemRow[] {
  return db
    .prepare(
      `SELECT * FROM wishlist_items
         WHERE couple_id = ?
         ORDER BY sort_order ASC, id ASC`,
    )
    .all(coupleId) as WishlistItemRow[];
}

export function getWishlistItemScoped(id: number, coupleId: number): WishlistItemRow | null {
  return (
    (db.prepare("SELECT * FROM wishlist_items WHERE id = ? AND couple_id = ?").get(id, coupleId) as
      | WishlistItemRow
      | undefined) ?? null
  );
}

export function insertWishlistItem(coupleId: number, parsed: ParsedWishlistItem): WishlistItemRow {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO wishlist_items
         (couple_id, title, description, kind, target_amount_minor, url, image_url, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.title,
      parsed.description,
      parsed.kind,
      parsed.target_amount_minor,
      parsed.url,
      parsed.image_url,
      parsed.sort_order,
      ts,
      ts,
    );
  const id = Number(result.lastInsertRowid);
  return db.prepare("SELECT * FROM wishlist_items WHERE id = ?").get(id) as WishlistItemRow;
}

export function updateWishlistItem(
  id: number,
  coupleId: number,
  parsed: ParsedWishlistItem,
): WishlistItemRow {
  const ts = now();
  db.prepare(
    `UPDATE wishlist_items SET
       title = ?, description = ?, kind = ?, target_amount_minor = ?,
       url = ?, image_url = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.title,
    parsed.description,
    parsed.kind,
    parsed.target_amount_minor,
    parsed.url,
    parsed.image_url,
    parsed.sort_order,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM wishlist_items WHERE id = ?").get(id) as WishlistItemRow;
}

export function deleteWishlistItem(id: number, coupleId: number): boolean {
  // wishlist_interests cascade via the FK ON DELETE CASCADE.
  const result = db
    .prepare("DELETE FROM wishlist_items WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}

// ── Interest tap (soft, non-money, idempotent per household) ─────────────────

export function countInterest(itemId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM wishlist_interests WHERE item_id = ?")
    .get(itemId) as { n: number };
  return row.n;
}

export function householdHasInterest(itemId: number, householdId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM wishlist_interests WHERE item_id = ? AND household_id = ? LIMIT 1")
    .get(itemId, householdId) as { 1: number } | null;
  // bun:sqlite's .get() returns null (not undefined) when no row matches, so
  // compare against null — `!== undefined` would always read as "exists".
  return row != null;
}

/** Batch count of interests for a set of item ids — one query, returned as a
 *  Map<item_id, count>. Items with no interests are absent (caller defaults to
 *  0). Used by the guest-side embed so we don't COUNT per item in a loop. */
export function listInterestCountsForItems(itemIds: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  if (itemIds.length === 0) return counts;
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT item_id, COUNT(*) AS n FROM wishlist_interests
         WHERE item_id IN (${placeholders})
         GROUP BY item_id`,
    )
    .all(...itemIds) as Array<{ item_id: number; n: number }>;
  for (const r of rows) counts.set(r.item_id, r.n);
  return counts;
}

/** Set of item ids (from the given set) the household has tapped. Used by the
 *  guest-side embed to fill viewer_has_interest without an EXISTS per item. */
export function listHouseholdInterestItemIds(householdId: number, itemIds: number[]): Set<number> {
  const set = new Set<number>();
  if (itemIds.length === 0) return set;
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT item_id FROM wishlist_interests
         WHERE household_id = ? AND item_id IN (${placeholders})`,
    )
    .all(householdId, ...itemIds) as Array<{ item_id: number }>;
  for (const r of rows) set.add(r.item_id);
  return set;
}

/** Idempotent toggle: if the household already tapped this item, remove the
 *  tap; otherwise insert it. Returns the post-toggle state. The UNIQUE
 *  (item_id, household_id) constraint is the backstop against a double-insert
 *  race. The denormalised code/label snapshot is taken from the household row. */
export function toggleInterest(
  coupleId: number,
  itemId: number,
  household: HouseholdRow,
): { interest_count: number; viewer_has_interest: boolean } {
  const existing = householdHasInterest(itemId, household.id);
  if (existing) {
    db.prepare("DELETE FROM wishlist_interests WHERE item_id = ? AND household_id = ?").run(
      itemId,
      household.id,
    );
  } else {
    db.prepare(
      `INSERT INTO wishlist_interests
         (couple_id, item_id, household_id, household_code, household_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(coupleId, itemId, household.id, household.code, household.label, now());
  }
  return {
    interest_count: countInterest(itemId),
    viewer_has_interest: !existing,
  };
}
