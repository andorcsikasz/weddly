// Venue profile: the part of a venue listing that the generic listing card
// cannot say. A photographer's price is one number; a venue's price depends on
// the date, the day of the week and the guest count, and what a couple needs
// to know before writing ("do they allow our caterer?", "does 79 guests clear
// their Saturday minimum?") is structured fact, not prose.
//
// Three aggregates hang off one listing, all keyed on `listings.id` (bare
// TEXT, no FK, like `listing_packages`):
//   - the PROFILE (one row): tags, capacities, facilities, catering / drinks /
//     supplier rules;
//   - SPACES (N rows): the rooms and gardens inside the venue;
//   - PRICING RULES (N rows): a season x day-of-week x guest-band condition
//     plus a list of price items.
//
// Rules worth not re-deriving:
//   - EVERY field is optional. An empty profile is the resting state, never an
//     error, and a couple-facing surface renders nothing for an unanswered
//     question rather than a "no". "Parking: no" and "we did not ask" are
//     different answers.
//   - The estimate is DERIVED and pure (`estimateVenueCost`), so the couple's
//     page, the vendor's preview and any later quote prefill cannot disagree
//     about arithmetic. Nothing stores a computed total.
//   - An item that cannot be priced from what we know (on request, per room
//     with no room count, per guest with no guest count) is EXCLUDED from the
//     total and flips `is_from`, never imputed. Same rule Revenue Pulse follows
//     for an unpriced lead: a number nobody quoted must not appear in a sum.
//   - A security deposit is refundable, so it is shown and never summed.
//   - The guest band is a WARNING, not a filter. A couple with 79 guests on a
//     Saturday whose only rule wants 100 must SEE that rule and why it does
//     not fit, before they write; filtering it away would answer "no price"
//     and hide the one fact they needed.

import type { Currency } from "./currency";

// ── Profile vocabulary ─────────────────────────────────────────────────────

export type VenueType =
  | "castle_manor"
  | "hotel"
  | "restaurant"
  | "vineyard"
  | "event_venue"
  | "villa"
  | "barn_farm"
  | "garden_venue"
  | "rooftop";

export const VENUE_TYPES: readonly VenueType[] = [
  "castle_manor",
  "hotel",
  "restaurant",
  "vineyard",
  "event_venue",
  "villa",
  "barn_farm",
  "garden_venue",
  "rooftop",
];

export type VenueSetting =
  | "garden"
  | "terrace"
  | "waterfront"
  | "forest"
  | "panoramic_view"
  | "historic_building"
  | "indoor_ceremony"
  | "outdoor_ceremony"
  | "private_estate";

export const VENUE_SETTINGS: readonly VenueSetting[] = [
  "garden",
  "terrace",
  "waterfront",
  "forest",
  "panoramic_view",
  "historic_building",
  "indoor_ceremony",
  "outdoor_ceremony",
  "private_estate",
];

export type VenueStyleTag =
  | "elegant"
  | "classic"
  | "modern"
  | "rustic"
  | "romantic"
  | "boho"
  | "minimalist"
  | "luxury";

export const VENUE_STYLE_TAGS: readonly VenueStyleTag[] = [
  "elegant",
  "classic",
  "modern",
  "rustic",
  "romantic",
  "boho",
  "minimalist",
  "luxury",
];

export type VenueFacility =
  | "accommodation"
  | "bridal_suite"
  | "parking"
  | "accessible"
  | "child_friendly"
  | "pet_friendly"
  | "next_day_brunch";

export const VENUE_FACILITIES: readonly VenueFacility[] = [
  "accommodation",
  "bridal_suite",
  "parking",
  "accessible",
  "child_friendly",
  "pet_friendly",
  "next_day_brunch",
];

export type CateringRule =
  | "included"
  | "in_house_required"
  | "in_house_available"
  | "external_allowed"
  | "byo_allowed";

export const CATERING_RULES: readonly CateringRule[] = [
  "included",
  "in_house_required",
  "in_house_available",
  "external_allowed",
  "byo_allowed",
];

