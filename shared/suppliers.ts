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

export interface DirectorySupplier {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  blurb_hu: string;
  blurb_en: string;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
}
