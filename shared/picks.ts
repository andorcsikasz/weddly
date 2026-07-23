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

// Two picks are not real suppliers but declarations the couple makes about a
// category: "we're organising this ourselves" and "we don't need this at all".
// They ride the same one-pick-per-category storage (the picks backend accepts
// any non-empty string id), so the `supplier_id` carries the sentinel. Any
// consumer that treats picks as contactable suppliers (the Timeline points-of-
// contact panel) must exclude these — a not-needed florist is not a contact.
export const SELF_ORGANIZED_PICK = "self-organized";
export const NOT_NEEDED_PICK = "not-needed";
const SENTINEL_PICKS: ReadonlySet<string> = new Set([SELF_ORGANIZED_PICK, NOT_NEEDED_PICK]);

/** True when the pick is a "self-organised" / "not needed" declaration rather
 *  than a real supplier the couple could ring. */
export function isSentinelPick(supplierId: string): boolean {
  return SENTINEL_PICKS.has(supplierId);
}
