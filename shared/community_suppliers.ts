// User-submitted ("Drop your own") supplier types. The static curated directory
// in `domain/suppliers_data.ts` and these submissions both flow through the
// public list endpoint as `DirectorySupplier`s, distinguished by `source`.

import type { SupplierCategory } from "./suppliers";

export type SupplierSource = "curated" | "community";
/** Lifecycle:
 *  - `pending`          submitted but `contact_email` not yet verified — invisible
 *                       to everyone except the admin moderation queue.
 *  - `awaiting_review`  email verified, but admin hasn't signed off yet. Still
 *                       invisible to couples. This is the second of two gates
 *                       (email-ownership + human review) that v1.1 added after
 *                       the auto-activation regression.
 *  - `active`           approved by admin (or grandfathered from before the gate
 *                       existed); appears in the public directory.
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
  /** Optional. When provided we send a verification link here before the
   *  listing goes to admin review; without it the submission skips straight
   *  to the moderation queue. The address remains hidden from the public DTO
   *  (privacy) and only surfaces in the admin moderation view. */
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
  price_band: PriceBand;
}

/** Admin-only view: includes hidden rows + submitter info for moderation. */
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
  price_band: PriceBand;
  status: CommunitySupplierStatus;
  submitter_email: string;
  submitter_user_id: number;
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

/** Reasons a couple can pick when reporting a community listing. Kept short
 *  so the action menu is one tap; free-text detail goes in `note`. */
export type CommunitySupplierReportReason = "spam" | "fake" | "offensive" | "wrong_info" | "other";

export interface SubmitCommunitySupplierReportInput {
  reason: CommunitySupplierReportReason;
  /** Optional free-text detail. Max 500 chars; truncated on the route side. */
  note?: string | null;
}
