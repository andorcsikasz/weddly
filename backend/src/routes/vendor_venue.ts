// Vendor venue editor (shared/venue.ts): profile, spaces and seasonal pricing
// rules on the caller's own listing.
//
//   GET    /api/vendor/listing/me/venue
//   PATCH  /api/vendor/listing/me/venue/profile          partial: absent = unchanged
//   POST   /api/vendor/listing/me/venue/spaces
//   PUT    /api/vendor/listing/me/venue/spaces/:id        whole space
//   DELETE /api/vendor/listing/me/venue/spaces/:id
//   POST   /api/vendor/listing/me/venue/pricing-rules
//   PUT    /api/vendor/listing/me/venue/pricing-rules/:id whole rule
//   POST   /api/vendor/listing/me/venue/pricing-rules/:id/duplicate
//   DELETE /api/vendor/listing/me/venue/pricing-rules/:id
//
// Every response is the whole `VenueDetail`, so the editor never holds a stale
// half. The listing is taken from the session (`resolveVendorListing`), never
// from a path id. Only a `venue` listing may write: a photographer with a
// "seasonal pricing rule" would publish a shape no couple page renders.
//
// Spaces and rules are PUT whole rather than patched because each is edited as
// one card with one Save; a rule's items only make sense together, and a
// partial item list would have no reading.

import {
  CATERING_RULES,
  cateringConflict,
  DRINKS_RULES,
  EXTERNAL_SUPPLIER_KINDS,
  MAX_SPACE_PHOTOS,
  MAX_VENUE_PRICE_ITEMS,
  MAX_VENUE_PRICING_RULES,
  MAX_VENUE_SPACES,
  PRICED_MODES,
  QUANTITY_MODES,
  SUPPLIER_POLICIES,
  VENUE_DAY_KINDS,
  VENUE_FACILITIES,
  VENUE_GUESTS_MAX,
  VENUE_PRICE_ITEM_KEYS,
  VENUE_PRICE_MODES,
  VENUE_QUANTITY_MAX,
  VENUE_SETTINGS,
  VENUE_SHORT_TEXT_MAX,
  VENUE_SPACE_FEES,
  VENUE_SPACE_SETTINGS,
  VENUE_SPACE_USES,
  VENUE_STYLE_TAGS,
  VENUE_TEXT_MAX,
  VENUE_TYPES,
  type VenueDetail,
  type VenuePriceItem,
  type VenuePricingRule,
  type VenueProfilePatch,
  type VenueSpace,
} from "@shared/venue";
import { PACKAGE_AMOUNT_MAX } from "@shared/listing_pricing";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { addAuditLog } from "../lib/audit";
import { listListingPhotos } from "../domain/listings";
import {
  addVenuePricingRule,
  addVenueSpace,
  countVenuePricingRules,
  countVenueSpaces,
  deleteVenuePricingRule,
  deleteVenueSpace,
  getVenueDetail,
  getVenuePricingRule,
  getVenueProfile,
  getVenueSpace,
  saveVenueProfile,
  updateVenuePricingRule,
  updateVenueSpace,
} from "../domain/venue_profile";
import { resolveVendorListing } from "./vendor_listing";

type Owner = ReturnType<typeof resolveVendorListing>;

function resolveVenueOwner(ctx: Ctx): Owner {
  const view = resolveVendorListing(ctx);
  if (view.listing.category !== "venue") {
    throw new HttpError(409, "Venue details are for venue listings", { code: "not_a_venue" });
  }
  return view;
}

function detailFor(owner: Owner): VenueDetail {
  return getVenueDetail(owner.listing.id, owner.currency, owner.account.country);
}

function audit(owner: Owner, action: string, after: Record<string, unknown>): void {
  addAuditLog({
    actor_user_id: owner.account.owner_user_id,
    couple_id: null,
    action,
    target_kind: "listing",
    target_id: null,
    before: { listing_id: owner.listing.id },
    after,
  });
}

// ── Field guards ───────────────────────────────────────────────────────────

function bad(field: string, message: string, code = "bad_field"): never {
  throw new HttpError(400, `\`${field}\` ${message}`, { code, field });
}

function keyList<T extends string>(v: unknown, field: string, allowed: readonly T[]): T[] {
  if (!Array.isArray(v)) bad(field, "must be an array");
  const out: T[] = [];
  for (const k of v) {
    if (typeof k !== "string" || !(allowed as readonly string[]).includes(k)) {
      bad(field, `has an unknown value: ${String(k)}`);
    }
    if (!out.includes(k as T)) out.push(k as T);
  }
  return out;
}

function optText(v: unknown, field: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") bad(field, "must be a string or null");
  const t = v.trim();
  if (t.length > max) bad(field, `is too long (max ${max})`);
  return t.length === 0 ? null : t;
}

