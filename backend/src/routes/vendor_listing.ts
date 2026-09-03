// Vendor self-serve listing editor (P2.D). A vendor who just completed the
// claim flow (P2.C) lands here; this is the single screen they have today
// for editing their public listing.
//
//   GET /api/vendor/listing/me     — read the caller's claimed listing + account
//   PATCH /api/vendor/listing/me   — update marketing copy, contact, pricing
//   POST /api/vendor/listing/me/visibility, self-serve pause/unpause
//                                    (status 'active' <-> 'hidden' only)
//
// Authorisation: requireAuth + role === 'vendor' + the user must own a
// vendor_account that's currently attached to a listing. Anything else is
// 403 (a couple-role user, a vendor whose listing got admin-hidden, etc.).
// Name / category / lat-lng are deliberately NOT editable; those flow
// through admin moderation (name) or the geocode worker (lat-lng). Status is
// NOT part of the PATCH either: the only self-serve transition is the
// dedicated visibility toggle, which refuses to touch moderation states.

import {
  type Listing,
  listingNameLockedUntil,
  MAX_LISTING_PHOTOS,
  priceBandLockedUntil,
  type VendorAccount,
  type VendorListingEditInput,
  type VendorListingView,
} from "@shared/listings";
import { isCurrency } from "@shared/currency";
import { isKnownLanguage } from "@shared/suppliers";
import {
  MAX_LISTING_PACKAGES,
  PACKAGE_DESCRIPTION_MAX,
  PACKAGE_NAME_MAX,
  PACKAGE_PDF_MAX_BYTES,
  PACKAGE_PRICE_MAX,
} from "@shared/listing_packages";
import type { PackagePriceMode } from "@shared/listing_pricing";
import { PACKAGE_AMOUNT_MAX, isPackagePriceMode, listingCurrency } from "@shared/listing_pricing";
import { MAX_LISTING_VIDEOS, parseVideoUrl } from "@shared/listing_videos";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { requireHttpUrl } from "../lib/url";
import { sniffUploadedImage } from "../lib/image_sniff";
import { keyFromUploadUrl, storage } from "../lib/storage";
import {
  getCommunitySupplierById,
  setStatus as setCommunityStatus,
} from "../domain/community_suppliers";
import { clearCuratedOverride, setCuratedOverride } from "../domain/curated_overrides";
import {
  addListingPackage,
  addListingPhoto,
  addListingVideo,
  clearListingPackagePdf,
  countListingPackages,
  countListingPhotos,
  countListingVideos,
  deleteListingPackage,
  deleteListingPhoto,
  deleteListingVideo,
  getListingById,
  getListingByVendorAccountId,
  getListingPackage,
  getListingPhoto,
  getListingVideo,
  listListingPackages,
  listListingPhotos,
  listListingVideos,
  patchListing,
  reorderListingVideos,
  setListingPackagePdf,
  setListingPhotoPositionY,
  toVendorAccount,
  updateListingPackage,
  updateListingVideo,
  type ListingPatch,
} from "../domain/listings";
import { getVendorAccountByOwnerUserId } from "../domain/vendor_accounts";
import {
  canPublishQuarantinedListing,
  getQuarantinePreview,
  isUnderQuarantineReview,
  publishQuarantinedListing,
} from "../domain/listing_quarantine";
import { getVendorSub, toVendorBilling } from "../domain/vendor_billing";
import { emitVendorEvent } from "../domain/vendor_points";
import { getUserById } from "../domain/users";
import { addAuditLog } from "../lib/audit";

/** Resolve `requireAuth(ctx)` to the vendor's listing + account, or throw the
 *  right HTTP error. Centralised so GET + PATCH share the same gate. Exported
 *  so sibling vendor routes (e.g. availability) reuse the exact same gate. */
export function resolveVendorListing(ctx: Ctx): VendorListingView {
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
  const account = toVendorAccount(accountRow);
  return {
    listing,
    account,
    currency: listingCurrency({ country: account.country, currency: listing.currency_override }),
  };
}

/** Assemble the editor payload for `listing` with both media reels attached.
 *  Every GET + mutating handler returns this so the client's `photos`/`videos`
 *  arrays never go stale after an unrelated action (e.g. adding a video must
 *  not blank out the gallery, and vice-versa). `billing` is only threaded in
 *  where the caller already resolved a subscription snapshot. */
function listingViewWithMedia(
  listing: Listing,
  account: VendorAccount,
  extra?: { billing?: VendorListingView["billing"] },
): VendorListingView {
  return {
    listing,
    account,
    // Resolved HERE because this is the first place that holds both halves:
    // the vendor's explicit pick lives on the listing, the country it falls
    // back to lives on the account.
    currency: listingCurrency({
      country: account.country,
      currency: listing.currency_override,
    }),
    ...(extra?.billing !== undefined ? { billing: extra.billing } : {}),
    photos: listListingPhotos(listing.id),
    videos: listListingVideos(listing.id),
    packages: listListingPackages(listing.id),
  };
}

async function handleGetMe(ctx: Ctx): Promise<Response> {
  const view = resolveVendorListing(ctx);
  const sub = getVendorSub(view.account.id);
  return json(
    listingViewWithMedia(view.listing, view.account, {
      billing: sub ? toVendorBilling(sub) : null,
    }),
  );
}

// ── PATCH input parsing ────────────────────────────────────────────────────

// Matches vendor_accounts.display_name so a brand can't be longer on one
// surface than the other.
const MAX_NAME_LEN = 120;
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

/** Spoken languages a verbal vendor works in: an array of ISO 639-1 codes from
 *  the controlled list. Unknown codes are rejected here; the domain layer dedups
 *  and orders. */
function parseSpokenLanguagesInput(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "spoken_languages must be an array of language codes");
  }
  const codes: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") throw new HttpError(400, "spoken_languages must be code strings");
    const code = c.trim().toLowerCase();
    if (!isKnownLanguage(code)) throw new HttpError(400, `unknown language code: ${c}`);
    codes.push(code);
  }
  return codes;
}

