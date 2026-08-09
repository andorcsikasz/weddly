// Catalogue of every email Weddly sends. One enum, one source of truth for
// category (transactional vs lifecycle) and copy. Add a new kind here, then a
// builder in `templates.ts`, then call `sendKind()` from your route.

export type EmailKind =
  | "welcome_verify" // signup welcome + verify-email CTA, single send
  | "welcome_account" // the account is now LIVE (verify clicked, or OAuth-attested): first-steps mail
  | "partner_welcome" // partner B joined a workspace: welcome + what they can do now
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
  | "trial_ended" // the trial window closed: the grace period is running, and the mail names the two ways on (invite your partner, or add payment details)
  | "partner_left_workspace" // partner B left the workspace, owner heads-up
  | "couple_paused" // workspace paused → 30-day delete countdown started
  | "pause_feedback_request" // admin asks a couple who paused what was actually missing for them
  | "couple_pause_cancelled" // either partner cancelled the pause; both get a heads-up
  | "account_purged" // 30-day window elapsed, all couple data deleted
  | "account_admin_purged" // an admin immediately deleted the account (no 30-day grace)
  | "account_flagged" // admin flagged the account, 7-day window to reply or it gets purged
  | "name_review_notice" // the workspace's partner names are placeholders, 3 days to correct them
  | "account_flag_cleared" // admin resolved the flag, user is no longer under review
  | "free_access_granted" // admin comped the workspace free Weddly access, heads-up to the couple
  | "rsvp_received_for_couple" // couple gets a notification when a guest RSVPs
  | "rsvp_received_household_for_couple" // aggregated notification: whole party RSVP'd in one go
  | "rsvp_thanks_for_guest" // guest gets a thank-you confirmation
  | "group_gift_notification" // guest opted into updates for a shared wishlist contribution
  | "guest_invite" // sent to a guest with a one-click /rsvp/{code} link
  | "guest_major_update" // couple-composed "something important changed" broadcast to opted-in guests
  | "guest_pre_wedding_info" // couple-composed final info summary, optional per-head envelope cost tip
  | "onboarding_nudge" // 24h after signup if they haven't onboarded a couple
  | "onboarding_nudge_week" // 7 days after signup, still no workspace, second, warmer nudge
  | "honeymoon_nudge" // one-shot, inside the 90-day window, to couples who haven't touched the honeymoon planner
  | "comeback_nudge" // one-shot win-back: nobody in the workspace has been seen for 3 weeks, here's what shipped meanwhile
  | "whats_new_2026_07" // operator-triggered product-update mail to workspaces quiet for 30+ days; dated on purpose, a later wave is its own kind
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
  | "vendor_profile_incomplete" // two profile-completion touches (day 3 + one week later) for a verified vendor whose listing still needs public details
  | "planner_profile_incomplete" // planner's public directory profile is still missing key fields (auto nudge after signup + admin "Send reminder")
  | "planner_waitlist_decision" // admin-edited planner triage reply (accepted / under_review / rejected)
  | "planner_provisioned" // admin pre-registered a planner account (2-year comp), activation link inside
  | "planner_onboarding_invite" // admin approved a /planners applicant, activation link + pre-filled onboarding inside
  | "planner_suggested_invite" // cold invite to a planner a Weddly user named: their account is already provisioned, one click takes it over
  | "visitor_verify" // confirm a verified-visitor's email so they can suggest suppliers + write reviews (no account)
  | "community_supplier_verify" // sent to a community-submitted listing's contact_email to publish
  | "community_supplier_published" // admin approved the listing, it's now live
  | "community_supplier_rejected" // admin rejected a pending listing during moderation
  | "community_supplier_reported" // first user report on a live listing, heads-up to the contact
  | "vendor_removal_confirmed" // a business asked to be taken off Weddly: confirms the listing is down, and leaves the door open with a register CTA
  | "vendor_claim_campaign" // admin-run invite to an unclaimed listing's contact_email: "take over your profile"
  | "vendor_claim_campaign_reminder" // one nudge 2 days later to invites nobody clicked
  | "vendor_review_campaign" // admin-run note to a CLAIMED vendor: reviews are open to anyone, here's your link to collect 5 stars
  | "vendor_review_campaign_reminder" // one nudge 7 days later to vendors who neither clicked nor opened
  | "personal_invite" // admin-run note to the founder's own contacts: you (or someone you love) is getting married, meet Weddly
  | "onboarding_campaign" // admin-run re-engagement blast to registered couples who never onboarded (no workspace)
  | "onboarding_campaign_reminder" // one nudge later to campaign recipients still not onboarded
  | "post_wedding_review_request" // ~7 days after the wedding: rate the vendors you used, one-click stars
  | "wedding_farewell" // T+14: the last mail we ever send a married couple, then lifecycle goes silent
  | "vendor_claim_verify" // P2.C, sent to a listing's contact_email when someone clicks "this is mine"
  | "vendor_claim_admin_alert" // heads-up to admins the moment someone starts a listing claim
  | "vendor_claim_approved" // sent to the new vendor account once the claim flow completes
  | "vendor_moved_to_planner" // admin rerouted a mis-routed vendor account to the planner side
  | "supplier_outreach" // P2.E, couple-initiated cold outreach to a shortlisted vendor
  | "vendor_message" // a vendor answered on the booking thread, heads-up to the couple
  | "vendor_auto_reply" // the vendor's own auto-acknowledgement, sent by the automation layer
  | "vendor_lead_reminder" // automation: the vendor's own reminder that a couple is still waiting
  | "vendor_review_request" // automation: the vendor APPROVED asking this couple for a review
  | "couple_message" // a couple wrote back on the booking thread, heads-up to the vendor
  | "vendor_quote" // a vendor sent a priced offer against the inquiry, heads-up to the couple
  | "quote_response" // the couple accepted or declined that offer, heads-up to the vendor
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
 * Lifecycle = system-initiated reminders. Delivery respects the recipient's
 * lifecycle preference.
 *
 * Outreach = cold mail to a recipient who has no Weddly account and didn't
 * trigger anything themselves, a couple added them to the supplier directory,
 * or someone hit the public claim-start endpoint with their contact email.
 * Drives the footer copy ("you don't have an account, ignore = nothing
 * happens") so the recipient isn't told a false "this concerns your account".
 */
export const KIND_CATEGORY: Record<EmailKind, EmailCategory> = {
  welcome_verify: "transactional",
  // Transactional: the account came into existence one second ago because the
  // recipient proved the address (verify click) or the provider attested it
  // (Google/Apple). This is the receipt for that, and the ONLY mail an OAuth
  // signup ever gets — they never see welcome_verify.
  welcome_account: "transactional",
  // Transactional: they clicked the invite link and joined the workspace; this
  // is the resolution of their own action, mirroring partner_invite_accepted
  // on the inviter's side.
  partner_welcome: "transactional",
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
  // the user didn't ask for this, so honour their lifecycle preference.
  partner_invite_reminder: "lifecycle",
  // Lifecycle: a REPEATING marketing nudge (3 sends, 5 days apart) about the
  // founding cohort, so it MUST honour lifecycle suppression. The sweep also
  // stops itself once the FOUNDING_CAP slots are gone — the offer it pitches
  // is the one activatePartnerFreeWindow actually grants, and that grant is
  // refused once the cohort is full.
  founding_partner_push: "lifecycle",
  trial_ended: "lifecycle",
  // Transactional: the owner had a partner in the workspace; that partner
  // self-unlinked via /api/users/me/leave-couple. Owner deserves to know.
  partner_left_workspace: "transactional",
  couple_paused: "transactional",
  // Lifecycle: they told us "missing features" on the way out and nothing
  // obliges them to say another word. An admin presses this one by hand, one
  // couple at a time, so it honours lifecycle suppression like every other
  // mail nobody asked for.
  pause_feedback_request: "lifecycle",
  // Transactional: the pause was an explicit action one partner took and
  // both received notification of; the cancel is the resolution of that
  // action and both partners deserve to know.
  couple_pause_cancelled: "transactional",
  account_purged: "transactional",
  account_admin_purged: "transactional",
  account_flagged: "transactional",
  // Transactional: it is about this workspace's standing and it names a date
  // after which the workspace goes read-only. A recipient who unsubscribed from
  // lifecycle mail must still be told, otherwise the first they hear of it is a
  // planner that stopped saving.
  name_review_notice: "transactional",
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
  group_gift_notification: "transactional",
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
  // Lifecycle: a feature nudge nobody asked for, so it honours lifecycle
  // suppression. Deliberately dodges the 90/30/7 milestone days, since those mails
  // promise in their own footnote that we only write at 90, 30 and 7 days out.
  honeymoon_nudge: "lifecycle",
  // Lifecycle: pure win-back. Nobody asked to hear from us three weeks after
  // they last logged in, so it honours lifecycle suppression, and it is
  // one-shot per workspace — a couple who is deliberately away must not be
  // followed by a drip.
  comeback_nudge: "lifecycle",
  // Lifecycle: the same win-back relationship as comeback_nudge, one rung
  // later. `comeback_nudge` is one-shot at 21 days, so a workspace quiet for
  // months already had its single automatic touch; this is the deliberate
  // second one, sent by an operator, and it honours lifecycle suppression for
  // exactly the same reason.
  whats_new_2026_07: "lifecycle",
  post_wedding_review_request: "lifecycle",
  // Lifecycle, and the last one: the sweep that sends it flips
  // `lifecycle_opt_out` immediately afterwards, so this is the final mail a
  // married couple ever gets from us apart from transactional replies.
  wedding_farewell: "lifecycle",
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
  // lifecycle preference so a couple who flipped to digest can also switch it
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
  // sections. The vendor didn't ask for it, so honour lifecycle suppression.
  vendor_profile_share: "lifecycle",
  // Lifecycle: recurring "your listing is still incomplete" reminder. The vendor
  // didn't ask for it and it repeats, so it MUST honour lifecycle suppression.
  vendor_profile_incomplete: "lifecycle",
  // Lifecycle: automatic "finish your profile" nudge (and its admin-triggered
  // twin). The planner didn't ask for it, so it honours lifecycle suppression.
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
  // Outreach, deliberately, even though the recipient does have a (dormant)
  // account by the time this lands: they never asked for it. Cold mail must
  // honour address-level suppression before delivery.
  planner_suggested_invite: "outreach",
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
  // address-level suppression (email_optouts) since there is no user row to
  // hold a preferences token.
  // TRANSACTIONAL, and the classification is load-bearing rather than
  // cosmetic. Recording the removal writes the address tombstone, and the
  // non-transactional branch of `sendKind` is gated on exactly that tombstone —
  // so any other category would make this mail suppress itself and the business
  // would never hear that we acted. It is also genuinely the definition: a
  // reply the recipient triggered and is waiting on.
  vendor_removal_confirmed: "transactional",
  vendor_claim_campaign: "outreach",
  vendor_claim_campaign_reminder: "outreach",
  vendor_review_campaign: "outreach",
  vendor_review_campaign_reminder: "outreach",
  personal_invite: "outreach",
  // Bulk re-engagement to registered-but-not-onboarded couples. Outreach (not
  // lifecycle) so it rides the address-level email_optouts suppression,
  // matching the other admin campaigns.
  onboarding_campaign: "outreach",
  onboarding_campaign_reminder: "outreach",
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
  // Transactional: their account just changed kind. The vendor dashboard is
  // gone on their next sign-in, so this is the only thing standing between the
  // move and a support mail asking what happened. Never opt-out.
  vendor_moved_to_planner: "transactional",
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
  // Transactional both ways: someone the recipient is already in a
  // conversation with just wrote to them. Never opt-out: a vendor who cannot
  // be told a client answered is a vendor who loses the booking. The volume
  // guard is the burst debounce in domain/booking_notify.ts, not a category.
  vendor_message: "transactional",
  // Lifecycle, and the split from `vendor_message` above is deliberate. That one
  // is transactional because a PERSON wrote those words and the couple is
  // waiting on exactly them; this one is a machine acknowledging receipt, it
  // carries nothing the couple cannot read in the app, and it is armed by the
  // vendor rather than requested by the recipient. So it honours suppression and
  // address-level suppression, which is what makes `email_optouts` and
  // DO_NOT_CONTACT apply on a surface that can fire on every inquiry.
  vendor_auto_reply: "lifecycle",
  // Lifecycle: a system-initiated reminder, exactly like every other nudge the
  // worker sends. The vendor armed it, which is consent to the automation, not
  // an exemption from their own mail preferences.
  vendor_lead_reminder: "lifecycle",
  // Lifecycle: the couple is being asked for a favour after the wedding, the
  // same relationship (and the same category) as post_wedding_review_request.
  vendor_review_request: "lifecycle",
  couple_message: "transactional",
  // Transactional both ways for the same reason, one step further along: this
  // pair carries a NUMBER somebody has to answer. A vendor who is not told
  // their offer was accepted loses the booking, and a couple who never hears
  // an offer arrived is answering a question nobody asked them. There is no
  // burst debounce behind these (see domain/booking_notify.ts): a second quote
  // is a second commercial offer, never a continuation of the first.
  vendor_quote: "transactional",
  quote_response: "transactional",
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

/**
 * Which mailbox a send goes out FROM.
 *
 * `default` = `CONFIG.emailFrom` (`noreply@`). Automatic mail: the machine
 * wrote it, nobody is standing behind it, and Reply-To already points anyone
 * who answers at the support inbox.
 *
 * `admin` = `CONFIG.emailFromAdmin` (`hello@`). Mail an operator sent by hand
 * from `/app/admin/*`. A person wrote it and a person is waiting for the
 * answer, so `noreply@` is a lie the recipient reads before the first word.
 */
export type EmailSender = "default" | "admin";

/**
 * Kinds that ONLY ever leave the building because an admin clicked something
 * in `/app/admin/*`. Owner rule, 2026-07-31: anything sent from the admin page
 * comes from the support mailbox.
 *
 * Membership is about the TRIGGER, not the recipient or the volume: the four
 * campaign families are here because an operator composes and runs each round
 * from its own admin page, even though the hourly sweep is what paces the
 * actual sends. Kinds the worker can also fire on its own are deliberately
 * absent — they pass `sender: "admin"` at the admin call site instead, so the
 * automatic path keeps the automatic sender. `senderForKind` is the only
 * reader; `email_integrity` guards against an admin route forgetting.
 *
 * ONE EXCEPTION, and it is deliberate: the vendor REVIEW campaign
 * (`vendor_review_campaign` + its reminder) stays on the default sender by
 * owner direction. Do not add it here.
 */
const ADMIN_CONSOLE_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>([
  // Feedback console — a human writing back to a human.
  "admin_feedback_reply",
  // The other direction of the same conversation: a human asking a churned
  // couple a question, from the workspace list. It asks for a REPLY, so a
  // sender that cannot receive one would defeat the entire mail.
  "pause_feedback_request",
  // Account actions taken on a couple from /app/admin/users.
  "account_flagged",
  "account_flag_cleared",
  "account_admin_purged",
  "free_access_granted",
  // Supplier moderation queue.
  "community_supplier_verify",
  "community_supplier_published",
  "community_supplier_rejected",
  // Planner provisioning + triage.
  "planner_provisioned",
  "planner_onboarding_invite",
  "planner_access_invite",
  "planner_waitlist_decision",
  "planner_suggested_invite",
  // Vendor triage + rerouting.
  "vendor_activation",
  "vendor_waitlist_decision",
  "vendor_moved_to_planner",
  // A business asked to come off Weddly and an admin actioned it. This one is
  // the clearest case in the whole list: they wrote to a person, and the mail
  // says "we did it" — a noreply@ sender would be telling someone their written
  // request was handled by a mailbox that cannot hear their next sentence.
  "vendor_removal_confirmed",
  // Campaigns: composed and released from their own admin page. The review
  // campaign is the exception noted above and is NOT in this list.
  "vendor_claim_campaign",
  "vendor_claim_campaign_reminder",
  "personal_invite",
  "onboarding_campaign",
  "onboarding_campaign_reminder",
]);

/** Resolve the sender for one send. An explicit `override` is how a kind the
 *  worker ALSO fires (verify_resend, partner_invite_reminder,
 *  planner_profile_incomplete) says "this particular one came from the admin
 *  console" without dragging the automatic path along with it. */
export function senderForKind(kind: EmailKind, override?: EmailSender): EmailSender {
  if (override) return override;
  return ADMIN_CONSOLE_KINDS.has(kind) ? "admin" : "default";
}
