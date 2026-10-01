// Weddly Camera (wedding film) pricing: the ONE ladder both the public /camera
// page and the checkout read, so the price a visitor is quoted is the price
// Stripe is asked for. Euro only, in cents, one-time per wedding.
//
// Two audiences pay off the same ladder:
//   - `couple`: a Weddly workspace. Up to `FILM_TIER_CAPS.free` guests is
//     included in the subscription, the €7.90 unlock covers up to 100, and
//     above that a couple pays half the stand-alone price (owner call
//     2026-10-01: at 175 guests Weddly is 50% off, and so on up).
//   - `standalone`: a camera-only account (`users.camera_only`), someone who
//     came for the camera and not for the planner. Nothing is included.
//
// Upgrades are charged as the DIFFERENCE between the target tier and what the
// film has already been paid (`photo_albums.paid_amount_cents`), so moving
// 100 → 250 never charges the first €7.90 twice.

import { FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "./types";

export type FilmAudience = "couple" | "standalone";

export interface FilmPriceTier {
  /** Most guests (devices) the film accepts at this tier. */
  cap: number;
  /** Stand-alone (non-Weddly) price, EUR cents. */
  standaloneCents: number;
}

/** Ascending. Anchored to the owner's 10@50 / 25@100 pricing, extrapolated
 *  along pov.camera's published ladder. */
export const FILM_PRICE_TIERS: readonly FilmPriceTier[] = [
  { cap: 25, standaloneCents: 499 },
  { cap: 50, standaloneCents: 999 },
  { cap: 100, standaloneCents: 2499 },
  { cap: 175, standaloneCents: 4499 },
  { cap: 250, standaloneCents: 6999 },
  { cap: 400, standaloneCents: 9999 },
];

/** Above this many guests a Weddly couple pays half the stand-alone price. */
export const FILM_HALF_PRICE_FROM_CAP = 100;

/** Largest film the checkout sells; past it the page says "ask for a quote". */
export const FILM_MAX_CAP = FILM_PRICE_TIERS[FILM_PRICE_TIERS.length - 1]?.cap ?? 400;

export function filmTier(cap: number): FilmPriceTier | null {
  return FILM_PRICE_TIERS.find((t) => t.cap === cap) ?? null;
}

/** Full price of a tier for an audience, EUR cents. */
export function filmTierPriceCents(tier: FilmPriceTier, audience: FilmAudience): number {
  if (audience === "standalone") return tier.standaloneCents;
  if (tier.cap <= FILM_TIER_CAPS.free) return 0;
  if (tier.cap <= FILM_HALF_PRICE_FROM_CAP) return FILM_TIER_PRICE_EUR_CENTS.paid;
  // Half, rounded to the 10 cents so a price never ends in an odd cent.
  return Math.round(tier.standaloneCents / 20) * 10;
}

/** What upgrading to `tier` costs now, given what the film has been paid so
 *  far. Never negative. */
export function filmUpgradeChargeCents(
  tier: FilmPriceTier,
  audience: FilmAudience,
  alreadyPaidCents: number,
): number {
  return Math.max(0, filmTierPriceCents(tier, audience) - Math.max(0, alreadyPaidCents));
}

/** "€22.50" — the page and the app render money the same way. */
export function formatEurCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