function buildPatch(body: VendorListingEditInput): ListingPatch {
  const patch: ListingPatch = {};
  // `name` is NOT NULL and a nameless card is unusable in the directory, so an
  // empty string is rejected rather than stored. The cooldown itself lives in
  // the handler — this only validates the shape.
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw new HttpError(400, "name must be a string");
    const trimmed = body.name.trim();
    if (trimmed.length === 0) throw new HttpError(400, "name cannot be empty");
    if (trimmed.length > MAX_NAME_LEN) {
      throw new HttpError(400, `name is too long (${trimmed.length} > ${MAX_NAME_LEN})`);
    }
    patch.name = trimmed;
  }
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
  // Scheme-guard: the public directory + admin panel anchor this straight into
  // an href, so a `javascript:` value would be stored XSS. Only http(s) is stored.
  if (website !== undefined)
    patch.website = website === null ? null : requireHttpUrl(website, "website");
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
  if (body.currency !== undefined) {
    if (body.currency !== null && !isCurrency(body.currency)) {
      throw new HttpError(400, "currency must be a supported currency code or null", {
        code: "bad_currency",
      });
    }
    patch.currency = body.currency;
  }
  const langs = parseSpokenLanguagesInput(body.spoken_languages);
  if (langs !== undefined) patch.spoken_languages = langs;
  if (body.hide_contact_public !== undefined) {
    if (typeof body.hide_contact_public !== "boolean") {
      throw new HttpError(400, "hide_contact_public must be a boolean");
    }
    patch.hide_contact_public = body.hide_contact_public;
  }
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
  // Rename cooldown (shared/listings.ts): the vendor owns their brand name, but
  // only one change a week. Re-sending the CURRENT name is a no-op that never
  // trips the gate, so a form that submits every field on save stays safe. The
  // first rename is always allowed — the name a listing was moderated under
  // doesn't start the clock, which keeps fixing a typo free.
  if (patch.name !== undefined && patch.name !== currentListing.name) {
    const lockedUntil = listingNameLockedUntil(currentListing.name_changed_at);
    if (lockedUntil !== null && now() < lockedUntil) {
      throw new HttpError(409, `name is locked until ${new Date(lockedUntil).toISOString()}`, {
        code: "name_locked",
        locked_until: lockedUntil,
      });
    }
    patch.name_changed_at = now();
  } else if (patch.name !== undefined) {
    // Unchanged value — drop it so `updated_at` isn't bumped by a no-op and the
    // audit entry doesn't claim a rename that never happened.
    patch.name = undefined;
  }

  // Anti-fraud pricing cooldown (shared/listings.ts): a change to a PUBLISHED
  // price band, including withdrawing it, is allowed once every 30 days. Only a
  // real change trips the gate; re-sending the current value is a no-op.
  //
  // The lock never applies while the listing has NO published band. Without that
  // exemption the cooldown had a dead end in it: a vendor who cleared their band
  // (one stray click on the picker, autosaved a second later) was locked out of
  // setting a price for 30 days while the reminder mail kept naming "ársáv" as a
  // missing section. Six live listings sat in exactly that state, and being told
  // to fill in a field the app refuses to let you touch is the worst thing an
  // anti-fraud rule can do. The rule itself is intact: an unpriced listing shows
  // couples no band at all, so there is no cheap ranking to flip away from, and
  // the withdrawal still stamps the anchor — a vendor going band → none → band
  // lands right back under the lock, having spent the gap invisible in the price
  // filters, which is the same one-change-per-30-days cadence the rule allows.
  const bandChanged =
    patch.price_band !== undefined && patch.price_band !== currentListing.price_band;
  if (bandChanged && currentListing.price_band !== null) {
    const lockedUntil = priceBandLockedUntil(currentListing.price_band_changed_at);
    if (lockedUntil !== null && now() < lockedUntil) {
      throw new HttpError(
        409,
        `price_band is locked until ${new Date(lockedUntil).toISOString().slice(0, 10)}`,
      );
    }
    patch.price_band_changed_at = now();
  }
  const updated = patchListing(currentListing.id, patch);
  if (!updated) {
    // patchListing only returns null when the row vanished between resolve
    // and update — racy in theory, never observed in practice. Surface as
    // 404 so the client retries on a fresh load.
    throw new HttpError(404, "Listing vanished mid-update");
  }
  // Weddly Points: the engine re-reads completeness from the saved listing, so
  // this only has to say "the profile moved", not what changed or what it earns.
  emitVendorEvent(account.id, "profile.updated");
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_update",
    target_kind: "listing",
    target_id: null, // listing.id is a string; audit_log.target_id is numeric, so we leave it null and stash the id in `before`
    // Price-band transitions are recorded verbatim (not just the field name)
    // so a band-flipping pattern is reconstructable from the audit log alone.
    before: {
      listing_id: currentListing.id,
      ...(patch.price_band !== undefined ? { price_band: currentListing.price_band } : {}),
      // Renames are recorded verbatim on both sides: a listing that launders a
      // reputation by rebranding has to be reconstructable from the log alone.
      ...(patch.name !== undefined ? { name: currentListing.name } : {}),
    },
    after: {
      fields: Object.keys(patch),
      ...(patch.price_band !== undefined ? { price_band: patch.price_band } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    },
  });
  return json(listingViewWithMedia(updated, account));
}

// ── Hero image upload ──────────────────────────────────────────────────────
//
// Vendor uploads ONE hero image per listing — the card on /app/suppliers and
// /vendors switches from the monogram avatar to the photo. File lives on
// the persistent `CONFIG.uploadsDir` volume; the public URL goes through the
// `/uploads/*` static handler in server.ts. Multipart upload because the
// existing JSON PATCH (handlePatchMe) doesn't transport binary, and an
// image-CDN swap can replace just this endpoint without touching the
// metadata pipeline.

