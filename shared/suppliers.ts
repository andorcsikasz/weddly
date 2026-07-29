// Static suppliers directory contract. Backend curates the list (v1); the v2
// marketplace will swap this for a `suppliers` DB table with the same shape.

import type { ListingPackage } from "./listing_packages";
import type { ListingVideo } from "./listing_videos";

// v2 taxonomy (July 2026): business types, not micro-services. Grouped below in
// SUPPLIER_GROUPS. `other` is retired from the UI but kept as a hidden legacy
// fallback so a stray row with a pre-v2 slug never crashes a category lookup.
export type SupplierCategory =
  // Planning
  | "wedding_planner"
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
  | "rental_equipment"
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
  | "celebrant"
  | "dance_lessons"
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
  celebrant: "other",
  // The first-dance lessons are bought months before the day and have no music
  // budget line of their own — "other", same as the celebrant's fee.
  dance_lessons: "other",
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

/** Category labels for backend-only surfaces (transactional + outreach emails,
 *  admin notifications) that can't reach the frontend i18n tree. Keep in sync
 *  with the `suppliers.cat.*` blocks in frontend/src/locales/{hu,en}.ts. */
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
  celebrant: "Szertartásvezető",
  dance_lessons: "Táncoktatás",
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

/** English twin of SUPPLIER_CATEGORY_LABEL_HU. Needed the moment a backend
 *  surface addresses a vendor outside Hungary, e.g. the claim-invite campaign,
 *  which picks its language from the listing's country. */
export const SUPPLIER_CATEGORY_LABEL_EN: Record<SupplierCategory, string> = {
  wedding_planner: "Wedding planner",
  rental_equipment: "Rental & equipment",
  venue: "Wedding venue",
  accommodation: "Accommodation",
  tent_pavilion: "Tent & pavilion",
  catering: "Catering",
  cake_dessert: "Cakes & desserts",
  bar_drinks: "Bar & cocktails",
  food_trucks: "Food trucks",
  wedding_decor: "Wedding decor",
  florist: "Florist",
  lighting: "Lighting",
  photography: "Photography",
  videography: "Videography",
  content_creator: "Content creator",
  photo_booth: "Photo booth",
  dj: "DJ",
  live_music: "Live music",
  entertainment: "Entertainment",
  mc_celebrant: "Master of ceremonies",
  celebrant: "Celebrant",
  dance_lessons: "Dance lessons",
  sound_tech: "Sound & AV tech",
  bridal_boutique: "Bridal boutique",
  suit_formal: "Suit & formal wear",
  hair_makeup: "Hair & makeup",
  nails: "Nails",
  wedding_jewelry: "Wedding jewelry",
  stationery: "Invitations & paper goods",
  invitation_graphics: "Invitation & wedding graphics",
  transport: "Wedding transport",
  other: "Other",
};

/** Category label in the recipient's language, falling back to the raw key for
 *  a custom/unknown category so a label never renders as "undefined". */
export function supplierCategoryLabel(category: string, locale: "hu" | "en"): string {
  const table = locale === "hu" ? SUPPLIER_CATEGORY_LABEL_HU : SUPPLIER_CATEGORY_LABEL_EN;
  return table[category as SupplierCategory] ?? category;
}

