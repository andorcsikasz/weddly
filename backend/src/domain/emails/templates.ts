// Per-kind email copy. The dispatcher (`send.ts`) calls one of these to
// produce the rendered HTML/text + the subject line. Keep the copy here so
// translators can find every string in one place; long-form content stays
// out of the dispatcher's plumbing code.

import { CONFIG } from "../../config";
import { type EmailCategory, type EmailKind, KIND_CATEGORY } from "./kinds";
import {
  type LocaleBlock,
  type RecipientLocale,
  type RenderedEmail,
  renderEmail,
} from "./template";

export interface BuildContext {
  /** Recipient's display name for the greeting. Falls back to "" if unknown. */
  recipientName: string;
  /** Used by the unsubscribe footer link (only rendered for lifecycle mail). */
  unsubscribeToken?: string;
  /** Recipient's known locale (`users.locale`), or `null` for guests + users
   *  whose locale was never captured. Picks single-card vs bilingual render
   *  in `renderEmail`. */
  recipientLocale?: RecipientLocale;
  /** Surfaces the named language on TOP of the bilingual stack, used when
   *  we don't know the recipient's locale (a vendor with no Weddly account)
   *  but DO know the submitter's (the couple who triggered the mail). HU/EN
   *  bilingual still renders both blocks; the hint just reorders them. */
  primaryLocaleHint?: "hu" | "en";
  /** When set, a 1×1 tracking pixel is appended to the HTML. Passed through
   *  from sendKind when sending guest_invite. */
  trackingPixelUrl?: string;
}

export interface BuiltEmail {
  subject: string;
  rendered: RenderedEmail;
  /** Optional per-message Reply-To override. When set, the dispatcher
   *  appends `Reply-To: <this>` to the outgoing headers so the recipient's
   *  reply lands here instead of the global support inbox. Used today
   *  by `supplier_outreach` to route vendor replies to the couple owner
   *  directly while we wait on the v1.5 inbound webhook + reply.weddly.xyz
   *  MX setup. */
  replyTo?: string;
}

// ─── Per-kind input shapes, each kind has its own narrow payload. ──────────

export interface WelcomeVerifyPayload {
  verifyUrl: string;
}
export interface VerifyResendPayload {
  verifyUrl: string;
}
export interface PasswordResetPayload {
  resetUrl: string;
}
export interface PasswordChangedPayload {
  /** Where to start a reset if the user didn't authorise this change. */
  forgotUrl: string;
  /** Pre-formatted change timestamp, locale-friendly. */
  changedAt: string;
}
export interface NewDeviceSigninPayload {
  /** Pre-formatted sign-in timestamp, locale-friendly. */
  signedInAt: string;
  /** Where to start a password reset if this wasn't them. */
  forgotUrl: string;
}
export interface EmailChangeVerifyPayload {
  /** Click-through link confirming the change, sent to the NEW address. */
  confirmUrl: string;
  /** Old address so the recipient can verify they recognise the account. */
  oldEmail: string;
}
export interface EmailChangeWarningPayload {
  /** The address the change is moving TO, shown so the owner can act if it's wrong. */
  newEmail: string;
  /** Where to start a password reset to lock everyone else out. */
  forgotUrl: string;
}
export interface PartnerInvitePayload {
  inviterName: string;
  inviteUrl: string;
  /** Optional couple display name, when present, used to personalize the
   *  body ("Your shared workspace: Mia & Lucas"). Falls back gracefully
   *  when empty (e.g. a freshly-onboarded couple with no display name set). */
  coupleDisplayName?: string;
}
export interface PartnerInviteAcceptedPayload {
  /** Display name of the partner who just clicked accept. */
  partnerName: string;
  /** Optional couple display name for the body ("Mia & Lucas"). */
  coupleDisplayName?: string;
  /** Where to land in /app, usually the dashboard. */
  dashboardUrl: string;
}
export interface PartnerInviteDeclinedPayload {
  /** Address the original invite was sent to. Lets the inviter recognise
   *  which invite this was about when they sent multiple. */
  invitedEmail: string;
  /** Where to (re-)issue an invite, typically /app/profile. */
  reinviteUrl: string;
}
export interface PartnerLeftWorkspacePayload {
  /** Display name of the partner who left. */
  partnerName: string;
  /** Optional couple display name for the body ("Mia & Lucas"). */
  coupleDisplayName?: string;
  /** Where to (re-)issue an invite, typically /app/profile. */
  reinviteUrl: string;
}
export interface CouplePausedPayload {
  /** Display name of the partner who clicked Pause. */
  requestedByName: string;
  /** Pre-formatted, locale-friendly date when the workspace will purge. */
  scheduledDeleteDate: string;
  /** Page where either partner can cancel the pause. */
  cancelUrl: string;
}
export interface CouplePauseCancelledPayload {
  /** Display name of the partner who clicked Cancel-pause. */
  cancelledByName: string;
  /** Where to land in the app, usually the dashboard. */
  dashboardUrl: string;
}
export interface AccountPurgedPayload {
  /** Display name the workspace had at purge time ("Mia & Lucas"). */
  coupleDisplayName: string;
}
export interface AccountAdminPurgedPayload {
  /** Workspace name at purge time, or null when the deleted user never
   *  onboarded a couple (orphan-user direct delete). */
  coupleDisplayName: string | null;
}
export interface AccountFlaggedPayload {
  /** Free-text concern the admin typed. Rendered verbatim in the email. */
  reason: string;
  /** Localised "you have until 2026-05-23" string, computed by the caller
   *  so the mail copy stays simple. */
  deadlineDateHu: string;
  deadlineDateEn: string;
}
export interface AccountFlagClearedPayload {
  /** Optional admin note when the flag was cleared. Verbatim when present.
   *  Empty string when admin chose not to add one, body softens accordingly. */
  note: string;
}
export interface FreeAccessGrantedPayload {
  /** Workspace label ("Andor & Sári") for a personal touch, or undefined when
   *  the couple hasn't named the workspace yet, body falls back to a generic
   *  line. */
  workspaceName?: string;
}
/** Couple-wide RSVP progress shown as a "% replied so far" line. Matches the
 *  /app/guests denominator (every guest row). Optional so older enqueued jobs
 *  without it still render, the line is simply omitted. */
export interface RsvpProgress {
  total: number;
  responded: number;
  pct: number;
}
export interface RsvpReceivedForCouplePayload {
  guestName: string;
  rsvpStatus: "yes" | "no" | "maybe";
  guestPageUrl: string;
  progress?: RsvpProgress;
}
export interface RsvpReceivedHouseholdForCouplePayload {
  /** Household label as it sits in /app/guests, e.g. "Anna & Mark". */
  householdLabel: string;
  /** One row per guest whose status moved in this submission. Order is
   *  preserved so the email reads naturally. */
  guests: {
    name: string;
    rsvpStatus: "yes" | "no" | "maybe";
  }[];
  guestPageUrl: string;
  progress?: RsvpProgress;
}
export interface RsvpThanksForGuestPayload {
  coupleDisplayName: string;
  weddingDate: string | null;
  rsvpStatus: "yes" | "no" | "maybe";
  rsvpPageUrl: string;
}
export interface GuestInvitePayload {
  /** "Mia & Lucas", used in the subject + body so the recipient knows
   *  whose wedding they're being invited to. */
  coupleDisplayName: string;
  /** Recipient's display name as it sits in the guest row. May be null when
   *  the couple created a placeholder row without typing a name yet. */
  guestName: string | null;
  /** Pre-formatted wedding date ("2026-09-12") or null if the couple hasn't
   *  pinned a date yet. */
  weddingDate: string | null;
  /** Full URL with the per-guest invite_code baked in, the recipient lands
   *  on /rsvp/{code} with the form pre-populated and just confirms. */
  rsvpUrl: string;
}
export interface GuestMajorUpdatePayload {
  /** "Mia & Lucas", used in the subject + body so the guest knows whose
   *  wedding this update is about. */
  coupleDisplayName: string;
  /** Recipient's display name as it sits in the guest row. Greeting uses the
   *  first name; falls back gracefully when empty. */
  guestName: string;
  /** Pre-formatted wedding date ("2026-09-12") or null if no date is pinned. */
  weddingDate: string | null;
  /** Where the guest can re-check details / update their RSVP. */
  infoUrl: string;
  /** Subject line the couple typed. When empty/null, a sensible default is used. */
  subject?: string | null;
  /** Couple-authored paragraphs, rendered one <p> each. Falls back to a
   *  default sentence when empty. */
  bodyParagraphs: string[];
}
export interface GuestPreWeddingInfoPayload {
  /** "Mia & Lucas", used in the subject + body. */
  coupleDisplayName: string;
  /** Recipient's display name as it sits in the guest row. */
  guestName: string;
  /** Pre-formatted wedding date ("2026-09-12") or null if no date is pinned. */
  weddingDate: string | null;
  /** Where the guest can re-check details / update their RSVP. */
  infoUrl: string;
  /** Subject line the couple typed. When empty/null, a sensible default is used. */
  subject?: string | null;
  /** Couple-authored paragraphs, rendered one <p> each. Falls back to a
   *  default sentence when empty. */
  bodyParagraphs: string[];
  /** Pre-formatted, localized "what to put in the envelope" per-head cost tip
   *  the route already built (currency-specific, not translated here). When a
   *  non-empty string, rendered verbatim as a final paragraph in both blocks. */
  envelopeTip?: string | null;
}
export interface OnboardingNudgePayload {
  onboardingUrl: string;
}
export interface PartnerInviteReminderPayload {
  /** Deep link straight to the dashboard's invite-partner anchor, so the
   *  recipient lands on the form they need to fill out. */
  invitePartnerUrl: string;
  /** Optional couple display name for a warmer body ("Mia & Lucas"). */
  coupleDisplayName?: string;
}
export interface RsvpWeeklyDigestForCouplePayload {
  /** Couple's friendly display name, "Mia & Lucas". */
  coupleDisplayName: string;
  /** Counts since the last digest (or, on first send, since couple flipped
   *  the toggle). Builder humanises them into a sentence; zero-row digests
   *  are skipped by the sweep so we never send "0 yes / 0 no". */
  yesCount: number;
  noCount: number;
  maybeCount: number;
  /** Page where the couple can see the full RSVP list. */
  guestsUrl: string;
}

export interface AdminModerationDigestPayload {
  awaitingReviewSuppliers: number;
  newVendorWaitlistEntries: number;
  pendingListingClaims: number;
  unresolvedUserFlags: number;
  /** Where to land in the admin app, typically /app/admin. */
  adminUrl: string;
  /** Growth stats: couples and owner-users created in the last 7 days. */
  newCouplesThisWeek: number;
  newCouplesLastWeek: number;
  newUsersThisWeek: number;
  newUsersLastWeek: number;
}

export interface RsvpFollowupMissingMealPayload {
  /** Couple display name so the guest knows which wedding this is about
   *  (people may have several invites in flight). */
  coupleDisplayName: string;
  /** Where to go to fill in the meal pick, same `/rsvp/:code` link they
   *  used the first time. */
  rsvpPageUrl: string;
}
export interface MilestonePayload {
  /** Couple's friendly display name, "Mia & Lucas". */
  coupleDisplayName: string;
  /** ISO date the wedding is happening. */
  weddingDate: string;
  /** Where in the app to land, usually the dashboard. */
  dashboardUrl: string;
}
export interface TimelineEscalationPayload {
  /** Couple's friendly display name, "Mia & Lucas". */
  coupleDisplayName: string;
  /** How many tasks are overdue right now. */
  overdueCount: number;
  /** How many are due soon. Only > 0 when the couple's trigger includes due-soon. */
  dueSoonCount: number;
  /** A few task titles to name concretely (already localized at the task level). */
  sampleTitles: string[];
  /** Deep link into the timeline view. */
  timelineUrl: string;
}
export interface WeddingTodayPayload {
  coupleDisplayName: string;
}
export interface WeddingTodayFollowupPayload {
  /** "Mia & Lucas", couple's display name. */
  coupleDisplayName: string;
  /** Where to leave feedback / NPS. Typically a Weddly form route. */
  feedbackUrl: string;
}
export interface WeddingDateChangedPayload {
  /** "Mia & Lucas", couple's display name. */
  coupleDisplayName: string;
  /** Pre-formatted prior date ("2026-09-12") or null if guests had never been
   *  told a date in the first place. */
  previousWeddingDate: string | null;
  /** Pre-formatted new date or null if it's been cleared back to TBD. */
  newWeddingDate: string | null;
  /** Where the guest can re-check details / update their RSVP. */
  rsvpPageUrl: string;
}

export interface RsvpDeadlineApproachingPayload {
  /** Couple's display name, "Mia & Lucas". */
  coupleDisplayName: string;
  /** Pre-formatted wedding date the body references. */
  weddingDate: string;
  /** Number of guests whose RSVP status is still pending. */
  pendingCount: number;
  /** Where to land in /app, usually the guests page. */
  guestsUrl: string;
}

export interface VendorWaitlistReceivedPayload {
  /** What the vendor typed for their business, used to humanise the body. */
  businessName: string;
  /** Localised category label (already resolved). E.g. "Virágdekoráció" /
   *  "Decor & floral". The route picks the right side based on the email
   *  language; we'll fall back to the slug if neither was provided. */
  categoryLabel: string;
  /** Free-text address or Google Maps URL, if the submitter provided one. */
  location: string | null;
  /** Where they can read more about Weddly while they wait. */
  landingUrl: string;
}

export interface VendorWaitlistDecisionPayload {
  /** Subject line the admin typed in the triage modal, used verbatim. */
  subject: string;
  /** Free-text body the admin edited in the modal. Multiple paragraphs are
   *  separated by blank lines; the builder splits on `\n\s*\n` and renders one
   *  `<p>` per chunk so HU and EN inline newlines don't blur together. */
  body: string;
  /** Triage outcome, drives a small contextual preheader so inbox preview
   *  shows the gist before the body opens. */
  outcome: "accepted" | "under_review" | "rejected";
}

export interface VendorActivationPayload {
  /** Vendor business name, used in the greeting. Falls back to a generic
   *  greeting when empty. */
  businessName: string;
  /** Full activation URL with the single-use token. This IS the CTA button's
   *  destination AND the clickable copy-paste fallback — never the homepage. */
  activateUrl: string;
  /** Optional warm intro the admin edited in the accept modal. When present its
   *  paragraphs open the letter (above the activation button); omitted on the
   *  resend path, where a clear default welcome + instruction is used instead. */
  introMessage?: string;
  /** Admin-edited subject (accept path). Falls back to the standard bilingual
   *  activation subject on resend. */
  subject?: string;
}

export interface VendorProfileSharePayload {
  /** Vendor business name, used in the greeting. Falls back to a generic
   *  greeting when empty. */
  businessName: string;
  /** The vendor's PUBLIC profile URL (`/vendors/v{id}`). This is the CTA
   *  destination AND the copy-paste share link the whole mail is built around,
   *  so it stays UTM-free (noUtm) — the vendor pastes it into their own
   *  socials/email and we don't want an email-attribution tag riding along. */
  shareUrl: string;
  /** In-app profile editor (`/vendor/listing`) where photos, bio and packages
   *  are filled in. Rendered as a secondary link. */
  editUrl: string;
  /** In-app reviews page (`/vendor/reviews`), secondary link behind the
   *  "ask a happy client for a review" nudge. */
  reviewsUrl: string;
  /** Which public-facing sections are still empty. Only the true ones are
   *  named in the body; when all four are false the "finish your profile"
   *  paragraph is dropped entirely and the mail is pure share + reviews. */
  missing: {
    photos: boolean;
    bio: boolean;
    calendar: boolean;
    packages: boolean;
  };
}

export interface VendorProfileIncompletePayload {
  /** Vendor business name, used in the greeting. */
  businessName: string;
  /** In-app listing editor (`/vendor/listing`) — the CTA where every missing
   *  section is filled in. */
  editUrl: string;
  /** Which public-facing sections are still empty. Only the true ones are named
   *  in the body. At least one is always true (the sweep only emails incomplete
   *  listings). */
  missing: {
    photos: boolean;
    bio: boolean;
    pricing: boolean;
    packages: boolean;
    availability: boolean;
  };
  /** Rotating copy index (0-based). The builder picks one of N wording variants
   *  by `variant % N`, so consecutive reminders to the same vendor never read
   *  the same. Driven by the per-vendor send count in the worker. */
  variant: number;
}

export interface PlannerProfileIncompletePayload {
  /** Planner's name, used in the greeting. */
  fullName: string;
  /** Business name if set (never shown when it's one of the missing fields);
   *  kept for potential future use in the greeting. */
  businessName: string | null;
  /** In-app profile editor (`/app/planner/settings/account`) — the CTA. */
  editUrl: string;
  /** Which public-profile fields are still empty. Only the true ones are named
   *  in the body. `businessName`/`city` block directory listing; `bio`/`styles`
   *  make the card convincing. */
  missing: {
    businessName: boolean;
    city: boolean;
    bio: boolean;
    styles: boolean;
  };
}

