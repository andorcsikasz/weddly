// Per-kind email copy. The dispatcher (`send.ts`) calls one of these to
// produce the rendered HTML/text + the subject line. Keep the copy here so
// translators can find every string in one place; long-form content stays
// out of the dispatcher's plumbing code.

import { VENDOR_EARLY_CAP, VENDOR_FOUNDING_CAP } from "@shared/vendor_billing";
import type { UiLocale } from "@shared/locales";
import { CONFIG } from "../../config";
import { type EmailCategory, type EmailKind, KIND_CATEGORY } from "./kinds";
import {
  type LocaleBlock,
  type ExtraLocale,
  type RecipientLocale,
  type RenderedEmail,
  type WhyLineOverride,
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
export interface WelcomeAccountPayload {
  /** Where the account starts — the onboarding wizard / dashboard. */
  dashboardUrl: string;
  /** How the account was born. `password` means they just clicked the verify
   *  link (so the copy can say "confirmed"); `google` / `apple` means the
   *  provider attested the address and this is the FIRST mail they ever get
   *  from us, so it has to carry the welcome on its own. */
  via: "password" | "google" | "apple";
}
export interface PartnerWelcomePayload {
  /** The partner who sent the invite, for the opening line. */
  inviterName: string;
  /** Shared workspace name, when it's a real one. */
  coupleDisplayName?: string;
  dashboardUrl: string;
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
export interface NameReviewNoticePayload {
  /** The names as they stand on the workspace, e.g. "x & y". Quoted back so
   *  the couple knows exactly which workspace and which words we mean. */
  currentNames: string;
  /** Localised deadline, computed by the caller so the copy stays simple. */
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
  /** Free text the guest left for the couple on the RSVP
   *  (`households.guest_message`), quoted in the body when present. Absent for
   *  the vast majority of submissions, and absent is not the same as empty:
   *  only a message written in THIS submission is worth mailing, or every
   *  later RSVP from the same household would re-send it. */
  guestMessage?: string | null;
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
  /** See `RsvpReceivedForCouplePayload.guestMessage`. */
  guestMessage?: string | null;
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
export interface TrialEndedPayload {
  /** Deep link to the invite-partner surface — the route that keeps the
   *  workspace open at no cost, so it is the primary CTA. */
  inviteUrl: string;
  /** The subscription settings tab, for the couple who would rather just pay
   *  than wait on someone else. */
  billingUrl: string;
  /** Localised deadline (the day the grace window closes), pre-formatted per
   *  recipient locale so the template never guesses at a date format. */
  graceEndsLabel: string;
  /** Days left in the grace window at send time. Named so the copy and the
   *  entitlement gate quote one number. */
  graceDays: number;
  /** Workspace name, when it has one, so the mail is about THEIR wedding. */
  coupleDisplayName: string | null;
}
export interface PartnerInviteReminderPayload {
  /** Deep link straight to the dashboard's invite-partner anchor, so the
   *  recipient lands on the form they need to fill out. */
  invitePartnerUrl: string;
  /** Optional couple display name for a warmer body ("Mia & Lucas"). */
  coupleDisplayName?: string;
}
export interface HoneymoonNudgePayload {
  /** Deep link to /app/honeymoon, the planner this mail exists to drive into. */
  honeymoonUrl: string;
  /** Whole days between today and the wedding, 14..90. Drives the opening
   *  line, so the nudge reads as "you specifically" rather than a blast. */
  daysUntil: number;
  /** Optional couple display name for a warmer preheader ("Mia & Lucas"). */
  coupleDisplayName?: string;
}
export interface ComebackNudgePayload {
  /** Deep link to /app, the workspace this mail exists to pull them back into. */
  appUrl: string;
  /** Whole days since anyone in the workspace was last seen, >= 21. Rounded to
   *  weeks in the copy, since "22 nap" reads as surveillance and "három hete"
   *  reads as a friend noticing. */
  daysAway: number;
  /** Days until the wedding when a date is set. Drives the "there's still time"
   *  line; omitted for a couple who hasn't picked a date. */
  daysUntilWedding?: number;
  /** Optional couple display name for a warmer preheader ("Mia & Lucas"). */
  coupleDisplayName?: string;
}
export interface WhatsNewPayload {
  /** Deep link to /app, the workspace this mail exists to pull them back into. */
  appUrl: string;
  /** Whole days since anyone in the workspace was last seen, >= 30. Rounded to
   *  weeks in the copy for the same reason as the comeback nudge: an exact day
   *  count reads as surveillance. */
  daysAway: number;
  /** Days until the wedding when a date is set. Omitted for a couple with no
   *  date, who get the "no date yet, that's fine" close instead. */
  daysUntilWedding?: number;
  /** Optional couple display name for a warmer preheader ("Mia & Lucas"). */
  coupleDisplayName?: string;
}
export interface PostWeddingReviewPayload {
  /** Deep link to /app/rate-vendors, the one-click star surface. */
  ctaUrl: string;
  /** Names of the vendors the couple picked, listed in the body so the ask is
   *  concrete ("rate THESE") rather than abstract. May be empty. */
  vendorNames: string[];
}
export interface WeddingFarewellPayload {
  /** Couple display name, so the congratulation names them. */
  coupleDisplayName: string;
  /** Primary CTA: the feedback surface. Always present — every couple can tell
   *  us how it went, whether or not they picked vendors here. */
  ctaUrl: string;
  /** Secondary CTA: /app/rate-vendors. Null when the couple has no vendor left
   *  to rate, in which case the link is omitted rather than pointing at an
   *  empty page. */
  reviewUrl: string | null;
}
export interface FoundingPartnerPushPayload {
  /** Deep link to the dashboard's invite-partner anchor. Signing in is the
   *  fastest path for a recipient who is already logged in on this device. */
  invitePartnerUrl: string;
  /** The real, live `/invite/{token}` link. Rendered as plain copyable text
   *  under the button so the recipient can paste it into whatever channel
   *  they actually talk to their partner in. */
  inviteUrl: string;
  /** Prefilled `mailto:` carrying the same invite link, for the one-click
   *  "just send it for me" path. */
  shareMailtoUrl: string;
  /** Founding slots still unclaimed at send time. Read live off
   *  `FOUNDING_CAP - foundingSlotsUsed()` so the number is never a fiction. */
  spotsLeft: number;
  /** Optional couple display name for a warmer body ("Mia & Lucas"). */
  coupleDisplayName?: string;
  /** 0-based send index. Selects the copy variant so three reminders about
   *  the same thing never read identically. */
  variant: number;
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
export interface PauseFeedbackRequestPayload {
  /** "Mia & Lucas", so the couple knows which workspace this is about. Empty
   *  when the display name is a placeholder / purged. */
  coupleDisplayName?: string;
  /** Opens the feedback form with their address prefilled, on the PUBLIC page,
   *  because the recipient has stopped signing in and a login wall between a
   *  question and its answer is how you get no answer. */
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

export interface VendorRemovalConfirmedPayload {
  /** The business name as it appeared on the listing we just took down. Named
   *  in the body so the recipient can tell WHICH entry this was about without
   *  going and looking, which matters when the request was made weeks ago. */
  businessName: string;
  /** Vendor registration (`/vendors`). The whole point of the second half of
   *  the mail: the listing came down because they asked, and the door is open
   *  if they ever want one on their own terms. */
  registerUrl: string;
}

export interface VendorProfileSharePayload {
  /** Vendor business name, used in the greeting. Falls back to a generic
   *  greeting when empty. */
  businessName: string;
  /** The vendor's PUBLIC profile URL (`/vendors/<listing id>`). This is the CTA
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
   *  named in the body; when all three are false the "finish your profile"
   *  paragraph is dropped entirely and the mail is pure share + reviews.
   *
   *  An empty availability calendar is deliberately NOT one of them: it means
   *  the vendor has nothing booked, not that a section is blank. */
  missing: {
    photos: boolean;
    bio: boolean;
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
    cover: boolean;
    gallery: boolean;
    description: boolean;
    contact: boolean;
    pricing: boolean;
    capacity: boolean;
    packages: boolean;
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

/** Cold invite to a wedding planner a Weddly user named. The account is already
 *  provisioned (dormant) when this goes out, so the CTA is a real take-over, not
 *  a sign-up form. Rendered single-language off `locale`, which also picks the
 *  subject: a Hungarian subject line on a planner who works in English reads as
 *  spam. */
export interface PlannerSuggestedInvitePayload {
  /** Person we greet. Falls back to the business name when the list only had one. */
  plannerName: string;
  /** Business the account was opened under. */
  businessName: string;
  /** Full activation URL with the single-use token. One click to take over. */
  activateUrl: string;
  /** Human date the guest window runs until, already formatted for `locale`. */
  guestUntil: string;
  locale: "hu" | "en";
}

export interface CommunitySupplierVerifyPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Full URL the recipient clicks to confirm, includes the single-use token. */
  verifyUrl: string;
  /** Whether the row came from a couple putting this business forward rather
   *  than the business submitting itself. Same rule as the claim invite: the
   *  warm sentence renders only where it is true, and here it usually IS true,
   *  which is exactly why the flat "someone added your business" was worth
   *  replacing. */
  suggestedByUser: boolean;
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
  /** The listing's own PUBLIC page, exactly as a couple sees it, shown in the
   *  body as its own link. This is what makes a cold mail checkable instead of
   *  merely assertive: every claim the copy makes about the page is one
   *  untracked click from being confirmed or caught out. */
  listingUrl: string;
  /** Free months the live offer grants, 12 or 3. 0 when both cohorts are full,
   *  in which case the copy drops the free-window sentence entirely rather than
   *  promising something the claim would not honour. */
  freeMonths: number;
  /** The recipient's language, not a hu/en flag: it picks the subject line and
   *  which `extra` card renders. Anything pre-translated for the copy (the
   *  category label) is narrowed by the caller, since those tables are hu/en. */
  locale: UiLocale;
}

/** Review-invite campaign to a CLAIMED vendor: reviews are now open to anyone,
 *  here is your own public review link to forward to past clients. Rendered
 *  single-language off `locale`. */
export interface VendorReviewCampaignPayload {
  /** The vendor's business name, used in the greeting. */
  businessName: string;
  /** The vendor's clean public page URL, shown in the body as "your link" so it
   *  can be copied straight out of the mail. */
  reviewUrl: string;
  /** The `?review=1` deep-link variant behind the WhatsApp/email share buttons,
   *  landing a past client on the review composer. */
  shareUrl: string;
  /** Tracked redirect for the CTA button; the click is the reminder gate. */
  ctaUrl: string;
  /** Pre-filled WhatsApp share (`https://wa.me/?text=...`), a secondary link. */
  whatsappUrl: string;
  /** Pre-filled mailto draft, a secondary link. */
  mailtoUrl: string;
  /** In-app reviews page where the durable copy/share widget lives. */
  dashboardUrl: string;
  locale: "hu" | "en";
}

export interface PersonalInvitePayload {
  /** The contact's name, for the greeting. May be empty. */
  name: string;
  /** The register CTA, carrying the campaign UTM. Same as the plain link shown
   *  in the body so it can be copied straight out of the mail. */
  ctaUrl: string;
  locale: "hu" | "en";
}

export interface OnboardingCampaignPayload {
  /** The account holder's name, for the greeting. May be empty. */
  name: string;
  /** The /onboarding CTA, carrying the campaign UTM. */
  ctaUrl: string;
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

export interface VendorMovedToPlannerPayload {
  /** The business name their vendor account carried, so they recognise it. */
  businessName: string;
  /** Where their account lives now, typically /planner. */
  plannerUrl: string;
}

/** How the recipient can act on this message, which decides how much of it the
 *  mail carries.
 *
 *  - `in_account` — the inquiry is sitting in their Weddly client list. The
 *    mail is a NOTIFICATION: who wrote, about what, for which date, when. The
 *    message itself stays in the product, which is where the vendor answers it
 *    and where every other lead they have already lives.
 *  - `account` — they have a Weddly vendor account, but this inquiry did not
 *    land in it (FREE plan, direct inquiries are PRO). The mail has to carry
 *    the message, because nothing else will show it to them.
 *  - `claim` — nobody has claimed the listing, so there is no account at all.
 *    Same full message, and the CTA is their own profile, where the claim
 *    notice is.
 *
 *  The rule behind the split: never withhold a message from someone who has no
 *  other way to read it. Only `in_account` is a teaser, and only because the
 *  full text is one click away behind their own login. */
export type SupplierOutreachMode = "in_account" | "account" | "claim";

export interface SupplierOutreachPayload {
  /** "Mia & Lucas", couple's display name. Used in the From label and the
   *  opening line so the vendor knows who's writing. */
  coupleDisplayName: string;
  /** Couple owner's email. Lands in the Reply-To header so the vendor's
   *  reply goes straight to the couple's inbox — on the two modes where the
   *  mail IS the channel. `in_account` deliberately doesn't set it. */
  coupleReplyEmail: string;
  /** Couple owner's full name. Surfaces in the closing line of the email. */
  coupleReplyName: string;
  /** Vendor business name. Renders in the greeting + the subject line. */
  supplierName: string;
  /** Subject line the couple typed in the composer. Doubles as the "topic"
   *  fact in the notification mode, so it's the one piece of the couple's
   *  own words that always ships. */
  subject: string;
  /** Body text the couple typed. Plain text, newlines preserved by the
   *  renderer. Rendered on `account` / `claim` only. */
  body: string;
  /** Where the CTA lands: the inquiry in their client list, their vendor
   *  dashboard, or their public profile with the claim notice. */
  outreachUrl: string;
  /** See `SupplierOutreachMode`. */
  mode: SupplierOutreachMode;
  /** Couple's wedding date, ISO `YYYY-MM-DD`, or `""` when they haven't
   *  picked one. The single most useful fact a vendor needs before opening
   *  anything: is that date even free? */
  eventDate: string;
  /** When the couple sent it, epoch ms. Renders as a date + time so a vendor
   *  reading a day later knows how warm the lead is. */
  sentAt: number;
  /** `in_account` only: whether this vendor can actually answer inside Weddly.
   *  Replying on the booking thread is PRO, so a FREE vendor told to "reply
   *  there" walks into a paywall. The mail must promise only what the plan can
   *  do; the lead itself, and the couple's address on the client card, are FREE
   *  either way. Ignored on `account` / `claim`, where the mail is the channel. */
  canReplyInApp?: boolean;
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

/** A vendor answered on the booking thread. Deliberately carries NO replyTo:
 *  the conversation now has a home in the product, and the supplier_outreach
 *  `in_account` branch set the precedent of withholding Reply-To to keep it
 *  there. The body is quoted so the couple can judge urgency from the inbox. */
export interface VendorMessagePayload {
  /** Listing name, bold in the opening line. */
  vendorName: string;
  /** The vendor's own text, one paragraph per line. */
  bodyText: string;
  /** Rendered as a "N attachment(s)" line; the files themselves are behind the
   *  authenticated download route, never attached to the mail (the mailer has
   *  no attachment support and these are contracts). */
  attachmentCount: number;
  /** App-relative path to the thread, e.g. /app/messages/188. */
  threadUrl: string;
}

/** A couple wrote back on the booking thread. Same no-replyTo reasoning. */
export interface CoupleMessagePayload {
  coupleName: string;
  bodyText: string;
  threadUrl: string;
}

/** The vendor's own acknowledgement, fired by the automation layer the moment
 *  an inquiry lands. `bodyText` is the vendor's canned reply with its tokens
 *  already substituted; the copy around it says plainly that a machine sent it,
 *  so the couple never mistakes an acknowledgement for the real answer. */
export interface VendorAutoReplyPayload {
  vendorName: string;
  bodyText: string;
  threadUrl: string;
}

/** Automation, to the VENDOR: a couple is still waiting. The hours come from
 *  `vendorAttention`, so the number in the mail is the number on their own
 *  attention band. */
export interface VendorLeadReminderPayload {
  coupleName: string;
  /** ISO 'YYYY-MM-DD'. */
  eventDate: string;
  waitingHours: number;
  /** App-relative path to the client card. */
  clientUrl: string;
}

/** Automation, to the COUPLE, and only after the vendor clicked Approve. */
export interface VendorReviewRequestPayload {
  vendorName: string;
  /** ISO 'YYYY-MM-DD'. */
  eventDate: string;
  /** Absolute URL of the vendor's public page, deep-linked to the composer. */
  reviewUrl: string;
}

/** A vendor sent a priced offer against the inquiry. Same no-replyTo reasoning
 *  as the message pair: the offer has a home in the product, and answering it
 *  is a button there, not a sentence in a reply. */
export interface VendorQuotePayload {
  /** Listing name, bold in the opening line. */
  vendorName: string;
  /** The vendor's own title for the offer ("Teljes napos csomag"). */
  title: string;
  /** ALREADY FORMATTED money, in the quote's own currency. The template never
   *  does currency math: a workspace picks its currency and only the call site
   *  knows which `formatMoney` locale pair applies. */
  totalText: string;
  /** ISO YYYY-MM-DD, or null for an offer with no deadline. Rendered as-is:
   *  a date the vendor typed is unambiguous in both languages. */
  validUntil: string | null;
  /** App-relative path to the offer, e.g. /app/messages/188. */
  quoteUrl: string;
}

/** The couple answered the offer. One kind for both outcomes, because the
 *  vendor is waiting on the same question either way, and the builder branches
 *  on `accepted` for the subject and the body. */
export interface QuoteResponsePayload {
  /** Couple display name ("Mia & Lucas"), bold in the opening line. */
  coupleName: string;
  title: string;
  /** ALREADY FORMATTED money, see `VendorQuotePayload.totalText`. */
  totalText: string;
  accepted: boolean;
  /** What the couple typed when declining, if anything. Quoted verbatim: it is
   *  the vendor's only way to learn why, which is the difference between a lost
   *  lead and a lesson. Null on an accepted quote. */
  declineReason: string | null;
  /** App-relative path to the offer on the vendor's side, e.g.
   *  /vendor/clients/188. */
  quoteUrl: string;
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

/** Where the /planners confirmation mail has to send this applicant.
 *  - `register`: no Weddly account owns this address, so the grant lands when
 *    they sign up with it (CTA → /signup).
 *  - `planner_dashboard`: the address already has an account and it now holds
 *    the planner grant, so there is nothing to register (CTA → /app/planner,
 *    which routes on to onboarding until that's done).
 *  - `sign_in`: the address has an account we deliberately don't flip on a
 *    public form (vendor, admin, suspended), so the only honest CTA is their
 *    own front door while a human sorts the planner side out. */
export type PlannerWaitlistNextStep = "register" | "planner_dashboard" | "sign_in";

export interface PlannerWaitlistReceivedPayload {
  /** Applicant's name, used in the greeting. */
  plannerName: string;
  /** Resolved from the ACCOUNT that owns the applied-with address, never from
   *  whether the applicant happened to be signed in: telling someone who
   *  registered months ago to "register with this same email" funnels them
   *  into a signup that can only 409 on their own address. */
  nextStep: PlannerWaitlistNextStep;
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

export interface VisitorVerifyPayload {
  /** Confirm link ({FRONTEND_BASE_URL}/visitor/verify/…) that verifies the
   *  visitor's email and, once clicked, lets them suggest suppliers + review. */
  verifyUrl: string;
}

export type KindPayload = {
  welcome_verify: WelcomeVerifyPayload;
  welcome_account: WelcomeAccountPayload;
  partner_welcome: PartnerWelcomePayload;
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
  founding_partner_push: FoundingPartnerPushPayload;
  partner_left_workspace: PartnerLeftWorkspacePayload;
  couple_paused: CouplePausedPayload;
  pause_feedback_request: PauseFeedbackRequestPayload;
  couple_pause_cancelled: CouplePauseCancelledPayload;
  account_purged: AccountPurgedPayload;
  account_admin_purged: AccountAdminPurgedPayload;
  account_flagged: AccountFlaggedPayload;
  name_review_notice: NameReviewNoticePayload;
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
  trial_ended: TrialEndedPayload;
  honeymoon_nudge: HoneymoonNudgePayload;
  comeback_nudge: ComebackNudgePayload;
  whats_new_2026_07: WhatsNewPayload;
  post_wedding_review_request: PostWeddingReviewPayload;
  wedding_farewell: WeddingFarewellPayload;
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
  vendor_removal_confirmed: VendorRemovalConfirmedPayload;
  planner_profile_incomplete: PlannerProfileIncompletePayload;
  planner_waitlist_decision: PlannerWaitlistDecisionPayload;
  planner_provisioned: PlannerProvisionedPayload;
  planner_onboarding_invite: PlannerOnboardingInvitePayload;
  planner_suggested_invite: PlannerSuggestedInvitePayload;
  community_supplier_verify: CommunitySupplierVerifyPayload;
  community_supplier_published: CommunitySupplierPublishedPayload;
  community_supplier_rejected: CommunitySupplierRejectedPayload;
  community_supplier_reported: CommunitySupplierReportedPayload;
  vendor_claim_campaign: VendorClaimCampaignPayload;
  vendor_claim_campaign_reminder: VendorClaimCampaignPayload;
  vendor_review_campaign: VendorReviewCampaignPayload;
  vendor_review_campaign_reminder: VendorReviewCampaignPayload;
  personal_invite: PersonalInvitePayload;
  onboarding_campaign: OnboardingCampaignPayload;
  onboarding_campaign_reminder: OnboardingCampaignPayload;
  vendor_claim_verify: VendorClaimVerifyPayload;
  vendor_claim_admin_alert: VendorClaimAdminAlertPayload;
  vendor_claim_approved: VendorClaimApprovedPayload;
  vendor_moved_to_planner: VendorMovedToPlannerPayload;
  supplier_outreach: SupplierOutreachPayload;
  vendor_message: VendorMessagePayload;
  vendor_auto_reply: VendorAutoReplyPayload;
  vendor_lead_reminder: VendorLeadReminderPayload;
  vendor_review_request: VendorReviewRequestPayload;
  couple_message: CoupleMessagePayload;
  vendor_quote: VendorQuotePayload;
  quote_response: QuoteResponsePayload;
  planner_access_requested: PlannerAccessRequestedPayload;
  planner_message: PlannerMessagePayload;
  planner_access_approved: PlannerAccessApprovedPayload;
  planner_client_invite: PlannerClientInvitePayload;
  planner_email_invite: PlannerEmailInvitePayload;
  planner_waitlist_received: PlannerWaitlistReceivedPayload;
  planner_access_invite: PlannerAccessInvitePayload;
  planner_invite_outcome: PlannerInviteOutcomePayload;
  newsletter_confirm: NewsletterConfirmPayload;
  visitor_verify: VisitorVerifyPayload;
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
    extra: built.extra,
    ctaUrl,
    category,
    plainCtaUrl: built.plainCtaUrl,
    unsubscribeToken: context.unsubscribeToken,
    recipientLocale: context.recipientLocale,
    primaryLocaleHint: context.primaryLocaleHint,
    trackingPixelUrl: context.trackingPixelUrl,
    whyLine: built.whyLine,
  });
  return { subject: built.subject, rendered, replyTo: built.replyTo };
}

interface RawTemplate {
  subject: string;
  hu: LocaleBlock;
  en: LocaleBlock;
  /** Copy for the locales that shipped after the HU/EN split. Entirely
   *  optional per kind: a kind with no block for the recipient's language
   *  renders its English card, so translating one mail never touches the
   *  other ninety. See `pickBlocks` in ./template. */
  extra?: Partial<Record<ExtraLocale, LocaleBlock>>;
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
  /** Overrides the footer's per-category "why am I getting this" line. See
   *  `RenderInput.whyLine`. Two kinds need it: `planner_suggested_invite` and
   *  `vendor_removal_confirmed`, both because the stock category line makes a
   *  claim about having an account that their own body copy contradicts. */
  whyLine?: WhyLineOverride;
}

type Builder<K extends EmailKind> = (payload: KindPayload[K], ctx: BuildContext) => RawTemplate;

/** Free-window closer for the claim-invite copy. Returns "" once both free
 *  cohorts are full, and the caller filters the empty paragraph out: silence
 *  is the honest option there, since the claim would only grant a 3-day trial
 *  and promising anything else would be a bait.
 *
 *  Three rules the copy must keep:
 *    - State the offer that IS on the table, never the one that ran out. The
 *      three-month tier used to open with "the founding year is gone, but…",
 *      which spends the first half of the sentence on a loss.
 *    - Never mention cards, not even to say none is needed. Raising the word at
 *      all plants the idea that a card might be involved somewhere.
 *    - Never front the cap. "The first 500 vendors get a full year" tells the
 *      reader two things we did not want to say: that they are one row of a
 *      mass mailing, and that the welcome is really a queue. The window is
 *      framed as hospitality instead ("you are our guest"), with the thing they
 *      GET after the colon and no number anywhere.
 *
 *  Scarcity stays qualitative ("there is still room") rather than a live count,
 *  because the exact number moves between the send and the click. */
function offerSentenceHu(freeMonths: number): string {
  if (freeMonths >= 12) {
    return "Ebben a körben egy teljes évig a vendégünk vagytok a Weddlyn, a profil minden funkciójával. Van még hely benne.";
  }
  if (freeMonths > 0) {
    return `Ebben a körben ${freeMonths} hónapig a vendégünk vagytok a Weddlyn, a profil minden funkciójával. Van még hely benne.`;
  }
  return "";
}

/** The free-window closer in the locales that shipped after HU/EN. Keyed the
 *  same way as the card itself: a locale with no entry falls back to English,
 *  so a market can be pointed at a language before every sentence is written. */
const OFFER_SENTENCE: Partial<Record<ExtraLocale, (freeMonths: number) => string>> = {
  hr: (m) =>
    m >= 12
      ? "U ovom krugu ste godinu dana naši gosti na Weddlyju, sa svime što profil nudi. Još ima mjesta."
      : m > 0
        ? `U ovom krugu ste ${m} mjeseca naši gosti na Weddlyju, sa svime što profil nudi. Još ima mjesta.`
        : "",
  de: (m) =>
    m >= 12
      ? "In dieser Runde sind Sie ein ganzes Jahr unser Gast auf Weddly, mit allem, was das Profil kann. Es sind noch Plätze frei."
      : m > 0
        ? `In dieser Runde sind Sie ${m} Monate unser Gast auf Weddly, mit allem, was das Profil kann. Es sind noch Plätze frei.`
        : "",
  es: (m) =>
    m >= 12
      ? "En esta ronda sois nuestros invitados en Weddly durante un año entero, con todo lo que ofrece el perfil. Aún quedan plazas."
      : m > 0
        ? `En esta ronda sois nuestros invitados en Weddly durante ${m} meses, con todo lo que ofrece el perfil. Aún quedan plazas.`
        : "",
};

function offerSentenceFor(locale: ExtraLocale, freeMonths: number): string {
  return OFFER_SENTENCE[locale]?.(freeMonths) ?? offerSentenceEn(freeMonths);
}

function offerSentenceEn(freeMonths: number): string {
  if (freeMonths >= 12) {
    return "Claiming in this round includes a full year of every profile feature, on us.";
  }
  if (freeMonths > 0) {
    return `Claim it in this round and every profile feature is on us for ${freeMonths} months.`;
  }
  return "";
}

/** Subject line that follows the SAME language decision the body makes.
 *  `renderEmail` prints one card when it knows the recipient's locale and the
 *  bilingual HU+EN stack when it doesn't, so a `null` locale gets the legacy
 *  slash-joined subject and a known one gets clean single-language copy. */
function localeSubject(
  locale: RecipientLocale | undefined,
  hu: string,
  en: string,
  extra?: Partial<Record<ExtraLocale, string>>,
): string {
  if (locale === "hu") return hu;
  if (locale === "en") return en;
  // A locale beyond HU/EN gets its own subject when the kind wrote one, and
  // the English subject otherwise — matching exactly what `pickBlocks` does
  // with the card, so subject and body can never end up in two languages.
  if (locale) return extra?.[locale] ?? en;
  return `${hu} / ${en}`;
}

/** Hungarian definite article: a word starting with a vowel takes "az".
 *  Business names lead these sentences, so "a Anna Weddings" is visible wrong. */
function huArticle(word: string): string {
  const first = word.trim()[0]?.toLowerCase() ?? "";
  return "aáeéiíoóöőuúüű".includes(first) ? "az" : "a";
}

/** Strips the trailing period `hu-HU` long dates carry, so a Hungarian case
 *  suffix can attach to the day: "2026. augusztus 3." + "-ig" → "augusztus 3-ig". */
function huDateSuffix(label: string): string {
  return label.replace(/\.\s*$/, "");
}

/** `2027-05-29` → "2027. május 29." / "29 May 2027". Formatted in UTC on
 *  purpose: the value is a calendar date, not an instant, and letting the
 *  server's zone parse it shifts the day back for anyone west of UTC. */
function isoDateLabel(iso: string, locale: "hu" | "en"): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** Epoch ms → "2026. július 29. 14:32" / "29 July 2026, 14:32". Rendered in
 *  the launch market's zone (the same fallback `countryToTimeZone(null)` uses)
 *  rather than the server's, which in production is UTC and would read an hour
 *  behind every recipient we have. Returns "" for a value `Intl` would throw
 *  on, so a bad timestamp costs the line rather than the whole email. */
function timestampLabel(ms: number, locale: "hu" | "en"): string {
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
  }).format(new Date(ms));
}

const BUILDERS: { [K in EmailKind]: Builder<K> } = {
  welcome_verify: (p, ctx) => ({
    subject: localeSubject(ctx.recipientLocale, "Üdv a Weddly-n", "Welcome to Weddly"),
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
    extra: {
      hr: {
        preheader: "Potvrdite adresu e-pošte da kasnije možete vratiti svoj račun.",
        greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Dobro došli na Weddly, drago nam je što ste tu.",
          "Sve što treba za mirno planiranje vjenčanja na jednom je mjestu: popis gostiju, raspored sjedenja, proračun, potvrde dolaska i materijali za ispis.",
          "Ostala je još jedna sitnica: potvrdite adresu e-pošte, da svoj račun možete vratiti ako ikad zaboravite lozinku.",
        ],
        cta: "Potvrdite e-poštu",
        ctaSubtext: "Poveznica vrijedi 7 dana.",
        footnote: "Potvrda je potrebna za prijavu, pa je najbolje riješiti je odmah.",
      },
      de: {
        preheader:
          "Bestätigen Sie Ihre E-Mail-Adresse, damit Sie Ihr Konto später wiederherstellen können.",
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Willkommen bei Weddly, schön, dass Sie da sind.",
          "Alles für eine entspannte Hochzeitsplanung an einem Ort: Gästeliste, Sitzplan, Budget, Zusagen und Druckvorlagen.",
          "Eine Kleinigkeit noch: Bestätigen Sie Ihre E-Mail-Adresse, damit Sie Ihr Konto wiederherstellen können, falls Sie Ihr Passwort einmal verlieren.",
        ],
        cta: "E-Mail-Adresse bestätigen",
        ctaSubtext: "Der Link ist 7 Tage gültig.",
        footnote:
          "Ohne Bestätigung ist keine Anmeldung möglich, erledigen Sie es also am besten gleich.",
      },
    },
  }),

  // The account exists as of a second ago. Two ways in, and the opening line
  // has to differ: a password signup just clicked the verify link (so the
  // confirmation is the news), while an OAuth signup never saw welcome_verify
  // at all, which makes THIS their welcome mail.
  welcome_account: (p, ctx) => {
    const provider = p.via === "google" ? "Google" : p.via === "apple" ? "Apple" : null;
    const openerHu = provider
      ? `A Weddly fiókod él, ${provider}-fiókkal léptél be. Örülünk, hogy itt vagytok.`
      : "Megerősítetted az e-mail címed, a Weddly fiókod él. Örülünk, hogy itt vagytok.";
    const openerEn = provider
      ? `Your Weddly account is live, signed in with ${provider}. We're glad you're here.`
      : "Your email is confirmed and your Weddly account is live. We're glad you're here.";
    return {
      // Locale-matched subject where we know the locale. `null` (unknown) still
      // renders the bilingual HU+EN body, so the subject stays bilingual too
      // rather than promising one language and delivering both.
      subject: localeSubject(
        ctx.recipientLocale,
        "Kész a Weddly fiókod",
        "Your Weddly account is live",
      ),
      ctaUrl: p.dashboardUrl,
      hu: {
        preheader: "Dátum, helyszín, vendéglista. Ebben a sorrendben a legkönnyebb.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          openerHu,
          "Innen indulj: add meg az esküvő dátumát és a helyszínt. A vendéglista, a költségvetés és az ülésrend mind ezekre épül, így pár perc alatt összeáll a váza.",
          "Ha ketten tervezitek, hívd meg a párodat a munkamenetbe. Ugyanazt az adatot látja és szerkeszti, valós időben, e-mailezés nélkül.",
        ],
        cta: "Tervezés indítása",
        footnote: "Kérdés van? Válaszolj erre a levélre, egy ember olvassa.",
      },
      en: {
        preheader: "Date, venue, guest list. Easiest in that order.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          openerEn,
          "Start here: set the wedding date and the venue. The guest list, budget and seating plan all build on those, so the skeleton comes together in a few minutes.",
          "Planning as two? Invite your partner into the workspace. They see and edit the same data in real time, no emailing files back and forth.",
        ],
        cta: "Start planning",
        footnote: "Questions? Just reply to this email, a human reads it.",
      },
      extra: {
        hr: {
          preheader: "Datum, lokacija, popis gostiju. Tim je redoslijedom najlakše.",
          greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [
            provider
              ? `Vaš Weddly račun je aktivan, prijavili ste se ${provider} računom. Drago nam je što ste tu.`
              : "Potvrdili ste adresu e-pošte i vaš je Weddly račun aktivan. Drago nam je što ste tu.",
            "Krenite odavde: upišite datum vjenčanja i lokaciju. Popis gostiju, proračun i raspored sjedenja svi se grade na tome, pa kostur nastane u nekoliko minuta.",
            "Planirate udvoje? Pozovite partnera u radni prostor. Vidi i uređuje iste podatke, u stvarnom vremenu, bez slanja datoteka e-poštom.",
          ],
          cta: "Počnite planirati",
          footnote: "Imate pitanje? Odgovorite na ovu poruku, čita je čovjek.",
        },
        de: {
          preheader: "Datum, Location, Gästeliste. In dieser Reihenfolge geht es am leichtesten.",
          greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [
            provider
              ? `Ihr Weddly-Konto ist aktiv, angemeldet mit ${provider}. Schön, dass Sie da sind.`
              : "Ihre E-Mail-Adresse ist bestätigt und Ihr Weddly-Konto ist aktiv. Schön, dass Sie da sind.",
            "Fangen Sie hier an: Tragen Sie Hochzeitsdatum und Location ein. Gästeliste, Budget und Sitzplan bauen alle darauf auf, das Gerüst steht also in wenigen Minuten.",
            "Zu zweit am Planen? Laden Sie Ihren Partner in den Arbeitsbereich ein. Er sieht und bearbeitet dieselben Daten in Echtzeit, ohne Dateien hin und her zu mailen.",
          ],
          cta: "Mit der Planung starten",
          footnote: "Fragen? Antworten Sie einfach auf diese E-Mail, ein Mensch liest mit.",
        },
      },
    };
  },

  // Partner B's side of the invite. The inviter gets partner_invite_accepted;
  // until this kind existed the person who actually joined got nothing.
  partner_welcome: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? ` A közös munkamenet: ${p.coupleDisplayName}.` : "";
    const coupleEn = p.coupleDisplayName ? ` Your shared workspace: ${p.coupleDisplayName}.` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Bent vagy a tervezésben",
        "You're in the workspace",
      ),
      ctaUrl: p.dashboardUrl,
      hu: {
        preheader: `${p.inviterName} munkamenetéhez csatlakoztál.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Csatlakoztál ${p.inviterName} esküvőtervezőjéhez.${coupleHu}`,
          "Mostantól mindketten ugyanazt az adatot szerkesztitek: vendéglista, ülésrend, költségvetés, RSVP linkek, nyomtatható helykártyák. Amit egyikőtök módosít, a másiknál azonnal látszik.",
          "A vendéglistával a legérdemesebb kezdeni, ott van a legtöbb közös munka, és onnan jön az ülésrend meg az RSVP is.",
        ],
        cta: "Vezérlőpult megnyitása",
        footnote: "Kérdés van? Válaszolj erre a levélre, egy ember olvassa.",
      },
      en: {
        preheader: `You joined ${p.inviterName}'s workspace.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `You've joined ${p.inviterName}'s wedding planner.${coupleEn}`,
          "From here you both edit the same data: guest list, seating chart, budget, RSVP links, printable place cards. Changes made by either of you show up instantly on the other side.",
          "The guest list is the best place to start. It's where most of the shared work happens, and both the seating chart and the RSVP links come off it.",
        ],
        cta: "Open the dashboard",
        footnote: "Questions? Just reply to this email, a human reads it.",
      },
    };
  },

  verify_resend: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Új megerősítő link",
      "Your new Weddly verification link",
    ),
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
    subject: localeSubject(ctx.recipientLocale, "Jelszó visszaállítás", "Password reset"),
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
    extra: {
      hr: {
        preheader: "Zatražili ste novu lozinku za svoj Weddly račun. Poveznica vrijedi 1 sat.",
        greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Zatražili ste novu lozinku za svoj Weddly račun. Iz sigurnosnih razloga poveznica **vrijedi 1 sat**.",
          "Ako to niste bili vi, slobodno zanemarite ovu poruku, vaš je račun i dalje siguran.",
        ],
        cta: "Postavite novu lozinku",
        ctaSubtext: "Poveznica za jednokratnu upotrebu, vrijedi 1 sat.",
      },
      de: {
        preheader:
          "Sie haben ein neues Passwort für Ihr Weddly-Konto angefordert. Der Link gilt 1 Stunde.",
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Sie haben ein neues Passwort für Ihr Weddly-Konto angefordert. Aus Sicherheitsgründen ist dieser Link **1 Stunde gültig**.",
          "Falls Sie das nicht waren, können Sie diese E-Mail ignorieren, Ihr Konto bleibt sicher.",
        ],
        cta: "Neues Passwort festlegen",
        ctaSubtext: "Einmal-Link, 1 Stunde gültig.",
      },
    },
  }),

  password_changed: (p, ctx) => ({
    subject: localeSubject(ctx.recipientLocale, "Jelszó megváltoztatva", "Password changed"),
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
    extra: {
      hr: {
        preheader: "Potvrđujemo da je vaša lozinka uspješno promijenjena.",
        greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Lozinka vašeg Weddly računa upravo je promijenjena **(${p.changedAt})**.`,
          "Odjavili smo sve vaše dosadašnje prijave, pa se svugdje morate ponovno prijaviti novom lozinkom.",
          "**Ako to niste bili vi**, odmah zatražite novu lozinku poveznicom ispod i time istog trena isključite onoga tko je ušao.",
        ],
        cta: "Zatražite novu lozinku",
        footnote: "Ako ste to bili vi, slobodno zanemarite ovu poruku.",
      },
      de: {
        preheader: "Wir bestätigen, dass Ihr Passwort erfolgreich geändert wurde.",
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Das Passwort Ihres Weddly-Kontos wurde gerade geändert **(${p.changedAt})**.`,
          "Wir haben alle bestehenden Sitzungen abgemeldet, Sie müssen sich also überall mit dem neuen Passwort neu anmelden.",
          "**Falls Sie das nicht waren**, fordern Sie über den Link unten sofort ein neues Passwort an, damit ist wer auch immer gerade hereingekommen ist sofort ausgesperrt.",
        ],
        cta: "Jetzt neues Passwort anfordern",
        footnote: "Falls Sie das waren, können Sie diese E-Mail ignorieren.",
      },
    },
  }),

  new_device_signin: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Új eszközről jelentkeztél be",
      "New device sign-in",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "E-mail cím megerősítése",
      "Confirm your new email",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "E-mail cím váltási kérelem",
      "Your email change is in progress",
    ),
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

  partner_invite: (p, ctx) => {
    const coupleSuffixHu = p.coupleDisplayName
      ? ` A közös munkaterületetek neve: ${p.coupleDisplayName}.`
      : "";
    const coupleSuffixEn = p.coupleDisplayName
      ? ` Your shared workspace: ${p.coupleDisplayName}.`
      : "";
    return {
      whyLine: {
        hu: `Ezt azért kaptad, mert ${p.inviterName} meghívott egy közös Weddly munkaterületre. Fiók csak akkor jön létre, ha elfogadod.`,
        en: `You're receiving this because ${p.inviterName} invited you to a shared Weddly workspace. No account is created unless you accept.`,
      },
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.inviterName} meghívott a Weddly-re`,
        `${p.inviterName} invited you to plan together`,
      ),
      ctaUrl: p.inviteUrl,
      hu: {
        preheader: "Közös vendéglista, ülésrend, költségvetés, egy munkamenetben.",
        greeting: "Szia!",
        paragraphs: [
          `${p.inviterName} elkezdte tervezni az esküvőt a Weddly-n, és meghívott, hogy csatlakozz hozzá.${coupleSuffixHu}`,
          "Egy közös munkamenetben dolgoztok: vendéglista, ülésrend, költségvetés, RSVP linkek, nyomtatható helykártyák és asztalterv. Minden valós időben szinkronban, semmi táblázat-pingpong, semmi „melyik a legfrissebb verzió”.",
          "A nyilvános béta alatt bárki használhatja, és semmilyen szállítóhoz nem köt; az adatok a tiétek maradnak.",
        ],
        cta: "Csatlakozom a tervezéshez",
        ctaSubtext: "A link 7 napig érvényes.",
        footnote: "Ha véletlenül kaptad, hagyd figyelmen kívül, semmi sem fog történni.",
      },
      en: {
        greeting: "Hello,",
        paragraphs: [
          `${p.inviterName} started planning your wedding on Weddly and invited you to join.${coupleSuffixEn}`,
          "One shared workspace covers your guest list, seating chart, budget, RSVP links, printable place cards and table plans, all synced in real time. No more spreadsheet ping-pong or asking which version is the latest.",
          "Weddly is open to everyone during the public beta, with no vendor lock-in. Your data stays yours.",
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
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.partnerName} csatlakozott`,
        `${p.partnerName} joined your workspace`,
      ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "A meghívót visszautasították",
      "Partner invite declined",
    ),
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
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.partnerName} kilépett`,
        `${p.partnerName} left your workspace`,
      ),
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
    // The workspace name opens the sentence, so it is the bare name here rather
    // than the parenthetical aside the old copy appended mid-paragraph.
    const couple = p.coupleDisplayName?.trim() ?? "";
    const coupleHu = couple || "A közös";
    const coupleEn = couple ? `${couple}'s` : "Your";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Tervezzetek együtt, egy közös Weddlyben",
        "Plan together, in one shared Weddly",
      ),
      ctaUrl: p.invitePartnerUrl,
      hu: {
        preheader: "Egy pár klikk, és együtt tervezhettek mindent.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${coupleHu} tervezője akkor működik igazán jól, ha mindketten ugyanazt az egy verziót látjátok.`,
          "Egy meghívás után közösen szerkeszthetitek a vendéglistát, az ülésrendet, a költségvetést és az RSVP-ket. Minden változás azonnal megjelenik, nincs több táblázat-pingpong.",
        ],
        cta: "Pár meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${coupleEn} planner works best when you are both looking at the same single source of truth.`,
          "One invitation gives you a shared guest list, seating plan, budget and RSVPs. Every change appears instantly, no more spreadsheet ping-pong.",
        ],
        cta: "Invite my partner",
      },
    };
  },

  founding_partner_push: (p, ctx) => {
    // Three sends, five days apart, about one fact: the founding plan is
    // granted per COUPLE, and activatePartnerFreeWindow refuses while
    // partner_b_id is NULL. So the copy never asks for a purchase, it asks
    // for the second person. The copy says "some places left" instead of a
    // live count (`spotsLeft`): an exact number dates fast and reads as either
    // too many (no urgency) or suspiciously precise, and phase 2 with paid
    // accounts is the real deadline now. The last variant promises the series
    // ends, which the sweep's 3-send cap actually honours.
    const coupleHu = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const coupleEn = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const variants = [
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Egy meghívásra vagytok az alapító hozzáféréstől",
          "Your founding access is one invite away",
        ),
        hu: {
          preheader: "Az esküvőtök napjáig a vendégeink vagytok, ha mindketten fent vagytok.",
          paragraphs: [
            "Az alapító párok, akik **ketten** költöznek be a Weddly-re, az esküvőjük napjáig a vendégeink. A helyekből még **van néhány szabad**.",
            `Nálatok egyetlen feltétel hiányzik: a munkaterületen${coupleHu} egyelőre csak te vagy fent. Amint a párod is regisztrál és belép, a hely a tiétek, és az előfizetés nálatok ki sem nyílik.`,
            "Hamarosan indul a 2. fázis a fizetős csomagokkal, úgyhogy ne maradjatok le: foglaljátok le most az alapító helyeteket, és az esküvőtök napjáig a vendégeink vagytok, akár 18 hónapon át.",
            "A lenti gombbal beléphetsz és elküldheted neki a meghívót. Vagy másold ki a gomb alatti linket, és küldd el neki ott, ahol amúgy is beszéltek.",
          ],
          cta: "Belépés és meghívás",
        },
        en: {
          paragraphs: [
            "Founding couples who move in **together** are our guests until their wedding day. **Some** of those places are still open.",
            `You're one step short: right now you're the only one on the workspace${coupleEn}. The moment your partner registers and signs in, the place is yours, and the subscription never starts for you.`,
            "We're about to start phase 2 with paid accounts, so don't miss this: claim your founding place now and the two of you are our guests until your wedding day, up to 18 months.",
            "The button below signs you in and takes you to the invite form. Or copy the link underneath it and send it wherever the two of you actually talk.",
          ],
          cta: "Sign in and invite",
        },
      },
      {
        subject: "Az alapító helyetekhez a párod is kell / Your founding place needs both of you",
        hu: {
          preheader: "Van még szabad alapító hely, és csak a teljes párok kapják meg.",
          paragraphs: [
            "Emlékeztető: az alapító helyekből **még van szabad**, de csak azok a párok kapják meg, akik **ketten** vannak fent a munkaterületen.",
            "Nálatok ez annyit jelent, hogy a vőlegényednek vagy a menyasszonyodnak is regisztrálnia kell. Utána az esküvőtök napjáig nem fizettek semmit, akármeddig húzódik a tervezés.",
            "Ez amúgy sem csak a számláról szól: a vendéglista, az ülésrend és a költségvetés akkor működik jól, ha mindketten ugyanazt az egy verziót szerkesztitek.",
          ],
          cta: "Meghívom a páromat",
        },
        en: {
          paragraphs: [
            "A reminder: **some** founding places are still open, but they only go to couples with **both** partners on the workspace.",
            "For you that means your fiancé needs to register too. After that you pay nothing until your wedding day, however long the planning runs.",
            "And it was never really about the invoice: the guest list, the seating and the budget only work properly when you're both editing the same single version.",
          ],
          cta: "Invite my partner",
        },
      },
      {
        subject: "Utolsó emlékeztető az alapító helyetekről / Last note about your founding place",
        hu: {
          preheader: "Több levelet nem küldünk erről.",
          paragraphs: [
            "Ez az utolsó emlékeztetőnk az alapító helyetekről. **Még van szabad**.",
            "Ha a párod is regisztrál a munkaterületre, az esküvőtök napjáig a vendégeink vagytok. Ha nem, az is teljesen rendben van: a terveződ marad, minden adatoddal együtt, csak a szokásos előfizetéssel.",
            "Több levelet erről nem küldünk.",
          ],
          cta: "Meghívó küldése",
        },
        en: {
          paragraphs: [
            "This is our last reminder about your founding place. **Some** are still left.",
            "If your partner registers on the workspace, the two of you are our guests until your wedding day. If not, that's genuinely fine: your planner stays exactly as it is, just on the normal subscription.",
            "We won't email you about this again.",
          ],
          cta: "Send the invite",
        },
      },
    ];
    const v = variants[p.variant % variants.length] ?? variants[0]!;
    return {
      subject: v.subject,
      ctaUrl: p.invitePartnerUrl,
      hu: {
        preheader: v.hu.preheader,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: v.hu.paragraphs,
        cta: v.hu.cta,
        ctaSubtext: `Meghívó link a párodnak: ${p.inviteUrl}`,
        secondaryLinks: [{ label: "Küldés emailben", url: p.shareMailtoUrl }],
        footnote: "Ha a párod időközben regisztrált, hagyd figyelmen kívül ezt a levelet.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: v.en.paragraphs,
        cta: v.en.cta,
        ctaSubtext: `Invite link for your partner: ${p.inviteUrl}`,
        secondaryLinks: [{ label: "Send it by email", url: p.shareMailtoUrl }],
        footnote: "If your partner has joined in the meantime, please ignore this note.",
      },
    };
  },

  couple_paused: (p, ctx) => ({
    subject: localeSubject(ctx.recipientLocale, "Esküvőtervező szüneteltetve", "Workspace paused"),
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

  // Sent by hand from the admin workspace list to a couple who left citing
  // missing features. The exit dialog stores a CATEGORY and an optional note,
  // and almost nobody writes the note, so "Missing features" is all we get: the
  // one churn reason we could act on is the one we know nothing about.
  //
  // The copy asks one question and sells nothing. It deliberately does not
  // mention the delete countdown (couple_paused already did, and repeating it
  // here turns a question into leverage), does not offer a discount, and does
  // not ask them to come back. The subject is picked per recipient locale
  // rather than the bilingual "HU / EN" form other kinds use, because a person
  // is being asked a favour and a slash in the subject line reads as a mailshot.
  pause_feedback_request: (p, ctx) => {
    const hu = ctx.recipientLocale === "hu";
    const coupleHu = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const coupleEn = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    return {
      subject: hu ? "Mi hiányzott a Weddly-ből?" : "What was missing from Weddly?",
      ctaUrl: p.feedbackUrl,
      hu: {
        preheader: "Egy mondat is sokat segít.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Amikor szüneteltetted a tervezőtöket${coupleHu}, azt jelölted meg, hogy hiányoztak funkciók. Ennyit tudunk róla, és pont ez a gond: azt nem tudjuk, mi volt az.`,
          "Mi hiányzott, vagy mi lett volna hasznosabb? Lehet egy funkció, ami nem volt meg, egy képernyő, ami körülményes volt, vagy valami, amit végül máshol csináltatok meg. Egy mondat is bőven elég.",
          "A gomb megnyit egy rövid űrlapot, a címed már benne lesz. Ha egyszerűbb, válaszolj erre a levélre, ember olvassa.",
        ],
        cta: "Elmondom, mi hiányzott",
        footnote:
          "Nem azért kérdezzük, hogy visszahívjunk. Amit írsz, abból lesz a következő funkció.",
      },
      en: {
        preheader: "One sentence is plenty.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `When you paused your workspace${coupleEn}, you told us features were missing. That is all we have, and that is exactly the problem: we don't know which ones.`,
          "What was missing, or what would have been more useful? It could be a feature that wasn't there, a screen that was more work than it should have been, or something you ended up doing somewhere else. One sentence is plenty.",
          "The button opens a short form with your address already filled in. If replying to this email is easier, do that instead, a human reads it.",
        ],
        cta: "Tell us what was missing",
        footnote: "We're not asking to win you back. What you write is what gets built next.",
      },
    };
  },

  couple_pause_cancelled: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Esküvőtervező visszaállítva",
      "Workspace pause cancelled",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "Adataitok véglegesen törölve",
      "Your data has been deleted",
    ),
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
      ? localeSubject(
          ctx.recipientLocale,
          "Esküvői munkaterületed törölve",
          "Your wedding workspace has been deleted",
        )
      : localeSubject(ctx.recipientLocale, "Fiókod törölve", "Your account has been deleted"),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "Fiókod ellenőrzés alatt",
      "Your account is under review",
    ),
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `Válaszolj erre az e-mailre ${huDateSuffix(p.deadlineDateHu)}-ig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "A Weddly adminisztrátora megjelölte a fiókodat ellenőrzésre. Az alábbi aggály miatt kértük a visszajelzésedet:",
        `„${p.reason}"`,
        `Ha úgy érzed, hogy ez tévedés vagy szeretnéd elmagyarázni a helyzetet, válaszolj erre az e-mailre **${huDateSuffix(p.deadlineDateHu)}-ig**.`,
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

  // The workspace's partner names read as placeholders rather than names.
  // Names the words we mean, the date, and what happens after it. Deliberately
  // NOT accusatory: most of these are a couple who typed something to get past
  // a required field months ago, not a bot.
  name_review_notice: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Kérjük, erősítsétek meg a neveteket",
      "Please confirm your names",
    ),
    ctaUrl: `${CONFIG.frontendBaseUrl}/app/profile`,
    hu: {
      preheader: `Kérjük, ${huDateSuffix(p.deadlineDateHu)}-ig javítsátok a neveteket a Weddlyn.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Átnéztük a Weddly-fiókokat, és a tiéteken ez a név szerepel: „${p.currentNames}". Ez nem tűnik valódi névnek.`,
        "A neveitek a vendégoldalatokon, a meghívóitokon és minden üzeneten megjelennek, amit egy szolgáltató kap tőletek, ezért fontos, hogy a valódiak legyenek. Így tudjuk a közösséget is valódi jegyespárokból tartani, és távol tartani a robotokat.",
        `Kérjük, javítsátok a neveket a profilotokban **${huDateSuffix(p.deadlineDateHu)}-ig**. Utána a munkaterület addig szünetel, amíg ez megtörténik. Minden adatotok megmarad, és a javítás pillanatában minden visszatér.`,
        "Ha kérdésetek van, elég válaszolni erre az e-mailre.",
      ],
      cta: "Nevek javítása",
    },
    en: {
      preheader: `Please correct the names on your Weddly workspace by ${p.deadlineDateEn}.`,
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We went through the Weddly accounts, and yours carries this name: "${p.currentNames}". That does not look like a real name.`,
        "Your names appear on your guest page, on your invitations and on every message a supplier receives from you, so it matters that they are the real ones. It is also how we keep the community made of real couples and keep bots out.",
        `Please correct them in your profile **by ${p.deadlineDateEn}**. After that the workspace pauses until it is done. Everything you have saved stays exactly where it is, and it all comes back the moment the names are corrected.`,
        "If you have any questions, just reply to this email.",
      ],
      cta: "Correct the names",
    },
  }),

  // Admin cleared the flag on a previously-flagged user. The flagged mail
  // promised "we'll delete your account if we don't hear back by X", this
  // closes that loop so the user isn't left with the original threatening
  // message as the last communication from us.
  account_flag_cleared: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Fiók ellenőrzés lezárva",
      "Account review cleared",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "Ajándék: teljes Weddly-hozzáférés",
      "A gift: full Weddly access",
    ),
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: "Megajándékoztunk titeket teljes Weddly-hozzáféréssel.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        p.workspaceName
          ? `Jó hír: a(z) **${p.workspaceName}** munkaterületeteken mostantól a vendégeink vagytok.`
          : "Jó hír: a munkaterületeteken mostantól a vendégeink vagytok.",
        "Mostantól minden funkció korlátozás nélkül elérhető, vendéglista, ülésrend, költségvetés, RSVP és nyomtatható meghívók. Nincs teendőtök.",
        "Ha bármi kérdés van, válaszolj erre az e-mailre.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        p.workspaceName
          ? `Good news: on your **${p.workspaceName}** workspace you are now our guests.`
          : "Good news: on your workspace you are now our guests.",
        "Every feature is now unlocked, guest list, seating plan, budget, RSVP, and printable stationery. There's nothing to do.",
        "If anything's unclear, just reply to this email.",
      ],
      cta: "Open Weddly",
    },
  }),

  rsvp_received_for_couple: (p, ctx) => ({
    subject: rsvpReceivedSubject(p, ctx.recipientLocale),
    ctaUrl: p.guestPageUrl,
    hu: {
      preheader: `${p.guestName} válaszolt: ${rsvpStatusHu(p.rsvpStatus)}.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.guestName}** most válaszolt a meghívóra: **${rsvpStatusHu(p.rsvpStatus)}**.`,
        rsvpMessageLineHu(p.guestMessage),
        rsvpProgressLineHu(p.progress),
        "A vendéglistán látod az ételválasztást, a +1-eket, a szállásigényt és a zenekívánságokat.",
      ].filter((line): line is string => line !== null),
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.guestName}** just responded: **${rsvpStatusEn(p.rsvpStatus)}**.`,
        rsvpMessageLineEn(p.guestMessage),
        rsvpProgressLineEn(p.progress),
        "The guest list has their meal choice, +1, accommodation, and song requests.",
      ].filter((line): line is string => line !== null),
      cta: "Open guest list",
    },
  }),

  rsvp_received_household_for_couple: (p, ctx) => ({
    subject: rsvpHouseholdSubject(p, ctx.recipientLocale),
    ctaUrl: p.guestPageUrl,
    hu: {
      preheader: `${p.householdLabel}: ${p.guests.length} fő válaszolt.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      // Each guest gets its own paragraph so they stack one-per-line in every
      // client (the renderer collapses "\n" inside a single <p>, which used to
      // run the whole household onto one line).
      paragraphs: [
        p.guests.length > 0
          ? `${p.householdLabel} (${p.guests.length} fő) most töltötte ki a meghívót:`
          : `**${p.householdLabel}** üzenetet hagyott nektek.`,
        ...p.guests.map((g) => `• ${g.name} · ${rsvpStatusHu(g.rsvpStatus)}`),
        rsvpMessageLineHu(p.guestMessage),
        rsvpProgressLineHu(p.progress),
        "A vendéglistán látod az ételválasztást, a +1-eket, a szállásigényt és a zenekívánságokat.",
      ].filter((line): line is string => line !== null),
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        p.guests.length > 0
          ? `${p.householdLabel} (${p.guests.length} guests) just RSVPd together:`
          : `**${p.householdLabel}** left you a message.`,
        ...p.guests.map((g) => `• ${g.name} · ${rsvpStatusEn(g.rsvpStatus)}`),
        rsvpMessageLineEn(p.guestMessage),
        rsvpProgressLineEn(p.progress),
        "The guest list has their meal choices, +1s, accommodation, and song requests.",
      ].filter((line): line is string => line !== null),
      cta: "Open guest list",
    },
  }),

  rsvp_thanks_for_guest: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `RSVP elküldve`,
      `RSVP confirmed, ${p.coupleDisplayName}`,
    ),
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

  guest_invite: (p, ctx) => {
    const dateHu = p.weddingDate ? ` **${p.weddingDate}**` : "";
    const dateEn = p.weddingDate ? ` **${p.weddingDate}**` : "";
    const greetingHuName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    const greetingEnName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.coupleDisplayName} meghívnak az esküvőjükre`,
        `${p.coupleDisplayName} invite you to their wedding`,
      ),
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

  guest_major_update: (p, ctx) => {
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
        : localeSubject(
            ctx.recipientLocale,
            `${p.coupleDisplayName} - fontos frissítés`,
            `An important update from ${p.coupleDisplayName}`,
          );
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

  guest_pre_wedding_info: (p, ctx) => {
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
        : localeSubject(
            ctx.recipientLocale,
            `${p.coupleDisplayName} - hasznos tudnivalók az esküvő előtt`,
            `A few details before ${p.coupleDisplayName}'s wedding`,
          );
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

  // Sent once, at the moment the trial window closes. Two rules shape it:
  //
  //   - It leads with what is STILL TRUE (the planner is intact), because a
  //     couple opening a "your trial ended" mail is braced for a loss, and the
  //     first sentence is where that fear is either confirmed or answered.
  //   - It offers the partner route FIRST and the payment route second. That is
  //     the honest order: inviting the partner costs the couple nothing and is
  //     what activatePartnerFreeWindow actually grants, so leading with the card
  //     would be selling past a better answer we already have.
  //
  // The deadline is stated as a date AND a day count. The date is what a person
  // puts in a calendar; the count is what makes it feel near. Both come from one
  // computed grace end, so they cannot disagree.
  trial_ended: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const coupleEn = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "A próbaidőszakotok véget ért",
        "Your Weddly trial has ended",
      ),
      ctaUrl: p.inviteUrl,
      hu: {
        preheader: `Innen két út vezet tovább. ${p.graceDays} napotok van dönteni.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `A Weddly próbaidőszakotok${coupleHu} lezárult. A tervezőtök a helyén van, minden adatotokkal együtt, és a következő ${p.graceDays} napban ugyanúgy szerkeszthető, mint eddig.`,
          "Innen két út vezet tovább, és érdemes az elsővel kezdeni. **Ha a párod is belép a munkaterületre, az esküvőtök napjáig a vendégeink vagytok**, teljes hozzáféréssel. Ez a gyorsabb út, és a tervezésen is segít: a vendéglista, az ülésrend és a költségvetés akkor működik jól, ha ugyanazt az egy verziót szerkesztitek ketten.",
          `A másik út, ha egyedül tervezel tovább: **${p.graceEndsLabel}-ig** add meg a fizetési adatokat, és a munkaterület megszakítás nélkül marad szerkeszthető.`,
          "Ha kérdésed van a csomagokról vagy a számlázásról, válaszolj erre a levélre, emberek olvassák.",
        ],
        cta: "Meghívom a páromat",
        secondaryLinks: [{ label: "Fizetési adatok megadása", url: p.billingUrl }],
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Your Weddly trial${coupleEn} has ended. Your planner is exactly where you left it, with all of your data, and it stays editable for the next ${p.graceDays} days.`,
          "There are two ways on from here, and the first is worth trying first. **If your partner joins the workspace, the two of you are our guests until your wedding day**, with everything unlocked. It is the quicker route, and it makes the planning better: the guest list, the seating and the budget only do their job when you are both editing the same single version.",
          `The other way, if you are planning solo: add your payment details by **${p.graceEndsLabel}** and the workspace keeps editing without a break.`,
          "If you have a question about the plans or the billing, reply to this email and a human reads it.",
        ],
        cta: "Invite my partner",
        secondaryLinks: [{ label: "Add payment details", url: p.billingUrl }],
      },
    };
  },

  onboarding_nudge: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "A tervezőtök készen áll, amikor ti is",
      "Your planner is ready when you are",
    ),
    ctaUrl: p.onboardingUrl,
    hu: {
      preheader: "Pár perc, és kész az alap esküvőterveződ.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Már csak néhány alapadat hiányzik: nevek, dátum és vendégszám.",
        "Két perc alatt elindítjuk nektek a költségvetést, a vendéglistát és az ülésrend vázát. Semmi sincs kőbe vésve, később mindent alakíthattok.",
      ],
      cta: "Befejezem a tervező beállítását",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Only a few details stand between you and a working plan: names, date and guest count.",
        "In two minutes, Weddly will build the first version of your budget, guest list and seating plan. Nothing is fixed, you can shape every detail later.",
      ],
      cta: "Finish my planner",
    },
  }),

  onboarding_nudge_week: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Két perc, és életre kel a tervezőtök",
      "Two minutes to bring your planner to life",
    ),
    ctaUrl: p.onboardingUrl,
    hu: {
      preheader: "Egy hét telt el. Kezdjük el az esküvőtök tervezését?",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Egy hete regisztráltál a Weddly-n, de a terveződ még üres.",
        "Pár perc az egész: pár adat (nevek, dátum, vendégszám), és máris kapsz egy szabható költségvetést, vendéglistát és ülésrend-vázat.",
        "Kezdd akár a vendéglistával, a többi ráér. Bármit átírhatsz később.",
      ],
      cta: "Elkezdem a tervezést",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "It's been a week since you joined Weddly, and your planner is still empty.",
        "A few minutes is all it takes: a few facts (names, date, guest count), and we'll seed a budget, guest list, and seating skeleton you can shape.",
        "Start with the guest list if you like, the rest can wait. You can rewrite any of it later.",
      ],
      cta: "Start planning",
    },
  }),

  // Win-back after three quiet weeks. The tone is a friend noticing, not a
  // product chasing a metric: nothing is wrong, nothing was lost, and here is
  // what got built while they were away.
  //
  // THE FEATURE LIST IS COPY WITH A SHELF LIFE. Every bullet names something
  // that is live for couples today; when it stops being new, swap it for
  // whatever shipped since rather than letting the mail brag about last
  // season's work. Never list anything gated behind an env var that prod
  // doesn't have set (the Google Calendar sync, for one).
  comeback_nudge: (p, ctx) => {
    const weeks = Math.max(3, Math.floor(p.daysAway / 7));
    // The couple name goes in the preheader, not the opening line: the mail is
    // addressed to one person ("Szia Fanni!"), so "Fanni & Balázs, 3 hete nem
    // jártál" mixes the two of them with a verb meant for one.
    const couplePrefix = p.coupleDisplayName ? `${p.coupleDisplayName}: ` : "";
    const closingHu =
      p.daysUntilWedding !== undefined
        ? `Az esküvőtökig ${p.daysUntilWedding} nap van. Most még kényelmesen haladtok, egy hónappal előtte viszont már minden sürgős, szóval érdemes ránézni.`
        : "Ha még nincs kitűzve a dátum, az sem baj. Nézz körül, és onnan folytasd, ahol abbahagytad.";
    const closingEn =
      p.daysUntilWedding !== undefined
        ? `Your wedding is ${p.daysUntilWedding} days away. There's still room to do this calmly; a month out, everything turns urgent at once.`
        : "No date yet? That's fine too. Have a look around and pick up where you left off.";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${weeks} hét alatt újraépítettük a Weddlyt`,
        "We rebuilt Weddly while you were away",
      ),
      ctaUrl: p.appUrl,
      hu: {
        preheader: `${couplePrefix}minden ott van, ahol hagytad. Plusz pár új dolog.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${weeks} hete nem jártál a tervezőtökben. Semmi baj, a vendéglista nem szökött meg, minden pontosan ott van, ahol hagytad.`,
          "Mi közben nem tétlenkedtünk. Ez került be azóta:\n- **Szolgáltatók**: 120+ új helyszín valódi galériákkal, térképen, és rá lehet szűrni, ki szabad a ti dátumotokon.\n- **Üzenetek**: amit egy szolgáltatótól kérdeztek, arra a válasz a Weddlyn belül landol.\n- **Arculat**: egy összefüggő stíluskészlet a vendégoldalhoz, és nyomtatható ültetőkártyák, menük, táblák hozzá.",
          closingHu,
          "Egy kávé alatt átfutod, mi van kész és mi vár még rátok.",
        ],
        cta: "Megnézem, mi újság",
        ctaSubtext: "Egyenesen a tervezőtökbe visz.",
        footnote: "Folyamatosan fejlesztjük az oldalt, szóval legközelebb is lesz mit mutatnunk.",
      },
      en: {
        preheader: `${couplePrefix}everything is where you left it. Plus a few new things.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `It's been ${weeks} weeks since you were last in your planner. Nothing to worry about: the guest list didn't run off, everything is exactly where you left it.`,
          "We haven't been idle either. Here's what landed since:\n- **Vendors**: 120+ new venues with real galleries, on a map, filterable by who still has your date open.\n- **Messages**: ask a vendor something and the reply lands inside Weddly.\n- **Style kit**: one visual identity for your guest page, plus printable place cards, menus and signs to match.",
          closingEn,
          "One coffee is enough to see what's done and what's still waiting.",
        ],
        cta: "See what's new",
        ctaSubtext: "Takes you straight into your planner.",
        footnote:
          "We're improving Weddly constantly, so there'll be something new to show you next time too.",
      },
    };
  },

  // The deliberate second touch to a workspace that has been quiet for a month
  // or more, sent by an operator rather than a sweep (see scripts/whats_new_blast.ts).
  // `comeback_nudge` is one-shot at 21 days, so everyone in this segment already
  // had their one automatic "we miss you"; repeating that note would land as a
  // nag. This mail earns its place by being about the PRODUCT instead: it opens
  // by confirming nothing of theirs was lost, then states plainly what got
  // rebuilt while they were away.
  //
  // THE BULLETS ARE DATED COPY, and so is the kind's name. When the next wave
  // goes out it gets its own kind (`whats_new_<yyyy_mm>`) with its own list,
  // rather than this one quietly bragging about last season's work: the
  // one-shot dispatch key is per kind, so reusing this one would silently skip
  // everybody who already received it.
  //
  // Two rules the list must keep. Never name anything gated behind an env var
  // production doesn't have set (the Google Calendar sync, DeepL translation,
  // the Places-ranked browse teaser). And never quote a number we can't stand
  // behind: "120+ new venues" is the 122 real Italy / Albania / Greece venues
  // added in July, not a rounded-up guess.
  whats_new_2026_07: (p, ctx) => {
    const weeks = Math.max(4, Math.floor(p.daysAway / 7));
    const couplePrefix = p.coupleDisplayName ? `${p.coupleDisplayName}: ` : "";
    const closingHu =
      p.daysUntilWedding !== undefined
        ? `Az esküvőtökig ${p.daysUntilWedding} nap van. Pont most érdemes ránézni, amíg a döntések még kényelmesek.`
        : "Ha még nincs kitűzve a dátum, az sem baj: a körülnézéshez nem kell.";
    const closingEn =
      p.daysUntilWedding !== undefined
        ? `Your wedding is ${p.daysUntilWedding} days away. Now is the good moment to look, while the decisions are still calm ones.`
        : "No date yet? You don't need one to look around.";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Ez már nem az a Weddly, amit itt hagytál",
        "This is not the Weddly you left",
      ),
      ctaUrl: p.appUrl,
      hu: {
        preheader: `${couplePrefix}120+ új helyszín, üzenetek a szolgáltatókkal, arculat és nyomtatás.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Kezdjük a jó hírrel: a vendéglistátok, a költségvetésetek és az ültetés pontosan ott van, ahol ${weeks} hete hagytad. Semmi nem tűnt el.`,
          "**Ami körülöttük van, azt viszont nagyrészt újraépítettük.** Ez került be, mióta utoljára itt voltál:\n- **120+ új helyszín és szolgáltató**, valódi galériákkal, térképen, és rá lehet szűrni, ki szabad a ti dátumotokon.\n- **Üzenetek**: amit egy szolgáltatótól kérdeztek, arra a válasz a Weddlyn belül landol, nem a postafiókod mélyén.\n- **Arculat és nyomtatás**: egy összefüggő stíluskészlet a vendégoldalhoz, kézzel beigazítható borítófotó, helyszíni térkép, és nyomtatható ültetőkártyák, menük, táblák hozzá.\n- **Költségvetés**: fizetési határidők, részletenként csatolható PDF számla, és a keret túllépése azonnal szól, nem a végén derül ki.",
          closingHu,
          "Nem kell újratanulni semmit. Nyisd meg, és két perc alatt látszik a különbség.",
        ],
        cta: "Megnézem, mi változott",
        ctaSubtext: "Egyenesen a tervezőtökbe visz.",
        footnote: "Amit most felsoroltunk, két hónap munkája. A következő kettőben sem állunk le.",
      },
      en: {
        preheader: `${couplePrefix}120+ new venues, vendor messaging, style kit and print.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Good news first: your guest list, your budget and your seating plan are exactly where you left them ${weeks} weeks ago. Nothing got lost.`,
          "**Almost everything around them, though, has been rebuilt.** Here's what landed since you were last in:\n- **120+ new venues and vendors**, with real galleries, on a map, and filterable by who still has your date open.\n- **Messages**: ask a vendor something and the reply lands inside Weddly, not somewhere down your inbox.\n- **Style kit and print**: one visual identity for your guest page, a cover photo you can nudge into place, a venue map, and printable place cards, menus and signs to match.\n- **Budget**: payment due dates, a PDF invoice per installment, and an alert the moment a category goes over, instead of a surprise at the end.",
          closingEn,
          "Nothing to relearn. Open it and the difference shows inside two minutes.",
        ],
        cta: "See what changed",
        ctaSubtext: "Takes you straight into your planner.",
        footnote: "That list is two months of work. The next two won't be quieter.",
      },
    };
  },

  // ~7 days after the wedding: rate the vendors you used. Bold and low-friction,
  // the whole pitch is "a star takes a second". Names the couple's actual
  // vendors so the ask is concrete.
  post_wedding_review_request: (p, ctx) => {
    const list = p.vendorNames.length > 0 ? p.vendorNames.join(", ") : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Értékeljétek a szolgáltatóitokat",
        "Rate your wedding vendors",
      ),
      ctaUrl: p.ctaUrl,
      hu: {
        preheader: "Egy hete volt az esküvőtök. Pár csillag a szolgáltatóknak, pár másodperc.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Egy hete házasodtatok össze. Gratulálunk még egyszer!",
          list
            ? `Segítenétek a következő pároknak? Akikkel dolgoztatok (**${list}**), megérdemlik a visszajelzést, és pár őszinte csillag másoknak is aranyat ér.`
            : "Segítenétek a következő pároknak? A szolgáltatóitok megérdemlik a visszajelzést, és pár őszinte csillag másoknak is aranyat ér.",
          "**Egy kattintás csillagonként, pár másodperc az egész.** Ha van kedvetek, írhattok pár szót is.",
        ],
        cta: "Értékelem a szolgáltatókat",
        ctaSubtext: "Csillag, kész. Belépve, egy helyen az összes.",
        footnote: "Ezt egyszer küldjük, az esküvőtök után.",
      },
      en: {
        preheader: "Your wedding was a week ago. A few stars for your vendors, a few seconds.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          "You got married a week ago. Congratulations again!",
          list
            ? `Would you help the next couples? The vendors you worked with (**${list}**) deserve your feedback, and a few honest stars are gold to couples who don't know them yet.`
            : "Would you help the next couples? Your vendors deserve your feedback, and a few honest stars are gold to couples who don't know them yet.",
          "**One click per star, a few seconds total.** Add a line or two if you feel like it.",
        ],
        cta: "Rate your vendors",
        ctaSubtext: "Tap a star, done. All of them in one place.",
        footnote: "We send this once, after your wedding.",
      },
    };
  },
  // T+14, and the last mail this couple ever gets from us. The tone is a
  // send-off, not a campaign: congratulate first, ask second, and say plainly
  // that we're going quiet. Two asks, both optional, both one click: tell us how
  // we did (primary), and put a few stars on the vendors they loved (secondary,
  // omitted when there's nobody left to rate). Saying "this is the last one" is
  // load-bearing — it is literally true (the sweep opts them out right after),
  // and it is the reason the asks don't read as another nag.
  wedding_farewell: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? `**${p.coupleDisplayName}**, ` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Köszönjük, hogy velünk terveztetek",
        "Thank you for planning with us",
      ),
      ctaUrl: p.ctaUrl,
      hu: {
        preheader: "Megvolt a nagy nap. Gratulálunk, és köszönjük!",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${coupleHu}megvolt a nagy nap! Gratulálunk mindkettőtöknek, szívből. Reméljük, pont olyan lett, amilyennek elképzeltétek, és hogy a tervezés utolsó heteiben egy kicsit könnyebb volt a dolgotok, mert itt minden egy helyen volt.`,
          "Ez az **utolsó levelünk**. Innentől nem írunk többet, a munkaterületetek viszont megmarad: bármikor visszanézhetitek a vendéglistát, az ültetést és a képeket.",
          "Két dolgot kérnénk búcsúzóul, ha van rá öt percetek. Az egyik nekünk segít, a másik a következő pároknak.",
        ],
        cta: "Elmondom, mit gondolok",
        ctaSubtext: "Őszintén, bármit. Minden sort elolvasunk.",
        ...(p.reviewUrl
          ? {
              secondaryLinks: [{ label: "Értékelem a szolgáltatóinkat", url: p.reviewUrl }],
            }
          : {}),
        footnote: "Sok boldogságot kívánunk nektek. Köszönjük, hogy minket választottatok!",
      },
      en: {
        preheader: "The big day is behind you. Congratulations, and thank you!",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.coupleDisplayName ? `**${p.coupleDisplayName}**, the` : "The"} big day is behind you. Congratulations to you both! We hope it was everything you pictured, and that the last few weeks of planning were a little lighter for having it all in one place.`,
          "This is our **last email**. We won't write again, but your workspace stays: the guest list, the seating chart and the photos are there whenever you want to look back.",
          "Two small things before we go quiet, if you have five minutes. One helps us, the other helps the couples planning right now.",
        ],
        cta: "Tell us how we did",
        ctaSubtext: "Anything, honestly. We read every line.",
        ...(p.reviewUrl
          ? { secondaryLinks: [{ label: "Rate the vendors we loved", url: p.reviewUrl }] }
          : {}),
        footnote: "Wishing you both every happiness. Thank you for choosing us!",
      },
    };
  },
  honeymoon_nudge: (p, ctx) => {
    // Sent once, inside the 90-day window, only to couples who haven't touched
    // the honeymoon planner. The pitch is the one thing the page does that
    // nothing else does: pick a live fare and it lands in the honeymoon budget
    // with a "buy the ticket" to-do attached. Everything named here is real,
    // no feature is promised that /app/honeymoon doesn't already ship.
    const coupleHu = p.coupleDisplayName ? `${p.coupleDisplayName}, ` : "";
    const coupleEn = p.coupleDisplayName ? `${p.coupleDisplayName}, ` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Az esküvő után jön a legjobb rész",
        "The best part comes after the wedding",
      ),
      ctaUrl: p.honeymoonUrl,
      hu: {
        preheader: `${coupleHu}${p.daysUntil} nap az esküvőig. A nászútról döntöttetek már?`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `**${p.daysUntil} nap múlva** férj és feleség lesztek. Utána pedig jön az a hét, amikor végre senki nem kérdezi meg tőletek, hogy ki hova ül.`,
          "Ha még nincs meg, hova mentek: a nászút-tervezőben elég megadni az úti célt és a dátumokat, a többi magától összeáll. Visszaszámláló, fotó a helyről, és valódi oda-vissza repjegyárak a ti indulási reptetekről, a ti dátumaitokra.",
          "Ha valamelyik ajánlat tetszik, egy kattintás: bekerül a nászút-költségvetésbe, és kaptok mellé egy „Repjegy megvásárlása” teendőt a foglalási linkkel. A többi szokásos tételre pedig ott a teendőcsomag: útlevél, biztosítás, csomagolás.",
        ],
        cta: "Nászút tervezése",
        footnote: "Ezt egyszer küldjük, és csak akkor, ha még nem kezdtétek el.",
      },
      en: {
        preheader: `${coupleEn}${p.daysUntil} days to the wedding. Settled on the honeymoon yet?`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `**In ${p.daysUntil} days** you'll be married. And then comes the week where nobody asks you who's sitting where.`,
          "If you haven't settled on the where yet: give the honeymoon planner a destination and your dates, and the rest assembles itself. A countdown, a photo of the place, and real round-trip fares from your own departure airport on your actual dates.",
          'Like one of them? One click drops it into your honeymoon budget and creates a "Buy the flight ticket" to-do with the booking link. For the unglamorous rest there\'s a task pack: passport, insurance, packing.',
        ],
        cta: "Plan the honeymoon",
        footnote: "We send this once, and only if you haven't started yet.",
      },
    };
  },

  milestone_t90: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "90 nap: ideje véglegesíteni a tervet",
      "90 days: time to lock the plan",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "30 nap: kezdődik a célegyenes",
      "30 days: the home stretch starts now",
    ),
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
    subject: localeSubject(
      ctx.recipientLocale,
      "Egy hét: minden a helyén",
      "One week: everything in its place",
    ),
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, utolsó hét. Nyomtatás, ülésrend, részletek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "**Egy hét**, most már tényleg közel van.",
        "Két dolog, amit érdemes most lezárni: nyomtassátok ki a végleges ülésrendet (A4/A3) és a névkártyákat (A6) a Nyomtatás fülön; küldjétek el a végleges fejszámot a helyszínnek és a cateringnek.",
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
      subject: localeSubject(
        ctx.recipientLocale,
        "Csúszik pár dolog az ütemtervből",
        "A few timeline items need you",
      ),
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
      subject: localeSubject(
        ctx.recipientLocale,
        `Új esküvői időpont`,
        `Wedding date update, ${p.coupleDisplayName}`,
      ),
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
      subject: localeSubject(
        ctx.recipientLocale,
        `Heti RSVP összegzés`,
        `Weekly RSVP digest, ${p.coupleDisplayName}`,
      ),
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
          `• ${p.newVendorWaitlistEntries} új szolgáltatói jelentkezés`,
          `• ${p.pendingListingClaims} függő adatlap-igénylés`,
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
          `• ${p.unresolvedUserFlags} active user flag${p.unresolvedUserFlags === 1 ? "" : "s"}`,
          "Everything is one click away from the admin console.",
          `Growth (last 7 days / prior 7 days): **${p.newCouplesThisWeek} new couples** (${sign(couplesDelta)}) · **${p.newUsersThisWeek} new users** (${sign(usersDelta)})`,
        ],
        cta: "Open admin",
        footnote: "Sent once a week, Monday morning.",
      },
    };
  },

  rsvp_followup_missing_meal: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `Egy gyors apróság maradt`,
      `One small thing, ${p.coupleDisplayName}`,
    ),
    ctaUrl: p.rsvpPageUrl,
    hu: {
      preheader: "Egy ételválasztás még hiányzik a visszajelzésedből.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Köszi, hogy visszajeleztél ${p.coupleDisplayName} esküvőjére, egy mező maradt csak ki: az ételválasztás.`,
        "Egy kattintás a visszajelző oldalon, és kész. Így a pár pontos létszámot tud adni a cateringnek.",
      ],
      cta: "Ételválasztás megadása",
      footnote: "Csak egyszer küldjük ezt, ha most kihagyod, akkor sem fog ismét rád szólni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Thanks for RSVP'ing to ${p.coupleDisplayName}'s wedding. One detail is still missing: your meal choice.`,
        "It takes one click to add, and gives the couple an accurate count for their caterer.",
      ],
      cta: "Pick your meal",
      footnote: "We only send this reminder once.",
    },
  }),

  rsvp_deadline_approaching: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `${p.pendingCount} vendég még nem válaszolt`,
      `${p.pendingCount} guests haven't RSVP'd`,
    ),
    ctaUrl: p.guestsUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, 2 hét az esküvőig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Két hét múlva van az esküvőtök **(${p.weddingDate})**, és **${p.pendingCount} vendég** még nem küldte el az RSVP-jét.`,
        "A vendéglistán egy kattintás emlékeztetőt küldeni mindenkinek, aki még nem válaszolt. Most a jó pillanat, innentől kezdve egyre nehezebb lesz pontos fejszámot adni a helyszínnek és a cateringnek.",
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
    subject: localeSubject(
      ctx.recipientLocale,
      "Várólistára kerültél",
      "You're on the Weddly vendor waitlist",
    ),
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
  // The card greets by name and the draft body no longer opens with a greeting
  // of its own; the two together used to render "Szia!" above "Szia Bloom Studio!".
  vendor_waitlist_decision: (p, ctx) => {
    const paragraphs = splitParagraphs(p.body);
    return {
      subject: p.subject,
      ctaUrl: CONFIG.frontendBaseUrl,
      hu: {
        preheader: vendorWaitlistDecisionPreheader(p.outcome, "hu"),
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs,
        cta: "Weddly megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
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
  vendor_activation: (p, ctx) => {
    const name = p.businessName.trim();
    // Accept path: the admin's warm, edited body opens the letter. Resend path:
    // no admin body, so a clear default welcome + bold activation instruction.
    const introParas = p.introMessage ? splitParagraphs(p.introMessage) : [];
    const huParas =
      introParas.length > 0
        ? introParas
        : [
            "Jó hírünk van: felvettünk titeket a Weddly-n tervező pároknak ajánlott szolgáltatók közé.",
            '**A szolgáltatói fiókotok aktiválásához kattintsatok a lenti „Fiók aktiválása" gombra.** A jelentkezéskor megadott adataitok és képeitek alapján már összeraktuk a profilotokat, belépés után csak átnézitek és élesítitek.',
          ];
    const enParas =
      introParas.length > 0
        ? introParas
        : [
            "Good news: we've added you to the vendors we recommend to couples planning on Weddly.",
            '**To activate your vendor account, tap the "Activate account" button below.** We\'ve already built your profile from the details and photos in your application, so once you sign in you just review it and go live.',
          ];
    return {
      subject:
        p.subject?.trim() ||
        // The business name sits in label position rather than inside the
        // sentence: Hungarian would need an accusative suffix on it, and there
        // is no safe way to decline an arbitrary trading name.
        localeSubject(
          ctx.recipientLocale,
          `${name}: szívesen látnánk titeket a Weddly katalógusában`,
          "We'd love to welcome you to the Weddly directory",
        ),
      ctaUrl: p.activateUrl,
      plainCtaUrl: true,
      noUtm: true,
      hu: {
        preheader: "Aktiváld a szolgáltatói fiókod.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: huParas,
        cta: "Fiók aktiválása",
        ctaSubtext: "A link 30 napig érvényes, és csak egyszer működik.",
        footnote:
          "Ha nem te kérted ezt a fiókot, nyugodtan hagyd figyelmen kívül ezt a levelet, aktiválás nélkül a profil nem lép életbe.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: enParas,
        cta: "Activate account",
        ctaSubtext: "The link is valid for 30 days and works once.",
        footnote:
          "If you didn't ask for this account, you can safely ignore this email, without activation the profile never goes live.",
      },
    };
  },

  vendor_profile_share: (p, ctx) => {
    const name = p.businessName.trim();
    // Only the sections that are actually empty get named, in the same order
    // in both languages so the two blocks stay parallel.
    const huMissing: string[] = [];
    const enMissing: string[] = [];
    const hrMissing: string[] = [];
    const deMissing: string[] = [];
    if (p.missing.photos) {
      huMissing.push("fotók");
      enMissing.push("photos");
      hrMissing.push("fotografije");
      deMissing.push("Fotos");
    }
    if (p.missing.bio) {
      huMissing.push("bemutatkozó szöveg");
      enMissing.push("a short bio");
      hrMissing.push("kratko predstavljanje");
      deMissing.push("eine kurze Vorstellung");
    }
    if (p.missing.packages) {
      huMissing.push("árcsomagok");
      enMissing.push("pricing packages");
      hrMissing.push("cjenovni paketi");
      deMissing.push("Preispakete");
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
      subject: localeSubject(
        ctx.recipientLocale,
        "Éles a Weddly-profilod",
        "Your Weddly profile is live",
      ),
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
      extra: {
        hr: {
          preheader: "Vaš je javni profil na Weddlyju spreman, evo poveznice za dijeljenje.",
          greeting: name ? `Pozdrav ${name}!` : "Pozdrav!",
          paragraphs: [
            "Vaš je profil objavljen na Weddlyju i spreman za dijeljenje. Poveznica ispod otvara vašu javnu stranicu za parove, bez prijave.",
            "Stavite je na svoje društvene mreže, ubacite u e-poruku ili pošaljite parovima koji vam se jave. Što je više ljudi vidi, to više upita može stići.",
            ...(hrMissing.length > 0
              ? [
                  `Nekoliko je odjeljaka na profilu još prazno: **${joinNaturalList(hrMissing, "i")}**. Kad ih ispunite, profil je puno uvjerljiviji i veći je izgled da odaberu vas.`,
                ]
              : []),
            "Na Weddlyju stvarni parovi planiraju stvarna vjenčanja i doista pregledavaju dobavljače. Uredan, potpun profil puno znači za prvi dojam.",
            "Ako imate zadovoljnog klijenta, zamolite ga da vas ocijeni na profilu. Nekoliko iskrenih recenzija s 5 zvjezdica najbolja je preporuka i osjetno diže broj rezervacija.",
          ],
          cta: "Otvorite moj profil",
          ctaSubtext:
            "Ovo je vaša javna poveznica, pošaljite je bilo kome, otvara se i bez prijave.",
          secondaryLinks: [
            { label: "Uredite profil", url: p.editUrl },
            { label: "Recenzije", url: p.reviewsUrl },
          ],
          footnote: "Pišemo samo kad postoji nešto čime možete napredovati na Weddlyju.",
        },
        de: {
          preheader: "Ihr öffentliches Profil auf Weddly steht, hier ist Ihr Link zum Teilen.",
          greeting: name ? `Hallo ${name},` : "Hallo!",
          paragraphs: [
            "Ihr Profil ist auf Weddly online und bereit zum Teilen. Der Link unten öffnet Ihre öffentliche Seite für Paare, ganz ohne Anmeldung.",
            "Stellen Sie ihn in Ihre sozialen Kanäle, packen Sie ihn in eine E-Mail, oder schicken Sie ihn Paaren, die sich melden. Je mehr Menschen ihn sehen, desto mehr Anfragen können kommen.",
            ...(deMissing.length > 0
              ? [
                  `Ein paar Abschnitte auf Ihrem Profil sind noch leer: **${joinNaturalList(deMissing, "und")}**. Ausgefüllt wirkt es deutlich überzeugender, und mehr Paare entscheiden sich für Sie.`,
                ]
              : []),
            "Auf Weddly planen echte Paare echte Hochzeiten, und sie sehen sich Dienstleister wirklich an. Ein aufgeräumtes, vollständiges Profil macht einen starken ersten Eindruck.",
            "Wenn Sie einen zufriedenen Kunden haben, bitten Sie ihn um eine Bewertung auf Ihrem Profil. Ein paar ehrliche 5-Sterne-Bewertungen sind die beste Referenz und heben die Buchungen spürbar.",
          ],
          cta: "Mein Profil öffnen",
          ctaSubtext:
            "Das ist Ihr öffentlicher Link, teilen Sie ihn mit wem Sie möchten, er öffnet ohne Anmeldung.",
          secondaryLinks: [
            { label: "Profil bearbeiten", url: p.editUrl },
            { label: "Bewertungen", url: p.reviewsUrl },
          ],
          footnote: "Wir schreiben nur, wenn es etwas gibt, das Sie auf Weddly weiterbringt.",
        },
      },
    };
  },

  /** Confirms that a business asked to come off Weddly and that it is done.
   *
   *  Two jobs, in this order and no other. First: say plainly that the listing
   *  is down and why it existed at all, because "how did you get my address"
   *  is the actual question behind a request like this and leaving it unanswered
   *  reads as evasion. A user suggested them; a person, not a scrape.
   *
   *  Second: leave the door open ONCE, and make it a door they walk through
   *  rather than one we hold. The CTA is registration, on their own terms, and
   *  the mail does not argue, does not ask them to reconsider, and never
   *  suggests the removal might be partial. They asked; it is done; here is the
   *  way back if they ever want it. */
  vendor_removal_confirmed: (p, ctx) => {
    const name = p.businessName.trim();
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${name}: töröltük az adatlapot`,
        `${name}: your listing has been removed`,
        {
          hr: `${name}: uklonili smo vaš oglas`,
          de: `${name}: Ihr Eintrag wurde entfernt`,
        },
      ),
      ctaUrl: p.registerUrl,
      // The stock transactional footer says "this is about your Weddly
      // account", and the second paragraph of this mail says in as many words
      // that they never opened one. Leaving the default in would contradict the
      // body in the one mail whose whole job is to be straight with them about
      // how they ended up on the site.
      whyLine: {
        hu: "Ezt azért kaptad, mert a Weddly esküvőtervezőn volt egy adatlapod, amit a kérésedre töröltünk. Fiókod nálunk nincs, és ez az utolsó levél erre a címre.",
        en: "You're getting this because you had a listing on Weddly, a wedding-planning app, and we removed it at your request. You have no account with us, and this is the last email to this address.",
        extra: {
          hr: "Ovo primate jer ste imali oglas na Weddlyju, aplikaciji za planiranje vjenčanja, a mi smo ga uklonili na vaš zahtjev. Kod nas nemate račun i ovo je posljednja poruka na ovu adresu.",
          de: "Sie erhalten dies, weil Sie einen Eintrag bei Weddly hatten, einer App für die Hochzeitsplanung, und wir ihn auf Ihren Wunsch entfernt haben. Sie haben kein Konto bei uns, und dies ist die letzte E-Mail an diese Adresse.",
        },
      },
      hu: {
        preheader: "Kérésedre töröltük az adatlapot a Weddly-ről.",
        greeting: `Kedves ${name}!`,
        paragraphs: [
          "Az adatlapot a kérésedre töröltük a Weddly-ről. Nem jelenik meg többé a keresésben, és több levelet sem küldünk erre a címre.",
          "Az adatlap azért volt fent, mert az egyik felhasználónk ajánlott titeket, amikor a saját esküvőjéhez keresett szolgáltatót. Nem ti regisztráltatok, és nem is kértük ehhez a hozzájárulásotokat.",
          "Ha egyszer mégis szeretnétek elérhetők lenni a pároknak, saját adatlapot bármikor létrehozhattok. Az már a tiétek: ti írjátok, ti szerkesztitek, és ti döntitek el, mi látszik belőle.",
        ],
        cta: "Regisztráció",
        footnote: "Ha bármi kérdésed van, válaszolj erre a levélre, egy ember olvassa.",
      },
      en: {
        preheader: "Your listing has been removed from Weddly, as you asked.",
        greeting: `Dear ${name},`,
        paragraphs: [
          "Your listing has been removed from Weddly at your request. It no longer appears in search, and we will not email this address again.",
          "It was there because one of our users suggested you while looking for suppliers for their own wedding. You did not sign up, and we did not ask your permission for it.",
          "If you ever do want to be reachable by couples planning a wedding, you can create your own listing whenever you like. That one is yours: you write it, you edit it, and you decide what it shows.",
        ],
        cta: "Register",
        footnote: "If you have any questions, just reply to this email, a human reads it.",
      },
      extra: {
        hr: {
          preheader: "Na vaš zahtjev uklonili smo oglas s Weddlyja.",
          greeting: `Poštovani ${name},`,
          paragraphs: [
            "Na vaš smo zahtjev uklonili vaš oglas s Weddlyja. Više se ne prikazuje u pretrazi i na ovu adresu više nećemo slati e-poštu.",
            "Oglas je postojao jer vas je jedan naš korisnik predložio dok je tražio ponuđače za vlastito vjenčanje. Vi se niste prijavili i za to vas nismo pitali za dopuštenje.",
            "Ako ikada poželite biti dostupni parovima koji planiraju vjenčanje, svoj oglas možete izraditi kad god želite. Taj je vaš: vi ga pišete, vi ga uređujete i vi odlučujete što se na njemu vidi.",
          ],
          cta: "Registracija",
          footnote: "Ako imate pitanja, samo odgovorite na ovu poruku, čita je čovjek.",
        },
        de: {
          preheader: "Ihr Eintrag wurde auf Ihren Wunsch von Weddly entfernt.",
          greeting: `Sehr geehrtes Team von ${name},`,
          paragraphs: [
            "Ihr Eintrag wurde auf Ihren Wunsch von Weddly entfernt. Er erscheint nicht mehr in der Suche, und wir schreiben an diese Adresse nicht mehr.",
            "Der Eintrag bestand, weil eine unserer Nutzerinnen oder einer unserer Nutzer Sie vorgeschlagen hat, während sie oder er Dienstleister für die eigene Hochzeit gesucht hat. Sie haben sich nicht angemeldet, und wir haben Sie dazu nicht um Erlaubnis gebeten.",
            "Falls Sie irgendwann doch für Paare erreichbar sein möchten, können Sie jederzeit Ihren eigenen Eintrag anlegen. Dieser gehört Ihnen: Sie schreiben ihn, Sie bearbeiten ihn, und Sie entscheiden, was er zeigt.",
          ],
          cta: "Registrieren",
          footnote: "Bei Fragen antworten Sie einfach auf diese E-Mail, ein Mensch liest mit.",
        },
      },
    };
  },

  vendor_profile_incomplete: (p, ctx) => {
    const name = p.businessName.trim();
    // Name only the empty sections, in the same order in both languages so the
    // two blocks stay parallel. At least one is always true here.
    // One line per checklist step, in the order the portal lists them, so the
    // mail and the vendor's own setup ring read as the same list rather than as
    // two opinions about the same profile.
    const huMissing: string[] = [];
    const enMissing: string[] = [];
    if (p.missing.cover) {
      huMissing.push("borítókép");
      enMissing.push("a cover photo");
    }
    if (p.missing.gallery) {
      huMissing.push("galéria");
      enMissing.push("gallery photos");
    }
    if (p.missing.description) {
      huMissing.push("bemutatkozó szöveg");
      enMissing.push("a short bio");
    }
    if (p.missing.contact) {
      huMissing.push("város és elérhetőség");
      enMissing.push("your town and contact details");
    }
    if (p.missing.pricing) {
      huMissing.push("ársáv");
      enMissing.push("a price range");
    }
    if (p.missing.capacity) {
      huMissing.push("vendéglétszám");
      enMissing.push("guest capacity");
    }
    if (p.missing.packages) {
      huMissing.push("árcsomagok");
      enMissing.push("pricing packages");
    }
    // The missing sections render as a bullet list (a `- ` line per item, which
    // the template turns into a <ul>) rather than an inline comma list: with up
    // to five items it scans far faster as a checklist the vendor can tick off.
    const bulletLines = (items: string[]): string => items.map((m) => `- ${m}`).join("\n");

    // Five wording variants so consecutive reminders to the same vendor never
    // read the same. Same ask (finish these sections, here's the editor),
    // different framing. The worker rotates `variant` by the per-vendor count.
    const variants = [
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Fejezd be a Weddly-profilod",
          "Finish your Weddly profile",
        ),
        hu: {
          preheader: "Néhány rész még hiányzik a profilodról.",
          intro:
            "A profilod már él a Weddly-n, de még nincs teljesen kész. A hiányzó részek nélkül kevesebb pár kattint rád.",
          missingLead: "Ezek még hiányoznak:",
          close: "Pár perc kitölteni, és sokkal meggyőzőbb lesz a profilod.",
          cta: "Profil befejezése",
        },
        en: {
          preheader: "A few sections are still missing from your profile.",
          intro:
            "Your profile is live on Weddly, but it isn't finished yet. Without the missing pieces, fewer couples click through.",
          missingLead: "Still missing:",
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
          missingLead: "Nálad még üresen áll:",
          close: "Egészítsd ki, hogy a legjobb formádat lássák.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "Real couples are browsing, a full profile wins.",
          intro:
            "Real couples are browsing vendors on Weddly right now. When they land on you, a complete profile is far more persuasive.",
          missingLead: "Yours is still empty here:",
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
          missingLead: "Még ennyi kell hozzá:",
          close: "Told ki gyorsan, és készen állsz a megkeresésekre.",
          cta: "Befejezem most",
        },
        en: {
          preheader: "A tidy profile makes the difference.",
          intro:
            "A tidy, complete profile makes the strongest first impression. Yours is almost there.",
          missingLead: "Just this left:",
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
          missingLead: "Hiányzó részek:",
          close: "Ha kitöltöd, nagyobb eséllyel választanak a párok.",
          cta: "Kiegészítem",
        },
        en: {
          preheader: "Full profiles get more enquiries.",
          intro:
            "Complete profiles get noticeably more enquiries. Yours is still missing a few pieces.",
          missingLead: "Missing sections:",
          close: "Fill them in and more couples will choose you.",
          cta: "Complete it",
        },
      },
      {
        subject: "Egy utolsó lökés a profilodhoz / One last nudge for your profile",
        hu: {
          preheader: "Rövid emlékeztető: a profilod még nincs kész.",
          intro: "Nem húzzuk az időd, csak egy emlékeztető: a profilod még nincs teljesen kész.",
          missingLead: "Ennyi van hátra:",
          close: "Fejezd be, amikor ráérsz, pár perc az egész, és kész a profilod.",
          cta: "Befejezés",
        },
        en: {
          preheader: "Quick reminder: your profile isn't finished.",
          intro: "We'll keep it short, just a reminder that your profile isn't quite finished.",
          missingLead: "This is what's left:",
          close: "Finish it whenever suits you, a few minutes and your profile is complete.",
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
        paragraphs: [
          v.hu.intro,
          huMissing.length > 0
            ? `${v.hu.missingLead}\n${bulletLines(huMissing)}`
            : v.hu.missingLead,
          v.hu.close,
        ],
        cta: v.hu.cta,
        footnote: "Csak akkor írunk, ha van valami, amivel előrébb léphetsz a Weddly-n.",
      },
      en: {
        preheader: v.en.preheader,
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: [
          v.en.intro,
          enMissing.length > 0
            ? `${v.en.missingLead}\n${bulletLines(enMissing)}`
            : v.en.missingLead,
          v.en.close,
        ],
        cta: v.en.cta,
        footnote: "We only email when there's something useful for your Weddly profile.",
      },
    };
  },

  planner_profile_incomplete: (p, ctx) => {
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
      subject: localeSubject(
        ctx.recipientLocale,
        "Fejezd be a Weddly-profilod",
        "Finish your Weddly profile",
      ),
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

  // Same greeting rule as `vendor_waitlist_decision` above.
  planner_waitlist_decision: (p, ctx) => {
    const paragraphs = splitParagraphs(p.body);
    return {
      subject: p.subject,
      ctaUrl: CONFIG.frontendBaseUrl,
      hu: {
        preheader: vendorWaitlistDecisionPreheader(p.outcome, "hu"),
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs,
        cta: "Weddly megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs,
        cta: "Open Weddly",
      },
    };
  },

  planner_provisioned: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Elkészült a szervezői fiókod",
      "Your planner account is ready",
    ),
    ctaUrl: p.activateUrl,
    hu: {
      preheader: `${p.businessName} profilja aktiválásra vár, két év teljes hozzáféréssel.`,
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Jó hírünk van: elkészítettük neked a(z) **${p.businessName}**${p.category ? ` (${p.category})` : ""} szervezői profilját a Weddly-n.`,
        `Ajándékba **két év teljes hozzáférést** kapsz (érvényes eddig: ${p.freeUntilHu}). Nincs apró betű: a lenti gombbal élesíted a fiókot, beállítasz egy jelszót, és már használhatod is.`,
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
        `As a gift you get **two years of full access**, until ${p.freeUntilEn}. No fine print: hit the button below to activate the account, set a password, and you're in.`,
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
  planner_onboarding_invite: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Jóváhagytuk a jelentkezésed",
      "Your planner application is approved",
    ),
    ctaUrl: p.activateUrl,
    hu: {
      preheader: "Átnéztük a jelentkezésed, nyisd meg a szervezői fiókod.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Köszönjük a jelentkezésed a Weddly tervezői programjába. Átnéztük és **jóváhagytuk** a(z) **${p.businessName}** profilját.`,
        "Már csak egy lépés van hátra: nyisd meg a fiókod az alábbi gombbal, és állíts be egy jelszót. A kezdeti beállítást **előre kitöltöttük a jelentkezésed adataival**, neked csak át kell nézned.",
        `A vendégünk vagy eddig: ${p.freeUntilHu} Nincs apró betű.`,
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
        `You are our guest until ${p.freeUntilEn}. No fine print.`,
        `By opening the account you accept the Terms of Service (${CONFIG.frontendBaseUrl}/terms) and the Privacy Policy (${CONFIG.frontendBaseUrl}/privacy). Both are shown again on the activation page before you confirm.`,
      ],
      cta: "Open your account",
      ctaSubtext: "The link is valid for 30 days and can be used once.",
      footnote:
        "If you didn't apply, there's nothing to do: without opening it the account never goes live.",
    },
  }),

  // Cold invite to a planner a Weddly user named. Two things separate it from
  // planner_provisioned (the admin-in-person kind): the recipient never asked
  // for anything, and the account already exists in their name when the mail
  // lands. So the copy has to carry its own justification, which is what the
  // data paragraph is for: where the address came from, what the account is
  // doing there, and how to make all of it disappear in one click. That
  // paragraph is load-bearing, not decoration; do not trim it to tighten the
  // mail. Single-language render off `locale` for the same reason the claim
  // campaign does it: a HU subject to a planner working in English reads as spam.
  planner_suggested_invite: (p) => ({
    subject:
      p.locale === "hu"
        ? "Ajánlottak titeket: itt a Weddly szervezői fiókotok"
        : "You were recommended: your Weddly account is ready",
    ctaUrl: p.activateUrl,
    plainCtaUrl: true,
    noUtm: true,
    // The stock outreach footer says "you have no account with us", which this
    // mail's own first sentence contradicts. Say the true version instead.
    whyLine: {
      hu: "Ezt a Weddly esküvőtervezőtől kaptad, mert egy felhasználónk ajánlott téged. A fiók addig alszik, amíg nem élesíted.",
      en: "You're getting this from Weddly, a wedding-planning app, because one of our users recommended you. The account stays asleep until you activate it.",
    },
    hu: {
      preheader: "Egy felhasználónk javasolta a nevedet. A fiók kész, egy kattintás átvenni.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Egy felhasználónk javasolta a nevedet, amikor esküvőszervezőket kerestünk a Weddlyre. Ennyi elég is volt: elkészítettük ${huArticle(p.businessName)} **${p.businessName}** szervezői fiókját, és rád vár.`,
        "A Weddlyn a pár és a szervező ugyanazt a felületet nézi: vendéglista, ülésrend, költségvetés, RSVP, idővonal, feladatok. Az összes ügyfeled egy vezérlőpultról megy, és nem a levelezésben kell keresned, hol tart egy esküvő.",
        // No sentence-final period after the date: a Hungarian formatted date
        // already ends in one ("2028. július 28."), and adding ours makes it two.
        `Tarts velünk az első fejezettől: a következő két évben a vendégünk vagy, minden funkcióval. A vendégidőszak vége: ${p.guestUntil}`,
        // The data note is the price of writing to someone who never asked. It
        // names the source, the purpose and the legal basis, and it lists the
        // rights in full. Since 2026-07-28 the reply-to-us address is the whole
        // of the objection path: the unsubscribe link that used to sit in the
        // secondary links is gone, by owner decision, so this sentence is the
        // only exit the mail names and must stay exactly as concrete as it is.
        `Az adatokról őszintén: a nevedet, az e-mail-címedet és a telefonszámodat nyilvánosan, üzleti elérhetőségként közzétett forrásból gyűjtöttük, és kizárólag ezt a megkeresést szolgálják. Harmadik félnek nem adjuk tovább. Az adatkezelés jogalapja a GDPR 6. cikk (1) f) pontja szerinti jogos érdek, és minden jogod megvan vele szemben: az adataid másolatát, javítását, korlátozását vagy törlését bármikor kérheted, és tiltakozhatsz a kezelésük ellen. Egy levél a ${CONFIG.supportEmail} címre elég, ember olvassa. Részletek: ${CONFIG.frontendBaseUrl}/privacy`,
      ],
      cta: "Fiók átvétele",
      ctaSubtext: "Egy kattintás, egy jelszó. A link 30 napig él, és egyszer használható.",
      footnote: "Ha nem te intézed a szervezést, add tovább a kollégádnak.",
      secondaryLinks: [
        { label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Adatkezelési tájékoztató", url: `${CONFIG.frontendBaseUrl}/privacy` },
      ],
    },
    en: {
      preheader: "A Weddly user put your name forward. The account is ready to take over.",
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `One of our users put your name forward when we went looking for wedding planners for Weddly. That was enough for us: the planner account for **${p.businessName}** is set up and waiting for you.`,
        "On Weddly the couple and the planner look at the same screen: guest list, seating, budget, RSVP, timeline, tasks. Every client you have runs from one dashboard, so you never have to dig through your inbox to find where a wedding stands.",
        `Join us from the first chapter: for the next two years, every feature is on us. Your complimentary access runs until ${p.guestUntil}.`,
        `Straight talk about the data: your name, email address and phone number came from publicly published business contact details, and they serve this one message. We pass nothing to third parties. We process it under the legitimate-interest basis of Article 6(1)(f) GDPR, and every right you have against that stands: you can ask for a copy, a correction, a restriction or an erasure of your data at any time, and you can object to the processing. One line to ${CONFIG.supportEmail} is enough, a human reads it. Details: ${CONFIG.frontendBaseUrl}/privacy`,
      ],
      cta: "Take over your account",
      ctaSubtext: "One click, one password. The link is valid for 30 days and can be used once.",
      footnote: "Not the person who runs the planning? Pass it to whoever does.",
      secondaryLinks: [
        { label: "What is Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Privacy policy", url: `${CONFIG.frontendBaseUrl}/privacy` },
      ],
    },
  }),

  wedding_today_followup: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `Segítsetek megépíteni a következő Weddlyt`,
      `Help us build the next Weddly, ${p.coupleDisplayName}`,
    ),
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
    subject: localeSubject(ctx.recipientLocale, "Ma van a nap", "Today's the day 💛"),
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
  community_supplier_verify: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `Egy pár hozzáadta a ${p.supplierName} adatlapját`,
      `A couple added ${p.supplierName} to Weddly`,
    ),
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: `${p.supplierName} hozzá lett adva a Weddly katalógushoz.`,
      greeting: "Szia!",
      paragraphs: [
        p.suggestedByUser
          ? `Egy pár, aki a Weddlyn tervezi az esküvőjét, hozzáadta ${huArticle(p.supplierName)} ${p.supplierName} adatlapját a szolgáltatói katalógushoz.`
          : `A(z) ${p.supplierName} bekerült a Weddly szolgáltató-katalógusába.`,
        "Vedd át az adatlapot az alábbi linken, hogy ellenőrizhesd az információkat és láthatóvá tehesd a párok számára.",
        "Ha nem szeretnél megjelenni, nincs teendőd: kattintás nélkül az adatlap nem kerül publikálásra.",
      ],
      // "Átvétele" instead of "megerősítése", the recipient never asked for
      // anything to confirm. "Take ownership" / "Claim" is the Yelp/GBP-
      // standard verb for this exact directory-onboarding flow; reads as
      // agency-giving rather than "click here to commit to something you
      // didn't sign up for".
      cta: "Adatlap átvétele",
      ctaSubtext: "A link 7 napig érvényes.",
      secondaryLinks: [{ label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl }],
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        p.suggestedByUser
          ? `A couple planning their wedding on Weddly put your business (${p.supplierName}) forward for the supplier directory.`
          : `${p.supplierName} has been added to the Weddly supplier directory.`,
        "If you'd like couples to see the listing, claim it via the button below, until then it stays hidden from the public.",
        "If this wasn't you and you don't want a listing, just ignore this email, the listing won't publish without a click.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // Claim-invite campaign. Cold, so the copy has to earn the click in the first
  // two lines: WHY this arrived, WHAT already exists (their category + town,
  // proof we mean their actual business), and what is wrong with it (we wrote
  // it from public data, so the things that actually sell are missing). The
  // free window is the closer, not the hook, an offer-first cold mail reads as
  // an ad.
  //
  // THE OPENING IS THE REFERRAL LINE, FOR EVERY RECIPIENT. Owner direction,
  // 2026-08-04, taken after a 3-agent copy review argued the other way and was
  // overruled: every cold first-contact mail to a vendor opens with "a couple
  // put you forward", because a directory invite that reads as scraped is the
  // thing the whole campaign is trying not to be. It is deliberately the same
  // frame `planner_suggested_invite` already ships ("you came recommended"), so
  // the two cold families now speak with one voice.
  //
  // What that costs, recorded so nobody has to rediscover it:
  //   - It is not true per recipient today. Every reachable listing is a
  //     curated import we compiled from public sources; `submitter_type='user'`
  //     rows (what `publishCoupleSupplierToDirectory` writes when a couple adds
  //     a vendor Weddly lacks) are the only ones where it is literally the
  //     case, and there are none in the current target set.
  //   - The reply is the real bill. "Which couple?" comes from the vendor who
  //     was about to claim, and this kind is in ADMIN_CONSOLE_KINDS, so it
  //     lands at hello@ where a human answers it. Operators need one prepared
  //     line before a campaign runs, and it must not invent a couple.
  //   - The exposure is B2B misleading advertising (Directive 2006/114/EC, and
  //     the Hungarian equivalent), NOT the Art. 14 duty: the source disclosure
  //     is the published `privacy.directory_listings_source` chapter, which
  //     lists a user recommendation among the sources, so the mail does not
  //     contradict the notice.
  // If that trade is ever revisited, the honest alternative is preserved in
  // git: an opening built on the page state, which is checkable and needs no
  // referral to sting.
  //
  // The rest of the mail is the part that stays true whoever is reading. Their
  // page is live, it currently tells couples nobody from the business has taken
  // it over and sends them off to the vendor's own site (`suppliers.calendar.
  // unclaimedNote`), and that is a per-recipient loss they can confirm. Which
  // is why the public URL ships as its own secondary link rather than hiding
  // behind the tracked CTA: a verifiable claim beside an unverifiable one is
  // what keeps the mail from reading as pure assertion, and a vendor who goes
  // and looks correctly stops the 2-day reminder.
  //
  // Rendered single-language: `locale` comes off the payload because the
  // subject is one string per kind, and a Hungarian subject on a mail to a
  // venue in Puglia is the fastest way into a spam folder.
  vendor_claim_campaign: (p) => ({
    subject: localeSubject(
      p.locale,
      `Egy pár ajánlotta a Weddlyn: ${p.listingName}`,
      `A couple recommended ${p.listingName} on Weddly`,
      {
        hr: `Par je predložio ${p.listingName} na Weddlyju`,
        de: `Ein Paar hat ${p.listingName} auf Weddly vorgeschlagen`,
      },
    ),
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: `${p.categoryLabel} · ${p.city}. Az oldal él, és most azt írja a pároknak, hogy a vállalkozástól még nem vette át senki.`,
      greeting: "Szia!",
      paragraphs: [
        `Egy pár, aki a Weddlyn tervezi az esküvőjét, ajánlotta a(z) **${p.listingName}** vállalkozást, így került fel az oldalatok: ${p.categoryLabel}, ${p.city}. Már él, és most azt írja a pároknak, hogy a vállalkozástól még nem vette át senki.`,
        "Hétről hétre ülnek le párok eldönteni, kit szeretnének maguk mellett életük legnagyobb napján. Amikor a ti oldalatokra érnek, a mi tippünket találják rólatok: a saját fotóitok, a csomagjaitok, az áraitok és a szabad időpontjaitok nélkül. Ha átveszed, az oldal a tiétek lesz, körülbelül két perc alatt.",
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      ctaSubtext:
        "Két perc: egy név és egy jelszó. Ez a cím már rajta van az oldalon, így nincs más igazolni való.",
      footnote: "Nem a te asztalod? Küldd tovább annak, aki a naptárat viszi, neki is működik.",
      secondaryLinks: [
        { label: "Nézd meg úgy, ahogy a párok látják", url: p.listingUrl },
        { label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl },
      ],
    },
    en: {
      preheader: `${p.categoryLabel} · ${p.city}. The page is live, and it tells couples nobody from the business has taken it over.`,
      greeting: "Hi there,",
      paragraphs: [
        `A couple planning their wedding on Weddly put **${p.listingName}** forward, which is how your page went up: ${p.categoryLabel}, ${p.city}. It is live, and right now it tells couples that nobody from the business has taken it over.`,
        "Couples are already using Weddly to choose their wedding team. Right now, your page is only our best draft: it has none of your own photos, packages, prices or availability. Claim it and make it yours in about two minutes.",
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      ctaSubtext:
        "Two minutes: your name and a password. This address is already on the page, so there is nothing else to verify.",
      footnote: "Not your desk? Send it on to whoever runs the diary, the link works for them too.",
      secondaryLinks: [
        { label: "See the page couples see", url: p.listingUrl },
        { label: "What is Weddly?", url: CONFIG.frontendBaseUrl },
      ],
    },
    extra: {
      hr: {
        preheader: `${p.categoryLabel} · ${p.city}. Stranica je objavljena i parovima piše da je iz tvrtke nitko nije preuzeo.`,
        greeting: "Pozdrav!",
        paragraphs: [
          `Par koji na Weddlyju planira vjenčanje predložio je **${p.listingName}**, tako je vaša stranica i nastala: ${p.categoryLabel}, ${p.city}. Objavljena je i parovima trenutno piše da je iz tvrtke nitko nije preuzeo.`,
          "Iz tjedna u tjedan parovi sjednu i odlučuju koga žele uz sebe na najvažniji dan svog života. Kad dođu do vaše stranice, nalaze našu pretpostavku o vama: bez vaših fotografija, paketa, cijena i slobodnih datuma. Preuzmite je i postaje vaša, za otprilike dvije minute.",
          offerSentenceFor("hr", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Preuzmite profil",
        ctaSubtext:
          "Dvije minute: ime i lozinka. Ova je adresa već na stranici, pa nema što dodatno potvrđivati.",
        footnote:
          "Niste vi zaduženi za to? Proslijedite kolegi koji vodi kalendar, link radi i njemu.",
        secondaryLinks: [
          { label: "Pogledajte stranicu kakvu vide parovi", url: p.listingUrl },
          { label: "Što je Weddly?", url: CONFIG.frontendBaseUrl },
        ],
      },
      de: {
        preheader: `${p.categoryLabel} · ${p.city}. Die Seite ist online und sagt Paaren, dass sie aus dem Betrieb noch niemand übernommen hat.`,
        greeting: "Hallo!",
        paragraphs: [
          `Ein Paar, das auf Weddly seine Hochzeit plant, hat **${p.listingName}** vorgeschlagen, so ist Ihre Seite entstanden: ${p.categoryLabel}, ${p.city}. Sie ist online und sagt Paaren gerade, dass sie aus dem Betrieb noch niemand übernommen hat.`,
          "Woche für Woche setzen sich Paare zusammen und entscheiden, wen sie am wichtigsten Tag ihres Lebens dabeihaben wollen. Wenn sie auf Ihrer Seite landen, finden sie unsere Vermutung über Sie: ohne Ihre Fotos, Ihre Pakete, Ihre Preise, Ihre freien Termine. Übernehmen Sie sie, und sie gehört Ihnen, in etwa zwei Minuten.",
          offerSentenceFor("de", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Profil übernehmen",
        ctaSubtext:
          "Zwei Minuten: Ihr Name und ein Passwort. Diese Adresse steht bereits auf der Seite, es gibt also nichts weiter zu bestätigen.",
        footnote:
          "Nicht Ihr Schreibtisch? Geben Sie es an die Person weiter, die den Kalender führt, der Link funktioniert auch für sie.",
        secondaryLinks: [
          { label: "Die Seite ansehen, die Paare sehen", url: p.listingUrl },
          { label: "Was ist Weddly?", url: CONFIG.frontendBaseUrl },
        ],
      },
    },
  }),
  // The single 2-day nudge. Shorter on purpose: they have the context from the
  // first mail, so this one is a reminder of the ask, not a re-pitch, and it
  // repeats the SAME fact rather than opening a new hook it would then have to
  // explain. It calls back to the referral because the first mail led with it,
  // and a follow-up that quietly changed its story would be the one thing worse
  // than the story itself.
  vendor_claim_campaign_reminder: (p) => ({
    subject: localeSubject(
      p.locale,
      `Két perc, és a ${p.listingName} oldala a tiétek`,
      `Two minutes to make ${p.listingName} yours`,
      {
        hr: `Dvije minute i ${p.listingName} je vaš`,
        de: `Zwei Minuten, und ${p.listingName} gehört Ihnen`,
      },
    ),
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: `Az oldalon még az áll, hogy a vállalkozástól nem vette át senki.`,
      greeting: "Szia!",
      paragraphs: [
        `Pár napja egy pár ajánlott titeket a Weddlyn, és a(z) ${p.listingName} oldala még mindig azokkal az adatokkal fut, amiket mi töltöttünk ki köré. A párok továbbra is azt olvassák rajta, hogy a vállalkozástól még nem vette át senki.`,
        `Két perc az egész: egy név, egy jelszó, utána a fotók, az árak és a szabad időpontok a tiétek.`,
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      footnote: "Még mindig nem a te asztalod? A link annak is működik, aki a naptárat viszi.",
      secondaryLinks: [{ label: "Nézd meg úgy, ahogy a párok látják", url: p.listingUrl }],
    },
    en: {
      preheader: `The page still tells couples nobody from the business runs it.`,
      greeting: "Hi there,",
      paragraphs: [
        `A couple put you forward on Weddly a few days ago, and ${p.listingName} still runs on the details we filled in around it. Couples reading the page are still told nobody from the business has taken it over.`,
        `Two minutes fixes it: your name, a password, and then the photos, the prices and the open dates are yours to set.`,
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      footnote: "Still the wrong desk? The link works for whoever runs the diary.",
      secondaryLinks: [{ label: "See the page couples see", url: p.listingUrl }],
    },
    extra: {
      hr: {
        preheader: `Stranica parovima još piše da je iz tvrtke nitko ne vodi.`,
        greeting: "Pozdrav!",
        paragraphs: [
          `Prije nekoliko dana par vas je predložio na Weddlyju, a ${p.listingName} još radi na podacima koje smo mi složili oko toga. Parovima na stranici i dalje piše da je iz tvrtke nitko nije preuzeo.`,
          `Dvije minute i riješeno je: ime, lozinka, a onda su fotografije, cijene i slobodni datumi vaši.`,
          offerSentenceFor("hr", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Preuzmite profil",
        footnote: "I dalje niste vi zaduženi? Link radi i kolegi koji vodi kalendar.",
        secondaryLinks: [{ label: "Pogledajte stranicu kakvu vide parovi", url: p.listingUrl }],
      },
      de: {
        preheader: `Auf der Seite steht Paaren gegenüber weiterhin, dass sie niemand aus dem Betrieb betreut.`,
        greeting: "Hallo!",
        paragraphs: [
          `Vor ein paar Tagen hat ein Paar Sie auf Weddly vorgeschlagen, und ${p.listingName} läuft noch auf den Angaben, die wir darum herum ergänzt haben. Paaren wird auf der Seite weiterhin gesagt, dass sie aus dem Betrieb noch niemand übernommen hat.`,
          `Zwei Minuten genügen: Ihr Name, ein Passwort, und dann bestimmen Sie die Fotos, die Preise und die freien Termine.`,
          offerSentenceFor("de", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Profil übernehmen",
        footnote:
          "Immer noch nicht Ihr Schreibtisch? Der Link funktioniert auch für die Person, die den Kalender führt.",
        secondaryLinks: [{ label: "Die Seite ansehen, die Paare sehen", url: p.listingUrl }],
      },
    },
  }),
  // Review-invite campaign to a CLAIMED vendor. Warm, not cold: they already
  // run a Weddly account. The hook is the news (reviews are open to anyone now),
  // the pitch is social proof ("let your past clients vouch for you to couples
  // who don't know you yet"), and the close is dead-simple sharing. The review
  // URL is shown as plain text in the body so it copies straight out of the
  // mail; the CTA is a tracked redirect (the click is half the reminder gate).
  //
  // Single-language render off `locale` (a HU subject to a vendor who signed up
  // in English reads as spam), forced by the guestLocale in the SendTarget.
  vendor_review_campaign: (p) => ({
    subject:
      p.locale === "hu"
        ? "Elkészült a saját Weddly értékelő linketek"
        : "Your Weddly review link is ready",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "A vélemények mostantól bárkitől jöhetnek. Kérj párat a korábbi pároktól.",
      greeting: p.businessName.trim() ? `Szia ${p.businessName.trim()}!` : "Szia!",
      paragraphs: [
        "Nagy hír: a Weddly-n a **vélemények mostantól bárkitől jöhetnek**. Nincs Weddly-fiók, nincs regisztráció, csak egy e-mail-cím kell. Akivel valaha dolgoztatok, pár kattintással értékelhet.",
        "A legtöbb pár, aki most nálunk böngész, még nem ismer titeket. Néhány őszinte, 5 csillagos vélemény a korábbi ügyfelektől a legjobb ajánlólevél. Hadd beszéljen helyettetek a munkátok, a párok pedig attól halljanak, aki már választott titeket.",
        `Itt a saját értékelő linketek, küldjétek el pár kedvenc korábbi páratoknak: **${p.reviewUrl}**`,
      ],
      cta: "Nézd meg az oldalad",
      ctaSubtext: "Pontosan ezt látják a párok is, belépés nélkül megnyílik.",
      secondaryLinks: [
        { label: "Megosztás WhatsApp-on", url: p.whatsappUrl },
        { label: "Küldés e-mailben", url: p.mailtoUrl },
        { label: "Kezelés a fiókodban", url: p.dashboardUrl },
      ],
      footnote:
        "Néhány csillag, rengeteg bizalom. A link bármikor elküldhető, akár egy régebbi páratoknak is.",
    },
    en: {
      preheader: "Reviews are now open to anyone. Ask a few past clients for some stars.",
      greeting: p.businessName.trim() ? `Hi ${p.businessName.trim()},` : "Hi there,",
      paragraphs: [
        "Big news: on Weddly, **reviews are now open to everyone**. No Weddly account, no sign-up, just an email address. Anyone you've ever worked with can leave you a rating in a couple of clicks.",
        "Most couples browsing right now don't know you yet. A handful of honest reviews from past clients says more than any sales copy: couples hear directly from people who have already booked you.",
        `Here's your own review link, send it to a few favourite past clients: **${p.reviewUrl}**`,
      ],
      cta: "See your review page",
      ctaSubtext: "It's exactly what couples see, and it opens with no login.",
      secondaryLinks: [
        { label: "Share on WhatsApp", url: p.whatsappUrl },
        { label: "Send by email", url: p.mailtoUrl },
        { label: "Manage in your dashboard", url: p.dashboardUrl },
      ],
      footnote:
        "A few stars, a lot of trust. Send the link whenever you like, even to a client from years back.",
    },
  }),
  // The single 7-day nudge, only to vendors who neither clicked nor opened the
  // first mail. Shorter: they have the context, this is a reminder of the ask.
  vendor_review_campaign_reminder: (p) => ({
    subject:
      p.locale === "hu"
        ? "Egy linkre vagytok az első értékelésektől"
        : "One link away from your first reviews",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "A vélemények nyitva állnak. Elég egy link a korábbi pároknak.",
      greeting: p.businessName.trim() ? `Szia ${p.businessName.trim()}!` : "Szia!",
      paragraphs: [
        "Pár napja írtunk: a Weddly-n a vélemények mostantól bárkitől jöhetnek. Ha van egy-két elégedett korábbi párotok, egyetlen link elég, hogy értékeljenek.",
        `Küldd el nekik a saját értékelő linketeket: **${p.reviewUrl}**. Néhány őszinte visszajelzés, és a böngésző párok máris tisztábban látják, mire számíthatnak tőletek.`,
      ],
      cta: "Nézd meg az oldalad",
      secondaryLinks: [
        { label: "Megosztás WhatsApp-on", url: p.whatsappUrl },
        { label: "Küldés e-mailben", url: p.mailtoUrl },
      ],
    },
    en: {
      preheader: "Reviews are open. One link to a past client is all it takes.",
      greeting: p.businessName.trim() ? `Hi ${p.businessName.trim()},` : "Hi there,",
      paragraphs: [
        "We wrote a few days ago: reviews on Weddly are now open to anyone. If you have a happy past client or two, a single link is all it takes for them to leave you a rating.",
        `Send them your review link: **${p.reviewUrl}**. A few genuine reviews give browsing couples a much clearer reason to trust you.`,
      ],
      cta: "See your review page",
      secondaryLinks: [
        { label: "Share on WhatsApp", url: p.whatsappUrl },
        { label: "Send by email", url: p.mailtoUrl },
      ],
    },
  }),
  // The founder's own contacts, introduced to Weddly with a "you (or someone you
  // love) is getting married" angle and a register CTA. Weddly is the voice the
  // whole way through (never "I"/"me", and NEVER signed with a personal name),
  // Uber-tight, and there is no discount / "free" framing. Outreach category, so
  // the footer carries the one-click unsubscribe. Personalised by first name.
  //
  // It opens by saying WHY this address was written to, because that is the
  // question a cold mail has to answer before any of the pitch lands, and here
  // there is a true answer: this list is people the founder actually knows.
  // The manifesto it used to open with (three paragraphs on changing wedding
  // planning from the ground up) said nothing about the reader and pushed the
  // CTA below a minute of reading. What is left is the reason, the what, and
  // the ask.
  personal_invite: (p) => ({
    subject:
      p.locale === "hu"
        ? "Az egész esküvő egy nyugodt helyen"
        : "Your whole wedding, in one calm place",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "Vendéglista, ülésrend, költségvetés, RSVP. Egy helyen.",
      greeting: p.name.trim() ? `Szia ${p.name.trim()}!` : "Szia!",
      paragraphs: [
        "Azért kapod ezt a levelet, mert valahonnan ismerjük egymást, és a **Weddly** most jutott el odáig, hogy megmutassuk.",
        "Egy helyre teszi, ami ma külön táblázatokban, üzenetekben és böngészőfülekben él: a költségvetést, a vendéglistát, az online RSVP-t, az ülésrendet, a szolgáltatókat és az esküvői weboldalt.",
        "Ha te vagy valaki a környezetedben esküvőt szervez, nyisd meg és nézd meg belülről.",
      ],
      cta: "Megnézem",
      ctaSubtext: "Két kattintás, és kész a fiók.",
      footnote:
        "Ismersz jegyespárt? Küldd tovább nekik. Kérdésed van? Válaszolj erre a levélre, minden sort elolvasunk.",
    },
    en: {
      preheader: "Guest list, seating, budget, RSVP. In one place.",
      greeting: p.name.trim() ? `Hi ${p.name.trim()},` : "Hi there,",
      paragraphs: [
        "You're getting this because our paths have crossed somewhere, and **Weddly** has reached the point where we want to show it to you.",
        "It puts in one place what today lives in separate spreadsheets, messages and browser tabs: the budget, the guest list, online RSVP, the seating chart, the suppliers and the wedding website.",
        "If you, or someone close to you, is planning a wedding, open it and have a look inside.",
      ],
      cta: "Take a look",
      ctaSubtext: "Two clicks and your account is ready.",
      footnote:
        "Know an engaged couple? Send it on to them. Questions? Just reply to this email, we read every line.",
    },
  }),
  // Admin re-engagement blast to a registered couple who never onboarded. Warm,
  // low-friction, the whole pitch is "2 minutes and your planner is seeded".
  // Outreach category, so the footer carries the one-click unsubscribe.
  onboarding_campaign: (p) => ({
    whyLine: {
      hu: "Ezt azért kaptad, mert van Weddly-fiókod.",
      en: "You're getting this because you have a Weddly account.",
    },
    subject:
      p.locale === "hu"
        ? "2 perc, és kész az esküvőterveződ alapja"
        : "Your wedding planner is two minutes away",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "Regisztráltál, de a terveződ még üres. Pár adat, és indulhat.",
      greeting: p.name.trim() ? `Szia ${p.name.trim()}!` : "Szia!",
      paragraphs: [
        "Regisztráltál a **Weddly**-re, de az alap beállítást még nem fejezted be, így a tervező egyelőre üres.",
        "Pár perc az egész: pár adat (nevek, dátum, vendégszám), és máris a kezedben egy szabható **költségvetés**, **vendéglista** online RSVP-vel és egy **ülésrend-vázlat**. Minden egy nyugodt helyen, magyarul.",
        "Nem kell mindent egyszerre eldöntenetek: ami most még nincs meg, azt később pótolhatjátok.",
      ],
      cta: "Befejezem a beállítást",
      ctaSubtext: "2 perc az egész.",
      footnote:
        "Ezt azért kaptad, mert van egy Weddly-fiókod. Kérdésed van? Válaszolj erre a levélre.",
    },
    en: {
      preheader: "You signed up, but your planner is still empty. A few facts and you're set.",
      greeting: p.name.trim() ? `Hi ${p.name.trim()},` : "Hi there,",
      paragraphs: [
        "You signed up for **Weddly**, but you haven't finished the initial setup, so your planner is still empty.",
        "It only takes a few minutes: a few facts (names, date, guest count) and you'll have a flexible **budget**, a **guest list** with online RSVP, and a **seating skeleton** ready to shape. Everything in one calm place.",
        "You don't have to decide everything at once: anything missing today can be filled in later.",
      ],
      cta: "Finish setup",
      ctaSubtext: "Takes 2 minutes.",
      footnote:
        "You're getting this because you have a Weddly account. Questions? Just reply to this email.",
    },
  }),

  // The single reminder wave for the campaign above, sent only to recipients
  // still without a workspace. Warmer and shorter, framed as "we kept your spot".
  onboarding_campaign_reminder: (p) => ({
    whyLine: {
      hu: "Ezt azért kaptad, mert van Weddly-fiókod.",
      en: "You're getting this because you have a Weddly account.",
    },
    subject:
      p.locale === "hu"
        ? "Még megvan a helyed, fejezzük be együtt?"
        : "Your planner is ready when you are",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "Pár napja kezdtél bele. A terveződ egy kattintásra van a kezdéstől.",
      greeting: p.name.trim() ? `Szia ${p.name.trim()}!` : "Szia!",
      paragraphs: [
        "Pár napja szóltunk, hogy a Weddly-fiókod megvan, de a tervező még üres. Megtartottuk neked a helyed.",
        "Pár adat (nevek, dátum, vendégszám), és máris kapsz egy szabható költségvetést, vendéglistát és ülésrend-vázat. Utána bármit módosíthatsz.",
      ],
      cta: "Elkezdem most",
      ctaSubtext: "2 perc az egész.",
      footnote: "A helyed megvár, akkor is, ha csak jövő héten jutsz hozzá.",
    },
    en: {
      preheader: "You started a few days ago. Your planner is one click from ready.",
      greeting: p.name.trim() ? `Hi ${p.name.trim()},` : "Hi there,",
      paragraphs: [
        "A few days ago we mentioned your Weddly account is set up but your planner is still empty. We kept your spot.",
        "A few facts (names, date, guest count) and you'll get a flexible budget, guest list, and seating skeleton. Change anything afterwards.",
      ],
      cta: "Start now",
      ctaSubtext: "Takes 2 minutes.",
      footnote: "Your spot will wait, even if you only get to it next week.",
    },
  }),

  // P2.C, vendor claim verify mail. Categorised as `outreach`: anyone (no
  // auth) can hit /api/vendor/claim/start with a listing id, so the recipient
  // didn't necessarily start the flow themselves. The footer copy reflects
  // that ("no Weddly account, ignore = nothing happens").
  vendor_claim_verify: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `Erősítsd meg a ${p.listingName} adatlapjának átvételét`,
      `Confirm your ${p.listingName} listing claim`,
    ),
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: `${p.listingName} listing átvétele.`,
      greeting: "Szia!",
      paragraphs: [
        `Valaki a Weddlyn szeretné átvenni ${huArticle(p.listingName)} ${p.listingName} adatlapját.`,
        "Ha te vagy, kattints az alábbi linkre. Beállíthatsz egy jelszót, és ezután te szerkesztheted az adatlapot a katalógusban.",
        "Ha nem te kezdeményezted, hagyd figyelmen kívül ezt az e-mailt, kattintás nélkül semmi sem történik.",
      ],
      cta: "Adatlap átvétele",
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
    subject: localeSubject(
      ctx.recipientLocale,
      `Listing-igénylés indult`,
      `Claim started, ${p.listingName}`,
    ),
    ctaUrl: p.adminUrl,
    hu: {
      preheader: `${p.listingName}: valaki igényelni szeretné.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Valaki elindította a ${p.listingName} adatlapjának átvételét a Weddly katalógusában.`,
        [
          `• Listing: ${p.listingName} (${p.listingId})`,
          `• Igénylő által megadott email: ${p.claimantEmail}`,
          `• Megerősítő link kiküldve ide: ${p.contactEmailMasked}`,
        ].join("\n"),
        "A megerősítő link a listingen szereplő hivatalos címre ment, ez igazolja a tulajdonjogot. Ez a levél csak figyelmeztetés, nincs teendő, hacsak nem tűnik gyanúsnak.",
      ],
      cta: "Admin felület megnyitása",
      footnote: "Ezt minden adatlap-igénylés indulásakor elküldjük az adminoknak.",
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
  community_supplier_published: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `A ${p.supplierName} adatlapja éles`,
      `${p.supplierName} is now live`,
    ),
    ctaUrl: p.listingUrl,
    hu: {
      preheader: `${p.supplierName} mostantól látszik a Weddly katalógusban.`,
      greeting: "Szia!",
      paragraphs: [
        `Megnéztük és átengedtük: ${p.supplierName} mostantól szerepel a Weddly publikus szolgáltató-katalógusban.`,
        "A párok mostantól rátalálhatnak. Ha bármi adat változna (telefonszám, weboldal, leírás), válaszolj erre az e-mailre, emberek olvassák.",
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
  community_supplier_rejected: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `A ${p.supplierName} adatlapját nem hagytuk jóvá`,
      `Listing not approved`,
    ),
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
  community_supplier_reported: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `Frissítést kértek a ${p.supplierName} adatlapján`,
      `Feedback on your listing`,
    ),
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.supplierName} hirdetését jelentették.`,
      greeting: "Szia!",
      paragraphs: [
        `Egy felhasználó visszajelzést küldött a(z) ${p.supplierName} hirdetésedről a Weddly katalógusban.`,
        `Jelentés oka: ${humanReportReasonHu(p.reason)}`,
        "Ez egy első jelzés; a nyilvános megjelenés egyelőre nem változik. Ha tudod, mit érdemes pontosítani (például a címet, a leírást vagy a képeket), válaszolj erre az e-mailre, és segítünk frissíteni.",
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
    subject: localeSubject(ctx.recipientLocale, `A listinged a tiéd`, `${p.listingName} is yours`),
    ctaUrl: p.managerUrl,
    hu: {
      preheader: `${p.listingName} mostantól a tiéd a Weddly-n.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Sikerült: ${p.listingName} mostantól a Weddly vendor fiókodhoz tartozik.`,
        "Innentől te szerkesztheted az adatokat, leírás, árak, képek, elérhetőség. A párok ugyanazt látják mint te a publikus katalógusban.",
        "Ha kérdés van vagy bármi nem stimmel, válaszolj erre az e-mailre, emberek olvassák.",
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
    extra: {
      hr: {
        preheader: `${p.listingName} je od sada vaš na Weddlyju.`,
        greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Uspjelo je: ${p.listingName} od sada pripada vašem Weddly računu dobavljača.`,
          "Od sada podatke uređujete vi: opis, cijene, fotografije, kontakt. Parovi u javnom katalogu vide točno ono što objavite.",
          "Ako imate pitanje ili nešto ne štima, odgovorite na ovu poruku, čitaju je ljudi.",
        ],
        cta: "Uredite svoj oglas",
      },
      de: {
        preheader: `${p.listingName} gehört ab jetzt Ihnen auf Weddly.`,
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Geschafft: ${p.listingName} gehört ab jetzt zu Ihrem Weddly-Dienstleisterkonto.`,
          "Ab hier bearbeiten Sie die Angaben selbst: Beschreibung, Preise, Fotos, Kontaktdaten. Paare im öffentlichen Katalog sehen genau das, was Sie veröffentlichen.",
          "Fragen, oder stimmt etwas nicht? Antworten Sie auf diese E-Mail, ein Mensch liest mit.",
        ],
        cta: "Eintrag verwalten",
      },
    },
  }),

  // An admin moved a mis-routed vendor account over to the planner side. Sent
  // because the alternative is silent: their vendor dashboard is simply gone at
  // the next sign-in. Framed as "we put you in the right place", not as a
  // downgrade, and it never mentions the mistake being ours or theirs.
  vendor_moved_to_planner: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `A fiókod átkerült a szervezői oldalra`,
      `Your account moved to the planner side`,
    ),
    ctaUrl: p.plannerUrl,
    hu: {
      preheader: `${p.businessName}: mostantól szervezői fiók.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A ${p.businessName} fiókját átraktuk a Weddly szervezői oldalára, mert az esküvőszervezés nálunk külön eszközkészletet kap.`,
        "A belépésed változatlan: ugyanaz az e-mail cím és jelszó. Belépés után a szervezői felület fogad, ahol a párokkal közös munkaterületen dolgozol, nem katalógusban hirdetsz.",
        "Ha kérdésed van vagy mégis szolgáltatóként hirdetnél, válaszolj erre az e-mailre, emberek olvassák.",
      ],
      cta: "Szervezői felület",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We moved ${p.businessName} over to the planner side of Weddly, where wedding planning gets its own toolset.`,
        "Your sign-in is unchanged: same email, same password. Next time you log in you'll land on the planner workspace, where you plan alongside couples instead of advertising in the catalog.",
        "Questions, or you'd rather be listed as a supplier after all? Reply to this email, a human reads it.",
      ],
      cta: "Open the planner workspace",
    },
  }),

  // A couple wrote to a shortlisted vendor. What the mail carries depends on
  // whether the recipient has another way to read the message — see
  // `SupplierOutreachMode`:
  //
  //   in_account → the inquiry is in their Weddly client list, so this is a
  //     NOTIFICATION: who, what topic, which date, when. No message body and
  //     no Reply-To, because answering happens in the product, where the
  //     thread is kept and the rest of their leads already live.
  //   account / claim → nothing else will show them the message, so the mail
  //     carries it in full and the couple's address goes in the Reply-To (and
  //     in the closing line, for the few clients that strip the header).
  //
  // Only the destination of the button differs between the last two: a vendor
  // with an account goes to their dashboard, an unclaimed business to its own
  // public profile, where the claim notice is.
  supplier_outreach: (p) => {
    const dateHu = p.eventDate ? isoDateLabel(p.eventDate, "hu") : "";
    const dateEn = p.eventDate ? isoDateLabel(p.eventDate, "en") : "";
    const sentHu = timestampLabel(p.sentAt, "hu");
    const sentEn = timestampLabel(p.sentAt, "en");

    if (p.mode === "in_account") {
      // The facts a vendor decides on before opening anything: is that date
      // free, what is it about, and how warm is it. An unknown date is stated
      // rather than dropped, because "no date yet" is itself a useful answer.
      // The closing line is PLAN-AWARE. Answering on the booking thread is a
      // PRO surface, so promising "reply there" to a FREE vendor walks them
      // into a paywall on arrival. What every plan does get is the lead itself
      // and the couple's address on the client card, so that is what the FREE
      // variant points at. It sells nothing: the upgrade prompt lives in the
      // product, where they can see what they would be buying.
      const closingHu = p.canReplyInApp
        ? "Az üzenet az ügyfeleid között vár. Ott tudsz válaszolni rá, és ott marad a többi érdeklődés mellett."
        : "Az üzenet az ügyfeleid között vár, a pár elérhetőségével együtt, és ott marad a többi érdeklődés mellett.";
      const closingEn = p.canReplyInApp
        ? "The message is waiting in your client list. Reply there and it stays with the rest of your inquiries."
        : "The message is waiting in your client list, along with the couple's contact details, and it stays with the rest of your inquiries.";
      const huParas = [
        `**${p.coupleDisplayName}** érdeklődik nálatok a Weddly-n keresztül.`,
        `**Téma:** ${p.subject}`,
        `**Esküvő időpontja:** ${dateHu || "még nincs kitűzve"}`,
        ...(sentHu ? [`**Beérkezett:** ${sentHu}`] : []),
        closingHu,
      ];
      const enParas = [
        `**${p.coupleDisplayName}** got in touch through Weddly.`,
        `**Topic:** ${p.subject}`,
        `**Wedding date:** ${dateEn || "not set yet"}`,
        ...(sentEn ? [`**Received:** ${sentEn}`] : []),
        closingEn,
      ];
      return {
        subject: `${p.coupleDisplayName}, ${p.subject}`,
        ctaUrl: p.outreachUrl,
        hu: {
          preheader: `${p.subject}${dateHu ? ` · ${dateHu}` : ""}`,
          greeting: `Szia ${p.supplierName}!`,
          paragraphs: huParas,
          cta: "Érdeklődés megnyitása",
        },
        en: {
          preheader: `${p.subject}${dateEn ? ` · ${dateEn}` : ""}`,
          greeting: `Hi ${p.supplierName},`,
          paragraphs: enParas,
          cta: "Open the inquiry",
        },
        extra: {
          hr: {
            preheader: `${p.subject}${dateEn ? ` · ${dateEn}` : ""}`,
            greeting: `Pozdrav ${p.supplierName}!`,
            paragraphs: [
              `**${p.coupleDisplayName}** vam se javio preko Weddlyja.`,
              `**Tema:** ${p.subject}`,
              `**Datum vjenčanja:** ${dateEn || "još nije određen"}`,
              ...(sentEn ? [`**Zaprimljeno:** ${sentEn}`] : []),
              p.canReplyInApp
                ? "Poruka vas čeka među klijentima. Ondje možete odgovoriti i ostaje uz ostale upite."
                : "Poruka vas čeka među klijentima, zajedno s kontaktom para, i ostaje uz ostale upite.",
            ],
            cta: "Otvorite upit",
          },
          de: {
            preheader: `${p.subject}${dateEn ? ` · ${dateEn}` : ""}`,
            greeting: `Hallo ${p.supplierName},`,
            paragraphs: [
              `**${p.coupleDisplayName}** hat sich über Weddly gemeldet.`,
              `**Thema:** ${p.subject}`,
              `**Hochzeitsdatum:** ${dateEn || "noch nicht festgelegt"}`,
              ...(sentEn ? [`**Eingegangen:** ${sentEn}`] : []),
              p.canReplyInApp
                ? "Die Nachricht wartet in Ihrer Kundenliste. Dort antworten Sie, und sie bleibt bei Ihren übrigen Anfragen."
                : "Die Nachricht wartet in Ihrer Kundenliste, zusammen mit den Kontaktdaten des Paares, und bleibt bei Ihren übrigen Anfragen.",
            ],
            cta: "Anfrage öffnen",
          },
        },
      };
    }

    // Plain-text body uses real newlines; the renderer escapes them into
    // <br>s on the HTML side via per-paragraph splitting.
    const bodyParas = p.body
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const huParas: string[] = [
      `${p.coupleDisplayName} vagyunk a Weddly-n, és érdeklődnénk a szolgáltatásotok iránt.`,
      ...(dateHu ? [`**Esküvő időpontja:** ${dateHu}`] : []),
      ...bodyParas,
      `Ha bármi felmerül, közvetlenül erre az e-mail címre válaszolhatsz: ${p.coupleReplyEmail}, ${p.coupleReplyName}.`,
    ];
    const enParas: string[] = [
      `We're ${p.coupleDisplayName}, planning our wedding with Weddly, and reaching out about your services.`,
      ...(dateEn ? [`**Wedding date:** ${dateEn}`] : []),
      ...bodyParas,
      `Reply directly to this email and it'll land in our inbox: ${p.coupleReplyEmail}, ${p.coupleReplyName}.`,
    ];
    return {
      subject: `${p.coupleDisplayName}, ${p.subject}`,
      ctaUrl: p.outreachUrl,
      // Reply-To override sends the vendor's reply straight to the couple
      // owner's inbox instead of CONFIG.supportEmail. There is no inbound
      // webhook, so on these two modes this header IS the entire reply
      // pipeline: any plumbing change here without the matching DNS work
      // would silently drop replies. The closing line also surfaces the
      // address so a client that strips Reply-To (a few legacy webmails do)
      // still gives the vendor something to copy.
      replyTo: p.coupleReplyEmail,
      hu: {
        preheader: p.subject,
        greeting: `Szia ${p.supplierName}!`,
        paragraphs: huParas,
        cta: p.mode === "claim" ? "Megnézem a profilomat" : "Weddly fiók megnyitása",
      },
      en: {
        preheader: p.subject,
        greeting: `Hi ${p.supplierName},`,
        paragraphs: enParas,
        cta: p.mode === "claim" ? "See your profile" : "Open your Weddly account",
      },
    };
  },

  // A planner clicked "request access" against a couple's workspace. The couple
  // owns a Weddly account and must approve before the planner sees anything —
  // this mail points them at the Planners panel to accept/decline. Reply-To is
  // the planner's email so the couple can reach back out directly.
  planner_access_requested: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Tervező hozzáférést kért",
      "A planner requested access · Weddly",
    ),
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

  // A vendor answered the couple on the booking thread. No Reply-To on purpose:
  // the thread is the record, and the outreach mail already promised the couple
  // the conversation lives in Weddly. Attachments are LINKED, never attached:
  // they sit behind an authenticated download route because they are quotes and
  // contracts.
  vendor_message: (p, ctx) => {
    const bodyParas = p.bodyText.split("\n").filter((line) => line.trim().length > 0);
    const huAttach =
      p.attachmentCount > 0 ? [`${p.attachmentCount} csatolmány érkezett az üzenettel.`] : [];
    const enAttach =
      p.attachmentCount > 0
        ? [
            `${p.attachmentCount} attachment${p.attachmentCount === 1 ? "" : "s"} came with this message.`,
          ]
        : [];
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.vendorName} válaszolt · Weddly`,
        `${p.vendorName} replied · Weddly`,
      ),
      ctaUrl: `${CONFIG.frontendBaseUrl}${p.threadUrl}`,
      hu: {
        preheader: `${p.vendorName} üzenetet küldött.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `**${p.vendorName}** válaszolt a megkeresésetekre:`,
          ...bodyParas,
          ...huAttach,
        ],
        cta: "Üzenet megnyitása",
      },
      en: {
        preheader: `${p.vendorName} sent you a message.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [`**${p.vendorName}** replied to your inquiry:`, ...bodyParas, ...enAttach],
        cta: "Open the message",
      },
    };
  },

  // Automation 1: the vendor's own acknowledgement, sent the moment the inquiry
  // landed. The copy has one job beyond delivering their words, and it is to say
  // that a machine sent them: an acknowledgement that reads as a personal reply
  // makes the vendor's real answer, hours later, look like a repetition. The
  // same text also sits on the booking thread, marked the same way, so neither
  // side is ever surprised by words in the vendor's name.
  vendor_auto_reply: (p, ctx) => {
    const bodyParas = p.bodyText.split("\n").filter((line) => line.trim().length > 0);
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.vendorName} visszajelzett`,
        `${p.vendorName} got back to you · Weddly`,
      ),
      ctaUrl: `${CONFIG.frontendBaseUrl}${p.threadUrl}`,
      hu: {
        preheader: `${p.vendorName} megkapta a megkereséseteket.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `**${p.vendorName}** megkapta a megkereséseteket, és ezt üzeni:`,
          ...bodyParas,
          "Ez automatikus visszajelzés volt. A részletes válasz ezután érkezik, és ugyanebben a beszélgetésben olvashatjátok.",
        ],
        cta: "Beszélgetés megnyitása",
      },
      en: {
        preheader: `${p.vendorName} received your inquiry.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `**${p.vendorName}** received your inquiry and sent this straight back:`,
          ...bodyParas,
          "That was an automatic acknowledgement. Their own answer follows, in the same conversation.",
        ],
        cta: "Open the conversation",
      },
    };
  },

  // Automation 2: to the VENDOR, about a couple still waiting. The hours are
  // `vendorAttention`'s own count, so the mail and the attention band on the
  // vendor's screen can never quote two different numbers about one lead.
  vendor_lead_reminder: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `${p.coupleName} még válaszra vár`,
      `${p.coupleName} are still waiting · Weddly`,
    ),
    ctaUrl: `${CONFIG.frontendBaseUrl}${p.clientUrl}`,
    hu: {
      preheader: `${p.coupleName} ${p.waitingHours} órája vár válaszra.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.coupleName}** ${p.waitingHours} órája vár válaszra, a ${p.eventDate} dátumú megkeresésre.`,
        "Pár sor is elég ahhoz, hogy a megkeresés életben maradjon.",
      ],
      cta: "Ügyfél megnyitása",
    },
    en: {
      preheader: `${p.coupleName} has been waiting ${p.waitingHours} hours.`,
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.coupleName}** has been waiting ${p.waitingHours} hours for an answer about ${p.eventDate}.`,
        "A couple of lines is usually all it takes to keep the lead alive.",
      ],
      cta: "Open the client",
    },
  }),

  // Automation 3: to the COUPLE, and only because the vendor pressed Approve.
  // Nothing schedules this; a proposal sits in the vendor's queue until a human
  // decides, which is why the copy can speak in the vendor's name at all.
  vendor_review_request: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `${p.vendorName} értékelése`,
      `Rate ${p.vendorName} · Weddly`,
    ),
    ctaUrl: p.reviewUrl,
    hu: {
      preheader: `Pár csillag ${p.vendorName} munkájára.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A ${p.eventDate} napi esküvőtökön **${p.vendorName}** dolgozott veletek.`,
        "Ha van rá pár másodpercetek, egy őszinte értékelés rengeteget segít a következő pároknak, és nekik is.",
        "**Egy kattintás csillagonként.** Ha kedvetek van hozzá, írhattok mellé pár szót is.",
      ],
      cta: "Értékelem őket",
    },
    en: {
      preheader: `A few stars for ${p.vendorName}.`,
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.vendorName}** worked with you at your wedding on ${p.eventDate}.`,
        "If you have a few seconds, an honest rating helps the next couples enormously, and helps them too.",
        "**One click per star.** Add a line or two if you feel like it.",
      ],
      cta: "Leave a rating",
    },
  }),

  // The couple wrote back. Goes to the vendor account owner and lands them on
  // the client card, which is where the thread and the CRM fields already are.
  couple_message: (p, ctx) => {
    const bodyParas = p.bodyText.split("\n").filter((line) => line.trim().length > 0);
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.coupleName} üzenetet küldött · Weddly`,
        `${p.coupleName} sent you a message · Weddly`,
      ),
      ctaUrl: `${CONFIG.frontendBaseUrl}${p.threadUrl}`,
      hu: {
        preheader: `${p.coupleName} írt neked.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [`**${p.coupleName}** üzenetet küldött:`, ...bodyParas],
        cta: "Válasz a Weddly-ben",
      },
      en: {
        preheader: `${p.coupleName} wrote to you.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [`**${p.coupleName}** sent you a message:`, ...bodyParas],
        cta: "Reply in Weddly",
      },
      extra: {
        hr: {
          preheader: `${p.coupleName} vam je pisao.`,
          greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [`**${p.coupleName}** vam je poslao poruku:`, ...bodyParas],
          cta: "Odgovorite na Weddlyju",
        },
        de: {
          preheader: `${p.coupleName} hat Ihnen geschrieben.`,
          greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [`**${p.coupleName}** hat Ihnen eine Nachricht geschickt:`, ...bodyParas],
          cta: "In Weddly antworten",
        },
      },
    };
  },

  // The vendor priced the inquiry. The headline number is in the body AND the
  // preheader, because a quote is judged from the inbox before it is opened,
  // and a mail that only says "you have an offer" makes the couple work for
  // the one fact they want. The lines themselves stay in the product: the
  // couple answers there, and the answer is what the vendor is waiting on.
  vendor_quote: (p, ctx) => {
    const huValid = p.validUntil ? [`Az ajánlat ${p.validUntil}-ig érvényes.`] : [];
    const enValid = p.validUntil ? [`The offer is valid until ${p.validUntil}.`] : [];
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.vendorName} árajánlatot küldött`,
        `${p.vendorName} sent you a quote · Weddly`,
      ),
      ctaUrl: `${CONFIG.frontendBaseUrl}${p.quoteUrl}`,
      hu: {
        preheader: `${p.vendorName} árajánlata: ${p.totalText}.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `**${p.vendorName}** árajánlatot küldött a megkeresésetekre: **${p.title}**.`,
          `Végösszeg: **${p.totalText}**.`,
          ...huValid,
          "A tételes bontás a Weddlyben van, és ott tudtok válaszolni is rá.",
        ],
        cta: "Árajánlat megnyitása",
      },
      en: {
        preheader: `${p.vendorName} quoted ${p.totalText}.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `**${p.vendorName}** sent a quote for your inquiry: **${p.title}**.`,
          `Total: **${p.totalText}**.`,
          ...enValid,
          "The itemised offer is in Weddly, and that is where you answer it.",
        ],
        cta: "Open the quote",
      },
    };
  },

  // The couple answered. One kind, one mail, two outcomes: the vendor is
  // waiting on the same question either way, and splitting it into two kinds
  // would give the same event two categories to drift apart on. A decline
  // carries the couple's own words when they left any, because that sentence is
  // the whole difference between a lost lead and a lesson.
  quote_response: (p, ctx) => {
    const huReason = p.declineReason ? [`Amit írtak: "${p.declineReason}"`] : [];
    const enReason = p.declineReason ? [`What they wrote: "${p.declineReason}"`] : [];
    const subject = p.accepted
      ? localeSubject(
          ctx.recipientLocale,
          `${p.coupleName} elfogadta az árajánlatot`,
          `${p.coupleName} accepted your quote · Weddly`,
        )
      : localeSubject(
          ctx.recipientLocale,
          `${p.coupleName} válaszolt az árajánlatra`,
          `${p.coupleName} answered your quote · Weddly`,
        );
    return {
      subject,
      ctaUrl: `${CONFIG.frontendBaseUrl}${p.quoteUrl}`,
      hu: {
        preheader: p.accepted
          ? `${p.coupleName} elfogadta a ${p.totalText} összegű ajánlatodat.`
          : `${p.coupleName} másik irányba indult el.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: p.accepted
          ? [
              `**${p.coupleName}** elfogadta az árajánlatodat: **${p.title}** (${p.totalText}).`,
              "Nyisd meg az ügyfélkártyát a Weddlyben, és egyeztessétek a következő lépést.",
            ]
          : [
              `**${p.coupleName}** ezúttal nem az ajánlatodat választotta: **${p.title}** (${p.totalText}).`,
              ...huReason,
              "Ha van mozgástered, küldhetsz nekik új ajánlatot ugyanerre a megkeresésre.",
            ],
        cta: "Megnyitás a Weddlyben",
      },
      en: {
        preheader: p.accepted
          ? `${p.coupleName} accepted your ${p.totalText} quote.`
          : `${p.coupleName} went another way.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: p.accepted
          ? [
              `**${p.coupleName}** accepted your quote: **${p.title}** (${p.totalText}).`,
              "Open the client card in Weddly and agree the next step with them.",
            ]
          : [
              `**${p.coupleName}** went another way on this one: **${p.title}** (${p.totalText}).`,
              ...enReason,
              "If you have room to move, you can send them a new offer on the same inquiry.",
            ],
        cta: "Open in Weddly",
      },
      extra: {
        hr: {
          preheader: p.accepted
            ? `${p.coupleName} je prihvatio vašu ponudu na ${p.totalText}.`
            : `${p.coupleName} je krenuo drugim putem.`,
          greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
          paragraphs: p.accepted
            ? [
                `**${p.coupleName}** je prihvatio vašu ponudu: **${p.title}** (${p.totalText}).`,
                "Otvorite karticu klijenta na Weddlyju i dogovorite sljedeći korak.",
              ]
            : [
                `**${p.coupleName}** ovaj put nije odabrao vašu ponudu: **${p.title}** (${p.totalText}).`,
                ...(p.declineReason ? [`Napisali su: "${p.declineReason}"`] : []),
                "Ako imate prostora, možete im poslati novu ponudu na isti upit.",
              ],
          cta: "Otvorite na Weddlyju",
        },
        de: {
          preheader: p.accepted
            ? `${p.coupleName} hat Ihr Angebot über ${p.totalText} angenommen.`
            : `${p.coupleName} hat sich anders entschieden.`,
          greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
          paragraphs: p.accepted
            ? [
                `**${p.coupleName}** hat Ihr Angebot angenommen: **${p.title}** (${p.totalText}).`,
                "Öffnen Sie die Kundenkarte in Weddly und stimmen Sie den nächsten Schritt ab.",
              ]
            : [
                `**${p.coupleName}** hat sich diesmal anders entschieden: **${p.title}** (${p.totalText}).`,
                ...(p.declineReason ? [`Geschrieben wurde: "${p.declineReason}"`] : []),
                "Wenn Sie Spielraum haben, können Sie zur selben Anfrage ein neues Angebot schicken.",
              ],
          cta: "In Weddly öffnen",
        },
      },
    };
  },

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
        footnote: `From: ${p.senderName} (${p.senderEmail}) | Weddly`,
      },
    };
  },

  // The couple approved the planner's pending access request. Heads-up to the
  // planner that they can now enter the workspace from their dashboard.
  planner_access_approved: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Ügyfél jóváhagyta a hozzáférést",
      "Client approved your access · Weddly",
    ),
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
    subject: localeSubject(ctx.recipientLocale, "Új ügyfél meghívó", "New client invite · Weddly"),
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
  planner_email_invite: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Meghívó a Weddly-re",
      "You're invited to Weddly · Weddly",
    ),
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
  // important nudge, which is why the CTA follows `nextStep` rather than the
  // session: an applicant who already registered months ago must be sent to
  // their own account, not through a second signup that can only 409.
  planner_waitlist_received: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Megkaptuk a jelentkezésed",
      "Application received · Weddly",
    ),
    ctaUrl:
      p.nextStep === "register"
        ? `${CONFIG.frontendBaseUrl}/signup`
        : p.nextStep === "planner_dashboard"
          ? `${CONFIG.frontendBaseUrl}/app/planner`
          : `${CONFIG.frontendBaseUrl}/login`,
    // The stock outreach footer states "you don't have an account with us",
    // which both account branches contradict two lines above it.
    whyLine:
      p.nextStep === "register"
        ? undefined
        : {
            hu: "Ezt a levelet azért kaptad, mert ezzel a címmel jelentkeztél a Weddly tervezői programjába.",
            en: "You're getting this because you applied to the Weddly planner programme with this address.",
          },
    hu: {
      preheader:
        p.nextStep === "sign_in"
          ? "Ezzel a címmel már van Weddly-fiókod."
          : "A szervezői hozzáférésed készen áll.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs:
        p.nextStep === "planner_dashboard"
          ? [
              "Köszönjük a jelentkezésed a Weddly tervezői programjába. A szervezői hozzáférésed a **meglévő fiókodon** aktív, tehát nem kell újra regisztrálnod.",
              "Lépj be, és a felület végigvezet a profilod beállításán (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban.",
            ]
          : p.nextStep === "sign_in"
            ? [
                "Köszönjük a jelentkezésed a Weddly tervezői programjába. Ezzel az e-mail címmel **már van fiókod**, tehát nem kell újra regisztrálnod.",
                "Lépj be a meglévő fiókodba. A szervezői hozzáférést kézzel nyitjuk meg ezen a fiókon, és jelzünk, amint kész.",
              ]
            : [
                "Köszönjük a jelentkezésed a Weddly tervezői programjába. A hozzáférésed készen áll.",
                "Már csak egy lépés van hátra: regisztrálj **ugyanezzel az e-mail címmel**, és a fiókod automatikusan szervezői fiókként jön létre.",
                "Ezután töltsd ki a profilod (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban.",
              ],
      cta:
        p.nextStep === "planner_dashboard"
          ? "Belépés a tervező felületre"
          : p.nextStep === "sign_in"
            ? "Belépés a fiókba"
            : "Fiók létrehozása",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs:
        p.nextStep === "planner_dashboard"
          ? [
              "Thanks for applying to the Weddly planner programme. Your planner access is live on **the account you already have**, so there is nothing to register.",
              "Sign in and the app walks you through your profile (business name and city) so you appear in the planner directory couples browse.",
            ]
          : p.nextStep === "sign_in"
            ? [
                "Thanks for applying to the Weddly planner programme. This email address **already has a Weddly account**, so there is nothing to register.",
                "Sign in to the account you have. We'll open the planner side on it by hand and let you know once it's ready.",
              ]
            : [
                "Thanks for applying to the Weddly planner programme. Your access is ready.",
                "One step left: create an account with **this same email address** and it will automatically be set up as a planner account.",
                "Then fill in your profile (business name and city) to appear in the planner directory couples browse.",
              ],
      cta:
        p.nextStep === "planner_dashboard"
          ? "Open planner dashboard"
          : p.nextStep === "sign_in"
            ? "Sign in"
            : "Create your account",
    },
  }),

  // Admin-triggered "get into your planner account" mail for an accepted
  // applicant stuck on "Regisztrációra vár" (see admin_planners handleSendInvite).
  // Transactional, not outreach: the hasAccount branch goes to a real account
  // holder, so the outreach "you have no account" footer would be false.
  // hasAccount=false → register with the SAME email (auto-grants planner);
  // hasAccount=true → the admin already granted planner on their existing
  // account, so the CTA just carries them to sign in.
  planner_access_invite: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "A tervezői fiókod készen áll",
      "Your planner account is ready · Weddly",
    ),
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
      ? localeSubject(
          ctx.recipientLocale,
          "A szervező elfogadta a meghívásod",
          "Your planner accepted · Weddly",
        )
      : localeSubject(
          ctx.recipientLocale,
          "A szervező elutasította a meghívásod",
          "Your planner declined · Weddly",
        ),
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
  newsletter_confirm: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Erősítsd meg a feliratkozásod",
      "Confirm your subscription · Weddly",
    ),
    ctaUrl: p.confirmUrl,
    hu: {
      preheader: "Egy kattintás, és kész a feliratkozás.",
      greeting: "Szia!",
      paragraphs: [
        "Valaki, reméljük, te, feliratkozott erre a címre a Wēddly hírlevelére: esküvőtervezési tippek és termékújdonságok, nagyjából havi egy-két levél.",
        "Ha te voltál, erősítsd meg az alábbi gombbal. Ha nem, nincs teendőd: e nélkül a kattintás nélkül erre a címre nem küldünk több levelet.",
      ],
      cta: "Feliratkozás megerősítése",
      footnote: "A link 7 napig érvényes. Nagyjából havi egy-két levél, semmi több.",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        "Someone, hopefully you, signed this address up for the Weddly newsletter: wedding-planning tips and product news, roughly one or two emails a month.",
        "If that was you, confirm below. If not, do nothing: without this click we won't send anything else to this address.",
      ],
      cta: "Confirm subscription",
      footnote: "The link is valid for 7 days. Roughly one or two emails a month, nothing more.",
    },
  }),

  // Confirm-your-email for a verified visitor: someone who wants to suggest a
  // supplier or leave a review without opening a Weddly account. One click and
  // they can contribute; the copy says exactly that. Same 7-day link posture as
  // the couples welcome verify.
  visitor_verify: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Erősítsd meg az e-mail-címed",
      "Confirm your email · Weddly",
    ),
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: "Egy kattintás, és javasolhatsz szolgáltatót vagy írhatsz értékelést.",
      greeting: "Szia!",
      paragraphs: [
        "Valaki, reméljük, te, ezzel a címmel szeretne szolgáltatót ajánlani vagy értékelést írni a Weddly-n, fiók nélkül.",
        "Ha te voltál, erősítsd meg az alábbi gombbal, és már küldheted is. Ha nem, nincs teendőd: e nélkül a kattintás nélkül nem történik semmi.",
      ],
      cta: "E-mail-cím megerősítése",
      footnote: "A link 7 napig érvényes. Nem hozunk létre fiókot, és jelszó sem kell.",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        "Someone, hopefully you, wants to suggest a supplier or write a review on Weddly with this address, without an account.",
        "If that was you, confirm below and you're set to contribute. If not, do nothing: without this click nothing happens.",
      ],
      cta: "Confirm your email",
      footnote: "The link is valid for 7 days. No account is created and no password is needed.",
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
      subject: localeSubject(
        ctx.recipientLocale,
        "Válasz a visszajelzésedre",
        "Reply to your feedback · Weddly",
      ),
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

