// User-submitted ("Drop your own") supplier types. The static curated directory
// in `domain/suppliers_data.ts` and these submissions both flow through the
// public list endpoint as `DirectorySupplier`s, distinguished by `source`.

import type { SupplierCategory } from "./suppliers";

export type SupplierSource = "curated" | "community";
export type CommunitySupplierStatus = "active" | "hidden";
/** $ (1) = budget through $$$$$ (5) = ultra-luxury. The directory has real
 *  $$$$$ entries (Hertelendy, Aria, Várkert Bazár), so 4 levels can't capture
 *  the spread. */
export type PriceBand = 1 | 2 | 3 | 4 | 5;

/** Couple-facing form payload — what the submission modal sends. */
export interface SubmitCommunitySupplierInput {
  category: SupplierCategory;
  name: string;
  city: string;
  /** Optional street address. Couples often paste this from a Google Maps
   *  link; we surface it on the card so others can navigate without clicking
   *  through to the website. */
  address: string | null;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  blurb: string;
  price_band: PriceBand;
}

/** Admin-only view: includes hidden rows + submitter info for moderation. */
export interface CommunitySupplierAdminView {
  id: number;
  category: SupplierCategory;
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
  hidden_at: number | null;
  hide_reason: string | null;
}