export type DrinksRule =
  | "package_included"
  | "package_available"
  | "byo_drinks"
  | "byo_wine"
  | "corkage_fee"
  | "spirits_allowed";

export const DRINKS_RULES: readonly DrinksRule[] = [
  "package_included",
  "package_available",
  "byo_drinks",
  "byo_wine",
  "corkage_fee",
  "spirits_allowed",
];

/** Who may work the wedding. Exclusive, unlike the flag sets above: a venue
 *  has one policy. The per-trade exceptions ride in `external_allowed`, so
 *  "partners only, but bring your own photographer" is expressible. */
export type SupplierPolicy = "any" | "preferred_list" | "partners_only";

export const SUPPLIER_POLICIES: readonly SupplierPolicy[] = [
  "any",
  "preferred_list",
  "partners_only",
];

export type ExternalSupplierKind = "decorator" | "music" | "photo_video";

export const EXTERNAL_SUPPLIER_KINDS: readonly ExternalSupplierKind[] = [
  "decorator",
  "music",
  "photo_video",
];

export const VENUE_TEXT_MAX = 400;
export const VENUE_SHORT_TEXT_MAX = 80;
/** Any capacity above this is a typo, not a venue. */
export const VENUE_GUESTS_MAX = 10_000;

export interface VenueProfile {
  venue_types: VenueType[];
  settings: VenueSetting[];
  styles: VenueStyleTag[];
  contact_person: string | null;
  /** Handle or URL, as the vendor typed it (normalised to a bare handle). */
  instagram: string | null;
  min_guests: number | null;
  max_seated: number | null;
  max_ceremony: number | null;
  max_standing: number | null;
  /** Guests who can sleep on site. Only meaningful with the `accommodation`
   *  facility; the server clears it when that facility is off. */
  accommodation_capacity: number | null;
  facilities: VenueFacility[];
  catering: CateringRule[];
  /** Free text: the caterers the venue recommends or works with. */
  catering_partners: string | null;
  drinks: DrinksRule[];
  supplier_policy: SupplierPolicy | null;
  external_allowed: ExternalSupplierKind[];
  /** Anything the structured rules cannot say ("music until 2am", ...). */
  rules_note: string | null;
  updated_at: number | null;
}

export type VenueProfilePatch = Partial<Omit<VenueProfile, "updated_at">>;

export function emptyVenueProfile(): VenueProfile {
  return {
    venue_types: [],
    settings: [],
    styles: [],
    contact_person: null,
    instagram: null,
    min_guests: null,
    max_seated: null,
    max_ceremony: null,
    max_standing: null,
    accommodation_capacity: null,
    facilities: [],
    catering: [],
    catering_partners: null,
    drinks: [],
    supplier_policy: null,
    external_allowed: [],
    rules_note: null,
    updated_at: null,
  };
}

/** Catering flags that cannot both be true. "In-house required" is exactly the
 *  statement that outside food is not allowed, so pairing it with either
 *  outside-food flag publishes a contradiction a couple would act on. */
export function cateringConflict(rules: readonly CateringRule[]): boolean {
  return (
    rules.includes("in_house_required") &&
    (rules.includes("external_allowed") || rules.includes("byo_allowed"))
  );
}

/** Has the vendor told couples anything at all? Drives whether the couple
 *  page renders the venue sections. */
export function venueProfileHasContent(p: VenueProfile): boolean {
  return (
    p.venue_types.length > 0 ||
    p.settings.length > 0 ||
    p.styles.length > 0 ||
    p.facilities.length > 0 ||
    p.catering.length > 0 ||
    p.drinks.length > 0 ||
    p.external_allowed.length > 0 ||
    p.supplier_policy !== null ||
    p.min_guests !== null ||
    p.max_seated !== null ||
    p.max_ceremony !== null ||
    p.max_standing !== null ||
    p.catering_partners !== null ||
    p.rules_note !== null
  );
}

// ── Spaces ─────────────────────────────────────────────────────────────────

