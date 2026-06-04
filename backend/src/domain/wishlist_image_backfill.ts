// One-time boot sweep that fills in missing wishlist thumbnails. The
// link-preview feature (lib/link_preview) resolves an og:image on create/edit,
// but rows created before it shipped — or before the image_checked_at column
// existed — have a link and no thumbnail and would never get one. This sweep
// finds those legacy rows (url set, image_url null, image_checked_at null) and
// resolves each once.
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

import { applyBackfilledImage, listWishlistRowsNeedingImageBackfill } from "./wishlist";
import { fetchLinkPreview } from "../lib/link_preview";
import { log } from "../lib/logger";

// Generous ceiling — the wishlist feature is days old, so the real legacy set
// is tiny. The cap just stops a pathological DB from spinning the worker.
const MAX_ROWS = 1000;
// How many outbound link fetches to run at once. fetchLinkPreview times out at
// 5s, so a handful in flight keeps the sweep quick without a thundering herd.
const CONCURRENCY = 4;

/** Resolve + persist the og:image for one legacy row. Never throws — a miss
 *  still stamps image_checked_at so the row drops out of the backfill set. */
async function backfillOne(id: number, url: string): Promise<boolean> {
  let imageUrl: string | null = null;
  try {
    imageUrl = (await fetchLinkPreview(url)).image_url;
  } catch {
    // fetchLinkPreview is soft by contract; this catch is belt-and-braces.
    imageUrl = null;
  }
  applyBackfilledImage(id, imageUrl);
  return imageUrl !== null;
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
      if (await backfillOne(row.id, row.url)) resolved++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

  log.info("wishlist.image_backfill.done", { attempted: rows.length, resolved });
}

/** Fire-and-forget entry point for boot. Swallows any error so a backfill
 *  hiccup never takes down the server. */
export function startWishlistImageBackfill(): void {
  void runWishlistImageBackfill().catch((err) => {
    log.warn("wishlist.image_backfill.failed", { error: String(err) });
  });
}
