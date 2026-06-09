// Unified directory listing wire shape — the public-facing "card" across all
// supplier sources. Pairs with `VendorAccount` (the legal payee). Decided via
// multi-agent debate 2026-05-21: "listing" is what couples see and review,
// "vendor_account" is what Stripe pays and what carries KYC. They're separate
// because one account can own multiple listings (photo+video studios,
// multi-city venues, agencies).

import type { SupplierCategory, VenueStyle } from "./suppliers";
import type { VendorBilling } from "./vendor_billing";

/**
 * Where the listing came from. Drives the moderation/trust UX and gates which
 * fields are admin-editable vs. vendor-editable:
 *   - "curated": vetted entry from `backend/src/domain/suppliers_data.ts`.
 *     Mirrored into the DB by a boot-time idempotent upsert; code remains
 *     source-of-truth for the canonical content.
 *   - "community": user-submitted via the "Drop your own" flow; row lives in
 *     `community_suppliers` and is dual-written into `listings`.
 *   - "claimed": Phase 2.5+ vendor self-serve onboarding. Listing minted with
 *     id `v{N}` against a vendor_account.
 */
export type ListingSource = "curated" | "community" | "claimed";

/**
 * Mirrors `community_suppliers.status`. Curated rows are always "active".
 * Community rows walk pending → awaiting_review → active (admin approval),
 * with "hidden" as the moderation terminus.
 */
export type ListingStatus = "active" | "pending" | "awaiting_review" | "hidden";

/**
 * Only meaningful for community/claimed listings — distinguishes a vendor who
 * self-submitted ("self") from a couple/user recommending a supplier ("user").
 * Always null on curated listings.
 */
export type ListingSubmitterType = "user" | "self" | null;

export interface Listing {
  /** Public, stable string id. Shape is namespaced by source:
   *  curated → slug, community → "c{N}", claimed → "v{N}". */
  id: string;
  source: ListingSource;
  /** Null when nobody owns the listing yet (curated default + unclaimed
   *  community). Flips to non-null when a vendor claims, without changing the
   *  listing id — couple_picks etc. stay valid. */
  vendor_account_id: number | null;
  category: SupplierCategory;
  name: string;
  city: string;
  address: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  blurb_hu: string | null;
  blurb_en: string | null;
  /** 1 = $, 5 = $$$$$. Null when unpriced. */
  price_band: 1 | 2 | 3 | 4 | 5 | null;
  /** Seated-dinner capacity range. Null on community/claimed (no field yet) and
   *  on curated entries we haven't placed. */
  capacity_min: number | null;
  capacity_max: number | null;
  /** What kind of venue this is (castle, boat, restaurant…). Null on non-venue
   *  and unclassified listings. See {@link VenueStyle}. */
  venue_style: VenueStyle | null;
  lat: number | null;
  lng: number | null;
  submitter_type: ListingSubmitterType;
  status: ListingStatus;
  /** Public URL for the listing's hero image (e.g. `/uploads/listings/v3/hero.webp`).
   *  Null when the vendor hasn't uploaded one — frontend falls back to a
   *  monogram avatar. Only vendors who own the listing can write this field;
   *  the file lives under `CONFIG.uploadsDir` on the persistent volume. */
  hero_image_url: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Legal payee entity. 1:1 with a `users` row of role='vendor'. One account can
 * own N `listings` (rare in v1 — most vendors have a single listing — but the
 * relationship is left open so a photo+video studio or multi-city venue
 * doesn't need a schema change later).
 *
 * Phase 3 will add `stripe_account_id`, `kyc_status`, payout-related fields.
 * Kept off P2.A by design.
 */
export interface VendorAccount {
  id: number;
  owner_user_id: number;
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  created_at: number;
  updated_at: number;
}

/** Fields a vendor can self-serve edit on their claimed listing (P2.D).
 *  Every field is optional so the client can PATCH partials — only present
 *  keys get applied; `null` clears the value, undefined leaves it alone.
 *
 *  Deliberately excluded: `name` (brand-name changes go through admin review
 *  to stop hostile renames), `category` (taxonomy is admin-curated), `status`
 *  (admins toggle hidden/active), `lat`/`lng` (server-derived from address
 *  once a geocode worker lands), and identity fields (`id`, `source`,
 *  `vendor_account_id`, timestamps). */
export interface VendorListingEditInput {
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

/** Response shape for the GET + PATCH vendor self-serve listing endpoints —
 *  the listing the caller owns, plus a denormalised vendor-account snapshot
 *  so the editor has every public-facing field on hand in one round trip. */
export interface VendorListingView {
  listing: Listing;
  account: VendorAccount;
  /** Subscription snapshot — drives the founding/trial/lapsed banner on the
   *  vendor home. Null only when the vendor has no sub row yet. */
  billing?: VendorBilling | null;
}

/** Vendor self-serve availability (the dates a claimed vendor marks as taken).
 *  `blocked_dates` are ISO 'YYYY-MM-DD', sorted ascending. `next_available`
 *  is the earliest free day from today, or null if the next 365 days are full
 *  — the same value the public busy calendar shows couples. */
export interface VendorAvailabilityView {
  blocked_dates: string[];
  next_available: string | null;
}