export type VenueSpaceUse = "ceremony" | "dinner" | "reception" | "getting_ready" | "accommodation";

export const VENUE_SPACE_USES: readonly VenueSpaceUse[] = [
  "ceremony",
  "dinner",
  "reception",
  "getting_ready",
  "accommodation",
];

export type VenueSpaceSetting = "indoor" | "outdoor" | "both";
export const VENUE_SPACE_SETTINGS: readonly VenueSpaceSetting[] = ["indoor", "outdoor", "both"];

export type VenueSpaceFee = "included" | "extra";
export const VENUE_SPACE_FEES: readonly VenueSpaceFee[] = ["included", "extra"];

export const MAX_VENUE_SPACES = 12;
/** Photos per space, chosen from the listing's own gallery. */
export const MAX_SPACE_PHOTOS = 6;

export interface VenueSpace {
  id: number;
  name: string;
  uses: VenueSpaceUse[];
  setting: VenueSpaceSetting | null;
  capacity: number | null;
  fee: VenueSpaceFee | null;
  /** Only with `fee === "extra"`; whole units of the listing currency. */
  fee_amount: number | null;
  weather_backup: boolean;
  description: string | null;
  /** `listing_photos.id`s, in vendor order. A space borrows from the gallery
   *  rather than owning uploads, so a photo is stored once and a space whose
   *  photo was deleted from the gallery simply loses it. */
  photo_ids: number[];
  /** Resolved from `photo_ids` on read; deleted photos drop out. */
  photo_urls: string[];
  position: number;
}

export interface VenueSpaceInput {
  name?: string;
  uses?: VenueSpaceUse[];
  setting?: VenueSpaceSetting | null;
  capacity?: number | null;
  fee?: VenueSpaceFee | null;
  fee_amount?: number | null;
  weather_backup?: boolean;
  description?: string | null;
  photo_ids?: number[];
}

// ── Pricing rules ──────────────────────────────────────────────────────────

/** Mon-Thu is one bucket on purpose: no venue prices a Tuesday apart from a
 *  Wednesday, and four near-identical rules would be noise in the editor. */
export type VenueDayKind = "weekday" | "friday" | "saturday" | "sunday" | "holiday";

export const VENUE_DAY_KINDS: readonly VenueDayKind[] = [
  "weekday",
  "friday",
  "saturday",
  "sunday",
  "holiday",
];

export type VenuePriceItemKey =
  | "venue_rental"
  | "ceremony_location"
  | "catering"
  | "drinks"
  | "accommodation"
  | "extra_hour"
  | "cleaning"
  | "technical"
  | "corkage"
  | "security_deposit"
  | "other_mandatory"
  | "custom";

export const VENUE_PRICE_ITEM_KEYS: readonly VenuePriceItemKey[] = [
  "venue_rental",
  "ceremony_location",
  "catering",
  "drinks",
  "accommodation",
  "extra_hour",
  "cleaning",
  "technical",
  "corkage",
  "security_deposit",
  "other_mandatory",
  "custom",
];

export type VenuePriceMode =
  | "free"
  | "included"
  | "fixed"
  | "per_guest"
  | "per_room"
  | "per_hour"
  | "from"
  | "on_request"
  | "not_available";

export const VENUE_PRICE_MODES: readonly VenuePriceMode[] = [
  "free",
  "included",
  "fixed",
  "per_guest",
  "per_room",
  "per_hour",
  "from",
  "on_request",
  "not_available",
];

/** Modes that carry an amount. Every other mode must NOT, or the row would
 *  say "included" and "30 000" at once. */
export const PRICED_MODES: readonly VenuePriceMode[] = [
  "fixed",
  "per_guest",
  "per_room",
  "per_hour",
  "from",
];

/** Modes that multiply by a vendor-given quantity (rooms, hours). */
export const QUANTITY_MODES: readonly VenuePriceMode[] = ["per_room", "per_hour"];