const MAX_HERO_BYTES = 4 * 1024 * 1024;
const SUPPORTED_HERO_MIMES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Pull + validate the `file` field of a multipart image upload (hero and
 *  gallery share the exact same rules) and return it with its magic-bytes
 *  extension. Never trusts the client Content-Type. */
async function readUploadedImage(ctx: Ctx): Promise<{ raw: File; ext: "jpg" | "png" | "webp" }> {
  // Bun parses multipart natively via `Request.formData()`. The field name
  // is `file` to match the conventional <input type="file" name="file" />
  // used by the vendor home page's upload widget.
  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const raw = form.get("file");
  if (!(raw instanceof File)) {
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  }
  if (raw.size <= 0) {
    throw new HttpError(400, "Empty file", { code: "empty_file" });
  }
  if (raw.size > MAX_HERO_BYTES) {
    throw new HttpError(413, `File too large (max ${MAX_HERO_BYTES / 1024 / 1024} MB)`, {
      code: "file_too_large",
    });
  }
  if (SUPPORTED_HERO_MIMES[raw.type] === undefined) {
    throw new HttpError(415, `Unsupported image type: ${raw.type || "unknown"}`, {
      code: "unsupported_type",
    });
  }
  // Don't trust the client Content-Type — confirm the real magic bytes are a
  // supported image and derive the stored extension from them.
  const sniffed = await sniffUploadedImage(raw);
  const ext = sniffed ? SUPPORTED_HERO_MIMES[sniffed] : undefined;
  if (!ext) {
    throw new HttpError(415, "File contents are not a valid image", {
      code: "unsupported_type",
    });
  }
  return { raw, ext };
}

async function handleUploadHero(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const { raw, ext } = await readUploadedImage(ctx);

  const key = `listings/${listing.id}/hero.${ext}`;

  // Delete the previous hero file if the extension changed — storage.write
  // overwrites same-name files in place, so this only matters for ext
  // transitions (e.g. PNG → WebP).
  const prevKey = listing.hero_image_url ? keyFromUploadUrl(listing.hero_image_url) : null;
  if (prevKey && prevKey !== key) await storage.delete(prevKey);

  await storage.write(key, raw);

  // Cache-bust suffix tied to the upload timestamp so the browser sees a
  // fresh URL whenever the vendor uploads again. The static handler in
  // server.ts strips the query before resolving the file path.
  const ts = now();
  const publicUrl = `/uploads/listings/${listing.id}/hero.${ext}?v=${ts}`;
  db.prepare("UPDATE listings SET hero_image_url = ?, updated_at = ? WHERE id = ?").run(
    publicUrl,
    ts,
    listing.id,
  );
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_hero_upload",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, hero_image_url: listing.hero_image_url },
    after: { hero_image_url: publicUrl, bytes: raw.size, mime: raw.type },
  });

  const refreshed = getListingById(listing.id);
  if (!refreshed) {
    throw new HttpError(404, "Listing vanished mid-upload");
  }
  return json(listingViewWithMedia(refreshed, account));
}

async function handleDeleteHero(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (!listing.hero_image_url) {
    // Idempotent: deleting a non-existent hero is fine — the client may
    // double-click or replay the action after a network blip.
    return json(listingViewWithMedia(listing, account));
  }
  const k = keyFromUploadUrl(listing.hero_image_url);
  if (k) await storage.delete(k);
  const ts = now();
  db.prepare("UPDATE listings SET hero_image_url = NULL, updated_at = ? WHERE id = ?").run(
    ts,
    listing.id,
  );
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_hero_delete",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, hero_image_url: listing.hero_image_url },
    after: { hero_image_url: null },
  });
  const refreshed = getListingById(listing.id);
  if (!refreshed) throw new HttpError(404, "Listing vanished mid-delete");
  return json(listingViewWithMedia(refreshed, account));
}

// ── Portfolio gallery ──────────────────────────────────────────────────────
//
// Up to MAX_LISTING_PHOTOS portfolio photos beyond the hero. Same validation
// pipeline as the hero (size cap, mime allow-list, magic-byte sniff); each
// photo gets a unique key so there is nothing to cache-bust, and the row id
// is the delete handle. Public exposure: routes/suppliers.ts folds these into
// the detail payload's gallery_urls (hero first).

