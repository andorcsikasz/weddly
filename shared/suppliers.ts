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

/** Maps each supplier category onto a budget category so the supplier card
 *  can display the matching planned/actual figures from /app/budget. Some
 *  supplier categories don't have a dedicated budget bucket (lighting,
 *  entertainment, accommodation) — those fold into the nearest analogue
 *  rather than scattering them under "other". Keep both sides in sync when
 *  adding new categories. */
export const SUPPLIER_TO_BUDGET: Record<SupplierCategory, string> = {
  venue: "venue",
  accommodation: "other",
  catering: "catering",
  cake_dessert: "cake_dessert",
  bar_drinks: "drinks",
  decor_floral: "decor_floral",
  lighting: "decor_floral",
  music_dj: "music_dj",
  photo_video: "photo_video",
  entertainment: "music_dj",
  attire: "attire",
  hair_makeup: "hair_makeup",
  stationery: "stationery",
  transport: "transport",
};

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
  /** WGS-84 coordinates for the map view. Null on community submissions
   *  (no geocode pipeline yet) and on curated entries we haven't placed. */
  lat: number | null;
  lng: number | null;
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
