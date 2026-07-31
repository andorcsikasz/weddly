// A wishlist thumbnail has to be OUR bytes, not a hotlink to the shop.
//
// The link unfurler (lib/link_preview) resolves a product page's og:image, and
// for a long time we stored that remote URL straight into
// `wishlist_items.image_url` and rendered it as `<img src>`. The browser never
// loaded it: our CSP `img-src` is an allow-list of a handful of fixed origins
// ('self', the map tiles, Wikimedia, …), so ikea.com / an Apple CDN / any other
// storefront is blocked and the card paints the broken-image glyph. The couple
// sees a wishlist of grey squares and reads it as "the upload is broken".
//
// So every image is downloaded once and re-hosted under our own /uploads key,
// exactly like a supplier listing's hero (domain/listing_image_backfill) and
// the curated galleries (domain/listing_gallery_backfill). Rules:
//
//  - The key is COUPLE-SCOPED (`couples/<id>/wishlist/<hash>.<ext>`) so a couple
//    purge's `storage.deletePrefix('couples/<id>/')` takes the thumbnails with
//    it. The hash is of the source URL, so re-saving the same item overwrites
//    its own file instead of growing a new one per save.
//  - A failure resolves to NULL, never to the remote URL. Null draws the
//    GiftArt motif, which is the designed fallback and looks deliberate; a
//    remote URL draws the broken glyph.
//  - An input that is already ours (`/uploads/...`) passes straight through, so
//    a save that carries an unchanged image costs no fetch.

import { createHash } from "node:crypto";
import { now } from "../db";
import { fetchLinkPreview } from "../lib/link_preview";
import { log } from "../lib/logger";
import { fetchRemoteImage } from "../lib/remote_image";
import { keyFromUploadUrl, storage } from "../lib/storage";

/** Injection seam for tests: the real downloader hits the network behind the
 *  SSRF guard, which no unit test should depend on. */
export type ImageFetcher = typeof fetchRemoteImage;

export interface LocalizeOpts {
  fetchImage?: ImageFetcher;
}

/** True for a value we already serve ourselves. */
export function isLocalUploadUrl(value: string): boolean {
  return value.startsWith("/uploads/");
}

/** `couples/<id>/wishlist/<16 hex of the source URL>.<ext>`. Deterministic, so
 *  the same product image mirrored twice lands on one object. */
export function wishlistImageKey(coupleId: number, sourceUrl: string, ext: string): string {
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  return `couples/${coupleId}/wishlist/${hash}.${ext}`;
}

/** Download `sourceUrl` and re-host it, returning the public `/uploads/...`
 *  URL — or null when there is nothing usable to show. Never throws: this sits
 *  on the create/update path and a dead thumbnail must not fail a save. */
export async function localizeWishlistImage(
  coupleId: number,
  sourceUrl: string | null | undefined,
  opts: LocalizeOpts = {},
): Promise<string | null> {
  const trimmed = (sourceUrl ?? "").trim();
  if (!trimmed) return null;

  // Already ours: keep it as-is (an unchanged row, or the editor echoing back a
  // preview we mirrored a moment ago). Still run it through the key guard so a
  // hand-crafted `/uploads/../…` can't be stored.
  if (isLocalUploadUrl(trimmed)) return keyFromUploadUrl(trimmed) ? trimmed : null;

  const fetchImage = opts.fetchImage ?? fetchRemoteImage;
  const img = await fetchImage(trimmed);
  if (!img) return null;

  const key = wishlistImageKey(coupleId, trimmed, img.ext);
  try {
    await storage.write(key, img.bytes);
  } catch (err) {
    // Our side, probably transient. Null keeps the card on its motif; the next
    // save re-attempts.
    log.warn("wishlist.image_mirror.store_failed", { coupleId, error: String(err) });
    return null;
  }
  // `?v=` busts the 30-day upload cache when a shop swaps the photo behind an
  // unchanged URL (the key would otherwise be identical).
  return `/uploads/${key}?v=${now()}`;
}

/** Resolve a product page's og:image and re-host it in one step. The single
 *  path both the routes and the boot backfill take from "the couple pasted a
 *  link" to "we have a thumbnail we can actually render". */
export async function resolveWishlistImageFromLink(
  coupleId: number,
  pageUrl: string,
  opts: LocalizeOpts = {},
): Promise<string | null> {
  const preview = await fetchLinkPreview(pageUrl);
  return localizeWishlistImage(coupleId, preview.image_url, opts);
}