// Ordered chain — mirrors the recommended booking sequence. Planning &
// coordination leads: a full-service planner is hired first (they help pick the
// venue and every vendor after it). Then venue, food, decor, media,
// entertainment, personal style, paper, and transport. `other` is intentionally
// NOT in any group — it's a hidden legacy fallback, absent from every picker.
export const SUPPLIER_GROUPS: SupplierGroupDef[] = [
  { id: "planning_rentals", categories: ["wedding_planner"] },
  { id: "venue_stay", categories: ["venue", "accommodation", "tent_pavilion"] },
  { id: "food_drink", categories: ["catering", "cake_dessert", "bar_drinks", "food_trucks"] },
  { id: "decor_flowers", categories: ["wedding_decor", "florist", "lighting", "rental_equipment"] },
  { id: "media", categories: ["photography", "videography", "content_creator", "photo_booth"] },
  {
    id: "entertainment",
    categories: [
      "dj",
      "live_music",
      "entertainment",
      "mc_celebrant",
      "celebrant",
      "dance_lessons",
      "sound_tech",
    ],
  },
  {
    id: "fashion_beauty",
    categories: ["bridal_boutique", "suit_formal", "hair_makeup", "nails", "wedding_jewelry"],
  },
  { id: "paper_design", categories: ["stationery", "invitation_graphics"] },
  { id: "transport", categories: ["transport"] },
];

/** Categories that exist in the taxonomy but must never mint a VENDOR account
 *  through a self-serve door.
 *
 *  A wedding planner is a different product relationship: they don't sell a
 *  service out of the catalog, they get invited into the couple's workspace and
 *  plan alongside them, on their own subscription and their own app shell. So
 *  `wedding_planner` stays a perfectly good DIRECTORY category (curated entries,
 *  community suggestions, the `/app/suppliers` chain, admin edits) while every
 *  funnel that ends in `users.role='vendor'` refuses it and points at
 *  `/planners` instead: signup, listing-claim, and the cold claim-invite
 *  campaign that hands out claim links.
 *
 *  This lives here, next to the taxonomy, because the rule is a property of the
 *  category — a copy of it in one route is exactly how a planner ends up in the
 *  vendor funnel through the door nobody patched. */
export const VENDOR_SELF_SERVE_BLOCKED_CATEGORIES: ReadonlySet<string> = new Set<string>([
  "wedding_planner",
]);

/** True when this category may NOT be self-registered / self-claimed as a vendor.
 *  Tolerates any string so callers can pass a raw DB column. */
export function isVendorSelfServeBlocked(category: string | null | undefined): boolean {
  return category != null && VENDOR_SELF_SERVE_BLOCKED_CATEGORIES.has(category);
}

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
  celebrant: null,
  // A dance teacher's studio holds a couple and their wedding party, never the
  // guest list, so a "max guests" here would mean nothing.
  dance_lessons: null,
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

/** Verbal vendors: booked for what they SAY, so the deciding question a couple
 *  has is which languages they can confidently run a wedding in. A celebrant
 *  (szertartásvezető) leads the ceremony; a master of ceremonies
 *  (ceremóniamester) hosts the reception. Both live here; any future spoken/host
 *  role (a toastmaster, a bilingual officiant) joins by flipping its flag.
 *
 *  Exhaustive over `SupplierCategory` on purpose, same as the capacity rule:
 *  adding a category without deciding this is a compile error. A photographer
 *  has no "spoken languages" to advertise, so asking is noise on the form. */
export const SUPPLIER_SPEAKS_LANGUAGES: Record<SupplierCategory, boolean> = {
  wedding_planner: false,
  rental_equipment: false,
  venue: false,
  accommodation: false,
  tent_pavilion: false,
  catering: false,
  cake_dessert: false,
  bar_drinks: false,
  food_trucks: false,
  wedding_decor: false,
  florist: false,
  lighting: false,
  photography: false,
  videography: false,
  content_creator: false,
  photo_booth: false,
  dj: false,
  live_music: false,
  entertainment: false,
  mc_celebrant: true,
  celebrant: true,
  // A dance teacher instructs in a language too, but they are booked for the
  // choreography, not for what they say on the day. Flip this if couples start
  // asking, it costs one line.
  dance_lessons: false,
  sound_tech: false,
  bridal_boutique: false,
  suit_formal: false,
  hair_makeup: false,
  nails: false,
  wedding_jewelry: false,
  stationery: false,
  invitation_graphics: false,
  transport: false,
  other: false,
};

