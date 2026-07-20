// Vendor onboarding token contract — the bridge from an accepted waitlist entry
// to a real vendor account. The admin accepting a waitlist row mints a token;
// the accept email carries /vendor/activate/:token. The vendor clicks, sets a
// password, and the token is consumed to create the account + a session
// (mirrors the listing-claim flow, but a waitlist vendor has no listing to
// claim). No card is asked: the founding 100 are free for a year, and the next
// 300 get three months (see `vendorOfferForSlots`).

import type { VendorOffer } from "./vendor_billing";

export type VendorOnboardingStatus = "pending" | "completed" | "expired" | "cancelled";

/** Token lifetime. Generous on purpose: a busy vendor may click the accept
 *  email days later, and we'd rather they still land in the builder than hit a
 *  dead link. Re-issuable by the admin regardless. */
export const VENDOR_ONBOARDING_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/** Read-only view returned by verify/:token — prefills the activate form and
 *  shows the founding scarcity line ("#N of 100"). Does not consume the token. */
export interface VendorOnboardingVerifyView {
  business_name: string;
  email: string;
  category: string | null;
  status: VendorOnboardingStatus;
  expires_at: number;
  /** Remaining founding slots, for the honest "N of 100 spots left" line. */
  founding_spots_left: number;
  founding_cap: number;
  /** The free window this activation would actually grant. Once the founding
   *  100 are gone `founding_spots_left` is 0 but the offer is still real (the
   *  three-month early cohort), so the page reads THIS, not the counter. */
  offer: VendorOffer;
}

/** Body of POST /api/vendor/onboard/complete — set the password + name and (on
 *  the vendor's own device) pin their locale so currency follows it. */
export interface CompleteVendorOnboardingInput {
  token: string;
  password: string;
  full_name: string;
  /** 'hu' | 'en' from the activating browser. Falls back to the token's stored
   *  locale, then EUR, when absent. */
  locale?: string;
}
