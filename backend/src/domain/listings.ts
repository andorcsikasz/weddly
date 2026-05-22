// Unified `listings` table — the public-facing directory card for any source.
// Pairs with `vendor_accounts` (legal payee). Decided via multi-agent debate
// 2026-05-21 in conversation; see [[feedback_multi_agent_debate]].
//
// Architecture (P2.A):
//   - Curated entries (suppliers_data.ts) are mirrored into the DB on every
//     boot via an idempotent `INSERT … ON CONFLICT DO UPDATE` short-circuited
//     by a content_hash — identical rows skip the UPDATE entirely.
//   - Community submissions live in `community_suppliers` (the existing write
//     path); a dual-write helper here syncs every change into `listings` so
//     downstream reads can target one table.
//   - Phase 2.5 vendor self-serve onboarding will write 'claimed' rows
//     directly into `listings` with ids `v{N}`.
//
// The existing `supplier_id` strings on couple_picks / couple_supplier_costs /
// supplier_votes / supplier_events already match the new `listings.id` shape
// (curated slug or "c{N}"), so no data migration is required. The invariant
// "supplier_id targets listings.id" is documented, not enforced via FK — that
// hardening lands in a later additive pass once vendor onboarding ships.

import { createHash } from "node:crypto";
import { db, now } from "../db";
import { DIRECTORY } from "./suppliers_data";
import type { CommunitySupplierRow } from "./community_suppliers";
import type {
  Listing,
  ListingSource,
  ListingStatus,
  ListingSubmitterType,
  VendorAccount,
} from "@shared/listings";
import type { SupplierCategory } from "@shared/suppliers";

