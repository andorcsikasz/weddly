// Storage for the venue profile, spaces and pricing rules (shared/venue.ts).
// Validation lives at the route boundary (routes/vendor_venue.ts); this module
// trusts its inputs and only guarantees that what it READS back is inside the
// current vocabulary, so a key dropped from shared/venue.ts can never reach a
// couple-facing page from an old row.

import type { Currency } from "@shared/currency";
import {
  CATERING_RULES,
  DRINKS_RULES,
  EXTERNAL_SUPPLIER_KINDS,
  emptyVenueProfile,
  SUPPLIER_POLICIES,
  VENUE_DAY_KINDS,
  VENUE_FACILITIES,
  VENUE_PRICE_ITEM_KEYS,
  VENUE_PRICE_MODES,
  VENUE_SETTINGS,
  VENUE_SPACE_FEES,
  VENUE_SPACE_SETTINGS,
  VENUE_SPACE_USES,
  VENUE_STYLE_TAGS,
  VENUE_TYPES,
  venueProfileHasContent,
  type SupplierPolicy,
  type VenueDetail,
  type VenuePriceItem,
  type VenuePricingRule,
  type VenueProfile,
  type VenueProfilePatch,
  type VenueSpace,
  type VenueSpaceFee,
  type VenueSpaceSetting,
} from "@shared/venue";
import { db, now } from "../db";

/** Parse a JSON array column and keep only values in `allowed`, deduped. The
 *  vendor's own order is kept (sorting into vocabulary order would reorder
 *  what they picked). */
function keysFrom<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: T[] = [];
  for (const v of parsed) {
    if (
      typeof v === "string" &&
      (allowed as readonly string[]).includes(v) &&
      !out.includes(v as T)
    ) {
      out.push(v as T);
    }
  }
  return out;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

// ── Profile ────────────────────────────────────────────────────────────────

interface ProfileRow {
  venue_types: string;
  settings: string;
  styles: string;
  contact_person: string | null;
  instagram: string | null;
  min_guests: number | null;
  max_seated: number | null;
  max_ceremony: number | null;
  max_standing: number | null;
  accommodation_capacity: number | null;
  facilities: string;
  catering: string;
  catering_partners: string | null;
  drinks: string;
  supplier_policy: string | null;
  external_allowed: string;
  rules_note: string | null;
  updated_at: number;
}

export function getVenueProfile(listingId: string): VenueProfile {
  const row = db
    .prepare("SELECT * FROM listing_venue_profiles WHERE listing_id = ?")
    .get(listingId) as ProfileRow | null;
  if (!row) return emptyVenueProfile();
  return {
    venue_types: keysFrom(row.venue_types, VENUE_TYPES),
    settings: keysFrom(row.settings, VENUE_SETTINGS),
    styles: keysFrom(row.styles, VENUE_STYLE_TAGS),
    contact_person: row.contact_person,
    instagram: row.instagram,
    min_guests: row.min_guests,
    max_seated: row.max_seated,
    max_ceremony: row.max_ceremony,
    max_standing: row.max_standing,
    accommodation_capacity: row.accommodation_capacity,
    facilities: keysFrom(row.facilities, VENUE_FACILITIES),
    catering: keysFrom(row.catering, CATERING_RULES),
    catering_partners: row.catering_partners,
    drinks: keysFrom(row.drinks, DRINKS_RULES),
    supplier_policy: oneOf<SupplierPolicy>(row.supplier_policy, SUPPLIER_POLICIES),
    external_allowed: keysFrom(row.external_allowed, EXTERNAL_SUPPLIER_KINDS),
    rules_note: row.rules_note,
    updated_at: row.updated_at,
  };
}

/** Apply an already-validated partial patch. Absent keys are left alone. */
export function saveVenueProfile(listingId: string, patch: VenueProfilePatch): VenueProfile {
  const next: VenueProfile = { ...getVenueProfile(listingId), ...patch, updated_at: now() };
  // Accommodation capacity without accommodation is a number about nothing.
  if (!next.facilities.includes("accommodation")) next.accommodation_capacity = null;
  db.prepare(
    `INSERT INTO listing_venue_profiles
       (listing_id, venue_types, settings, styles, contact_person, instagram,
        min_guests, max_seated, max_ceremony, max_standing, accommodation_capacity,
        facilities, catering, catering_partners, drinks, supplier_policy,
        external_allowed, rules_note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_id) DO UPDATE SET
       venue_types = excluded.venue_types,
       settings = excluded.settings,
       styles = excluded.styles,
       contact_person = excluded.contact_person,
       instagram = excluded.instagram,
       min_guests = excluded.min_guests,
       max_seated = excluded.max_seated,
       max_ceremony = excluded.max_ceremony,
       max_standing = excluded.max_standing,
       accommodation_capacity = excluded.accommodation_capacity,
       facilities = excluded.facilities,
       catering = excluded.catering,
       catering_partners = excluded.catering_partners,
       drinks = excluded.drinks,
       supplier_policy = excluded.supplier_policy,
       external_allowed = excluded.external_allowed,
       rules_note = excluded.rules_note,
       updated_at = excluded.updated_at`,
  ).run(
    listingId,
    JSON.stringify(next.venue_types),
    JSON.stringify(next.settings),
    JSON.stringify(next.styles),
    next.contact_person,
    next.instagram,
    next.min_guests,
    next.max_seated,
    next.max_ceremony,
    next.max_standing,
    next.accommodation_capacity,
    JSON.stringify(next.facilities),
    JSON.stringify(next.catering),
    next.catering_partners,
    JSON.stringify(next.drinks),
    next.supplier_policy,
    JSON.stringify(next.external_allowed),
    next.rules_note,
    next.updated_at,
  );
  return getVenueProfile(listingId);
}