/** Whether this category is a verbal/host vendor whose spoken languages matter.
 *  Tolerant of the untyped slugs that reach the UI (listing rows, admin-editable
 *  taxonomy). Unknown slug → false, so a new admin-added category starts without
 *  the field until it earns one here. */
export function speaksLanguages(category: string | null | undefined): boolean {
  if (!category) return false;
  return SUPPLIER_SPEAKS_LANGUAGES[category as SupplierCategory] ?? false;
}

/** Should a public surface print this listing's spoken languages? Both halves in
 *  one place (mirrors showsCapacity): the category has to be one where languages
 *  matter, and the listing has to have filled them in. */
export function showsSpokenLanguages(s: {
  category?: string | null;
  spoken_languages?: readonly string[] | null;
}): boolean {
  return speaksLanguages(s.category) && (s.spoken_languages?.length ?? 0) > 0;
}

/** Controlled list of languages a verbal vendor can offer, ISO 639-1 codes with
 *  per-locale display names. Kept here rather than the i18n tree so the list is
 *  one translatable source shared by the editor, the public page and any
 *  backend surface. Ordered by rough relevance to the HU + neighbouring markets,
 *  then the big Western-European languages. */
export interface LanguageOption {
  code: string;
  hu: string;
  en: string;
  es: string;
}
export const SPOKEN_LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: "hu", hu: "Magyar", en: "Hungarian", es: "Húngaro" },
  { code: "en", hu: "Angol", en: "English", es: "Inglés" },
  { code: "de", hu: "Német", en: "German", es: "Alemán" },
  { code: "ro", hu: "Román", en: "Romanian", es: "Rumano" },
  { code: "sk", hu: "Szlovák", en: "Slovak", es: "Eslovaco" },
  { code: "sr", hu: "Szerb", en: "Serbian", es: "Serbio" },
  { code: "hr", hu: "Horvát", en: "Croatian", es: "Croata" },
  { code: "uk", hu: "Ukrán", en: "Ukrainian", es: "Ucraniano" },
  { code: "ru", hu: "Orosz", en: "Russian", es: "Ruso" },
  { code: "fr", hu: "Francia", en: "French", es: "Francés" },
  { code: "it", hu: "Olasz", en: "Italian", es: "Italiano" },
  { code: "es", hu: "Spanyol", en: "Spanish", es: "Español" },
  { code: "he", hu: "Héber", en: "Hebrew", es: "Hebreo" },
];

const LANGUAGE_BY_CODE = new Map(SPOKEN_LANGUAGE_OPTIONS.map((l) => [l.code, l]));

/** ISO code → display name in the given locale; unknown code falls back to its
 *  uppercased code so a legacy value never renders blank. */
export function languageLabel(code: string, locale: "hu" | "en" | "es"): string {
  const opt = LANGUAGE_BY_CODE.get(code);
  return opt ? opt[locale] : code.toUpperCase();
}

export function isKnownLanguage(code: string): boolean {
  return LANGUAGE_BY_CODE.has(code);
}

/** Parse the stored `spoken_languages` string (comma-separated ISO codes) into a
 *  clean, de-duplicated, known-only list preserving the controlled order. */
export function parseSpokenLanguages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const set = new Set(
    raw
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => isKnownLanguage(c)),
  );
  return SPOKEN_LANGUAGE_OPTIONS.filter((l) => set.has(l.code)).map((l) => l.code);
}

/** Serialise a list of language codes back to the stored form, or null when
 *  empty so the column stays clean. */
