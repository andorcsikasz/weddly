// User-submitted ("Drop your own") supplier types. The static curated directory
// in `domain/suppliers_data.ts` and these submissions both flow through the
// public list endpoint as `DirectorySupplier`s, distinguished by `source`.

import type { SupplierCategory, VenueStyle } from "./suppliers";

export type SupplierSource = "curated" | "community";
/** Lifecycle:
 *  - `pending`          submitted, not yet reviewed — invisible to everyone
 *                       except the admin moderation queue. The admin's own
 *                       review approves it directly from here; a contact
 *                       email is never a reason to wait on a vendor click.
 *  - `awaiting_review`  the admin optionally asked the vendor to confirm
 *                       ownership (`community_supplier_verify`) and they did.
 *                       Still invisible to couples until the admin approves —
 *                       same approval action as `pending`, just reached via
 *                       the optional check instead of skipping it.
 *  - `active`           approved by admin (or grandfathered from before the
 *                       moderation queue existed); appears in the public
 *                       directory, and the contact (if any) is emailed that
 *                       their business was added.
 *  - `hidden`           admin moderation OR auto-hidden by the report queue. */
export type CommunitySupplierStatus = "pending" | "awaiting_review" | "active" | "hidden";
/** $ (1) = budget through $$$$$ (5) = ultra-luxury. The directory has real
 *  $$$$$ entries (Hertelendy, Aria, Várkert Bazár), so 4 levels can't capture
 *  the spread. */
export type PriceBand = 1 | 2 | 3 | 4 | 5;

/** Distinguishes the two community-submission paths so the public card can
 *  render the right trust signal:
 *   - 'user' = a couple recommending a supplier they like (default)
 *   - 'self' = the vendor themselves dropping a tip about their business */
export type CommunitySubmitterType = "user" | "self";

/** Couple-facing form payload — what the submission modal sends. */
export interface SubmitCommunitySupplierInput {
  category: SupplierCategory;
  /** Defaults to 'user' on the server when omitted, so the field is
   *  back-compatible with any older callers still on the previous payload. */
  submitter_type?: CommunitySubmitterType;
  name: string;
  city: string;
  /** Optional street address. Couples often paste this from a Google Maps
   *  link; we surface it on the card so others can navigate without clicking
   *  through to the website. */
  address: string | null;
  website: string;
  /** The BUSINESS's own address, not the submitter's. REQUIRED on the visitor
   *  path (an account-less stranger has to leave something the listing can be
   *  confirmed against), optional for a logged-in couple, who is reachable
   *  through their own account. Every submission goes straight to the admin
   *  moderation queue regardless — this address is where the "you've been
   *  added" notice goes once the admin approves, and where an admin can
   *  optionally send an ownership-confirmation link first if a row looks
   *  uncertain. The address remains hidden from the public DTO (privacy) and
   *  only surfaces in the admin moderation view. */
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
  /** Optional. Null when the submitter didn't specify a price tier — stored as a
   *  sentinel 0 in the NOT-NULL DB column and normalized back to null on read,
   *  so the card renders "unpriced" rather than a misleading "$". */
  price_band: PriceBand | null;
}

/** Admin-only view: includes hidden rows + submitter info for moderation. */
/** One directory listing that matches a typed-in supplier name, used by the
 *  live "are they already on Weddly?" check on the recommend form. */
export interface SupplierNameMatch {
  /** Directory id: curated slug, `c{N}` community, or `v{N}` claimed vendor. */
  id: string;
  name: string;
  city: string;
  category: SupplierCategory;
}

export interface SupplierNameCheckResponse {
  matches: SupplierNameMatch[];
}

