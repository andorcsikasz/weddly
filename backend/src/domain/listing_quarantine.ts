// Source-dispute quarantine for curated listings. Built 2026-09-03 after
// bodalia.es disputed the 2026-08-19 WeddlyResearchBot crawl behind
// suppliers_data_es_scale_*.ts (424 rows: scraped name/address/email/phone,
// hotlinked bodalia.es gallery images later mirrored into our own storage by
// the boot-time hero/gallery backfill sweeps).
//
// This reuses the two levers that already comprehensively hide a curated
// listing rather than inventing a third: `curated_supplier_overrides`
// (catalogue list + detail resolution + sitemap, all already keyed off it —
// see domain/curated_overrides.ts) and `listings.status` (proximity/category
// SQL reads, the image backfill sweeps' own eligibility query, the
// `/uploads/listings/<id>/...` static-file allowlist in server.ts, and
// vendor-claim-campaign targeting — all four already filter `status =
// 'active'`). Setting both is what makes a quarantine take effect immediately
// everywhere with no new code path to keep in sync.
//
// What this module adds on top of that pre-existing hide: `listings.quarantined_at`
// / `quarantine_reason` / `image_rights_confirmed_at` / `vendor_published_at`
// (see db.ts) make the suppression auditable and, critically, make
// RE-publication a gated act. Without a check in routes/vendor_listing.ts's
// `handleSetVisibility`, a vendor who claims a quarantined listing could flip
// `published: true` through the ordinary visibility toggle and instantly clear
// the override — that gap is closed in that route, not here; this module is
// what the gate consults.

import type { Listing } from "@shared/listings";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { keyFromUploadUrl, storage } from "../lib/storage";
import { clearCuratedOverride, setCuratedOverride } from "./curated_overrides";
import { getListingById } from "./listings";

export const QUARANTINE_REASON_BODALIA = "source_dispute:bodalia.es";

/** True while a listing is under an unresolved quarantine: pulled, and not
 *  yet released by the vendor's own gated publish call. A listing that was
 *  quarantined and later published stays `quarantined_at`-stamped forever
 *  (the historical fact never clears) but is no longer "under review". */
export function isUnderQuarantineReview(
  listing: Pick<Listing, "quarantined_at" | "vendor_published_at">,
): boolean {
  return listing.quarantined_at !== null && listing.vendor_published_at === null;
}

/** Curated listing ids whose `website` names a host fragment (e.g.
 *  "bodalia.es"), not already quarantined, and — the safety condition a
 *  quarantine batch must never violate — not already claimed by a vendor. An
 *  already-claimed row is left completely untouched; a real, verified account
 *  must never lose its live listing to a batch sweep aimed at a scrape it may
 *  have nothing to do with. */