export function formatSpokenLanguages(codes: readonly string[]): string | null {
  const clean = parseSpokenLanguages(codes.join(","));
  return clean.length > 0 ? clean.join(",") : null;
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
  /** Second published number, when a business runs one line for the venue/hotel
   *  desk and another for events. `contact_phone` stays the one to call about a
   *  wedding; this is the alternative. Absent on almost every listing. Masked
   *  for anonymous visitors exactly like `contact_phone`. */
  contact_phone_alt?: string | null;
  /** Optional street address. Surfaces on the card under the city/category line. */
  address: string | null;
  /** Approximate seated-dinner capacity range. Null = not published. */
  capacity_min: number | null;
  capacity_max: number | null;
  /** ISO 639-1 codes a verbal vendor (celebrant / MC) confidently works in.
   *  Absent/empty on every other category and on curated/community entries.
   *  See {@link showsSpokenLanguages}. */
  spoken_languages?: string[] | null;
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
  /**
   * This card's content was IMPORTED from the business's own profile on
   * another platform, rather than assembled by us from what they publish on
   * their own site. That is a different consent posture: they wrote that bio,
   * uploaded those photos and set that price for somebody else's directory.
   *
   * So until they claim the listing here, the public surfaces show a teaser —
   * one photo, no bio, no price, no phone (see `redactUnclaimedImport`). The
   * moment `vendor_account_id` is set they have accepted the profile and
   * everything shows.
   *
   * Absent/false on entries we built ourselves from public web data, which
   * are unaffected.
   */
  profile_imported?: boolean;
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
  /** The vendor has finished every step of their listing setup — the same
   *  checklist as their own completeness ring (`listingChecklistFor`), so the
   *  badge a couple sees and the % the vendor sees can never disagree.
   *
   *  This is what FILLS the verified check: a registered vendor whose listing
   *  is still missing photos or a price wears the badge as an outline. The
   *  business is really on Weddly either way, so the check is never withheld;
   *  the solid one just means "and the profile is finished".
   *
   *  Always `false` on unclaimed curated/community entries, which wear no
   *  badge at all — the vendor checklist has no meaning for them. */
  listing_complete: boolean;
}

/** One entry in the `/api/suppliers` country picker: an ISO alpha-2 code and
 *  how many curated listings sit in it. Sorted by `count` desc server-side. */
export interface SupplierCountryCount {
  code: string;
  count: number;
}

// ─── Visit analytics ────────────────────────────────────────────────────────

/** Public-side telemetry events the admin directory aggregates.
 *
 *  `view` is a PROFILE OPEN: somebody landed on this supplier's own page
 *  (`/vendors/{id}` publicly, `/app/suppliers/{id}` as a couple). `impression`
 *  is the far cheaper signal of a card merely appearing in a directory list.
 *  The two used to share the `view` type, which made "views" mean "how many
 *  times the catalogue was loaded in this country": the same number for every
 *  supplier in it, and useless the moment we show it to the vendor. Splitting
 *  them is what lets `views_*` be quoted as "this many people opened your
 *  profile". Rows written before the split are `view` regardless, so lifetime
 *  counters carry some legacy impression noise; the trailing windows heal
 *  themselves. */
export type SupplierEventType = "view" | "impression" | "website_click" | "phone_click";

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
  /** Directory-list appearances (see `SupplierEventType`). Counted separately
   *  from views so a listing that nobody opens can't look popular. */
  impressions_total: number;
  impressions_30d: number;
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
  /** ISO 3166-1 alpha-2, uppercase. Drives the teaser's country chips. */
  country: string;
  /** Registered Weddly vendor (`source === "claimed"`) — the same blue-check
   *  rule the in-app directory uses, so the badge means one thing everywhere. */
  verified: boolean;
  /** Listing setup finished — fills the check. See
   *  {@link DirectorySupplier.listing_complete}; same rule, same checklist. */
  listing_complete: boolean;
  /** Kilometres from the filtered town, rounded. Only set on entries in the
   *  `nearby` block, where "40 km away" is the fact that makes the card usable;
   *  absent on the in-town results, whose distance from themselves is noise. */
  distance_km?: number;
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
  /** Every country present in the eligible sample, with its listing count,
   *  busiest first. Independent of the active `?country=` filter, so the chip
   *  row doesn't collapse to one chip once a country is picked. */
  countries: SupplierCountryCount[];
  /** The visitor's country from IP geo, or null when the lookup is unavailable
   *  (no MaxMind DB) or misses. Vendors here are ranked ahead of the rest;
   *  nothing is hidden because of it. */
  viewer_country: string | null;
  /**
   * Vendors just outside the filtered town, grouped the same way as
   * `categories` and carrying `distance_km` on every entry.
   *
   * Only populated when a `?city=` filter is active AND the town itself came
   * back with almost nothing (see NEARBY_TRIGGER). A one-card page is a dead
   * end: the honest answer to "photographers in Győr" when there is one is not
   * an empty page but "here is the one, and here is everything within an
   * hour's drive". Empty array whenever the trigger doesn't fire, so callers
   * never branch on null.
   */
  nearby: PublicShowcaseCategory[];
  /** The town the `nearby` distances are measured from, as the visitor typed
   *  it. Null when there is no nearby block. */
  nearby_origin: string | null;
}

