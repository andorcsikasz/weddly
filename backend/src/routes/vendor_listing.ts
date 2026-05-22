// Vendor self-serve listing editor (P2.D). A vendor who just completed the
// claim flow (P2.C) lands here; this is the single screen they have today
// for editing their public listing.
//
//   GET /api/vendor/listing/me     — read the caller's claimed listing + account
//   PATCH /api/vendor/listing/me   — update marketing copy, contact, pricing
//
// Authorisation: requireAuth + role === 'vendor' + the user must own a
// vendor_account that's currently attached to a listing. Anything else is
// 403 (a couple-role user, a vendor whose listing got admin-hidden, etc.).
// Name / category / status / lat-lng are deliberately NOT editable — those
// flow through admin moderation (name) or the geocode worker (lat-lng).

import type { VendorListingEditInput, VendorListingView } from "@shared/listings";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import {
  getListingByVendorAccountId,
  patchListing,
  toVendorAccount,
  type ListingPatch,
} from "../domain/listings";
import { getVendorAccountByOwnerUserId } from "../domain/vendor_accounts";
import { getUserById } from "../domain/users";
import { addAuditLog } from "../lib/audit";

/** Resolve `requireAuth(ctx)` to the vendor's listing + account, or throw the
 *  right HTTP error. Centralised so GET + PATCH share the same gate. */
function resolveVendorListing(ctx: Ctx): VendorListingView {
  const userId = requireAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(401, "User not found");
  if (user.role !== "vendor") {
    throw new HttpError(403, "Vendor role required", { code: "vendor_role_required" });
  }
  const accountRow = getVendorAccountByOwnerUserId(userId);
  if (!accountRow) {
    throw new HttpError(404, "No vendor account for this user", { code: "vendor_account_missing" });
  }
  const listing = getListingByVendorAccountId(accountRow.id);
  if (!listing) {
    throw new HttpError(404, "No listing attached to this vendor account", {
      code: "listing_missing",
    });
  }
  return { listing, account: toVendorAccount(accountRow) };
}

async function handleGetMe(ctx: Ctx): Promise<Response> {
  return json(resolveVendorListing(ctx));
}

// ── PATCH input parsing ────────────────────────────────────────────────────

const MAX_CITY_LEN = 80;
const MAX_ADDRESS_LEN = 240;
const MAX_WEBSITE_LEN = 240;
const MAX_PHONE_LEN = 40;
const MAX_EMAIL_LEN = 120;
const MAX_BLURB_LEN = 2000;
const MAX_CAPACITY = 5000;

/** Validate + coerce one editable field. Empty strings normalise to `null`
 *  so a vendor "clearing" a field via the UI is equivalent to omitting it
 *  in JSON — and the DB column gets NULL rather than `""`. */
function parseStringField(raw: unknown, field: string, maxLen: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string or null`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `${field} is too long (${trimmed.length} > ${maxLen})`);
  }
  return trimmed;
}

function parsePriceBand(raw: unknown): 1 | 2 | 3 | 4 | 5 | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 5) {
    throw new HttpError(400, "price_band must be an integer 1..5 or null");
  }
  return raw as 1 | 2 | 3 | 4 | 5;
}

function parseCapacity(raw: unknown, field: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_CAPACITY) {
    throw new HttpError(400, `${field} must be a non-negative integer ≤ ${MAX_CAPACITY} or null`);
  }
  return raw;
}

function buildPatch(body: VendorListingEditInput): ListingPatch {
  const patch: ListingPatch = {};
  // City is one of the few NOT-NULL columns on listings — empty / null
  // rejected at this boundary so a vendor can't blank it out.
  if (body.city !== undefined) {
    if (typeof body.city !== "string") throw new HttpError(400, "city must be a string");
    const trimmed = body.city.trim();
    if (trimmed.length === 0) throw new HttpError(400, "city cannot be empty");
    if (trimmed.length > MAX_CITY_LEN) {
      throw new HttpError(400, `city is too long (${trimmed.length} > ${MAX_CITY_LEN})`);
    }
    patch.city = trimmed;
  }
  const address = parseStringField(body.address, "address", MAX_ADDRESS_LEN);
  if (address !== undefined) patch.address = address;
  const website = parseStringField(body.website, "website", MAX_WEBSITE_LEN);
  if (website !== undefined) patch.website = website;
  const contactEmail = parseStringField(body.contact_email, "contact_email", MAX_EMAIL_LEN);
  if (contactEmail !== undefined) patch.contact_email = contactEmail;
  const contactPhone = parseStringField(body.contact_phone, "contact_phone", MAX_PHONE_LEN);
  if (contactPhone !== undefined) patch.contact_phone = contactPhone;
  const blurbHu = parseStringField(body.blurb_hu, "blurb_hu", MAX_BLURB_LEN);
  if (blurbHu !== undefined) patch.blurb_hu = blurbHu;
  const blurbEn = parseStringField(body.blurb_en, "blurb_en", MAX_BLURB_LEN);
  if (blurbEn !== undefined) patch.blurb_en = blurbEn;
  const priceBand = parsePriceBand(body.price_band);
  if (priceBand !== undefined) patch.price_band = priceBand;
  const capMin = parseCapacity(body.capacity_min, "capacity_min");
  if (capMin !== undefined) patch.capacity_min = capMin;
  const capMax = parseCapacity(body.capacity_max, "capacity_max");
  if (capMax !== undefined) patch.capacity_max = capMax;
  // Cross-field: when both sides are set in the patch, min ≤ max. We only
  // check what the request supplied (not what's already in the DB) so a
  // partial update can't accidentally fail because of an existing skew.
  if (
    patch.capacity_min != null &&
    patch.capacity_max != null &&
    patch.capacity_min > patch.capacity_max
  ) {
    throw new HttpError(400, "capacity_min must be ≤ capacity_max");
  }
  return patch;
}

async function handlePatchMe(ctx: Ctx): Promise<Response> {
  const { listing: currentListing, account } = resolveVendorListing(ctx);
  const body = await readJson<VendorListingEditInput>(ctx.req);
  const patch = buildPatch(body);
  const updated = patchListing(currentListing.id, patch);
  if (!updated) {
    // patchListing only returns null when the row vanished between resolve
    // and update — racy in theory, never observed in practice. Surface as
    // 404 so the client retries on a fresh load.
    throw new HttpError(404, "Listing vanished mid-update");
  }
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_update",
    target_kind: "listing",
    target_id: null, // listing.id is a string; audit_log.target_id is numeric, so we leave it null and stash the id in `before`
    before: { listing_id: currentListing.id },
    after: { fields: Object.keys(patch) },
  });
  const view: VendorListingView = { listing: updated, account };
  return json(view);
}

export function registerVendorListingRoutes(router: Router) {
  router.get("/api/vendor/listing/me", handleGetMe);
  router.patch("/api/vendor/listing/me", handlePatchMe);
}