// ── Spaces ─────────────────────────────────────────────────────────────────

interface SpaceRow {
  id: number;
  name: string;
  uses: string;
  setting: string | null;
  capacity: number | null;
  fee: string | null;
  fee_amount: number | null;
  weather_backup: number;
  description: string | null;
  photo_ids: string;
  position: number;
}

function photoIdsFrom(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is number => Number.isInteger(v) && (v as number) > 0)
      : [];
  } catch {
    return [];
  }
}

export function listVenueSpaces(listingId: string): VenueSpace[] {
  const rows = db
    .prepare(
      "SELECT * FROM listing_venue_spaces WHERE listing_id = ? ORDER BY position ASC, id ASC",
    )
    .all(listingId) as SpaceRow[];
  if (rows.length === 0) return [];
  const photoUrl = new Map(
    (
      db.prepare("SELECT id, url FROM listing_photos WHERE listing_id = ?").all(listingId) as {
        id: number;
        url: string;
      }[]
    ).map((p) => [p.id, p.url]),
  );
  return rows.map((r) => {
    // A photo deleted from the gallery drops out of the space on read, so
    // the stored ids never have to be cleaned up behind the vendor's back.
    const ids = photoIdsFrom(r.photo_ids).filter((id) => photoUrl.has(id));
    return {
      id: r.id,
      name: r.name,
      uses: keysFrom(r.uses, VENUE_SPACE_USES),
      setting: oneOf<VenueSpaceSetting>(r.setting, VENUE_SPACE_SETTINGS),
      capacity: r.capacity,
      fee: oneOf<VenueSpaceFee>(r.fee, VENUE_SPACE_FEES),
      fee_amount: r.fee_amount,
      weather_backup: r.weather_backup === 1,
      description: r.description,
      photo_ids: ids,
      photo_urls: ids.map((id) => photoUrl.get(id) as string),
      position: r.position,
    };
  });
}

export function getVenueSpace(listingId: string, id: number): VenueSpace | null {
  return listVenueSpaces(listingId).find((s) => s.id === id) ?? null;
}

export function countVenueSpaces(listingId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM listing_venue_spaces WHERE listing_id = ?")
      .get(listingId) as { n: number }
  ).n;
}

type SpaceValues = Omit<VenueSpace, "id" | "photo_urls" | "position">;