// ───────────────────────── Public vendor search ─────────────────────────
// One typeahead over three things a visitor might type: a business name, a
// town, or a kind of vendor. Vendors and cities are matched server-side (it
// holds the data); CATEGORIES are matched on the client, because the category
// names live in the frontend locale tree in three languages and duplicating
// them here would drift. Both sides score with `searchScore` below, so the
// three kinds can be merged into one ranked list of three.

/** Below this many characters the typeahead stays quiet — one letter matches
 *  most of the directory and reads as noise. */
export const VENDOR_SEARCH_MIN_CHARS = 2;
/** How many suggestions the visitor is offered. Three is the whole point: a
 *  short, decidable list rather than a results page in a dropdown. */
export const VENDOR_SEARCH_LIMIT = 3;

/** Lowercase and strip diacritics so "fotos" finds "Fotós" and "wien" finds
 *  "Wien". NFD splits an accented char into base + combining mark; the range
 *  below is the combining-marks block. */
export function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** How well `label` answers `foldedQuery` (already folded by the caller).
 *  0 means no match. The tiers are deliberately far apart so a whole-word hit
 *  always outranks a mid-word one, whatever kind of thing it is. */
export function searchScore(label: string, foldedQuery: string): number {
  if (foldedQuery.length === 0) return 0;
  const l = foldForSearch(label);
  if (l === foldedQuery) return 100;
  if (l.startsWith(foldedQuery)) return 70;
  // Any word in the label starting with the query: "zene" finds "Élő zene".
  if (l.split(/[\s&,/-]+/).some((w) => w.startsWith(foldedQuery))) return 55;
  if (l.includes(foldedQuery)) return 35;
  return 0;
}

/** A city string may carry the curated ", XX" country suffix ("Wien, AT").
 *  That suffix is a storage detail — never show it, never search it. */
export function cityDisplayName(city: string): string {
  return city.replace(/,\s*[A-Za-z]{2}\s*$/, "").trim();
}

// ─── Directory twins ────────────────────────────────────────────────────────
//
// A couple can record a vendor as a private entry (`couple_suppliers`, the
// "Saját" cards) from three places: the DIY modal on /app/suppliers, the venue
// picker in the guest-page editor, and the vendor pipeline on /app/planning.
// None of them looked at the directory first, so typing a name that is already
// listed produced two cards for one business: the couple's private copy sitting
// beside the real listing, with none of its photos, address, contact details or
// reviews. The helpers below are the shared "is this already on Weddly?"
// question all three forms now ask before they create a row.
//
// What "use the listed one instead" DOES differs per surface, which is why the
// adopt action is a callback rather than something these helpers perform: the
// DIY modal and the planning pipeline record a category pick, while the
// guest-page editor also copies the listing's address, phone and map pin onto
// the couple, because that is what its venue block renders.

