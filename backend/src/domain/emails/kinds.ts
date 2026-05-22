// Catalogue of every email Weddly sends. One enum, one source of truth for
// category (transactional vs lifecycle) and copy. Add a new kind here, then a
// builder in `templates.ts`, then call `sendKind()` from your route.

export type EmailKind =
  | "welcome_verify" // signup welcome + verify-email CTA, single send
  | "verify_resend" // user clicked "resend verification" in dashboard
  | "password_reset"
  | "password_changed" // security confirmation after a successful reset / change
  | "new_device_signin" // sign-in from a device fingerprint we haven't seen before
  | "email_change_verify" // sent to the NEW address with a confirm link
  | "email_change_warning" // sent to the OLD address letting them know a change is in flight
  | "partner_invite" // partner-B co-pilot invite link
  | "partner_invite_accepted" // inviter gets a heads-up that partner B joined the workspace
  | "partner_invite_declined" // invitee clicked "no thanks" — inviter heads-up so they can re-send to a new address
  | "partner_left_workspace" // partner B left the workspace — owner heads-up
  | "couple_paused" // workspace paused → 30-day delete countdown started
  | "couple_pause_cancelled" // either partner cancelled the pause; both get a heads-up
  | "account_purged" // 30-day window elapsed, all couple data deleted
  | "account_admin_purged" // an admin immediately deleted the account (no 30-day grace)
  | "account_flagged" // admin flagged the account — 7-day window to reply or it gets purged
  | "account_flag_cleared" // admin resolved the flag — user is no longer under review
  | "rsvp_received_for_couple" // couple gets a notification when a guest RSVPs
  | "rsvp_received_household_for_couple" // aggregated notification: whole party RSVP'd in one go
  | "rsvp_thanks_for_guest" // guest gets a thank-you confirmation
  | "guest_invite" // sent to a guest with a one-click /rsvp/{code} link
  | "onboarding_nudge" // 24h after signup if they haven't onboarded a couple
  | "milestone_t90" // 90 days before the wedding
  | "milestone_t30" // 30 days before
  | "milestone_t7" // 7 days before
  | "wedding_today" // morning-of congratulations
  | "wedding_today_followup" // T+7 days — quick how-was-it / NPS nudge
  | "wedding_date_changed" // couple edited the wedding date, notify guests
  | "rsvp_deadline_approaching" // T-14 nudge listing how many guests haven't RSVPd yet
  | "rsvp_followup_missing_meal" // guest RSVP'd yes but skipped meal pick — one-shot nudge
  | "vendor_waitlist_received" // /vendors form submission → confirm we got it
  | "vendor_waitlist_decision" // admin-edited triage reply (accepted / under_review / rejected)
  | "community_supplier_verify" // sent to a community-submitted listing's contact_email to publish
  | "community_supplier_published" // admin approved the listing — it's now live
  | "community_supplier_rejected" // admin rejected a pending listing during moderation
  | "community_supplier_reported" // first user report on a live listing — heads-up to the contact
  | "vendor_claim_verify" // P2.C — sent to a listing's contact_email when someone clicks "this is mine"
  | "vendor_claim_approved" // sent to the new vendor account once the claim flow completes
  | "supplier_outreach"; // P2.E — couple-initiated cold outreach to a shortlisted vendor

export type EmailCategory = "transactional" | "lifecycle" | "outreach";

/**
 * Transactional = the user explicitly triggered the action and is waiting on
 * the email (signup, password reset, RSVP). Cannot be turned off.
 *
 * Lifecycle = system-initiated reminders. The user can opt out via the
 * unsubscribe footer link.
 *
 * Outreach = cold mail to a recipient who has no Weddly account and didn't
 * trigger anything themselves — a couple added them to the supplier directory,
 * or someone hit the public claim-start endpoint with their contact email.
 * Drives the footer copy ("you don't have an account, ignore = nothing
 * happens") so the recipient isn't told a false "this concerns your account".
 */
