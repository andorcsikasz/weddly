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
  | "partner_invite_declined" // invitee clicked "no thanks", inviter heads-up so they can re-send to a new address
  | "partner_invite_reminder" // admin-triggered nudge to a solo couple to invite their partner
  | "founding_partner_push" // recurring (3x, 5 days apart) founding-cohort nudge: the free-until-your-wedding-day plan needs BOTH partners on the workspace
  | "partner_left_workspace" // partner B left the workspace, owner heads-up
  | "couple_paused" // workspace paused → 30-day delete countdown started
  | "couple_pause_cancelled" // either partner cancelled the pause; both get a heads-up
  | "account_purged" // 30-day window elapsed, all couple data deleted
  | "account_admin_purged" // an admin immediately deleted the account (no 30-day grace)
  | "account_flagged" // admin flagged the account, 7-day window to reply or it gets purged
  | "account_flag_cleared" // admin resolved the flag, user is no longer under review
  | "free_access_granted" // admin comped the workspace free Weddly access, heads-up to the couple
  | "rsvp_received_for_couple" // couple gets a notification when a guest RSVPs
  | "rsvp_received_household_for_couple" // aggregated notification: whole party RSVP'd in one go
  | "rsvp_thanks_for_guest" // guest gets a thank-you confirmation
  | "guest_invite" // sent to a guest with a one-click /rsvp/{code} link
  | "guest_major_update" // couple-composed "something important changed" broadcast to opted-in guests
  | "guest_pre_wedding_info" // couple-composed final info summary, optional per-head envelope cost tip
  | "onboarding_nudge" // 24h after signup if they haven't onboarded a couple
  | "onboarding_nudge_week" // 7 days after signup, still no workspace, second, warmer nudge
  | "honeymoon_nudge" // one-shot, inside the 90-day window, to couples who haven't touched the honeymoon planner
  | "milestone_t90" // 90 days before the wedding
  | "milestone_t30" // 30 days before
  | "milestone_t7" // 7 days before
  | "timeline_escalation" // proactive-timeline push: tasks overdue/due-soon + couple opted into email
  | "wedding_today" // morning-of congratulations
  | "wedding_today_followup" // T+7 days, quick how-was-it / NPS nudge
  | "wedding_date_changed" // couple edited the wedding date, notify guests
  | "rsvp_deadline_approaching" // T-14 nudge listing how many guests haven't RSVPd yet
  | "rsvp_followup_missing_meal" // guest RSVP'd yes but skipped meal pick, one-shot nudge
  | "admin_moderation_digest" // weekly digest of the moderation queue (admin recipients only)
  | "rsvp_weekly_digest_for_couple" // weekly RSVP roll-up for couples on digest mode
  | "vendor_waitlist_received" // /vendors form submission → confirm we got it
  | "vendor_waitlist_decision" // admin-edited triage reply (under_review / rejected — accepted goes via vendor_activation)
  | "vendor_activation" // admin accepted/re-sent a vendor: activation link IS the CTA button, pre-filled onboarding inside
  | "vendor_profile_share" // ~2h after a vendor creates their profile: highlight the shareable public link + nudge any empty sections
  | "vendor_profile_incomplete" // recurring (every 2-4 days, capped) nudge to a verified vendor whose listing still lacks photo/bio/pricing/packages/availability; rotating copy variants
  | "planner_profile_incomplete" // planner's public directory profile is still missing key fields (auto nudge after signup + admin "Send reminder")
  | "planner_waitlist_decision" // admin-edited planner triage reply (accepted / under_review / rejected)
  | "planner_provisioned" // admin pre-registered a planner account (2-year comp), activation link inside
  | "planner_onboarding_invite" // admin approved a /planners applicant, activation link + pre-filled onboarding inside
  | "visitor_verify" // confirm a verified-visitor's email so they can suggest suppliers + write reviews (no account)
  | "community_supplier_verify" // sent to a community-submitted listing's contact_email to publish
  | "community_supplier_published" // admin approved the listing, it's now live
  | "community_supplier_rejected" // admin rejected a pending listing during moderation
  | "community_supplier_reported" // first user report on a live listing, heads-up to the contact
  | "vendor_claim_campaign" // admin-run invite to an unclaimed listing's contact_email: "take over your profile"
  | "vendor_claim_campaign_reminder" // one nudge 2 days later to invites nobody clicked
  | "vendor_review_campaign" // admin-run note to a CLAIMED vendor: reviews are open to anyone, here's your link to collect 5 stars
  | "vendor_review_campaign_reminder" // one nudge 7 days later to vendors who neither clicked nor opened
  | "vendor_claim_verify" // P2.C, sent to a listing's contact_email when someone clicks "this is mine"
  | "vendor_claim_admin_alert" // heads-up to admins the moment someone starts a listing claim
  | "vendor_claim_approved" // sent to the new vendor account once the claim flow completes
  | "supplier_outreach" // P2.E, couple-initiated cold outreach to a shortlisted vendor
  | "planner_access_requested" // a planner asked a couple for workspace access, couple decides
  | "planner_message" // free-form planner → couple message (user-entered subject + body)
  | "planner_access_approved" // couple approved the planner's access request, heads-up to the planner
  | "planner_client_invite" // couple invited a planner to their workspace, heads-up to the planner
  | "planner_email_invite" // planner invited a not-yet-registered person by email to become their client
  | "planner_waitlist_received" // /planners application confirm, next-step CTA (register / open dashboard)
  | "planner_access_invite" // admin (re)send of the "get into your planner account" CTA to a stuck applicant
  | "planner_invite_outcome" // planner accepted or declined the couple's invite, heads-up to the couple
  | "newsletter_confirm" // double opt-in confirm link for the landing/blog newsletter capture
  | "admin_feedback_reply"; // admin's free-form reply to an in-product Visszajelzés submission

