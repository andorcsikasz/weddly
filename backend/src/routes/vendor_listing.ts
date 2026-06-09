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

import { existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { VendorListingEditInput, VendorListingView } from "@shared/listings";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { sniffUploadedImage } from "../lib/image_sniff";
import {
  getListingById,
  getListingByVendorAccountId,
  patchListing,
  toVendorAccount,
  type ListingPatch,
} from "../domain/listings";
import { getVendorAccountByOwnerUserId } from "../domain/vendor_accounts";
import { getVendorSub, toVendorBilling } from "../domain/vendor_billing";
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
  return { listing, account: toVendorAccount(accountRow) };
}

async function handleGetMe(ctx: Ctx): Promise<Response> {
  const view = resolveVendorListing(ctx);
  const sub = getVendorSub(view.account.id);
  return json({ ...view, billing: sub ? toVendorBilling(sub) : null });
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

/** Resolve an upload-relative URL (e.g. `/uploads/listings/v3/hero.png?v=…`)
 *  back to its on-disk path. Returns null if the URL isn't shaped like an
 *  uploads path — defends against `..`/absolute-path attempts even though
 *  the values we ever write are under our own control. */
function uploadRelToDisk(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  const noQuery = publicUrl.split("?")[0] ?? publicUrl;
  if (!noQuery.startsWith("/uploads/")) return null;
  const rel = noQuery.slice("/uploads/".length);
  if (rel.includes("..") || rel.startsWith("/")) return null;
  return join(CONFIG.uploadsDir, rel);
}

async function handleUploadHero(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);

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

  const dir = join(CONFIG.uploadsDir, "listings", listing.id);
  await mkdir(dir, { recursive: true });

  // Delete the previous hero file if the extension changed — Bun.write
  // overwrites same-name files in place, so this only matters for ext
  // transitions (e.g. PNG → WebP).
  const previousDiskPath = uploadRelToDisk(listing.hero_image_url);
  const newDiskPath = join(dir, `hero.${ext}`);
  if (previousDiskPath && previousDiskPath !== newDiskPath && existsSync(previousDiskPath)) {
    await unlink(previousDiskPath).catch(() => {
      // Best-effort cleanup — the new file overwriting the column is the
      // correctness contract; leaking a stale file under uploads doesn't
      // surface to users and the next upload will overwrite it.
    });
  }

  await Bun.write(newDiskPath, raw);

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
  const view: VendorListingView = { listing: refreshed, account };
  return json(view);
}

async function handleDeleteHero(ctx: Ctx): Promise<Response> {
  const { listing, account } = resolveVendorListing(ctx);
  if (!listing.hero_image_url) {
    // Idempotent: deleting a non-existent hero is fine — the client may
    // double-click or replay the action after a network blip.
    const view: VendorListingView = { listing, account };
    return json(view);
  }
  const diskPath = uploadRelToDisk(listing.hero_image_url);
  if (diskPath && existsSync(diskPath)) {
    await unlink(diskPath).catch(() => {});
  }
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
  const view: VendorListingView = { listing: refreshed, account };
  return json(view);
}

export function registerVendorListingRoutes(router: Router) {
  router.get("/api/vendor/listing/me", handleGetMe);
  router.patch("/api/vendor/listing/me", handlePatchMe);
  router.post("/api/vendor/listing/me/hero", handleUploadHero);
  router.delete("/api/vendor/listing/me/hero", handleDeleteHero);
}