export const KIND_CATEGORY: Record<EmailKind, EmailCategory> = {
  welcome_verify: "transactional",
  verify_resend: "transactional",
  password_reset: "transactional",
  password_changed: "transactional",
  // Transactional: the user (or someone with their password) just signed in
  // — they're either expecting this mail or they need it RIGHT NOW. Either
  // way, never lifecycle.
  new_device_signin: "transactional",
  email_change_verify: "transactional",
  email_change_warning: "transactional",
  partner_invite: "transactional",
  // Transactional: the inviter clicked Invite Partner and is waiting to see
  // whether/when partner B joins — this is the resolution of that action.
  partner_invite_accepted: "transactional",
  // Transactional: same resolution arc as accept, just the other branch. The
  // inviter needs to know to either re-send to a different address or move
  // on.
  partner_invite_declined: "transactional",
  // Transactional: the owner had a partner in the workspace; that partner
  // self-unlinked via /api/users/me/leave-couple. Owner deserves to know.
  partner_left_workspace: "transactional",
  couple_paused: "transactional",
  // Transactional: the pause was an explicit action one partner took and
  // both received notification of; the cancel is the resolution of that
  // action and both partners deserve to know.
  couple_pause_cancelled: "transactional",
  account_purged: "transactional",
  account_admin_purged: "transactional",
  account_flagged: "transactional",
  // Transactional: the user got the original "you're under review" mail and
  // is implicitly waiting on either a reply window or a resolution — this
  // mail closes that loop.
  account_flag_cleared: "transactional",
  rsvp_received_for_couple: "transactional",
  rsvp_received_household_for_couple: "transactional",
  rsvp_thanks_for_guest: "transactional",
  // Transactional: the couple explicitly clicked "send invite" for this
  // guest in /app/guests — the recipient is waiting on the link.
  guest_invite: "transactional",
  onboarding_nudge: "lifecycle",
  milestone_t90: "lifecycle",
  milestone_t30: "lifecycle",
  milestone_t7: "lifecycle",
  wedding_today: "lifecycle",
  wedding_today_followup: "lifecycle",
  // Transactional: a guest explicitly opted into the wedding by RSVPing, and
  // the couple changing the date is an account-critical update for them.
  wedding_date_changed: "transactional",
  rsvp_deadline_approaching: "lifecycle",
  // Outreach: the guest has no Weddly account; they RSVP'd via the public
  // /rsvp/:code page. Outreach footer copy ("no account, ignore = nothing
  // happens") is the truthful framing.
  rsvp_followup_missing_meal: "outreach",
  // Outreach: vendor submitted the /vendors form but has no Weddly account —
  // the "fiókoddal kapcsolatban" footer line would be misleading.
  vendor_waitlist_received: "outreach",
  // Outreach: admin manually triages a vendor's own waitlist submission. The
  // vendor expects the reply but still has no Weddly account.
  vendor_waitlist_decision: "outreach",
  // Outreach: a couple added this business to the community directory; the
  // recipient never asked for anything and has no Weddly account.
  community_supplier_verify: "outreach",
  // Outreach: same recipient (no Weddly account) — the listing they
  // confirmed has now passed admin moderation and is publicly visible.
  community_supplier_published: "outreach",
  // Outreach: same recipient — moderation said no. Close the loop with a
  // reason instead of leaving the verified listing silently hidden.
  community_supplier_rejected: "outreach",
  // Outreach: a couple reported wrong/missing info on the live listing.
  // Send only on the FIRST report (cooldown built in via reportCount === 1)
  // so a single bad-faith reporter can't spam the inbox.
  community_supplier_reported: "outreach",
  // Outreach: anyone (no auth required) can hit /api/vendor/claim/start with a
  // listing id, and the listing's contact_email gets the mail — the recipient
  // didn't necessarily start the flow themselves.
  vendor_claim_verify: "outreach",
  // Transactional: the vendor just completed the claim form (set their own
  // password, clicked through) — this is the success confirmation closing
  // that loop. They now have a Weddly vendor account.
  vendor_claim_approved: "transactional",
  // Outreach: the recipient is a shortlisted vendor; the couple initiated
  // the message via /app/outreach but the vendor has no Weddly account.
  // Reply-To is the couple's own email, so a reply goes straight to them
  // outside Weddly (in v1 — the inbound webhook + in-app threading land
  // in v1.5 once the reply-domain DNS is provisioned).
  supplier_outreach: "outreach",
};