export interface PlannerWaitlistDecisionPayload {
  /** Subject line the admin typed in the planner triage modal, used verbatim. */
  subject: string;
  /** Free-text body the admin edited in the modal. Split on blank lines into
   *  one `<p>` per chunk, same as the vendor decision mail. */
  body: string;
  /** Triage outcome, drives a small contextual preheader. */
  outcome: "accepted" | "under_review" | "rejected";
}

export interface PlannerProvisionedPayload {
  /** The provisioned planner's name, used in the greeting. */
  plannerName: string;
  /** Business name the admin registered the profile under. */
  businessName: string;
  /** Free-text category the admin typed (e.g. "esküvőszervező"). */
  category: string;
  /** Full activation URL with the single-use token. */
  activateUrl: string;
  /** Human date (YYYY-MM-DD) the free window runs until, per locale. */
  freeUntilHu: string;
  freeUntilEn: string;
}

export interface PlannerOnboardingInvitePayload {
  /** The applicant's name, used in the greeting. */
  plannerName: string;
  /** Business name from their /planners application. */
  businessName: string;
  /** Full activation URL with the single-use token. */
  activateUrl: string;
  /** Human date the free (founding or trial) window runs until, per locale. */
  freeUntilHu: string;
  freeUntilEn: string;
}

export interface CommunitySupplierVerifyPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Full URL the recipient clicks to confirm, includes the single-use token. */
  verifyUrl: string;
}

export interface CommunitySupplierPublishedPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Public URL where couples will see the listing. */
  listingUrl: string;
}

export interface CommunitySupplierRejectedPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Optional admin-typed reason. Rendered verbatim when present, omitted
   *  cleanly when blank so the body doesn't show "Reason: " with nothing
   *  after it. */
  reason: string | null;
}

export interface CommunitySupplierReportedPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Reason slug the reporter picked (spam / fake / offensive / wrong_info /
   *  other). Body humanises the slug into a sentence. */
  reason: string;
}

export interface VendorClaimVerifyPayload {
  /** Listing name surfaced in the email body. */
  listingName: string;
  /** Full URL the recipient clicks to claim, includes the single-use token. */
  verifyUrl: string;
}

/** Shared by the claim-invite campaign and its 2-day reminder. `locale` is on
 *  the payload because the SUBJECT is a single string per kind, and a cold mail
 *  to a vendor in Portugal must not carry a Hungarian subject line the way the
 *  bilingual transactional kinds do. */
export interface VendorClaimCampaignPayload {
  listingName: string;
  /** Already translated into `locale` by the caller (shared/suppliers.ts). */
  categoryLabel: string;
  city: string;
  /** Tracked redirect that lands on the claim form in one click. */
  inviteUrl: string;
  /** Address-level suppression link, rendered as a secondary link. */
  optOutUrl: string;
  monthlyVisitors: number;
  /** Free months the live offer grants, 12 or 3. 0 when both cohorts are full,
   *  in which case the copy drops the free-window sentence entirely rather than
   *  promising something the claim would not honour. */
  freeMonths: number;
  locale: "hu" | "en";
}

export interface VendorClaimAdminAlertPayload {
  /** Listing name the claimer wants to take over. */
  listingName: string;
  /** Public listing id (curated slug / `c{N}`), lets the admin locate it. */
  listingId: string;
  /** The email the claimer typed into the modal, who is asking. */
  claimantEmail: string;
  /** Masked contact_email the verification link was actually sent to. */
  contactEmailMasked: string;
  /** Admin console URL the CTA points at. */
  adminUrl: string;
}

export interface VendorClaimApprovedPayload {
  /** Listing name to acknowledge ("Your listing 'Bloom Studio' is live"). */
  listingName: string;
  /** Where the vendor manages their listing from now on, typically /vendor. */
  managerUrl: string;
}

export interface SupplierOutreachPayload {
  /** "Mia & Lucas", couple's display name. Used in the From label and the
   *  opening line so the vendor knows who's writing. */
  coupleDisplayName: string;
  /** Couple owner's email. Lands in the Reply-To header so the vendor's
   *  reply goes straight to the couple's inbox (v1 has no inbound webhook). */
  coupleReplyEmail: string;
  /** Couple owner's full name. Surfaces in the closing line of the email. */
  coupleReplyName: string;
  /** Vendor business name. Renders in the greeting + the subject line. */
  supplierName: string;
  /** Subject line the couple typed in /app/outreach. */
  subject: string;
  /** Body text the couple typed in /app/outreach. Plain text, newlines
   *  preserved by the renderer. */
  body: string;
  /** Where the couple can find the campaign in-app, footer link. */
  outreachUrl: string;
}

export interface PlannerAccessRequestedPayload {
  /** Planner's display label (business name, full name, or a generic fallback)
   * , surfaced in bold so the couple knows who is asking. */
  plannerLabel: string;
  /** Planner's email. Lands in Reply-To so the couple can reach back out. */
  replyToEmail?: string;
}

export interface PlannerMessagePayload {
  /** Subject line the planner typed, used verbatim. */
  subject: string;
  /** Plain-text body the planner typed. One paragraph per line so the
   *  recipient sees the planner's line breaks (the shell escapes each). */
  bodyText: string;
  /** Planner's full name, surfaces in the "Küldő:" signature footnote. */
  senderName: string;
  /** Planner's email, surfaces in the footnote AND lands in Reply-To so the
   *  couple's reply goes straight to the planner. */
  senderEmail: string;
}

export interface PlannerAccessApprovedPayload {
  /** Couple display name ("Mia & Lucas"), bold in the opening line. */
  coupleName: string;
}

export interface AdminFeedbackReplyPayload {
  /** The admin's free-form reply, one paragraph per line (line breaks kept). */
  replyText: string;
  /** A short quote of what the submitter originally wrote, so they remember
   *  the thread. Null when the original submission carried no message (rating-
   *  or value-only feedback). */
  originalMessage: string | null;
}

export interface PlannerClientInvitePayload {
  /** Couple display name ("Mia & Lucas"), bold in the opening line. */
  coupleName: string;
  /** Inviting couple member's email, when available. Lands in Reply-To. */
  replyToEmail?: string;
}

export interface PlannerEmailInvitePayload {
  /** Planner's display label (business name / full name / fallback), bold in
   *  the opening line so the invitee knows who is inviting them. */
  plannerLabel: string;
  /** Signup link carrying the invitation token (?planner_invite=…). */
  inviteUrl: string;
  /** Planner's email. Lands in Reply-To so the invitee can ask questions. */
  replyToEmail?: string;
}

export interface PlannerWaitlistReceivedPayload {
  /** Applicant's name, used in the greeting. */
  plannerName: string;
  /** Whether the applicant was signed in when applying. Signed-in applicants
   *  already hold the planner grant (CTA → dashboard); signed-out ones must
   *  register with the SAME email to receive it (CTA → signup). */
  hasAccount: boolean;
}

export interface PlannerAccessInvitePayload {
  /** Applicant's name, used in the greeting. */
  plannerName: string;
  /** Whether a Weddly account already exists for this email. false → CTA to
   *  /signup ("register with the same email", which auto-grants planner);
   *  true → the admin just granted planner on their existing account, CTA to
   *  /app/planner ("sign in"). */
  hasAccount: boolean;
}

export interface PlannerInviteOutcomePayload {
  /** Planner's display label (business name / full name / fallback). */
  plannerLabel: string;
  /** true = the planner accepted the couple's invite; false = declined. */
  accepted: boolean;
  /** Planner's email on accept, so the couple can reply directly. */
  replyToEmail?: string;
}

export interface NewsletterConfirmPayload {
  /** Double opt-in confirm link ({FRONTEND_BASE_URL}/newsletter/confirm/…). */
  confirmUrl: string;
}

export type KindPayload = {
  welcome_verify: WelcomeVerifyPayload;
  verify_resend: VerifyResendPayload;
  password_reset: PasswordResetPayload;
  password_changed: PasswordChangedPayload;
  new_device_signin: NewDeviceSigninPayload;
  email_change_verify: EmailChangeVerifyPayload;
  email_change_warning: EmailChangeWarningPayload;
  partner_invite: PartnerInvitePayload;
  partner_invite_accepted: PartnerInviteAcceptedPayload;
  partner_invite_declined: PartnerInviteDeclinedPayload;
  partner_invite_reminder: PartnerInviteReminderPayload;
  partner_left_workspace: PartnerLeftWorkspacePayload;
  couple_paused: CouplePausedPayload;
  couple_pause_cancelled: CouplePauseCancelledPayload;
  account_purged: AccountPurgedPayload;
  account_admin_purged: AccountAdminPurgedPayload;
  account_flagged: AccountFlaggedPayload;
  account_flag_cleared: AccountFlagClearedPayload;
  free_access_granted: FreeAccessGrantedPayload;
  rsvp_received_for_couple: RsvpReceivedForCouplePayload;
  rsvp_received_household_for_couple: RsvpReceivedHouseholdForCouplePayload;
  rsvp_thanks_for_guest: RsvpThanksForGuestPayload;
  guest_invite: GuestInvitePayload;
  guest_major_update: GuestMajorUpdatePayload;
  guest_pre_wedding_info: GuestPreWeddingInfoPayload;
  onboarding_nudge: OnboardingNudgePayload;
  onboarding_nudge_week: OnboardingNudgePayload;
  milestone_t90: MilestonePayload;
  milestone_t30: MilestonePayload;
  milestone_t7: MilestonePayload;
  timeline_escalation: TimelineEscalationPayload;
  wedding_today: WeddingTodayPayload;
  wedding_today_followup: WeddingTodayFollowupPayload;
  wedding_date_changed: WeddingDateChangedPayload;
  rsvp_deadline_approaching: RsvpDeadlineApproachingPayload;
  rsvp_followup_missing_meal: RsvpFollowupMissingMealPayload;
  admin_moderation_digest: AdminModerationDigestPayload;
  rsvp_weekly_digest_for_couple: RsvpWeeklyDigestForCouplePayload;
  vendor_waitlist_received: VendorWaitlistReceivedPayload;
  vendor_waitlist_decision: VendorWaitlistDecisionPayload;
  vendor_activation: VendorActivationPayload;
  vendor_profile_share: VendorProfileSharePayload;
  vendor_profile_incomplete: VendorProfileIncompletePayload;
  planner_profile_incomplete: PlannerProfileIncompletePayload;
  planner_waitlist_decision: PlannerWaitlistDecisionPayload;
  planner_provisioned: PlannerProvisionedPayload;
  planner_onboarding_invite: PlannerOnboardingInvitePayload;
  community_supplier_verify: CommunitySupplierVerifyPayload;
  community_supplier_published: CommunitySupplierPublishedPayload;
  community_supplier_rejected: CommunitySupplierRejectedPayload;
  community_supplier_reported: CommunitySupplierReportedPayload;
  vendor_claim_campaign: VendorClaimCampaignPayload;
  vendor_claim_campaign_reminder: VendorClaimCampaignPayload;
  vendor_claim_verify: VendorClaimVerifyPayload;
  vendor_claim_admin_alert: VendorClaimAdminAlertPayload;
  vendor_claim_approved: VendorClaimApprovedPayload;
  supplier_outreach: SupplierOutreachPayload;
  planner_access_requested: PlannerAccessRequestedPayload;
  planner_message: PlannerMessagePayload;
  planner_access_approved: PlannerAccessApprovedPayload;
  planner_client_invite: PlannerClientInvitePayload;
  planner_email_invite: PlannerEmailInvitePayload;
  planner_waitlist_received: PlannerWaitlistReceivedPayload;
  planner_access_invite: PlannerAccessInvitePayload;
  planner_invite_outcome: PlannerInviteOutcomePayload;
  newsletter_confirm: NewsletterConfirmPayload;
  admin_feedback_reply: AdminFeedbackReplyPayload;
};

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildEmail<K extends EmailKind>(
  kind: K,
  payload: KindPayload[K],
  context: BuildContext,
): BuiltEmail {
  const built = BUILDERS[kind](payload as never, context);
  const category = KIND_CATEGORY[kind];
  // Single-use account links (activation) opt out of UTM so the copy-paste
  // fallback the recipient sees stays a clean, trustworthy URL. Everything else
  // gets the analytics tag.
  const ctaUrl = built.noUtm ? built.ctaUrl : appendEmailUtm(built.ctaUrl, kind, category);
  const rendered = renderEmail({
    hu: built.hu,
    en: built.en,
    ctaUrl,
    category,
    plainCtaUrl: built.plainCtaUrl,
    unsubscribeToken: context.unsubscribeToken,
    recipientLocale: context.recipientLocale,
    primaryLocaleHint: context.primaryLocaleHint,
    trackingPixelUrl: context.trackingPixelUrl,
  });
  return { subject: built.subject, rendered, replyTo: built.replyTo };
}

interface RawTemplate {
  subject: string;
  hu: LocaleBlock;
  en: LocaleBlock;
  ctaUrl: string;
  /** See `BuiltEmail.replyTo`. Per-kind builders set this to override the
   *  global Reply-To default; left undefined the dispatcher falls back to
   *  `CONFIG.supportEmail` like every other kind. */
  replyTo?: string;
  /** When true, the `ctaUrl` is also rendered as a clickable copy-paste line
   *  under the button, regardless of category. Used for account-action mail
   *  (activation) where a mangled button must have a plain fallback the vendor
   *  can copy. Outreach mail already shows this via its own category gate. */
  plainCtaUrl?: boolean;
  /** When true, skip UTM tagging on the CTA (single-use account links stay
   *  clean). */
  noUtm?: boolean;
}

type Builder<K extends EmailKind> = (payload: KindPayload[K], ctx: BuildContext) => RawTemplate;

/** Free-window closer for the claim-invite copy. Returns "" once both free
 *  cohorts are full, and the caller filters the empty paragraph out: silence
 *  is the honest option there, since the claim would only grant a 3-day trial
 *  and promising anything else would be a bait. The scarcity is stated as a
 *  fact about the cohort, not as a countdown, because the exact number moves
 *  between the send and the click. */
function offerSentenceHu(freeMonths: number): string {
  if (freeMonths >= 12) {
    return "Az első 100 szolgáltatónak egy teljes év ingyenes nálunk, bankkártya nélkül. Ebbe a körbe még belefértek.";
  }
  if (freeMonths > 0) {
    return `Az alapító helyek elfogytak, de a következő 300 szolgáltató ${freeMonths} hónapot kap tőlünk, bankkártya nélkül.`;
  }
  return "";
}

function offerSentenceEn(freeMonths: number): string {
  if (freeMonths >= 12) {
    return "The first 100 vendors get a full year with us for free, no card required. There is still room in that group.";
  }
  if (freeMonths > 0) {
    return `The founding year is gone, but the next 300 vendors get ${freeMonths} months on us, no card required.`;
  }
  return "";
}