export function findQuarantineCandidates(hostFragment: string): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM listings
        WHERE source = 'curated'
          AND website LIKE ?
          AND vendor_account_id IS NULL
          AND quarantined_at IS NULL
        ORDER BY id ASC`,
    )
    .all(`%${hostFragment}%`) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Curated listing ids matching the host fragment that are EITHER already
 *  claimed or already quarantined — the two reasons a candidate query above
 *  would skip a row. Purely informational, for the operator report. */
export function findExcludedFromQuarantine(
  hostFragment: string,
): { id: string; reason: "already_claimed" | "already_quarantined" }[] {
  const rows = db
    .prepare(
      `SELECT id, vendor_account_id, quarantined_at FROM listings
        WHERE source = 'curated' AND website LIKE ?
          AND (vendor_account_id IS NOT NULL OR quarantined_at IS NOT NULL)
        ORDER BY id ASC`,
    )
    .all(`%${hostFragment}%`) as {
    id: string;
    vendor_account_id: number | null;
    quarantined_at: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    reason: r.vendor_account_id !== null ? "already_claimed" : "already_quarantined",
  }));
}

/** Copy a listing's current hero + gallery objects to a `quarantine-evidence/`
 *  prefix before anything else touches them. Never served publicly — the key
 *  matches no pattern in server.ts's `publicUploadKey` allowlist, so it's
 *  private by the same default every other unlisted prefix already gets.
 *  Read-then-write rather than a driver-level copy because `Storage` exposes
 *  no such primitive (`write` / `exists` / `serve` / `delete` only) and adding
 *  one for a single call site isn't worth the interface change. Best-effort:
 *  a single missing/corrupt object is skipped, not fatal to the batch. */
async function snapshotListingImages(listingId: string): Promise<number> {
  const row = db.prepare("SELECT hero_image_url FROM listings WHERE id = ?").get(listingId) as
    | { hero_image_url: string | null }
    | undefined;
  const keys: string[] = [];
  if (row?.hero_image_url) {
    const k = keyFromUploadUrl(row.hero_image_url);
    if (k) keys.push(k);
  }
  const photos = db
    .prepare("SELECT url FROM listing_photos WHERE listing_id = ?")
    .all(listingId) as { url: string }[];
  for (const p of photos) {
    const k = keyFromUploadUrl(p.url);
    if (k) keys.push(k);
  }

  let copied = 0;
  for (const key of keys) {
    const filename = key.split("/").pop();
    if (!filename) continue;
    try {
      const res = await storage.serve(key);
      if (!res || !res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) continue;
      await storage.write(`quarantine-evidence/${listingId}/${filename}`, bytes);
      copied++;
    } catch {
      // Best-effort: leave it for the operator to notice in the report totals
      // rather than aborting a 400-row batch over one bad object.
    }
  }
  return copied;
}

export interface QuarantineBatchResult {
  quarantined: string[];
  skippedAlreadyClaimed: string[];
  skippedAlreadyQuarantined: string[];
  imagesSnapshotted: number;
}

/** Apply the quarantine to every candidate id, one at a time (re-checking
 *  `vendor_account_id` fresh on each so a claim landing mid-batch is still
 *  respected). Idempotent: re-running with the same ids only touches rows
 *  that are still eligible. Records ONE audit_log entry for the whole batch
 *  (rather than one per row) so the incident reads as a single reviewable
 *  event; the full id list lives in the entry's `after` payload. */
export async function quarantineListings(
  ids: string[],
  actorUserId: number,
  reason: string,
): Promise<QuarantineBatchResult> {
  const result: QuarantineBatchResult = {
    quarantined: [],
    skippedAlreadyClaimed: [],
    skippedAlreadyQuarantined: [],
    imagesSnapshotted: 0,
  };

  for (const id of ids) {
    const fresh = getListingById(id);
    if (!fresh) continue;
    if (fresh.vendor_account_id !== null) {
      result.skippedAlreadyClaimed.push(id);
      continue;
    }
    if (fresh.quarantined_at !== null) {
      result.skippedAlreadyQuarantined.push(id);
      continue;
    }

    result.imagesSnapshotted += await snapshotListingImages(id);

    const ts = now();
    if (fresh.source === "curated") {
      setCuratedOverride(id, "hidden", actorUserId, reason);
    }
    const photoUrls = (
      db.prepare("SELECT url FROM listing_photos WHERE listing_id = ?").all(id) as {
        url: string;
      }[]
    ).map((p) => p.url);
    db.prepare(
      `UPDATE listings
          SET status = 'hidden', quarantined_at = ?, quarantine_reason = ?, updated_at = ?,
              pre_quarantine_hero_url = ?, pre_quarantine_photo_urls = ?
        WHERE id = ?`,
    ).run(ts, reason, ts, fresh.hero_image_url, JSON.stringify(photoUrls), id);
    result.quarantined.push(id);
  }

  addAuditLog({
    actor_user_id: actorUserId,
    couple_id: null,
    action: "supplier.quarantine_batch",
    target_kind: "listing",
    target_id: null,
    after: {
      reason,
      quarantined_count: result.quarantined.length,
      quarantined_ids: result.quarantined,
      skipped_already_claimed: result.skippedAlreadyClaimed,
      skipped_already_quarantined: result.skippedAlreadyQuarantined,
      images_snapshotted: result.imagesSnapshotted,
    },
  });

  return result;
}

export interface PublishGateResult {
  ok: boolean;
  reason?: "not_quarantined" | "no_new_image" | "not_claimed";
}

/** Whether every image currently on a quarantined listing is one the vendor
 *  put there themselves — the "new authorised original" directive #7
 *  requires before any image can go public again. A listing with zero images
 *  (hero null, no gallery rows) also clears this: a vendor publishing
 *  text-only content has nothing with disputed provenance left to replace.
 *
 *  Compares against the `pre_quarantine_hero_url` / `pre_quarantine_photo_urls`
 *  snapshot taken at quarantine time rather than timestamps, because a
 *  listing's `updated_at` bumps on any edit (a blurb tweak), not just an
 *  image replacement — the snapshot is precise where a timestamp would false-
 *  positive. Both upload paths mint a brand-new URL on every real upload
 *  (see the db.ts comment on these two columns), so a straight string/set
 *  comparison is exact: it can't be fooled by a vendor deleting an old photo
 *  and re-adding a different old one, and it doesn't care how many rows
 *  changed, only whether any pre-quarantine URL survives. */
function hasOnlyVendorSuppliedImagery(listingId: string): boolean {
  const row = db
    .prepare(
      "SELECT hero_image_url, pre_quarantine_hero_url, pre_quarantine_photo_urls FROM listings WHERE id = ?",
    )
    .get(listingId) as
    | {
        hero_image_url: string | null;
        pre_quarantine_hero_url: string | null;
        pre_quarantine_photo_urls: string | null;
      }
    | undefined;
  if (!row) return false;
  if (row.hero_image_url && row.hero_image_url === row.pre_quarantine_hero_url) return false;

  const preQuarantineUrls = new Set<string>(
    row.pre_quarantine_photo_urls ? (JSON.parse(row.pre_quarantine_photo_urls) as string[]) : [],
  );
  if (preQuarantineUrls.size === 0) return true;
  const currentUrls = db
    .prepare("SELECT url FROM listing_photos WHERE listing_id = ?")
    .all(listingId) as { url: string }[];
  return currentUrls.every((p) => !preQuarantineUrls.has(p.url));
}

/** Whether the caller's account holds a verified claim on this listing —
 *  belt-and-suspenders alongside the `vendor_account_id` check, since that
 *  column is set atomically with the claim in `routes/vendor_claim.ts`. */
function hasVerifiedClaim(listingId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM listing_claims
        WHERE listing_id = ? AND status = 'verified' AND verified_at IS NOT NULL
        LIMIT 1`,
    )
    .get(listingId);
  return row !== undefined;
}

