// Unified directory listing wire shape — the public-facing "card" across all
// supplier sources. Pairs with `VendorAccount` (the legal payee). Decided via
// multi-agent debate 2026-05-21: "listing" is what couples see and review,
// "vendor_account" is what Stripe pays and what carries KYC. They're separate
// because one account can own multiple listings (photo+video studios,
// multi-city venues, agencies).

import type { ListingPackage } from "./listing_packages";
import type { ListingVideo } from "./listing_videos";
import type { SupplierAnalytics, SupplierCategory, VenueStyle } from "./suppliers";
import type { VendorBilling, VendorBillingReason } from "./vendor_billing";
import type { VendorClientDetail } from "./vendor_clients";
import type { VendorPlan } from "./vendor_plan";

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
  /** Vendor-written label shown instead of the generic "other" category name.
   *  Only ever set when `category === "other"`; null everywhere else. */
  custom_category: string | null;
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
  /** Epoch ms of the last accepted price-band CHANGE. Anchors the anti-fraud
   *  cooldown (see PRICE_BAND_COOLDOWN_DAYS + priceBandLockedUntil). Null when
   *  the published band has never been changed. Publishing the FIRST price
   *  does not start the clock, so a fresh vendor can still correct a misclick. */
  price_band_changed_at: number | null;
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
  /** Vendor opt-in: on the public page, hide the tail of the street address and
   *  the contact email from anonymous (logged-out) visitors — a reason to
   *  register, mirroring the always-on phone mask. False by default. Only the
   *  owning vendor can flip it; the phone is masked for anonymous visitors
   *  regardless. Logged-in couples always see the full details. */
  hide_contact_public: boolean;
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
  /** Public vendor reference code — "V" + 5 digits (e.g. `V09134`). Stable per
   *  account, globally unique, shown in support / admin contexts. Null only on
   *  legacy rows until the one-time boot backfill fills them in. */
  vendor_code: string | null;
  owner_user_id: number;
  /** Public brand / display name — what shows big on the listing card and the
   *  vendor's own listing name. Set from the "display name" field at signup. */
  display_name: string;
  /** Legal company name (Kft./Bt./…), shown small under the brand on the public
   *  card. Kept distinct from `display_name` so a vendor can trade under a brand
   *  while invoicing under a company. Null when never captured. */
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  /** Company identity, collected at signup (auto-filled from the official
   *  registry lookup where a free source exists, manual elsewhere). All
   *  nullable; signup only requires the business name + category. */
  country: string | null;
  registry_number: string | null;
  legal_form: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  /** Whether the vendor has finished the post-signup onboarding wizard. The
   *  dashboard redirects into the wizard while this is false. True for accounts
   *  created via the claim flow (no wizard) and for all pre-wizard rows. */
  onboarding_done: boolean;
  created_at: number;
  updated_at: number;
}

/** Admin management row for a vendor. Unifies two populations behind one shape:
 *  `state: "active"` rows are real `vendor_accounts` (the vendor self-activated),
 *  `state: "pending"` rows are accepted-but-not-yet-activated waitlist entries
 *  that only have a live `vendor_onboarding` token (no account yet). The admin
 *  Szolgáltatók list shows both so "accepted → appears in management" holds even
 *  before the vendor clicks their activation link. */