const BUILDERS: { [K in EmailKind]: Builder<K> } = {
  welcome_verify: (p, ctx) => ({
    subject: "Üdv a Weddly-n / Welcome to Weddly",
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: "Erősítsd meg az e-mail címed, hogy később vissza tudd állítani a fiókod.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Üdv a Weddly-n, örülünk, hogy itt vagytok.",
        "A nyugodt esküvőtervezéshez minden eszköz a kezedben van: vendéglista, ülésrend, költségvetés, RSVP, nyomtatható meghívók. Minden egyetlen helyen, magyarul.",
        "Még egy lépés van hátra: erősítsd meg az e-mail címed. Ez azért fontos, hogy később, ha elfelejtenéd a jelszót, vissza tudd állítani, különben elveszhet a teljes esküvőtervező munkád.",
      ],
      cta: "E-mail cím megerősítése",
      ctaSubtext: "A link 7 napig érvényes.",
      footnote: "A megerősítés szükséges a bejelentkezéshez, ezért érdemes most elintézni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Welcome to Weddly · we're glad you're here.",
        "Everything you need for a calm wedding-planning process is in one place: guest list, seating plan, budget, RSVP, printable stationery.",
        "One quick thing: please confirm your email so you can recover your account if you ever lose your password.",
      ],
      cta: "Confirm your email",
      ctaSubtext: "The link is valid for 7 days.",
      footnote: "You'll need to confirm before you can sign in, so it's best to do it now.",
    },
  }),

  verify_resend: (p, ctx) => ({
    subject: "Új megerősítő link / fresh verification link",
    ctaUrl: p.verifyUrl,
    hu: {
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Itt egy új link az e-mail cím megerősítéséhez.",
        "Ha nem te kérted, hagyd figyelmen kívül ezt a levelet, a régi linket továbbra is használhatod, amíg le nem jár.",
      ],
      cta: "E-mail cím megerősítése",
      ctaSubtext: "A link 7 napig érvényes.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Here's a fresh email-verification link.",
        "If you didn't ask for this, you can safely ignore it.",
      ],
      cta: "Confirm your email",
      ctaSubtext: "Valid for seven days.",
    },
  }),

  password_reset: (p, ctx) => ({
    subject: "Jelszó visszaállítás / Password reset",
    ctaUrl: p.resetUrl,
    hu: {
      preheader: "Új jelszót kértél a Weddly fiókodhoz. A link 1 órán át érvényes.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Új jelszót kértél a Weddly fiókodhoz. A link biztonsági okokból **1 órán át érvényes**.",
        "Ha nem te kérted, ne kattints rá és ne add meg senkinek, a fiókod a régi jelszóval továbbra is biztonságban van.",
      ],
      cta: "Új jelszó beállítása",
      ctaSubtext: "Egyszer használható, 1 órán át érvényes link.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "You asked to reset your Weddly password. For your security this link is **valid for 1 hour**.",
        "If you didn't request this, you can ignore the email, your account is still safe.",
      ],
      cta: "Set a new password",
      ctaSubtext: "Single-use link, valid for 1 hour.",
    },
  }),

  password_changed: (p, ctx) => ({
    subject: "Jelszó megváltoztatva / Password changed",
    ctaUrl: p.forgotUrl,
    hu: {
      preheader: "Megerősítjük, hogy sikeresen módosítottad a jelszavad.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A Weddly fiókod jelszavát az imént **(${p.changedAt})** megváltoztattuk.`,
        "Minden eddigi bejelentkezésedet kiléptettük, így új jelszóval kell újra belépned mindenhol.",
        "**Ha NEM te voltál**, azonnal állíts vissza új jelszót a lenti linkkel, ezzel azonnal kizárod azt, aki most lépett be.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, ezt a levelet figyelmen kívül hagyhatod.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Your Weddly password was just changed **(${p.changedAt})**.`,
        "We've signed out all of your existing sessions, so you'll need to log back in everywhere with the new password.",
        "**If this wasn't you**, request a fresh password immediately using the link below, that will lock out whoever just got in.",
      ],
      cta: "Reset password now",
      footnote: "If this was you, you can safely ignore this email.",
    },
  }),

  new_device_signin: (p, ctx) => ({
    subject: "Új eszközről jelentkeztél be / New device sign-in",
    ctaUrl: p.forgotUrl,
    hu: {
      preheader: `Új eszközről nyitottak meg sessiont (${p.signedInAt}).`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Bejelentkezést észleltünk a Weddly fiókodba egy olyan eszközről, amit eddig nem láttunk **(${p.signedInAt})**.`,
        "Ha te voltál (új gép, új telefon, böngészőcsere, vagy más hálózat), minden rendben, nincs teendő.",
        "**Ha NEM te voltál**, ez azt jelenti, hogy valaki más belépett a fiókodba a jelszavaddal. Kérj azonnal új jelszót a lenti linkkel, ezzel azonnal kilépteted őt mindenhonnan.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, nyugodtan figyelmen kívül hagyhatod ezt a levelet.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We noticed a sign-in to your Weddly account from a device we haven't seen before **(${p.signedInAt})**.`,
        "If it was you (new computer, new phone, different browser, different network), all good, nothing to do.",
        "**If it wasn't**, someone else just got into your account with your password. Reset your password now using the link below, that will sign them out everywhere.",
      ],
      cta: "Reset password now",
      footnote: "If this was you, you can safely ignore this email.",
    },
  }),

  email_change_verify: (p, ctx) => ({
    subject: "E-mail cím megerősítése / Confirm your new email",
    ctaUrl: p.confirmUrl,
    hu: {
      preheader: "Erősítsd meg, hogy ezt az új e-mail címet szeretnéd használni a Weddly-n.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Új e-mail címet kértél a Weddly fiókodhoz. A jelenlegi címed: ${p.oldEmail}.`,
        "Kattints a lenti gombra, és onnantól ez az új cím lesz a bejelentkezésed, ide érkeznek a fontos üzeneteink, és innen tudsz majd jelszót is visszaállítani.",
        "Biztonsági okból minden eddigi bejelentkezésedet ki fogjuk léptetni, amikor megerősíted, bárhol használnál Weddly-t, újra be kell jelentkezned.",
      ],
      cta: "Új e-mail cím megerősítése",
      footnote: "Ha nem te kérted, hagyd figyelmen kívül, a régi cím marad érvényben.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `You asked to change the email on your Weddly account. The current one is ${p.oldEmail}.`,
        "Click below to make this new address your sign-in. From here on it'll receive every important message we send you and is what you'd use to reset a forgotten password.",
        "For your security we'll sign you out everywhere when you confirm, you'll need to log back in on each device.",
      ],
      cta: "Confirm new email",
      footnote: "If you didn't request this, ignore the email, your old address stays in place.",
    },
  }),

  email_change_warning: (p, ctx) => ({
    subject: "E-mail cím váltási kérelem / Email-change in flight",
    ctaUrl: p.forgotUrl,
    hu: {
      preheader: `Valaki új e-mail címre szeretné állítani a fiókod: ${p.newEmail}.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Most kértek egy új e-mail címet a Weddly fiókodhoz: ${p.newEmail}.`,
        "Amíg ezt nem erősítik meg az új címen, a fiókod a jelenlegi címen marad, ezt az értesítést is ezért kapod, hogy figyelmeztessünk.",
        "Ha NEM te kezdeményezted, ez azt jelenti, hogy valaki be tud lépni a fiókodba. Kérj azonnal új jelszót a lenti linkkel, ezzel azonnal kizárod.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, ezt nyugodtan figyelmen kívül hagyhatod.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Someone just asked to change the email on your Weddly account to ${p.newEmail}.`,
        "Until that new address confirms the change, your account stays tied to this email, and you're seeing this as the heads-up.",
        "If this wasn't you, it means someone has access to your account. Reset your password now using the link below to immediately lock them out.",
      ],
      cta: "Reset password now",
      footnote: "If this was you, you can safely ignore this message.",
    },
  }),

  partner_invite: (p) => {
    const coupleSuffixHu = p.coupleDisplayName
      ? ` A közös munkaterületetek neve: ${p.coupleDisplayName}.`
      : "";
    const coupleSuffixEn = p.coupleDisplayName
      ? ` Your shared workspace: ${p.coupleDisplayName}.`
      : "";
    return {
      subject: `${p.inviterName} meghívott a Weddly-re / invited you to plan together`,
      ctaUrl: p.inviteUrl,
      hu: {
        preheader: "Közös vendéglista, ülésrend, költségvetés, egy munkamenetben.",
        greeting: "Szia!",
        paragraphs: [
          `${p.inviterName} elkezdte tervezni az esküvőt a Weddly-n, és meghívott, hogy csatlakozz hozzá.${coupleSuffixHu}`,
          "Egy közös munkamenetben dolgoztok: vendéglista, ülésrend, költségvetés, RSVP linkek, nyomtatható helykártyák és asztalterv. Minden valós időben szinkronban, semmi táblázat-pingpong, semmi „melyik a legfrissebb verzió”.",
          "A nyilvános béta alatt ingyenes, és semmilyen szállítóhoz nem köt; az adatok a tiétek maradnak.",
        ],
        cta: "Csatlakozom a tervezéshez",
        ctaSubtext: "A link 7 napig érvényes.",
        footnote: "Ha véletlenül kaptad, hagyd figyelmen kívül, semmi sem fog történni.",
      },
      en: {
        greeting: "Hello,",
        paragraphs: [
          `${p.inviterName} started planning your wedding on Weddly and invited you to join.${coupleSuffixEn}`,
          'One shared workspace covers guest list, seating chart, budget, RSVP links, printable place cards and table plans, in real-time sync. No more spreadsheet ping-pong or "which version was the latest?".',
          "Free during the open beta, no vendor lock-in, your data stays yours.",
        ],
        cta: "Join the workspace",
        ctaSubtext: "Link valid for 7 days.",
        footnote: "Got this by mistake? Ignore it, nothing happens.",
      },
    };
  },

  partner_invite_accepted: (p, ctx) => {
    const coupleHu = p.coupleDisplayName
      ? ` Mostantól ${p.coupleDisplayName} közös munkamenetében dolgoztok.`
      : "";
    const coupleEn = p.coupleDisplayName
      ? ` You're now both working on ${p.coupleDisplayName}'s shared workspace.`
      : "";
    return {
      subject: `${p.partnerName} csatlakozott / ${p.partnerName} joined your workspace`,
      ctaUrl: p.dashboardUrl,
      hu: {
        preheader: `${p.partnerName} elfogadta a meghívót.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Jó hír: ${p.partnerName} elfogadta a meghívót, és csatlakozott az esküvőtervezőhöz.${coupleHu}`,
          "Mostantól minden adatot együtt szerkesztetek, vendéglista, ülésrend, költségvetés, RSVP linkek. Ami valamelyikőtök változtat, a másikon azonnal látszik.",
        ],
        cta: "Vezérlőpult megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Good news, ${p.partnerName} accepted your invite and joined the wedding planner.${coupleEn}`,
          "You'll both be editing the same data from here on, guest list, seating, budget, RSVP links. Changes made by either of you show up instantly on the other side.",
        ],
        cta: "Open dashboard",
      },
    };
  },

  partner_invite_declined: (p, ctx) => ({
    subject: "A meghívót visszautasították / Partner invite declined",
    ctaUrl: p.reinviteUrl,
    hu: {
      preheader: `${p.invitedEmail} nem fogadta el a meghívót.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A ${p.invitedEmail} címre küldött meghívót visszautasították, nem csatlakozik most az esküvőtervezőhöz.`,
        "Ha rossz címre küldted, vagy más személyt szeretnél meghívni, küldhetsz új meghívót a Profil oldalon. Egyébként szépen tovább tudsz tervezni egyedül is, minden funkció elérhető marad.",
      ],
      cta: "Új meghívó küldése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `The invite you sent to ${p.invitedEmail} was declined, they won't be joining the planner.`,
        "If you sent it to the wrong address or want to invite someone else, you can issue a fresh invite from your Profile page. Otherwise the planner stays fully usable solo, nothing's gated behind a partner.",
      ],
      cta: "Send a new invite",
    },
  }),

  partner_left_workspace: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? ` ${p.coupleDisplayName} ` : " ";
    const coupleEn = p.coupleDisplayName ? ` ${p.coupleDisplayName}'s ` : " ";
    return {
      subject: `${p.partnerName} kilépett / ${p.partnerName} left your workspace`,
      ctaUrl: p.reinviteUrl,
      hu: {
        preheader: `${p.partnerName} kilépett a közös munkamenetből.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${p.partnerName} kilépett${coupleHu}esküvőtervezőjéből, innentől már nem szerkeszthet, és nem jelenik meg a vendéglistában, ülésrendben, költségvetésben.`,
          "Minden adat helyén marad. Ha másik személyt szeretnél meghívni közös tervezésre, küldhetsz új meghívót a Profil oldalon. Egyedül is szépen folytatódik a tervezés, minden funkció elérhető.",
        ],
        cta: "Új partner meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.partnerName} left${coupleEn}wedding planner, from here on they can't edit, and won't appear in the guest list, seating, or budget views.`,
          "All your data stays in place. If you'd like to invite someone else to plan together, you can issue a fresh invite from your Profile page. Solo planning keeps working fully, nothing's gated behind a partner.",
        ],
        cta: "Invite a new partner",
      },
    };
  },

  partner_invite_reminder: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const coupleEn = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    return {
      subject: "Hívd meg a párodat a Weddly-re / Invite your partner to Weddly",
      ctaUrl: p.invitePartnerUrl,
      hu: {
        preheader: "Egy pár klikk, és együtt tervezhettek mindent.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Észrevettük, hogy egyedül használod a Weddly-t${coupleHu}, pedig a tervező igazán akkor erős, amikor a pároddal együtt szerkesztitek.`,
          "Pár kattintás, és máris közös munkamenetben dolgoztok: vendéglista, ülésrend, költségvetés, RSVP linkek. Ami valamelyikőtök változtat, a másikon azonnal látszik, semmi táblázat-pingpong.",
          "A lenti gomb visszavisz a vezérlőpultodra, közvetlenül a meghívó űrlaphoz.",
        ],
        cta: "Pár meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `We noticed you're using Weddly on your own${coupleEn}, but the planner really shines when you and your partner are editing together.`,
          "A couple of clicks and you're both in one shared workspace: guest list, seating, budget, RSVP links. Whatever either of you changes shows up instantly on the other side, no more spreadsheet ping-pong.",
          "The button below takes you straight to the invite form on your dashboard.",
        ],
        cta: "Invite my partner",
      },
    };
  },

  couple_paused: (p, ctx) => ({
    subject: "Esküvőtervező szüneteltetve / Workspace paused",
    ctaUrl: p.cancelUrl,
    hu: {
      preheader: `30 nap múlva (${p.scheduledDeleteDate}) véglegesen törlődik, hacsak nem mondjátok le.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `${p.requestedByName} szüneteltette a közös esküvőtervezőtöket.`,
        `**30 nap múlva (${p.scheduledDeleteDate})** az adatok véglegesen törlődnek, vendéglista, ülésrend, költségvetés, minden. Ezt utólag nem tudjuk visszaállítani.`,
        "Ha mégsem akartátok, vagy meggondoltátok magatokat, bármelyikőtök visszavonhatja a Profil oldalon.",
      ],
      cta: "Szüneteltetés visszavonása",
      footnote: "Ezt az értesítést mindketten megkapjátok, hogy bármelyikőtök tudjon dönteni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.requestedByName} paused your shared wedding workspace.`,
        `**In 30 days (${p.scheduledDeleteDate})** all of your data, guests, seating, budget, will be permanently deleted. We can't restore it after that.`,
        "If this wasn't intentional, either of you can cancel the pause from your Profile page.",
      ],
      cta: "Cancel the pause",
      footnote: "Both partners get this notification so either of you can act.",
    },
  }),

  couple_pause_cancelled: (p, ctx) => ({
    subject: "Esküvőtervező visszaállítva / Workspace pause cancelled",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.cancelledByName} visszavonta a szüneteltetést.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `${p.cancelledByName} visszavonta a közös esküvőtervezőtök szüneteltetését, a 30 napos visszaszámlálás leállt, és minden adat helyén marad.`,
        "Mostantól újra szerkeszthettek mindent: vendéglistát, ülésrendet, költségvetést.",
      ],
      cta: "Vissza a Weddly-re",
      footnote: "Ezt az értesítést mindketten megkapjátok.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.cancelledByName} cancelled the pause on your shared wedding workspace, the 30-day delete countdown is off, and all of your data stays in place.`,
        "You can both edit the guest list, seating, and budget again from here.",
      ],
      cta: "Back to Weddly",
      footnote: "Both partners get this notification.",
    },
  }),

  account_purged: (p, ctx) => ({
    subject: "Adataitok véglegesen törölve / Your data has been deleted",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: "A 30 napos szüneteltetési határidő letelt.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A 30 napos szüneteltetési időszak letelt, és ${p.coupleDisplayName} esküvőtervezőjének minden adata törlődött a Weddly-ből.`,
        "Vendéglista, ülésrend, költségvetés, RSVP-k, mind eltávolítva. A bejelentkezésetek innentől nem működik.",
        "Köszönjük, hogy egy ideig velünk voltatok. Ha valaha újra szükségetek lenne rá, bármikor új fiókkal indulhattok.",
      ],
      cta: "Vissza a Weddly-re",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `The 30-day pause window has now expired, and all of ${p.coupleDisplayName}'s wedding-planning data has been deleted from Weddly.`,
        "Guest list, seating chart, budget, RSVPs, all removed. Your sign-in no longer works from this point on.",
        "Thanks for trying us. You're welcome to start fresh any time with a new account if you need it again.",
      ],
      cta: "Back to Weddly",
    },
  }),

  // Fired when an admin manually deletes a user or workspace from the
  // moderation console (no 30-day grace window). Couple-flavored copy when
  // the user had a workspace, account-flavored when they were an orphan.
  account_admin_purged: (p, ctx) => ({
    subject: p.coupleDisplayName
      ? "Esküvői munkaterületed törölve / Your wedding workspace has been deleted"
      : "Fiókod törölve / Your account has been deleted",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: p.coupleDisplayName
        ? `${p.coupleDisplayName} munkaterülete törölve.`
        : "A Weddly fiókod törölve.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: p.coupleDisplayName
        ? [
            `A Weddly adminisztrátora törölte ${p.coupleDisplayName} esküvőtervező munkaterületét. Minden hozzátartozó adat, vendéglista, ülésrend, költségvetés, RSVP-k, eltávolítva, és a bejelentkezésetek innentől nem működik.`,
            "Ha úgy gondolod, hogy ez tévedésből történt, válaszolj erre az e-mailre, visszanézzük.",
          ]
        : [
            "A Weddly adminisztrátora törölte a fiókodat. A bejelentkezésed innentől nem működik, és nincs visszaállítási lehetőség.",
            "Ha úgy gondolod, hogy ez tévedésből történt, válaszolj erre az e-mailre, visszanézzük.",
          ],
      cta: "Weddly",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: p.coupleDisplayName
        ? [
            `A Weddly administrator has deleted ${p.coupleDisplayName}'s wedding-planning workspace. All of the associated data, guest list, seating, budget, RSVPs, has been removed, and your sign-in no longer works from this point on.`,
            "If you think this was a mistake, just reply to this email and we'll take a look.",
          ]
        : [
            "A Weddly administrator has deleted your account. Your sign-in no longer works from this point on, and the deletion cannot be undone.",
            "If you think this was a mistake, just reply to this email and we'll take a look.",
          ],
      cta: "Weddly",
    },
  }),

  // Moderation flag, fires the moment an admin clicks "Flag" on a user
  // in the admin directory. Tells the recipient WHY they were flagged
  // (verbatim free-text the admin typed) and gives them 7 days to reply
  // to the email; the hourly sweep deletes the account after the deadline
  // unless the admin manually clears the flag.
  account_flagged: (p, ctx) => ({
    subject: "Fiókod ellenőrzés alatt / Your account is under review",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `Válaszolj erre az e-mailre ${p.deadlineDateHu}-ig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "A Weddly adminisztrátora megjelölte a fiókodat ellenőrzésre. Az alábbi aggály miatt kértük a visszajelzésedet:",
        `„${p.reason}"`,
        `Ha úgy érzed, hogy ez tévedés vagy szeretnéd elmagyarázni a helyzetet, válaszolj erre az e-mailre **${p.deadlineDateHu}-ig**.`,
        "Ha eddig az időpontig nem kapunk választ, a fiókodat és a hozzátartozó adatokat (vendéglista, ülésrend, költségvetés, RSVP-k) automatikusan és véglegesen töröljük.",
      ],
      cta: "Weddly",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "A Weddly administrator has flagged your account for review. We'd like to hear from you about the following concern:",
        `"${p.reason}"`,
        `If you think this is a mistake or want to explain the situation, just reply to this email **by ${p.deadlineDateEn}**.`,
        "If we don't hear back by then, your account and all associated data (guest list, seating, budget, RSVPs) will be automatically and permanently deleted.",
      ],
      cta: "Weddly",
    },
  }),

  // Admin cleared the flag on a previously-flagged user. The flagged mail
  // promised "we'll delete your account if we don't hear back by X", this
  // closes that loop so the user isn't left with the original threatening
  // message as the last communication from us.
  account_flag_cleared: (p, ctx) => ({
    subject: "Fiók ellenőrzés lezárva / Account review cleared",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: "A fiókodon álló jelölést feloldottuk.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "A korábban a fiókodra tett ellenőrzési jelölést feloldottuk, minden szolgáltatás megint elérhető, és semmilyen adatot nem törlünk.",
        ...(p.note ? [`Megjegyzés tőlünk: „${p.note}"`] : []),
        "Ha bármi kérdés van ezzel kapcsolatban, válaszolj erre az e-mailre.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "The review flag that was on your account has been cleared, every feature is available again, and no data will be deleted.",
        ...(p.note ? [`Note from us: "${p.note}"`] : []),
        "If anything's unclear, just reply to this email.",
      ],
      cta: "Open Weddly",
    },
  }),

  free_access_granted: (p, ctx) => ({
    subject: "Ajándék: ingyenes Weddly-hozzáférés / A gift: free Weddly access",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: "Megajándékoztunk titeket ingyenes Weddly-hozzáféréssel.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        p.workspaceName
          ? `Jó hír: a(z) **${p.workspaceName}** munkaterületeteket megajándékoztuk ingyenes Weddly-hozzáféréssel.`
          : "Jó hír: a munkaterületeteket megajándékoztuk ingyenes Weddly-hozzáféréssel.",
        "Mostantól minden funkció korlátozás nélkül elérhető, vendéglista, ülésrend, költségvetés, RSVP és nyomtatható meghívók. Nincs teendőtök, fizetni sem kell.",
        "Ha bármi kérdés van, válaszolj erre az e-mailre.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        p.workspaceName
          ? `Good news: we've gifted your **${p.workspaceName}** workspace free access to Weddly.`
          : "Good news: we've gifted your workspace free access to Weddly.",
        "Every feature is now unlocked, guest list, seating plan, budget, RSVP, and printable stationery. There's nothing to do and nothing to pay.",
        "If anything's unclear, just reply to this email.",
      ],
      cta: "Open Weddly",
    },
  }),

  rsvp_received_for_couple: (p, ctx) => ({
    subject: rsvpReceivedSubject(p),
    ctaUrl: p.guestPageUrl,
    hu: {
      preheader: `${p.guestName} válaszolt: ${rsvpStatusHu(p.rsvpStatus)}.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.guestName}** most válaszolt a meghívóra: **${rsvpStatusHu(p.rsvpStatus)}**.`,
        rsvpProgressLineHu(p.progress),
        "A vendéglistán látod az ételválasztást, a +1-eket, a szállásigényt és a zenekívánságokat.",
      ].filter((line): line is string => line !== null),
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.guestName}** just responded: **${rsvpStatusEn(p.rsvpStatus)}**.`,
        rsvpProgressLineEn(p.progress),
        "The guest list has their meal choice, +1, accommodation, and song requests.",
      ].filter((line): line is string => line !== null),
      cta: "Open guest list",
    },
  }),

  rsvp_received_household_for_couple: (p, ctx) => ({
    subject: rsvpHouseholdSubject(p),
    ctaUrl: p.guestPageUrl,
    hu: {
      preheader: `${p.householdLabel}: ${p.guests.length} fő válaszolt.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      // Each guest gets its own paragraph so they stack one-per-line in every
      // client (the renderer collapses "\n" inside a single <p>, which used to
      // run the whole household onto one line).
      paragraphs: [
        `${p.householdLabel} (${p.guests.length} fő) most töltötte ki a meghívót:`,
        ...p.guests.map((g) => `• ${g.name} · ${rsvpStatusHu(g.rsvpStatus)}`),
        rsvpProgressLineHu(p.progress),
        "A vendéglistán látod az ételválasztást, a +1-eket, a szállásigényt és a zenekívánságokat.",
      ].filter((line): line is string => line !== null),
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.householdLabel} (${p.guests.length} guests) just RSVPd together:`,
        ...p.guests.map((g) => `• ${g.name} · ${rsvpStatusEn(g.rsvpStatus)}`),
        rsvpProgressLineEn(p.progress),
        "The guest list has their meal choices, +1s, accommodation, and song requests.",
      ].filter((line): line is string => line !== null),
      cta: "Open guest list",
    },
  }),

  rsvp_thanks_for_guest: (p, ctx) => ({
    subject: `RSVP elküldve / RSVP confirmed, ${p.coupleDisplayName}`,
    ctaUrl: p.rsvpPageUrl,
    hu: {
      preheader: `Elküldtük a válaszodat ${p.coupleDisplayName} esküvőjére.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Köszönjük, megkaptuk a válaszodat ${p.coupleDisplayName} esküvőjére.`,
        rsvpThanksDetailHu(p),
      ],
      cta: "Válasz módosítása",
      footnote: "A linket bármikor megnyithatod, ha valami változna.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Thanks, we've recorded your RSVP for ${p.coupleDisplayName}'s wedding.`,
        rsvpThanksDetailEn(p),
      ],
      cta: "Update your response",
      footnote: "Open the link any time if anything changes.",
    },
  }),

  guest_invite: (p) => {
    const dateHu = p.weddingDate ? ` **${p.weddingDate}**` : "";
    const dateEn = p.weddingDate ? ` **${p.weddingDate}**` : "";
    const greetingHuName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    const greetingEnName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    return {
      subject: `${p.coupleDisplayName} meghívnak az esküvőjükre / invite you to their wedding`,
      ctaUrl: p.rsvpUrl,
      hu: {
        preheader: "Egy kattintás, visszajelzés, ételválasztás, szállásigény.",
        greeting: `Szia${greetingHuName}!`,
        paragraphs: [
          `Nagy örömmel osztjuk meg veled, hogy ${p.coupleDisplayName}${dateHu} összekötik az életüket, és szeretnék, ha ezen a különleges napon te is velük ünnepelnél.`,
          "Az alábbi gombra kattintva jelezheted, hogy számíthatnak-e rád, milyen ételt választanál, szükséged lesz-e szállásra, illetve van-e olyan dal, ami számodra is emlékezetessé tenné az estét.",
          "A válaszaidat később is bármikor módosíthatod, ha bármi változna.",
        ],
        cta: "Visszajelzés küldése",
        footnote:
          "Ha ez a meghívó véletlenül jutott el hozzád, nyugodtan hagyd figyelmen kívül. Semmilyen teendőd nincs vele.",
      },
      en: {
        greeting: `Hi${greetingEnName},`,
        paragraphs: [
          `${p.coupleDisplayName} would love to have you at their wedding${dateEn}.`,
          "One click on the button below opens a single page where you can confirm attendance, pick a meal, flag accommodation needs, and request a song. You can update your answer any time.",
        ],
        cta: "RSVP now",
        footnote: "Got this by mistake? Ignore it, nothing happens.",
      },
    };
  },

  guest_major_update: (p) => {
    const dateHu = p.weddingDate ? ` (${p.weddingDate})` : "";
    const dateEn = p.weddingDate ? ` (${p.weddingDate})` : "";
    const greetingName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    const bodyHu =
      p.bodyParagraphs.length > 0
        ? p.bodyParagraphs
        : [
            `${p.coupleDisplayName} fontos frissítést szeretne megosztani veled az esküvővel${dateHu} kapcsolatban.`,
          ];
    const bodyEn =
      p.bodyParagraphs.length > 0
        ? p.bodyParagraphs
        : [
            `${p.coupleDisplayName} has an important update to share with you about their wedding${dateEn}.`,
          ];
    const subject =
      p.subject && p.subject.trim()
        ? p.subject.trim()
        : `${p.coupleDisplayName} - fontos frissítés / an important update`;
    return {
      subject,
      ctaUrl: p.infoUrl,
      hu: {
        preheader: `${p.coupleDisplayName} fontos frissítést küldött.`,
        greeting: `Szia${greetingName}!`,
        paragraphs: bodyHu,
        cta: "Részletek",
        footnote: "Ha kérdésed van, válaszolj erre az e-mailre.",
      },
      en: {
        greeting: `Hi${greetingName},`,
        paragraphs: bodyEn,
        cta: "View details",
        footnote: "Reply to this email if anything's unclear.",
      },
    };
  },

  guest_pre_wedding_info: (p) => {
    const dateHu = p.weddingDate ? ` (${p.weddingDate})` : "";
    const dateEn = p.weddingDate ? ` (${p.weddingDate})` : "";
    const greetingName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    const tip = p.envelopeTip && p.envelopeTip.trim() ? [p.envelopeTip.trim()] : [];
    const bodyHu =
      p.bodyParagraphs.length > 0
        ? p.bodyParagraphs
        : [
            `Közeleg a nagy nap${dateHu}, ${p.coupleDisplayName} összeszedett pár hasznos tudnivalót az esküvő előtt.`,
          ];
    const bodyEn =
      p.bodyParagraphs.length > 0
        ? p.bodyParagraphs
        : [
            `The big day is coming up${dateEn}, and ${p.coupleDisplayName} put together some helpful info before the wedding.`,
          ];
    const subject =
      p.subject && p.subject.trim()
        ? p.subject.trim()
        : `${p.coupleDisplayName} - hasznos tudnivalók az esküvő előtt / helpful info before the wedding`;
    return {
      subject,
      ctaUrl: p.infoUrl,
      hu: {
        preheader: `${p.coupleDisplayName} hasznos tudnivalókat küldött az esküvő előtt.`,
        greeting: `Szia${greetingName}!`,
        paragraphs: [...bodyHu, ...tip],
        cta: "Részletek",
        footnote: "Ha kérdésed van, válaszolj erre az e-mailre.",
      },
      en: {
        greeting: `Hi${greetingName},`,
        paragraphs: [...bodyEn, ...tip],
        cta: "View details",
        footnote: "Reply to this email if anything's unclear.",
      },
    };
  },

  onboarding_nudge: (p, ctx) => ({
    subject: "Folytasd ott, ahol abbahagytad / Pick up where you left off",
    ctaUrl: p.onboardingUrl,
    hu: {
      preheader: "Pár perc, és kész az alap esküvőterveződ.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Csak észbe kaptunk: regisztráltál a Weddly-n, de még nem fejezted be az alap beállítást.",
        "Pár perc az egész, pár adat (nevek, dátum, vendégszám), és máris kapsz egy szabható költségvetést, vendéglistát és ülésrend-vázat.",
        "Ha most nem alkalmas, leiratkozhatsz az emlékeztetőkről a levél alján.",
      ],
      cta: "Befejezem a tervező beállítását",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Quick reminder: you signed up for Weddly but haven't finished the initial setup yet.",
        "It only takes a few minutes, a few facts (names, date, guest count) and we'll seed a budget, guest list, and seating skeleton for you.",
        "If now's not a good time, you can opt out of these reminders from the footer below.",
      ],
      cta: "Finish my planner",
    },
  }),

  onboarding_nudge_week: (p, ctx) => ({
    subject: "Egy hét telt el. Kész vagy elkezdeni? / A week in: ready to start?",
    ctaUrl: p.onboardingUrl,
    hu: {
      preheader: "Egy hét telt el. Kezdjük el az esküvőtök tervezését?",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Egy hete regisztráltál a Weddly-n, de a terveződ még üres.",
        "Pár perc az egész: pár adat (nevek, dátum, vendégszám), és máris kapsz egy szabható költségvetést, vendéglistát és ülésrend-vázat.",
        "Ha most nem alkalmas, leiratkozhatsz az emlékeztetőkről a levél alján.",
      ],
      cta: "Elkezdem a tervezést",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "It's been a week since you joined Weddly, and your planner is still empty.",
        "A few minutes is all it takes: a few facts (names, date, guest count), and we'll seed a budget, guest list, and seating skeleton you can shape.",
        "If now's not a good time, you can opt out of these reminders from the footer below.",
      ],
      cta: "Start planning",
    },
  }),

  milestone_t90: (p, ctx) => ({
    subject: "3 hónap az esküvőtökig / 3 months to the wedding",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, 3 hónap maradt. Mi van még hátra?`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "**Pontosan 3 hónap múlva van a nagy nap.**",
        "Most jó alkalom: véglegesítsétek a vendéglistát, küldjétek ki az RSVP linkeket, és nézzétek át a költségvetést, hogy nincs-e elszállás. A Weddly mindenhez egy gombnyira van.",
      ],
      cta: "Folytatás a vezérlőpulton",
      footnote: "Ezt a levelet csak párszor küldjük: 90, 30 és 7 nappal előtte.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "**You're exactly 3 months out from the big day.**",
        "Good moment to: lock the guest list, send RSVP links, and double-check the budget. Everything's a click away in your Weddly dashboard.",
      ],
      cta: "Open dashboard",
      footnote: "We only send these at 90, 30, and 7 days out.",
    },
  }),

  milestone_t30: (p, ctx) => ({
    subject: "1 hónap! / 1 month to go",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, 30 nap. Itt egy pár fontos teendő.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "**Egy hónap maradt**, innen kezdődik a célegyenes.",
        "Ezen a héten a legfontosabbak: véglegesítsétek az ülésrendet, döntsetek a menüsorokról és az ételválasztásokról, küldjetek emlékeztetőt a még nem válaszoló vendégeknek. Minden eszköz a kezetekben van.",
      ],
      cta: "Vezérlőpult megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "**One month left**, the home stretch.",
        "This week's priorities: finalize seating, lock the menu and meal counts, and chase any guests who still haven't RSVP'd.",
      ],
      cta: "Open dashboard",
    },
  }),

  milestone_t7: (p, ctx) => ({
    subject: "1 hét! / 1 week to go",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, utolsó hét. Nyomtatás, ülésrend, részletek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "**Egy hét**, most már tényleg közel van.",
        "Két dolog, amit érdemes most lezárni: nyomtassátok ki a végleges ülésrendet (A4/A3) és a névkártyákat (A6) a Nyomtatás fülön; küldjétek el a végleges fejszámot a helyszínnek és a catering-nek.",
        "Pihenjetek is. A nehezén túl vagytok.",
      ],
      cta: "Nyomtatás megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "**One week left.**",
        "Two things worth closing this week: print the final seating chart (A4/A3) and place cards (A6) from the Print tab; share the final headcount with your venue and caterer.",
        "And rest. You've earned it.",
      ],
      cta: "Open print tab",
    },
  }),

  timeline_escalation: (p, ctx) => {
    const titles = p.sampleTitles.slice(0, 4);
    const listHu = titles.length > 0 ? titles.join(", ") : "";
    const listEn = titles.length > 0 ? titles.join(", ") : "";
    const headlineHu =
      p.overdueCount > 0
        ? `${p.overdueCount} teendő már csúszik${p.dueSoonCount > 0 ? `, és ${p.dueSoonCount} hamarosan esedékes` : ""}.`
        : `${p.dueSoonCount} teendő hamarosan esedékes.`;
    const headlineEn =
      p.overdueCount > 0
        ? `${p.overdueCount} to-do${p.overdueCount > 1 ? "s are" : " is"} now overdue${p.dueSoonCount > 0 ? `, and ${p.dueSoonCount} ${p.dueSoonCount > 1 ? "are" : "is"} coming up` : ""}.`
        : `${p.dueSoonCount} to-do${p.dueSoonCount > 1 ? "s are" : " is"} coming up.`;
    return {
      subject: "Csúszik pár dolog az ütemtervből / A few timeline items need you",
      ctaUrl: p.timelineUrl,
      hu: {
        preheader: `${p.coupleDisplayName}, ${headlineHu}`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          headlineHu,
          listHu ? `Ezek várnak rátok: ${listHu}.` : "Nézzétek át az ütemterveteket.",
          "Egy kattintással megnyithatjátok az idővonalat, kipipálhatjátok ami kész, és átütemezhetitek a többit.",
        ],
        cta: "Idővonal megnyitása",
        footnote:
          "Ezt azért kaptátok, mert bekapcsoltátok az ütemterv-emlékeztetőt. A Profilban bármikor kikapcsolható.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          headlineEn,
          listEn ? `Waiting on you: ${listEn}.` : "Take a look at your timeline.",
          "Open the timeline to tick off what's done and reschedule the rest, it's one click away.",
        ],
        cta: "Open timeline",
        footnote:
          "You're getting this because timeline reminders are on. Turn them off anytime in Profile.",
      },
    };
  },

  wedding_date_changed: (p, ctx) => {
    const fromHu = p.previousWeddingDate ? `${p.previousWeddingDate} → ` : "";
    const toHu = p.newWeddingDate ? `**${p.newWeddingDate}**` : "új időpont egyeztetés alatt";
    const fromEn = p.previousWeddingDate ? `${p.previousWeddingDate} → ` : "";
    const toEn = p.newWeddingDate ? `**${p.newWeddingDate}**` : "TBD (a new date will follow)";
    return {
      subject: `Új esküvői időpont / Wedding date update, ${p.coupleDisplayName}`,
      ctaUrl: p.rsvpPageUrl,
      hu: {
        preheader: `${p.coupleDisplayName} módosította az esküvő időpontját.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${p.coupleDisplayName} módosította az esküvő időpontját: ${fromHu}${toHu}.`,
          "Nyisd meg a lenti linket, hogy frissítsd a válaszodat, vagy hogy lásd a friss részleteket.",
        ],
        cta: "Részletek megnyitása",
        footnote: "Ha kérdésed van, válaszolj erre az e-mailre.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.coupleDisplayName} has updated the wedding date: ${fromEn}${toEn}.`,
          "Open the link below to review the latest details or update your RSVP.",
        ],
        cta: "Open details",
        footnote: "Reply to this email if anything's unclear.",
      },
    };
  },

  rsvp_weekly_digest_for_couple: (p, ctx) => {
    const total = p.yesCount + p.noCount + p.maybeCount;
    return {
      subject: `Heti RSVP összegzés / Weekly RSVP digest, ${p.coupleDisplayName}`,
      ctaUrl: p.guestsUrl,
      hu: {
        preheader: `${total} új visszajelzés a múlt héten.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `A múlt héten ${total} új RSVP érkezett ${p.coupleDisplayName} esküvőjére:`,
          [`• ${p.yesCount} jön`, `• ${p.noCount} nem tud jönni`, `• ${p.maybeCount} talán`].join(
            "\n",
          ),
          "A részletes lista, étel, +1, szállásigény, zenekívánság, a vendéglistán.",
        ],
        cta: "Vendéglista megnyitása",
        footnote: "Ezt heti egyszer küldjük, mert a Profil oldalon a digest módot választottad.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${total} new RSVPs came in this week for ${p.coupleDisplayName}'s wedding:`,
          [
            `• ${p.yesCount} attending`,
            `• ${p.noCount} can't make it`,
            `• ${p.maybeCount} maybe`,
          ].join("\n"),
          "Meal, +1, accommodation, and song details are on the guest list.",
        ],
        cta: "Open guest list",
        footnote: "Sent weekly because you chose digest mode in Profile.",
      },
    };
  },

  admin_moderation_digest: (p, ctx) => {
    const total =
      p.awaitingReviewSuppliers +
      p.newVendorWaitlistEntries +
      p.pendingListingClaims +
      p.unresolvedUserFlags;
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const couplesDelta = p.newCouplesThisWeek - p.newCouplesLastWeek;
    const usersDelta = p.newUsersThisWeek - p.newUsersLastWeek;
    return {
      subject: `Weddly moderation queue, ${total} pending`,
      ctaUrl: p.adminUrl,
      hu: {
        preheader: `${total} moderációs tétel vár ránk a héten.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Itt a heti moderációs összefoglaló, ${total} tétel várja a beavatkozást:`,
          `• ${p.awaitingReviewSuppliers} elfogadásra váró közösségi szolgáltató`,
          `• ${p.newVendorWaitlistEntries} új vendor-jelentkezés`,
          `• ${p.pendingListingClaims} függő listing-igénylés`,
          `• ${p.unresolvedUserFlags} aktív user-flag`,
          "Bármelyik tétel egy kattintásra van az admin oldalról.",
          `Növekedés (utóbbi 7 nap / megelőző 7 nap): **${p.newCouplesThisWeek} új pár** (${sign(couplesDelta)}) · **${p.newUsersThisWeek} új felhasználó** (${sign(usersDelta)})`,
        ],
        cta: "Admin felület megnyitása",
        footnote: "Heti egyszer küldjük ezt az összefoglalót, hétfő reggel.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Weekly moderation digest, ${total} items waiting:`,
          `• ${p.awaitingReviewSuppliers} suppliers awaiting review`,
          `• ${p.newVendorWaitlistEntries} new vendor waitlist submissions`,
          `• ${p.pendingListingClaims} pending listing claims`,
          `• ${p.unresolvedUserFlags} active user flags`,
          "Everything is one click away from the admin console.",
          `Growth (last 7 days / prior 7 days): **${p.newCouplesThisWeek} new couples** (${sign(couplesDelta)}) · **${p.newUsersThisWeek} new users** (${sign(usersDelta)})`,
        ],
        cta: "Open admin",
        footnote: "Sent once a week, Monday morning.",
      },
    };
  },

  rsvp_followup_missing_meal: (p, ctx) => ({
    subject: `Egy gyors apróság maradt / One small thing, ${p.coupleDisplayName}`,
    ctaUrl: p.rsvpPageUrl,
    hu: {
      preheader: "Egy ételválasztás még hiányzik a visszajelzésedből.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Köszi, hogy visszajeleztél ${p.coupleDisplayName} esküvőjére, egy mező maradt csak ki: az ételválasztás.`,
        "Egy kattintás a visszajelzés-oldalon, és kész, a párnak így pontosabb fejszámot tudnak adni a catering-nek.",
      ],
      cta: "Ételválasztás megadása",
      footnote: "Csak egyszer küldjük ezt, ha most kihagyod, akkor sem fog ismét rád szólni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Thanks for RSVP'ing to ${p.coupleDisplayName}'s wedding, one field is still open: your meal choice.`,
        "A single click on the RSVP page sorts it. Helps the couple give a cleaner headcount to their caterer.",
      ],
      cta: "Pick your meal",
      footnote: "We only send this nudge once, ignoring it is fine, we won't ask again.",
    },
  }),

  rsvp_deadline_approaching: (p, ctx) => ({
    subject: `${p.pendingCount} vendég még nem válaszolt / ${p.pendingCount} guests haven't RSVP'd`,
    ctaUrl: p.guestsUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, 2 hét az esküvőig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Két hét múlva van az esküvőtök **(${p.weddingDate})**, és **${p.pendingCount} vendég** még nem küldte el az RSVP-jét.`,
        "A vendéglistán egy kattintás emlékeztetőt küldeni mindenkinek, aki még nem válaszolt. Most a jó pillanat, innentől kezdve egyre nehezebb lesz pontos fejszámot adni a helyszínnek és a catering-nek.",
      ],
      cta: "Vendéglista megnyitása",
      footnote: "Ezt az emlékeztetőt csak egyszer küldjük, T-14 napon.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Your wedding is two weeks away **(${p.weddingDate})**, and **${p.pendingCount} guests** still haven't sent their RSVP.`,
        "On the guest list, one click sends a reminder to everyone who hasn't replied yet. Now's the right moment, it gets harder from here to give the venue and caterer a clean headcount.",
      ],
      cta: "Open guest list",
      footnote: "We only send this nudge once, at T-14 days.",
    },
  }),

  vendor_waitlist_received: (p, ctx) => ({
    subject: "Várólistára kerültél / You're on the Weddly vendor waitlist",
    ctaUrl: p.landingUrl,
    hu: {
      preheader: "Megkaptuk a jelentkezést, várólistán vagytok.",
      greeting: `Szia ${ctx.recipientName || p.businessName || ""}!`.trim(),
      paragraphs: [
        `Megkaptuk a(z) ${p.businessName} jelentkezését a Wēddly szolgáltatói várólistájára (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "Még nem nyitottunk a szolgáltatóknak, egy szűk kategóriánkénti listát építünk, hogy a párok ne 200 szolgáltatóból válogassanak, hanem azokból, akik tényleg passzolnak hozzájuk. Kategóriánként haladunk, így a visszajelzés pár hetet is igénybe vehet – amint a ti kategóriátokra kerül a sor, e-mailben jelentkezünk.",
        "Addig is, ha van bármi kérdés vagy szeretnétek többet mesélni magatokról, válaszoljatok erre a levélre, emberek olvassák.",
      ],
      cta: "Wēddly megnyitása",
      footnote: "Csak akkor írunk, amikor van új a várólistáddal.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || p.businessName || "there"},`,
      paragraphs: [
        `We've received ${p.businessName}'s submission to the Weddly vendor waitlist (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "We aren't onboarding suppliers yet, we're building a tight, per-category list so couples don't wade through 200 vendors but see the ones who actually fit. We work through categories one at a time, so this can take a few weeks – we'll email you the moment we open applications in your category.",
        "If you'd like to share more or have any questions in the meantime, just reply to this email, a real person reads it.",
      ],
      cta: "Open Weddly",
      footnote: "We'll only email when there's an update for your waitlist entry.",
    },
  }),

  // Admin-edited triage reply. The admin typed the subject + body in the
  // moderation modal; we slot that text into the standard branded shell so the
  // recipient sees a Weddly-branded mail rather than a context-less plain-text
  // reply (which is what the previous raw `sendEmail` path used to emit).
  vendor_waitlist_decision: (p) => {
    const paragraphs = splitParagraphs(p.body);
    return {
      subject: p.subject,
      ctaUrl: CONFIG.frontendBaseUrl,
      hu: {
        preheader: vendorWaitlistDecisionPreheader(p.outcome, "hu"),
        greeting: "Szia!",
        paragraphs,
        cta: "Weddly megnyitása",
      },
      en: {
        greeting: "Hi there,",
        paragraphs,
        cta: "Open Weddly",
      },
    };
  },

  // Vendor accepted (or activation re-sent). Unlike the outreach decision mail
  // above, the CTA button IS the single-use activation link (never the
  // homepage), the URL is also shown as a clickable copy-paste fallback, and
  // the transactional footer is honest because the recipient now has a
  // pre-built account waiting. Mirrors `planner_onboarding_invite`.
  vendor_activation: (p) => {
    const name = p.businessName.trim();
    // Accept path: the admin's warm, edited body opens the letter. Resend path:
    // no admin body, so a clear default welcome + bold activation instruction.
    const introParas = p.introMessage ? splitParagraphs(p.introMessage) : [];
    const huParas =
      introParas.length > 0
        ? introParas
        : [
            "Jó hírünk van: felvettünk titeket a Weddly-n tervező pároknak ajánlott szolgáltatók közé.",
            '**A szolgáltatói fiókotok aktiválásához kattintsatok a lenti „Fiók aktiválása" gombra.** Nincs szükség bankkártyára. A jelentkezéskor megadott adataitok és képeitek alapján már összeraktuk a profilotokat, belépés után csak átnézitek és élesítitek.',
          ];
    const enParas =
      introParas.length > 0
        ? introParas
        : [
            "Good news: we've added you to the vendors we recommend to couples planning on Weddly.",
            '**To activate your vendor account, tap the "Activate account" button below.** No card needed. We\'ve already built your profile from the details and photos in your application, so once you sign in you just review it and go live.',
          ];
    return {
      subject:
        p.subject?.trim() ||
        "Aktiváld a Weddly szolgáltatói fiókod / Activate your Weddly vendor account",
      ctaUrl: p.activateUrl,
      plainCtaUrl: true,
      noUtm: true,
      hu: {
        preheader: "Aktiváld a szolgáltatói fiókod, nincs szükség bankkártyára.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: huParas,
        cta: "Fiók aktiválása",
        ctaSubtext:
          "Nincs szükség bankkártyára. A link 30 napig érvényes, és csak egyszer működik.",
        footnote:
          "Ha nem te kérted ezt a fiókot, nyugodtan hagyd figyelmen kívül ezt a levelet, aktiválás nélkül a profil nem lép életbe.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: enParas,
        cta: "Activate account",
        ctaSubtext: "No card needed. The link is valid for 30 days and works once.",
        footnote:
          "If you didn't ask for this account, you can safely ignore this email, without activation the profile never goes live.",
      },
    };
  },

  vendor_profile_share: (p) => {
    const name = p.businessName.trim();
    // Only the sections that are actually empty get named, in the same order
    // in both languages so the two blocks stay parallel.
    const huMissing: string[] = [];
    const enMissing: string[] = [];
    if (p.missing.photos) {
      huMissing.push("fotók");
      enMissing.push("photos");
    }
    if (p.missing.bio) {
      huMissing.push("bemutatkozó szöveg");
      enMissing.push("a short bio");
    }
    if (p.missing.calendar) {
      huMissing.push("foglaltsági naptár");
      enMissing.push("an availability calendar");
    }
    if (p.missing.packages) {
      huMissing.push("árcsomagok");
      enMissing.push("pricing packages");
    }

    const huParas = [
      "Élesítettük a profilodat a Weddly-n, és már meg is oszthatod. A lenti linkre kattintva a párok belépés nélkül látják a nyilvános oldaladat.",
      "Tedd ki a közösségi oldaladra, küldd el e-mailben, vagy oszd meg az érdeklődő párokkal. Minél többen látják, annál több megkeresés jöhet.",
    ];
    if (huMissing.length > 0) {
      huParas.push(
        `Egy-két rész még üresen áll a profilodon: **${joinNaturalList(huMissing, "és")}**. Ha kitöltöd, sokkal meggyőzőbb lesz, és nagyobb eséllyel választanak.`,
      );
    }
    huParas.push(
      "A Weddly-n valódi párok terveznek valódi esküvőt, és tényleg böngészik a szolgáltatókat. Egy rendezett, teljes profil sokat számít az első benyomásnál.",
      "Ha van elégedett ügyfeled, kérd meg, hogy értékeljen a profilodon. Néhány őszinte, 5 csillagos vélemény a legjobb ajánlólevél, és érezhetően dob a foglalásokon.",
    );

    const enParas = [
      "Your profile is live on Weddly and ready to share. The link below opens your public page for couples, no login needed.",
      "Post it on your socials, drop it into an email, or send it to couples who reach out. The more people see it, the more enquiries you can get.",
    ];
    if (enMissing.length > 0) {
      enParas.push(
        `A couple of sections are still empty on your profile: **${joinNaturalList(enMissing, "and")}**. Filling them in makes it far more convincing, and more couples will pick you.`,
      );
    }
    enParas.push(
      "Real couples plan real weddings on Weddly, and they genuinely browse vendors. A tidy, complete profile makes a strong first impression.",
      "If you have a happy client, ask them to leave a review on your profile. A few honest 5-star reviews are the best reference you can have, and they noticeably lift bookings.",
    );

    return {
      subject: "Oszd meg a Weddly-profilod / Share your Weddly profile",
      ctaUrl: p.shareUrl,
      // The CTA link IS the shareable public URL, so keep it clean: no email
      // UTM riding along into the vendor's own socials, and render it as a
      // copy-paste line so they can grab it directly.
      plainCtaUrl: true,
      noUtm: true,
      hu: {
        preheader: "Kész a nyilvános profilod a Weddly-n, itt a megosztható linked.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: huParas,
        cta: "Profilom megnyitása",
        ctaSubtext: "Ez a nyilvános linked, bárkinek elküldheted, belépés nélkül is megnyílik.",
        secondaryLinks: [
          { label: "Profil szerkesztése", url: p.editUrl },
          { label: "Vélemények", url: p.reviewsUrl },
        ],
        footnote: "Csak akkor írunk, ha van valami, amivel előrébb léphetsz a Weddly-n.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: enParas,
        cta: "Open my profile",
        ctaSubtext: "This is your public link, share it with anyone, it opens without a login.",
        secondaryLinks: [
          { label: "Edit profile", url: p.editUrl },
          { label: "Reviews", url: p.reviewsUrl },
        ],
        footnote: "We only email when there's something useful for your Weddly profile.",
      },
    };
  },

  vendor_profile_incomplete: (p) => {
    const name = p.businessName.trim();
    // Name only the empty sections, in the same order in both languages so the
    // two blocks stay parallel. At least one is always true here.
    const huMissing: string[] = [];
    const enMissing: string[] = [];
    if (p.missing.photos) {
      huMissing.push("fotók");
      enMissing.push("photos");
    }
    if (p.missing.bio) {
      huMissing.push("bemutatkozó szöveg");
      enMissing.push("a short bio");
    }
    if (p.missing.pricing) {
      huMissing.push("ársáv");
      enMissing.push("a price range");
    }
    if (p.missing.packages) {
      huMissing.push("árcsomagok");
      enMissing.push("pricing packages");
    }
    if (p.missing.availability) {
      huMissing.push("foglaltsági naptár");
      enMissing.push("an availability calendar");
    }
    const huList = huMissing.length > 0 ? joinNaturalList(huMissing, "és") : "néhány rész";
    const enList = enMissing.length > 0 ? joinNaturalList(enMissing, "and") : "a few sections";

    // Five wording variants so consecutive reminders to the same vendor never
    // read the same. Same ask (finish these sections, here's the editor),
    // different framing. The worker rotates `variant` by the per-vendor count.
    const variants = [
      {
        subject: "Fejezd be a Weddly-profilod / Finish your Weddly profile",
        hu: {
          preheader: "Néhány rész még hiányzik a profilodról.",
          intro:
            "A profilod már él a Weddly-n, de még nincs teljesen kész. A hiányzó részek nélkül kevesebb pár kattint rád.",
          missing: (l: string) => `Ezek még hiányoznak: **${l}**.`,
          close: "Pár perc kitölteni, és sokkal meggyőzőbb lesz a profilod.",
          cta: "Profil befejezése",
        },
        en: {
          preheader: "A few sections are still missing from your profile.",
          intro:
            "Your profile is live on Weddly, but it isn't finished yet. Without the missing pieces, fewer couples click through.",
          missing: (l: string) => `Still missing: **${l}**.`,
          close: "It takes a couple of minutes and makes your profile far more convincing.",
          cta: "Finish my profile",
        },
      },
      {
        subject: "A párok téged is néznek a Weddly-n / Couples are browsing you on Weddly",
        hu: {
          preheader: "Valódi párok böngésznek, a teljes profil dönt.",
          intro:
            "Most is valódi párok keresgélnek szolgáltatókat a Weddly-n. Amikor rád találnak, egy teljes profil sokkal meggyőzőbb.",
          missing: (l: string) => `Nálad még üresen áll: **${l}**.`,
          close: "Egészítsd ki, hogy a legjobb formádat lássák.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "Real couples are browsing, a full profile wins.",
          intro:
            "Real couples are browsing vendors on Weddly right now. When they land on you, a complete profile is far more persuasive.",
          missing: (l: string) => `Yours is still empty here: **${l}**.`,
          close: "Fill it in so they see you at your best.",
          cta: "Complete my profile",
        },
      },
      {
        subject: "Az első benyomás számít / First impressions count",
        hu: {
          preheader: "Egy rendezett profil a legtöbbet hozza.",
          intro:
            "Egy rendezett, teljes profil az első benyomásnál a legtöbbet hozza. A tiéd már majdnem ott van.",
          missing: (l: string) => `Még ennyi kell hozzá: **${l}**.`,
          close: "Told ki gyorsan, és készen állsz a megkeresésekre.",
          cta: "Befejezem most",
        },
        en: {
          preheader: "A tidy profile makes the difference.",
          intro:
            "A tidy, complete profile makes the strongest first impression. Yours is almost there.",
          missing: (l: string) => `Just this left: **${l}**.`,
          close: "Wrap it up and you're ready for enquiries.",
          cta: "Finish it now",
        },
      },
      {
        subject: "Több megkeresés a teljes profillal / More enquiries with a full profile",
        hu: {
          preheader: "A teljes profilok több megkeresést kapnak.",
          intro:
            "A teljes profilok érezhetően több megkeresést kapnak. A tiédből még hiányzik pár darab.",
          missing: (l: string) => `Hiányzó részek: **${l}**.`,
          close: "Ha kitöltöd, nagyobb eséllyel választanak a párok.",
          cta: "Kiegészítem",
        },
        en: {
          preheader: "Full profiles get more enquiries.",
          intro:
            "Complete profiles get noticeably more enquiries. Yours is still missing a few pieces.",
          missing: (l: string) => `Missing sections: **${l}**.`,
          close: "Fill them in and more couples will choose you.",
          cta: "Complete it",
        },
      },
      {
        subject: "Egy utolsó lökés a profilodhoz / One last nudge for your profile",
        hu: {
          preheader: "Rövid emlékeztető: a profilod még nincs kész.",
          intro: "Nem húzzuk az időd, csak egy emlékeztető: a profilod még nincs teljesen kész.",
          missing: (l: string) => `Ennyi van hátra: **${l}**.`,
          close: "Fejezd be, amikor ráérsz, és utána nem zavarunk ezzel többet.",
          cta: "Befejezés",
        },
        en: {
          preheader: "Quick reminder: your profile isn't finished.",
          intro: "We'll keep it short, just a reminder that your profile isn't quite finished.",
          missing: (l: string) => `This is what's left: **${l}**.`,
          close: "Finish it whenever suits you, and we'll stop nudging about it.",
          cta: "Finish up",
        },
      },
    ];
    const v = variants[p.variant % variants.length] ?? variants[0]!;

    return {
      subject: v.subject,
      ctaUrl: p.editUrl,
      hu: {
        preheader: v.hu.preheader,
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: [v.hu.intro, v.hu.missing(huList), v.hu.close],
        cta: v.hu.cta,
        footnote: "Csak akkor írunk, ha van valami, amivel előrébb léphetsz a Weddly-n.",
      },
      en: {
        preheader: v.en.preheader,
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: [v.en.intro, v.en.missing(enList), v.en.close],
        cta: v.en.cta,
        footnote: "We only email when there's something useful for your Weddly profile.",
      },
    };
  },

  planner_profile_incomplete: (p) => {
    const name = p.fullName.trim();
    // Name the empty fields in the same order in both languages so the two
    // blocks stay parallel.
    const huMissing: string[] = [];
    const enMissing: string[] = [];
    if (p.missing.businessName) {
      huMissing.push("a vállalkozásod neve");
      enMissing.push("your business name");
    }
    if (p.missing.city) {
      huMissing.push("a városod");
      enMissing.push("your city");
    }
    if (p.missing.bio) {
      huMissing.push("egy rövid bemutatkozó");
      enMissing.push("a short bio");
    }
    if (p.missing.styles) {
      huMissing.push("a stílusaid");
      enMissing.push("your styles");
    }

    const huList = huMissing.length > 0 ? joinNaturalList(huMissing, "és") : "néhány adat";
    const enList = enMissing.length > 0 ? joinNaturalList(enMissing, "and") : "a few details";

    return {
      subject: "Fejezd be a Weddly-profilod / Finish your Weddly profile",
      ctaUrl: p.editUrl,
      hu: {
        preheader: "Néhány adat még hiányzik a nyilvános profilodról.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: [
          "Már majdnem kész a szervezői profilod a Weddly-n, de még hiányzik néhány adat ahhoz, hogy a párok megtaláljanak.",
          `Egészítsd ki ezeket: **${huList}**. Amíg a vállalkozásod neve és a városod nincs kitöltve, a profilod nem jelenik meg a párok szervező-listájában.`,
          "Néhány perc az egész, és onnantól a most tervező párok is rád találhatnak. A lenti gombbal egyből a szerkesztőhöz jutsz.",
        ],
        cta: "Profil kiegészítése",
        ctaSubtext: "Nyisd meg a profilszerkesztőt, és töltsd ki a hiányzó mezőket.",
        footnote: "Csak akkor írunk, ha van valami, amivel előrébb léphetsz a Weddly-n.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: [
          "Your planner profile on Weddly is almost ready, but a few details are still missing before couples can find you.",
          `Please add: **${enList}**. Until your business name and city are filled in, your profile won't appear in the couples' planner list.`,
          "It only takes a couple of minutes, and then couples planning right now can discover you. The button below takes you straight to the editor.",
        ],
        cta: "Complete my profile",
        ctaSubtext: "Open the profile editor and fill in the missing fields.",
        footnote: "We only email when there's something useful for your Weddly profile.",
      },
    };
  },

  planner_waitlist_decision: (p) => {
    const paragraphs = splitParagraphs(p.body);
    return {
      subject: p.subject,
      ctaUrl: CONFIG.frontendBaseUrl,
      hu: {
        preheader: vendorWaitlistDecisionPreheader(p.outcome, "hu"),
        greeting: "Szia!",
        paragraphs,
        cta: "Weddly megnyitása",
      },
      en: {
        greeting: "Hi there,",
        paragraphs,
        cta: "Open Weddly",
      },
    };
  },

  planner_provisioned: (p) => ({
    subject: "Elkészült a szervezői fiókod / Your planner account is ready",
    ctaUrl: p.activateUrl,
    hu: {
      preheader: `${p.businessName} profilja aktiválásra vár, 2 év ingyenes hozzáféréssel.`,
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Jó hírünk van: elkészítettük neked a(z) **${p.businessName}**${p.category ? ` (${p.category})` : ""} szervezői profilját a Weddly-n.`,
        `Ajándékba **2 év teljesen ingyenes hozzáférést** kapsz (érvényes eddig: ${p.freeUntilHu}). Nincs bankkártya, nincs apró betű: a lenti gombbal élesíted a fiókot, beállítasz egy jelszót, és már használhatod is.`,
        `Az élesítéssel elfogadod az Általános Szerződési Feltételeket (${CONFIG.frontendBaseUrl}/terms) és az Adatkezelési tájékoztatót (${CONFIG.frontendBaseUrl}/privacy). Mindkettőt a gomb után is megtalálod, mielőtt véglegesítenél.`,
      ],
      cta: "Fiók élesítése",
      ctaSubtext: "A link 30 napig érvényes és egyszer használható.",
      footnote:
        "Ha nem kérted ezt a fiókot, nincs teendőd: élesítés nélkül a profil nem lép életbe.",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `Good news: we've set up the planner profile for **${p.businessName}**${p.category ? ` (${p.category})` : ""} on Weddly in your name.`,
        `As a gift you get **2 years of completely free access**, until ${p.freeUntilEn}. No card, no fine print: hit the button below to activate the account, set a password, and you're in.`,
        `By activating you accept the Terms of Service (${CONFIG.frontendBaseUrl}/terms) and the Privacy Policy (${CONFIG.frontendBaseUrl}/privacy). Both are shown again on the activation page before you confirm.`,
      ],
      cta: "Activate account",
      ctaSubtext: "The link is valid for 30 days and can be used once.",
      footnote:
        "If you didn't ask for this account, there's nothing to do: without activation the profile never goes live.",
    },
  }),

  // The applicant applied on /planners themselves and an admin approved them.
  // Distinct from planner_provisioned (admin-in-person, "in your name"): here the
  // copy says "we reviewed and approved YOUR application" and the onboarding is
  // pre-filled from what they submitted. The link opens a real planner account.
  planner_onboarding_invite: (p) => ({
    subject: "Jóváhagytuk a jelentkezésed / Your planner application is approved",
    ctaUrl: p.activateUrl,
    hu: {
      preheader: "Átnéztük a jelentkezésed, nyisd meg a szervezői fiókod.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Köszönjük a jelentkezésed a Weddly tervezői programjába. Átnéztük és **jóváhagytuk** a(z) **${p.businessName}** profilját.`,
        "Már csak egy lépés van hátra: nyisd meg a fiókod a lenti gombbal, és állíts be egy jelszót. Az onboardingot **előre kitöltöttük a jelentkezésed adataival**, csak át kell nézned.",
        `A hozzáférés ingyenes eddig: ${p.freeUntilHu}. Nincs bankkártya, nincs apró betű.`,
        `A fiók megnyitásával elfogadod az Általános Szerződési Feltételeket (${CONFIG.frontendBaseUrl}/terms) és az Adatkezelési tájékoztatót (${CONFIG.frontendBaseUrl}/privacy). Mindkettőt a gomb után is megtalálod, mielőtt véglegesítenél.`,
      ],
      cta: "Fiók megnyitása",
      ctaSubtext: "A link 30 napig érvényes és egyszer használható.",
      footnote: "Ha nem te jelentkeztél, nincs teendőd: megnyitás nélkül a fiók nem lép életbe.",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `Thanks for applying to the Weddly planner programme. We have reviewed and **approved** the profile for **${p.businessName}**.`,
        "One step left: open your account with the button below and set a password. We have **pre-filled your onboarding with the details from your application**, so you just need to review them.",
        `Your access is free until ${p.freeUntilEn}. No card, no fine print.`,
        `By opening the account you accept the Terms of Service (${CONFIG.frontendBaseUrl}/terms) and the Privacy Policy (${CONFIG.frontendBaseUrl}/privacy). Both are shown again on the activation page before you confirm.`,
      ],
      cta: "Open your account",
      ctaSubtext: "The link is valid for 30 days and can be used once.",
      footnote:
        "If you didn't apply, there's nothing to do: without opening it the account never goes live.",
    },
  }),

  wedding_today_followup: (p, ctx) => ({
    subject: `Milyen volt? / How was the wedding?, ${p.coupleDisplayName}`,
    ctaUrl: p.feedbackUrl,
    hu: {
      preheader: `Köszönjük, hogy a Weddly-vel terveztetek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Reméljük, hogy ${p.coupleDisplayName} szuper hétvégét töltöttetek el a hozzátok közel állókkal.`,
        "Egy kérésünk lenne, ha pár perced van, mondd el, milyen volt a Weddly tervezőként. Mi vált be, mi hiányzott, mit változtatnál. A visszajelzéseitek alapján fejlesztjük a következő funkciókat.",
      ],
      cta: "Visszajelzés küldése",
      footnote: "Pár perc az egész, válaszolhatsz erre az e-mailre is.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We hope ${p.coupleDisplayName} had a wonderful weekend with the people who matter most.`,
        "One ask, if you have a few minutes, tell us what Weddly was like as a planner. What worked, what didn't, what you'd change. Your feedback shapes what we build next.",
      ],
      cta: "Share feedback",
      footnote: "Quick to do, you can also just reply to this email.",
    },
  }),

  wedding_today: (p, ctx) => ({
    subject: "Ma van a nap / Today's the day 💛",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, gratulálunk!`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Ma van a nap, ${p.coupleDisplayName}.`,
        "Köszönjük, hogy velünk terveztetek. Élvezzétek minden percét, mi addig csendben tartjuk a háttérben az adataitokat, bármikor visszanézhetitek később.",
      ],
      cta: "Vissza a Weddly-re",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Today's the day, ${p.coupleDisplayName}.`,
        "Thanks for planning with us. Enjoy every minute; your data stays here whenever you want to look back.",
      ],
      cta: "Back to Weddly",
    },
  }),
  community_supplier_verify: (p) => ({
    subject: "Weddly: vedd át a hirdetésed / claim your listing",
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: `${p.supplierName} hozzá lett adva a Weddly katalógushoz.`,
      greeting: "Szia!",
      paragraphs: [
        `Valaki a Weddly-n hozzáadta a vállalkozásod (${p.supplierName}) a közösségi szolgáltató-katalógushoz.`,
        "Ha szeretnéd, hogy a párok lássák, vedd át a hirdetést az alábbi linkkel, addig nem jelenik meg.",
        "Ha nem te küldted és nem szeretnéd, hogy itt szerepelj, hagyd figyelmen kívül ezt a levelet. Kattintás nélkül a hirdetés nem kerül publikálásra.",
      ],
      // "Átvétele" instead of "megerősítése", the recipient never asked for
      // anything to confirm. "Take ownership" / "Claim" is the Yelp/GBP-
      // standard verb for this exact directory-onboarding flow; reads as
      // agency-giving rather than "click here to commit to something you
      // didn't sign up for".
      cta: "Hirdetés átvétele",
      ctaSubtext: "A link 7 napig érvényes.",
      secondaryLinks: [{ label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl }],
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `Someone added your business (${p.supplierName}) to the community supplier directory on Weddly.`,
        "If you'd like couples to see the listing, claim it via the button below, until then it stays hidden from the public.",
        "If this wasn't you and you don't want a listing, just ignore this email, the listing won't publish without a click.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // Claim-invite campaign. Cold, so the copy has to earn the click in the first
  // two lines: WHY this arrived (a user put them on the site), WHAT already
  // exists (their category + town, proof we mean their actual business), and
  // what is wrong with it (we wrote it from public data, so the things that
  // actually sell are missing). The free window is the closer, not the hook,
  // an offer-first cold mail reads as an ad.
  //
  // Rendered single-language: `locale` comes off the payload because the
  // subject is one string per kind, and a Hungarian subject on a mail to a
  // venue in Puglia is the fastest way into a spam folder.
  vendor_claim_campaign: (p) => ({
    subject:
      p.locale === "hu"
        ? `${p.listingName} már fent van a Weddly-n`
        : `${p.listingName} is already listed on Weddly`,
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: `${p.categoryLabel} · ${p.city}. Vedd át a profilt, és innentől te szerkeszted.`,
      greeting: "Szia!",
      paragraphs: [
        `Egy felhasználónk ajánlására felvettük a(z) ${p.listingName} vállalkozást a Weddly esküvői katalógusába, ${p.categoryLabel} kategóriában, ${p.city} környékén. A profil már él, a párok látják.`,
        `Havonta több ezren terveznek nálunk esküvőt. A profilt viszont mi állítottuk össze nyilvános adatokból, így pont az hiányzik róla, ami valóban eladna: a saját fotóitok, a csomagok és árak, a szabad időpontok.`,
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      ctaSubtext: "Egy kattintás, és egy jelszó. Regisztrálni nem kell.",
      footnote:
        "Ha nem te kezeled a vállalkozást, add tovább a kollégának. Ha egyáltalán nem kéritek a profilt, hagyd figyelmen kívül ezt a levelet, és levesszük.",
      secondaryLinks: [
        { label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Ne írjatok többet", url: p.optOutUrl },
      ],
    },
    en: {
      preheader: `${p.categoryLabel} · ${p.city}. Take the profile over and edit it yourself.`,
      greeting: "Hi there,",
      paragraphs: [
        `A user suggested you, so we added ${p.listingName} to the Weddly wedding directory under ${p.categoryLabel}, around ${p.city}. The profile is already live and couples can see it.`,
        `Several thousand couples plan their wedding with us every month. But we built this profile from public information, so the things that actually win bookings are missing: your own photos, your packages and prices, the dates you are free.`,
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      ctaSubtext: "One click and a password. No sign-up form.",
      footnote:
        "Not the right person? Pass it to whoever runs the diary. If you would rather not be listed at all, ignore this email and we will take it down.",
      secondaryLinks: [
        { label: "What is Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Don't email me again", url: p.optOutUrl },
      ],
    },
  }),
  // The single 2-day nudge. Shorter on purpose: they have the context from the
  // first mail, so this one is a reminder of the ask, not a re-pitch.
  vendor_claim_campaign_reminder: (p) => ({
    subject:
      p.locale === "hu"
        ? `Még szerkesztheted: ${p.listingName}`
        : `Still yours to edit: ${p.listingName}`,
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: `A(z) ${p.listingName} profilját még mindig mi kezeljük helyettetek.`,
      greeting: "Szia!",
      paragraphs: [
        `Pár napja írtunk, hogy a(z) ${p.listingName} fent van a Weddly katalógusában ${p.categoryLabel} kategóriában. A profil még mindig azokkal az adatokkal fut, amiket mi állítottunk össze róla.`,
        `Pár perc átvenni, utána a fotók, az árak és a szabad időpontok is a tiétek.`,
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      ctaSubtext: "Ez az utolsó levelünk az ügyben.",
      secondaryLinks: [{ label: "Ne írjatok többet", url: p.optOutUrl }],
    },
    en: {
      preheader: `${p.listingName} is still running on the details we put together.`,
      greeting: "Hi there,",
      paragraphs: [
        `We wrote a couple of days ago about ${p.listingName} being listed on Weddly under ${p.categoryLabel}. The profile is still running on the details we put together ourselves.`,
        `It takes a couple of minutes to take over. After that the photos, the prices and the free dates are yours to set.`,
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      ctaSubtext: "This is the last email we'll send about it.",
      secondaryLinks: [{ label: "Don't email me again", url: p.optOutUrl }],
    },
  }),
  // P2.C, vendor claim verify mail. Categorised as `outreach`: anyone (no
  // auth) can hit /api/vendor/claim/start with a listing id, so the recipient
  // didn't necessarily start the flow themselves. The footer copy reflects
  // that ("no Weddly account, ignore = nothing happens").
  vendor_claim_verify: (p) => ({
    subject: "Weddly: vedd át a listingedet / claim your listing",
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: `${p.listingName} listing átvétele.`,
      greeting: "Szia!",
      paragraphs: [
        `Valaki a Weddly-n szeretné átvenni a(z) ${p.listingName} listing tulajdonjogát.`,
        "Ha te vagy, kattints az alábbi linkre, ezzel jelszót állíthatsz be, és innentől te szerkesztheted a saját adataidat a katalógusban.",
        "Ha nem te kezdeményezted, hagyd figyelmen kívül ezt az emailt, kattintás nélkül semmi sem történik.",
      ],
      cta: "Listing átvétele",
      ctaSubtext: "A link 7 napig érvényes.",
      secondaryLinks: [{ label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl }],
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `Someone wants to claim the ${p.listingName} listing on Weddly.`,
        "If that's you, click the link below, you'll set a password and from then on manage the listing yourself in the directory.",
        "If you didn't request this, just ignore the email, nothing happens without clicking the link.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // Internal heads-up to the admin allowlist the moment someone starts a
  // listing claim. The verification link still goes to the listing's own
  // contact_email (that's the ownership proof); this just lets a human watch
  // who's asking, the claimer-typed address often differs from the inbox on
  // file, which is exactly the signal an admin wants before the link lands.
  vendor_claim_admin_alert: (p, ctx) => ({
    subject: `Listing-igénylés indult / Claim started, ${p.listingName}`,
    ctaUrl: p.adminUrl,
    hu: {
      preheader: `${p.listingName}: valaki igényelni szeretné.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Valaki elindította a(z) ${p.listingName} listing átvételét a Weddly katalógusban.`,
        [
          `• Listing: ${p.listingName} (${p.listingId})`,
          `• Igénylő által megadott email: ${p.claimantEmail}`,
          `• Megerősítő link kiküldve ide: ${p.contactEmailMasked}`,
        ].join("\n"),
        "A megerősítő link a listingen szereplő hivatalos címre ment, ez igazolja a tulajdonjogot. Ez a levél csak figyelmeztetés, nincs teendő, hacsak nem tűnik gyanúsnak.",
      ],
      cta: "Admin felület megnyitása",
      footnote: "Ezt minden listing-igénylés indulásakor elküldjük az adminoknak.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Someone started a claim on the ${p.listingName} listing in the Weddly directory.`,
        [
          `• Listing: ${p.listingName} (${p.listingId})`,
          `• Email the claimer entered: ${p.claimantEmail}`,
          `• Verification link sent to: ${p.contactEmailMasked}`,
        ].join("\n"),
        "The verification link went to the listing's contact email on file, that's what proves ownership. This is a heads-up only; nothing to do unless it looks off.",
      ],
      cta: "Open admin",
      footnote: "Sent to admins whenever a listing claim starts.",
    },
  }),

  // Admin moderation flipped a verified community-submitted supplier to
  // 'active', it's now visible to couples. Closes the verify → moderation
  // → live loop the recipient last heard about when they clicked the verify
  // link.
  community_supplier_published: (p) => ({
    subject: `Élesedett a hirdetésed / ${p.supplierName} is now live`,
    ctaUrl: p.listingUrl,
    hu: {
      preheader: `${p.supplierName} mostantól látszik a Weddly katalógusban.`,
      greeting: "Szia!",
      paragraphs: [
        `Megnéztük és átengedtük: ${p.supplierName} mostantól szerepel a Weddly publikus szolgáltató-katalógusban.`,
        "A párok mostantól rátalálhatnak. Ha bármi adat változna (telefonszám, weboldal, leírás), válaszolj erre az emailre, emberek olvassák.",
      ],
      cta: "Hirdetés megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `We've reviewed your listing and ${p.supplierName} is now visible in Weddly's public supplier directory.`,
        "Couples can find you from here. If anything needs updating (phone, website, description), just reply to this email, a human reads it.",
      ],
      cta: "Open your listing",
    },
  }),

  // Admin moderation rejected a verified community-submitted supplier
  // (awaiting_review → hidden). Closes the verify → moderation loop with
  // a concrete answer + optional admin-typed reason; otherwise the
  // verified listing sits silently hidden and the submitter has no
  // recourse.
  community_supplier_rejected: (p) => ({
    subject: `Hirdetésed nem került jóváhagyásra / Listing not approved`,
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.supplierName} hirdetése nem ment át a moderáción.`,
      greeting: "Szia!",
      paragraphs: [
        `Megnéztük, és ${p.supplierName} hirdetése jelenleg nem fér bele a Weddly katalógusunkba.`,
        ...(p.reason ? [`A döntés indoka: „${p.reason}"`] : []),
        "Ha úgy gondolod, hogy ez tévedés, válaszolj erre az e-mailre, emberek olvassák.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `We've reviewed the listing and ${p.supplierName} doesn't fit Weddly's directory at this time.`,
        ...(p.reason ? [`Reason from our team: "${p.reason}"`] : []),
        "If you think this is a mistake, just reply to this email, a human reads it.",
      ],
      cta: "Open Weddly",
    },
  }),

  // First user-report on a live community listing. Heads-up to the contact
  // so they can fix wrong info before the moderation queue swallows the
  // listing for repeated reports. Only fires on the FIRST report (caller
  // gates on reportCount === 1) to keep the inbox quiet.
  community_supplier_reported: (p) => ({
    subject: `Visszajelzés érkezett a hirdetésedre / Feedback on your listing`,
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.supplierName} hirdetését jelentették.`,
      greeting: "Szia!",
      paragraphs: [
        `Egy felhasználó visszajelzést küldött a(z) ${p.supplierName} hirdetésedről a Weddly katalógusban.`,
        `Jelentés oka: ${humanReportReasonHu(p.reason)}`,
        "Ez egy elsőjelzés, most még semmi nem változik a publikus megjelenésen. Ha tudod, hogy mi az amit pontosítani lehet (cím, leírás, képek), válaszolj erre az emailre és segítünk frissíteni.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `A user sent feedback on your ${p.supplierName} listing in the Weddly directory.`,
        `Report reason: ${humanReportReasonEn(p.reason)}`,
        "This is a first signal, nothing changes on the public side yet. If you know what could be tightened up (address, description, photos), reply to this email and we'll help you update.",
      ],
      cta: "Open Weddly",
    },
  }),

  // Success confirmation after the vendor finishes the claim flow. Before
  // this, the verify click landed the vendor on a "set your password" page
  // and… nothing. This closes the loop with a Weddly-branded "you're in"
  // mail that doubles as proof-of-account for their records.
  vendor_claim_approved: (p, ctx) => ({
    subject: `A listinged a tiéd / ${p.listingName} is yours`,
    ctaUrl: p.managerUrl,
    hu: {
      preheader: `${p.listingName} mostantól a tiéd a Weddly-n.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Sikerült: ${p.listingName} mostantól a Weddly vendor fiókodhoz tartozik.`,
        "Innentől te szerkesztheted az adatokat, leírás, árak, képek, elérhetőség. A párok ugyanazt látják mint te a publikus katalógusban.",
        "Ha kérdés van vagy bármi nem stimmel, válaszolj erre az emailre, emberek olvassák.",
      ],
      cta: "Listing kezelése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Done, ${p.listingName} is now linked to your Weddly vendor account.`,
        "From here on you can edit the listing yourself, description, pricing, photos, contact details. Couples browsing the directory will see exactly what you publish.",
        "Questions or anything off? Reply to this email, a human reads it.",
      ],
      cta: "Manage your listing",
    },
  }),

  // Couple-initiated cold outreach to a shortlisted vendor. The body is
  // free text the couple typed in /app/outreach; we wrap it in a Weddly
  // header + footer and stamp the couple's own email in the Reply-To
  // (handled at the mailer layer via the per-kind headers hook v1.5; v1
  // includes the address in the body footer so the vendor can copy it
  // manually if their client doesn't honour Reply-To). The first
  // paragraph names the couple + acknowledges the cold-reach so the
  // vendor doesn't read it as automated spam.
  supplier_outreach: (p) => {
    // Plain-text body uses real newlines; the renderer escapes them into
    // <br>s on the HTML side via per-paragraph splitting.
    const bodyParas = p.body
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const huParas: string[] = [
      `${p.coupleDisplayName} vagyunk a Weddly-n, és érdeklődnénk a szolgáltatásotok iránt.`,
      ...bodyParas,
      `Ha bármi felmerül, közvetlenül erre az e-mail címre válaszolhatsz: ${p.coupleReplyEmail}, ${p.coupleReplyName}.`,
    ];
    const enParas: string[] = [
      `We're ${p.coupleDisplayName}, planning our wedding with Weddly, and reaching out about your services.`,
      ...bodyParas,
      `Reply directly to this email and it'll land in our inbox: ${p.coupleReplyEmail}, ${p.coupleReplyName}.`,
    ];
    return {
      subject: `${p.coupleDisplayName}, ${p.subject}`,
      ctaUrl: p.outreachUrl,
      // Reply-To override sends the vendor's reply straight to the couple
      // owner's inbox instead of CONFIG.supportEmail. v1 has no inbound
      // webhook, so this header IS the entire reply pipeline: any plumbing
      // change here without the matching DNS work would silently drop
      // replies. The footer line in the body also surfaces the address so
      // a client that strips Reply-To (a few legacy webmails do) still
      // gives the vendor a way to copy + paste the right destination.
      replyTo: p.coupleReplyEmail,
      hu: {
        preheader: p.subject,
        greeting: `Szia ${p.supplierName}!`,
        paragraphs: huParas,
        cta: "Weddly-n keresztül érdeklődnek",
      },
      en: {
        greeting: `Hi ${p.supplierName},`,
        paragraphs: enParas,
        cta: "Sent via Weddly",
      },
    };
  },

  // A planner clicked "request access" against a couple's workspace. The couple
  // owns a Weddly account and must approve before the planner sees anything —
  // this mail points them at the Planners panel to accept/decline. Reply-To is
  // the planner's email so the couple can reach back out directly.
  planner_access_requested: (p, ctx) => ({
    subject: "Tervező hozzáférést kért / A planner requested access · Weddly",
    ctaUrl: `${CONFIG.frontendBaseUrl}/app/settings/workspace`,
    replyTo: p.replyToEmail,
    hu: {
      preheader: `${p.plannerLabel} hozzáférést kért a munkaterületetekhez.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.plannerLabel}** hozzáférést kért az esküvőtervező munkaterületetekhez a Weddly-n.`,
        "Csak akkor lát bármit, ha jóváhagyod. Nyisd meg a beállítások Tervezők részét, és fogadd el vagy utasítsd el a kérést.",
      ],
      cta: "Tervezők megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.plannerLabel}** has requested access to your Weddly workspace.`,
        "They can't see anything until you approve. Open the Planners section in settings to accept or decline.",
      ],
      cta: "Open planners",
    },
  }),

  // Free-form direct message a planner sends to their client couple. The
  // subject + body are user-entered; we slot the body into the branded shell
  // (one paragraph per line so the planner's breaks survive) and append a
  // signature footnote. Reply-To routes the couple's reply to the planner.
  planner_message: (p) => {
    const bodyParas = p.bodyText.split("\n");
    return {
      subject: p.subject,
      ctaUrl: CONFIG.frontendBaseUrl,
      replyTo: p.senderEmail,
      hu: {
        preheader: p.subject,
        greeting: "Szia!",
        paragraphs: bodyParas,
        cta: "Weddly megnyitása",
        footnote: `Küldő: ${p.senderName} (${p.senderEmail}) | Weddly`,
      },
      en: {
        greeting: "Hi there,",
        paragraphs: bodyParas,
        cta: "Open Weddly",
        footnote: `Küldő: ${p.senderName} (${p.senderEmail}) | Weddly`,
      },
    };
  },

  // The couple approved the planner's pending access request. Heads-up to the
  // planner that they can now enter the workspace from their dashboard.
  planner_access_approved: (p, ctx) => ({
    subject: "Ügyfél jóváhagyta a hozzáférést / Client approved your access · Weddly",
    ctaUrl: `${CONFIG.frontendBaseUrl}/app/planner`,
    hu: {
      preheader: `${p.coupleName} jóváhagyta a hozzáférési kérésedet.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.coupleName}** jóváhagyta a hozzáférési kérésedet.`,
        "Mostantól beléphetsz a munkaterületükre a tervező felületedről.",
      ],
      cta: "Tervező felület megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.coupleName}** approved your access request.`,
        "You can now enter their workspace from your planner dashboard.",
      ],
      cta: "Open planner dashboard",
    },
  }),

  // A couple invited this planner to their workspace. Heads-up to the planner
  // to accept/decline from their dashboard. Reply-To is the inviting couple
  // member's email when available so the planner can reply directly.
  planner_client_invite: (p, ctx) => ({
    subject: "Új ügyfél meghívó / New client invite · Weddly",
    ctaUrl: `${CONFIG.frontendBaseUrl}/app/planner`,
    replyTo: p.replyToEmail,
    hu: {
      preheader: `${p.coupleName} meghívott tervezőként.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.coupleName}** meghívott, hogy csatlakozz az ő Weddly munkaterületükhöz tervezőként.`,
        "Nyisd meg a Weddly tervező felületed, és fogadd el vagy utasítsd el a meghívót.",
      ],
      cta: "Meghívó megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.coupleName}** has invited you to join their Weddly workspace as their planner.`,
        "Open your Weddly planner dashboard to accept or decline.",
      ],
      cta: "Open invite",
    },
  }),

  // A planner invited someone who has no Weddly account yet to become their
  // client. The CTA carries the invitation token to the signup page. Once they
  // sign up + set up their wedding, the planner gets a pending access request
  // the couple still approves. Reply-To is the planner's email.
  planner_email_invite: (p) => ({
    subject: "Meghívó a Weddly-re / You're invited to Weddly · Weddly",
    ctaUrl: p.inviteUrl,
    replyTo: p.replyToEmail,
    hu: {
      preheader: `${p.plannerLabel} meghívott, hogy közösen tervezzétek az esküvőt a Weddly-n.`,
      greeting: "Szia!",
      paragraphs: [
        `**${p.plannerLabel}** meghívott, hogy közösen tervezzétek meg az esküvőtöket a Weddly-n.`,
        "Hozz létre egy fiókot, és állítsd be az esküvőtök munkaterületét. Ezután jóváhagyhatod, hogy a tervező hozzáférjen és segítsen a szervezésben.",
      ],
      cta: "Fiók létrehozása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `**${p.plannerLabel}** invited you to plan your wedding together on Weddly.`,
        "Create an account and set up your wedding workspace. You can then approve your planner so they can help organise everything.",
      ],
      cta: "Create your account",
    },
  }),

  // Confirmation for the /planners application. Doubles as the funnel's most
  // important nudge: a signed-out applicant only becomes a planner when they
  // register with the SAME email, so the CTA must carry them to signup.
  planner_waitlist_received: (p) => ({
    subject: "Megkaptuk a jelentkezésed / Application received · Weddly",
    ctaUrl: p.hasAccount
      ? `${CONFIG.frontendBaseUrl}/app/planner`
      : `${CONFIG.frontendBaseUrl}/signup`,
    hu: {
      preheader: "A szervezői hozzáférésed készen áll.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: p.hasAccount
        ? [
            "Köszönjük a jelentkezésed a Weddly tervezői programjába. A szervezői fiókod aktív, beléphetsz a tervező felületre.",
            "Töltsd ki a profilod (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban, és érkezhessenek a megkeresések.",
          ]
        : [
            "Köszönjük a jelentkezésed a Weddly tervezői programjába. A hozzáférésed készen áll.",
            "Már csak egy lépés van hátra: regisztrálj **ugyanezzel az e-mail címmel**, és a fiókod automatikusan szervezői fiókként jön létre.",
            "Ezután töltsd ki a profilod (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban.",
          ],
      cta: p.hasAccount ? "Tervező felület megnyitása" : "Fiók létrehozása",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs: p.hasAccount
        ? [
            "Thanks for applying to the Weddly planner programme. Your planner account is active and your dashboard is ready.",
            "Fill in your profile (business name and city) to appear in the planner directory couples browse, so inquiries can start coming in.",
          ]
        : [
            "Thanks for applying to the Weddly planner programme. Your access is ready.",
            "One step left: create an account with **this same email address** and it will automatically be set up as a planner account.",
            "Then fill in your profile (business name and city) to appear in the planner directory couples browse.",
          ],
      cta: p.hasAccount ? "Open planner dashboard" : "Create your account",
    },
  }),

  // Admin-triggered "get into your planner account" mail for an accepted
  // applicant stuck on "Regisztrációra vár" (see admin_planners handleSendInvite).
  // Transactional, not outreach: the hasAccount branch goes to a real account
  // holder, so the outreach "you have no account" footer would be false.
  // hasAccount=false → register with the SAME email (auto-grants planner);
  // hasAccount=true → the admin already granted planner on their existing
  // account, so the CTA just carries them to sign in.
  planner_access_invite: (p) => ({
    subject: "A tervezői fiókod készen áll / Your planner account is ready · Weddly",
    ctaUrl: p.hasAccount
      ? `${CONFIG.frontendBaseUrl}/app/planner`
      : `${CONFIG.frontendBaseUrl}/signup`,
    hu: {
      preheader: p.hasAccount
        ? "A tervezői felületed készen áll, lépj be."
        : "Már csak egy lépés: hozd létre a fiókod.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: p.hasAccount
        ? [
            "Aktiváltuk a tervezői hozzáférésed a meglévő Weddly-fiókodon, mostantól eléred a tervező felületet.",
            "Lépj be az alábbi gombbal, és folytasd a profilod kitöltésével (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban.",
          ]
        : [
            "Elfogadtuk a jelentkezésed a Weddly tervezői programjába, és a hozzáférésed készen áll.",
            "Már csak egy lépés van hátra: regisztrálj **ugyanezzel az e-mail címmel**, és a fiókod automatikusan tervezői fiókként jön létre.",
          ],
      cta: p.hasAccount ? "Belépés a fiókba" : "Fiók létrehozása",
    },
    en: {
      preheader: p.hasAccount
        ? "Your planner dashboard is ready, sign in."
        : "One step left: create your account.",
      greeting: `Hi ${p.plannerName},`,
      paragraphs: p.hasAccount
        ? [
            "We have activated your planner access on your existing Weddly account, so your planner dashboard is now ready.",
            "Sign in with the button below and finish your profile (business name and city) to appear in the planner directory couples browse.",
          ]
        : [
            "We have accepted your application to the Weddly planner programme, and your access is ready.",
            "One step left: sign up with **this same email address** and your account is set up as a planner automatically.",
          ],
      cta: p.hasAccount ? "Sign in" : "Create your account",
    },
  }),

  // The resolution of a couple's planner invite. The couple asked, the planner
  // answered. Without this mail an accept is invisible until the couple
  // happens to reopen their settings page.
  planner_invite_outcome: (p, ctx) => ({
    subject: p.accepted
      ? "A szervező elfogadta a meghívásod / Your planner accepted · Weddly"
      : "A szervező elutasította a meghívásod / Your planner declined · Weddly",
    ctaUrl: p.accepted
      ? `${CONFIG.frontendBaseUrl}/app/settings/workspace`
      : `${CONFIG.frontendBaseUrl}/app/vendors`,
    replyTo: p.accepted ? p.replyToEmail : undefined,
    hu: {
      preheader: p.accepted
        ? `${p.plannerLabel} elfogadta a meghívásod.`
        : `${p.plannerLabel} elutasította a meghívásod.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: p.accepted
        ? [
            `**${p.plannerLabel}** elfogadta a meghívásod, mostantól hozzáfér a munkaterületetekhez, és segíthet a szervezésben.`,
            "A hozzáférését bármikor visszavonhatod a munkaterület beállításai között.",
          ]
        : [
            `**${p.plannerLabel}** most nem tudta elfogadni a meghívásod.`,
            "A szervezői ajánlóban találsz további esküvőszervezőket, akiket felkérhetsz.",
          ],
      cta: p.accepted ? "Munkaterület beállítások" : "Szervezők böngészése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: p.accepted
        ? [
            `**${p.plannerLabel}** accepted your invite and can now access your workspace to help with the planning.`,
            "You can withdraw their access any time from your workspace settings.",
          ]
        : [
            `**${p.plannerLabel}** couldn't accept your invite right now.`,
            "You'll find more wedding planners to reach out to in the planner directory.",
          ],
      cta: p.accepted ? "Open workspace settings" : "Browse planners",
    },
  }),

  // Double opt-in confirm for the landing/blog newsletter capture. The address
  // gets NOTHING further unless this link is clicked, and the copy says so —
  // that's the Grtv. §6 posture in one sentence.
  newsletter_confirm: (p) => ({
    subject: "Erősítsd meg a feliratkozásod / Confirm your subscription · Weddly",
    ctaUrl: p.confirmUrl,
    hu: {
      preheader: "Egy kattintás, és kész a feliratkozás.",
      greeting: "Szia!",
      paragraphs: [
        "Valaki, reméljük, te, feliratkozott erre a címre a Wēddly hírlevelére: esküvőtervezési tippek és termékújdonságok, nagyjából havi egy-két levél.",
        "Ha te voltál, erősítsd meg az alábbi gombbal. Ha nem, nincs teendőd: e nélkül a kattintás nélkül erre a címre nem küldünk több levelet.",
      ],
      cta: "Feliratkozás megerősítése",
      footnote: "A link 7 napig érvényes. Minden levelünkben lesz egykattintásos leiratkozás.",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        "Someone, hopefully you, signed this address up for the Weddly newsletter: wedding-planning tips and product news, roughly one or two emails a month.",
        "If that was you, confirm below. If not, do nothing: without this click we won't send anything else to this address.",
      ],
      cta: "Confirm subscription",
      footnote: "The link is valid for 7 days. Every email includes a one-click unsubscribe.",
    },
  }),

  // An admin's free-form reply to an in-product feedback submission. The reply
  // body is the admin's text verbatim (already written in the submitter's
  // language); the original message is quoted back so they remember the thread.
  // Reply-To is support so a further reply lands in a monitored inbox.
  admin_feedback_reply: (p, ctx) => {
    const split = splitParagraphs(p.replyText);
    const paras = split.length > 0 ? split : [p.replyText.trim()];
    const quote = p.originalMessage
      ? p.originalMessage.replace(/\s+/g, " ").trim().slice(0, 180)
      : null;
    const quoteHu = quote ? `A visszajelzésed: „${quote}”` : null;
    const quoteEn = quote ? `Your feedback: “${quote}”` : null;
    return {
      subject: "Válasz a visszajelzésedre / Reply to your feedback · Weddly",
      ctaUrl: CONFIG.frontendBaseUrl,
      replyTo: CONFIG.supportEmail,
      hu: {
        preheader: "Reagáltunk a Weddly-nek küldött visszajelzésedre.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [...(quoteHu ? [quoteHu] : []), ...paras],
        cta: "Weddly megnyitása",
        footnote: "Erre az e-mailre válaszolva a Weddly csapatához jutsz.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [...(quoteEn ? [quoteEn] : []), ...paras],
        cta: "Open Weddly",
        footnote: "You can reply to this email and it reaches the Weddly team.",
      },
    };
  },
};

