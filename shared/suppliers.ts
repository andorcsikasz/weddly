// Static suppliers directory contract. Backend curates the list (v1); the v2
// marketplace will swap this for a `suppliers` DB table with the same shape.

import type { ListingPackage } from "./listing_packages";
import type { ListingVideo } from "./listing_videos";

// v2 taxonomy (July 2026): business types, not micro-services. Grouped below in
// SUPPLIER_GROUPS. `other` is retired from the UI but kept as a hidden legacy
// fallback so a stray row with a pre-v2 slug never crashes a category lookup.
export type SupplierCategory =
  // Planning & rentals
  | "wedding_planner"
  | "rental_equipment"
  // Venue & stay
  | "venue"
  | "accommodation"
  | "tent_pavilion"
  // Food & drink
  | "catering"
  | "cake_dessert"
  | "bar_drinks"
  | "food_trucks"
  // Decor & flowers
  | "wedding_decor"
  | "florist"
  | "lighting"
  // Media
  | "photography"
  | "videography"
  | "content_creator"
  | "photo_booth"
  // Entertainment
  | "dj"
  | "live_music"
  | "entertainment"
  | "mc_celebrant"
  | "sound_tech"
  // Fashion & beauty
  | "bridal_boutique"
  | "suit_formal"
  | "hair_makeup"
  | "nails"
  | "wedding_jewelry"
  // Paper goods & design
  | "stationery"
  | "invitation_graphics"
  // Transport
  | "transport"
  // Legacy, hidden from the UI
  | "other";

export type SupplierGroup =
  | "planning_rentals"
  | "venue_stay"
  | "food_drink"
  | "decor_flowers"
  | "media"
  | "entertainment"
  | "fashion_beauty"
  | "paper_design"
  | "transport";

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
  // Planner fees + equipment hire have no dedicated budget bucket — fold into "other".
  wedding_planner: "other",
  rental_equipment: "other",
  venue: "venue",
  accommodation: "other",
  tent_pavilion: "venue",
  catering: "catering",
  cake_dessert: "cake_dessert",
  bar_drinks: "drinks",
  food_trucks: "catering",
  wedding_decor: "decor_floral",
  florist: "decor_floral",
  lighting: "decor_floral",
  photography: "photo_video",
  videography: "photo_video",
  content_creator: "photo_video",
  photo_booth: "photo_video",
  dj: "music_dj",
  live_music: "music_dj",
  entertainment: "music_dj",
  mc_celebrant: "music_dj",
  sound_tech: "music_dj",
  bridal_boutique: "attire",
  suit_formal: "attire",
  hair_makeup: "hair_makeup",
  nails: "hair_makeup",
  wedding_jewelry: "rings",
  stationery: "stationery",
  invitation_graphics: "stationery",
  transport: "transport",
  other: "other",
};

/** Hungarian category labels for backend-only surfaces (transactional emails,
 *  admin notifications) that can't reach the frontend i18n tree. Keep in sync
 *  with the `suppliers.cat.*` HU block in frontend/src/locales/hu.ts. */
export const SUPPLIER_CATEGORY_LABEL_HU: Record<SupplierCategory, string> = {
  wedding_planner: "Esküvőszervező",
  rental_equipment: "Kölcsönzés & technika",
  venue: "Esküvői helyszín",
  accommodation: "Szállás",
  tent_pavilion: "Sátor & pavilon",
  catering: "Catering",
  cake_dessert: "Torta & desszert",
  bar_drinks: "Bár & koktél",
  food_trucks: "Food truck",
  wedding_decor: "Dekoráció",
  florist: "Virágkötő",
  lighting: "Világítás",
  photography: "Fotó",
  videography: "Videó",
  content_creator: "Tartalomkészítő",
  photo_booth: "Fotófülke",
  dj: "DJ",
  live_music: "Élőzene",
  entertainment: "Műsor & animáció",
  mc_celebrant: "Ceremóniamester",
  sound_tech: "Hangtechnika",
  bridal_boutique: "Menyasszonyi ruha",
  suit_formal: "Öltöny & alkalmi",
  hair_makeup: "Smink & haj",
  nails: "Köröm",
  wedding_jewelry: "Ékszer",
  stationery: "Meghívó & papíráru",
  invitation_graphics: "Meghívó & esküvői grafika",
  transport: "Transzfer",
  other: "Egyéb",
};