function reqText(v: unknown, field: string, max: number): string {
  const t = optText(v, field, max);
  if (t === null) bad(field, "cannot be empty");
  return t;
}

function optInt(v: unknown, field: string, max: number, min = 0): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    bad(field, `must be a whole number between ${min} and ${max}, or null`);
  }
  return n;
}

function optGuests(v: unknown, field: string): number | null {
  return optInt(v, field, VENUE_GUESTS_MAX, 1);
}

function optAmount(v: unknown, field: string): number | null {
  return optInt(v, field, PACKAGE_AMOUNT_MAX);
}

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    bad(field, `must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}

function optOneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T | null {
  if (v === null || v === undefined || v === "") return null;
  return oneOf(v, field, allowed);
}

/** "@villa.rosa", "villa.rosa" and the profile URL all mean one handle. */
function instagramHandle(v: unknown): string | null {
  const t = optText(v, "instagram", VENUE_SHORT_TEXT_MAX);
  if (t === null) return null;
  const fromUrl = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(t)?.[1];
  const handle = (fromUrl ?? t).replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) bad("instagram", "is not an Instagram handle");
  return handle;
}

// ── Profile ────────────────────────────────────────────────────────────────

async function handleGet(ctx: Ctx): Promise<Response> {
  return json(detailFor(resolveVenueOwner(ctx)));
}

async function handlePatchProfile(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const patch: VenueProfilePatch = {};
  const has = (k: string) => Object.hasOwn(body, k) && body[k] !== undefined;
  if (has("venue_types")) patch.venue_types = keyList(body.venue_types, "venue_types", VENUE_TYPES);
  if (has("settings")) patch.settings = keyList(body.settings, "settings", VENUE_SETTINGS);
  if (has("styles")) patch.styles = keyList(body.styles, "styles", VENUE_STYLE_TAGS);
  if (has("facilities")) {
    patch.facilities = keyList(body.facilities, "facilities", VENUE_FACILITIES);
  }
  if (has("catering")) patch.catering = keyList(body.catering, "catering", CATERING_RULES);
  if (has("drinks")) patch.drinks = keyList(body.drinks, "drinks", DRINKS_RULES);
  if (has("external_allowed")) {
    patch.external_allowed = keyList(
      body.external_allowed,
      "external_allowed",
      EXTERNAL_SUPPLIER_KINDS,
    );
  }
  if (has("supplier_policy")) {
    patch.supplier_policy = optOneOf(body.supplier_policy, "supplier_policy", SUPPLIER_POLICIES);
  }
  if (has("contact_person")) {
    patch.contact_person = optText(body.contact_person, "contact_person", VENUE_SHORT_TEXT_MAX);
  }
  if (has("instagram")) patch.instagram = instagramHandle(body.instagram);
  if (has("catering_partners")) {
    patch.catering_partners = optText(body.catering_partners, "catering_partners", VENUE_TEXT_MAX);
  }
  if (has("rules_note")) patch.rules_note = optText(body.rules_note, "rules_note", VENUE_TEXT_MAX);
  for (const k of ["min_guests", "max_seated", "max_ceremony", "max_standing"] as const) {
    if (has(k)) patch[k] = optGuests(body[k], k);
  }
  if (has("accommodation_capacity")) {
    patch.accommodation_capacity = optGuests(body.accommodation_capacity, "accommodation_capacity");
  }

  // Coherence is judged on the profile as it will BE, since the patch is
  // partial: clearing one side must be checked against the stored other side.
  const next = { ...getVenueProfile(owner.listing.id), ...patch };
  if (cateringConflict(next.catering)) {
    throw new HttpError(400, "In-house catering required excludes outside catering", {
      code: "catering_conflict",
    });
  }
  const maxes = [next.max_seated, next.max_ceremony, next.max_standing].filter(
    (n): n is number => n !== null,
  );
  if (next.min_guests !== null && maxes.length > 0 && next.min_guests > Math.max(...maxes)) {
    throw new HttpError(400, "Minimum guests exceeds every capacity", {
      code: "bad_guest_range",
    });
  }

  saveVenueProfile(owner.listing.id, patch);
  audit(owner, "vendor.venue_profile_update", { keys: Object.keys(patch) });
  return json(detailFor(owner));
}

// ── Spaces ─────────────────────────────────────────────────────────────────

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id must be a positive integer");
  return id;
}

function parseSpace(
  body: Record<string, unknown>,
  listingId: string,
): Omit<VenueSpace, "id" | "photo_urls" | "position"> {
  const fee = optOneOf(body.fee, "fee", VENUE_SPACE_FEES);
  const feeAmount = optAmount(body.fee_amount, "fee_amount");
  if (feeAmount !== null && fee !== "extra") {
    throw new HttpError(400, "A fee amount needs `fee: extra`", { code: "fee_amount_without_fee" });
  }
  const photoIds = body.photo_ids === undefined ? [] : body.photo_ids;
  if (!Array.isArray(photoIds) || photoIds.length > MAX_SPACE_PHOTOS) {
    bad("photo_ids", `must be an array of at most ${MAX_SPACE_PHOTOS} ids`);
  }
  const own = new Set(listListingPhotos(listingId).map((p) => p.id));
  const ids: number[] = [];
  for (const id of photoIds) {
    // Only the listing's own gallery: a space must not borrow a photo from
    // another vendor's listing by guessing its id.
    if (typeof id !== "number" || !own.has(id)) bad("photo_ids", "must be photos of this listing");
    if (!ids.includes(id)) ids.push(id);
  }
  return {
    name: reqText(body.name, "name", VENUE_SHORT_TEXT_MAX),
    uses: body.uses === undefined ? [] : keyList(body.uses, "uses", VENUE_SPACE_USES),
    setting: optOneOf(body.setting, "setting", VENUE_SPACE_SETTINGS),
    capacity: optGuests(body.capacity, "capacity"),
    fee,
    fee_amount: feeAmount,
    weather_backup: body.weather_backup === true,
    description: optText(body.description, "description", VENUE_TEXT_MAX),
    photo_ids: ids,
  };
}

async function handleAddSpace(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  if (countVenueSpaces(owner.listing.id) >= MAX_VENUE_SPACES) {
    throw new HttpError(409, `Spaces are full (max ${MAX_VENUE_SPACES})`, { code: "spaces_full" });
  }
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const values = parseSpace(body, owner.listing.id);
  const id = addVenueSpace(owner.listing.id, values);
  audit(owner, "vendor.venue_space_add", { space_id: id, name: values.name });
  return json(detailFor(owner), { status: 201 });
}

async function handlePutSpace(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const id = parseId(ctx);
  if (!getVenueSpace(owner.listing.id, id)) {
    throw new HttpError(404, "Space not found", { code: "space_not_found" });
  }
  const body = await readJson<Record<string, unknown>>(ctx.req);
  updateVenueSpace(owner.listing.id, id, parseSpace(body, owner.listing.id));
  audit(owner, "vendor.venue_space_update", { space_id: id });
  return json(detailFor(owner));
}

async function handleDeleteSpace(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const id = parseId(ctx);
  if (!deleteVenueSpace(owner.listing.id, id)) {
    throw new HttpError(404, "Space not found", { code: "space_not_found" });
  }
  audit(owner, "vendor.venue_space_delete", { space_id: id });
  return json(detailFor(owner));
}

// ── Pricing rules ──────────────────────────────────────────────────────────

function parseItem(v: unknown, i: number): VenuePriceItem {
  const field = `items[${i}]`;
  if (!v || typeof v !== "object") bad(field, "must be an object");
  const o = v as Record<string, unknown>;
  const key = oneOf(o.key, `${field}.key`, VENUE_PRICE_ITEM_KEYS);
  const mode = oneOf(o.mode, `${field}.mode`, VENUE_PRICE_MODES);
  const label = optText(o.label, `${field}.label`, VENUE_SHORT_TEXT_MAX);
  if (key === "custom" && label === null) {
    throw new HttpError(400, "A custom item needs a label", { code: "item_label_missing", field });
  }
  const priced = PRICED_MODES.includes(mode);
  const amount = optAmount(o.amount, `${field}.amount`);
  // An amount on "included" would publish two answers for one line, and a
  // "fixed" line with no number is a price nobody can read.
  if (priced && amount === null) {
    throw new HttpError(400, "This price needs an amount", { code: "item_amount_missing", field });
  }
  if (!priced && amount !== null) {
    throw new HttpError(400, "This mode takes no amount", {
      code: "item_amount_unexpected",
      field,
    });
  }
  const quantity = QUANTITY_MODES.includes(mode)
    ? optInt(o.quantity, `${field}.quantity`, VENUE_QUANTITY_MAX, 1)
    : null;
  return { key, label, mode, amount, quantity, optional: o.optional === true };
}

function parseRule(
  body: Record<string, unknown>,
): Omit<VenuePricingRule, "id" | "position" | "updated_at"> {
  const startMonth = optInt(body.start_month, "start_month", 12, 1);
  const endMonth = optInt(body.end_month, "end_month", 12, 1);
  if (startMonth === null || endMonth === null) {
    throw new HttpError(400, "start_month and end_month are required", { code: "bad_months" });
  }
  const days = keyList(body.days ?? [], "days", VENUE_DAY_KINDS);
  if (days.length === 0) {
    throw new HttpError(400, "Pick at least one day", { code: "days_missing" });
  }
  const minGuests = optGuests(body.min_guests, "min_guests");
  const maxGuests = optGuests(body.max_guests, "max_guests");
  if (minGuests !== null && maxGuests !== null && minGuests > maxGuests) {
    throw new HttpError(400, "min_guests cannot exceed max_guests", { code: "bad_guest_range" });
  }
  const rawItems = body.items ?? [];
  if (!Array.isArray(rawItems) || rawItems.length > MAX_VENUE_PRICE_ITEMS) {
    bad("items", `must be an array of at most ${MAX_VENUE_PRICE_ITEMS} items`);
  }
  const available = body.available !== false;
  return {
    name: reqText(body.name, "name", VENUE_SHORT_TEXT_MAX),
    start_month: startMonth,
    end_month: endMonth,
    days,
    min_guests: minGuests,
    max_guests: maxGuests,
    min_spend: optAmount(body.min_spend, "min_spend"),
    available,
    // An unavailable condition prices nothing; keeping stale items on it
    // would let them resurface the day the vendor flips it back on unseen.
    items: available ? rawItems.map(parseItem) : [],
  };
}

async function handleAddRule(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  if (countVenuePricingRules(owner.listing.id) >= MAX_VENUE_PRICING_RULES) {
    throw new HttpError(409, `Pricing rules are full (max ${MAX_VENUE_PRICING_RULES})`, {
      code: "rules_full",
    });
  }
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const values = parseRule(body);
  const id = addVenuePricingRule(owner.listing.id, values);
  audit(owner, "vendor.venue_rule_add", { rule_id: id, name: values.name });
  return json(detailFor(owner), { status: 201 });
}

async function handlePutRule(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const id = parseId(ctx);
  if (!getVenuePricingRule(owner.listing.id, id)) {
    throw new HttpError(404, "Pricing rule not found", { code: "rule_not_found" });
  }
  const body = await readJson<Record<string, unknown>>(ctx.req);
  updateVenuePricingRule(owner.listing.id, id, parseRule(body));
  audit(owner, "vendor.venue_rule_update", { rule_id: id });
  return json(detailFor(owner));
}

/** A winter offer is usually the peak-season rule with other numbers, so
 *  copying one is the fast path to the second rule. */
async function handleDuplicateRule(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const id = parseId(ctx);
  const rule = getVenuePricingRule(owner.listing.id, id);
  if (!rule) throw new HttpError(404, "Pricing rule not found", { code: "rule_not_found" });
  if (countVenuePricingRules(owner.listing.id) >= MAX_VENUE_PRICING_RULES) {
    throw new HttpError(409, `Pricing rules are full (max ${MAX_VENUE_PRICING_RULES})`, {
      code: "rules_full",
    });
  }
  const suffix = " (2)";
  const name =
    rule.name.length + suffix.length > VENUE_SHORT_TEXT_MAX
      ? rule.name.slice(0, VENUE_SHORT_TEXT_MAX - suffix.length) + suffix
      : rule.name + suffix;
  const { id: _id, position: _p, updated_at: _u, ...values } = rule;
  const newId = addVenuePricingRule(owner.listing.id, { ...values, name });
  audit(owner, "vendor.venue_rule_add", { rule_id: newId, copied_from: id });
  return json(detailFor(owner), { status: 201 });
}

async function handleDeleteRule(ctx: Ctx): Promise<Response> {
  const owner = resolveVenueOwner(ctx);
  const id = parseId(ctx);
  if (!deleteVenuePricingRule(owner.listing.id, id)) {
    throw new HttpError(404, "Pricing rule not found", { code: "rule_not_found" });
  }
  audit(owner, "vendor.venue_rule_delete", { rule_id: id });
  return json(detailFor(owner));
}

export function registerVendorVenueRoutes(router: Router) {
  router.get("/api/vendor/listing/me/venue", handleGet);
  router.patch("/api/vendor/listing/me/venue/profile", handlePatchProfile);
  router.post("/api/vendor/listing/me/venue/spaces", handleAddSpace);
  router.put("/api/vendor/listing/me/venue/spaces/:id", handlePutSpace);
  router.delete("/api/vendor/listing/me/venue/spaces/:id", handleDeleteSpace);
  router.post("/api/vendor/listing/me/venue/pricing-rules", handleAddRule);
  router.put("/api/vendor/listing/me/venue/pricing-rules/:id", handlePutRule);
  router.post("/api/vendor/listing/me/venue/pricing-rules/:id/duplicate", handleDuplicateRule);
  router.delete("/api/vendor/listing/me/venue/pricing-rules/:id", handleDeleteRule);
}