function rsvpStatusHu(status: "yes" | "no" | "maybe"): string {
  if (status === "yes") return "ott lesz";
  if (status === "no") return "nem tud jönni";
  return "talán";
}

function rsvpStatusEn(status: "yes" | "no" | "maybe"): string {
  if (status === "yes") return "attending";
  if (status === "no") return "can't make it";
  return "maybe";
}

/** "Eddig a vendégek 34%-a válaszolt (12/35)." Returns null when there are no
 *  guests to divide by, so the builder drops the line cleanly. */
function rsvpProgressLineHu(p?: RsvpProgress): string | null {
  if (!p || p.total === 0) return null;
  return `Eddig a vendégek ${p.pct}%-a válaszolt (${p.responded}/${p.total}).`;
}
function rsvpProgressLineEn(p?: RsvpProgress): string | null {
  if (!p || p.total === 0) return null;
  return `So far ${p.pct}% of your guests have replied (${p.responded}/${p.total}).`;
}

function rsvpReceivedSubject(p: RsvpReceivedForCouplePayload): string {
  if (p.rsvpStatus === "yes") return `${p.guestName} jön / ${p.guestName} is in`;
  if (p.rsvpStatus === "no") return `${p.guestName} sajnos nem / ${p.guestName} can't make it`;
  return `${p.guestName} talán / ${p.guestName} responded "maybe"`;
}

