// Merges a duplicate vendor_accounts row into a surviving one — the repair
// for the case vendor_duplicate.ts exists to catch: the same business ends up
// with two accounts (and two logins) because a second registration matched an
// already-CLAIMED directory twin, which registration deliberately lets
// through rather than blocking (a real second business can share a name).
//
// First real use: "La Contessa Kastélyhotel" had a fresh, empty account
// (self-registered a second time) and an older account holding the actual
// public listing — photos, directory reach, review/reminder history. The
// admin's call on which login survives is a business decision this module
// doesn't make; it's given the surviving account id, the account being
// retired, and which of the two listings is the real one, and reconciles
// everything else around that.
//
// What "merge" means concretely:
//   - the surviving LISTING (photos, reach, reviews — everything keyed off
//     listings.id) is repointed to the surviving account; the OTHER account's
//     own listing is dropped if it's provably empty, or hidden if it isn't
//     (never guessed away)
//   - every other vendor-owned table (availability, tasks, payments, points,
//     calendar, automations, …) moves to the surviving account, skipping any
//     row that would collide with one the surviving account already has (that
//     account's own state wins over the retired one's)
//   - business-detail fields fill gaps only — never overwrite something the
//     surviving account already has typed in
//   - the retired account's owner keeps their `users` row (so the email stays
//     permanently taken and can't spawn a THIRD account) but is suspended, and
//     its contact email is kept on the surviving account as
//     `secondary_contact_email` — retained, never mailed, never shown as the
//     vendor's own address
//   - the retired `vendor_accounts` row itself is deleted last, once nothing
//     of value still points at it

import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { getVendorAccountById, type VendorAccountRow } from "./vendor_accounts";

/** Tables where a vendor keeps at most one row overall (PK = vendor_account_id).
 *  vendor_subscriptions is deliberately NOT here — the surviving account keeps
 *  its own subscription untouched; whichever one it already has (founding,
 *  trial, …) is the one that should keep governing its billing, and the
 *  retired account's row simply cascades away with it. */
const SINGLETON_TABLES = ["vendor_availability_settings", "vendor_google_calendar_connections"];

/** Tables with a per-row UNIQUE/PK constraint that includes vendor_account_id
 *  alongside other columns, so a bulk UPDATE can collide with a row the
 *  surviving account already has. Moved row-by-row; a collision is left on
 *  the retired account, where it cascades away when that account is deleted —
 *  the surviving account's own row wins. */
const DEDUPE_SAFE_TABLES = [
  "vendor_unavailable_dates",
  "vendor_working_hours",
  "vendor_google_calendar_event_map",
  "vendor_external_busy",
  "vendor_points_ledger",
  "vendor_automations",
  "vendor_automation_runs",
  "booking_date_holds",
];

/** Tables with no uniqueness constraint on vendor_account_id — a plain bulk
 *  move is always safe. */
const SIMPLE_MOVE_TABLES = [
  "vendor_client_payments",
  "vendor_tasks",
  "vendor_message_templates",
  "vendor_event_outbox",
  "supplier_bookings",
  "booking_quotes",
  "listing_claims",
  "vendor_review_campaign_sends",
];

/** Every table that carries a bare-string reference to a listing id (no FK —
 *  curated/community listings live partly in code, so these were never
 *  FK-enforced). Summed to decide whether a losing duplicate listing is
 *  provably empty (safe to delete) or has to be hidden instead (never
 *  guessed away). */
const LISTING_REFERENCE_TABLES: { table: string; column: string }[] = [
  { table: "listing_photos", column: "listing_id" },
  { table: "listing_videos", column: "listing_id" },
  { table: "listing_packages", column: "listing_id" },
  { table: "supplier_events", column: "supplier_id" },
  { table: "supplier_reviews", column: "supplier_id" },
  { table: "supplier_comments", column: "supplier_id" },
  { table: "supplier_bookings", column: "supplier_id" },
  { table: "supplier_votes", column: "supplier_id" },
  { table: "couple_supplier_costs", column: "supplier_id" },
  { table: "couple_picks", column: "supplier_id" },
  { table: "saved_suppliers", column: "supplier_id" },
];

export interface VendorMergeResult {
  keep_vendor_account_id: number;
  absorbed_vendor_account_id: number;
  absorbed_owner_user_id: number;
  surviving_listing_id: string;
  deleted_listing_ids: string[];
  hidden_listing_ids: string[];
  fields_filled: string[];
  rows_moved: Record<string, number>;
  rows_left_on_absorbed: Record<string, number>;
}