async function handleUploadPhoto(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (countListingPhotos(listing.id) >= MAX_LISTING_PHOTOS) {
    throw new HttpError(409, `Gallery is full (max ${MAX_LISTING_PHOTOS} photos)`, {
      code: "gallery_full",
    });
  }
  const { raw, ext } = await readUploadedImage(ctx);

  const ts = now();
  // Unique name per upload: timestamp + entropy, so concurrent uploads never
  // collide and old URLs stay immutable.
  const name = `${ts}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const key = `listings/${listing.id}/gallery/${name}`;
  await storage.write(key, raw);
  const photo = addListingPhoto(listing.id, `/uploads/${key}`);

  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_photo_upload",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id },
    after: { photo_id: photo.id, url: photo.url, bytes: raw.size, mime: raw.type },
  });

  return json(listingViewWithMedia(listing, account), { status: 201 });
}

/** Move one gallery photo's vertical focal point. The tile in the editor crops
 *  to a fixed aspect, so the vendor drags it and this records which band to
 *  keep. Deliberately NOT part of the bulk listing PATCH: it fires per drag
 *  release, and folding it into the big save would re-validate (and re-audit)
 *  the whole listing on every nudge. No audit row for the same reason — a
 *  focal point is a display preference, not a claim about the business. */
async function handlePatchPhoto(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const photoId = Number(ctx.params.photo_id);
  if (!Number.isInteger(photoId) || photoId <= 0) {
    throw new HttpError(400, "photo_id must be a positive integer");
  }
  const body = await readJson<{ position_y?: unknown }>(ctx.req);
  const raw = body.position_y;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new HttpError(400, "position_y must be a number between 0 and 100");
  }
  // Clamp rather than reject: the client derives this from a pointer delta, so
  // an over-drag is a normal gesture, not a malformed request.
  const positionY = Math.max(0, Math.min(100, Math.round(raw)));
  // Scoped lookup — a photo id from another listing reads as absent.
  if (!getListingPhoto(listing.id, photoId)) {
    throw new HttpError(404, "Photo not found", { code: "photo_not_found" });
  }
  setListingPhotoPositionY(listing.id, photoId, positionY);
  return json(listingViewWithMedia(listing, account));
}

async function handleDeletePhoto(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const photoId = Number(ctx.params.photo_id);
  if (!Number.isInteger(photoId) || photoId <= 0) {
    throw new HttpError(400, "photo_id must be a positive integer");
  }
  // Scoped lookup — a photo id belonging to another listing reads as absent,
  // and deleting an absent photo is idempotent (double-click / replay safe).
  const photo = getListingPhoto(listing.id, photoId);
  if (photo) {
    const k = keyFromUploadUrl(photo.url);
    if (k) await storage.delete(k);
    deleteListingPhoto(listing.id, photoId);
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.listing_photo_delete",
      target_kind: "listing",
      target_id: null,
      before: { listing_id: listing.id, photo_id: photoId, url: photo.url },
      after: {},
    });
  }
  return json(listingViewWithMedia(listing, account));
}

// ── Listing video reel ─────────────────────────────────────────────────────
//
// Reference videos (YouTube today) beside the photo gallery — up to
// MAX_LISTING_VIDEOS. Unlike photos these are pasted links, not binary
// uploads, so the pipeline is a JSON body + shared URL parse
// (shared/listing_videos.ts) rather than a multipart sniff. The parser is
// provider-agnostic, so a future Vimeo paste flows through unchanged. Public
// exposure: routes/suppliers.ts folds these into the detail payload's `videos`.
// Sits under the same /api/vendor/listing entitlement EDIT surface as the
// gallery, so FREE vendors can curate their reel but a lapsed one goes
// read-only along with the rest of the listing.

const MAX_VIDEO_URL_LEN = 400;

/** Pull + validate the `url` field of a video mutation body: a non-empty
 *  string within the length cap that the shared parser recognises. Returns the
 *  trimmed original url plus the parsed provider + id. */
function readVideoUrl(body: { url?: unknown }): {
  url: string;
  provider: "youtube";
  video_id: string;
} {
  if (typeof body.url !== "string") {
    throw new HttpError(400, "`url` must be a string", { code: "bad_url" });
  }
  const trimmed = body.url.trim();
  if (trimmed.length === 0) {
    throw new HttpError(400, "`url` cannot be empty", { code: "bad_url" });
  }
  if (trimmed.length > MAX_VIDEO_URL_LEN) {
    throw new HttpError(400, `url is too long (max ${MAX_VIDEO_URL_LEN})`, { code: "bad_url" });
  }
  const parsed = parseVideoUrl(trimmed);
  if (!parsed) {
    throw new HttpError(400, "Not a recognised video URL", { code: "invalid_video_url" });
  }
  return { url: trimmed, provider: parsed.provider, video_id: parsed.video_id };
}

async function handleAddVideo(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (countListingVideos(listing.id) >= MAX_LISTING_VIDEOS) {
    throw new HttpError(409, `Video reel is full (max ${MAX_LISTING_VIDEOS} videos)`, {
      code: "videos_full",
    });
  }
  const body = await readJson<{ url?: unknown }>(ctx.req);
  const { url, provider, video_id } = readVideoUrl(body);
  const video = addListingVideo(listing.id, provider, video_id, url);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_video_add",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id },
    after: { video_id: video.id, provider, provider_video_id: video_id, url },
  });
  return json(listingViewWithMedia(listing, account), { status: 201 });
}

async function handleUpdateVideo(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const rowId = Number(ctx.params.video_id);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new HttpError(400, "video_id must be a positive integer");
  }
  // Scoped lookup — a video id belonging to another listing reads as absent.
  const existing = getListingVideo(listing.id, rowId);
  if (!existing) {
    throw new HttpError(404, "Video not found", { code: "video_not_found" });
  }
  const body = await readJson<{ url?: unknown }>(ctx.req);
  const { url, provider, video_id } = readVideoUrl(body);
  updateListingVideo(listing.id, rowId, provider, video_id, url);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_video_update",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, video_id: rowId, url: existing.url },
    after: { provider, provider_video_id: video_id, url },
  });
  return json(listingViewWithMedia(listing, account));
}

async function handleDeleteVideo(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const rowId = Number(ctx.params.video_id);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new HttpError(400, "video_id must be a positive integer");
  }
  // Scoped lookup keeps delete idempotent + cross-listing-safe (a stray id
  // reads as absent, so a double-click / replay is a clean no-op).
  const existing = getListingVideo(listing.id, rowId);
  if (existing) {
    deleteListingVideo(listing.id, rowId);
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.listing_video_delete",
      target_kind: "listing",
      target_id: null,
      before: { listing_id: listing.id, video_id: rowId, url: existing.url },
      after: {},
    });
  }
  return json(listingViewWithMedia(listing, account));
}

async function handleReorderVideos(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const body = await readJson<{ ordered_ids?: unknown }>(ctx.req);
  if (
    !Array.isArray(body.ordered_ids) ||
    !body.ordered_ids.every((v) => Number.isInteger(v) && (v as number) > 0)
  ) {
    throw new HttpError(400, "`ordered_ids` must be an array of positive integers", {
      code: "bad_ordered_ids",
    });
  }
  reorderListingVideos(listing.id, body.ordered_ids as number[]);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_video_reorder",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id },
    after: { ordered_ids: body.ordered_ids },
  });
  return json(listingViewWithMedia(listing, account));
}

// ── Listing packages (árajánlat / price offers) ────────────────────────────
//
// Up to MAX_LISTING_PACKAGES named price tiers, each with a vendor-chosen name,
// an optional free-text price, an optional description, and an optional attached
// PDF (a printable price list). The text fields flow through a JSON body; the
// PDF is a separate multipart endpoint mirroring the photo pipeline (size cap +
// %PDF magic-byte sniff, never trusting the client Content-Type). Public
// exposure: routes/suppliers.ts folds these into the detail payload's
// `packages`. Sits under the same /api/vendor/listing EDIT entitlement surface
// as the gallery/reel — FREE vendors can publish offers, a lapsed one goes
// read-only along with the rest of the listing.

function parsePackageId(ctx: Ctx): number {
  const id = Number(ctx.params.package_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "package_id must be a positive integer");
  }
  return id;
}

/** Required, non-empty, length-capped package name. */
function requirePackageName(v: unknown): string {
  if (typeof v !== "string") {
    throw new HttpError(400, "`name` must be a string", { code: "bad_name" });
  }
  const trimmed = v.trim();
  if (trimmed.length === 0) {
    throw new HttpError(400, "`name` cannot be empty", { code: "bad_name" });
  }
  if (trimmed.length > PACKAGE_NAME_MAX) {
    throw new HttpError(400, `name too long (max ${PACKAGE_NAME_MAX})`, { code: "bad_name" });
  }
  return trimmed;
}

/** Optional text field. `undefined` => key absent (leave alone). `null` or an
 *  empty string => clear the value. A string => trimmed + length-capped. */
function optionalPackageText(v: unknown, field: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") {
    throw new HttpError(400, `\`${field}\` must be a string or null`, { code: "bad_field" });
  }
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new HttpError(400, `\`${field}\` too long (max ${max})`, { code: "bad_field" });
  }
  return trimmed;
}

