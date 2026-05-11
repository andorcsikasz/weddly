// Static suppliers directory contract. Backend curates the list (v1); the v2
// marketplace will swap this for a `suppliers` DB table with the same shape.

export type SupplierCategory =
  | "venue"
  | "accommodation"
  | "catering"
  | "cake_dessert"
  | "bar_drinks"
  | "decor_floral"
  | "lighting"
  | "music_dj"
  | "photo_video"
  | "entertainment"
  | "attire"
  | "hair_makeup"
  | "stationery"
  | "transport";

export type SupplierGroup =
  | "venue_stay"
  | "food_drink"
  | "atmosphere"
  | "experience"
  | "style"
  | "details";

export interface SupplierGroupDef {
  id: SupplierGroup;
  categories: SupplierCategory[];
}

// Ordered chain — mirrors the recommended booking sequence: lock the venue
// first, then food, then look & feel, then experience, then personal style,
// then the remaining details.
export const SUPPLIER_GROUPS: SupplierGroupDef[] = [
  { id: "venue_stay", categories: ["venue", "accommodation"] },
  { id: "food_drink", categories: ["catering", "cake_dessert", "bar_drinks"] },
  { id: "atmosphere", categories: ["decor_floral", "lighting"] },
  { id: "experience", categories: ["music_dj", "photo_video", "entertainment"] },
  { id: "style", categories: ["attire", "hair_makeup"] },
  { id: "details", categories: ["stationery", "transport"] },
];

/** Shape of a directory entry without the per-request overlay (votes). Used
 *  by the static curated list in `suppliers_data.ts` and by community mappers. */
export interface DirectorySupplierBase {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  blurb_hu: string;
  blurb_en: string;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  /** Optional street address. Surfaces on the card under the city/category line. */
  address: string | null;
  /** Approximate seated-dinner capacity range. Null = not published. */
  capacity_min: number | null;
  capacity_max: number | null;
  /** "curated" = vetted entries from suppliers_data.ts; "community" = user-submitted. */
  source: "curated" | "community";
  /** 1 = $, 5 = $$$$$. Null for entries that haven't been priced yet. */
  price_band: 1 | 2 | 3 | 4 | 5 | null;
}

/** Wire shape returned by `/api/suppliers`. Adds per-request vote info on top
 *  of the static fields, so the frontend can render score + the current
 *  user's own vote without a second round-trip. */
export interface DirectorySupplier extends DirectorySupplierBase {
  /** Net up/down score (sum of +1/-1 across all users). 0 when no one's voted. */
  votes_score: number;
  /** The logged-in user's own vote on this entry. 0 if anonymous or no vote yet. */
  user_vote: -1 | 0 | 1;
}
