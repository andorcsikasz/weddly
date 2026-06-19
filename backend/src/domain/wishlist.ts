// Wishlist / gift-registry CRUD helpers. All queries take a coupleId so the
// caller is responsible for scoping to the authenticated couple via
// getCoupleForUser — same contract as schedule.ts. No money ever moves
// in-app; `target_amount_minor` is purely informational (integer minor units
// in the couple's native currency, non-negative or null).
//
// The guest-side soft "I'd like to help" tap lives in wishlist_interests:
// idempotent per household via UNIQUE(item_id, household_id) — toggleInterest
// inserts if absent, deletes if present. Only 'gift' items surface it on
// the guest page (the route layer enforces that), but the helpers here are
// kind-agnostic.

import { CURRENCIES, type Currency } from "@shared/types";
import {
  WISHLIST_KINDS,
  WISHLIST_MAX_DESC_LEN,
  WISHLIST_MAX_TITLE_LEN,
  WISHLIST_MAX_URL_LEN,
  type UpsertWishlistItemInput,
  type WishlistContributor,
  type WishlistContributorsResult,
  type WishlistEntry,
  type WishlistItem,
  type WishlistKind,
} from "@shared/wishlist";
import { db, now } from "../db";
import type { HouseholdRow } from "./households";
import { HttpError } from "../lib/http";
import { sendRawEmail } from "./emails";

export interface WishlistItemRow {
  id: number;
  couple_id: number;
  title: string;
  description: string | null;
  kind: string;
  target_amount_minor: number | null;
  /** Per-item currency override; NULL = inherit the couple's display currency. */
  currency: string | null;
  url: string | null;
  image_url: string | null;
  /** ms timestamp of the last og:image resolution attempt; NULL = never tried. */
  image_checked_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** Map any stored kind (current or legacy) to the two-bucket vocabulary:
 *  item/group_gift → gift, personal → request. Anything unknown defaults to a
 *  gift (the safer, money-capable bucket). */
export function normalizeKind(raw: string): WishlistKind {
  if (raw === "request" || raw === "personal") return "request";
  return "gift";
}

/** Kind values accepted on the API boundary — the new vocabulary plus the
 *  legacy aliases (so older clients + existing tests keep working). Normalized
 *  to gift/request before storage. */
const ACCEPTED_KIND_INPUTS = new Set(["gift", "request", "item", "group_gift", "personal"]);

/** A stored currency string → a valid Currency, or null (inherit the couple's)
 *  when unset or unrecognised. */
function normalizeCurrency(raw: string | null): Currency | null {
  return raw && (CURRENCIES as readonly string[]).includes(raw) ? (raw as Currency) : null;
}

/** Couple-facing DTO returned by GET/POST/PATCH /api/wishlist. `interestCount` /
 *  `pledgedAmountMinor` are the coordination aggregates for the progress bar —
 *  the list path computes them in one batched query; create/update return a
 *  fresh item with no interests yet, so they default to 0. */
export function toWishlistItem(
  row: WishlistItemRow,
  interestCount = 0,
  pledgedAmountMinor = 0,
): WishlistItem {
  return {
    id: row.id,
    couple_id: row.couple_id,
    title: row.title,
    description: row.description,
    kind: normalizeKind(row.kind),
    target_amount_minor: row.target_amount_minor,
    currency: normalizeCurrency(row.currency),
    url: row.url,
    image_url: row.image_url,
    interest_count: interestCount,
    pledged_amount_minor: pledgedAmountMinor,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Guest-facing DTO embedded in the public-wedding response at the confirmed
 *  tier. Strips couple_id / sort_order / timestamps and folds in the soft
 *  interest signal. `interest_count` / `viewer_has_interest` are only
 *  meaningful for kind === "gift" (the caller passes 0 / false for requests). */
export function toWishlistEntry(
  row: WishlistItemRow,
  interestCount: number,
  pledgedAmountMinor: number,
  viewerHasInterest: boolean,
  viewerPledgedAmountMinor: number | null,
): WishlistEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: normalizeKind(row.kind),
    target_amount_minor: row.target_amount_minor,
    currency: normalizeCurrency(row.currency),
    url: row.url,
    image_url: row.image_url,
    interest_count: interestCount,
    pledged_amount_minor: pledgedAmountMinor,
    viewer_has_interest: viewerHasInterest,
    viewer_pledged_amount_minor: viewerPledgedAmountMinor,
  };
}

// ── Boundary validation (hand-written, no Zod). Mirrors schedule.ts. ─────────

export interface ParsedWishlistItem {
  title: string;
  description: string | null;
  kind: WishlistKind;
  target_amount_minor: number | null;
  currency: Currency | null;
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
  if (raw === null || raw === undefined) return "gift";
  if (typeof raw !== "string" || !ACCEPTED_KIND_INPUTS.has(raw)) {
    throw new HttpError(400, `kind must be one of ${WISHLIST_KINDS.join(", ")}`);
  }
  return normalizeKind(raw);
}

function parseTargetAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "target_amount_minor must be a non-negative integer or null");
  }
  return n;
}

