// Unified directory listing wire shape — the public-facing "card" across all
// supplier sources. Pairs with `VendorAccount` (the legal payee). Decided via
// multi-agent debate 2026-05-21: "listing" is what couples see and review,
// "vendor_account" is what Stripe pays and what carries KYC. They're separate
// because one account can own multiple listings (photo+video studios,
// multi-city venues, agencies).

import type { SupplierCategory } from "./suppliers";

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
  lat: number | null;
  lng: number | null;
  submitter_type: ListingSubmitterType;
  status: ListingStatus;
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
