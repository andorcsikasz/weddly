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
import { DIRECTORY, curatedCountry } from "./suppliers_data";
import type { CommunitySupplierRow } from "./community_suppliers";
import type {
  Listing,
  ListingPhoto,
  ListingSource,
  ListingStatus,
  ListingSubmitterType,
  VendorAccount,
} from "@shared/listings";
import type { ListingPackage } from "@shared/listing_packages";
import type { ListingVideo, VideoProvider } from "@shared/listing_videos";
import {
  type DirectorySupplierBase,
  formatSpokenLanguages,
  parseSpokenLanguages,
  type SupplierCategory,
  type VenueStyle,
  VENUE_STYLES,
} from "@shared/suppliers";

export interface ListingRow {
  id: string;
  source: string;
  vendor_account_id: number | null;
  category: string;
  custom_category: string | null;
  name: string;
  city: string;
  address: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  blurb_hu: string | null;
  blurb_en: string | null;
  price_band: number | null;
  price_band_changed_at: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  spoken_languages: string | null;
  venue_style: string | null;
  lat: number | null;
  lng: number | null;
  submitter_type: string | null;
  status: string;
  content_hash: string | null;
  hero_image_url: string | null;
  hide_contact_public: number;
  created_at: number;
  updated_at: number;
}

export interface VendorAccountRow {
  id: number;
  vendor_code: string | null;
  owner_user_id: number;
  display_name: string;
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  country: string | null;
  registry_number: string | null;
  legal_form: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  onboarding_done: number;
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
function toVenueStyle(raw: string | null): VenueStyle | null {
  return raw !== null && (VENUE_STYLES as string[]).includes(raw) ? (raw as VenueStyle) : null;
}

export function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    source: toListingSource(row.source),
    vendor_account_id: row.vendor_account_id,
    category: row.category as SupplierCategory,
    custom_category: row.custom_category,
    name: row.name,
    city: row.city,
    address: row.address,
    website: row.website,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    blurb_hu: row.blurb_hu,
    blurb_en: row.blurb_en,
    price_band: clampPriceBand(row.price_band),
    price_band_changed_at: row.price_band_changed_at,
    capacity_min: row.capacity_min,
    capacity_max: row.capacity_max,
    spoken_languages: parseSpokenLanguages(row.spoken_languages),
    venue_style: toVenueStyle(row.venue_style),
    lat: row.lat,
    lng: row.lng,
    submitter_type: toListingSubmitterType(row.submitter_type),
    status: toListingStatus(row.status),
    hero_image_url: row.hero_image_url,
    hide_contact_public: row.hide_contact_public === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toVendorAccount(row: VendorAccountRow): VendorAccount {
  return {
    id: row.id,
    vendor_code: row.vendor_code,
    owner_user_id: row.owner_user_id,
    display_name: row.display_name,
    company_name: row.company_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    vat_number: row.vat_number,
    country: row.country,
    registry_number: row.registry_number,
    legal_form: row.legal_form,
    address: row.address,
    city: row.city,
    postal_code: row.postal_code,
    onboarding_done: row.onboarding_done === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Registered-vendor ('claimed') directory cards ──────────────────────────
//
// The public directory (routes/suppliers.ts) merges the static curated list +
// active community submissions. A vendor's OWN standalone listing (self-serve
// signup or admin convert-to-vendor: id `v{N}`, source='claimed') isn't in
// either set, so these helpers surface them there too — the "active suppliers
// show up among the vendors" behaviour. Country is taken from the owning
// vendor account (default HU); suspended owners + demo accounts are dropped.

/** ListingRow joined to its owner's country + legal company name for the
 *  directory card mapper. */
interface ClaimedDirectoryRow extends ListingRow {
  owner_country: string | null;
  owner_company_name: string | null;
}

const CLAIMED_DIRECTORY_FROM = `
  FROM listings l
  JOIN vendor_accounts va ON va.id = l.vendor_account_id
  JOIN users u ON u.id = va.owner_user_id
 WHERE l.source = 'claimed'
   AND l.status = 'active'
   AND u.status = 'active'
   AND u.email NOT LIKE '%@demo.weddly.local'`;

function claimedListingToDirectoryBase(row: ClaimedDirectoryRow): DirectorySupplierBase {
  return {
    id: row.id,
    name: row.name,
    company_name: row.owner_company_name,
    category: row.category as SupplierCategory,
    city: row.city,
    country: (row.owner_country ?? "HU").toUpperCase(),
    blurb_hu: row.blurb_hu ?? "",
    blurb_en: row.blurb_en ?? "",
    website: row.website ?? "",
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    address: row.address,
    capacity_min: row.capacity_min,
    capacity_max: row.capacity_max,
    spoken_languages: parseSpokenLanguages(row.spoken_languages),
    venue_style: toVenueStyle(row.venue_style),
    lat: row.lat,
    lng: row.lng,
    source: "claimed",
    // A registered vendor listed themselves — mirrors the 'self' marker on a
    // self-submitted community entry.
    submitter_type: "self",
    price_band: clampPriceBand(row.price_band),
    vendor_account_id: row.vendor_account_id,
    hero_image_url: row.hero_image_url,
    gallery_urls: null,
  };
}

/** Active standalone registered-vendor listings for the public directory,
 *  optionally category-filtered. The route dedupes these by id against the
 *  curated+community set (a vendor who CLAIMED a curated/community entry keeps
 *  that entry's id, so it already shows there). */
export function listActiveClaimedListingsForDirectory(
  category?: SupplierCategory | null,
): DirectorySupplierBase[] {
  const select = `SELECT l.*, va.country AS owner_country, va.company_name AS owner_company_name ${CLAIMED_DIRECTORY_FROM}`;
  const rows = (
    category
      ? db.prepare(`${select} AND l.category = ? ORDER BY l.created_at DESC`).all(category)
      : db.prepare(`${select} ORDER BY l.created_at DESC`).all()
  ) as ClaimedDirectoryRow[];
  return rows.map(claimedListingToDirectoryBase);
}

/** Resolve one active registered-vendor listing to its directory base (for the
 *  detail + website-redirect paths, which key off the listing id). Null when
 *  the id isn't a live claimed listing (or its owner is suspended / demo). */
export function getClaimedDirectoryBaseById(id: string): DirectorySupplierBase | null {
  const row = db
    .prepare(
      `SELECT l.*, va.country AS owner_country, va.company_name AS owner_company_name ${CLAIMED_DIRECTORY_FROM} AND l.id = ?`,
    )
    .get(id) as ClaimedDirectoryRow | undefined;
  return row ? claimedListingToDirectoryBase(row) : null;
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
    capacity_min, capacity_max, venue_style, lat, lng, submitter_type, status, content_hash,
    created_at, updated_at
  ) VALUES (
    $id, $source, $vendor_account_id, $category, $name, $city, $address, $website,
    $contact_email, $contact_phone, $blurb_hu, $blurb_en, $price_band,
    $capacity_min, $capacity_max, $venue_style, $lat, $lng, $submitter_type, $status, $content_hash,
    $created_at, $updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    source            = excluded.source,
    -- COALESCE keeps an existing claim: the curated/community sync paths pass
    -- NULL here (they don't know about claims), and clobbering the linkage
    -- would silently detach a vendor from their listing on every re-sync
    -- (e.g. an admin hide/unhide of a claimed community card).
    vendor_account_id = COALESCE(excluded.vendor_account_id, listings.vendor_account_id),
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
    venue_style       = excluded.venue_style,
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
    e.venue_style,
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
    // community_suppliers.price_band is NOT NULL and uses 0 as "unpriced"; the
    // listings mirror is nullable, so normalize the sentinel (and any junk) to
    // null — the public card then shows no price instead of a phantom "$".
    $price_band: row.price_band >= 1 && row.price_band <= 5 ? row.price_band : null,
    $capacity_min: null,
    $capacity_max: null,
    $venue_style: null,
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
        $venue_style: entry.venue_style,
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

/** Whether this listing's owner opted to hide the address + contact-email tail
 *  from anonymous visitors. False for curated/community ids (no `listings` row
 *  or the column defaults 0) — only vendor-owned claimed listings can opt in.
 *  A single indexed lookup so the public detail route can gate masking without
 *  widening the public DTO with an internal flag. */
export function listingContactHidden(id: string): boolean {
  const row = db.prepare("SELECT hide_contact_public FROM listings WHERE id = ?").get(id) as
    | { hide_contact_public: number }
    | undefined;
  return row?.hide_contact_public === 1;
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

/** Every listing a vendor account owns (any status), newest-updated first.
 *  The data export uses this — unlike the single-listing UI resolver above,
 *  a multi-listing account gets all of its rows. */
export function listListingsByVendorAccountId(vendorAccountId: number): Listing[] {
  const rows = db
    .prepare("SELECT * FROM listings WHERE vendor_account_id = ? ORDER BY updated_at DESC")
    .all(vendorAccountId) as ListingRow[];
  return rows.map(toListing);
}

export interface ShowcaseVendorRow {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  hero_image_url: string;
  /** 'curated' | 'community' | 'claimed'. `claimed` is the directory's
   *  verified-vendor signal (the business itself is on Weddly). */
  source: string;
  /** ISO 3166-1 alpha-2, uppercase. Derived, not stored — see below. */
  country: string;
  /** Google Places average, or null when never resolved (no API key, a miss,
   *  or an unrated place). Ranking input only; never rendered, which keeps us
   *  clear of Google's attribution requirements for displayed ratings. */
  google_rating: number | null;
  created_at: number;
  /** WGS-84 coords, null on listings we never placed. Feeds the "nearby" block
   *  the teaser attaches when a town filter comes back nearly empty: without a
   *  coordinate a listing simply can't be offered as 40 km from anywhere. */
  lat: number | null;
  lng: number | null;
}

/** Every directory listing eligible for the public browse teaser: a real hero
 *  photo, active, and not tombstoned in `curated_supplier_overrides` (which
 *  does NOT flip the listing's own status). Ordering, the per-category cap and
 *  the country filter live in the route — the set is small enough to shape in
 *  memory, and `country` isn't a column here (see below), so sorting on it in
 *  SQL would mean duplicating the derivation in two languages.
 *
 *  Country derivation mirrors the directory mappers: a claimed listing inherits
 *  its vendor account's country, everything else reads the ", XX" suffix the
 *  curated batches carry on `city` (defaulting to HU). */
export function listShowcaseCandidates(): ShowcaseVendorRow[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.category, l.city, l.hero_image_url, l.source, l.created_at,
              l.google_rating, l.lat, l.lng, va.country AS owner_country
         FROM listings l
         LEFT JOIN vendor_accounts va ON va.id = l.vendor_account_id
        WHERE l.hero_image_url IS NOT NULL AND l.hero_image_url != ''
          AND l.status = 'active'
          AND l.id NOT IN (SELECT supplier_id FROM curated_supplier_overrides)`,
    )
    .all() as (Omit<ShowcaseVendorRow, "country"> & { owner_country: string | null })[];
  return rows.map(({ owner_country, ...r }) => ({
    ...r,
    country:
      r.source === "claimed" && owner_country
        ? owner_country.toUpperCase()
        : curatedCountry(r.id, r.city),
  }));
}

export interface SearchListingRow {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  source: string;
  country: string;
  google_rating: number | null;
  /** 1 when the listing carries a real hero photo. The browse teaser only
   *  shows photographed listings, so city/category suggestions are counted
   *  over these; a name hit is offered either way, since the public profile
   *  reads fine without a cover. */
  has_photo: 0 | 1;
}

/** Every listing the public typeahead may return: active and not tombstoned,
 *  with or without a photo. Same eligibility as `listShowcaseCandidates` minus
 *  the photo requirement, and the same country derivation. */
export function listSearchCandidates(): SearchListingRow[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.name, l.category, l.city, l.source, l.google_rating,
              CASE WHEN l.hero_image_url IS NOT NULL AND l.hero_image_url != '' THEN 1 ELSE 0 END AS has_photo,
              va.country AS owner_country
         FROM listings l
         LEFT JOIN vendor_accounts va ON va.id = l.vendor_account_id
        WHERE l.status = 'active'
          AND l.id NOT IN (SELECT supplier_id FROM curated_supplier_overrides)`,
    )
    .all() as (Omit<SearchListingRow, "country"> & { owner_country: string | null })[];
  return rows.map(({ owner_country, ...r }) => ({
    ...r,
    country:
      r.source === "claimed" && owner_country
        ? owner_country.toUpperCase()
        : curatedCountry(r.id, r.city),
  }));
}

/** Create a fresh 'claimed' listing for a newly-onboarded vendor — one that
 *  came through the waitlist and so has NO existing directory row to claim.
 *  id = 'v' + accountId per the listings id convention. Seeded with the
 *  business name + category + city from the waitlist; the vendor fills the rest
 *  (blurb, photo, pricing, capacity) in the editor. Goes live immediately
 *  (status 'active') because the vendor was already vetted at the waitlist
 *  accept step. Idempotent on the id via the upsert. */
export function createVendorListing(input: {
  vendorAccountId: number;
  category: string;
  /** Vendor-written label behind category='other'; see Listing.custom_category. */
  customCategory?: string | null;
  name: string;
  city: string;
  contactEmail: string | null;
  /** Optional seed from the vendor's earlier submission (e.g. the waitlist
   *  application or the signup company step). Carried onto the fresh listing
   *  so the vendor doesn't re-type details they already gave us. */
  website?: string | null;
  address?: string | null;
  contactPhone?: string | null;
}): Listing {
  const ts = now();
  const id = `v${input.vendorAccountId}`;
  upsertListingStmt.run({
    $id: id,
    $source: "claimed",
    $vendor_account_id: input.vendorAccountId,
    $category: input.category,
    $name: input.name,
    $city: input.city,
    $address: input.address ?? null,
    $website: input.website ?? null,
    $contact_email: input.contactEmail,
    $contact_phone: input.contactPhone ?? null,
    $blurb_hu: null,
    $blurb_en: null,
    $price_band: null,
    $capacity_min: null,
    $capacity_max: null,
    $venue_style: null,
    $lat: null,
    $lng: null,
    $submitter_type: "self",
    $status: "active",
    $content_hash: null,
    $created_at: ts,
    $updated_at: ts,
  });
  // custom_category is written outside the shared upsert so the curated /
  // community sync paths never have to carry (or clobber) the column.
  if (input.customCategory !== undefined) {
    db.prepare("UPDATE listings SET custom_category = ? WHERE id = ?").run(
      input.customCategory ?? null,
      id,
    );
  }
  const row = getListingById(id);
  if (!row) throw new Error("vendor listing create failed");
  return row;
}

/** Admin override of a vendor's listing category. Applies to every listing the
 *  vendor owns (a claimed vendor has exactly one, `v{accountId}`). `other` keeps
 *  the free-text `custom_category`; any real category clears it. Returns how
 *  many listing rows were touched (0 when the vendor has no listing yet). */
export function setVendorListingCategory(vendorAccountId: number, category: string): number {
  const ts = now();
  const sql =
    category === "other"
      ? "UPDATE listings SET category = ?, updated_at = ? WHERE vendor_account_id = ?"
      : "UPDATE listings SET category = ?, custom_category = NULL, updated_at = ? WHERE vendor_account_id = ?";
  return db.prepare(sql).run(category, ts, vendorAccountId).changes;
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
  /** Set by the vendor route when an accepted patch CHANGES a published
   *  band; anchors the 30-day cooldown (shared/listings.ts). Never set by
   *  admin/sync paths. */
  price_band_changed_at?: number;
  capacity_min?: number | null;
  capacity_max?: number | null;
  /** ISO 639-1 codes for a verbal vendor; stored comma-separated. */
  spoken_languages?: string[] | null;
  /** Vendor opt-in to hide the address + contact-email tail from anonymous
   *  visitors on the public page. Stored as 0/1; the phone is masked for
   *  anonymous visitors regardless of this flag. */
  hide_contact_public?: boolean;
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
  push("price_band_changed_at", patch.price_band_changed_at);
  push("capacity_min", patch.capacity_min);
  push("capacity_max", patch.capacity_max);
  push(
    "spoken_languages",
    patch.spoken_languages === undefined
      ? undefined
      : formatSpokenLanguages(patch.spoken_languages ?? []),
  );
  push(
    "hide_contact_public",
    patch.hide_contact_public === undefined ? undefined : patch.hide_contact_public ? 1 : 0,
  );
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

// ── Listing photo gallery ────────────────────────────────────────────────────
// Portfolio photos beyond the single hero image. Oldest first so the vendor's
// upload order is the display order.

export function listListingPhotos(listingId: string): ListingPhoto[] {
  return db
    .prepare(
      "SELECT id, url, position_y, created_at FROM listing_photos WHERE listing_id = ? ORDER BY id ASC",
    )
    .all(listingId) as ListingPhoto[];
}

export function countListingPhotos(listingId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM listing_photos WHERE listing_id = ?")
    .get(listingId) as { n: number };
  return row.n;
}

export function addListingPhoto(listingId: string, url: string): ListingPhoto {
  const ts = now();
  const res = db
    .prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)")
    .run(listingId, url, ts);
  return { id: Number(res.lastInsertRowid), url, position_y: 50, created_at: ts };
}

export function getListingPhoto(listingId: string, photoId: number): ListingPhoto | null {
  const row = db
    .prepare(
      "SELECT id, url, position_y, created_at FROM listing_photos WHERE id = ? AND listing_id = ?",
    )
    .get(photoId, listingId) as ListingPhoto | undefined;
  return row ?? null;
}

/** Move a gallery photo's vertical focal point. Callers clamp to 0..100 at the
 *  route boundary; this just writes. Scoped by listing so a foreign photo id
 *  is a no-op rather than a cross-tenant write. */
export function setListingPhotoPositionY(
  listingId: string,
  photoId: number,
  positionY: number,
): void {
  db.prepare("UPDATE listing_photos SET position_y = ? WHERE id = ? AND listing_id = ?").run(
    positionY,
    photoId,
    listingId,
  );
}

export function deleteListingPhoto(listingId: string, photoId: number): void {
  db.prepare("DELETE FROM listing_photos WHERE id = ? AND listing_id = ?").run(photoId, listingId);
}

// ── Listing video reel ───────────────────────────────────────────────────────
// Reference videos (YouTube today) beside the photo gallery. Ordered by the
// vendor's drag `position`, `id` as the stable tie-breaker so equal positions
// (never expected, but cheap to be safe) stay deterministic.

type ListingVideoRow = {
  id: number;
  provider: string;
  video_id: string;
  url: string;
  position: number;
};

function toListingVideo(row: ListingVideoRow): ListingVideo {
  return {
    id: row.id,
    provider: row.provider as VideoProvider,
    video_id: row.video_id,
    url: row.url,
    position: row.position,
  };
}

export function listListingVideos(listingId: string): ListingVideo[] {
  const rows = db
    .prepare(
      "SELECT id, provider, video_id, url, position FROM listing_videos WHERE listing_id = ? ORDER BY position ASC, id ASC",
    )
    .all(listingId) as ListingVideoRow[];
  return rows.map(toListingVideo);
}

export function countListingVideos(listingId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM listing_videos WHERE listing_id = ?")
    .get(listingId) as { n: number };
  return row.n;
}

/** Append a video to the end of the reel — its `position` is one past the
 *  current max so a fresh add always lands last, honouring insertion order
 *  until the vendor drags. */
export function addListingVideo(
  listingId: string,
  provider: VideoProvider,
  videoId: string,
  url: string,
): ListingVideo {
  const ts = now();
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) AS max_pos FROM listing_videos WHERE listing_id = ?",
    )
    .get(listingId) as { max_pos: number };
  const position = maxRow.max_pos + 1;
  const res = db
    .prepare(
      "INSERT INTO listing_videos (listing_id, provider, video_id, url, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(listingId, provider, videoId, url, position, ts);
  return { id: Number(res.lastInsertRowid), provider, video_id: videoId, url, position };
}

export function getListingVideo(listingId: string, videoId: number): ListingVideo | null {
  const row = db
    .prepare(
      "SELECT id, provider, video_id, url, position FROM listing_videos WHERE id = ? AND listing_id = ?",
    )
    .get(videoId, listingId) as ListingVideoRow | undefined;
  return row ? toListingVideo(row) : null;
}

/** Replace the link on an existing video row (edit flow) — keeps its `id` and
 *  `position` so an in-place edit never reshuffles the reel. Scoped by
 *  listing_id so a stray id from another listing is a no-op. */
export function updateListingVideo(
  listingId: string,
  videoId: number,
  provider: VideoProvider,
  parsedId: string,
  url: string,
): void {
  db.prepare(
    "UPDATE listing_videos SET provider = ?, video_id = ?, url = ? WHERE id = ? AND listing_id = ?",
  ).run(provider, parsedId, url, videoId, listingId);
}

export function deleteListingVideo(listingId: string, videoId: number): void {
  db.prepare("DELETE FROM listing_videos WHERE id = ? AND listing_id = ?").run(videoId, listingId);
}

/** Persist a drag reorder: assign `position` = array index for the ids the
 *  listing actually owns, in one transaction. Ids not owned by the listing are
 *  ignored (a partial/stale client list can't corrupt another listing's reel);
 *  ids the client omits keep their old position and sort after the reordered
 *  ones on the next read. */
export function reorderListingVideos(listingId: string, orderedIds: number[]): void {
  const owned = new Set(
    (
      db.prepare("SELECT id FROM listing_videos WHERE listing_id = ?").all(listingId) as {
        id: number;
      }[]
    ).map((r) => r.id),
  );
  const stmt = db.prepare("UPDATE listing_videos SET position = ? WHERE id = ? AND listing_id = ?");
  const tx = db.transaction((ids: number[]) => {
    let pos = 0;
    for (const id of ids) {
      if (!owned.has(id)) continue;
      stmt.run(pos, id, listingId);
      pos += 1;
    }
  });
  tx(orderedIds);
}

// ── Listing packages (árajánlat / price offers) ──────────────────────────────
// Named price tiers a claimed vendor publishes on their listing (max enforced
// in the route). Oldest first so creation order is display order — same
// treatment as the photo gallery. `price_text` is free-text; the optional PDF
// lives at listings/<id>/packages/<packageId>.pdf.

type ListingPackageRow = {
  id: number;
  name: string;
  price_text: string | null;
  description: string | null;
  pdf_url: string | null;
  pdf_name: string | null;
};

function toListingPackage(row: ListingPackageRow): ListingPackage {
  return {
    id: row.id,
    name: row.name,
    price_text: row.price_text,
    description: row.description,
    pdf_url: row.pdf_url,
    pdf_name: row.pdf_name,
  };
}

const PACKAGE_COLS = "id, name, price_text, description, pdf_url, pdf_name";

export function listListingPackages(listingId: string): ListingPackage[] {
  const rows = db
    .prepare(`SELECT ${PACKAGE_COLS} FROM listing_packages WHERE listing_id = ? ORDER BY id ASC`)
    .all(listingId) as ListingPackageRow[];
  return rows.map(toListingPackage);
}

export function countListingPackages(listingId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM listing_packages WHERE listing_id = ?")
    .get(listingId) as { n: number };
  return row.n;
}

export function addListingPackage(
  listingId: string,
  input: { name: string; price_text: string | null; description: string | null },
): ListingPackage {
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO listing_packages (listing_id, name, price_text, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(listingId, input.name, input.price_text, input.description, ts, ts);
  return {
    id: Number(res.lastInsertRowid),
    name: input.name,
    price_text: input.price_text,
    description: input.description,
    pdf_url: null,
    pdf_name: null,
  };
}

export function getListingPackage(listingId: string, packageId: number): ListingPackage | null {
  const row = db
    .prepare(`SELECT ${PACKAGE_COLS} FROM listing_packages WHERE id = ? AND listing_id = ?`)
    .get(packageId, listingId) as ListingPackageRow | undefined;
  return row ? toListingPackage(row) : null;
}

/** Partial update of a package's text fields — only present keys are applied,
 *  scoped by listing_id so a stray id from another listing is a no-op. */
export function updateListingPackage(
  listingId: string,
  packageId: number,
  patch: { name?: string; price_text?: string | null; description?: string | null },
): void {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.price_text !== undefined) {
    sets.push("price_text = ?");
    vals.push(patch.price_text);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    vals.push(patch.description);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  db.prepare(`UPDATE listing_packages SET ${sets.join(", ")} WHERE id = ? AND listing_id = ?`).run(
    ...vals,
    now(),
    packageId,
    listingId,
  );
}

export function setListingPackagePdf(
  listingId: string,
  packageId: number,
  pdfUrl: string,
  pdfName: string,
): void {
  db.prepare(
    "UPDATE listing_packages SET pdf_url = ?, pdf_name = ?, updated_at = ? WHERE id = ? AND listing_id = ?",
  ).run(pdfUrl, pdfName, now(), packageId, listingId);
}

export function clearListingPackagePdf(listingId: string, packageId: number): void {
  db.prepare(
    "UPDATE listing_packages SET pdf_url = NULL, pdf_name = NULL, updated_at = ? WHERE id = ? AND listing_id = ?",
  ).run(now(), packageId, listingId);
}

export function deleteListingPackage(listingId: string, packageId: number): void {
  db.prepare("DELETE FROM listing_packages WHERE id = ? AND listing_id = ?").run(
    packageId,
    listingId,
  );
}

export interface DirectoryMatch {
  id: string;
  name: string;
  city: string | null;
  source: string;
}

// Shared platforms where the hostname is NOT a unique business identifier — a
// vendor's "website" is often just their social page. Matching on these hosts
// would flag two different vendors (facebook.com/A vs /B) as the same listing,
// so we skip the hostname match for them and fall back to name+city.
const GENERIC_WEB_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "google.com",
  "maps.google.com",
  "goo.gl",
  "linktr.ee",
  "linktree.com",
  "wa.me",
  "wixsite.com",
  "business.site",
  "sites.google.com",
  "pinterest.com",
]);

function hostnameOf(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  try {
    const h = new URL(w).hostname
      .replace(/^www\./, "")
      .replace(/^m\./, "")
      .toLowerCase();
    if (!h || GENERIC_WEB_HOSTS.has(h)) return null;
    return h;
  } catch {
    return null;
  }
}

/** Is this supplier ALREADY live in the public directory? Lets a submission warn
 *  the submitter that their suggestion duplicates an existing listing — curated,
 *  claimed, or an already-approved community entry — so we point them to it
 *  instead of queuing a dupe. Website hostname is the strong signal (prefer a
 *  claimed/curated hit); an exact name+city match is the fallback. Only 'active'
 *  (publicly visible) rows count — a pending entry isn't "on the site" yet. */
export function findVisibleDirectoryMatch(opts: {
  website: string;
  name: string;
  city: string;
}): DirectoryMatch | null {
  const host = hostnameOf(opts.website);
  if (host) {
    const byWebsite = db
      .prepare(
        `SELECT id, name, city, source FROM listings
          WHERE status = 'active' AND website IS NOT NULL AND website != ''
            AND LOWER(website) LIKE ?
          ORDER BY (source = 'claimed') DESC, (source = 'curated') DESC
          LIMIT 1`,
      )
      .get(`%${host}%`) as DirectoryMatch | undefined;
    if (byWebsite) return byWebsite;
  }
  const name = opts.name.trim();
  const city = opts.city.trim();
  if (name && city) {
    const byNameCity = db
      .prepare(
        `SELECT id, name, city, source FROM listings
          WHERE status = 'active' AND LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)
          LIMIT 1`,
      )
      .get(name, city) as DirectoryMatch | undefined;
    if (byNameCity) return byNameCity;
  }
  return null;
}