// Ordered chain — mirrors the recommended booking sequence. Planning &
// coordination leads: a full-service planner is hired first (they help pick the
// venue and every vendor after it). Then venue, food, decor, media,
// entertainment, personal style, paper, and transport. `other` is intentionally
// NOT in any group — it's a hidden legacy fallback, absent from every picker.
export const SUPPLIER_GROUPS: SupplierGroupDef[] = [
  { id: "planning_rentals", categories: ["wedding_planner", "rental_equipment"] },
  { id: "venue_stay", categories: ["venue", "accommodation", "tent_pavilion"] },
  { id: "food_drink", categories: ["catering", "cake_dessert", "bar_drinks", "food_trucks"] },
  { id: "decor_flowers", categories: ["wedding_decor", "florist", "lighting"] },
  { id: "media", categories: ["photography", "videography", "content_creator", "photo_booth"] },
  {
    id: "entertainment",
    categories: ["dj", "live_music", "entertainment", "mc_celebrant", "sound_tech"],
  },
  {
    id: "fashion_beauty",
    categories: ["bridal_boutique", "suit_formal", "hair_makeup", "nails", "wedding_jewelry"],
  },
  { id: "paper_design", categories: ["stationery", "invitation_graphics"] },
  { id: "transport", categories: ["transport"] },
];

/** What a guest-count range MEANS for a category, or null when the question is
 *  meaningless there.
 *
 *  - `seating`: the physical room. "How many people fit?" A venue, a block of
 *    rooms, a marquee. This is a hard ceiling a couple filters on.
 *  - `service`: throughput. "How many people can you serve?" A caterer, a bar,
 *    a rental stock of 200 chairs. Soft, and about the vendor's operation
 *    rather than a place, which is why it gets its own label.
 *
 *  Everyone else is null. A photographer, a florist, a jeweller and a celebrant
 *  have no guest capacity, so asking them for one is noise on the form and a
 *  step they can never honestly complete on the setup checklist. */
export type SupplierCapacityKind = "seating" | "service";

/** Per-category capacity rule. Exhaustive over `SupplierCategory` on purpose:
 *  adding a category to the union without deciding this is a compile error,
 *  which is the whole point of keeping the rule here instead of in a DB table.
 *  Prefer null when unsure. A missing field is invisible; a meaningless
 *  required one is not. */
export const SUPPLIER_CAPACITY_KIND: Record<SupplierCategory, SupplierCapacityKind | null> = {
  // Planning & rentals: a planner's headcount is the couple's, not theirs.
  // Rental stock, though, genuinely runs out at N guests.
  wedding_planner: null,
  rental_equipment: "service",
  // Venue & stay: the original and most literal case.
  venue: "seating",
  accommodation: "seating",
  tent_pavilion: "seating",
  // Food & drink: throughput, not floor area. Cake is deliberately null:
  // portions scale with the order, so a "max guests" there means nothing.
  catering: "service",
  cake_dessert: null,
  bar_drinks: "service",
  food_trucks: "service",
  // Decor, media, entertainment, fashion, paper, transport: no guest capacity.
  // A DJ's rig has an acoustic limit, but it isn't a number couples filter on
  // and it isn't what this field has ever meant, so it stays out.
  wedding_decor: null,
  florist: null,
  lighting: null,
  photography: null,
  videography: null,
  content_creator: null,
  photo_booth: null,
  dj: null,
  live_music: null,
  entertainment: null,
  mc_celebrant: null,
  sound_tech: null,
  bridal_boutique: null,
  suit_formal: null,
  hair_makeup: null,
  nails: null,
  wedding_jewelry: null,
  stationery: null,
  invitation_graphics: null,
  transport: null,
  other: null,
};

/** Capacity rule for a category slug, tolerant of the untyped strings that
 *  reach the UI (listing rows, the admin-editable DB taxonomy, legacy pre-v2
 *  slugs). An unknown slug resolves to null, so a category an admin adds in the
 *  taxonomy screen starts without the field rather than inheriting a guest
 *  count nobody chose for it. Give it one here when it earns one. */
export function capacityKindFor(category: string | null | undefined): SupplierCapacityKind | null {
  if (!category) return null;
  return SUPPLIER_CAPACITY_KIND[category as SupplierCategory] ?? null;
}

/** Should a public surface print this listing's guest capacity? Both halves in
 *  one place because every surface needs both: the category has to be one that
 *  HAS a capacity, and the listing has to have filled it in.
 *
 *  The category half is what makes hiding the editor field safe as a soft hide.
 *  Legacy rows kept their numbers, so without this a photographer who typed a
 *  guest count last month would keep publishing it with no way to take it
 *  down. */
export function showsCapacity(s: {
  category?: string | null;
  capacity_max?: number | null;
}): boolean {
  return capacityKindFor(s.category) != null && (s.capacity_max ?? 0) > 0;
}

/** Shape of a directory entry without the per-request overlay (votes). Used
 *  by the static curated list in `suppliers_data.ts` and by community mappers. */