function countListingReferences(listingId: string): number {
  let total = 0;
  for (const { table, column } of LISTING_REFERENCE_TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
      .get(listingId) as { n: number };
    total += row.n;
  }
  return total;
}

function moveSimple(table: string, keepId: number, absorbId: number): number {
  return db
    .prepare(`UPDATE ${table} SET vendor_account_id = ? WHERE vendor_account_id = ?`)
    .run(keepId, absorbId).changes;
}

function moveSingleton(
  table: string,
  keepId: number,
  absorbId: number,
): { moved: number; left: number } {
  try {
    const changes = db
      .prepare(`UPDATE ${table} SET vendor_account_id = ? WHERE vendor_account_id = ?`)
      .run(keepId, absorbId).changes;
    return { moved: changes, left: 0 };
  } catch {
    // The surviving account already has its own row — that one wins.
    return { moved: 0, left: 1 };
  }
}

function moveDedupeSafe(
  table: string,
  keepId: number,
  absorbId: number,
): { moved: number; left: number } {
  const rows = db
    .prepare(`SELECT rowid AS rid FROM ${table} WHERE vendor_account_id = ?`)
    .all(absorbId) as { rid: number }[];
  let moved = 0;
  let left = 0;
  for (const { rid } of rows) {
    try {
      db.prepare(`UPDATE ${table} SET vendor_account_id = ? WHERE rowid = ?`).run(keepId, rid);
      moved++;
    } catch {
      left++; // collides with a row the surviving account already has
    }
  }
  return { moved, left };
}

/** Fill `keep`'s column from `absorb`'s only when `keep`'s is empty. Returns
 *  the field names actually filled, for the audit trail. */