/** Server-side gate for the vendor's "publish" action on a quarantined
 *  listing (routes/vendor_listing.ts). Requires: the listing is actually
 *  under review, the caller's account holds a verified claim on it, and every
 *  image currently attached postdates that claim (i.e. is vendor-supplied). */
export function canPublishQuarantinedListing(
  listing: Listing,
  vendorAccountId: number,
): PublishGateResult {
  if (!isUnderQuarantineReview(listing)) return { ok: false, reason: "not_quarantined" };
  if (listing.vendor_account_id !== vendorAccountId || !hasVerifiedClaim(listing.id)) {
    return { ok: false, reason: "not_claimed" };
  }
  if (!hasOnlyVendorSuppliedImagery(listing.id)) return { ok: false, reason: "no_new_image" };
  return { ok: true };
}

/** The gated release itself. Caller (routes/vendor_listing.ts) must have
 *  already checked `canPublishQuarantinedListing`. Clears the curated
 *  override and restores `status = 'active'` — after this, the ordinary
 *  visibility toggle governs the listing exactly like any other claimed one.
 *  `quarantined_at` is deliberately NOT cleared: it's the permanent record
 *  that this row was once quarantined and why. */
export function publishQuarantinedListing(listing: Listing, actorUserId: number): void {
  const ts = now();
  if (listing.source === "curated") {
    clearCuratedOverride(listing.id);
  }
  db.prepare(
    `UPDATE listings
        SET status = 'active', image_rights_confirmed_at = ?, vendor_published_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(ts, ts, ts, listing.id);
  addAuditLog({
    actor_user_id: actorUserId,
    couple_id: null,
    action: "vendor.listing_quarantine_published",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: listing.id, quarantine_reason: listing.quarantine_reason },
    after: { image_rights_confirmed_at: ts, vendor_published_at: ts },
  });
}

// ── Private preview for the claiming vendor ─────────────────────────────────
//
// The pre-existing `/uploads/listings/<id>/...` static route (server.ts,
// `publicUploadKey`) is genuinely public once found — it has no per-viewer
// check, only "does an active/eligible row exist". Reusing it for a
// quarantined listing would let anyone who has (or guesses) the URL fetch the
// disputed image directly, which is exactly the "direct URL" exposure
// directive #1 asks to close. So the claiming vendor's private review goes
// through a SEPARATE, authenticated route instead (routes/vendor_listing.ts),
// which resolves ownership first and only then streams bytes — never through
// the public static handler. It serves the `quarantine-evidence/` copies
// taken at quarantine time, not the live keys, so what the vendor reviews is
// unambiguously the original, even if they've already uploaded a replacement.

export interface QuarantinePreview {
  heroEvidenceKey: string | null;
  galleryEvidenceKeys: string[];
}

function evidenceKeyFor(listingId: string, uploadUrl: string): string | null {
  const key = keyFromUploadUrl(uploadUrl);
  const filename = key?.split("/").pop();
  return filename ? `quarantine-evidence/${listingId}/${filename}` : null;
}

/** The evidence-storage keys for a quarantined listing's original imagery, in
 *  the order they were on the listing at quarantine time. Empty result when
 *  the listing was never quarantined or carried no imagery. */
export function getQuarantinePreview(listingId: string): QuarantinePreview {
  const row = db
    .prepare("SELECT pre_quarantine_hero_url, pre_quarantine_photo_urls FROM listings WHERE id = ?")
    .get(listingId) as
    | { pre_quarantine_hero_url: string | null; pre_quarantine_photo_urls: string | null }
    | undefined;
  const heroEvidenceKey = row?.pre_quarantine_hero_url
    ? evidenceKeyFor(listingId, row.pre_quarantine_hero_url)
    : null;
  const photoUrls: string[] = row?.pre_quarantine_photo_urls
    ? (JSON.parse(row.pre_quarantine_photo_urls) as string[])
    : [];
  const galleryEvidenceKeys = photoUrls
    .map((u) => evidenceKeyFor(listingId, u))
    .filter((k): k is string => k !== null);
  return { heroEvidenceKey, galleryEvidenceKeys };
}
