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
  /** Published phone of the picked DIRECTORY listing, resolved server-side.
   *
   *  Here rather than read off the catalogue because the catalogue stopped
   *  carrying contact values: one response used to hand over every vendor's
   *  number, so contact details are now fetched one listing at a time against a
   *  per-user quota. The dashboard's "call your vendors" row would be a fistful
   *  of those fetches on every load, which is why the couple's OWN picks bring
   *  their number with them. The scope is what makes it safe: this can only ever
   *  answer for the handful of vendors this couple explicitly chose.
   *
   *  Null for a sentinel pick, a DIY entry, and any listing that publishes no
   *  number. */
  contact_phone?: string | null;
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

/** How many picks are CARDS: the number the directory's "csak a választottak"
 *  chip wears, and therefore the number of results tapping it has to produce.
 *
 *  Both sentinels are excluded because neither can ever match a card, and a
 *  filter chip whose count exceeds what the filter can show is a promise the
 *  grid then breaks with an empty state that blames the wrong thing. That is
 *  not hypothetical: "magam szervezem" used to count here, so a couple planning
 *  their own wedding tapped a chip reading "(1)" and got "no vendors match
 *  these filters", with no filter to clear and nothing to explain it.
 *
 *  It lives here, next to the sentinels themselves, so the chip and the filter
 *  cannot disagree about what a pick is. */
export function countRealPicks(selection: Readonly<Record<string, string | undefined>>): number {
  return Object.values(selection).filter((v) => Boolean(v) && !isSentinelPick(v as string)).length;
}
