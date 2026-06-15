// Film-domain helpers shared between photos routes and the billing webhook.

import { FILM_TIER_CAPS } from "@shared/types";
import { db, now } from "../db";

/** Mark an album as paid: bump the cap, record payment info. Called by the
 *  billing webhook on `checkout.session.completed` with metadata.type='film'. */
export function activateFilmAlbum(albumId: number, stripePaymentId: string | null): void {
  db.prepare(
    `UPDATE photo_albums
        SET paid_at = ?, guest_cap = ?, stripe_payment_id = ?, stripe_tier = 'paid'
      WHERE id = ?`,
  ).run(now(), FILM_TIER_CAPS.twohundred, stripePaymentId ?? null, albumId);
}
