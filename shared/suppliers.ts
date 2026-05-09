// Static suppliers directory contract. Backend curates the list (v1); the v2
// marketplace will swap this for a `suppliers` DB table with the same shape.

export type SupplierCategory =
  | "venue"
  | "catering"
  | "photo_video"
  | "music_dj"
  | "decor_floral"
  | "cake_dessert"
  | "attire"
  | "hair_makeup"
  | "transport"
  | "stationery";

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