export const MAX_VENUE_PRICING_RULES = 16;
export const MAX_VENUE_PRICE_ITEMS = 20;
export const VENUE_QUANTITY_MAX = 500;

export interface VenuePriceItem {
  key: VenuePriceItemKey;
  /** Required for `custom`, optional relabel otherwise. */
  label: string | null;
  mode: VenuePriceMode;
  /** Whole units of the listing currency; only for PRICED_MODES. */
  amount: number | null;
  /** Default rooms / hours for per_room / per_hour. Null means "depends",
   *  which keeps the line out of the total. */
  quantity: number | null;
  /** Optional extras (an extra hour) are listed, never summed. */
  optional: boolean;
}

export interface VenuePricingRule {
  id: number;
  name: string;
  /** 1-12, inclusive. start > end wraps the year (Nov-Feb). */
  start_month: number;
  end_month: number;
  days: VenueDayKind[];
  min_guests: number | null;
  max_guests: number | null;
  /** Whole units; the total never reads below it. */
  min_spend: number | null;
  /** False = the venue does not take weddings under this condition. */
  available: boolean;
  items: VenuePriceItem[];
  position: number;
  updated_at: number;
}

export interface VenuePricingRuleInput {
  name?: string;
  start_month?: number;
  end_month?: number;
  days?: VenueDayKind[];
  min_guests?: number | null;
  max_guests?: number | null;
  min_spend?: number | null;
  available?: boolean;
  items?: VenuePriceItem[];
}

/** Everything the venue sections of a page need, in one payload. Rides on
 *  `SupplierDetail.venue` for couples and is the vendor editor's GET body. */
export interface VenueDetail {
  profile: VenueProfile;
  spaces: VenueSpace[];
  pricing_rules: VenuePricingRule[];
  currency: Currency;
  /** ISO alpha-2, or null. Decides which public holidays the `holiday` day
   *  kind recognises (see `publicHolidays`). */
  country: string | null;
}