function fillGaps(keep: VendorAccountRow, absorb: VendorAccountRow, keepId: number): string[] {
  const fields: (keyof VendorAccountRow)[] = [
    "company_name",
    "contact_phone",
    "vat_number",
    "country",
    "registry_number",
    "legal_form",
    "address",
    "city",
    "postal_code",
  ];
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  const filled: string[] = [];
  for (const f of fields) {
    const keepVal = keep[f];
    const absorbVal = absorb[f];
    if ((keepVal === null || keepVal === "") && absorbVal !== null && absorbVal !== "") {
      sets.push(`${f} = ?`);
      vals.push(absorbVal as string);
      filled.push(f);
    }
  }
  if (!keep.secondary_contact_email) {
    const secondary = absorb.contact_email;
    if (
      secondary &&
      secondary.trim().toLowerCase() !== (keep.contact_email ?? "").trim().toLowerCase()
    ) {
      sets.push("secondary_contact_email = ?");
      vals.push(secondary);
      filled.push("secondary_contact_email");
    }
  }
  if (keep.onboarding_done === 0 && absorb.onboarding_done === 1) {
    sets.push("onboarding_done = 1");
    filled.push("onboarding_done");
  }
  const keepNudge = keep.profile_nudge_count ?? 0;
  const absorbNudge = absorb.profile_nudge_count ?? 0;
  if (absorbNudge > keepNudge) {
    sets.push("profile_nudge_count = ?");
    vals.push(absorbNudge);
    filled.push("profile_nudge_count");
  }
  const keepNudgeAt = keep.profile_nudge_last_at;
  const absorbNudgeAt = absorb.profile_nudge_last_at;
  if (absorbNudgeAt !== null && (keepNudgeAt === null || absorbNudgeAt > keepNudgeAt)) {
    sets.push("profile_nudge_last_at = ?");
    vals.push(absorbNudgeAt);
    filled.push("profile_nudge_last_at");
  }
  if (sets.length === 0) return [];
  sets.push("updated_at = ?");
  vals.push(now());
  db.prepare(`UPDATE vendor_accounts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, keepId);
  return filled;
}

export function mergeVendorAccounts(input: {
  keepVendorAccountId: number;
  absorbVendorAccountId: number;
  survivingListingId: string;
  actorAdminId: number;
}): VendorMergeResult {
  const { keepVendorAccountId: keepId, absorbVendorAccountId: absorbId } = input;
  if (keepId === absorbId) throw new HttpError(400, "Cannot merge an account into itself");

  const keep = getVendorAccountById(keepId);
  const absorb = getVendorAccountById(absorbId);
  if (!keep) throw new HttpError(404, "Surviving vendor account not found");
  if (!absorb) throw new HttpError(404, "Vendor account to merge not found");

  const listingOwner = db
    .prepare("SELECT vendor_account_id FROM listings WHERE id = ?")
    .get(input.survivingListingId) as { vendor_account_id: number | null } | undefined;
  if (
    !listingOwner ||
    (listingOwner.vendor_account_id !== keepId && listingOwner.vendor_account_id !== absorbId)
  ) {
    throw new HttpError(
      400,
      "Surviving listing must belong to one of the two accounts being merged",
    );
  }

  const merge = db.transaction((): VendorMergeResult => {
    const ts = now();

    // Every OTHER listing either account owns is a genuine duplicate of the
    // same business — never a second business, since it's an artefact of the
    // same login/name/email collision this merge is repairing.
    const otherListings = db
      .prepare("SELECT id FROM listings WHERE vendor_account_id IN (?, ?) AND id != ?")
      .all(keepId, absorbId, input.survivingListingId) as { id: string }[];

    const deletedListingIds: string[] = [];
    const hiddenListingIds: string[] = [];
    for (const { id } of otherListings) {
      if (countListingReferences(id) === 0) {
        db.prepare("DELETE FROM listings WHERE id = ?").run(id);
        deletedListingIds.push(id);
      } else {
        db.prepare("UPDATE listings SET status = 'hidden', updated_at = ? WHERE id = ?").run(
          ts,
          id,
        );
        hiddenListingIds.push(id);
      }
    }

    db.prepare("UPDATE listings SET vendor_account_id = ?, updated_at = ? WHERE id = ?").run(
      keepId,
      ts,
      input.survivingListingId,
    );

    const rowsMoved: Record<string, number> = {};
    const rowsLeft: Record<string, number> = {};

    for (const table of SIMPLE_MOVE_TABLES) {
      rowsMoved[table] = moveSimple(table, keepId, absorbId);
    }
    for (const table of SINGLETON_TABLES) {
      const { moved, left } = moveSingleton(table, keepId, absorbId);
      rowsMoved[table] = moved;
      if (left > 0) rowsLeft[table] = left;
    }
    for (const table of DEDUPE_SAFE_TABLES) {
      const { moved, left } = moveDedupeSafe(table, keepId, absorbId);
      rowsMoved[table] = moved;
      if (left > 0) rowsLeft[table] = left;
    }

    const filled = fillGaps(keep, absorb, keepId);

    // Keep the login (the email stays permanently taken, so it can't spawn a
    // third account) but suspend it — the business is now run from the
    // surviving account and this one must not be usable to sign back in.
    db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(
      ts,
      absorb.owner_user_id,
    );

    // Last: the retired vendor_accounts row. Cascades vendor_subscriptions and
    // anything left in rowsLeft; nulls out vendor_onboarding's historical
    // pointer, which is fine (that row is a record of a token, not of data).
    db.prepare("DELETE FROM vendor_accounts WHERE id = ?").run(absorbId);

    addAuditLog({
      actor_user_id: input.actorAdminId,
      couple_id: null,
      action: "admin.vendor_merge",
      target_kind: "vendor_account",
      target_id: keepId,
      before: {
        keep: { id: keep.id, vendor_code: keep.vendor_code, display_name: keep.display_name },
        absorbed: {
          id: absorb.id,
          vendor_code: absorb.vendor_code,
          display_name: absorb.display_name,
          contact_email: absorb.contact_email,
          owner_user_id: absorb.owner_user_id,
        },
      },
      after: {
        surviving_listing_id: input.survivingListingId,
        deleted_listing_ids: deletedListingIds,
        hidden_listing_ids: hiddenListingIds,
        fields_filled: filled,
        rows_moved: rowsMoved,
        rows_left_on_absorbed: rowsLeft,
      },
    });

    if (Object.keys(rowsLeft).length > 0) {
      log.info("vendor.merge_left_rows_on_absorbed", { keepId, absorbId, rowsLeft });
    }

    return {
      keep_vendor_account_id: keepId,
      absorbed_vendor_account_id: absorbId,
      absorbed_owner_user_id: absorb.owner_user_id,
      surviving_listing_id: input.survivingListingId,
      deleted_listing_ids: deletedListingIds,
      hidden_listing_ids: hiddenListingIds,
      fields_filled: filled,
      rows_moved: rowsMoved,
      rows_left_on_absorbed: rowsLeft,
    };
  });

  return merge();
}