export interface ListingRow {
  id: string;
  source: string;
  vendor_account_id: number | null;
  category: string;
  name: string;
  city: string;
  address: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  blurb_hu: string | null;
  blurb_en: string | null;
  price_band: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  lat: number | null;
  lng: number | null;
  submitter_type: string | null;
  status: string;
  content_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface VendorAccountRow {
  id: number;
  owner_user_id: number;
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  created_at: number;
  updated_at: number;
}

/** Defensive narrow on the wire enums so any legacy/bad row still renders. */
function toListingSource(raw: string): ListingSource {
  return raw === "curated" || raw === "claimed" ? raw : "community";
}
function toListingStatus(raw: string): ListingStatus {
  if (raw === "pending" || raw === "awaiting_review" || raw === "hidden") return raw;
  return "active";
}
function toListingSubmitterType(raw: string | null): ListingSubmitterType {
  if (raw === "self") return "self";
  if (raw === "user") return "user";
  return null;
}
function clampPriceBand(v: number | null): 1 | 2 | 3 | 4 | 5 | null {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return null;
}

export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    source: toListingSource(row.source),
    vendor_account_id: row.vendor_account_id,
    category: row.category as SupplierCategory,
    name: row.name,
    city: row.city,
    address: row.address,
    website: row.website,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    blurb_hu: row.blurb_hu,
    blurb_en: row.blurb_en,
    price_band: clampPriceBand(row.price_band),
    capacity_min: row.capacity_min,
    capacity_max: row.capacity_max,
    lat: row.lat,
    lng: row.lng,
    submitter_type: toListingSubmitterType(row.submitter_type),
    status: toListingStatus(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toVendorAccount(row: VendorAccountRow): VendorAccount {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    display_name: row.display_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    vat_number: row.vat_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Idempotent upsert + content-hash short-circuit ─────────────────────────
//
// The ON CONFLICT clause only UPDATEs when content_hash actually changed, so
// every subsequent boot is a no-op for unchanged curated rows. `created_at` is
// excluded from the UPDATE list so the original landed-at timestamp is
// preserved across re-syncs.

const upsertListingStmt = db.prepare(`
  INSERT INTO listings (
    id, source, vendor_account_id, category, name, city, address, website,
    contact_email, contact_phone, blurb_hu, blurb_en, price_band,
    capacity_min, capacity_max, lat, lng, submitter_type, status, content_hash,
    created_at, updated_at
  ) VALUES (
    $id, $source, $vendor_account_id, $category, $name, $city, $address, $website,
    $contact_email, $contact_phone, $blurb_hu, $blurb_en, $price_band,
    $capacity_min, $capacity_max, $lat, $lng, $submitter_type, $status, $content_hash,
    $created_at, $updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    source            = excluded.source,
    vendor_account_id = excluded.vendor_account_id,
    category          = excluded.category,
    name              = excluded.name,
    city              = excluded.city,
    address           = excluded.address,
    website           = excluded.website,
    contact_email     = excluded.contact_email,
    contact_phone     = excluded.contact_phone,
    blurb_hu          = excluded.blurb_hu,
    blurb_en          = excluded.blurb_en,
    price_band        = excluded.price_band,
    capacity_min      = excluded.capacity_min,
    capacity_max      = excluded.capacity_max,
    lat               = excluded.lat,
    lng               = excluded.lng,
    submitter_type    = excluded.submitter_type,
    status            = excluded.status,
    content_hash      = excluded.content_hash,
    updated_at        = excluded.updated_at
  WHERE listings.content_hash IS NULL OR listings.content_hash != excluded.content_hash
`);

const deleteListingStmt = db.prepare("DELETE FROM listings WHERE id = ?");

const getCommunityRowStmt = db.prepare("SELECT * FROM community_suppliers WHERE id = ?");

function hashCuratedEntry(e: (typeof DIRECTORY)[number]): string {
  // Fields that, if changed in suppliers_data.ts, should trigger a re-sync.
  // Excludes the id (PK, can't change without making a new row) and source
  // (always 'curated' here).
  const payload = JSON.stringify([
    e.category,
    e.name,
    e.city,
    e.address ?? null,
    e.website,
    e.contact_email,
    e.contact_phone,
    e.blurb_hu,
    e.blurb_en,
    e.price_band,
    e.capacity_min,
    e.capacity_max,
    e.lat,
    e.lng,
  ]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function hashCommunityRow(r: CommunitySupplierRow): string {
  const payload = JSON.stringify([
    r.category,
    r.name,
    r.city,
    r.address,
    r.website,
    r.contact_email,
    r.contact_phone,
    r.blurb,
    r.price_band,
    r.submitter_type,
    r.status,
  ]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Sync (insert-or-update) a `listings` row for the given community supplier
 * row. Called from `community_suppliers.ts` on every write so the `listings`
 * table stays current without needing reads to fall back. Idempotent.
 *
 * Community submissions don't carry capacity / lat / lng yet (the form
 * doesn't collect them) — those columns stay null on the mirrored row.
 */
export function syncListingFromCommunityRow(row: CommunitySupplierRow): void {
  const ts = now();
  upsertListingStmt.run({
    $id: `c${row.id}`,
    $source: "community",
    $vendor_account_id: null,
    $category: row.category,
    $name: row.name,
    $city: row.city,
    $address: row.address,
    $website: row.website,
    $contact_email: row.contact_email,
    $contact_phone: row.contact_phone,
    $blurb_hu: row.blurb,
    $blurb_en: row.blurb,
    $price_band: row.price_band,
    $capacity_min: null,
    $capacity_max: null,
    $lat: null,
    $lng: null,
    $submitter_type: row.submitter_type === "self" ? "self" : "user",
    $status: row.status,
    $content_hash: hashCommunityRow(row),
    $created_at: ts,
    $updated_at: ts,
  });
}

/**
 * Convenience wrapper: fetch the community row by id and sync it. If the row
 * no longer exists (it was deleted), the mirrored listing is removed too.
 * Centralises the "after every write, mirror state" call site.
 */
export function syncListingFromCommunityId(communityId: number): void {
  const row = getCommunityRowStmt.get(communityId) as CommunitySupplierRow | undefined;
  if (!row) {
    deleteListingStmt.run(`c${communityId}`);
    return;
  }
  syncListingFromCommunityRow(row);
}

/** Hard-delete the mirrored listing for a deleted community supplier. */
export function deleteListingForCommunityId(communityId: number): void {
  deleteListingStmt.run(`c${communityId}`);
}

/**
 * Boot-time backfill. Mirrors every curated entry from suppliers_data.ts and
 * every existing community_suppliers row into the `listings` table. Wrapped
 * in a single transaction so a half-applied run doesn't leave partial state.
 * Safe to call on every boot — the content_hash short-circuit means
 * unchanged rows are no-ops.
 *
 * Returns counts for the boot log so operators can see the materialisation
 * happened at the expected size.
 */
export function backfillListings(): { curated: number; community: number } {
  const ts = now();
  let curated = 0;
  let community = 0;

  const run = db.transaction(() => {
    for (const entry of DIRECTORY) {
      upsertListingStmt.run({
        $id: entry.id,
        $source: "curated",
        $vendor_account_id: null,
        $category: entry.category,
        $name: entry.name,
        $city: entry.city,
        $address: entry.address ?? null,
        $website: entry.website,
        $contact_email: entry.contact_email,
        $contact_phone: entry.contact_phone,
        $blurb_hu: entry.blurb_hu,
        $blurb_en: entry.blurb_en,
        $price_band: entry.price_band,
        $capacity_min: entry.capacity_min,
        $capacity_max: entry.capacity_max,
        $lat: entry.lat,
        $lng: entry.lng,
        $submitter_type: null,
        $status: "active",
        $content_hash: hashCuratedEntry(entry),
        $created_at: ts,
        $updated_at: ts,
      });
      curated++;
    }

    const rows = db.prepare("SELECT * FROM community_suppliers").all() as CommunitySupplierRow[];
    for (const r of rows) {
      syncListingFromCommunityRow(r);
      community++;
    }
  });
  run();

  return { curated, community };
}

// ── Read helpers (forward-looking; not yet wired into routes) ──────────────
//
// `routes/suppliers.ts` still reads from curated + community directly in P2.A
// to keep the public API surface untouched. Phase 2.5 (vendor onboarding)
// will switch reads here. Helpers exposed now so the test suite + later
// migrations have a typed entry point.

export function getListingById(id: string): Listing | null {
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as ListingRow | undefined;
  return row ? toListing(row) : null;
}

/** Pull the (at most one in v1) listing owned by a vendor account. Returns
 *  the most-recently-updated row when an account owns multiple — the schema
 *  permits N:1 but P2.D's UI presents a single listing. */
export function getListingByVendorAccountId(vendorAccountId: number): Listing | null {
  const row = db
    .prepare("SELECT * FROM listings WHERE vendor_account_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(vendorAccountId) as ListingRow | undefined;
  return row ? toListing(row) : null;
}

/** Patch the editable fields on a listing. Caller is responsible for the
 *  authorisation check (P2.D: vendor must own the listing via
 *  `vendor_account_id`); this helper just runs the UPDATE. Returns the
 *  freshly-read row so the caller can ship the updated view in one round
 *  trip. Skips columns left undefined; explicit `null` clears the column. */
export interface ListingPatch {
  city?: string;
  address?: string | null;
  website?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  blurb_hu?: string | null;
  blurb_en?: string | null;
  price_band?: 1 | 2 | 3 | 4 | 5 | null;
  capacity_min?: number | null;
  capacity_max?: number | null;
}

export function patchListing(id: string, patch: ListingPatch): Listing | null {
  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];
  const push = (col: string, val: string | number | null | undefined) => {
    if (val === undefined) return;
    setClauses.push(`${col} = ?`);
    params.push(val);
  };
  push("city", patch.city);
  push("address", patch.address);
  push("website", patch.website);
  push("contact_email", patch.contact_email);
  push("contact_phone", patch.contact_phone);
  push("blurb_hu", patch.blurb_hu);
  push("blurb_en", patch.blurb_en);
  push("price_band", patch.price_band);
  push("capacity_min", patch.capacity_min);
  push("capacity_max", patch.capacity_max);
  if (setClauses.length === 0) {
    // No-op patch — return the row unchanged.
    return getListingById(id);
  }
  setClauses.push("updated_at = ?");
  params.push(now());
  params.push(id);
  db.prepare(`UPDATE listings SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
  return getListingById(id);
}

export function listListingsByCategory(category: SupplierCategory | null): Listing[] {
  const rows = (
    category
      ? db
          .prepare(
            "SELECT * FROM listings WHERE category = ? AND status = 'active' ORDER BY created_at DESC",
          )
          .all(category)
      : db.prepare("SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC").all()
  ) as ListingRow[];
  return rows.map(toListing);
}