/** Optional whole-unit money amount. `undefined` => key absent (leave alone),
 *  `null` or an empty string => clear it. Whole units only: the listing's
 *  currency may be forint, where a fractional amount is meaningless, and every
 *  other money column on the platform is stored the same way. */
function optionalPackageAmount(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new HttpError(400, `\`${field}\` must be a number or null`, { code: "bad_field" });
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, `\`${field}\` must be a whole number of currency units`, {
      code: "bad_field",
    });
  }
  if (n > PACKAGE_AMOUNT_MAX) {
    throw new HttpError(400, `\`${field}\` is out of range`, { code: "bad_field" });
  }
  return n;
}

function optionalPriceMode(v: unknown): PackagePriceMode | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!isPackagePriceMode(v)) {
    throw new HttpError(400, "`price_mode` must be 'total' or 'per_person'", {
      code: "bad_price_mode",
    });
  }
  return v;
}

/** A price the couple cannot read is worse than no price, so the two halves
 *  have to arrive together: numbers with no mode do not say whether they buy
 *  the day or one seat, and a mode with no numbers says nothing at all. Both
 *  absent is fine — a package may price itself in its PDF, or not at all.
 *
 *  `min > max` is refused rather than swapped: a vendor who typed them the
 *  wrong way round has a typo somewhere, and silently reinterpreting a price
 *  is not a correction we get to make on their behalf. */
function assertCoherentPrice(
  min: number | null,
  max: number | null,
  mode: PackagePriceMode | null,
): void {
  const hasAmount = min !== null || max !== null;
  if (hasAmount && mode === null) {
    throw new HttpError(400, "`price_mode` is required with a price", {
      code: "price_mode_missing",
    });
  }
  if (!hasAmount && mode !== null) {
    throw new HttpError(400, "`price_mode` needs a price", { code: "price_amount_missing" });
  }
  if (min !== null && max !== null && min > max) {
    throw new HttpError(400, "`price_min` cannot exceed `price_max`", { code: "bad_price_range" });
  }
}

const MAX_PDF_NAME_LEN = 120;

/** Pull + validate the `file` field of a package-PDF upload: a non-empty file
 *  within the size cap whose real magic bytes are `%PDF`. Returns the file plus
 *  a sanitised display filename. Never trusts the client Content-Type. */
async function readUploadedPdf(ctx: Ctx): Promise<{ raw: File; filename: string }> {
  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const raw = form.get("file");
  if (!(raw instanceof File)) {
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  }
  if (raw.size <= 0) {
    throw new HttpError(400, "Empty file", { code: "empty_file" });
  }
  if (raw.size > PACKAGE_PDF_MAX_BYTES) {
    throw new HttpError(413, `File too large (max ${PACKAGE_PDF_MAX_BYTES / 1024 / 1024} MB)`, {
      code: "file_too_large",
    });
  }
  if (raw.type && raw.type !== "application/pdf") {
    throw new HttpError(415, `Unsupported type: ${raw.type}`, { code: "unsupported_type" });
  }
  const head = new Uint8Array(await raw.arrayBuffer()).subarray(0, 5);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  if (!isPdf) {
    throw new HttpError(415, "File contents are not a valid PDF", { code: "unsupported_type" });
  }
  // Display filename: strip any path, cap length, guarantee a .pdf suffix.
  const base = (raw.name || "arajanlat.pdf").replace(/^.*[\\/]/, "").trim();
  let filename = base.length > 0 ? base : "arajanlat.pdf";
  if (filename.length > MAX_PDF_NAME_LEN) filename = filename.slice(0, MAX_PDF_NAME_LEN);
  if (!/\.pdf$/i.test(filename)) filename = `${filename}.pdf`;
  return { raw, filename };
}

