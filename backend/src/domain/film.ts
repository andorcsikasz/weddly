// Film-domain helpers shared between photos routes and the billing webhook.

import { FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "@shared/types";
import { db, now } from "../db";

/** What a film has been paid so far, EUR cents. Films paid before the tiered
 *  ladder carry no amount; they bought the single €7.90 unlock. */
export function filmPaidCents(row: {
  paid_amount_cents?: number | null;
  paid_at: number | null;
}): number {
  if (typeof row.paid_amount_cents === "number") return row.paid_amount_cents;
  return row.paid_at !== null ? FILM_TIER_PRICE_EUR_CENTS.paid : 0;
}

export interface FilmPayment {
  /** Checkout session id: the idempotency key for a redelivered webhook. */
  sessionId: string | null;
  /** Tier bought. Absent on sessions created before the tiered ladder. */
  cap: number | null;
  /** Amount charged by this session, EUR cents. */
  amountCents: number | null;
}

/** Apply a paid film Checkout: raise the cap to the tier bought and add the
 *  charge to what the film has been paid. Called by the billing webhook on
 *  `checkout.session.completed` with metadata.type='film'.
 *
 *  Idempotent per session: Stripe redelivers events, and a second delivery of
 *  the same session must not credit the same payment twice. A cap never goes
 *  DOWN here, so an out-of-order older session cannot shrink a film.
 *  Returns false when the session had already been applied. */
export function activateFilmAlbum(
  albumId: number,
  stripePaymentId: string | null,
  payment: FilmPayment = { sessionId: null, cap: null, amountCents: null },
): boolean {
  return db.transaction((): boolean => {
    const row = db
      .prepare(
        "SELECT guest_cap, paid_at, paid_amount_cents, stripe_session_id FROM photo_albums WHERE id = ?",
      )
      .get(albumId) as
      | {
          guest_cap: number;
          paid_at: number | null;
          paid_amount_cents: number | null;
          stripe_session_id: string | null;
        }
      | undefined;
    if (!row) return false;
    if (payment.sessionId !== null && row.stripe_session_id === payment.sessionId) return false;

    // Legacy sessions (no cap in the metadata) bought the single 200-guest unlock.
    const cap = payment.cap ?? FILM_TIER_CAPS.paid;
    const amount = payment.amountCents ?? FILM_TIER_PRICE_EUR_CENTS.paid;
    db.prepare(
      `UPDATE photo_albums
          SET paid_at = ?, guest_cap = MAX(guest_cap, ?), paid_amount_cents = ?,
              stripe_payment_id = ?, stripe_session_id = ?, stripe_tier = 'paid'
        WHERE id = ?`,
    ).run(
      now(),
      cap,
      filmPaidCents(row) + amount,
      stripePaymentId ?? null,
      payment.sessionId,
      albumId,
    );
    return true;
  })();
}