/** Below this many characters we don't go looking for a twin — "DJ" or "Zsu"
 *  matches a large slice of the directory and every suggestion would be noise. */
export const SUPPLIER_TWIN_MIN_CHARS = 3;
/** A non-exact (prefix / contained) hit needs a longer query still: "kastely"
 *  is contained in dozens of venue names and means nothing on its own. */
const TWIN_LOOSE_MIN_CHARS = 6;

/** Legal forms couples type or omit at random. Dropped before comparing so
 *  "Hertelendy Kastély Kft." is the same place as "Hertelendy Kastély". Only
 *  unambiguous ones are listed: "co", "as" and "kg" are also ordinary words. */
const NAME_LEGAL_FORM = /\b(kft|bt|zrt|nyrt|kkt|gmbh|sro|ltd|llc|inc)\b/g;

/** Fold a business name down to what two people would agree is "the same name":
 *  no diacritics, no case, no legal form, no punctuation, single spaces. */
export function foldSupplierName(s: string): string {
  return foldForSearch(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(NAME_LEGAL_FORM, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two names denote the same business under `foldSupplierName`. */
export function isSameSupplierName(a: string, b: string): boolean {
  const folded = foldSupplierName(a);
  return folded.length > 0 && folded === foldSupplierName(b);
}

/** A directory entry that looks like the vendor the couple is typing in. */
export interface SupplierTwin<T> {
  supplier: T;
  /** The names fold to the same string — certainly the same business, so the
   *  form steers to it rather than merely offering it. */
  exact: boolean;
}

/** The minimum a candidate needs for `findSupplierTwins`. Kept structural
 *  rather than `DirectorySupplier` so a page can pass its own row shape. */
export interface TwinCandidate {
  id: string;
  name: string;
  category: SupplierCategory;
}

/** Directory entries that look like the business `name` describes, best first.
 *
 *  `category` narrows the search — a venue is compared against venues. Cross-
 *  category hits are still returned, but only on an exact name match, because
 *  a couple filing "Hertelendy Kastély" under Catering has mis-categorised the
 *  same place rather than found a second one. */
export function findSupplierTwins<T extends TwinCandidate>(
  name: string,
  category: SupplierCategory | null,
  directory: readonly T[],
  limit = 4,
): SupplierTwin<T>[] {
  const q = foldSupplierName(name);
  if (q.length < SUPPLIER_TWIN_MIN_CHARS) return [];
  const scored: { twin: SupplierTwin<T>; score: number }[] = [];
  for (const s of directory) {
    const c = foldSupplierName(s.name);
    if (!c) continue;
    const sameCategory = category === null || s.category === category;
    if (c === q) {
      scored.push({ twin: { supplier: s, exact: true }, score: sameCategory ? 100 : 90 });
      continue;
    }
    // Everything below is a guess, so it applies only inside the category the
    // couple chose, and only to a query long enough to mean something.
    if (!sameCategory || q.length < TWIN_LOOSE_MIN_CHARS) continue;
    if (c.startsWith(q) || q.startsWith(c)) {
      scored.push({ twin: { supplier: s, exact: false }, score: 70 });
    } else if (` ${c} `.includes(` ${q} `)) {
      scored.push({ twin: { supplier: s, exact: false }, score: 50 });
    }
  }
  scored.sort(
    (a, b) => b.score - a.score || a.twin.supplier.name.localeCompare(b.twin.supplier.name),
  );
  return scored.slice(0, limit).map((r) => r.twin);
}

/** One row in the typeahead. `kind` decides where picking it goes:
 *  vendor → /vendors/{id}, city → /vendors/browse?city={label},
 *  category → /vendors/browse?category={category}. */
export interface PublicVendorSuggestion {
  kind: "vendor" | "city" | "category";
  /** Ranking value from `searchScore` plus per-kind nudges. Client-side
   *  category hits are scored with the same function and merged on this. */
  score: number;
  /** Vendor name, city name, or (client-side) the localized category label. */
  label: string;
  /** Directory id — vendor hits only. */
  id?: string;
  /** Vendor hits: the vendor's category, for the context line. Category hits:
   *  the category itself. */
  category?: SupplierCategory;
  /** Vendor hits: the vendor's city, for the context line. */
  city?: string;
  /** City + category hits: how many photographed listings sit behind it. */
  count?: number;
}

/** GET /api/public/vendor-search?q= — vendor + city hits, plus the category
 *  census the client needs to match category names in its own language. */
export interface PublicVendorSearchResult {
  /** Vendor and city hits only, best first. Never longer than
   *  `VENDOR_SEARCH_LIMIT` (the client still has categories to merge in). */
  suggestions: PublicVendorSuggestion[];
  /** Every category with at least one browsable (photographed) listing.
   *  Query-independent — it's the set the client scores against. */
  categories: { category: SupplierCategory; count: number }[];
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
  /** Contact coverage. "no_email" narrows to listings with no contact_email,
   *  which is the set no outbound flow can reach: the claim-invite campaign
   *  mails contact_email, so a listing without one can never be offered to its
   *  owner and has to be chased by hand. Whole scraped batches arrive this way
   *  (Google Maps publishes a phone and a website, never an address). */
  contact?: "all" | "no_email";
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

/** Length bounds for a couple's free-text ("+1") review tag. Short by design —
 *  a tag is a chip, not a sentence; the review body is where prose goes. */
export const CUSTOM_REVIEW_TAG_MIN_CHARS = 2;
export const CUSTOM_REVIEW_TAG_MAX_CHARS = 24;

const KNOWN_REVIEW_TAG_SET: ReadonlySet<string> = new Set(SUPPLIER_REVIEW_TAGS);

/** True when `tag` is a member of the controlled vocabulary (so it has an i18n
 *  label and may feed the aggregate top-tags). A free-text tag is anything else. */
export function isKnownReviewTag(tag: string): tag is SupplierReviewTag {
  return KNOWN_REVIEW_TAG_SET.has(tag);
}

/** Validate + canonicalise a free-text review tag. Returns the cleaned tag, or
 *  null when it fails the shape rules (too short/long, or characters we don't
 *  allow in a chip). Trims, collapses inner whitespace, and folds onto the
 *  controlled vocabulary when the typed text is really the same word — so a
 *  typed "Professional" or "english speaking" dedups against the existing chip
 *  instead of living as a look-alike custom tag. The returned value is either a
 *  SupplierReviewTag (folded) or arbitrary user text; callers must render it via
 *  reviewTagLabel, never straight through i18n. */
export function normaliseCustomReviewTag(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/gu, " ").trim();
  if (cleaned.length < CUSTOM_REVIEW_TAG_MIN_CHARS) return null;
  if (cleaned.length > CUSTOM_REVIEW_TAG_MAX_CHARS) return null;
  // Letters (any script, so HU accents pass), digits, spaces, and a small set of
  // in-word separators only. Keeps out newlines, angle brackets, emoji spam.
  if (!/^[\p{L}\p{N} '&/-]+$/u.test(cleaned)) return null;
  const canonical = cleaned.toLowerCase().replace(/[\s-]+/gu, "_");
  return isKnownReviewTag(canonical) ? canonical : cleaned;
}

/** Validate a whole tag payload (known + free-text mixed), deduped
 *  case-insensitively and capped at MAX_REVIEW_TAGS. Returns the canonical list,
 *  or throws the offending entry via `onInvalid` (the write path 400s; a lenient
 *  read path passes a no-op that drops it). Shared by backend route + domain. */
export function normaliseReviewTags(
  raw: unknown,
  onInvalid: (entry: unknown) => void = () => {},
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag =
      typeof entry === "string"
        ? isKnownReviewTag(entry)
          ? entry
          : normaliseCustomReviewTag(entry)
        : null;
    if (tag === null) {
      onInvalid(entry);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_REVIEW_TAGS) break;
  }
  return out;
}

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
  celebrant: ["creative", ...UNIVERSAL_REVIEW_TAGS],
  dance_lessons: ["creative", ...UNIVERSAL_REVIEW_TAGS],
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
/** Cap for the optional "what you got for the price" note on a review — short
 *  by design (it's a caption next to a figure, not prose). */
export const REVIEW_AMOUNT_NOTE_MAX_CHARS = 80;
/** Sanity ceiling on the optional paid amount (whole currency units). Guards a
 *  fat-fingered figure from becoming a wild outlier; ~1 billion covers any real
 *  wedding line item in any supported currency. */
export const REVIEW_AMOUNT_MAX = 1_000_000_000;

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
  /** Controlled-vocabulary tags AND couples' free-text ("+1") tags, mixed. A
   *  known member has an i18n label; a free-text entry renders verbatim. Always
   *  render via `reviewTagLabel`, never `t("suppliers.reviewTags.<tag>")`. */
  tags: string[];
  /** Optional "what it cost": a whole-unit integer amount in `amount_currency`,
   *  captured at write time so it reads unambiguously for any later viewer. Both
   *  null when the reviewer didn't share a price. */
  amount_paid: number | null;
  amount_currency: string | null;
  /** Optional short caption for what the amount bought ("full day + album"). */
  amount_note: string | null;
  published: boolean;
  /** True when the review is authored by an admin under the "Weddly editors"
   *  voice (couple_id null, author_kind 'admin'). Drives the editorial badge. */
  editorial: boolean;
  /** True when the author had engagement proof at write time (a couple with a
   *  cost-plan row or category pick for this supplier). Drives the "Verified"
   *  badge. Since reviews opened to any verified email, `!editorial` no longer
   *  implies verified — an open community/visitor review has verified=false. */
  verified: boolean;
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
  /** Optional paid amount (whole units of `amount_currency`). */
  amount_paid?: number | null;
  /** ISO code the amount is in; defaults server-side from the reviewer's
   *  locale/couple when omitted. */
  amount_currency?: string | null;
  /** Optional short "what you got for the price" caption. */
  amount_note?: string | null;
  published?: boolean;
}

export interface ReviewListResponse {
  items: SupplierReview[];
  nextCursor: string | null;
  summary: ReviewSummary;
  /** Viewer may open the composer: an admin, or any logged-in user with a
   *  verified email who hasn't already reviewed this supplier. */
  can_review: boolean;
  /** Viewer (their couple, or themselves) already has a non-deleted review here. */
  already_reviewed: boolean;
}

/** Admin moderation view of a flagged review (a low-rating open review, still
 *  publicly visible). Carries the fields the moderation queue renders. */
export interface AdminFlaggedReview {
  id: number;
  supplier_id: string;
  /** Best-effort listing name; null for curated code-only suppliers (show id). */
  supplier_name: string | null;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string | null;
  /** Mixed controlled + free-text tags — see SupplierReview.tags. */
  tags: string[];
  author_display_name: string;
  author_kind: "admin" | "couple" | "user" | "visitor";
  created_at: number;
}

export interface AdminFlaggedReviewsResponse {
  items: AdminFlaggedReview[];
  nextCursor: string | null;
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
  /** The vendor's recurring weekly working pattern as ISO weekday numbers
   *  (1 = Monday … 7 = Sunday), or null for "works any day".
   *
   *  Sent as the PATTERN rather than as enumerated dates because it describes an
   *  unbounded set — a vendor who only works weekends would otherwise need every
   *  weekday from here to forever listed in `unavailable_dates`. The client
   *  resolves a given day with `resolveDayAvailability` in
   *  shared/vendor_availability.ts, the same function the server uses. */
  available_weekdays: number[] | null;
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