// ── Calendar ───────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** Gregorian Easter Sunday (anonymous algorithm), as [month, day]. */
function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function isoOf(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Nationwide public holidays. Fixed dates as "MM-DD"; movable feasts as an
 *  offset in days from Easter Sunday. Regional holidays are left out on
 *  purpose: a venue in Bavaria and one in Berlin would disagree, and a wrong
 *  "holiday" price is worse than the ordinary day's price. A country with no
 *  table simply never matches `holiday` (`hasHolidayCalendar` tells the editor
 *  so it can say so rather than offer a condition that never fires). */
const HOLIDAYS: Record<string, { fixed: string[]; easter: number[] }> = {
  HU: {
    fixed: ["01-01", "03-15", "05-01", "08-20", "10-23", "11-01", "12-24", "12-25", "12-26"],
    easter: [-2, 1, 50],
  },
  AT: {
    fixed: ["01-01", "01-06", "05-01", "08-15", "10-26", "11-01", "12-08", "12-25", "12-26"],
    easter: [1, 39, 50, 60],
  },
  DE: { fixed: ["01-01", "05-01", "10-03", "12-25", "12-26"], easter: [-2, 1, 39, 50] },
  HR: {
    fixed: [
      "01-01",
      "01-06",
      "05-01",
      "05-30",
      "06-22",
      "08-05",
      "08-15",
      "11-01",
      "11-18",
      "12-25",
      "12-26",
    ],
    easter: [0, 1, 60],
  },
  IT: {
    fixed: [
      "01-01",
      "01-06",
      "04-25",
      "05-01",
      "06-02",
      "08-15",
      "11-01",
      "12-08",
      "12-25",
      "12-26",
    ],
    easter: [0, 1],
  },
  FR: {
    fixed: ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"],
    easter: [1, 39, 50],
  },
  CZ: {
    fixed: [
      "01-01",
      "05-01",
      "05-08",
      "07-05",
      "07-06",
      "09-28",
      "10-28",
      "11-17",
      "12-24",
      "12-25",
      "12-26",
    ],
    easter: [-2, 1],
  },
  SK: {
    fixed: ["01-01", "01-06", "05-01", "07-05", "08-29", "11-01", "12-24", "12-25", "12-26"],
    easter: [-2, 1],
  },
  PL: {
    fixed: [
      "01-01",
      "01-06",
      "05-01",
      "05-03",
      "08-15",
      "11-01",
      "11-11",
      "12-24",
      "12-25",
      "12-26",
    ],
    easter: [0, 1, 49, 60],
  },
  ES: {
    fixed: ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"],
    easter: [-2],
  },
};

export function hasHolidayCalendar(country: string | null | undefined): boolean {
  return country != null && HOLIDAYS[country.toUpperCase()] !== undefined;
}

export function publicHolidays(country: string | null | undefined, year: number): Set<string> {
  const out = new Set<string>();
  const table = country ? HOLIDAYS[country.toUpperCase()] : undefined;
  if (!table) return out;
  for (const md of table.fixed) out.add(`${year}-${md}`);
  const [em, ed] = easterSunday(year);
  const easter = Date.UTC(year, em - 1, ed);
  for (const offset of table.easter) {
    out.add(isoOf(new Date(easter + offset * 86_400_000)));
  }
  return out;
}

/** Every day kind a date belongs to. A holiday Saturday is both, so a rule on
 *  either matches it. */
export function dayKindsFor(iso: string, country: string | null | undefined): VenueDayKind[] {
  const p = parseIsoDate(iso);
  if (!p) return [];
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const kinds: VenueDayKind[] = [];
  if (dow === 5) kinds.push("friday");
  else if (dow === 6) kinds.push("saturday");
  else if (dow === 0) kinds.push("sunday");
  else kinds.push("weekday");
  if (publicHolidays(country, p.y).has(iso)) kinds.push("holiday");
  return kinds;
}

export function monthInRange(month: number, start: number, end: number): boolean {
  return start <= end ? month >= start && month <= end : month >= start || month <= end;
}

function monthsCovered(rule: Pick<VenuePricingRule, "start_month" | "end_month">): number {
  const { start_month: s, end_month: e } = rule;
  return s <= e ? e - s + 1 : 12 - s + 1 + e;
}

export function ruleCoversDate(
  rule: Pick<VenuePricingRule, "start_month" | "end_month" | "days">,
  iso: string,
  country: string | null | undefined,
): boolean {
  const p = parseIsoDate(iso);
  if (!p) return false;
  if (!monthInRange(p.m, rule.start_month, rule.end_month)) return false;
  const kinds = dayKindsFor(iso, country);
  return rule.days.some((d) => kinds.includes(d));
}

export type GuestFit = "ok" | "below_min" | "above_max" | "unknown";

export function guestFit(
  rule: Pick<VenuePricingRule, "min_guests" | "max_guests">,
  guests: number | null,
): GuestFit {
  if (guests === null) return "unknown";
  if (rule.min_guests !== null && guests < rule.min_guests) return "below_min";
  if (rule.max_guests !== null && guests > rule.max_guests) return "above_max";
  return "ok";
}

// ── Estimate ───────────────────────────────────────────────────────────────

export type VenueLineStatus =
  | "charged"
  | "free"
  | "included"
  | "on_request"
  | "not_available"
  | "optional"
  | "refundable"
  | "needs_quantity";

export interface VenueEstimateLine {
  item: VenuePriceItem;
  /** Multiplier actually used (guests / rooms / hours), or null. */
  quantity: number | null;
  subtotal: number | null;
  status: VenueLineStatus;
}

export interface VenueEstimate {
  lines: VenueEstimateLine[];
  /** Sum of the charged lines before any minimum spend. */
  subtotal: number;
  /** What the couple should expect to pay at least. */
  total: number;
  min_spend_applied: boolean;
  /** True when some mandatory line could not be priced, or is itself a
   *  "from" price: the total is then a floor, and the UI says "from". */
  is_from: boolean;
}

export function estimateVenueCost(
  rule: Pick<VenuePricingRule, "items" | "min_spend">,
  guests: number | null,
): VenueEstimate {
  let subtotal = 0;
  let isFrom = false;
  const lines: VenueEstimateLine[] = rule.items.map((item) => {
    const line = (
      status: VenueLineStatus,
      quantity: number | null = null,
      sub: number | null = null,
    ): VenueEstimateLine => ({ item, quantity, subtotal: sub, status });
    switch (item.mode) {
      case "free":
        return line("free");
      case "included":
        return line("included");
      case "not_available":
        return line("not_available");
      case "on_request":
        if (!item.optional) isFrom = true;
        return line(item.optional ? "optional" : "on_request");
      default:
        break;
    }
    const amount = item.amount ?? 0;
    let qty: number | null = 1;
    if (item.mode === "per_guest") qty = guests;
    else if (item.mode === "per_room" || item.mode === "per_hour") qty = item.quantity;
    const sub = qty === null ? null : amount * qty;
    if (item.key === "security_deposit") return line("refundable", qty, sub);
    if (item.optional) return line("optional", qty, sub);
    if (sub === null) {
      isFrom = true;
      return line("needs_quantity");
    }
    if (item.mode === "from") isFrom = true;
    subtotal += sub;
    return line("charged", qty, sub);
  });
  const minSpend = rule.min_spend ?? 0;
  const minSpendApplied = minSpend > subtotal;
  return {
    lines,
    subtotal,
    total: minSpendApplied ? minSpend : subtotal,
    min_spend_applied: minSpendApplied,
    is_from: isFrom,
  };
}

export type VenuePricingMatch =
  | { kind: "no_rules" }
  | { kind: "no_date" }
  | { kind: "no_match" }
  | { kind: "unavailable"; rule: VenuePricingRule }
  | {
      kind: "priced";
      rule: VenuePricingRule;
      fit: GuestFit;
      estimate: VenueEstimate;
      /** Guests above the venue's own seated maximum, independent of the
       *  rule's band. */
      over_capacity: boolean;
    };

/** Pick the rule that prices `date` for `guests`.
 *
 *  Among rules covering the date, the MOST SPECIFIC wins (fewest months, then
 *  fewest day kinds, then the vendor's order), so "August: unavailable" beats
 *  "May-September Saturday" without the vendor having to reorder anything.
 *  Within that order a rule whose guest band fits is preferred; when none
 *  fits, the most specific rule is returned with the misfit named rather than
 *  dropped (see the header note). */
export function matchVenuePricing(
  detail: Pick<VenueDetail, "pricing_rules" | "country" | "profile">,
  query: { date: string | null; guests: number | null },
): VenuePricingMatch {
  if (detail.pricing_rules.length === 0) return { kind: "no_rules" };
  if (!query.date || !parseIsoDate(query.date)) return { kind: "no_date" };
  const date = query.date;
  const covering = detail.pricing_rules
    .filter((r) => ruleCoversDate(r, date, detail.country))
    .sort(
      (a, b) =>
        monthsCovered(a) - monthsCovered(b) ||
        a.days.length - b.days.length ||
        a.position - b.position,
    );
  const first = covering[0];
  if (!first) return { kind: "no_match" };
  const fitting = covering.find((r) => {
    const fit = guestFit(r, query.guests);
    return fit === "ok" || fit === "unknown";
  });
  const rule = fitting ?? first;
  if (!rule.available) return { kind: "unavailable", rule };
  const maxSeated = detail.profile.max_seated;
  return {
    kind: "priced",
    rule,
    fit: guestFit(rule, query.guests),
    estimate: estimateVenueCost(rule, query.guests),
    over_capacity: query.guests !== null && maxSeated !== null && query.guests > maxSeated,
  };
}

/** "May-Sep" style label input: the two month numbers, for the UI to format. */
export function ruleIsYearRound(
  rule: Pick<VenuePricingRule, "start_month" | "end_month">,
): boolean {
  return monthsCovered(rule) === 12;
}
