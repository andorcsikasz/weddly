// The vendor's printable review QR code (/vendor/reviews). One Hovercode
// dynamic code per listing, created only when the vendor asks (each code counts
// toward the Hovercode plan). The printed code encodes a Hovercode short link
// that lands on the vendor's public page with the review composer open, the same
// `?review=1` link the share sheet and the review campaign hand out. A listing
// rename changes the pretty URL, so every read re-points the code if the target
// drifted. The listing always comes from the session, never from the request.

import type { VendorReviewQrView } from "@shared/vendor_review_qr";
import { vendorPublicId } from "@shared/vendor_slug";
import { CONFIG } from "../config";
import { db, now } from "../db";
import {
  createDynamicQr,
  HovercodeError,
  hovercodeConfigured,
  qrDownloads,
  qrScans,
  retargetQr,
} from "../lib/hovercode";
import { HttpError } from "../lib/http";
import { log } from "../lib/logger";
import { getListingByVendorAccountId } from "./listings";

interface ReviewQrRow {
  listing_id: string;
  qr_id: string;
  shortlink_url: string;
  target_url: string;
}

/** Where the printed code should land: the public page, composer open. */
export function reviewQrTarget(listing: { id: string; name: string }): string {
  return `${CONFIG.frontendBaseUrl}/suppliers/${vendorPublicId(listing.id, listing.name)}?review=1`;
}

function readRow(listingId: string): ReviewQrRow | null {
  return (
    (db
      .prepare(
        "SELECT listing_id, qr_id, shortlink_url, target_url FROM listing_review_qr WHERE listing_id = ?",
      )
      .get(listingId) as ReviewQrRow | undefined) ?? null
  );
}

function unavailable(): never {
  throw new HttpError(503, "Review QR codes are not configured", {
    code: "review_qr_unavailable",
  });
}

/** A Hovercode failure as something the vendor can act on. */
function upstream(e: unknown): never {
  if (e instanceof HovercodeError || (e instanceof Error && e.name === "TimeoutError")) {
    throw new HttpError(502, "The QR code service did not answer", { code: "review_qr_upstream" });
  }
  throw e;
}

/** Re-point the code when the listing's URL moved. Best effort: a failure
 *  leaves the old target, which still resolves, and the next read retries. */
async function keepPointed(row: ReviewQrRow, target: string): Promise<ReviewQrRow> {
  if (row.target_url === target) return row;
  try {
    await retargetQr(row.qr_id, target);
  } catch (e) {
    log.warn("review_qr.retarget_failed", { listingId: row.listing_id, error: String(e) });
    return row;
  }
  db.prepare(
    "UPDATE listing_review_qr SET target_url = ?, updated_at = ? WHERE listing_id = ?",
  ).run(target, now(), row.listing_id);
  return { ...row, target_url: target };
}

export async function getVendorReviewQr(vendorAccountId: number): Promise<VendorReviewQrView> {
  const available = hovercodeConfigured();
  const listing = getListingByVendorAccountId(vendorAccountId);
  const stored = listing ? readRow(listing.id) : null;
  if (!listing || !stored) return { available, qr: null };
  if (!available) {
    return {
      available,
      qr: { shortlink_url: stored.shortlink_url, target_url: stored.target_url, scans_30d: null },
    };
  }
  const row = await keepPointed(stored, reviewQrTarget(listing));
  const scans = await qrScans(row.qr_id, 30).catch(() => null);
  return {
    available,
    qr: { shortlink_url: row.shortlink_url, target_url: row.target_url, scans_30d: scans },
  };
}

// A double tap must make one code, not two (each one is billed). SQLite gives
// no row lock across the network call, so in-flight creates are shared here.
const creating = new Map<string, Promise<void>>();

export async function createVendorReviewQr(vendorAccountId: number): Promise<VendorReviewQrView> {
  if (!hovercodeConfigured()) unavailable();
  const listing = getListingByVendorAccountId(vendorAccountId);
  if (!listing) throw new HttpError(404, "No listing yet", { code: "listing_missing" });
  if (!readRow(listing.id)) {
    let job = creating.get(listing.id);
    if (!job) {
      job = (async () => {
        const target = reviewQrTarget(listing);
        const qr = await createDynamicQr({ url: target, name: `${listing.name} · Weddly reviews` });
        const at = now();
        db.prepare(
          `INSERT INTO listing_review_qr (listing_id, qr_id, shortlink_url, target_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(listing_id) DO NOTHING`,
        ).run(listing.id, qr.id, qr.shortlinkUrl, target, at, at);
      })().finally(() => creating.delete(listing.id));
      creating.set(listing.id, job);
    }
    await job.catch(upstream);
  }
  return getVendorReviewQr(vendorAccountId);
}

/** The short link the vendor's printed code encodes (drawn locally as SVG). */
export function vendorReviewQrShortlink(vendorAccountId: number): string | null {
  const listing = getListingByVendorAccountId(vendorAccountId);
  return listing ? (readRow(listing.id)?.shortlink_url ?? null) : null;
}

/** Hovercode's print-ready file for the vendor's code. */
export async function vendorReviewQrDownload(
  vendorAccountId: number,
  format: "png" | "svg",
): Promise<string> {
  if (!hovercodeConfigured()) unavailable();
  const listing = getListingByVendorAccountId(vendorAccountId);
  const row = listing ? readRow(listing.id) : null;
  if (!row) throw new HttpError(404, "No review QR code yet", { code: "review_qr_missing" });
  const files = await qrDownloads(row.qr_id).catch(upstream);
  return files[format];
}
