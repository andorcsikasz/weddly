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
  priceBandLockedUntil,
  type VendorListingEditInput,
  type VendorListingView,
} from "@shared/listings";
import { db, now } from "../db";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { sniffUploadedImage } from "../lib/image_sniff";
import { keyFromUploadUrl, storage } from "../lib/storage";
import {
  getCommunitySupplierById,
  setStatus as setCommunityStatus,
} from "../domain/community_suppliers";
import { clearCuratedOverride, setCuratedOverride } from "../domain/curated_overrides";
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
  // Anti-fraud pricing cooldown (shared/listings.ts): a change to the price
  // band, including withdrawing it, is allowed once every 30 days. Only a
  // real change trips the gate; re-sending the current value is a no-op.
  // Publishing the FIRST price never starts the clock (misclick grace), but
  // every change of a published band stamps the anchor, so hide-and-republish
  // can't be used to flip bands faster than the cooldown.
  if (patch.price_band !== undefined && patch.price_band !== currentListing.price_band) {
    const lockedUntil = priceBandLockedUntil(currentListing.price_band_changed_at);
    if (lockedUntil !== null && now() < lockedUntil) {
      throw new HttpError(
        409,
        `price_band is locked until ${new Date(lockedUntil).toISOString().slice(0, 10)}`,
      );
    }
    if (currentListing.price_band !== null) patch.price_band_changed_at = now();
  }
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
    // Price-band transitions are recorded verbatim (not just the field name)
    // so a band-flipping pattern is reconstructable from the audit log alone.
    before: {
      listing_id: currentListing.id,
      ...(patch.price_band !== undefined ? { price_band: currentListing.price_band } : {}),
    },
    after: {
      fields: Object.keys(patch),
      ...(patch.price_band !== undefined ? { price_band: patch.price_band } : {}),
    },
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
  const view: VendorListingView = { listing: refreshed, account };
  return json(view);
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
    if (row.status === "hidden") assertSelfPause(row.hidden_by_user_id, account.owner_user_id);
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
    const override = db
      .prepare(
        "SELECT status, hidden_by_user_id FROM curated_supplier_overrides WHERE supplier_id = ?",
      )
      .get(listing.id) as { status: string; hidden_by_user_id: number | null } | undefined;
    if (override) assertSelfPause(override.hidden_by_user_id, account.owner_user_id);
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
  const view: VendorListingView = { listing: refreshed, account };
  return json(view);
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
  };
  return json(view);
}

export function registerVendorListingRoutes(router: Router) {
  router.get("/api/vendor/listing/me", handleGetMe);
  router.patch("/api/vendor/listing/me", handlePatchMe);
  router.post("/api/vendor/listing/me/visibility", handleSetVisibility);
  router.post("/api/vendor/listing/me/hero", handleUploadHero);
  router.delete("/api/vendor/listing/me/hero", handleDeleteHero);
  router.post("/api/vendor/onboarding/complete", handleCompleteOnboarding);
}