async function handleAddPackage(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (countListingPackages(listing.id) >= MAX_LISTING_PACKAGES) {
    throw new HttpError(409, `Packages are full (max ${MAX_LISTING_PACKAGES})`, {
      code: "packages_full",
    });
  }
  const body = await readJson<{
    name?: unknown;
    price_text?: unknown;
    price_min?: unknown;
    price_max?: unknown;
    price_mode?: unknown;
    description?: unknown;
  }>(ctx.req);
  const name = requirePackageName(body.name);
  const priceText = optionalPackageText(body.price_text, "price_text", PACKAGE_PRICE_MAX);
  const priceMin = optionalPackageAmount(body.price_min, "price_min") ?? null;
  const priceMax = optionalPackageAmount(body.price_max, "price_max") ?? null;
  const priceMode = optionalPriceMode(body.price_mode) ?? null;
  assertCoherentPrice(priceMin, priceMax, priceMode);
  const description = optionalPackageText(body.description, "description", PACKAGE_DESCRIPTION_MAX);
  const pkg = addListingPackage(listing.id, {
    name,
    // Structured numbers supersede the legacy string. Keeping both would make
    // the row carry two prices and leave readers to choose which one is true.
    price_text: priceMode === null ? (priceText ?? null) : null,
    price_min: priceMin,
    price_max: priceMax,
    price_mode: priceMode,
    description: description ?? null,
  });
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_package_add",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id },
    after: { package_id: pkg.id, name },
  });
  return json(listingViewWithMedia(listing, account), { status: 201 });
}

async function handleUpdatePackage(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const packageId = parsePackageId(ctx);
  const existing = getListingPackage(listing.id, packageId);
  if (!existing) throw new HttpError(404, "Package not found", { code: "package_not_found" });
  const body = await readJson<{
    name?: unknown;
    price_text?: unknown;
    price_min?: unknown;
    price_max?: unknown;
    price_mode?: unknown;
    description?: unknown;
  }>(ctx.req);
  const patch: {
    name?: string;
    price_text?: string | null;
    price_min?: number | null;
    price_max?: number | null;
    price_mode?: PackagePriceMode | null;
    description?: string | null;
  } = {};
  if (body.name !== undefined) patch.name = requirePackageName(body.name);
  const priceText = optionalPackageText(body.price_text, "price_text", PACKAGE_PRICE_MAX);
  if (priceText !== undefined) patch.price_text = priceText;
  const priceMin = optionalPackageAmount(body.price_min, "price_min");
  if (priceMin !== undefined) patch.price_min = priceMin;
  const priceMax = optionalPackageAmount(body.price_max, "price_max");
  if (priceMax !== undefined) patch.price_max = priceMax;
  const priceMode = optionalPriceMode(body.price_mode);
  if (priceMode !== undefined) patch.price_mode = priceMode;
  // Coherence is judged on the row as it will BE, not on the keys that arrived:
  // this PATCH is partial, so clearing just the mode has to be caught against
  // the amounts already stored rather than passing because they were absent.
  assertCoherentPrice(
    priceMin !== undefined ? priceMin : existing.price_min,
    priceMax !== undefined ? priceMax : existing.price_max,
    priceMode !== undefined ? priceMode : existing.price_mode,
  );
  const nextHasStructuredPrice =
    (priceMin !== undefined ? priceMin : existing.price_min) !== null ||
    (priceMax !== undefined ? priceMax : existing.price_max) !== null;
  if (nextHasStructuredPrice) patch.price_text = null;
  const description = optionalPackageText(body.description, "description", PACKAGE_DESCRIPTION_MAX);
  if (description !== undefined) patch.description = description;
  updateListingPackage(listing.id, packageId, patch);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_package_update",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, package_id: packageId },
    after: { keys: Object.keys(patch) },
  });
  return json(listingViewWithMedia(listing, account));
}

async function handleDeletePackage(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const packageId = parsePackageId(ctx);
  const existing = getListingPackage(listing.id, packageId);
  if (existing) {
    if (existing.pdf_url) {
      const k = keyFromUploadUrl(existing.pdf_url);
      if (k) await storage.delete(k);
    }
    deleteListingPackage(listing.id, packageId);
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.listing_package_delete",
      target_kind: "listing",
      target_id: null,
      before: { listing_id: listing.id, package_id: packageId, name: existing.name },
      after: {},
    });
  }
  return json(listingViewWithMedia(listing, account));
}

async function handleUploadPackagePdf(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const packageId = parsePackageId(ctx);
  const existing = getListingPackage(listing.id, packageId);
  if (!existing) throw new HttpError(404, "Package not found", { code: "package_not_found" });
  const { raw, filename } = await readUploadedPdf(ctx);
  const key = `listings/${listing.id}/packages/${packageId}.pdf`;
  await storage.write(key, raw, "application/pdf");
  const ts = now();
  const publicUrl = `/uploads/${key}?v=${ts}`;
  setListingPackagePdf(listing.id, packageId, publicUrl, filename);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.listing_package_pdf_upload",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, package_id: packageId },
    after: { pdf_name: filename, bytes: raw.size },
  });
  return json(listingViewWithMedia(listing, account));
}

async function handleDeletePackagePdf(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const packageId = parsePackageId(ctx);
  const existing = getListingPackage(listing.id, packageId);
  if (existing?.pdf_url) {
    const k = keyFromUploadUrl(existing.pdf_url);
    if (k) await storage.delete(k);
    clearListingPackagePdf(listing.id, packageId);
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.listing_package_pdf_delete",
      target_kind: "listing",
      target_id: null,
      before: { listing_id: listing.id, package_id: packageId, pdf_name: existing.pdf_name },
      after: {},
    });
  }
  return json(listingViewWithMedia(listing, account));
}

// ── Visibility toggle (pause / unpause) ────────────────────────────────────
//
// A fully-booked vendor can take their card offline without support: 'active'
// <-> 'hidden' and nothing else. The public directory still reads the SOURCE
// tables (curated + community), not `listings`, so the toggle must flip the
// source-of-truth per listing kind:
//   - community ('c{N}'): community_suppliers.status via setStatus, which
//     mirrors into `listings` itself
//   - curated (claimed slug): a curated_supplier_overrides row (same lever the
//     admin hide uses), plus the mirrored listings.status for the editor pill
//   - self-serve ('v{N}'): listings.status only (no public surface yet)
// Moderation guardrails: 'pending'/'awaiting_review' rows are 409 (flipping an
// unreviewed card live would skip review), and a card hidden/deleted BY AN
// ADMIN cannot be re-published by its vendor; only a self-pause can be
// undone. Sits under the /api/vendor/listing entitlement EDIT prefix, so a
// lapsed vendor cannot flip visibility while read-only.