function parseCurrency(raw: unknown): Currency | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !(CURRENCIES as readonly string[]).includes(raw)) {
    throw new HttpError(400, `currency must be one of ${CURRENCIES.join(", ")} or null`);
  }
  return raw as Currency;
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
    currency: parseCurrency(body.currency),
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
    currency:
      body.currency === undefined
        ? normalizeCurrency(existing.currency)
        : parseCurrency(body.currency),
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
  // Fold in the coordination aggregates (helper count + pledged sum) so the
  // editor can draw the progress bar. Only gifts collect pledges, so we
  // only query those ids; requests get 0/0 via the map default.
  const giftIds = rows.filter((r) => normalizeKind(r.kind) === "gift").map((r) => r.id);
  const stats = listInterestStatsForItems(giftIds);
  return rows.map((row) => {
    const s = stats.get(row.id);
    return toWishlistItem(row, s?.count ?? 0, s?.pledged ?? 0);
  });
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
  // Stamp image_checked_at only when we actually resolved an image. If the
  // og:image fetch failed (image_url null), leave it null so the boot backfill
  // gets a second attempt on the next deploy.
  const imageCheckedAt = parsed.image_url ? ts : null;
  const result = db
    .prepare(
      `INSERT INTO wishlist_items
         (couple_id, title, description, kind, target_amount_minor, currency, url, image_url, image_checked_at, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      coupleId,
      parsed.title,
      parsed.description,
      parsed.kind,
      parsed.target_amount_minor,
      parsed.currency,
      parsed.url,
      parsed.image_url,
      imageCheckedAt,
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
  const imageCheckedAt = parsed.url ? ts : null;
  db.prepare(
    `UPDATE wishlist_items SET
       title = ?, description = ?, kind = ?, target_amount_minor = ?, currency = ?,
       url = ?, image_url = ?, image_checked_at = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.title,
    parsed.description,
    parsed.kind,
    parsed.target_amount_minor,
    parsed.currency,
    parsed.url,
    parsed.image_url,
    imageCheckedAt,
    parsed.sort_order,
    ts,
    id,
    coupleId,
  );
  return db.prepare("SELECT * FROM wishlist_items WHERE id = ?").get(id) as WishlistItemRow;
}

/** Legacy rows the boot backfill should re-resolve: a link is set but no
 *  og:image was ever attempted (image_checked_at IS NULL). New/edited rows are
 *  always stamped (see insert/update), so this only ever returns rows created
 *  before this column — and only once each, since the backfill stamps them. */
export function listWishlistRowsNeedingImageBackfill(limit: number): WishlistItemRow[] {
  return db
    .prepare(
      `SELECT * FROM wishlist_items
         WHERE url IS NOT NULL AND image_url IS NULL AND image_checked_at IS NULL
         ORDER BY id ASC
         LIMIT ?`,
    )
    .all(limit) as WishlistItemRow[];
}