/** The guest's own words, quoted. Returns null when they wrote nothing, so the
 *  builder drops the line cleanly.
 *
 *  The text is guest-supplied and reaches the couple's inbox, so it matters
 *  that every paragraph chunk goes through `escapeHtml` in the renderer. The
 *  only thing that survives is `**bold**`, which a guest could technically use
 *  to emphasise their own sentence and nothing worse. */
function rsvpMessageLineHu(message?: string | null): string | null {
  const text = message?.trim();
  return text ? `Üzenetet is hagytak: „${text}"` : null;
}
function rsvpMessageLineEn(message?: string | null): string | null {
  const text = message?.trim();
  return text ? `They also left a message: "${text}"` : null;
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

function rsvpReceivedSubject(
  p: RsvpReceivedForCouplePayload,
  locale: RecipientLocale | undefined,
): string {
  if (p.rsvpStatus === "yes")
    return localeSubject(locale, `${p.guestName} jön`, `${p.guestName} is in`);
  if (p.rsvpStatus === "no")
    return localeSubject(locale, `${p.guestName} sajnos nem`, `${p.guestName} can't make it`);
  return localeSubject(locale, `${p.guestName} talán`, `${p.guestName} responded "maybe"`);
}

function rsvpHouseholdSubject(
  p: RsvpReceivedHouseholdForCouplePayload,
  locale: RecipientLocale | undefined,
): string {
  // Message-only: a household came back to write something without anyone's
  // answer moving. Handled first, because the tally below reads "all in" on an
  // empty list (0 of 0 said yes) and would announce a wedding nobody agreed to.
  if (p.guests.length === 0) {
    return localeSubject(locale, `${p.householdLabel}: üzenet`, `${p.householdLabel}: a message`);
  }
  // Try to give a tight, scannable preview without leaking the whole list
  // into the subject line. Up to 2 names, then "+N".
  const names = p.guests.map((g) => g.name);
  const headHu =
    names.length <= 2 ? names.join(" + ") : `${names.slice(0, 2).join(" + ")} +${names.length - 2}`;
  const yesCount = p.guests.filter((g) => g.rsvpStatus === "yes").length;
  const tallyHu =
    yesCount === p.guests.length
      ? "mind jön"
      : yesCount > 0
        ? `${yesCount}/${p.guests.length} jön`
        : "válasz";
  const tallyEn =
    yesCount === p.guests.length
      ? "all in"
      : yesCount > 0
        ? `${yesCount}/${p.guests.length} in`
        : "response";
  return localeSubject(locale, `${headHu}: ${tallyHu}`, `${headHu}: ${tallyEn}`);
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