export interface AdminVendorView {
  state: "active" | "pending";
  /** vendor_accounts.id for active rows; vendor_onboarding.id for pending rows.
   *  Route ids are disambiguated by which endpoint they hit, never mixed. */
  id: number;
  vendor_code: string | null;
  display_name: string;
  /** Legal company name shown small under the brand; null when unset. */
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  vat_number: string | null;
  onboarding_done: boolean;
  /** Owner user — present only for active rows (pending rows have no account/user
   *  yet, just the email the activation link was sent to). */
  owner_user_id: number | null;
  owner_email: string | null;
  /** users.status of the owner — "active" | "suspended". Null for pending rows. */
  owner_status: "active" | "suspended" | null;
  /** vendor_subscriptions.subscription_status snapshot, or null when the vendor
   *  has no subscription row yet. */
  subscription_status: string | null;
  /** Derived tier at read-time: "pro" while the billing entitlement holds,
   *  "free" once it lapses. Null when there's no subscription row (pending
   *  rows and legacy accounts). */
  plan: VendorPlan | null;
  /** Why the entitlement holds or lapsed (trialing / founding / lead_window /
   *  subscription / trial_expired / …). Null when there's no subscription row. */
  billing_reason: VendorBillingReason | null;
  /** Founding-cohort badge (free first year). False for pending rows. */
  is_founding_member: boolean;
  /** Epoch ms — end of the 1-year founding window. Null unless founding. Lets
   *  the admin see "free until {date}" on an early-adopter vendor. */
  founding_until: number | null;
  /** Epoch ms — end of the no-card trial (vendor 101+). Null unless trialing. */
  trial_ends_at: number | null;
  /** A payment card is on file with Stripe (checkout setup completed). Drives
   *  the "will pay" vs "never will" distinction the binary paying/not marker
   *  can't make on its own. False for pending rows. */
  card_on_file: boolean;
  /** Epoch ms — scheduled first payment (start of the month after the last
   *  free lead landed). Null until the free credits are spent. */
  billing_starts_at: number | null;
  /** Epoch ms — paid period end from Stripe. Null when not a paying sub. */
  current_period_end: number | null;
  /** Free inquiries delivered so far while in the lead window (0..3). Null for
   *  pending rows / no subscription. */
  lead_credits_used: number | null;
  /** How many `listings` this vendor owns (0 for pending rows). */
  listing_count: number;
  /** Supplier categories this vendor is listed under — distinct across their
   *  listings for active rows, the single onboarding category for pending rows.
   *  Empty when unknown. Lets the admin see which category each vendor is in. */
  categories: SupplierCategory[];
  /** For pending rows: whether the onboarding token has expired. */
  token_expired: boolean;
  /** Which public sections of the vendor's primary listing are still empty
   *  (active rows only; null for pending rows, which have no listing yet).
   *  Powers the admin "incomplete" badge + the "Send reminder" button. */
  listing_missing: {
    photos: boolean;
    bio: boolean;
    pricing: boolean;
    packages: boolean;
    availability: boolean;
  } | null;
  /** True when any `listing_missing` flag is set. False for pending rows. */
  listing_incomplete: boolean;
  /** Recurring incomplete-listing reminders sent so far (0 for pending rows). */
  profile_nudge_count: number;
  /** Epoch ms of the last incomplete-listing reminder sent, or null. */
  profile_nudge_last_at: number | null;
  created_at: number;
  /** Directory reach — views + outbound clicks summed across every listing this
   *  vendor owns (`supplier_events`). Present on active rows (all-zero until the
   *  first event); absent on pending onboardings. */
  analytics?: SupplierAnalytics;
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
  /** Toggle the public-page contact masking (address + email tail) for
   *  anonymous visitors. See {@link Listing.hide_contact_public}. */
  hide_contact_public?: boolean;
}

/** Anti-fraud pricing cooldown: once a vendor changes (or withdraws) their
 *  PUBLISHED price band, the next change is allowed only this many days
 *  later. Stops band-flipping games (rank cheap in searches, then flip to
 *  premium for the inquiry). Publishing the first price never starts the
 *  clock. Shared so the editor can disable the controls with the exact date
 *  the server would enforce. */
export const PRICE_BAND_COOLDOWN_DAYS = 30;

/** Epoch ms until which the price band is locked, or null when it is freely
 *  editable (never changed, or the cooldown anchor is absent). Callers still
 *  compare against "now": a past timestamp means the lock has expired. */
