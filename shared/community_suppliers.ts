// User-submitted ("Drop your own") supplier types. The static curated directory
// in `domain/suppliers_data.ts` and these submissions both flow through the
// public list endpoint as `DirectorySupplier`s, distinguished by `source`.

import type { SupplierCategory } from "./suppliers";

export type SupplierSource = "curated" | "community";
export type CommunitySupplierStatus = "active" | "hidden";
export type PriceBand = 1 | 2 | 3 | 4;

/** Couple-facing form payload — what the submission modal sends. */
export interface SubmitCommunitySupplierInput {
  category: SupplierCategory;
  name: string;
  city: string;
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