function rsvpHouseholdSubject(p: RsvpReceivedHouseholdForCouplePayload): string {
  // Try to give a tight, scannable preview without leaking the whole list
  // into the subject line. Up to 2 names, then "+N".
  const names = p.guests.map((g) => g.name);
  const headHu =
    names.length <= 2 ? names.join(" + ") : `${names.slice(0, 2).join(" + ")} +${names.length - 2}`;
  const yesCount = p.guests.filter((g) => g.rsvpStatus === "yes").length;
  const tally =
    yesCount === p.guests.length
      ? "mind jön / all in"
      : yesCount > 0
        ? `${yesCount}/${p.guests.length} jön / ${yesCount}/${p.guests.length} in`
        : "válasz / response";
  return `${headHu}: ${tally}`;
}

function rsvpThanksDetailHu(p: RsvpThanksForGuestPayload): string {
  if (p.rsvpStatus === "yes") {
    return p.weddingDate
      ? `Találkozunk ${p.weddingDate}-n. Ha valami változna, a lenti gombbal bármikor módosíthatod.`
      : "Találkozunk! Ha valami változna, a lenti gombbal bármikor módosíthatod.";
  }
  if (p.rsvpStatus === "no") {
    return "Sajnáljuk, hogy nem tudsz jönni, köszönjük, hogy szóltál. Ha mégis változna, a lenti linken bármikor módosíthatod.";
  }
  return "Köszönjük a választ. Ha biztos lesz, a lenti linken bármikor módosíthatod a választ.";
}