export interface CommunitySupplierAdminView {
  id: number;
  category: SupplierCategory;
  submitter_type: CommunitySubmitterType;
  name: string;
  city: string;
  address: string | null;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
  price_band: PriceBand | null;
  /** The four facts the submission form never collects. NULL on every row an
   *  admin hasn't researched yet; filled through the admin edit form and
   *  mirrored into `listings`, which is what puts the card on the map tab and
   *  into the venue-style / capacity filters. */
  lat: number | null;
  lng: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  venue_style: VenueStyle | null;
  /** ISO 639-1 codes, controlled list — see `SPOKEN_LANGUAGE_OPTIONS`. */
  spoken_languages: string[];
  status: CommunitySupplierStatus;
  submitter_email: string;
  submitter_user_id: number;
  /** When the submission came from a verified VISITOR (no Weddly account), this
   *  is their real email; `submitter_user_id` then points at the reserved system
   *  user. Null for the normal logged-in-couple path.
   *
   *  Admin surfaces must prefer this over `submitter_email` when it is set:
   *  the account address on a visitor row is the sentinel system user, which
   *  answers "who suggested this?" with nobody. */
  submitter_visitor_email: string | null;
  /** The visitor's own name, when Google handed one over with the address.
   *  Null for the couple path and for a visitor who verified by email link. */
  submitter_visitor_name: string | null;
  created_at: number;
  /** Last-edit timestamp on the supplier row itself. Tracks DB writes
   *  (admin notes, hide/unhide, enrich) — not the submitter's last edit
   *  (that path is not exposed yet). */
  updated_at: number;
  hidden_at: number | null;
  hide_reason: string | null;
  /** Count of distinct open user reports against this supplier. >= 3 triggers
   *  the auto-hide path. Surfaced in the admin list so moderators can sort by
   *  most-reported and triage from the top. */
  open_report_count: number;
  /** Admin-only freeform notes. NULL on rows that have never been touched.
   *  Empty string is a legit "cleared" state. The CRM-style supplier card
   *  on /app/admin/suppliers edits this in place via PATCH. */
  admin_notes: string | null;
}

/** Admin edit payload for a community listing. Every field is OPTIONAL and an
 *  absent key means "leave it alone" — the form sends only what changed, and a
 *  partial body must never blank a column it said nothing about. `null` is a
 *  real value (clear the field) on everything nullable; `name`, `city` and
 *  `category` are NOT NULL in the schema, so they only accept a string.
 *
 *  This is the admin's answer to "the submitter typed three fields and the
 *  enricher found nothing" — the couple-facing form is deliberately tiny, so
 *  the moderation card is the only place the rest of a listing can be typed. */
export interface AdminSupplierEditInput {
  category?: SupplierCategory;
  name?: string;
  city?: string;
  address?: string | null;
  website?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  blurb?: string | null;
  price_band?: PriceBand | null;
  lat?: number | null;
  lng?: number | null;
  capacity_min?: number | null;
  capacity_max?: number | null;
  venue_style?: VenueStyle | null;
  spoken_languages?: string[];
}

/** One photo on a listing, as the admin photo manager sees it. `id` is null for
 *  the hero (it lives on `listings.hero_image_url`, not in `listing_photos`),
 *  which is also what makes the hero deletable through the same list. */
export interface AdminListingPhoto {
  id: number | null;
  url: string;
  role: "hero" | "gallery";
}

export interface AdminListingPhotosResponse {
  listing_id: string;
  photos: AdminListingPhoto[];
}

/** Reasons a couple can pick when reporting a community listing. Kept short
 *  so the action menu is one tap; free-text detail goes in `note`. */
export type CommunitySupplierReportReason = "spam" | "fake" | "offensive" | "wrong_info" | "other";

export interface SubmitCommunitySupplierReportInput {
  reason: CommunitySupplierReportReason;
  /** Optional free-text detail. Max 500 chars; truncated on the route side. */
  note?: string | null;
}

/** One open report as the moderation queue renders it. The card carried only a
 *  COUNT for a long time, which told an admin something was wrong and gave them
 *  no way to read it or clear it — the reports piled up unread behind a badge.
 *
 *  `reason` is typed loosely because the column is bare TEXT: a row written
 *  before a reason was retired still has to render rather than blank out. */
export interface AdminCommunitySupplierReport {
  id: number;
  supplier_id: number;
  reason: string;
  note: string | null;
  created_at: number;
}
