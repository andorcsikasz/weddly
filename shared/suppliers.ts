// Static suppliers directory contract. Backend curates the list (v1); the v2
// marketplace will swap this for a `suppliers` DB table with the same shape.

export type SupplierCategory =
  | "venue"
  | "accommodation"
  | "tent_pavilion"
  | "catering"
  | "cake_dessert"
  | "bar_drinks"
  | "pizza"
  | "decor_floral"
  | "lighting"
  | "music_dj"
  | "sound_tech"
  | "photo_video"
  | "entertainment"
  | "attire"
  | "hair_makeup"
  | "nails"
  | "rings"
  | "stationery"
  | "wedding_website"
  | "transport";

export type SupplierGroup =
  | "venue_stay"
  | "food_drink"
  | "atmosphere"
  | "experience"
  | "style"
  | "details";

/** The character of a venue — what kind of place it is (a castle, a boat, a
 *  restaurant…), independent of its `category` (which is always "venue" for
 *  these). Sourced from the curated directory's "jelleg" tag and normalised to
 *  this controlled list so it stays filterable + translatable rather than a
 *  free-text Hungarian string. Null on non-venue listings and on venues we
 *  haven't classified. Each value has a label under `suppliers.venue_style.*`
 *  in both locale files — keep those in sync when adding a value. */
export type VenueStyle =
  | "castle" // kastély
  | "manor" // kúria
  | "estate" // birtok, major, szabadidőfarm
  | "hotel" // hotel, kastélyszálló, szálloda, wellness
  | "resort" // resort
  | "guesthouse" // panzió, fogadó
  | "restaurant" // étterem, vendéglő, csárda, bisztró
  | "event_hall" // rendezvényterem, rendezvényház, rendezvényközpont
  | "boat" // hajó
  | "waterfront" // vízparti helyszín
  | "nature_park" // tájpark, szabadidőpark, puszta
  | "venue_with_stay"; // esküvőhelyszín szállással (form not otherwise specified)

export const VENUE_STYLES: VenueStyle[] = [
  "castle",
  "manor",
  "estate",
  "hotel",
  "resort",
  "guesthouse",
  "restaurant",
  "event_hall",
  "boat",
  "waterfront",
  "nature_park",
  "venue_with_stay",
];

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
  tent_pavilion: "venue",
  catering: "catering",
  cake_dessert: "cake_dessert",
  bar_drinks: "drinks",
  pizza: "catering",
  decor_floral: "decor_floral",
  lighting: "decor_floral",
  music_dj: "music_dj",
  sound_tech: "music_dj",
  photo_video: "photo_video",
  entertainment: "music_dj",
  attire: "attire",
  hair_makeup: "hair_makeup",
  nails: "hair_makeup",
  rings: "rings",
  stationery: "stationery",
  wedding_website: "stationery",
  transport: "transport",
};