export function priceBandLockedUntil(changedAt: number | null): number | null {
  if (changedAt == null) return null;
  return changedAt + PRICE_BAND_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

/** Fields a vendor can self-serve edit on their own `vendor_accounts` row
 *  (the legal payee / company identity, PATCH /api/vendor/account). Same
 *  partial-PATCH semantics as {@link VendorListingEditInput}: only present
 *  keys apply, `null` clears. `display_name` is the public brand / listing
 *  name (editing it renames the vendor's own claimed listing); `company_name`
 *  is the legal name shown small beneath it. */
export interface VendorAccountEditInput {
  display_name?: string;
  company_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  vat_number?: string | null;
  country?: string | null;
  registry_number?: string | null;
  legal_form?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
}

/** GET /api/vendor/export — the vendor's full data snapshot as one JSON
 *  document (GDPR-style takeout). Client-side this is serialised to a
 *  downloadable file; no server-side file is written. */
export interface VendorDataExport {
  exported_at: number;
  user: {
    id: number;
    email: string;
    full_name: string;
    locale: string | null;
    created_at: number;
  };
  account: VendorAccount;
  listings: Listing[];
  billing: VendorBilling | null;
  /** Bookings with the vendor's own CRM fields + payment milestones. */
  clients: VendorClientDetail[];
  /** ISO YYYY-MM-DD days the vendor marked unavailable. */
  blocked_dates: string[];
}

/** Response shape for the GET + PATCH vendor self-serve listing endpoints —
 *  the listing the caller owns, plus a denormalised vendor-account snapshot
 *  so the editor has every public-facing field on hand in one round trip. */
/** One portfolio photo on a claimed listing (beyond the single hero image). */
export interface ListingPhoto {
  id: number;
  url: string;
  /** Vertical focal point as an object-position percentage (0..100, 50 =
   *  centred). Gallery slots crop to a fixed aspect, so a tall photo would
   *  otherwise lose whatever the vendor cared about; dragging the tile in the
   *  editor picks which band survives the crop. Horizontal stays centred —
   *  the crop is vertical, so an x control would be a knob with no effect. */
  position_y: number;
  created_at: number;
}

/** Gallery cap per listing — enforced server-side, mirrored in the editor UI. */
export const MAX_LISTING_PHOTOS = 12;

export interface VendorListingView {
  listing: Listing;
  account: VendorAccount;
  /** Subscription snapshot — drives the founding/trial/lapsed banner on the
   *  vendor home. Null only when the vendor has no sub row yet. */
  billing?: VendorBilling | null;
  /** Portfolio gallery, oldest first. Present on the listing-editor payloads
   *  (GET/upload/delete under /api/vendor/listing/me). */
  photos?: ListingPhoto[];
  /** Reference-video reel, in vendor drag order. Present on the same
   *  listing-editor payloads as `photos` (GET + every video mutation under
   *  /api/vendor/listing/me/videos). */
  videos?: ListingVideo[];
  /** Price offers / packages (árajánlat), oldest first. Present on the
   *  listing-editor payloads (GET + every package mutation under
   *  /api/vendor/listing/me/packages). */
  packages?: ListingPackage[];
}

/** One day a vendor has marked unavailable. `hours === null` means the whole
 *  day is blocked; otherwise it's the sorted list of blocked hour-starts (0-23)
 *  — a partial block, so the day still counts as free for couples / next-free.
 *  A `hours` array of length N means N hours are blocked (contiguous in the
 *  editor: from min(hours) to max(hours)+1). */
export interface VendorBlockedDay {
  /** ISO 'YYYY-MM-DD'. */
  date: string;
  /** null = whole day; else sorted blocked hour-starts (0-23). */
  hours: number[] | null;
}

/** Contiguous [start, end) a stored hour list represents. The editor only ever
 *  blocks a single from-to range, so min..max+1 reconstructs it exactly. `end`
 *  is exclusive (24 = midnight). Single-sourced here because every surface that
 *  shows a block (calendar grid, agenda, listing-editor chips) has to agree on
 *  the hours it covers; a local copy per page is how the listing editor ended up
 *  rendering partial blocks as if they were whole-day ones. */
export function blockedHoursRange(hours: number[]): { start: number; end: number } {
  return { start: Math.min(...hours), end: Math.max(...hours) + 1 };
}

/** "09:00" style label for an hour boundary 0-24. */
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** "09:00-13:00" for a partial block, or null for a whole-day one. */
export function blockedHoursLabel(hours: number[] | null): string | null {
  if (!hours || hours.length === 0) return null;
  const { start, end } = blockedHoursRange(hours);
  return `${hourLabel(start)}-${hourLabel(end)}`;
}

/** Vendor self-serve availability (the dates a claimed vendor marks as taken).
 *  `blocked_dates` are ISO 'YYYY-MM-DD', sorted ascending (every blocked day,
 *  full or partial — kept for the compact chip lists on the listing editors).
 *  `blocked_days` carries the per-day hour detail for the calendar. `next_available`
 *  is the earliest free day from today, or null if the next 365 days are full
 *  — the same value the public busy calendar shows couples. Partial-day blocks
 *  do NOT consume a day here (the vendor still has open hours). */
export interface VendorAvailabilityView {
  blocked_dates: string[];
  blocked_days: VendorBlockedDay[];
  next_available: string | null;
}
