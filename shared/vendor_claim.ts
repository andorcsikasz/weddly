// Vendor listing-claim contract. Consumed by /vendor/claim/* routes and the
// frontend claim-modal + verify-and-complete page. The claim flow is the
// only consumer of the P2.A `vendor_accounts` + `listings.vendor_account_id`
// schema in this milestone — see [[feedback_multi_agent_debate]] (path E).

import type { VendorOffer } from "./vendor_billing";

export type ListingClaimStatus = "pending" | "verified" | "expired" | "cancelled";

export interface ListingClaim {
  id: number;
  listing_id: string;
  /** Address the verification mail was sent to — mirrors the listing's
   *  contact_email at issue time so a later edit doesn't invalidate the
   *  in-flight token. */
  email_sent_to: string;
  /** Address the claimer typed into the modal — who is requesting the
   *  takeover. Surfaced to admins in the heads-up mail. Distinct from
   *  `email_sent_to`; null on legacy rows. */
  claimant_email: string | null;
  status: ListingClaimStatus;
  expires_at: number;
  verified_at: number | null;
  /** Set on consume — the vendor_account this claim materialised. */
  vendor_account_id: number | null;
  created_at: number;
}

/** Public payload returned by GET /api/vendor/claim/verify/:token — what the
 *  verify-and-complete page renders BEFORE the password form is submitted.
 *  Email is included so the vendor can confirm "yes, that's my inbox."
 *  Status drives the page state machine (active form vs "expired" notice
 *  vs "already claimed" notice). */
export interface ClaimVerifyView {
  listing_id: string;
  listing_name: string;
  /** Echoed back so the page can show "we verified your access to
   *  studio@example.com" without leaking the address again via email. */
  email: string;
  /** Directory category of the listing being claimed. The page repeats it back
   *  ("Fotós · Budapest") so the vendor recognises their own entry before
   *  handing over a password. */
  category: string;
  city: string;
  status: ListingClaimStatus;
  expires_at: number;
  /** Free window this claim would grant on completion, resolved at read time.
   *  Lets the page make the same promise the invite email made instead of
   *  hardcoding "one year" after the founding cohort has filled up. */
  offer: VendorOffer;
  /** Set when the listing's category can never become a vendor account
   *  (`"planner"` today). The page renders the "sign up as a planner instead"
   *  panel; completing the claim would 409 anyway. */
  blocked: "planner" | null;
}

/** POST /api/vendor/claim/start — anonymous, body shape. */
export interface StartClaimInput {
  listing_id: string;
  /** The claimer's own email, typed into the modal. We notify admins with
   *  this address the moment a claim starts so a human can keep tabs on who's
   *  asking — it does NOT replace `email_sent_to` (the verification link still
   *  goes to the listing's contact_email, which is what proves ownership). */
  claimant_email: string;
}

/** POST /api/vendor/claim/complete — completes the verify step + sets the
 *  vendor's password. Server transactionally creates users(role='vendor')
 *  + vendor_accounts + flips listings.vendor_account_id, then issues a
 *  session token in the response. */
export interface CompleteClaimInput {
  token: string;
  password: string;
  full_name: string;
}

/** Claim verification window. Email inboxes for vendors are often shared
 *  business accounts that are checked weekly — match the
 *  community_supplier_verifications 7-day TTL so the friction is the same. */
export const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