/** Record a backfill attempt: set the resolved image (or leave it null on a
 *  miss) and stamp image_checked_at so the row is never swept again. Does NOT
 *  bump updated_at — this is a background system write, and bumping it would
 *  spuriously 409 a couple who has the editor open against the old value. */
export function applyBackfilledImage(id: number, imageUrl: string | null): void {
  db.prepare("UPDATE wishlist_items SET image_url = ?, image_checked_at = ? WHERE id = ?").run(
    imageUrl,
    now(),
    id,
  );
}

export function deleteWishlistItem(id: number, coupleId: number): boolean {
  // wishlist_interests cascade via the FK ON DELETE CASCADE.
  const result = db
    .prepare("DELETE FROM wishlist_items WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}

// ── Interest tap (soft, non-money, idempotent per household) ─────────────────

export function householdHasInterest(itemId: number, householdId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM wishlist_interests WHERE item_id = ? AND household_id = ? LIMIT 1")
    .get(itemId, householdId) as { 1: number } | null;
  // bun:sqlite's .get() returns null (not undefined) when no row matches, so
  // compare against null — `!== undefined` would always read as "exists".
  return row != null;
}

/** Per-item coordination aggregates: the helper count + the summed soft pledge
 *  (minor units; NULL pledges count as 0 via COALESCE). One GROUP BY query,
 *  returned as a Map<item_id, {count, pledged}>. Items with no interests are
 *  absent (callers default to 0/0). Used by both the couple-side list and the
 *  guest-side embed so we never aggregate per item in a loop. */
export function listInterestStatsForItems(
  itemIds: number[],
): Map<number, { count: number; pledged: number }> {
  const stats = new Map<number, { count: number; pledged: number }>();
  if (itemIds.length === 0) return stats;
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT item_id, COUNT(*) AS n, COALESCE(SUM(pledged_amount_minor), 0) AS pledged
         FROM wishlist_interests
         WHERE item_id IN (${placeholders})
         GROUP BY item_id`,
    )
    .all(...itemIds) as Array<{ item_id: number; n: number; pledged: number }>;
  for (const r of rows) stats.set(r.item_id, { count: r.n, pledged: r.pledged });
  return stats;
}

/** Map<item_id, pledged_amount_minor | null> of THIS household's own pledges for
 *  the given items — fills `viewer_pledged_amount_minor` on the guest embed so
 *  the guest can see + edit their own number. Items the household hasn't tapped
 *  are absent (caller reads null). */
export function listHouseholdPledges(
  householdId: number,
  itemIds: number[],
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  if (itemIds.length === 0) return map;
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT item_id, pledged_amount_minor FROM wishlist_interests
         WHERE household_id = ? AND item_id IN (${placeholders})`,
    )
    .all(householdId, ...itemIds) as Array<{
    item_id: number;
    pledged_amount_minor: number | null;
  }>;
  for (const r of rows) map.set(r.item_id, r.pledged_amount_minor);
  return map;
}

export interface InterestState {
  interest_count: number;
  pledged_amount_minor: number;
  viewer_has_interest: boolean;
  viewer_pledged_amount_minor: number | null;
}

export interface NotificationContributor {
  label: string;
  pledgedAmountMinor: number | null;
  email: string | null;
}

export interface SetInterestResult extends InterestState {
  wasInsert: boolean;
  notificationPayload?: {
    itemTitle: string;
    itemUrl: string | null;
    targetAmountMinor: number | null;
    currency: string;
    newContributorLabel: string;
    allContributors: NotificationContributor[];
  };
}

/** Read the post-write coordination state for one item + household: the helper
 *  count, the summed pledge, and the viewer's own membership + pledge. */
function readInterestState(itemId: number, householdId: number): InterestState {
  const agg = listInterestStatsForItems([itemId]).get(itemId);
  const mine = listHouseholdPledges(householdId, [itemId]);
  return {
    interest_count: agg?.count ?? 0,
    pledged_amount_minor: agg?.pledged ?? 0,
    viewer_has_interest: mine.has(itemId),
    viewer_pledged_amount_minor: mine.get(itemId) ?? null,
  };
}

/** The household's "I'd like to help" interaction on a group gift. Two modes,
 *  picked by whether the caller passes a `pledge` value (no money moves — the
 *  amount is a soft, non-binding coordination number):
 *  - `pledge === undefined` → pure TOGGLE: a household not in taps in (no
 *    amount); one already in taps back out. (Backward-compatible default.)
 *  - `pledge` is a number ≥ 0 or null → SET PLEDGE: ensure the household is in
 *    and record/replace its amount (null = in, no number). Never leaves.
 *  The UNIQUE(item_id, household_id) constraint backstops a double-insert race;
 *  the code/label snapshot is taken from the household row.
 *  `notificationEmail` is the opt-in address stored on the row; validated and
 *  normalised by the caller before passing. Never returned in any response. */
export function setInterest(
  coupleId: number,
  itemId: number,
  household: HouseholdRow,
  pledge: number | null | undefined,
  notificationEmail?: string,
): SetInterestResult {
  const existing = householdHasInterest(itemId, household.id);
  let wasInsert = false;

  if (pledge === undefined) {
    // Pure toggle.
    if (existing) {
      db.prepare("DELETE FROM wishlist_interests WHERE item_id = ? AND household_id = ?").run(
        itemId,
        household.id,
      );
    } else {
      wasInsert = true;
      db.prepare(
        `INSERT INTO wishlist_interests
           (couple_id, item_id, household_id, household_code, household_label, pledged_amount_minor, notification_email, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        coupleId,
        itemId,
        household.id,
        household.code,
        household.label,
        notificationEmail ?? null,
        now(),
      );
    }
  } else if (existing) {
    // Set pledge on an existing membership — update the amount and email in place.
    db.prepare(
      "UPDATE wishlist_interests SET pledged_amount_minor = ?, notification_email = ? WHERE item_id = ? AND household_id = ?",
    ).run(pledge, notificationEmail ?? null, itemId, household.id);
  } else {
    // Set pledge while not yet in — join and record the amount.
    wasInsert = true;
    db.prepare(
      `INSERT INTO wishlist_interests
         (couple_id, item_id, household_id, household_code, household_label, pledged_amount_minor, notification_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      coupleId,
      itemId,
      household.id,
      household.code,
      household.label,
      pledge,
      notificationEmail ?? null,
      now(),
    );
  }

  const state = readInterestState(itemId, household.id);

  // Build notification payload only when this was a new join (insert). On a
  // pure toggle-out (delete) or an in-place pledge update, wasInsert is false.
  let notificationPayload: SetInterestResult["notificationPayload"];
  if (wasInsert) {
    const itemRow = db
      .prepare("SELECT title, url, target_amount_minor, currency FROM wishlist_items WHERE id = ?")
      .get(itemId) as
      | {
          title: string;
          url: string | null;
          target_amount_minor: number | null;
          currency: string | null;
        }
      | undefined;
    const allInterestRows = db
      .prepare(
        "SELECT household_label, pledged_amount_minor, notification_email FROM wishlist_interests WHERE item_id = ? ORDER BY created_at ASC",
      )
      .all(itemId) as Array<{
      household_label: string;
      pledged_amount_minor: number | null;
      notification_email: string | null;
    }>;
    if (itemRow) {
      notificationPayload = {
        itemTitle: itemRow.title,
        itemUrl: itemRow.url,
        targetAmountMinor: itemRow.target_amount_minor,
        currency: itemRow.currency ?? "HUF",
        newContributorLabel: household.label,
        allContributors: allInterestRows.map((r) => ({
          label: r.household_label,
          pledgedAmountMinor: r.pledged_amount_minor,
          email: r.notification_email,
        })),
      };
    }
  }

  return { ...state, wasInsert, notificationPayload };
}

/** Retrieve the group-gift contributor list for a single item, visible only to
 *  households that have already pledged. Returns `null` when the household has
 *  not pledged (caller should 403). The result never includes email addresses —
 *  those are operational data for the mailer only. */
export function getContributorsForItem(
  itemId: number,
  householdId: number,
): WishlistContributorsResult | null {
  // Gate: household must have pledged.
  const membership = db
    .prepare("SELECT 1 FROM wishlist_interests WHERE item_id = ? AND household_id = ? LIMIT 1")
    .get(itemId, householdId) as { 1: number } | null;
  if (membership == null) return null;

  const itemRow = db
    .prepare("SELECT target_amount_minor FROM wishlist_items WHERE id = ?")
    .get(itemId) as { target_amount_minor: number | null } | undefined;
  if (!itemRow) return null;

  const rows = db
    .prepare(
      "SELECT household_label, pledged_amount_minor FROM wishlist_interests WHERE item_id = ? ORDER BY created_at ASC",
    )
    .all(itemId) as Array<{ household_label: string; pledged_amount_minor: number | null }>;

  const target = itemRow.target_amount_minor;
  const total = rows.reduce((sum, r) => sum + (r.pledged_amount_minor ?? 0), 0);

  const contributors: WishlistContributor[] = rows.map((r) => ({
    label: r.household_label,
    pledged_amount_minor: r.pledged_amount_minor,
    pledged_pct:
      target && target > 0 && r.pledged_amount_minor != null
        ? Math.round((r.pledged_amount_minor / target) * 100)
        : null,
  }));

  const remaining_minor = target != null ? Math.max(0, target - total) : null;
  const remaining_pct =
    target != null && target > 0 ? Math.round((Math.max(0, target - total) / target) * 100) : null;

  return {
    contributors,
    total_pledged_minor: total,
    target_amount_minor: target,
    remaining_minor,
    remaining_pct,
  };
}

// ── Group gift email notifications ────────────────────────────────────────────

/** Format an amount in minor units for display. HUF: "X Ft" with space as
 *  thousands separator. EUR: "€X". Other: "X {CURRENCY}". */
function formatAmount(minor: number, currency: string): string {
  if (currency === "HUF") {
    // Space-separated thousands (Hungarian style)
    const formatted = minor.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${formatted} Ft`;
  }
  if (currency === "EUR") {
    return `€${minor}`;
  }
  return `${minor} ${currency}`;
}

/** Send group-gift coordination emails to relevant recipients. Two roles:
 *  - EXISTING contributors who opted in → notified that a new household joined.
 *  - NEW pledger who provided an email → confirmation of their own pledge.
 *  All sends are fire-and-forget; errors are caught and logged but never
 *  propagate to the HTTP response. Recipients only get emails if they opted
 *  in (provided a notification_email at pledge time). */
export async function sendGroupGiftNotification(params: {
  to: string;
  isNewPledger: boolean;
  itemTitle: string;
  itemUrl: string | null;
  targetAmountMinor: number | null;
  currency: string;
  newContributorLabel: string;
  contributors: Array<{ label: string; pledgedAmountMinor: number | null }>;
  recipientLabel: string;
}): Promise<void> {
  const {
    to,
    isNewPledger,
    itemTitle,
    itemUrl,
    targetAmountMinor,
    currency,
    newContributorLabel,
    contributors,
    recipientLabel,
  } = params;

  const total = contributors.reduce((s, c) => s + (c.pledgedAmountMinor ?? 0), 0);
  const pct =
    targetAmountMinor && targetAmountMinor > 0
      ? Math.round((total / targetAmountMinor) * 100)
      : null;

  const subject = isNewPledger
    ? `[${itemTitle}] Köszönjük, hogy csatlakozol! / Thanks for joining!`
    : `[${itemTitle}] Újabb vendég csatlakozott / Another guest joined`;

  // Build contributor table rows (HTML)
  const tableRows = contributors
    .map((c) => {
      const isMe = c.label === recipientLabel;
      const amountCell =
        c.pledgedAmountMinor != null ? formatAmount(c.pledgedAmountMinor, currency) : "-";
      return `<tr${isMe ? ' style="font-weight:bold"' : ""}>
        <td>${c.label}${isMe ? " [Te/You]" : ""}</td>
        <td>${amountCell}</td>
      </tr>`;
    })
    .join("\n");

  const contributorTableHtml = `
    <table style="border-collapse:collapse;width:100%;margin:12px 0">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Háztartás / Guest</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">Összeg / Amount</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>`;

  const progressLine =
    targetAmountMinor != null
      ? `<p>Összesen / Total: <strong>${formatAmount(total, currency)} / ${formatAmount(targetAmountMinor, currency)}${pct != null ? ` (${pct}%)` : ""}</strong></p>`
      : `<p>Összesen / Total: <strong>${formatAmount(total, currency)}</strong></p>`;

  const itemUrlLink = itemUrl
    ? `<p><a href="${itemUrl}">Megnézheted az ajándékot / View the gift item</a></p>`
    : "";

  let bodyHtml: string;
  if (isNewPledger) {
    const ownPledge = contributors.find((c) => c.label === recipientLabel);
    const ownAmount =
      ownPledge?.pledgedAmountMinor != null
        ? formatAmount(ownPledge.pledgedAmountMinor, currency)
        : "nincs megadva / not specified";
    bodyHtml = `
      <p>Megerősítjük, hogy szándéknyilatkozatod megérkezett a(z) <strong>${itemTitle}</strong> ajándékhoz.<br>
      <em>We've noted your intention to contribute to <strong>${itemTitle}</strong>.</em></p>
      <p>Vállalt összeg / Your pledge: <strong>${ownAmount}</strong></p>
      ${contributors.length > 1 ? contributorTableHtml : ""}
      ${progressLine}
      ${itemUrlLink}
      <p><em>Ez egy nem kötelező szándéknyilatkozat — bármikor visszavonhatod.<br>
      This is a non-binding expression of interest — you can withdraw at any time.</em></p>`;
  } else {
    bodyHtml = `
      <p>Örömmel értesítünk, hogy <strong>${newContributorLabel}</strong> is csatlakozott a(z) <strong>${itemTitle}</strong> ajándékhoz.<br>
      <em>Another guest joined <strong>${itemTitle}</strong>.</em></p>
      ${contributorTableHtml}
      ${progressLine}
      <p><strong>Egyeztessetek a vásárlásról! / Coordinate the purchase!</strong></p>
      ${itemUrlLink}`;
  }

  const fullHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px">
    ${bodyHtml}
    <hr style="margin-top:24px">
    <p style="font-size:11px;color:#888">Ezt az e-mailt azért kaptad, mert megadtad e-mail-címedet egy ajándék-koordináció kapcsán a Weddly platformon.<br>
    You received this email because you provided your address for gift coordination on the Weddly platform.</p>
  </body></html>`;

  // Plain-text version (fallback)
  const textRows = contributors
    .map((c) => {
      const isMe = c.label === recipientLabel;
      const amt = c.pledgedAmountMinor != null ? formatAmount(c.pledgedAmountMinor, currency) : "-";
      return `${c.label}${isMe ? " [Te/You]" : ""}: ${amt}`;
    })
    .join("\n");

  const fullText = isNewPledger
    ? `${itemTitle} - köszönjük, hogy csatlakozol!\n\n${textRows}\n\nÖsszesen: ${formatAmount(total, currency)}${targetAmountMinor != null ? ` / ${formatAmount(targetAmountMinor, currency)}` : ""}${pct != null ? ` (${pct}%)` : ""}${itemUrl ? `\n\n${itemUrl}` : ""}`
    : `Újabb vendég csatlakozott: ${newContributorLabel}\n\n${textRows}\n\nÖsszesen: ${formatAmount(total, currency)}${targetAmountMinor != null ? ` / ${formatAmount(targetAmountMinor, currency)}` : ""}${pct != null ? ` (${pct}%)` : ""}${itemUrl ? `\n\n${itemUrl}` : ""}`;

  // sendRawEmail never throws (see domain/emails/send.ts).
  await sendRawEmail({ to, subject, html: fullHtml, text: fullText });
}