function rsvpThanksDetailEn(p: RsvpThanksForGuestPayload): string {
  if (p.rsvpStatus === "yes") {
    return p.weddingDate
      ? `See you on ${p.weddingDate}. Use the link below if anything changes.`
      : "See you there. Use the link below if anything changes.";
  }
  if (p.rsvpStatus === "no") {
    return "Sorry you can't make it, thanks for letting us know. The link below stays open if plans change.";
  }
  return "Thanks for letting us know. You can update your answer any time using the link below.";
}

// Splits the admin's free-text body on blank-line boundaries (`\n\s*\n`) into
// paragraph chunks the renderer can wrap in <p> tags. Single newlines inside
// a paragraph are preserved as a space, most admins type prose, not lists.
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.replace(/\s*\n\s*/g, " ").trim())
    .filter((chunk) => chunk.length > 0);
}

/** Join a list into a natural sentence fragment: `["a","b","c"]` → `"a, b {conj} c"`.
 *  `conj` is the localised "and" ("és" / "and"). Empty → "", single → itself. */
function joinNaturalList(items: string[], conj: string): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

// UTM tagging on every CTA. Centralised here so future kinds inherit it
// without each builder having to remember. `utm_medium` mirrors the category
// (transactional / lifecycle / outreach) so analytics dashboards can segment
// without re-deriving from the campaign name. `utm_content=cta` reserves the
// `cta` slot for the primary button, secondary links (when we add them) can
// pass their own utm_content via a different helper.
function appendEmailUtm(url: string, kind: EmailKind, category: EmailCategory): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Don't clobber tracking params the builder already set deliberately.
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "email");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", category);
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", kind);
    if (!u.searchParams.has("utm_content")) u.searchParams.set("utm_content", "cta");
    return u.toString();
  } catch {
    // Builder handed us a non-URL (shouldn't happen, but don't crash the
    // mail-send path for an analytics nicety).
    return url;
  }
}

function humanReportReasonHu(reason: string): string {
  switch (reason) {
    case "spam":
      return "spam vagy reklám";
    case "fake":
      return "úgy tűnik, hamis adat";
    case "offensive":
      return "sértő tartalom";
    case "wrong_info":
      return "rossz vagy elavult adat";
    case "other":
      return "egyéb";
    default:
      return reason;
  }
}

function humanReportReasonEn(reason: string): string {
  switch (reason) {
    case "spam":
      return "spam or advertising";
    case "fake":
      return "looks fake";
    case "offensive":
      return "offensive content";
    case "wrong_info":
      return "wrong or outdated info";
    case "other":
      return "other";
    default:
      return reason;
  }
}

function vendorWaitlistDecisionPreheader(
  outcome: "accepted" | "under_review" | "rejected",
  locale: "hu" | "en",
): string {
  if (locale === "hu") {
    if (outcome === "accepted") return "Megnéztük a jelentkezésed.";
    if (outcome === "under_review") return "A jelentkezésed ellenőrzés alatt.";
    return "Válasz a jelentkezésedre.";
  }
  if (outcome === "accepted") return "We reviewed your submission.";
  if (outcome === "under_review") return "Your submission is under review.";
  return "Response to your submission.";
}
