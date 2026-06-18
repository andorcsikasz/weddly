// Policy version stamps for the GDPR consent ledger. Bump the matching
// constant any time the corresponding policy page's user-visible content
// changes — the new version is stored on every fresh acceptance, so we
// can prove which exact text a given user clicked through.
//
// Date-based versions (YYYY-MM-DD) read clearly to a human and sort
// correctly as plain strings. Same string is rendered as the "Verzió:"
// eyebrow on Privacy/Terms so end users can see what they accepted.

export const PRIVACY_VERSION = "2026-06-13";
export const TERMS_VERSION = "2026-05-18";

/** Standalone notice on the vendor waitlist form covering the free-beta /
 *  future-paid-tier disclosure. Bumped separately from the privacy/terms
 *  documents because the wording on /vendors changes independently. */
export const VENDOR_BETA_NOTICE_VERSION = "2026-05-18";

/** Disclosure on the planner waitlist form — bumped separately from the
 *  privacy/terms docs because /planners copy evolves independently. */
export const PLANNER_WAITLIST_NOTICE_VERSION = "2026-06-18";

/** Discriminator string stored in `user_consents.document`. Matches the
 *  union the backend recognises. */
export type LegalDocument = "privacy" | "terms" | "vendor_beta_notice";
