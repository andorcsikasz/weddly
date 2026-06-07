// Couple shortlist ("saved" star on /app/suppliers), server-side so partner A
// and partner B on different devices share the same list. Many rows per couple
// (no per-category cap) — a couple shortlists several photographers to compare
// them. `supplier_id` is the public string id (curated slug, `c{N}` community
// id, or DIY hex) — same shape as `couple_picks` / `couple_supplier_costs`.

export interface SavedSupplier {
  /** Public supplier id (curated slug, "c{N}", or DIY hex). */
  supplier_id: string;
  /** Partner who saved it. `null` only if the user row was purged. */
  saved_by_user_id: number | null;
  saved_at: number;
}