export function addVenueSpace(listingId: string, v: SpaceValues): number {
  const ts = now();
  const pos =
    (
      db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) AS p FROM listing_venue_spaces WHERE listing_id = ?",
        )
        .get(listingId) as { p: number }
    ).p + 1;
  const res = db
    .prepare(
      `INSERT INTO listing_venue_spaces
         (listing_id, name, uses, setting, capacity, fee, fee_amount, weather_backup,
          description, photo_ids, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      listingId,
      v.name,
      JSON.stringify(v.uses),
      v.setting,
      v.capacity,
      v.fee,
      v.fee_amount,
      v.weather_backup ? 1 : 0,
      v.description,
      JSON.stringify(v.photo_ids),
      pos,
      ts,
      ts,
    );
  return Number(res.lastInsertRowid);
}

export function updateVenueSpace(listingId: string, id: number, v: SpaceValues): void {
  db.prepare(
    `UPDATE listing_venue_spaces
        SET name = ?, uses = ?, setting = ?, capacity = ?, fee = ?, fee_amount = ?,
            weather_backup = ?, description = ?, photo_ids = ?, updated_at = ?
      WHERE listing_id = ? AND id = ?`,
  ).run(
    v.name,
    JSON.stringify(v.uses),
    v.setting,
    v.capacity,
    v.fee,
    v.fee_amount,
    v.weather_backup ? 1 : 0,
    v.description,
    JSON.stringify(v.photo_ids),
    now(),
    listingId,
    id,
  );
}

export function deleteVenueSpace(listingId: string, id: number): boolean {
  return (
    db
      .prepare("DELETE FROM listing_venue_spaces WHERE listing_id = ? AND id = ?")
      .run(listingId, id).changes === 1
  );
}

// ── Pricing rules ──────────────────────────────────────────────────────────

interface RuleRow {
  id: number;
  name: string;
  start_month: number;
  end_month: number;
  days: string;
  min_guests: number | null;
  max_guests: number | null;
  min_spend: number | null;
  available: number;
  items: string;
  position: number;
  updated_at: number;
}

function itemsFrom(raw: string): VenuePriceItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: VenuePriceItem[] = [];
  for (const v of parsed) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (!(VENUE_PRICE_ITEM_KEYS as readonly unknown[]).includes(o.key)) continue;
    if (!(VENUE_PRICE_MODES as readonly unknown[]).includes(o.mode)) continue;
    out.push({
      key: o.key as VenuePriceItem["key"],
      label: typeof o.label === "string" ? o.label : null,
      mode: o.mode as VenuePriceItem["mode"],
      amount: typeof o.amount === "number" ? o.amount : null,
      quantity: typeof o.quantity === "number" ? o.quantity : null,
      optional: o.optional === true,
    });
  }
  return out;
}

function toRule(r: RuleRow): VenuePricingRule {
  return {
    id: r.id,
    name: r.name,
    start_month: r.start_month,
    end_month: r.end_month,
    days: keysFrom(r.days, VENUE_DAY_KINDS),
    min_guests: r.min_guests,
    max_guests: r.max_guests,
    min_spend: r.min_spend,
    available: r.available === 1,
    items: itemsFrom(r.items),
    position: r.position,
    updated_at: r.updated_at,
  };
}

export function listVenuePricingRules(listingId: string): VenuePricingRule[] {
  return (
    db
      .prepare(
        "SELECT * FROM listing_venue_pricing_rules WHERE listing_id = ? ORDER BY position ASC, id ASC",
      )
      .all(listingId) as RuleRow[]
  ).map(toRule);
}

export function getVenuePricingRule(listingId: string, id: number): VenuePricingRule | null {
  const row = db
    .prepare("SELECT * FROM listing_venue_pricing_rules WHERE listing_id = ? AND id = ?")
    .get(listingId, id) as RuleRow | null;
  return row ? toRule(row) : null;
}

export function countVenuePricingRules(listingId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM listing_venue_pricing_rules WHERE listing_id = ?")
      .get(listingId) as { n: number }
  ).n;
}

type RuleValues = Omit<VenuePricingRule, "id" | "position" | "updated_at">;

export function addVenuePricingRule(listingId: string, v: RuleValues): number {
  const ts = now();
  const pos =
    (
      db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) AS p FROM listing_venue_pricing_rules WHERE listing_id = ?",
        )
        .get(listingId) as { p: number }
    ).p + 1;
  const res = db
    .prepare(
      `INSERT INTO listing_venue_pricing_rules
         (listing_id, name, start_month, end_month, days, min_guests, max_guests,
          min_spend, available, items, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      listingId,
      v.name,
      v.start_month,
      v.end_month,
      JSON.stringify(v.days),
      v.min_guests,
      v.max_guests,
      v.min_spend,
      v.available ? 1 : 0,
      JSON.stringify(v.items),
      pos,
      ts,
      ts,
    );
  return Number(res.lastInsertRowid);
}

export function updateVenuePricingRule(listingId: string, id: number, v: RuleValues): void {
  db.prepare(
    `UPDATE listing_venue_pricing_rules
        SET name = ?, start_month = ?, end_month = ?, days = ?, min_guests = ?,
            max_guests = ?, min_spend = ?, available = ?, items = ?, updated_at = ?
      WHERE listing_id = ? AND id = ?`,
  ).run(
    v.name,
    v.start_month,
    v.end_month,
    JSON.stringify(v.days),
    v.min_guests,
    v.max_guests,
    v.min_spend,
    v.available ? 1 : 0,
    JSON.stringify(v.items),
    now(),
    listingId,
    id,
  );
}

export function deleteVenuePricingRule(listingId: string, id: number): boolean {
  return (
    db
      .prepare("DELETE FROM listing_venue_pricing_rules WHERE listing_id = ? AND id = ?")
      .run(listingId, id).changes === 1
  );
}

// ── Assembly ───────────────────────────────────────────────────────────────

export function getVenueDetail(
  listingId: string,
  currency: Currency,
  country: string | null,
): VenueDetail {
  return {
    profile: getVenueProfile(listingId),
    spaces: listVenueSpaces(listingId),
    pricing_rules: listVenuePricingRules(listingId),
    currency,
    country,
  };
}

/** Couple-facing: null when the vendor has said nothing yet, so the page
 *  renders no empty venue sections. */
export function getPublishedVenueDetail(
  listingId: string,
  currency: Currency,
  country: string | null,
): VenueDetail | null {
  const detail = getVenueDetail(listingId, currency, country);
  const empty =
    !venueProfileHasContent(detail.profile) &&
    detail.spaces.length === 0 &&
    detail.pricing_rules.length === 0;
  return empty ? null : detail;
}
