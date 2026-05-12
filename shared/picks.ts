// Per-category "this is our pick" supplier selections, server-side so partner A
// and partner B on different devices see the same picks. One row per
// (couple, category) — picking a new supplier in the same category replaces
// the prior one. `supplier_id` is the public string id (curated slug,
// `c{N}` community id, or a DIY hex) — same shape as `couple_supplier_costs`.

export interface CouplePick {
  /** SupplierCategory string — see `shared/suppliers.ts`. */
  category: string;
  /** Public supplier id (curated slug, "c{N}", or DIY hex). */
  supplier_id: string;
  /** Partner who made the pick. `null` only if the user row was purged. */
  picked_by_user_id: number | null;
  picked_at: number;
}
