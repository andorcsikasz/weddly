// Boot sweeps that give every wishlist row a thumbnail the browser will
// actually render. Two shapes of legacy row, one pass each:
//
//  1. NO IMAGE. The link-preview feature (lib/link_preview) resolves an
//     og:image on create/edit, but rows created before it shipped — or before
//     the image_checked_at column existed — have a link and no thumbnail and
//     would never get one. Found by (url set, image_url null,
//     image_checked_at null) and resolved once each.
//  2. A REMOTE image. Rows written before we mirrored images locally hold the
//     shop's own CDN URL, which our CSP img-src refuses to load: the card
//     paints the broken-image glyph forever. Each is re-hosted under our
//     /uploads key, and a download we can't complete clears the column so the
//     card falls back to its drawn motif instead of a broken tile.
//
// Design notes:
//  - Non-blocking: server.ts fires this AFTER Bun.serve() is listening, never
//    awaiting it, so a slow remote site can't delay readiness.
//  - One attempt per row: applyBackfilledImage stamps image_checked_at whether
//    or not an image came back, so a dead/blocked link is tried exactly once
//    and never re-hammered on the next deploy. A couple can still force a retry
//    by re-saving the item (routes/wishlist re-resolves when the image is
//    missing).
//  - Bounded fan-out: we process in small concurrent batches so a burst of
//    legacy rows doesn't open dozens of simultaneous outbound fetches.

import {
  applyBackfilledImage,
  listWishlistRowsNeedingImageBackfill,
  listWishlistRowsWithRemoteImage,
} from "./wishlist";
import {
  localizeWishlistImage,
  NO_PICTURE,
  type ResolvedWishlistPicture,
  resolveWishlistPictureFromLink,
} from "./wishlist_image";
import { normalizeImageKind } from "./wishlist";
import { log } from "../lib/logger";

// Generous ceiling — the wishlist feature is days old, so the real legacy set
// is tiny. The cap just stops a pathological DB from spinning the worker.
const MAX_ROWS = 1000;
// How many outbound link fetches to run at once. fetchLinkPreview times out at
// 5s, so a handful in flight keeps the sweep quick without a thundering herd.
const CONCURRENCY = 4;

/** Resolve + re-host + persist the og:image for one legacy row. Never throws —
 *  a miss still stamps image_checked_at so the row drops out of the set. */
async function backfillOne(coupleId: number, id: number, url: string): Promise<boolean> {
  let picture: ResolvedWishlistPicture = NO_PICTURE;
  try {
    picture = await resolveWishlistPictureFromLink(coupleId, url);
  } catch {
    // Both halves are soft by contract; this catch is belt-and-braces.
    picture = NO_PICTURE;
  }
  applyBackfilledImage(id, picture.image_url, picture.image_kind);
  return picture.image_url !== null;
}

/** Sweep legacy wishlist rows missing a thumbnail and resolve each once. Safe
 *  to call on every boot: once stamped, rows never re-enter the set. */
export async function runWishlistImageBackfill(): Promise<void> {
  const rows = listWishlistRowsNeedingImageBackfill(MAX_ROWS);
  if (rows.length === 0) return;

  log.info("wishlist.image_backfill.start", { count: rows.length });
  let resolved = 0;

  // Drain the row list through a small pool of workers.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row?.url) continue;
      if (await backfillOne(row.couple_id, row.id, row.url)) resolved++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  log.info("wishlist.image_backfill.done", { attempted: rows.length, resolved });
}

/** Re-host every thumbnail still pointing at a remote host. A row leaves the
 *  set either way: mirrored on success, cleared on failure — a card with no
 *  image draws its motif, a card with an unloadable one draws a broken tile.
 *  Safe on every boot; after one pass nothing matches the query. */
export async function runWishlistImageRehost(): Promise<void> {
  const rows = listWishlistRowsWithRemoteImage(MAX_ROWS);
  if (rows.length === 0) return;

  log.info("wishlist.image_rehost.start", { count: rows.length });
  let rehosted = 0;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row?.image_url) continue;
      let local: string | null = null;
      try {
        local = await localizeWishlistImage(row.couple_id, row.image_url);
      } catch {
        local = null;
      }
      // Carry the row's own framing across: a re-host only changes WHERE the
      // bytes live, and dropping the kind would re-crop a logo to fill.
      applyBackfilledImage(row.id, local, normalizeImageKind(local, row.image_kind));
      if (local) rehosted++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  log.info("wishlist.image_rehost.done", { attempted: rows.length, rehosted });
}

/** Fire-and-forget entry point for boot. Swallows any error so a backfill
 *  hiccup never takes down the server. The rehost runs after the og:image
 *  sweep, which can itself only ever write local URLs — so the order costs
 *  nothing and keeps the two passes independent. */
export function startWishlistImageBackfill(): void {
  void runWishlistImageBackfill()
    .then(() => runWishlistImageRehost())
    .catch((err) => {
      log.warn("wishlist.image_backfill.failed", { error: String(err) });
    });
}