export type EmailCategory = "transactional" | "lifecycle" | "outreach";

/**
 * Transactional = the user explicitly triggered the action and is waiting on
 * the email (signup, password reset, RSVP). Cannot be turned off.
 *
 * Lifecycle = system-initiated reminders. The user can opt out via the
 * unsubscribe footer link.
 *
 * Outreach = cold mail to a recipient who has no Weddly account and didn't
 * trigger anything themselves, a couple added them to the supplier directory,
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
  //, they're either expecting this mail or they need it RIGHT NOW. Either
  // way, never lifecycle.
  new_device_signin: "transactional",
  email_change_verify: "transactional",
  email_change_warning: "transactional",
  partner_invite: "transactional",
  // Transactional: the inviter clicked Invite Partner and is waiting to see
  // whether/when partner B joins, this is the resolution of that action.
  partner_invite_accepted: "transactional",
  // Transactional: same resolution arc as accept, just the other branch. The
  // inviter needs to know to either re-send to a different address or move
  // on.
  partner_invite_declined: "transactional",
  // Lifecycle: admin manually nudges a solo couple to invite their partner —
  // the user didn't ask for this so honour the unsubscribe footer.
  partner_invite_reminder: "lifecycle",
  // Lifecycle: a REPEATING marketing nudge (3 sends, 5 days apart) about the
  // founding cohort, so it MUST honour the unsubscribe footer. The sweep also
  // stops itself once the FOUNDING_CAP slots are gone — the offer it pitches
  // is the one activatePartnerFreeWindow actually grants, and that grant is
  // refused once the cohort is full.
  founding_partner_push: "lifecycle",
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
  // is implicitly waiting on either a reply window or a resolution, this
  // mail closes that loop.
  account_flag_cleared: "transactional",
  // Transactional: an admin just comped this workspace free access, good news
  // the couple should hear about right away, and it's account-critical (it
  // changes their billing state), so never opt-out.
  free_access_granted: "transactional",
  rsvp_received_for_couple: "transactional",
  rsvp_received_household_for_couple: "transactional",
  rsvp_thanks_for_guest: "transactional",
  // Transactional: the couple explicitly clicked "send invite" for this
  // guest in /app/guests, the recipient is waiting on the link.
  guest_invite: "transactional",
  // Transactional: guests opted into the wedding (RSVP / invite); a couple-sent
  // important update or pre-wedding info summary is account-critical for them,
  // same framing as wedding_date_changed.
  guest_major_update: "transactional",
  guest_pre_wedding_info: "transactional",
  onboarding_nudge: "lifecycle",
  onboarding_nudge_week: "lifecycle",
  // Lifecycle: a feature nudge nobody asked for, so it honours the unsubscribe
  // footer. Deliberately dodges the 90/30/7 milestone days, since those mails
  // promise in their own footnote that we only write at 90, 30 and 7 days out.
  honeymoon_nudge: "lifecycle",
  milestone_t90: "lifecycle",
  milestone_t30: "lifecycle",
  milestone_t7: "lifecycle",
  timeline_escalation: "lifecycle",
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
  // Transactional: admin asked to be admin (allowlist opt-in); the weekly
  // digest is internal operations correspondence, never opt-out.
  admin_moderation_digest: "transactional",
  // Lifecycle: couple opted into digest mode in Profile → the digest is a
  // friendly weekly summary, not a load-bearing notification. Honours the
  // unsubscribe footer so a couple who flipped to digest can also flip
  // off entirely without going back into Profile.
  rsvp_weekly_digest_for_couple: "lifecycle",
  // Outreach: vendor submitted the /vendors form but has no Weddly account —
  // the "fiókoddal kapcsolatban" footer line would be misleading.
  vendor_waitlist_received: "outreach",
  // Outreach: admin manually triages a vendor's own waitlist submission for the
  // under_review / rejected outcomes. The vendor expects the reply but still has
  // no Weddly account, so the "you have no account" footer is honest. The
  // accepted outcome goes via `vendor_activation` (transactional) instead.
  vendor_waitlist_decision: "outreach",
  // Transactional: the admin accepted the vendor (or re-sent the link) and the
  // single-use activation link inside IS the CTA button — the only way into the
  // pre-built vendor account. Must always deliver, and the transactional footer
  // is honest ("this concerns your account") now that they have one.
  vendor_activation: "transactional",
  // Lifecycle: a system-initiated nudge ~2h after the vendor set up their
  // profile, reminding them to share the public link and finish any empty
  // sections. The vendor didn't ask for it, so honour the unsubscribe footer.
  vendor_profile_share: "lifecycle",
  // Lifecycle: recurring "your listing is still incomplete" reminder. The vendor
  // didn't ask for it and it repeats, so it MUST honour the unsubscribe footer.
  vendor_profile_incomplete: "lifecycle",
  // Lifecycle: automatic "finish your profile" nudge (and its admin-triggered
  // twin). The planner didn't ask for it, so it honours the unsubscribe footer.
  planner_profile_incomplete: "lifecycle",
  // Outreach: admin manually triages a planner's waitlist submission. The
  // planner expects the reply; treated like the vendor decision mail.
  planner_waitlist_decision: "outreach",
  // Outreach: planner submitted the /planners application; like the vendor
  // waitlist confirm, they may have no Weddly account yet.
  planner_waitlist_received: "outreach",
  // Transactional: the admin explicitly (re)sends an access CTA to an applicant
  // stuck on "Regisztrációra vár". The has-account branch reaches a real account
  // holder (the admin just granted planner on their existing account), so the
  // outreach "you have no account" footer would be false; and as admin-triggered
  // account-access info it must always deliver, never opt-out.
  planner_access_invite: "transactional",
  // Transactional: the admin provisioned an account in the recipient's name
  // (agreed in person beforehand) and the activation link inside is the only
  // way into that account, so it must always deliver.
  planner_provisioned: "transactional",
  // Transactional: the admin approved this person's own /planners application
  // and the activation link inside is how they open their planner account
  // (details pre-filled from their application). Must always deliver.
  planner_onboarding_invite: "transactional",
  // Transactional: the recipient just asked us to verify their own email so
  // they can contribute (suggest suppliers / write reviews). Their action, their
  // address — must always deliver, like any other confirm-your-email link.
  visitor_verify: "transactional",
  // Outreach: a couple added this business to the community directory; the
  // recipient never asked for anything and has no Weddly account.
  community_supplier_verify: "outreach",
  // Outreach: same recipient (no Weddly account), the listing they
  // confirmed has now passed admin moderation and is publicly visible.
  community_supplier_published: "outreach",
  // Outreach: same recipient, moderation said no. Close the loop with a
  // reason instead of leaving the verified listing silently hidden.
  community_supplier_rejected: "outreach",
  // Outreach: a couple reported wrong/missing info on the live listing.
  // Send only on the FIRST report (cooldown built in via reportCount === 1)
  // so a single bad-faith reporter can't spam the inbox.
  community_supplier_reported: "outreach",
  // Outreach: the purest case in the catalogue. WE initiate, the recipient has
  // no Weddly account, and they never asked for anything. Carries its own
  // address-level opt-out (email_optouts) since there is no user row to hold a
  // preferences token, plus the List-Unsubscribe headers Gmail's bulk-sender
  // rules expect.
  vendor_claim_campaign: "outreach",
  vendor_claim_campaign_reminder: "outreach",
  vendor_review_campaign: "outreach",
  vendor_review_campaign_reminder: "outreach",
  // Outreach: anyone (no auth required) can hit /api/vendor/claim/start with a
  // listing id, and the listing's contact_email gets the mail, the recipient
  // didn't necessarily start the flow themselves.
  vendor_claim_verify: "outreach",
  // Transactional: internal ops correspondence to the admin allowlist, a
  // claim just started and a human may want to watch it. Same framing as
  // admin_moderation_digest; never opt-out.
  vendor_claim_admin_alert: "transactional",
  // Transactional: the vendor just completed the claim form (set their own
  // password, clicked through), this is the success confirmation closing
  // that loop. They now have a Weddly vendor account.
  vendor_claim_approved: "transactional",
  // Outreach: the recipient is a shortlisted vendor; the couple initiated
  // the message via /app/outreach but the vendor has no Weddly account.
  // Reply-To is the couple's own email, so a reply goes straight to them
  // outside Weddly (in v1, the inbound webhook + in-app threading land
  // in v1.5 once the reply-domain DNS is provisioned).
  supplier_outreach: "outreach",
  // Transactional: the planner clicked "request access" and the couple now
  // has to act (approve/decline), the couple owns a Weddly account, so this
  // is an account-relevant action mail, never opt-out.
  planner_access_requested: "transactional",
  // Transactional: a planner is sending a direct message to their client
  // couple. The couple has an account; Reply-To routes back to the planner.
  planner_message: "transactional",
  // Transactional: the resolution of the planner's access request, the
  // couple approved, and the planner is waiting to hear they can enter.
  planner_access_approved: "transactional",
  // Transactional: a couple invited this planner to their workspace; the
  // planner has a Weddly account and is being asked to accept/decline.
  planner_client_invite: "transactional",
  // Transactional: a planner invited this person (no Weddly account yet) to
  // become their client. The recipient explicitly receives a signup link they
  // are expected to act on, so it is never opt-out suppressed.
  planner_email_invite: "transactional",
  // Transactional: the resolution of the couple's own invite; the planner
  // accepted or declined, and the couple is waiting to hear which.
  planner_invite_outcome: "transactional",
  // Outreach: the recipient typed their email into the public capture form but
  // has no Weddly account, same footer framing as vendor_waitlist_received
  // ("no account, ignore = nothing happens"), which is literally true: without
  // the confirm click the address never receives another mail.
  newsletter_confirm: "outreach",
  // Transactional: the recipient explicitly submitted feedback through the
  // in-product dialog and this is a human reply to it. Whether they have an
  // account or not, they are waiting on the answer, so it always delivers and
  // is never opt-out suppressed.
  admin_feedback_reply: "transactional",
};