export interface DirectorySupplierBase {
  id: string;
  name: string;
  /** Legal company name of a claimed (registered-vendor) listing, shown small
   *  under the brand `name` on the detail page. Only set when it differs from
   *  `name` is a frontend decision; the server sends the raw value. Null/absent
   *  on curated + community entries (no vendor account behind them). */
  company_name?: string | null;
  category: SupplierCategory;
  city: string;
  /** ISO 3166-1 alpha-2 country the supplier sits in (uppercase). Drives the
   *  country scoping in `/api/suppliers`: a couple only sees listings in the
   *  country their wedding is in (see `couples.country`). Curated venues derive
   *  this from their city/section in `suppliers_data.ts`; community submissions
   *  default to "HU" (no per-submission country capture yet). */
  country: string;
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
  /** "curated" = vetted entries from suppliers_data.ts; "community" =
   *  user-submitted; "claimed" = a registered vendor's OWN standalone listing
   *  (self-serve signup or admin convert-to-vendor). A `claimed` card is the
   *  "verified vendor" signal on the directory — the business itself is on
   *  Weddly, not an editorial/community entry. Note: a vendor who claimed a
   *  curated/community entry keeps that entry's `source` (the claim shows via
   *  `vendor_account_id`), so `source === "claimed"` is specifically the
   *  standalone self-serve card. */
  source: "curated" | "community" | "claimed";
  /** Distinguishes a vendor who self-listed ('self') from a couple who
   *  recommended a supplier ('user'). 'self' on `claimed` (registered) cards
   *  and on self-submitted community entries; always null on curated entries. */
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
  /** Per-photo vertical focal point (object-position %, 0..100), keyed by the
   *  URL as it appears in `gallery_urls`. Only vendor-uploaded photos the
   *  vendor has actually dragged appear here; anything missing renders centred,
   *  which is what every image did before the control existed. Keyed by URL
   *  rather than index because the detail page tracks the enlarged photo by
   *  `src`, so the big slot and its thumbnail can share one lookup. */
  gallery_positions_y?: Record<string, number>;
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

/** One entry in the `/api/suppliers` country picker: an ISO alpha-2 code and
 *  how many curated listings sit in it. Sorted by `count` desc server-side. */
export interface SupplierCountryCount {
  code: string;
  count: number;
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

/** One vendor in the public browse teaser (`/vendors/browse`). A deliberately
 *  thin, unauthenticated subset — just enough to render a photo card that links
 *  to the public profile. Every entry has a real photo (`hero_image_url`). */
export interface PublicShowcaseVendor {
  /** Directory id (curated slug, `c{N}` community, or `v{N}` claimed vendor) —
   *  routes straight to the public `/vendors/{id}` profile. */
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  hero_image_url: string;
}
export interface PublicShowcaseCategory {
  category: SupplierCategory;
  vendors: PublicShowcaseVendor[];
}
/** Payload for the limited public browse page: a photos-only sample of the
 *  directory, capped per category, so couples get a taste and register to see
 *  the full directory. `total` is how many sample cards are returned. */
export interface PublicVendorShowcase {
  categories: PublicShowcaseCategory[];
  total: number;
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
  /** Who put this row here: `null` = curated (admin-maintained, code-resident),
   *  `"self"` = a vendor submitted their own business, `"user"` = a couple
   *  recommended it. Lets the admin catalog show "admin vs self-uploaded". */
  submitter_type: "self" | "user" | null;
  /** Last time the submitter's Weddly account was active. Null for curated
   *  rows and for submitters never stamped yet. */
  submitter_last_seen_at: number | null;
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
  "professional",
  "friendly",
  "reliable",
  "experienced",
  "attentive",
  "creative",
] as const;
export type SupplierReviewTag = (typeof SUPPLIER_REVIEW_TAGS)[number];
export const MAX_REVIEW_TAGS = 5;

/** Service-quality tags relevant to EVERY vendor, whatever they sell: how they
 *  are to work with. Appended after each category's specific tags. Ten of them,
 *  so even a category with no specific tags still offers ≥10 suggestions while
 *  the couple picks at most MAX_REVIEW_TAGS. */
const UNIVERSAL_REVIEW_TAGS: readonly SupplierReviewTag[] = [
  "english_speaking",
  "professional",
  "friendly",
  "responsive",
  "punctual",
  "flexible",
  "reliable",
  "experienced",
  "attentive",
  "value",
];

/** Review-tag suggestions shown per supplier category, so a couple rating a
 *  venue sees "parking / accessible / garden" and one rating a caterer sees
 *  "vegan / kosher / halal" instead of the whole generic list. Category-specific
 *  tags come first, then the universal service tags; `other` shows the full
 *  vocabulary. Every value is still a member of SUPPLIER_REVIEW_TAGS, so the
 *  backend validation is unchanged; this only curates what's SUGGESTED. */
export const REVIEW_TAGS_BY_CATEGORY: Record<SupplierCategory, readonly SupplierReviewTag[]> = {
  wedding_planner: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  venue: [
    "parking",
    "accessible",
    "outdoor_space",
    "pet_friendly",
    "kid_friendly",
    ...UNIVERSAL_REVIEW_TAGS,
  ],
  accommodation: [
    "parking",
    "accessible",
    "outdoor_space",
    "pet_friendly",
    "kid_friendly",
    ...UNIVERSAL_REVIEW_TAGS,
  ],
  tent_pavilion: ["outdoor_space", "accessible", "parking", ...UNIVERSAL_REVIEW_TAGS],
  catering: ["vegan_options", "kosher", "halal", "kid_friendly", ...UNIVERSAL_REVIEW_TAGS],
  cake_dessert: ["vegan_options", "kosher", "halal", "creative", ...UNIVERSAL_REVIEW_TAGS],
  bar_drinks: ["vegan_options", "creative", ...UNIVERSAL_REVIEW_TAGS],
  food_trucks: ["vegan_options", "kosher", "halal", "kid_friendly", ...UNIVERSAL_REVIEW_TAGS],
  wedding_decor: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  florist: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  lighting: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  photography: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  videography: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  content_creator: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  photo_booth: ["kid_friendly", "creative", ...UNIVERSAL_REVIEW_TAGS],
  dj: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  live_music: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  entertainment: ["kid_friendly", "outdoor_space", "creative", ...UNIVERSAL_REVIEW_TAGS],
  mc_celebrant: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  sound_tech: [...UNIVERSAL_REVIEW_TAGS],
  bridal_boutique: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  suit_formal: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  hair_makeup: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  nails: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  wedding_jewelry: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  stationery: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  invitation_graphics: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  rental_equipment: [...UNIVERSAL_REVIEW_TAGS],
  transport: ["accessible", "kid_friendly", "pet_friendly", ...UNIVERSAL_REVIEW_TAGS],
  other: [...SUPPLIER_REVIEW_TAGS],
};

/** Relevant review-tag suggestions for a category, falling back to the full
 *  vocabulary for any unknown value. */
export function reviewTagsForCategory(category: SupplierCategory): readonly SupplierReviewTag[] {
  return REVIEW_TAGS_BY_CATEGORY[category] ?? SUPPLIER_REVIEW_TAGS;
}
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
   *  the "Weddly editors" voice. Drives the badge on the card. A non-editorial
   *  review is always VERIFIED: the create gate requires engagement proof
   *  (cost-plan row or category pick), so couple reviews carry that badge. */
  editorial: boolean;
  /** True when the requesting viewer authored this review — drives the
   *  couple-side edit/delete affordance. Optional: absent on write responses. */
  own?: boolean;
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
  /** Viewer may open the composer: admin, or a couple with engagement proof
   *  (supplier in couple_supplier_costs / couple_picks) that hasn't reviewed
   *  this supplier yet. */
  can_review: boolean;
  /** Viewer's couple already has a (non-deleted) review here. */
  already_reviewed: boolean;
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
  /** Sorted ascending list of 'YYYY-MM-DD' dates the vendor has blocked for the
   *  WHOLE day. Shown as fully booked (red) on the public busy calendar. */
  unavailable_dates: string[];
  /** Sorted ascending 'YYYY-MM-DD' dates the vendor blocked only for certain
   *  hours. The day still has open hours, so it counts as available for
   *  next_available / bookability — couples just see a distinct "partly booked"
   *  marker. */
  partial_dates: string[];
  /** Earliest available date from "today" that is NOT fully blocked and has no
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
  /** Reference-video reel (YouTube today), in vendor drag order. Only claimed
   *  vendors add these, so it's `[]` for the unclaimed majority. Rendered as a
   *  lazy, click-to-play grid right after the photo gallery. */
  videos: ListingVideo[];
  /** Price offers / packages (árajánlat), oldest first. Only claimed vendors
   *  publish these, so `[]` for the unclaimed majority. Rendered as a card
   *  grid with the optional PDF download. */
  packages: ListingPackage[];
}

/** Everything the PUBLIC, unauthenticated vendor page (`/vendors/:id`) needs
 *  in one call — the shareable surface a couple sends to someone with no
 *  Weddly account. `GET /api/public/vendors/:id`. Deliberately a curated
 *  subset: `detail` never carries the admin-only `comments_count`, `reviews`
 *  are published-only, and `comments` are the `public` Q&A tier only (the
 *  `admin_internal` / `vendor_only` tiers never leave the server here). */
export interface PublicVendorPageData {
  detail: SupplierDetail;
  reviews: SupplierReview[];
  comments: SupplierComment[];
  availability: SupplierAvailability;
}
