// Per-couple planned + final cost attached to a directory supplier.
// `supplier_id` matches the `DirectorySupplier.id` (curated slug or "c{N}"
// community id) so the frontend can join in memory without an extra fetch.

export interface CoupleSupplierCost {
  supplier_id: string;
  /** Integer Forint. 0 means "unset". */
  planned_huf: number;
  /** Integer Forint. 0 means "unset". */
  actual_huf: number;
  notes: string | null;
  updated_at: number;
}

export interface UpsertCoupleSupplierCostInput {
  planned_huf: number;
  actual_huf: number;
  notes: string | null;
}
