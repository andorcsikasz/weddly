// Free tryout codes for Weddly Camera. An admin mints a code for one guest
// tier; whoever redeems it gets their film opened to that tier with no
// Stripe round trip. Rules worth not re-deriving:
//
//   - A code raises `photo_albums.guest_cap` and NOTHING about money.
//     `paid_at` is what the financial planner counts as a sale, and
//     `paid_amount_cents` is what an upgrade credits, so a free 50-guest
//     film that later grows to 100 pays the full 100 price, not the gap.
//   - The status is DERIVED on read (revoked > expired > used up > active),
//     the same idiom as quotes and date holds: nothing sweeps, and revoking
//     is one timestamp.
//   - A cap never goes down. A code below or at what the film already holds
//     is refused rather than spent, so a guest cannot burn a code by mistake.
//   - One film spends a given code once (UNIQUE(code_id, album_id)); the
//     redemption count is the row count, checked inside the transaction that
//     writes the row.

import type {
  FilmPromoCode,
  FilmPromoCodeStatus,
  FilmPromoRedemption,
  FilmPromoRefusal,
} from "@shared/types";
import { randomBytes } from "node:crypto";
import { db, now } from "../db";

interface CodeRow {
  id: number;
  code: string;
  cap: number;
  max_redemptions: number;
  expires_at: number | null;
  revoked_at: number | null;
  note: string | null;
  created_at: number;
  redemptions: number;
}

export class FilmCodeError extends Error {
  constructor(readonly code: FilmPromoRefusal) {
    super(code);
  }
}

/** HTTP status each refusal maps to: unknown is 404, a dead code is 410,
 *  and "you cannot use this one here" is 409. */
export function filmCodeHttpStatus(code: FilmPromoRefusal): number {
  if (code === "code_not_found") return 404;
  if (code === "code_already_redeemed" || code === "cap_already_covered") return 409;
  return 410;
}

/** Codes are typed by people off a card or a message: case, spaces and the
 *  odd dash are noise. Returns null for anything that cannot be a code. */
export function normalizeFilmCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{4,32}$/.test(code) ? code : null;
}

// No 0/O or 1/I/L: a code read aloud at a wedding fair must survive it.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateFilmCode(): string {
  const bytes = randomBytes(8);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return `CAM-${body}`;
}

export function filmCodeStatus(
  row: Pick<CodeRow, "revoked_at" | "expires_at" | "redemptions" | "max_redemptions">,
  at: number = now(),
): FilmPromoCodeStatus {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && at >= row.expires_at) return "expired";
  if (row.redemptions >= row.max_redemptions) return "used_up";
  return "active";
}

const SELECT_CODE = `
  SELECT c.*, (SELECT COUNT(*) FROM film_promo_redemptions r WHERE r.code_id = c.id) AS redemptions
    FROM film_promo_codes c`;

function codeRowByCode(code: string): CodeRow | undefined {
  return db.prepare(`${SELECT_CODE} WHERE c.code = ?`).get(code) as CodeRow | undefined;
}

function codeRowById(id: number): CodeRow | undefined {
  return db.prepare(`${SELECT_CODE} WHERE c.id = ?`).get(id) as CodeRow | undefined;
}

function redemptionsFor(codeId: number): FilmPromoRedemption[] {
  return db
    .prepare(
      `SELECT pa.couple_id AS couple_id, c.display_name AS display_name, u.email AS email,
              r.redeemed_at AS redeemed_at
         FROM film_promo_redemptions r
         LEFT JOIN photo_albums pa ON pa.id = r.album_id
         LEFT JOIN couples c ON c.id = pa.couple_id
         LEFT JOIN users u ON u.id = r.user_id
        WHERE r.code_id = ?
        ORDER BY r.redeemed_at DESC`,
    )
    .all(codeId) as FilmPromoRedemption[];
}

function toFilmPromoCode(row: CodeRow): FilmPromoCode {
  return {
    id: row.id,
    code: row.code,
    cap: row.cap,
    max_redemptions: row.max_redemptions,
    redemptions: row.redemptions,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    note: row.note,
    created_at: row.created_at,
    status: filmCodeStatus(row),
    redeemed_by: redemptionsFor(row.id),
  };
}

export function listFilmCodes(): FilmPromoCode[] {
  const rows = db
    .prepare(`${SELECT_CODE} ORDER BY c.created_at DESC, c.id DESC`)
    .all() as CodeRow[];
  return rows.map(toFilmPromoCode);
}

export function getFilmCode(id: number): FilmPromoCode | null {
  const row = codeRowById(id);
  return row ? toFilmPromoCode(row) : null;
}

/** Returns null when the code text is already taken. */
export function createFilmCode(input: {
  code: string;
  cap: number;
  maxRedemptions: number;
  expiresAt: number | null;
  note: string | null;
  createdBy: number;
}): FilmPromoCode | null {
  if (codeRowByCode(input.code)) return null;
  const result = db
    .prepare(
      `INSERT INTO film_promo_codes
         (code, cap, max_redemptions, expires_at, note, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.code,
      input.cap,
      input.maxRedemptions,
      input.expiresAt,
      input.note,
      input.createdBy,
      now(),
    );
  return getFilmCode(Number(result.lastInsertRowid));
}

/** Idempotent: revoking a revoked code keeps the first timestamp. */
export function revokeFilmCode(id: number): FilmPromoCode | null {
  db.prepare("UPDATE film_promo_codes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(
    now(),
    id,
  );
  return getFilmCode(id);
}

/** Would this code open this film? Throws FilmCodeError naming why not.
 *  `currentCap` null means the film does not exist yet (the /camera/start
 *  form checks the code before it creates anything). */
export function checkFilmCode(
  code: string,
  albumId: number | null,
  currentCap: number | null,
): { codeId: number; cap: number } {
  const row = codeRowByCode(code);
  if (!row) throw new FilmCodeError("code_not_found");
  const status = filmCodeStatus(row);
  if (status === "revoked") throw new FilmCodeError("code_revoked");
  if (status === "expired") throw new FilmCodeError("code_expired");
  if (albumId !== null) {
    const used = db
      .prepare("SELECT 1 FROM film_promo_redemptions WHERE code_id = ? AND album_id = ?")
      .get(row.id, albumId);
    if (used) throw new FilmCodeError("code_already_redeemed");
  }
  if (status === "used_up") throw new FilmCodeError("code_used_up");
  if (currentCap !== null && currentCap >= row.cap) throw new FilmCodeError("cap_already_covered");
  return { codeId: row.id, cap: row.cap };
}

/** Spend the code on this film: raise its guest cap to the code's tier. */
export function redeemFilmCode(
  code: string,
  albumId: number,
  userId: number,
): { cap: number; capBefore: number; codeId: number } {
  return db.transaction(() => {
    const album = db.prepare("SELECT guest_cap FROM photo_albums WHERE id = ?").get(albumId) as
      | { guest_cap: number }
      | undefined;
    if (!album) throw new FilmCodeError("code_not_found");
    const { codeId, cap } = checkFilmCode(code, albumId, album.guest_cap);
    const ts = now();
    db.prepare(
      `INSERT INTO film_promo_redemptions (code_id, album_id, user_id, cap_before, redeemed_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(codeId, albumId, userId, album.guest_cap, ts);
    db.prepare(
      "UPDATE photo_albums SET guest_cap = MAX(guest_cap, ?), updated_at = ? WHERE id = ?",
    ).run(cap, ts, albumId);
    return { cap, capBefore: album.guest_cap, codeId };
  })();
}
