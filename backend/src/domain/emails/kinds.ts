// Catalogue of every email Weddly sends. One enum, one source of truth for
// category (transactional vs lifecycle) and copy. Add a new kind here, then a
// builder in `templates.ts`, then call `sendKind()` from your route.

export type EmailKind =
  | "welcome_verify" // signup welcome + verify-email CTA, single send
  | "verify_resend" // user clicked "resend verification" in dashboard
  | "password_reset"
  | "partner_invite" // partner-B co-pilot invite link
  | "couple_paused" // workspace paused → 30-day delete countdown started
  | "account_purged" // 30-day window elapsed, all couple data deleted
  | "rsvp_received_for_couple" // couple gets a notification when a guest RSVPs
  | "rsvp_thanks_for_guest" // guest gets a thank-you confirmation
  | "onboarding_nudge" // 24h after signup if they haven't onboarded a couple
  | "milestone_t90" // 90 days before the wedding
  | "milestone_t30" // 30 days before
  | "milestone_t7" // 7 days before
  | "wedding_today"; // morning-of congratulations

export type EmailCategory = "transactional" | "lifecycle";

/**
 * Transactional = the user explicitly triggered the action and is waiting on
 * the email (signup, password reset, RSVP). Cannot be turned off.
 *
 * Lifecycle = system-initiated reminders. The user can opt out via the
 * unsubscribe footer link.
 */
export const KIND_CATEGORY: Record<EmailKind, EmailCategory> = {
  welcome_verify: "transactional",
  verify_resend: "transactional",
  password_reset: "transactional",
  partner_invite: "transactional",
  couple_paused: "transactional",
  account_purged: "transactional",
  rsvp_received_for_couple: "transactional",
  rsvp_thanks_for_guest: "transactional",
  onboarding_nudge: "lifecycle",
  milestone_t90: "lifecycle",
  milestone_t30: "lifecycle",
  milestone_t7: "lifecycle",
  wedding_today: "lifecycle",
};