const VENDOR_PAUSE_REASON = "vendor_pause";

function assertSelfPause(hiddenByUserId: number | null, ownerUserId: number): void {
  if (hiddenByUserId !== null && hiddenByUserId !== ownerUserId) {
    throw new HttpError(409, "Listing was hidden by moderation and cannot be re-published", {
      code: "listing_moderated",
    });
  }
}

async function handleSetVisibility(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  const body = await readJson<{ published?: unknown }>(ctx.req);
  if (typeof body.published !== "boolean") {
    throw new HttpError(400, "`published` must be a boolean", { code: "bad_published" });
  }
  const nextStatus = body.published ? "active" : "hidden";
  const ts = now();

  if (listing.source === "community" && /^c\d+$/.test(listing.id)) {
    const communityId = Number(listing.id.slice(1));
    const row = getCommunitySupplierById(communityId);
    if (!row) throw new HttpError(404, "Community listing vanished");
    if (row.status !== "active" && row.status !== "hidden") {
      throw new HttpError(409, "Listing is in moderation and cannot be toggled", {
        code: "listing_moderated",
      });
    }
    // Only the RE-PUBLISH direction needs to prove the hide was a self-pause
    // — agreeing to stay hidden never overrides anyone's decision, so it must
    // never 409 just because an admin (or a quarantine) was the one who hid it.
    if (body.published && row.status === "hidden") {
      assertSelfPause(row.hidden_by_user_id, account.owner_user_id);
    }
    if (row.status !== nextStatus) {
      // setStatus mirrors into `listings` via syncListingFromCommunityId.
      setCommunityStatus(
        communityId,
        nextStatus,
        body.published ? null : account.owner_user_id,
        body.published ? null : VENDOR_PAUSE_REASON,
      );
    }
  } else if (listing.source === "curated") {
    // A quarantined listing's override was set by an admin/system action for
    // a source dispute (routes/vendor_listing.ts's own `handleSetVisibility`
    // is the ONLY caller of `assertSelfPause`, so this check has to come
    // first) — the ordinary "flip it back on" self-serve path must not be
    // able to clear that override. See domain/listing_quarantine.ts.
    if (body.published && isUnderQuarantineReview(listing)) {
      throw new HttpError(409, "This listing needs your review before it can go live", {
        code: "quarantine_review_required",
      });
    }
    const override = db
      .prepare(
        "SELECT status, hidden_by_user_id FROM curated_supplier_overrides WHERE supplier_id = ?",
      )
      .get(listing.id) as { status: string; hidden_by_user_id: number | null } | undefined;
    // Same direction-only rule as the community branch above: only publishing
    // has to prove the hide was a self-pause, not confirming it stays hidden.
    if (body.published && override)
      assertSelfPause(override.hidden_by_user_id, account.owner_user_id);
    if (body.published) {
      clearCuratedOverride(listing.id);
    } else {
      setCuratedOverride(listing.id, "hidden", account.owner_user_id, VENDOR_PAUSE_REASON);
    }
    db.prepare("UPDATE listings SET status = ?, updated_at = ? WHERE id = ?").run(
      nextStatus,
      ts,
      listing.id,
    );
  } else {
    // Self-serve 'v{N}' row: `listings` is the only home it has.
    if (listing.status !== "active" && listing.status !== "hidden") {
      throw new HttpError(409, "Listing is in moderation and cannot be toggled", {
        code: "listing_moderated",
      });
    }
    if (nextStatus !== listing.status) {
      db.prepare("UPDATE listings SET status = ?, updated_at = ? WHERE id = ?").run(
        nextStatus,
        ts,
        listing.id,
      );
    }
  }

  if (nextStatus !== listing.status) {
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.listing_visibility",
      target_kind: "listing",
      target_id: null,
      before: { listing_id: listing.id, status: listing.status },
      after: { status: nextStatus },
    });
  }
  const refreshed = getListingById(listing.id);
  if (!refreshed) throw new HttpError(404, "Listing vanished mid-update");
  return json(listingViewWithMedia(refreshed, account));
}

// ── Source-dispute quarantine review ────────────────────────────────────────
//
// A listing quarantined for a source dispute (domain/listing_quarantine.ts)
// stays hidden after the vendor claims it, until they've reviewed the
// pre-existing content, replaced any imagery of uncertain provenance, and
// explicitly published. These three routes are the whole review flow; the
// gate itself lives in the domain module so this file stays thin.

interface QuarantineStatusView {
  under_review: boolean;
  can_publish: boolean;
  blocked_reason: "no_new_image" | "not_claimed" | null;
  hero_preview_url: string | null;
  gallery_preview_urls: string[];
}

function quarantineStatusView(listing: Listing, vendorAccountId: number): QuarantineStatusView {
  const underReview = isUnderQuarantineReview(listing);
  if (!underReview) {
    return {
      under_review: false,
      can_publish: false,
      blocked_reason: null,
      hero_preview_url: null,
      gallery_preview_urls: [],
    };
  }
  const gate = canPublishQuarantinedListing(listing, vendorAccountId);
  const preview = getQuarantinePreview(listing.id);
  const base = "/api/vendor/listing/me/quarantine-preview";
  return {
    under_review: true,
    can_publish: gate.ok,
    // `gate.reason` is never "not_quarantined" here — `underReview` above
    // already established that, and `canPublishQuarantinedListing` checks
    // the same condition first.
    blocked_reason: gate.ok ? null : (gate.reason as "no_new_image" | "not_claimed"),
    hero_preview_url: preview.heroEvidenceKey ? `${base}/hero` : null,
    gallery_preview_urls: preview.galleryEvidenceKeys.map((_, i) => `${base}/gallery/${i}`),
  };
}

function handleQuarantineStatus(ctx: Ctx): Response {
  const { listing, account } = resolveVendorListing(ctx);
  return json(quarantineStatusView(listing, account.id));
}

