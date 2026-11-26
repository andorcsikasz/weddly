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

// ── The picks table ────────────────────────────────────────────────────────
// One row per picked supplier (primary and extras), with what a couple compares
// a venue on: the price for their own date and headcount, their planned note,
// and what the venue says it provides. Built server-side in one pass so the
// table and the couple page cannot disagree about a price.

/** A venue's answers, straight from its profile. `has_profile` is false for a
 *  venue that has said nothing yet, so the table can show "unknown" rather than
 *  a "no". */
export interface PickTableVenue {
  has_profile: boolean;
  facilities: string[];
  catering: string[];
  drinks: string[];
  max_seated: number | null;
  accommodation_capacity: number | null;
}

/** A venue's price for the couple's date and headcount. `priced` carries the
 *  estimate; the other kinds say why there is no number, in words the table can
 *  show without guessing. */
export type PickTablePrice =
  | {
      kind: "priced";
      total: number;
      is_from: boolean;
      over_capacity: boolean;
    }
  | { kind: "no_rules" | "no_date" | "no_match" | "unavailable" };

/** One line of "what the price covers". For a venue it is a price item (catering,
 *  accommodation...). For any other listed supplier it is a package. */
export interface PickTableLine {
  /** Venue price item key, or null for a package (then `label` is its name). */
  item: string | null;
  label: string;
  /** Whether the price covers it: yes, no, or to be asked. */
  provided: "yes" | "no" | "ask";
  /** Whole currency units. For a range, the low end. Null when there is no number. */
  amount: number | null;
  /** The high end of a package's price range, or null. */
  amount_max: number | null;
  /** "total" or "per_person" for a package; null for a venue item. */
  per: "total" | "per_person" | null;
  /** Why the line reads the way it does, when the venue said so. */
  note_key: "optional" | "refundable" | null;
  /** A package's own description (its photo count, hours and so on), as typed. */
  description: string | null;
}

export interface PickTableRow {
  supplier_id: string;
  role: "primary" | "extra";
  category: string;
  name: string;
  city: string | null;
  /** Null for a supplier that is not a venue. */
  price: PickTablePrice | null;
  /** The couple's own planned note for this supplier, whole currency units. */
  planned: number | null;
  /** What the price covers: a venue's items, or a supplier's packages. Null when
   *  there is nothing to break down. */
  breakdown: PickTableLine[] | null;
  /** Null for a supplier that is not a venue. */
  venue: PickTableVenue | null;
}

export interface PickTable {
  currency: string;
  wedding_date: string | null;
  guest_count: number | null;
  rows: PickTableRow[];
}
