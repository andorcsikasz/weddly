// "Csinálom magam" / DIY supplier entries. Private to a couple — never shown
// in the public directory, never moderated, never seen by other couples. The
// couple uses these to mark categories they're handling in-house (mum cooking,
// friend DJ-ing, etc.) so the directory page reflects their plan and the
// budget page shows the cost alongside booked vendors.

import type { SupplierCategory } from "./suppliers";

export interface CoupleSupplier {
  id: string;
  /** Discriminator — the directory list renders curated / community / self
   *  cards with the same shell but distinct styling. */
  source: "self";
  name: string;
  category: SupplierCategory;
  notes: string | null;
  /** Integer Forint. Null = no price set yet. Setting a positive value
   *  causes the backend to create / update a paired `budget_lines` row. */
  price_huf: number | null;
  /** "Already paid?" flag. Defaults to false on create. When false the
   *  mirrored budget line carries the price in `planned_huf` only — the
   *  actual_huf stays at 0 so the dashboard doesn't read DIY plans as
   *  realized spend (Loop C₂ fix). When true, both columns equal price. */
  paid: boolean;
  /** Auto-managed FK to the locked budget line that mirrors `price_huf`.
   *  Null when there is no price or the line was removed externally. */
  budget_line_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateCoupleSupplierInput {
  name: string;
  category: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  /** Defaults to false on the server. */
  paid?: boolean;
}

export interface UpdateCoupleSupplierInput {
  name?: string;
  category?: SupplierCategory;
  notes?: string | null;
  price_huf?: number | null;
  paid?: boolean;
}