/** Streams one of the ORIGINAL (pre-replacement) images for the caller's own
 *  quarantined listing. Deliberately not the public `/uploads/` route — see
 *  the comment on domain/listing_quarantine.ts's `getQuarantinePreview`. */
async function handleQuarantinePreviewHero(ctx: Ctx): Promise<Response> {
  const { listing } = resolveVendorListing(ctx);
  if (!isUnderQuarantineReview(listing)) throw new HttpError(404, "Nothing to preview");
  const preview = getQuarantinePreview(listing.id);
  if (!preview.heroEvidenceKey) throw new HttpError(404, "No original hero on file");
  const res = await storage.serve(preview.heroEvidenceKey);
  if (!res) throw new HttpError(404, "Original hero no longer available");
  return res;
}

interface GalleryPreviewParams {
  index?: string;
}

async function handleQuarantinePreviewGalleryItem(ctx: Ctx): Promise<Response> {
  const { listing } = resolveVendorListing(ctx);
  if (!isUnderQuarantineReview(listing)) throw new HttpError(404, "Nothing to preview");
  const idx = Number((ctx.params as GalleryPreviewParams).index);
  if (!Number.isInteger(idx) || idx < 0) throw new HttpError(400, "Invalid index");
  const preview = getQuarantinePreview(listing.id);
  const key = preview.galleryEvidenceKeys[idx];
  if (!key) throw new HttpError(404, "No original photo at that index");
  const res = await storage.serve(key);
  if (!res) throw new HttpError(404, "Original photo no longer available");
  return res;
}

/** The gated release: requires a fresh vendor-supplied image on every slot
 *  the listing currently carries (or none at all). See
 *  `canPublishQuarantinedListing` for exactly what "fresh" means. */
function handlePublishQuarantineReview(ctx: Ctx): Response {
  const { listing, account } = resolveVendorListing(ctx);
  const gate = canPublishQuarantinedListing(listing, account.id);
  if (!gate.ok) {
    const message =
      gate.reason === "no_new_image"
        ? "Upload a new hero photo or gallery image before publishing — the existing ones came from a disputed source and can't go live as-is."
        : gate.reason === "not_quarantined"
          ? "This listing isn't under review."
          : "This listing isn't claimed by your account.";
    throw new HttpError(409, message, { code: gate.reason ?? "quarantine_blocked" });
  }
  publishQuarantinedListing(listing, account.owner_user_id);
  const refreshed = getListingById(listing.id);
  if (!refreshed) throw new HttpError(404, "Listing vanished mid-update");
  return json(listingViewWithMedia(refreshed, account));
}

// ── Onboarding completion ──────────────────────────────────────────────────
//
// The self-serve signup wizard (frontend /vendor/onboarding) edits the listing
// through the PATCH/hero endpoints above, then calls this once to mark the
// account onboarded so the dashboard stops redirecting back into the wizard.
// Idempotent — a replay (double-click, retry after a blip) just re-stamps 1.
// Deliberately NOT under the entitlement EDIT prefixes so a mid-onboarding
// vendor can always finish.

async function handleCompleteOnboarding(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (!account.onboarding_done) {
    db.prepare("UPDATE vendor_accounts SET onboarding_done = 1, updated_at = ? WHERE id = ?").run(
      now(),
      account.id,
    );
    addAuditLog({
      actor_user_id: account.owner_user_id,
      couple_id: null,
      action: "vendor.onboarding_complete",
      target_kind: "vendor_account",
      target_id: account.id,
      after: { onboarding_done: true },
    });
  }
  const view: VendorListingView = {
    listing,
    account: { ...account, onboarding_done: true },
    currency: listingCurrency({ country: account.country, currency: listing.currency_override }),
  };
  return json(view);
}

export function registerVendorListingRoutes(router: Router) {
  router.get("/api/vendor/listing/me", handleGetMe);
  router.patch("/api/vendor/listing/me", handlePatchMe);
  router.post("/api/vendor/listing/me/visibility", handleSetVisibility);
  router.get("/api/vendor/listing/me/quarantine", handleQuarantineStatus);
  router.get("/api/vendor/listing/me/quarantine-preview/hero", handleQuarantinePreviewHero);
  router.get(
    "/api/vendor/listing/me/quarantine-preview/gallery/:index",
    handleQuarantinePreviewGalleryItem,
  );
  router.post("/api/vendor/listing/me/quarantine/publish", handlePublishQuarantineReview);
  router.post("/api/vendor/listing/me/hero", handleUploadHero);
  router.delete("/api/vendor/listing/me/hero", handleDeleteHero);
  router.post("/api/vendor/listing/me/photos", handleUploadPhoto);
  router.patch("/api/vendor/listing/me/photos/:photo_id", handlePatchPhoto);
  router.delete("/api/vendor/listing/me/photos/:photo_id", handleDeletePhoto);
  router.post("/api/vendor/listing/me/videos", handleAddVideo);
  // Literal "reorder" registered BEFORE the `:video_id` PATCH so the router
  // doesn't swallow it as video_id="reorder" (mirrors households.reorder).
  router.patch("/api/vendor/listing/me/videos/reorder", handleReorderVideos);
  router.patch("/api/vendor/listing/me/videos/:video_id", handleUpdateVideo);
  router.delete("/api/vendor/listing/me/videos/:video_id", handleDeleteVideo);
  // Packages (árajánlat). The `/pdf` sub-path sits under :package_id, distinct in
  // method + depth from the bare :package_id routes, so ordering is unambiguous.
  router.post("/api/vendor/listing/me/packages", handleAddPackage);
  router.patch("/api/vendor/listing/me/packages/:package_id", handleUpdatePackage);
  router.delete("/api/vendor/listing/me/packages/:package_id", handleDeletePackage);
  router.post("/api/vendor/listing/me/packages/:package_id/pdf", handleUploadPackagePdf);
  router.delete("/api/vendor/listing/me/packages/:package_id/pdf", handleDeletePackagePdf);
  router.post("/api/vendor/onboarding/complete", handleCompleteOnboarding);
}