// Ordered chain — mirrors the recommended booking sequence: lock the venue
// first, then food, then look & feel, then experience, then personal style,
// then the remaining details.
export const SUPPLIER_GROUPS: SupplierGroupDef[] = [
  { id: "venue_stay", categories: ["venue", "accommodation", "tent_pavilion"] },
  { id: "food_drink", categories: ["catering", "cake_dessert", "bar_drinks", "pizza"] },
  { id: "atmosphere", categories: ["decor_floral", "lighting"] },
  { id: "experience", categories: ["music_dj", "sound_tech", "photo_video", "entertainment"] },
  { id: "style", categories: ["attire", "hair_makeup", "nails", "rings"] },
  { id: "details", categories: ["stationery", "wedding_website", "transport"] },
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
  /** What kind of venue this is (castle, boat, restaurant…). Refines the
   *  always-"venue" category. Null on non-venue listings and on venues we
   *  haven't classified yet. See {@link VenueStyle}. */
  venue_style: VenueStyle | null;
  /** WGS-84 coordinates for the map view. Null on community submissions
   *  (no geocode pipeline yet) and on curated entries we haven't placed. */
  lat: number | null;
  lng: number | null;
  /** "curated" = vetted entries from suppliers_data.ts; "community" = user-submitted. */
  source: "curated" | "community";
  /** Only meaningful when `source === "community"`. Distinguishes a vendor
   *  who self-submitted ('self') from a couple who recommended a supplier
   *  ('user'). Always null on curated entries — they don't have a submitter. */
  submitter_type: "user" | "self" | null;
  /** 1 = $, 5 = $$$$$. Null for entries that haven't been priced yet. */
  price_band: 1 | 2 | 3 | 4 | 5 | null;
  /** When a vendor has claimed this listing (P2.C flow), the FK to their
   *  `vendor_accounts` row. Null on unclaimed curated + community entries.
   *  Frontend uses `vendor_account_id == null` AS the "is claimable?" test —
   *  no separate boolean to keep the contract small. */
  vendor_account_id: number | null;
  /** Public URL for the listing's hero image (e.g. `/uploads/listings/v3/hero.webp`).
   *  Null when the vendor hasn't uploaded one — card falls back to monogram
   *  avatar. Surfaces on the public `/api/suppliers` cards alongside the
   *  vendor-claim overlay. */
  hero_image_url: string | null;
  /** External photo gallery URLs for curated venues. Sourced at curation time
   *  from the venue's own website. Null on community submissions and on curated
   *  entries with no photo batch. hero_image_url is derived from [0] in the
   *  DIRECTORY map. */
  gallery_urls: string[] | null;
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

// ─── Visit analytics ────────────────────────────────────────────────────────

/** Public-side telemetry events the admin directory aggregates. Kept
 *  intentionally small — three signals cover "did someone see this card"
 *  (view), "did they click through to the supplier's site" (website_click)
 *  and "did they pick up the phone" (phone_click). */
export type SupplierEventType = "view" | "website_click" | "phone_click";

export interface SupplierEventInput {
  supplier_id: string;
  type: SupplierEventType;
}

/** Per-supplier counters surfaced in the admin directory list. Total and the
 *  two trailing windows are denormalised so the table renders without a
 *  client-side aggregation step. `last_event_at` is the most recent of any
 *  type — useful for spotting suppliers nobody's looked at in months. */
export interface SupplierAnalytics {
  views_total: number;
  views_30d: number;
  views_7d: number;
  website_clicks_total: number;
  website_clicks_30d: number;
  phone_clicks_total: number;
  last_event_at: number | null;
}

/** Admin directory row — curated + community merged into one shape. For
 *  community rows, `id` is the public string id (`c{N}`) and `community_id`
 *  is the numeric DB id (so the admin page can deep-link into the existing
 *  moderation actions). Curated rows have `community_id = null` and the
 *  status is always `"active"`. */
export interface SupplierDirectoryAdminRow {
  id: string;
  community_id: number | null;
  source: "curated" | "community";
  name: string;
  category: SupplierCategory;
  city: string;
  address: string | null;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  price_band: 1 | 2 | 3 | 4 | 5 | null;
  status: "active" | "pending" | "awaiting_review" | "hidden";
  submitter_email: string | null;
  created_at: number | null;
  /** Current card hero (vendor upload or website auto-fill), overlaid from the
   *  `listings` table. Null = the card falls back to the category-icon avatar. */
  hero_image_url: string | null;
  analytics: SupplierAnalytics;
}

/** Query parameters accepted by the admin directory list + CSV export. All
 *  optional; missing fields mean "no filter on this dimension". `from`/`to`
 *  are Unix-ms window boundaries; analytics counters inside the response
 *  remain total/30d/7d regardless (the date filter narrows the row set, not
 *  the metric windows). */
export interface AdminDirectoryFilters {
  source?: "curated" | "community" | "all";
  status?: "active" | "pending" | "awaiting_review" | "hidden" | "all";
  category?: SupplierCategory | "all";
  city?: string;
  q?: string;
  min_views?: number;
  from?: number | null;
  to?: number | null;
}

// ─── Supplier detail page (admin-only v1) ───────────────────────────────────
//
// Reviews, Q&A comments and booking inquiries that hang off the supplier
// detail page. v1 is admin-only on the write side; Phase 3 flips to couple
// authors with an engagement-proof gate (must have couple_picks or
// couple_supplier_costs row for the supplier). See schema.sql for the table
// shapes and the 5-agent debate doc for the design rationale.

/** Hardcoded review tag vocabulary. Controlled list, not an admin-managed
 *  taxonomy — adding a tag is a 4-line code change (constant + HU key + EN
 *  key + test) which is cheaper than a CRUD interface for a list that moves
 *  ~once a quarter. Couples pick max 5 tags per review. */
export const SUPPLIER_REVIEW_TAGS = [
  "parking",
  "accessible",
  "english_speaking",
  "flexible",
  "value",
  "responsive",
  "punctual",
  "pet_friendly",
  "kid_friendly",
  "outdoor_space",
  "vegan_options",
  "kosher",
  "halal",
] as const;
export type SupplierReviewTag = (typeof SUPPLIER_REVIEW_TAGS)[number];
export const MAX_REVIEW_TAGS = 5;
export const REVIEW_BODY_MAX_CHARS = 4000;
export const COMMENT_BODY_MAX_CHARS = 1500;

export type CommentVisibility = "admin_internal" | "public" | "vendor_only";
export type BookingStatus =
  | "requested"
  | "vendor_seen"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "expired";

/** A review on a supplier. `author.displayName` is pre-resolved server-side:
 *  - admin authors (couple_id null) render as "Weddly editors"
 *  - couple authors render as the couple's display name (or anonymised when
 *    the privacy setting requires) */
export interface SupplierReview {
  id: number;
  supplier_id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string | null;
  tags: SupplierReviewTag[];
  published: boolean;
  /** True when the row's `couple_id` is null — i.e. authored by an admin under
   *  the "Weddly editors" voice. Drives the badge on the card. */
  editorial: boolean;
  author: {
    display_name: string;
  };
  created_at: number;
  updated_at: number;
}

export interface CreateReviewBody {
  rating: number;
  body?: string | null;
  tags?: string[];
  published?: boolean;
}

export interface ReviewListResponse {
  items: SupplierReview[];
  nextCursor: string | null;
  summary: ReviewSummary;
}

/** Card- and detail-page-friendly rollup. Stays null until the supplier has
 *  ≥3 published reviews (cold-start gate) so a single 1-star doesn't read as
 *  the supplier's whole reputation. */
export interface ReviewSummary {
  avg_rating: number | null;
  reviews_count: number;
  /** 1★…5★ histogram. Always 5 entries, indexed 0=1★ through 4=5★. */
  histogram: [number, number, number, number, number];
  /** Top tags by mention count, capped to 5. Each item: {tag, count}. Empty
   *  when no reviews carry tags. */
  top_tags: Array<{ tag: SupplierReviewTag; count: number }>;
}

export interface SupplierComment {
  id: number;
  supplier_id: string;
  parent_id: number | null;
  visibility: CommentVisibility;
  body: string;
  author: {
    display_name: string;
    /** True for admin authors — frontend renders the "Weddly" badge. */
    is_admin: boolean;
  };
  created_at: number;
  updated_at: number;
}

export interface CreateCommentBody {
  body: string;
  parent_id?: number | null;
  visibility?: CommentVisibility;
}

export interface CommentListResponse {
  items: SupplierComment[];
  nextCursor: string | null;
}

export interface SupplierBooking {
  id: number;
  supplier_id: string;
  couple_id: number;
  vendor_account_id: number | null;
  event_date: string;
  status: BookingStatus;
  notes: string | null;
  amount_huf: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateBookingBody {
  event_date: string;
  notes?: string | null;
  amount_huf?: number | null;
}

export interface SupplierAvailability {
  /** Sorted ascending list of 'YYYY-MM-DD' dates the vendor has blocked. */
  unavailable_dates: string[];
  /** Earliest available date from "today" that is NOT blocked and has no
   *  pending booking. Null when the supplier is unclaimed (no vendor calendar
   *  to consult). */
  next_available: string | null;
  /** True when the supplier is claimed by a vendor and therefore accepts
   *  booking inquiries. v1 rejects inquiries on unclaimed listings. */
  bookable: boolean;
}

/** Returned by `GET /api/suppliers/:id`. Wraps the standard DirectorySupplier
 *  with the detail-page-only fields. The admin-only `comments_count` is
 *  omitted server-side when the caller isn't admin. */
export interface SupplierDetail extends DirectorySupplier {
  reviews_summary: ReviewSummary;
  /** Number of non-deleted comments on this supplier. Admin-only field —
   *  undefined when the caller is not admin. */
  comments_count?: number;
  /** Earliest available date if the supplier is a claimed vendor account;
   *  null for the unclaimed majority. Public — feeds the shortlist
   *  comparison dialog's "available date" row. */
  next_available?: string | null;
  /** Whether the supplier accepts booking inquiries today (claimed + has a
   *  vendor_account_id). Always present so the CTA logic can branch. */
  bookable: boolean;
}
