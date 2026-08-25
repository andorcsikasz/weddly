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
export interface GuestPhotosReadyPayload {
  /** "Mia & Lucas", used in the subject + body. */
  coupleDisplayName: string;
  /** The name this guest registered on the wedding-film camera page. */
  guestName: string;
  /** The guest camera's public gallery — the same link they shot into. */
  galleryUrl: string;
  /** Total photos in the film right now, not just this guest's own — the
   *  gallery is shared, everyone sees everyone's shots. */
  photoCount: number;
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

export interface GroupGiftNotificationPayload {
  /** New contributor confirmation vs update to an earlier contributor. */
  isNewPledger: boolean;
  itemTitle: string;
  /** External product page when the couple supplied one. */
  itemUrl: string | null;
  newContributorLabel: string;
  /** Preformatted, escaped by the shared renderer. */
  contributorLines: string[];
  totalText: string;
  ownAmountText: string | null;
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

export interface VendorDuplicateAdminAlertPayload {
  /** Registration/conversion flow that created the possible duplicate. */
  source: string;
  /** Display name and email entered for the new vendor account. */
  displayName: string;
  email: string;
  /** Null while a flow detects the match before inserting the account. */
  newVendorAccountId: number | null;
  matches: Array<{
    vendorAccountId: number;
    vendorCode: string | null;
    displayName: string;
    contactEmail: string | null;
    ownerEmail: string;
  }>;
  /** Vendor admin page where the accounts can be reviewed and merged. */
  adminUrl: string;
}

export interface PersonalInviteBadNameAdminAlertPayload {
  campaignSlug: string;
  /** Total rows rejected in this import for a non-letter/digit character. */
  count: number;
  /** First few offending rows, raw as imported, for a quick eyeball. */
  samples: Array<{ name: string; email: string }>;
  /** Personal-invite admin console, campaign pre-selected. */
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
  guest_photos_ready: GuestPhotosReadyPayload;
  group_gift_notification: GroupGiftNotificationPayload;
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
  vendor_duplicate_admin_alert: VendorDuplicateAdminAlertPayload;
  personal_invite_bad_name_admin_alert: PersonalInviteBadNameAdminAlertPayload;
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
   *  `RenderInput.whyLine`. Use it whenever the stock category line would
   *  misstate the relationship between Weddly and the recipient. */
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
    return "Az átvétellel **egy év Weddly Pro** a tiétek: közvetlen megkeresések, ajánlatok, elérhetőségi naptár és ügyfélkezelés egy helyen. Az év után a profilotok a megadott adatokkal díjmentesen fent marad; a Pro üzleti funkcióit akkor folytatjátok, ha továbbra is értéket adnak nektek.";
  }
  if (freeMonths > 0) {
    return `Az átvétellel **${freeMonths} hónap Weddly Pro** a tiétek: közvetlen megkeresések, ajánlatok, elérhetőségi naptár és ügyfélkezelés egy helyen. Utána a profilotok a megadott adatokkal díjmentesen fent marad; a Pro üzleti funkcióit akkor folytatjátok, ha továbbra is értéket adnak nektek.`;
  }
  return "";
}

/** The free-window closer in the locales that shipped after HU/EN. Keyed the
 *  same way as the card itself: a locale with no entry falls back to English,
 *  so a market can be pointed at a language before every sentence is written. */
const OFFER_SENTENCE: Partial<Record<ExtraLocale, (freeMonths: number) => string>> = {
  hr: (m) =>
    m >= 12
      ? "Preuzimanjem profila dobivate **godinu dana Weddly Pro**: izravne upite, ponude, kalendar dostupnosti i upravljanje klijentima na jednom mjestu. Nakon toga profil ostaje objavljen s vašim podacima bez naknade; Pro poslovne alate nastavljate koristiti ako vam i dalje donose vrijednost."
      : m > 0
        ? `Preuzimanjem profila dobivate **${m} mjeseca Weddly Pro**: izravne upite, ponude, kalendar dostupnosti i upravljanje klijentima na jednom mjestu. Nakon toga profil ostaje objavljen s vašim podacima bez naknade; Pro poslovne alate nastavljate koristiti ako vam i dalje donose vrijednost.`
        : "",
  de: (m) =>
    m >= 12
      ? "Mit der Profilübernahme erhalten Sie **ein Jahr Weddly Pro**: direkte Anfragen, Angebote, Verfügbarkeitskalender und Kundenverwaltung an einem Ort. Danach bleibt Ihr Profil mit Ihren Angaben ohne Kosten online; die Pro-Werkzeuge nutzen Sie weiter, wenn sie Ihnen weiterhin einen Mehrwert bieten."
      : m > 0
        ? `Mit der Profilübernahme erhalten Sie **${m} Monate Weddly Pro**: direkte Anfragen, Angebote, Verfügbarkeitskalender und Kundenverwaltung an einem Ort. Danach bleibt Ihr Profil mit Ihren Angaben ohne Kosten online; die Pro-Werkzeuge nutzen Sie weiter, wenn sie Ihnen weiterhin einen Mehrwert bieten.`
        : "",
  es: (m) =>
    m >= 12
      ? "Al reclamar el perfil tendréis **un año de Weddly Pro**: consultas directas, presupuestos, calendario de disponibilidad y gestión de clientes en un solo lugar. Después, el perfil seguirá publicado con vuestros datos sin coste; podéis continuar con las herramientas Pro si os siguen aportando valor."
      : m > 0
        ? `Al reclamar el perfil tendréis **${m} meses de Weddly Pro**: consultas directas, presupuestos, calendario de disponibilidad y gestión de clientes en un solo lugar. Después, el perfil seguirá publicado con vuestros datos sin coste; podéis continuar con las herramientas Pro si os siguen aportando valor.`
        : "",
};

function offerSentenceFor(locale: ExtraLocale, freeMonths: number): string {
  return OFFER_SENTENCE[locale]?.(freeMonths) ?? offerSentenceEn(freeMonths);
}

function offerSentenceEn(freeMonths: number): string {
  if (freeMonths >= 12) {
    return "Claim your profile and **Weddly Pro is yours for one year**: direct enquiries, quotes, availability and client management in one place. Afterwards, your profile stays live with your details at no cost; keep Pro only if its business tools continue to earn their place.";
  }
  if (freeMonths > 0) {
    return `Claim your profile and **Weddly Pro is yours for ${freeMonths} months**: direct enquiries, quotes, availability and client management in one place. Afterwards, your profile stays live with your details at no cost; keep Pro only if its business tools continue to earn their place.`;
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

/** The given name (keresztnév) out of a two-part imported contact name, for a
 *  greeting that reads like a person wrote it rather than a mail-merge. Name
 *  order is the whole trick: Hungarian puts the given name LAST ("Szigeti
 *  Kristóf" -> "Kristóf"), assumed Western order puts it FIRST ("John Smith"
 *  -> "John") - the only signal a non-Hungarian contact even exists is a
 *  non-HU email domain (detectLocale), so that same split doubles as the name-
 *  order guess. A single-word name (already just a given name) or a compound
 *  one ("Boglárka Mária") both pass through losing at most the second word -
 *  the alternative, greeting by the whole "Family Given" string, is the
 *  confusing-for-recipients behaviour this replaces. */
function givenNameFrom(name: string, locale: "hu" | "en"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return locale === "hu" ? (parts[parts.length - 1] ?? "") : (parts[0] ?? "");
}

/** `2027-05-29` → "2027. május 29." / "29 May 2027". Formatted in UTC on
 *  purpose: the value is a calendar date, not an instant, and letting the
 *  server's zone parse it shifts the day back for anyone west of UTC. */
function isoDateLabel(iso: string, locale: UiLocale): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  const intlLocale: Record<UiLocale, string> = {
    hu: "hu-HU",
    en: "en-GB",
    es: "es-ES",
    hr: "hr-HR",
    de: "de-DE",
  };
  return new Intl.DateTimeFormat(intlLocale[locale], {
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
function timestampLabel(ms: number, locale: UiLocale): string {
  if (!Number.isFinite(ms)) return "";
  const intlLocale: Record<UiLocale, string> = {
    hu: "hu-HU",
    en: "en-GB",
    es: "es-ES",
    hr: "hr-HR",
    de: "de-DE",
  };
  return new Intl.DateTimeFormat(intlLocale[locale], {
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
    subject: localeSubject(ctx.recipientLocale, "Üdv a Weddly-n", "Welcome to Weddly", {
      es: "Te damos la bienvenida a Weddly",
    }),
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: "Erősítsd meg az e-mail címed, hogy később vissza tudd állítani a fiókod.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Üdv a Weddly-n, örülünk, hogy itt vagytok.",
        "A Weddlyben kezelhetitek a vendéglistát, az ülésrendet, a költségvetést, az RSVP-ket és a nyomtatható anyagokat.",
        "Erősítsd meg az e-mail-címedet. Erre akkor lesz szükséged, ha később elfelejted a jelszavadat, vagy vissza kell állítanod a fiókodat.",
      ],
      cta: "E-mail cím megerősítése",
      ctaSubtext: "A link 7 napig érvényes.",
      footnote: "Az e-mail-cím megerősítése nélkül nem tudsz bejelentkezni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Welcome to Weddly. We're glad you're here.",
        "You can manage your guest list, seating plan, budget, RSVPs and printable stationery in Weddly.",
        "Please confirm your email address. You'll need it if you ever have to reset your password or recover your account.",
      ],
      cta: "Confirm your email",
      ctaSubtext: "The link is valid for 7 days.",
      footnote: "You'll need to confirm your address before you can sign in.",
    },
    extra: {
      hr: {
        preheader: "Potvrdite adresu e-pošte da kasnije možete vratiti svoj račun.",
        greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Dobro došli na Weddly, drago nam je što ste tu.",
          "Sve što treba za mirno planiranje vjenčanja na jednom je mjestu: popis gostiju, raspored sjedenja, proračun, potvrde dolaska i materijali za ispis.",
          "Potvrdite još adresu e-pošte kako biste mogli vratiti svoj račun ako zaboravite lozinku.",
        ],
        cta: "Potvrdite e-poštu",
        ctaSubtext: "Poveznica vrijedi 7 dana.",
        footnote: "Potvrda je potrebna za prijavu, pa je najbolje riješiti je odmah.",
      },
      es: {
        preheader: "Confirma tu correo para poder recuperar tu cuenta más adelante.",
        greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
        paragraphs: [
          "Te damos la bienvenida a Weddly. Nos alegra que estés aquí.",
          "Puedes organizar la lista de invitados, las mesas, el presupuesto, las confirmaciones y los materiales para imprimir desde Weddly.",
          "Confirma tu correo electrónico. Lo necesitarás si alguna vez tienes que restablecer la contraseña o recuperar la cuenta.",
        ],
        cta: "Confirmar correo",
        ctaSubtext: "El enlace es válido durante 7 días.",
        footnote: "Debes confirmar tu dirección antes de iniciar sesión.",
      },
      de: {
        preheader:
          "Bestätigen Sie Ihre E-Mail-Adresse, damit Sie Ihr Konto später wiederherstellen können.",
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Willkommen bei Weddly, schön, dass Sie da sind.",
          "Alles für eine entspannte Hochzeitsplanung an einem Ort: Gästeliste, Sitzplan, Budget, Zusagen und Druckvorlagen.",
          "Bestätigen Sie noch Ihre E-Mail-Adresse. Sie brauchen sie, falls Sie Ihr Passwort zurücksetzen oder Ihr Konto wiederherstellen müssen.",
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
        { es: "Tu cuenta de Weddly está activa" },
      ),
      ctaUrl: p.dashboardUrl,
      hu: {
        preheader: "Dátum, helyszín, vendéglista. Ebben a sorrendben a legkönnyebb.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          openerHu,
          "Először add meg az esküvő dátumát és helyszínét. Ezután elkezdhetitek feltölteni a vendéglistát, a költségvetést és az ülésrendet.",
          "Ha ketten tervezitek, hívd meg a párodat a munkamenetbe. Ugyanazt az adatot látja és szerkeszti, valós időben, e-mailezés nélkül.",
        ],
        cta: "Tervezés indítása",
        footnote: "Ha kérdésed van, válaszolj erre a levélre, és segítünk.",
      },
      en: {
        preheader: "Date, venue, guest list. Easiest in that order.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          openerEn,
          "Start by adding your wedding date and venue. Then you can begin filling in the guest list, budget and seating plan.",
          "Planning as two? Invite your partner into the workspace. They see and edit the same data in real time, no emailing files back and forth.",
        ],
        cta: "Start planning",
        footnote: "Questions? Reply to this email and our team will help.",
      },
      extra: {
        hr: {
          preheader: "Datum, lokacija, popis gostiju. Tim je redoslijedom najlakše.",
          greeting: `Pozdrav ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [
            provider
              ? `Vaš Weddly račun je aktivan, prijavili ste se ${provider} računom. Drago nam je što ste tu.`
              : "Potvrdili ste adresu e-pošte i vaš je Weddly račun aktivan. Drago nam je što ste tu.",
            "Počnite unosom datuma i lokacije vjenčanja. Zatim možete dodavati goste, proračun i raspored sjedenja.",
            "Planirate udvoje? Pozovite partnera u radni prostor. Vidi i uređuje iste podatke, u stvarnom vremenu, bez slanja datoteka e-poštom.",
          ],
          cta: "Počnite planirati",
          footnote: "Imate pitanje? Odgovorite na ovu poruku i naš će vam tim pomoći.",
        },
        es: {
          preheader: "Fecha, lugar y lista de invitados: ese es el orden más sencillo.",
          greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
          paragraphs: [
            provider
              ? `Tu cuenta de Weddly está activa y has iniciado sesión con ${provider}. Nos alegra que estés aquí.`
              : "Tu correo está confirmado y tu cuenta de Weddly ya está activa. Nos alegra que estés aquí.",
            "Empieza añadiendo la fecha y el lugar de la boda. Después puedes completar la lista de invitados, el presupuesto y la distribución de las mesas.",
            "¿Planificáis en pareja? Invita a tu pareja al espacio de trabajo para que ambos podáis editar la misma información en tiempo real.",
          ],
          cta: "Empezar a planificar",
          footnote: "¿Tienes alguna pregunta? Responde a este correo y nuestro equipo te ayudará.",
        },
        de: {
          preheader: "Datum, Location, Gästeliste. In dieser Reihenfolge geht es am leichtesten.",
          greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
          paragraphs: [
            provider
              ? `Ihr Weddly-Konto ist aktiv, angemeldet mit ${provider}. Schön, dass Sie da sind.`
              : "Ihre E-Mail-Adresse ist bestätigt und Ihr Weddly-Konto ist aktiv. Schön, dass Sie da sind.",
            "Tragen Sie zuerst das Hochzeitsdatum und den Veranstaltungsort ein. Danach können Sie Gästeliste, Budget und Sitzplan ausfüllen.",
            "Zu zweit am Planen? Laden Sie Ihren Partner in den Arbeitsbereich ein. Er sieht und bearbeitet dieselben Daten in Echtzeit, ohne Dateien hin und her zu mailen.",
          ],
          cta: "Mit der Planung starten",
          footnote: "Fragen? Antworten Sie auf diese E-Mail und unser Team hilft Ihnen weiter.",
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
        footnote: "Ha kérdésed van, válaszolj erre a levélre, és segítünk.",
      },
      en: {
        preheader: `You joined ${p.inviterName}'s workspace.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `You've joined ${p.inviterName}'s wedding planner.${coupleEn}`,
          "You can now edit the guest list, seating plan, budget, RSVP links and printable place cards together. Any changes are visible to both of you right away.",
          "The guest list is the best place to start. It's where most of the shared work happens, and both the seating chart and the RSVP links come off it.",
        ],
        cta: "Open the dashboard",
        footnote: "Questions? Reply to this email and our team will help.",
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
    subject: localeSubject(ctx.recipientLocale, "Jelszó visszaállítás", "Password reset", {
      es: "Restablecer la contraseña",
    }),
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
        "If you didn't request this, you can ignore the email. Your password hasn't changed.",
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
          "Falls Sie das nicht waren, können Sie diese E-Mail ignorieren. Ihr Passwort wurde nicht geändert.",
        ],
        cta: "Neues Passwort festlegen",
        ctaSubtext: "Einmal-Link, 1 Stunde gültig.",
      },
      es: {
        preheader:
          "Has solicitado una nueva contraseña para tu cuenta de Weddly. El enlace es válido durante 1 hora.",
        greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
        paragraphs: [
          "Has solicitado restablecer la contraseña de Weddly. Por seguridad, este enlace es **válido durante 1 hora**.",
          "Si no has sido tú, puedes ignorar este correo. Tu contraseña no ha cambiado.",
        ],
        cta: "Crear una contraseña nueva",
        ctaSubtext: "Enlace de un solo uso, válido durante 1 hora.",
      },
    },
  }),

  password_changed: (p, ctx) => ({
    subject: localeSubject(ctx.recipientLocale, "Jelszó megváltoztatva", "Password changed", {
      es: "Contraseña modificada",
    }),
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
        "**If this wasn't you**, use the link below to reset your password immediately. This will sign out whoever accessed your account.",
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
          "**Ako to niste bili vi**, odmah zatražite novu lozinku poveznicom ispod. Time ćete odjaviti osobu koja je pristupila računu.",
        ],
        cta: "Zatražite novu lozinku",
        footnote: "Ako ste to bili vi, slobodno zanemarite ovu poruku.",
      },
      es: {
        preheader: "Tu contraseña se ha cambiado correctamente.",
        greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
        paragraphs: [
          `La contraseña de tu cuenta de Weddly acaba de cambiar **(${p.changedAt})**.`,
          "Hemos cerrado todas las sesiones abiertas. Tendrás que volver a iniciar sesión con la contraseña nueva.",
          "**Si no has sido tú**, usa el enlace de abajo para restablecer la contraseña de inmediato. Así se cerrará cualquier sesión que no reconozcas.",
        ],
        cta: "Restablecer la contraseña",
        footnote: "Si has sido tú, puedes ignorar este correo.",
      },
      de: {
        preheader: "Wir bestätigen, dass Ihr Passwort erfolgreich geändert wurde.",
        greeting: `Hallo ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `Das Passwort Ihres Weddly-Kontos wurde gerade geändert **(${p.changedAt})**.`,
          "Wir haben alle bestehenden Sitzungen abgemeldet, Sie müssen sich also überall mit dem neuen Passwort neu anmelden.",
          "**Falls Sie das nicht waren**, fordern Sie über den Link unten sofort ein neues Passwort an. Damit werden alle unbekannten Sitzungen abgemeldet.",
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
        "If it was you, perhaps on a new phone, computer, browser or network, you don't need to do anything.",
        "**If it wasn't you**, someone else may have accessed your account. Use the link below to reset your password and sign out every active session.",
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
        "For your security, we'll sign you out everywhere when you confirm. You'll need to log back in on each device.",
      ],
      cta: "Confirm new email",
      footnote:
        "If you didn't request this, ignore the email. Your current address will remain unchanged.",
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
        "Your account will stay linked to this address until the new one is confirmed. We're letting you know in case you didn't request the change.",
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
          "Közösen szerkeszthetitek a vendéglistát, az ülésrendet, a költségvetést és az RSVP-ket. A változásokat mindketten azonnal látjátok.",
          "A nyilvános béta alatt a Weddly mindenki számára elérhető. Az adataitok a tiétek maradnak, és nem vagytok egyetlen szolgáltatóhoz sem kötve.",
        ],
        cta: "Csatlakozom a tervezéshez",
        ctaSubtext: "A link 7 napig érvényes.",
        footnote: "Ha véletlenül kaptad, hagyd figyelmen kívül, semmi sem fog történni.",
      },
      en: {
        greeting: "Hello,",
        paragraphs: [
          `${p.inviterName} started planning your wedding on Weddly and invited you to join.${coupleSuffixEn}`,
          "You can edit the guest list, seating chart, budget and RSVPs together. Any changes are visible to both of you right away.",
          "Weddly is open to everyone during the public beta. Your data remains yours, and you are not tied to any particular vendor.",
        ],
        cta: "Join the workspace",
        ctaSubtext: "Link valid for 7 days.",
        footnote:
          "If this invitation was not meant for you, you can ignore it. No account will be created.",
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
          "Mostantól közösen szerkesztitek a vendéglistát, az ülésrendet, a költségvetést és az RSVP-ket. Bármelyikőtök módosít valamit, a másik azonnal látja.",
        ],
        cta: "Vezérlőpult megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Good news, ${p.partnerName} accepted your invite and joined the wedding planner.${coupleEn}`,
          "You can now edit the guest list, seating plan, budget and RSVPs together. Any changes are visible to both of you right away.",
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
        `A ${p.invitedEmail} címre küldött meghívót visszautasították, így a címzett nem csatlakozik az esküvőtervezőhöz.`,
        "Ha rossz címre küldted, vagy mást szeretnél meghívni, a Profil oldalon küldhetsz új meghívót. Partner nélkül is tovább tervezhetsz; minden funkció elérhető marad.",
      ],
      cta: "Új meghívó küldése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `The invitation sent to ${p.invitedEmail} was declined, so the recipient will not be joining your workspace.`,
        "If you used the wrong address or want to invite someone else, you can send a new invitation from your Profile page. You can also continue planning on your own; every feature remains available.",
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
          "Minden adat megmarad. Ha mással szeretnél közösen tervezni, a Profil oldalon küldhetsz új meghívót. Egyedül is tovább tervezhetsz; minden funkció elérhető marad.",
        ],
        cta: "Új partner meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.partnerName} left${coupleEn}wedding planner. They can no longer edit the workspace or view its guest list, seating plan or budget.`,
          "Your data has not changed. If you would like to plan with someone else, you can send a new invitation from your Profile page. You can also continue planning on your own.",
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
          "Egy meghívás után közösen szerkeszthetitek a vendéglistát, az ülésrendet, a költségvetést és az RSVP-ket. Minden változást azonnal láttok.",
        ],
        cta: "Pár meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${coupleEn} planner is easier to manage when you can both update it.`,
          "Invite your partner to share the guest list, seating plan, budget and RSVPs. Any changes are visible to both of you right away.",
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
          preheader: "Hívjátok meg a párotokat, és aktiválódik az alapító hozzáférésetek.",
          paragraphs: [
            "Az alapító párok az esküvőjük napjáig teljes Weddly-hozzáférést kapnak, amikor mindketten csatlakoznak a közös munkaterülethez.",
            `Hívjátok meg a párotokat a munkaterületre${coupleHu}. Amint csatlakozik, az alapító hozzáférésetek automatikusan aktiválódik.`,
            "Ezután mindketten ugyanazt a vendéglistát, ülésrendet és költségvetést szerkeszthetitek.",
          ],
          cta: "Párom meghívása",
        },
        en: {
          paragraphs: [
            "Founding couples receive full Weddly access until their wedding day when both partners join the shared workspace.",
            `Invite your partner to the workspace${coupleEn}. Your founding access activates automatically when they join.`,
            "You can then manage the guest list, seating plan and budget together.",
          ],
          cta: "Invite my partner",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Tervezzetek együtt az alapító hozzáféréssel",
          "Plan together with founding access",
        ),
        hu: {
          preheader: "Egy meghívás, és közösen folytathatjátok a tervezést.",
          paragraphs: [
            "Az alapító hozzáférésetek a párotok csatlakozásával aktiválódik, és az esküvőtök napjáig teljes Weddly-hozzáférést ad.",
            "A közös munkaterületen mindig ugyanazt a vendéglistát, ülésrendet és költségvetést látjátok.",
          ],
          cta: "Meghívom a páromat",
        },
        en: {
          paragraphs: [
            "Your founding access activates when your partner joins, giving you full Weddly access until your wedding day.",
            "The shared workspace keeps the guest list, seating plan and budget in one version for both of you.",
          ],
          cta: "Invite my partner",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Az alapító hozzáférésetek készen áll",
          "Your founding access is ready",
        ),
        hu: {
          preheader: "A párotok csatlakozásával automatikusan aktiválódik.",
          paragraphs: [
            "Hívjátok meg a párotokat a közös munkaterületre, és az alapító hozzáférésetek automatikusan aktiválódik.",
            "Ettől kezdve az esküvőtök napjáig együtt használhatjátok a Weddly teljes tervezőjét.",
          ],
          cta: "Meghívó küldése",
        },
        en: {
          paragraphs: [
            "Invite your partner to the shared workspace and your founding access activates automatically.",
            "You can then use the full Weddly planner together until your wedding day.",
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
        footnote: "A meghívó linket közvetlenül is elküldheted a párodnak.",
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
  // not ask them to come back. A known recipient locale gets a single-language
  // subject; an unknown locale follows the bilingual body fallback.
  pause_feedback_request: (p, ctx) => {
    const coupleHu = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    const coupleEn = p.coupleDisplayName ? ` (${p.coupleDisplayName})` : "";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Mivel tehetnénk jobbá a Weddlyt?",
        "How could we improve Weddly?",
      ),
      ctaUrl: p.feedbackUrl,
      hu: {
        preheader: "Egy mondat is sokat segít.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `A tervezőtök szüneteltetésekor${coupleHu} azt jelezted, hogy további funkciók segítették volna a munkátokat. Szeretnénk pontosabban érteni, mire lett volna szükségetek.`,
          "Írd meg egy mondatban, melyik eszköz vagy folyamat tette volna könnyebbé a tervezést. A válaszaitok alapján döntjük el, min dolgozzunk következőként.",
          "A gomb egy rövid űrlapot nyit meg. Erre a levélre is válaszolhatsz.",
        ],
        cta: "Megosztom a javaslatom",
        footnote: "Egy mondat is sokat segít.",
      },
      en: {
        preheader: "One sentence is plenty.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `When you paused your workspace${coupleEn}, you indicated that additional features would have helped. We would like to understand what would have made planning easier.`,
          "Tell us which tool or workflow would have helped most. Your answer guides what we improve next.",
          "The button opens a short form. You can also reply directly to this message.",
        ],
        cta: "Share a suggestion",
        footnote: "One sentence is plenty.",
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
        "You can both edit the guest list, seating plan and budget again.",
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
        "Your names appear on your guest page, invitations and supplier messages. Using your real names also helps us prevent automated or fraudulent accounts.",
        `Please correct them in your profile **by ${p.deadlineDateEn}**. After that, the workspace will be paused until the names are updated. Your saved data will not be deleted.`,
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

  guest_photos_ready: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `A ${p.coupleDisplayName} esküvői fotók megtekinthetők`,
      `${p.coupleDisplayName}'s wedding photos are ready to view`,
    ),
    ctaUrl: p.galleryUrl,
    hu: {
      preheader: `${p.photoCount} fotó vár rád ${p.coupleDisplayName} esküvői filmjében.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `${p.coupleDisplayName} megnyitotta a vendégek fotóit — a tiéd is köztük van, ${p.photoCount} kép várja, hogy megnézd.`,
        "Ugyanazon a linken éred el, amin fotóztál.",
      ],
      cta: "Fotók megnézése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.coupleDisplayName} just opened up the wedding film — your shot is in there, along with ${p.photoCount} others.`,
        "Same link you used to take it.",
      ],
      cta: "View the photos",
    },
  }),

  group_gift_notification: (p, ctx) => {
    const contributors = p.contributorLines.map((line) => `- ${line}`).join("\n");
    return {
      whyLine: {
        hu: "Ezt azért kaptad, mert e-mailes értesítést kértél ehhez a közös ajándékhoz.",
        en: "You're receiving this because you requested email updates about this group gift.",
      },
      subject: localeSubject(
        ctx.recipientLocale,
        p.isNewPledger
          ? `Csatlakoztál a közös ajándékhoz: ${p.itemTitle}`
          : `Bővült a közös ajándék csapata: ${p.itemTitle}`,
        p.isNewPledger
          ? `You joined the group gift: ${p.itemTitle}`
          : `A new guest joined the group gift: ${p.itemTitle}`,
      ),
      ctaUrl: p.itemUrl ?? CONFIG.frontendBaseUrl,
      noUtm: p.itemUrl != null,
      hu: {
        preheader: p.isNewPledger
          ? `Rögzítettük a hozzájárulási szándékodat: ${p.itemTitle}.`
          : `${p.newContributorLabel} is csatlakozott a közös ajándékhoz.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: p.isNewPledger
          ? [
              `Rögzítettük a hozzájárulási szándékodat a(z) **${p.itemTitle}** közös ajándékhoz.`,
              p.ownAmountText ? `A vállalt összeged: **${p.ownAmountText}**.` : "",
              contributors ? `A közös ajándék résztvevői:\n${contributors}` : "",
              `Eddig összesen: **${p.totalText}**.`,
              "Ez egy rugalmas szándéknyilatkozat; a részleteket közösen egyeztethetitek.",
            ].filter((line) => line.length > 0)
          : [
              `**${p.newContributorLabel}** is csatlakozott a(z) **${p.itemTitle}** közös ajándékhoz.`,
              contributors ? `A közös ajándék résztvevői:\n${contributors}` : "",
              `Eddig összesen: **${p.totalText}**.`,
              "Egyeztessétek a következő lépést a résztvevőkkel.",
            ].filter((line) => line.length > 0),
        cta: p.itemUrl ? "Ajándék megtekintése" : "Weddly megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: p.isNewPledger
          ? [
              `We've recorded your intention to contribute to the group gift **${p.itemTitle}**.`,
              p.ownAmountText ? `Your pledged amount: **${p.ownAmountText}**.` : "",
              contributors ? `Group gift contributors:\n${contributors}` : "",
              `Total so far: **${p.totalText}**.`,
              "This is a flexible expression of interest; you can coordinate the details together.",
            ].filter((line) => line.length > 0)
          : [
              `**${p.newContributorLabel}** has joined the group gift **${p.itemTitle}**.`,
              contributors ? `Group gift contributors:\n${contributors}` : "",
              `Total so far: **${p.totalText}**.`,
              "Coordinate the next step with the other contributors.",
            ].filter((line) => line.length > 0),
        cta: p.itemUrl ? "View the gift" : "Open Weddly",
      },
    };
  },

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
        footnote: "If this invitation was not meant for you, you can ignore it.",
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
        "Így folytathatjátok a Weddlyben",
        "Choose how to continue with Weddly",
      ),
      ctaUrl: p.inviteUrl,
      hu: {
        preheader: "Válasszatok közös tervezést vagy egyéni előfizetést.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `A tervezőtök${coupleHu} minden adatotokkal együtt a helyén van, és a következő ${p.graceDays} napban ugyanúgy szerkeszthető, mint eddig.`,
          "Két lehetőség közül választhattok. **Ha a párod is belép a munkaterületre, az esküvőtök napjáig a vendégeink vagytok**, teljes hozzáféréssel. Így a vendéglistát, az ülésrendet és a költségvetést ugyanabban a közös verzióban kezelhetitek.",
          `A másik út, ha egyedül tervezel tovább: **${p.graceEndsLabel}-ig** add meg a fizetési adatokat, és a munkaterület megszakítás nélkül marad szerkeszthető.`,
          "Ha kérdésed van a csomagokról vagy a számlázásról, válaszolj erre a levélre, és segítünk.",
        ],
        cta: "Meghívom a páromat",
        secondaryLinks: [{ label: "Fizetési adatok megadása", url: p.billingUrl }],
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Your planner${coupleEn} and all of its data are ready for you, with full editing for another ${p.graceDays} days.`,
          "You have two options. **Invite your partner and be our guests until your wedding day**, or continue on your own with a paid plan.",
          `If you choose a paid plan, add your payment details by **${p.graceEndsLabel}** to keep the workspace active without interruption.`,
          "If you have questions about plans or billing, reply to this email and our team will help.",
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
        "Add meg a neveket, a dátumot és a vendégszámot, és indulhat a közös tervezőtök.",
        "A beállítás körülbelül két perc. Minden adatot később is módosíthattok.",
      ],
      cta: "Befejezem a tervező beállítását",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Add a few details to set up your planner: your names, wedding date and estimated guest count.",
        "It takes about two minutes. You can change any of the details later.",
      ],
      cta: "Finish my planner",
    },
  }),

  onboarding_nudge_week: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Két perc alatt beállíthatod a tervezőtöket",
      "Two minutes to bring your planner to life",
    ),
    ctaUrl: p.onboardingUrl,
    hu: {
      preheader: "Egy hét telt el. Kezdjük el az esküvőtök tervezését?",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "A Weddly-tervezőtök készen áll az indulásra.",
        "Add meg a neveket, az esküvő dátumát és a várható vendégszámot a költségvetés, a vendéglista és az ülésrend beállításához.",
        "Kezdd akár a vendéglistával, a többi ráér. Bármit átírhatsz később.",
      ],
      cta: "Elkezdem a tervezést",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Your Weddly planner is ready to get started.",
        "Add your names, wedding date and estimated guest count to set up the budget, guest list and seating plan.",
        "You can start with the guest list and complete the rest whenever you're ready. Everything can be changed later.",
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
    // The couple name goes in the preheader, not the opening line: the mail is
    // addressed to one person ("Szia Fanni!"), so "Fanni & Balázs, 3 hete nem
    // jártál" mixes the two of them with a verb meant for one.
    const couplePrefix = p.coupleDisplayName ? `${p.coupleDisplayName}: ` : "";
    const closingHu =
      p.daysUntilWedding !== undefined
        ? `Az esküvőtökig ${p.daysUntilWedding} nap van. A vezérlőpulton egyben látjátok a következő döntéseket és teendőket.`
        : "A tervezést bármelyik résszel elkezdhetitek, és minden adatot később is módosíthattok.";
    const closingEn =
      p.daysUntilWedding !== undefined
        ? `Your wedding is ${p.daysUntilWedding} days away. The dashboard brings your next decisions and tasks together.`
        : "You can start with any part of the planner and update every detail later.";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Nézzétek meg, mivel bővült a Weddly",
        "See what is new in Weddly",
      ),
      ctaUrl: p.appUrl,
      hu: {
        preheader: `${couplePrefix}minden ott van, ahol hagytad. Plusz pár új dolog.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "A vendéglistátok, a költségvetésetek és az ülésrendetek készen áll a folytatásra.",
          "Ezekkel bővült azóta a Weddly:\n- **Szolgáltatók**: több mint 120 új helyszín galériával, térképpel és dátum szerinti elérhetőségi szűrővel.\n- **Üzenetek**: a szolgáltatókkal folytatott beszélgetéseket a Weddlyben is kezelhetitek.\n- **Arculat**: egységes stílus a vendégoldalhoz, valamint nyomtatható ültetőkártyák, menük és táblák.",
          closingHu,
          "Nyissátok meg a tervezőt, és folytassátok a következő lépéssel.",
        ],
        cta: "Megnézem, mi újság",
        ctaSubtext: "Egyenesen a tervezőtökbe visz.",
        footnote: "A gomb közvetlenül a tervezőtökbe visz.",
      },
      en: {
        preheader: `${couplePrefix}everything is where you left it. Plus a few new things.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          "Your guest list, budget and seating plan are ready when you are.",
          "Here is what we have added since then:\n- **Vendors**: more than 120 new venues with galleries, maps and availability filters.\n- **Messages**: contact vendors and keep their replies in Weddly.\n- **Designs**: matching styles for your guest page, place cards, menus and signs.",
          closingEn,
          "Open your planner and continue with the next step.",
        ],
        cta: "See what's new",
        ctaSubtext: "Takes you straight into your planner.",
        footnote: "The button takes you straight to your planner.",
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
    const couplePrefix = p.coupleDisplayName ? `${p.coupleDisplayName}: ` : "";
    const closingHu =
      p.daysUntilWedding !== undefined
        ? `Az esküvőtökig ${p.daysUntilWedding} nap van. Pont most érdemes ránézni, amíg a döntések még kényelmesek.`
        : "A fejlesztéseket kitűzött dátum nélkül is használhatjátok.";
    const closingEn =
      p.daysUntilWedding !== undefined
        ? `Your wedding is ${p.daysUntilWedding} days away. This is a good time to review the plan and make any outstanding decisions.`
        : "You can explore every new feature before setting a date.";
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Új eszközök a Weddly tervezőtökben",
        "New tools in your Weddly planner",
      ),
      ctaUrl: p.appUrl,
      hu: {
        preheader: `${couplePrefix}120+ új helyszín, üzenetek a szolgáltatókkal, arculat és nyomtatás.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "A vendéglistátok, a költségvetésetek és az ültetésetek mellett több új eszköz is elérhető a tervezőtökben.",
          "Ezekkel bővült a Weddly a legutóbbi belépésed óta:\n- **Több mint 120 új helyszín és szolgáltató**, galériával, térképpel és dátum szerinti elérhetőségi szűrővel.\n- **Üzenetek**: a szolgáltatókkal folytatott beszélgetéseket a Weddlyben is kezelhetitek.\n- **Arculat és nyomtatás**: egységes stílus a vendégoldalhoz, igazítható borítófotó, helyszíntérkép, valamint nyomtatható ültetőkártyák, menük és táblák.\n- **Költségvetés**: fizetési határidők, részletenként csatolható PDF-számlák és figyelmeztetés a keret túllépésekor.",
          closingHu,
          "Nyissátok meg a tervezőt, és nézzétek meg az új lehetőségeket.",
        ],
        cta: "Megnézem, mi változott",
        ctaSubtext: "Egyenesen a tervezőtökbe visz.",
        footnote: "A gomb közvetlenül a tervezőtökbe visz.",
      },
      en: {
        preheader: `${couplePrefix}120+ new venues, vendor messaging, style kit and print.`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          "Your guest list, budget and seating plan now sit alongside several new planning tools.",
          "Here is what has changed since your last visit:\n- **More than 120 new venues and vendors**, with galleries, maps and availability filters.\n- **Messages**: contact vendors and keep their replies in Weddly.\n- **Design and print**: matching styles for your guest page, cover photo, venue map, place cards, menus and signs.\n- **Budget**: payment due dates, PDF invoices for individual instalments and alerts when a category exceeds its budget.",
          closingEn,
          "Open your planner to explore the new tools.",
        ],
        cta: "See what changed",
        ctaSubtext: "Takes you straight into your planner.",
        footnote: "The button takes you straight to your planner.",
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
        "Osszátok meg a tapasztalataitokat a szolgáltatókról",
        "Rate your wedding vendors",
      ),
      ctaUrl: p.ctaUrl,
      hu: {
        preheader: "Értékelésetek más pároknak is segít a választásban.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          "Egy hete házasodtatok össze. Gratulálunk még egyszer!",
          list
            ? `Segítenétek más pároknak a választásban? Itt értékelhetitek azokat a szolgáltatókat, akikkel dolgoztatok: **${list}**.`
            : "Segítenétek más pároknak a választásban? Itt értékelhetitek azokat a szolgáltatókat, akikkel dolgoztatok.",
          "Válasszatok csillagértékelést, és ha szeretnétek, írjatok mellé pár szót is.",
        ],
        cta: "Értékelem a szolgáltatókat",
        ctaSubtext: "Az összes szolgáltatót egy oldalon értékelhetitek.",
        footnote: "Ezt egyszer küldjük, az esküvőtök után.",
      },
      en: {
        preheader: "Your review can help other couples choose with confidence.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          "You got married a week ago. Congratulations again!",
          list
            ? `Would you help other couples choose their vendors? You can rate the businesses you worked with: **${list}**.`
            : "Would you help other couples choose their vendors? You can rate the businesses you worked with.",
          "Choose a star rating for each vendor, and add a comment if you would like to share more.",
        ],
        cta: "Rate your vendors",
        ctaSubtext: "You can rate all of your vendors on one page.",
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
        preheader: "Gratulálunk az esküvőtökhöz, és köszönjük, hogy velünk terveztetek.",
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `${coupleHu}szívből gratulálunk az esküvőtökhöz. Reméljük, olyan lett, amilyennek elképzeltétek.`,
          "Ezzel lezárjuk az esküvőtökhöz kapcsolódó e-mailjeinket. A munkaterületetek megmarad, így később is visszanézhetitek a vendéglistát, az ültetést és a képeket.",
          "Ha van pár percetek, osszátok meg velünk a tapasztalataitokat. A szolgáltatóitokat is értékelhetitek, ezzel más párok választását segítitek.",
        ],
        cta: "Elmondom, mit gondolok",
        ctaSubtext: "Minden visszajelzést elolvasunk.",
        ...(p.reviewUrl
          ? {
              secondaryLinks: [{ label: "Értékelem a szolgáltatóinkat", url: p.reviewUrl }],
            }
          : {}),
        footnote: "Sok boldogságot kívánunk nektek. Köszönjük, hogy minket választottatok!",
      },
      en: {
        preheader: "Congratulations, and thank you for planning with Weddly.",
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.coupleDisplayName ? `**${p.coupleDisplayName}**, your` : "Your"} wedding day has passed. Congratulations to you both! We hope it was everything you hoped for.`,
          "This closes the email journey for your wedding. Your workspace remains available whenever you want to revisit the guest list, seating chart or photos.",
          "If you have five minutes, we would appreciate your feedback. You can also rate your vendors to help other couples choose.",
        ],
        cta: "Tell us how we did",
        ctaSubtext: "Tell us what worked and what we could improve.",
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
        "Tervezzétek meg a nászutat is",
        "The best part comes after the wedding",
      ),
      ctaUrl: p.honeymoonUrl,
      hu: {
        preheader: `${coupleHu}${p.daysUntil} nap az esküvőig. A nászutat is megtervezhetitek egy helyen.`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          `**${p.daysUntil} nap múlva** összeházasodtok. A nászutat ugyanabban a tervezőben készíthetitek elő.`,
          "Adjátok meg az úti célt és a dátumokat: a Weddly megmutatja a visszaszámlálót és az aktuális retúr repülőjegyárakat a választott indulási reptérről.",
          "A kiválasztott ajánlat bekerül a nászút költségvetésébe, a foglalási link pedig automatikusan teendővé válik. Az útlevélhez, biztosításhoz és csomagoláshoz kész feladatlistát is kaptok.",
        ],
        cta: "Nászút tervezése",
        footnote: "Ezt az emlékeztetőt egyszer küldjük.",
      },
      en: {
        preheader: `${coupleEn}${p.daysUntil} days to the wedding. Settled on the honeymoon yet?`,
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `**In ${p.daysUntil} days** you'll be married. You can prepare the honeymoon in the same planner.`,
          "If you have not chosen a destination yet, add a place and your travel dates to see a countdown, destination photo and current return fares from your departure airport.",
          'Save a fare to add it to your honeymoon budget and create a "Buy the flight ticket" task with the booking link. You can also add ready-made tasks for passports, insurance and packing.',
        ],
        cta: "Plan the honeymoon",
        footnote: "We send this reminder once.",
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
        "**Pontosan 3 hónap van az esküvőtökig.**",
        "Most jó alkalom véglegesíteni a vendéglistát, kiküldeni az RSVP-linkeket és összehangolni a költségvetési kereteket. Minden eszközt megtaláltok a vezérlőpulton.",
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
        "Ezen a héten véglegesíthetitek az ülésrendet és a menüt, majd egy kattintással emlékeztetőt küldhettek a válaszra váró vendégeknek.",
      ],
      cta: "Vezérlőpult megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "**One month left**, the home stretch.",
        "This week's priorities: finalize seating and the menu, then send a reminder to guests whose replies are on the way.",
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
      preheader: `${p.coupleDisplayName}, elérkezett az esküvő hete. Nyomtatás, ülésrend, részletek.`,
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
        ? `${p.overdueCount} teendő esedékes${p.dueSoonCount > 0 ? `, és ${p.dueSoonCount} következik hamarosan` : ""}.`
        : `${p.dueSoonCount} teendő hamarosan esedékes.`;
    const headlineEn =
      p.overdueCount > 0
        ? `${p.overdueCount} to-do${p.overdueCount > 1 ? "s are" : " is"} ready for review${p.dueSoonCount > 0 ? `, and ${p.dueSoonCount} ${p.dueSoonCount > 1 ? "are" : "is"} coming up` : ""}.`
        : `${p.dueSoonCount} to-do${p.dueSoonCount > 1 ? "s are" : " is"} coming up.`;
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "A következő teendők várnak rátok",
        "Your next timeline items are ready",
      ),
      ctaUrl: p.timelineUrl,
      hu: {
        preheader: `${p.coupleDisplayName}, ${headlineHu}`,
        greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
        paragraphs: [
          headlineHu,
          listHu ? `A következő tételek: ${listHu}.` : "Nézzétek át az ütemterveteket.",
          "Az idővonalon megjelölhetitek, ami elkészült, és új időpontot adhattok a következő feladatoknak.",
        ],
        cta: "Idővonal megnyitása",
        footnote: "Az ütemterv-emlékeztetőket a Profilban szabhatjátok személyre.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          headlineEn,
          listEn ? `Next on the timeline: ${listEn}.` : "Take a look at your timeline.",
          "Open the timeline to mark completed tasks and reschedule anything that remains.",
        ],
        cta: "Open timeline",
        footnote: "You can personalise timeline reminders in Profile.",
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
      preheader: "Add meg az ételválasztásodat a végleges visszajelzéshez.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Köszönjük, hogy visszajeleztél ${p.coupleDisplayName} esküvőjére. Az ételválasztásodat még hozzáadhatod a válaszodhoz.`,
        "A frissítés egy kattintás, és segít a párnak pontosítani a catering létszámát.",
      ],
      cta: "Ételválasztás megadása",
      footnote: "Ezt az emlékeztetőt egyszer küldjük.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Thanks for replying to ${p.coupleDisplayName}'s wedding invitation. You can now add your meal choice to complete the response.`,
        "It takes one click and helps the couple confirm accurate numbers with their caterer.",
      ],
      cta: "Pick your meal",
      footnote: "We only send this reminder once.",
    },
  }),

  rsvp_deadline_approaching: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `${p.pendingCount} válasz hiányzik a végleges vendégszámhoz`,
      `${p.pendingCount} replies left for your final guest count`,
    ),
    ctaUrl: p.guestsUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, 2 hét az esküvőig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Két hét múlva van az esküvőtök **(${p.weddingDate})**, és **${p.pendingCount} válasz** érkezik még a végleges vendégszámhoz.`,
        "A vendéglistán egy kattintással emlékeztetőt küldhettek nekik. Így kényelmesen véglegesíthetitek a létszámot a helyszínnel és a cateringgel.",
      ],
      cta: "Vendéglista megnyitása",
      footnote: "Ezt az emlékeztetőt csak egyszer küldjük, T-14 napon.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Your wedding is two weeks away **(${p.weddingDate})**, with **${p.pendingCount} replies** left to confirm the final guest count.`,
        "Send everyone a reminder from the guest list in one click, giving your venue and caterer plenty of time to confirm the numbers.",
      ],
      cta: "Open guest list",
      footnote: "We only send this nudge once, at T-14 days.",
    },
  }),

  vendor_waitlist_received: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Megérkezett a szolgáltatói jelentkezésetek",
      "We received your vendor application",
    ),
    ctaUrl: p.landingUrl,
    hu: {
      preheader: "A csapatunk átnézi, és e-mailben jelentkezik a következő lépéssel.",
      greeting: `Szia ${ctx.recipientName || p.businessName || ""}!`.trim(),
      paragraphs: [
        `Köszönjük a(z) ${p.businessName} jelentkezését a Weddly szolgáltatói programjába (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "Kategóriánként állítjuk össze a pároknak ajánlott szolgáltatói kört. A csapatunk átnézi a jelentkezéseteket, és e-mailben jelzi a következő lépést.",
        "Portfóliót, referenciát vagy további információt erre a levélre válaszolva küldhettek.",
      ],
      cta: "Weddly megnyitása",
      footnote: "A jelentkezésetek frissítéseiről e-mailben szólunk.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || p.businessName || "there"},`,
      paragraphs: [
        `We've received ${p.businessName}'s submission to the Weddly vendor waitlist (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "We build the recommended vendor selection one category at a time. Our team will review your application and email you with the next step.",
        "Reply to this message to add a portfolio, references or further details.",
      ],
      cta: "Open Weddly",
      footnote: "We will email you with updates about your application.",
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
          "Ha nem te kérted ezt a fiókot, hagyd figyelmen kívül ezt a levelet. A profil aktiválás nélkül nem jelenik meg.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: enParas,
        cta: "Activate account",
        ctaSubtext: "The link is valid for 30 days and works once.",
        footnote:
          "If you didn't request this account, you can ignore this email. The profile will not go live unless it is activated.",
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
    const esMissing: string[] = [];
    const deMissing: string[] = [];
    if (p.missing.photos) {
      huMissing.push("fotók");
      enMissing.push("photos");
      hrMissing.push("fotografije");
      esMissing.push("fotos");
      deMissing.push("Fotos");
    }
    if (p.missing.bio) {
      huMissing.push("bemutatkozó szöveg");
      enMissing.push("a short bio");
      hrMissing.push("kratko predstavljanje");
      esMissing.push("una breve presentación");
      deMissing.push("eine kurze Vorstellung");
    }
    if (p.missing.packages) {
      huMissing.push("árcsomagok");
      enMissing.push("pricing packages");
      hrMissing.push("cjenovni paketi");
      esMissing.push("paquetes y precios");
      deMissing.push("Preispakete");
    }

    const huParas = [
      "A profilotok él a Weddly-n, és megosztható a párokkal. A nyilvános oldal belépés nélkül megnyílik.",
      "Tegyétek ki a közösségi felületeitekre, vagy küldjétek el közvetlenül az érdeklődőknek.",
    ];
    if (huMissing.length > 0) {
      huParas.push(
        `Adjátok hozzá a következő részleteket: **${joinNaturalList(huMissing, "és")}**. Így a párok egy helyen látják a teljes ajánlatotokat.`,
      );
    }
    huParas.push(
      "Kérjétek meg korábbi ügyfeleiteket, hogy értékeljenek a profilotokon. A tapasztalataik hasznos támpontot adnak az új pároknak.",
    );

    const enParas = [
      "Your profile is live on Weddly and ready to share. The link below opens your public page for couples, no login needed.",
      "Share it on your social channels, by email or directly with interested couples.",
    ];
    if (enMissing.length > 0) {
      enParas.push(
        `Add the following details: **${joinNaturalList(enMissing, "and")}**. This gives couples a complete view of your offer in one place.`,
      );
    }
    enParas.push(
      "Ask past clients to leave a review on your profile. Their feedback gives new couples useful context when they are deciding whom to contact.",
    );

    return {
      subject: localeSubject(
        ctx.recipientLocale,
        "Éles a Weddly-profilotok",
        "Your Weddly profile is live",
        { es: "Tu perfil de Weddly ya está publicado" },
      ),
      ctaUrl: p.shareUrl,
      // The CTA link IS the shareable public URL, so keep it clean: no email
      // UTM riding along into the vendor's own socials, and render it as a
      // copy-paste line so they can grab it directly.
      plainCtaUrl: true,
      noUtm: true,
      hu: {
        preheader: "Kész a nyilvános profilotok, itt a megosztható link.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: huParas,
        cta: "Profil megnyitása",
        ctaSubtext: "A nyilvános link belépés nélkül megnyílik.",
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
        ctaSubtext:
          "This is your public link. It opens without a login and can be shared with anyone.",
        secondaryLinks: [
          { label: "Edit profile", url: p.editUrl },
          { label: "Reviews", url: p.reviewsUrl },
        ],
        footnote: "We only email when there's something useful for your Weddly profile.",
      },
      extra: {
        es: {
          preheader:
            "Tu perfil público de Weddly ya está listo. Aquí tienes el enlace para compartirlo.",
          greeting: name ? `Hola ${name}:` : "Hola:",
          paragraphs: [
            "Tu perfil ya está publicado en Weddly. El enlace de abajo abre la página pública sin necesidad de iniciar sesión.",
            "Compártelo en redes sociales, por correo o con las parejas que se pongan en contacto contigo.",
            ...(esMissing.length > 0
              ? [
                  `Añade estos datos: **${joinNaturalList(esMissing, "y")}**. Así las parejas verán toda tu oferta en un solo lugar.`,
                ]
              : []),
            "Pide a clientes anteriores que dejen una reseña. Su experiencia puede ayudar a otras parejas a elegir.",
          ],
          cta: "Abrir mi perfil",
          ctaSubtext: "Este es tu enlace público. Se abre sin iniciar sesión.",
          secondaryLinks: [
            { label: "Editar perfil", url: p.editUrl },
            { label: "Reseñas", url: p.reviewsUrl },
          ],
          footnote: "Solo te escribiremos cuando haya algo útil para tu perfil de Weddly.",
        },
        hr: {
          preheader: "Vaš je javni profil na Weddlyju spreman, evo poveznice za dijeljenje.",
          greeting: name ? `Pozdrav ${name}!` : "Pozdrav!",
          paragraphs: [
            "Vaš je profil objavljen na Weddlyju i spreman za dijeljenje. Poveznica ispod otvara vašu javnu stranicu za parove, bez prijave.",
            "Podijelite je na društvenim mrežama, e-poštom ili izravno s parovima koji vam se jave.",
            ...(hrMissing.length > 0
              ? [
                  `Dodajte ove podatke: **${joinNaturalList(hrMissing, "i")}**. Tako parovi na jednom mjestu vide cijelu vašu ponudu.`,
                ]
              : []),
            "Parovi na Weddlyju uspoređuju ponuđače, pa im potpun profil pomaže razumjeti što nudite.",
            "Zamolite prijašnje klijente da ostave recenziju na vašem profilu. Njihova iskustva pomažu novim parovima pri odabiru.",
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
            "Teilen Sie ihn in Ihren sozialen Kanälen, per E-Mail oder direkt mit interessierten Paaren.",
            ...(deMissing.length > 0
              ? [
                  `Ergänzen Sie diese Angaben: **${joinNaturalList(deMissing, "und")}**. So sehen Paare Ihr vollständiges Angebot an einem Ort.`,
                ]
              : []),
            "Paare vergleichen Dienstleister im Weddly-Verzeichnis. Ein vollständiges Profil hilft ihnen, Ihr Angebot besser zu verstehen.",
            "Bitten Sie frühere Kunden um eine Bewertung auf Ihrem Profil. Deren Erfahrungen helfen neuen Paaren bei der Auswahl.",
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
   *  reads as evasion. State the source we can prove for every listing:
   *  publicly available business information.
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
          es: `${name}: hemos eliminado tu anuncio`,
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
          es: "Recibes este correo porque tenías un anuncio en Weddly, una app para organizar bodas, y lo hemos eliminado a petición tuya. No tienes una cuenta con nosotros y este es el último correo que enviaremos a esta dirección.",
          hr: "Ovo primate jer ste imali oglas na Weddlyju, aplikaciji za planiranje vjenčanja, a mi smo ga uklonili na vaš zahtjev. Kod nas nemate račun i ovo je posljednja poruka na ovu adresu.",
          de: "Sie erhalten dies, weil Sie einen Eintrag bei Weddly hatten, einer App für die Hochzeitsplanung, und wir ihn auf Ihren Wunsch entfernt haben. Sie haben kein Konto bei uns, und dies ist die letzte E-Mail an diese Adresse.",
        },
      },
      hu: {
        preheader: "Kérésedre töröltük az adatlapot a Weddly-ről.",
        greeting: `Kedves ${name}!`,
        paragraphs: [
          "Az adatlapot a kérésedre töröltük a Weddly-ről. Nem jelenik meg többé a keresésben, és több levelet sem küldünk erre a címre.",
          "Az adatlapot nyilvánosan elérhető üzleti adatokból állítottuk össze; nem ti regisztráltátok.",
          "Ha egyszer mégis szeretnétek elérhetők lenni a pároknak, saját adatlapot bármikor létrehozhattok. Az már a tiétek: ti írjátok, ti szerkesztitek, és ti döntitek el, mi látszik belőle.",
        ],
        cta: "Regisztráció",
        footnote: "Ha bármi kérdésed van, válaszolj erre a levélre, és segítünk.",
      },
      en: {
        preheader: "Your listing has been removed from Weddly, as you asked.",
        greeting: `Dear ${name},`,
        paragraphs: [
          "Your listing has been removed from Weddly at your request. It no longer appears in search, and we will not email this address again.",
          "We created the listing from publicly available business information; it was not registered by your team.",
          "If you ever do want to be reachable by couples planning a wedding, you can create your own listing whenever you like. That one is yours: you write it, you edit it, and you decide what it shows.",
        ],
        cta: "Register",
        footnote: "If you have any questions, reply to this email and our team will help.",
      },
      extra: {
        es: {
          preheader: "Hemos eliminado el anuncio de Weddly tal como solicitaste.",
          greeting: `Hola, equipo de ${name}:`,
          paragraphs: [
            "Hemos eliminado el anuncio de Weddly. Ya no aparece en las búsquedas y no volveremos a escribir a esta dirección.",
            "Creamos el anuncio a partir de información empresarial pública; vuestro equipo no lo registró.",
            "Si en el futuro queréis aparecer en el directorio, podéis crear vuestro propio anuncio. Vosotros decidiréis qué información publicar y podréis editarla cuando queráis.",
          ],
          cta: "Registrarse",
          footnote:
            "Si tienes alguna pregunta, responde a este correo y nuestro equipo te ayudará.",
        },
        hr: {
          preheader: "Na vaš zahtjev uklonili smo oglas s Weddlyja.",
          greeting: `Poštovani ${name},`,
          paragraphs: [
            "Na vaš smo zahtjev uklonili vaš oglas s Weddlyja. Više se ne prikazuje u pretrazi i na ovu adresu više nećemo slati e-poštu.",
            "Oglas smo izradili prema javno dostupnim poslovnim podacima; vaš ga tim nije registrirao.",
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
            "Wir haben den Eintrag anhand öffentlich verfügbarer Unternehmensdaten erstellt; Ihr Team hat ihn nicht registriert.",
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
          "Legyen teljes a Weddly-profilotok",
          "Complete your Weddly profile",
        ),
        hu: {
          preheader: "Adjátok hozzá a részleteket, amelyek segítik a párok döntését.",
          intro:
            "A profilotok már él a Weddly-n. Egészítsétek ki, hogy a párok minden fontos információt egy helyen találjanak rólatok.",
          missingLead: "Ezekkel lesz teljes:",
          close: "Pár perc alatt megmutathatjátok mindazt, amit érdemes tudni rólatok.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "Add the details that help couples make their decision.",
          intro:
            "Your profile is live on Weddly. Complete it so couples can find every useful detail about your business in one place.",
          missingLead: "Add these details:",
          close: "A few minutes will give couples a clear view of what you offer.",
          cta: "Complete my profile",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Mutassátok meg, mit kínáltok",
          "Show couples what you offer",
        ),
        hu: {
          preheader: "A teljes profilból a párok gyorsan átlátják, mit kínáltok.",
          intro:
            "A párok a Weddly katalógusában hasonlítják össze a szolgáltatókat. A teljes profilból pontosabban látják, mit kínáltok.",
          missingLead: "Ezeket érdemes hozzáadnotok:",
          close: "Egészítsétek ki, hogy minden fontos részletet tőletek ismerjenek meg.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "A complete profile helps couples quickly understand your offer.",
          intro:
            "Couples are comparing vendors on Weddly. A complete profile helps them understand what you offer.",
          missingLead: "Useful details to add:",
          close: "Complete these sections so every important detail comes directly from you.",
          cta: "Complete my profile",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Az első benyomás a profilotokkal kezdődik",
          "Your profile shapes the first impression",
        ),
        hu: {
          preheader: "Rendezett információk, könnyebb döntés a pároknak.",
          intro:
            "A rendezett profil segít a pároknak gyorsan megérteni, hogyan dolgoztok és mit kínáltok.",
          missingLead: "Ezeket adjátok hozzá:",
          close: "Egészítsétek ki pár perc alatt, és máris teljesebb képet mutattok magatokról.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "Clear information makes it easier for couples to decide.",
          intro:
            "A clear profile helps couples quickly understand how you work and what you offer.",
          missingLead: "Add these details:",
          close: "A few minutes will give couples a fuller picture of your business.",
          cta: "Complete my profile",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "Minden fontos részlet egy profilban",
          "Every useful detail in one profile",
        ),
        hu: {
          preheader: "Segítsetek a pároknak gyorsan átlátni az ajánlatotokat.",
          intro:
            "A részletes profil megadja a pároknak azokat az információkat, amelyekre az összehasonlításhoz szükségük van.",
          missingLead: "Ezekkel érdemes kiegészíteni:",
          close: "Adjátok hozzá őket, hogy az ajánlatotok könnyen áttekinthető legyen.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "Help couples understand your offer at a glance.",
          intro:
            "A detailed profile gives couples the information they use when comparing vendors.",
          missingLead: "Useful details to add:",
          close: "Add them to make your offer easy to understand.",
          cta: "Complete my profile",
        },
      },
      {
        subject: localeSubject(
          ctx.recipientLocale,
          "A profilotok készen áll a kiegészítésre",
          "Your profile is ready to complete",
        ),
        hu: {
          preheader: "Pár részlet, és a párok minden fontos információt megtalálnak.",
          intro:
            "A Weddly-profilotok készen áll arra, hogy a saját részleteitekkel teljessé tegyétek.",
          missingLead: "Ezeket adjátok hozzá:",
          close: "Pár perc az egész, és a profilotok minden fontos információt tartalmaz.",
          cta: "Profil kiegészítése",
        },
        en: {
          preheader: "A few details will give couples everything they need.",
          intro: "Your Weddly profile is ready for the details that make it distinctly yours.",
          missingLead: "Add these details:",
          close: "A few minutes will put every useful detail in one place.",
          cta: "Complete my profile",
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
        "Tedd láthatóvá a szervezői profilod",
        "Make your planner profile visible",
      ),
      ctaUrl: p.editUrl,
      hu: {
        preheader: "Pár adat, és a párok is megtalálhatnak a szervezői ajánlóban.",
        greeting: name ? `Szia ${name}!` : "Szia!",
        paragraphs: [
          "A szervezői profilod közel áll a megjelenéshez a Weddly-n.",
          `Add hozzá: **${huList}**. A vállalkozásod nevével és a városoddal a párok szervezői ajánlójába is bekerülhetsz.`,
          "Néhány perc az egész; a gomb egyből a profilszerkesztőhöz visz.",
        ],
        cta: "Profil kiegészítése",
        ctaSubtext: "Nyisd meg a profilszerkesztőt, és add hozzá a részleteket.",
        footnote: "Csak akkor írunk, ha van valami, amivel előrébb léphetsz a Weddly-n.",
      },
      en: {
        greeting: name ? `Hi ${name},` : "Hi there,",
        paragraphs: [
          "Your planner profile is close to appearing on Weddly.",
          `Add: **${enList}**. Your business name and city make the profile eligible for the planner directory.`,
          "It takes a few minutes; the button opens the profile editor directly.",
        ],
        cta: "Complete my profile",
        ctaSubtext: "Open the profile editor and add your details.",
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
        `A fiókhoz **két év teljes hozzáférés** jár, ${p.freeUntilHu}-ig. Az aktiváláshoz állíts be egy jelszót a lenti gombbal.`,
        `Az élesítéssel elfogadod az Általános Szerződési Feltételeket (${CONFIG.frontendBaseUrl}/terms) és az Adatkezelési tájékoztatót (${CONFIG.frontendBaseUrl}/privacy). Mindkettőt a gomb után is megtalálod, mielőtt véglegesítenél.`,
      ],
      cta: "Fiók élesítése",
      ctaSubtext: "A link 30 napig érvényes és egyszer használható.",
      footnote: "A profil az aktiválás után válik láthatóvá.",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `Good news: we've set up the planner profile for **${p.businessName}**${p.category ? ` (${p.category})` : ""} on Weddly in your name.`,
        `You have **two years of full access**, until ${p.freeUntilEn}. Use the button below to activate the account and set a password.`,
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
        `A teljes szervezői hozzáférésetek ${p.freeUntilHu}-ig a vendégünk.`,
        `A fiók megnyitásával elfogadod az Általános Szerződési Feltételeket (${CONFIG.frontendBaseUrl}/terms) és az Adatkezelési tájékoztatót (${CONFIG.frontendBaseUrl}/privacy). Mindkettőt a gomb után is megtalálod, mielőtt véglegesítenél.`,
      ],
      cta: "Fiók megnyitása",
      ctaSubtext: "A link 30 napig érvényes és egyszer használható.",
      footnote: "A fiók a megnyitás után válik aktívvá.",
    },
    en: {
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `Thanks for applying to the Weddly planner programme. We have reviewed and **approved** the profile for **${p.businessName}**.`,
        "One step left: open your account with the button below and set a password. We have **pre-filled your onboarding with the details from your application**, so you just need to review them.",
        `Your complimentary access is valid until ${p.freeUntilEn}.`,
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
        ? "Elkészült a Weddly szervezői fiókotok"
        : "You were recommended: your Weddly account is ready",
    ctaUrl: p.activateUrl,
    plainCtaUrl: true,
    noUtm: true,
    // The stock outreach footer says "you have no account with us", which this
    // mail's own first sentence contradicts. Say the true version instead.
    whyLine: {
      hu: "Ezt a Weddly esküvőtervezőtől kaptad, mert egy felhasználónk ajánlott téged. A profil az aktiválás után válik elérhetővé.",
      en: "You're getting this from Weddly because one of our users recommended you. The profile becomes available after activation.",
    },
    hu: {
      preheader: "Egy felhasználónk ajánlott benneteket. A szervezői fiókotok készen áll.",
      greeting: `Szia ${p.plannerName}!`,
      paragraphs: [
        `Egy Weddly-felhasználó ajánlotta ${huArticle(p.businessName)} **${p.businessName}** vállalkozást, ezért elkészítettük a szervezői fiókotokat.`,
        "A Weddly közös munkateret ad a pároknak és a szervezőknek: vendéglista, ülésrend, költségvetés, RSVP, idővonal és feladatok. Az ügyfeleitek esküvőit egy vezérlőpultról követhetitek.",
        // No sentence-final period after the date: a Hungarian formatted date
        // already ends in one ("2028. július 28."), and adding ours makes it two.
        `Ha aktiválod a fiókot, minden funkciót használhatsz ${p.guestUntil}-ig.`,
        // Keep the data-source and rights notice concrete: this is a cold
        // introduction based on public business contact details.
        `A nevedet, az e-mail-címedet és a telefonszámodat nyilvánosan közzétett üzleti elérhetőségekből gyűjtöttük, és kizárólag ehhez a megkereséshez használjuk. Harmadik félnek nem adjuk tovább. Az adatkezelés jogalapja a GDPR 6. cikk (1) f) pontja szerinti jogos érdek. Bármikor kérheted az adataid másolatát, javítását, korlátozását vagy törlését, és tiltakozhatsz az adatkezelés ellen. Ehhez írj a ${CONFIG.supportEmail} címre. Részletek: ${CONFIG.frontendBaseUrl}/privacy`,
      ],
      cta: "Fiók átvétele",
      ctaSubtext: "Állítsatok be egy jelszót; a link 30 napig érvényes.",
      footnote: "A meghívót továbbíthatod annak a kollégádnak, aki a szervezést intézi.",
      secondaryLinks: [
        { label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Adatkezelési tájékoztató", url: `${CONFIG.frontendBaseUrl}/privacy` },
      ],
    },
    en: {
      preheader: "A Weddly user put your name forward. The account is ready to take over.",
      greeting: `Hi ${p.plannerName},`,
      paragraphs: [
        `A Weddly user recommended you as a wedding planner, so we prepared a planner account for **${p.businessName}**. It remains inactive unless you choose to activate it.`,
        "Weddly gives planners and couples a shared workspace for the guest list, seating plan, budget, RSVPs, timeline and tasks. You can manage each client from one dashboard.",
        `If you activate the account, you will have complimentary access to every feature until ${p.guestUntil}.`,
        `We found your name, email address and phone number in publicly available business contact information and used them only for this message. We do not share them with third parties. Our legal basis is legitimate interest under Article 6(1)(f) GDPR. You may request a copy, correction, restriction or deletion of your data, or object to its use, at any time. Email ${CONFIG.supportEmail} to make a request. Details: ${CONFIG.frontendBaseUrl}/privacy`,
      ],
      cta: "Take over your account",
      ctaSubtext: "The link is valid for 30 days and can be used once.",
      footnote: "If someone else manages the planning, you may forward this email to them.",
      secondaryLinks: [
        { label: "What is Weddly?", url: CONFIG.frontendBaseUrl },
        { label: "Privacy policy", url: `${CONFIG.frontendBaseUrl}/privacy` },
      ],
    },
  }),

  wedding_today_followup: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      "Osszátok meg a Weddly-tapasztalataitokat",
      `Share your Weddly experience, ${p.coupleDisplayName}`,
    ),
    ctaUrl: p.feedbackUrl,
    hu: {
      preheader: `Köszönjük, hogy a Weddly-vel terveztetek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Reméljük, örömteli hétvégét töltöttetek a hozzátok közel állókkal.",
        "Ha van pár percetek, írjátok meg, melyik része segített a legtöbbet, és mivel tehetnénk még gördülékenyebbé a tervezést. A visszajelzéseitek alapján fejlesztjük a következő funkciókat.",
      ],
      cta: "Visszajelzés küldése",
      footnote: "Pár perc az egész, válaszolhatsz erre az e-mailre is.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We hope ${p.coupleDisplayName} had a wonderful weekend with the people who matter most.`,
        "If you have a few minutes, tell us which parts of Weddly helped most and what would make planning even smoother. Your feedback shapes what we build next.",
      ],
      cta: "Share feedback",
      footnote: "Quick to do, you can also just reply to this email.",
    },
  }),

  wedding_today: (p, ctx) => ({
    subject: localeSubject(ctx.recipientLocale, "Ma összeházasodtok", "Your wedding day is here"),
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.coupleDisplayName}, gratulálunk!`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Ma van a nap, ${p.coupleDisplayName}.`,
        "Köszönjük, hogy velünk terveztetek. Élvezzétek minden percét; a tervezőtök adatait később is bármikor visszanézhetitek.",
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
      preheader: `Elkészült a(z) ${p.supplierName} Weddly-adatlapja.`,
      greeting: "Szia!",
      paragraphs: [
        p.suggestedByUser
          ? `Egy pár, aki a Weddlyn tervezi az esküvőjét, hozzáadta ${huArticle(p.supplierName)} ${p.supplierName} adatlapját a szolgáltatói katalógushoz.`
          : `A(z) ${p.supplierName} bekerült a Weddly szolgáltató-katalógusába.`,
        "Vedd át az adatlapot az alábbi linken, hogy ellenőrizhesd az információkat és láthatóvá tehesd a párok számára.",
        "Az adatlap az átvétel és az adatok jóváhagyása után válik nyilvánossá.",
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
        "Claim the listing to review its details and make it visible to couples.",
        "The listing becomes public after you claim and approve its information.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // Claim-invite campaign. Cold, so the copy has to earn the click in the first
  // two lines: WHY this arrived and WHAT already exists (their category +
  // town, proof we mean their actual business). The positive next step follows
  // immediately. The free window is the closer, not the hook; an offer-first
  // cold mail reads as an ad.
  //
  // The opening is built on the page state and the source we can prove for
  // every recipient: publicly available business information. A user referral
  // belongs only in a flow whose payload carries that fact (`suggestedByUser`).
  // Trust is part of conversion; this campaign must never imply a personal
  // recommendation merely to make a curated import sound warmer.
  //
  // The rest of the mail is the part that stays true whoever is reading: the
  // page is live and ready for first-party photos, prices and availability.
  // The public URL ships as its own secondary link so the recipient can verify
  // the page state before deciding whether to claim it.
  //
  // Rendered single-language: `locale` comes off the payload because the
  // subject is one string per kind, and a Hungarian subject on a mail to a
  // venue in Puglia is the fastest way into a spam folder.
  vendor_claim_campaign: (p) => ({
    subject: localeSubject(
      p.locale,
      `${p.listingName}: egészítsétek ki a Weddly-profilotokat`,
      `${p.listingName}: complete your Weddly profile`,
      {
        es: `${p.listingName}: completad vuestro perfil de Weddly`,
        hr: `${p.listingName}: dopunite svoj Weddly profil`,
        de: `${p.listingName}: Vervollständigen Sie Ihr Weddly-Profil`,
      },
    ),
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: "Saját fotók, árak és szabad időpontok: minden fontos részlet egy helyen.",
      greeting: "Szia!",
      paragraphs: [
        `A(z) **${p.listingName}** profilja már elérhető a Weddly szolgáltatói katalógusában (${p.categoryLabel}, ${p.city}). Nyilvánosan elérhető üzleti adatokkal készítettük elő, ti pedig bármikor átvehetitek és a sajátotokra formálhatjátok.`,
        "Egészítsétek ki saját fotókkal, csomagokkal, árakkal és szabad időpontokkal, hogy a párok minden fontos információt egy helyen lássanak.",
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      ctaSubtext: "Kb. két perc: egy név és egy jelszó.",
      footnote: `A linket továbbíthatjátok annak, aki a profilotokat vagy a naptárat kezeli. Adatkezelési kérdésben a ${CONFIG.supportEmail} címen segítünk.`,
      secondaryLinks: [
        { label: "Nézd meg úgy, ahogy a párok látják", url: p.listingUrl },
        { label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl },
      ],
    },
    en: {
      preheader: "Your photos, pricing and availability: everything couples need in one place.",
      greeting: "Hi there,",
      paragraphs: [
        `The profile for **${p.listingName}** is now available in the Weddly supplier directory (${p.categoryLabel}, ${p.city}). We prepared it from publicly available business information, and you can claim it and make it your own.`,
        "Add your photos, packages, pricing and availability so couples can find every useful detail in one place.",
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      ctaSubtext: "About two minutes: your name and a password.",
      footnote: `You may forward the link to whoever manages your profile or diary. For data questions, contact ${CONFIG.supportEmail}.`,
      secondaryLinks: [
        { label: "See the page couples see", url: p.listingUrl },
        { label: "What is Weddly?", url: CONFIG.frontendBaseUrl },
      ],
    },
    extra: {
      es: {
        preheader: "Vuestras fotos, precios y disponibilidad: todo lo que necesitan las parejas.",
        greeting: "Hola:",
        paragraphs: [
          `El perfil de **${p.listingName}** ya está disponible en el directorio de proveedores de Weddly (${p.categoryLabel}, ${p.city}). Lo hemos preparado con información empresarial pública y podéis reclamarlo para hacerlo vuestro.`,
          "Añadid vuestras fotos, paquetes, precios y disponibilidad para que las parejas encuentren toda la información importante en un solo lugar.",
          offerSentenceFor("es", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Reclamar el perfil",
        ctaSubtext: "Unos dos minutos: vuestro nombre y una contraseña.",
        footnote: `Podéis reenviar el enlace a quien gestione el perfil o el calendario. Para consultas sobre datos: ${CONFIG.supportEmail}.`,
        secondaryLinks: [
          { label: "Ver la página como la ven las parejas", url: p.listingUrl },
          { label: "¿Qué es Weddly?", url: CONFIG.frontendBaseUrl },
        ],
      },
      hr: {
        preheader: "Vaše fotografije, cijene i dostupnost: sve važne informacije na jednom mjestu.",
        greeting: "Pozdrav!",
        paragraphs: [
          `Profil tvrtke **${p.listingName}** već je dostupan u Weddly katalogu pružatelja usluga (${p.categoryLabel}, ${p.city}). Pripremili smo ga prema javno dostupnim poslovnim podacima, a vi ga možete preuzeti i urediti po svojoj mjeri.`,
          "Dodajte svoje fotografije, pakete, cijene i slobodne termine kako bi parovi sve važne informacije pronašli na jednom mjestu.",
          offerSentenceFor("hr", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Preuzmite profil",
        ctaSubtext: "Otprilike dvije minute: ime i lozinka.",
        footnote: `Poveznicu možete proslijediti osobi koja vodi profil ili kalendar. Za pitanja o podacima: ${CONFIG.supportEmail}.`,
        secondaryLinks: [
          { label: "Pogledajte stranicu kakvu vide parovi", url: p.listingUrl },
          { label: "Što je Weddly?", url: CONFIG.frontendBaseUrl },
        ],
      },
      de: {
        preheader: "Ihre Fotos, Preise und Verfügbarkeit: alle wichtigen Angaben an einem Ort.",
        greeting: "Hallo!",
        paragraphs: [
          `Das Profil von **${p.listingName}** ist bereits im Weddly-Dienstleisterverzeichnis verfügbar (${p.categoryLabel}, ${p.city}). Wir haben es anhand öffentlich verfügbarer Unternehmensdaten vorbereitet; Sie können es übernehmen und individuell gestalten.`,
          "Ergänzen Sie Ihre Fotos, Pakete, Preise und freien Termine, damit Paare alle wichtigen Angaben an einem Ort finden.",
          offerSentenceFor("de", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Profil übernehmen",
        ctaSubtext: "Etwa zwei Minuten: Ihr Name und ein Passwort.",
        footnote: `Sie können den Link an die Person weiterleiten, die Ihr Profil oder Ihren Kalender verwaltet. Bei Fragen zu Daten: ${CONFIG.supportEmail}.`,
        secondaryLinks: [
          { label: "Die Seite ansehen, die Paare sehen", url: p.listingUrl },
          { label: "Was ist Weddly?", url: CONFIG.frontendBaseUrl },
        ],
      },
    },
  }),
  // The single 2-day nudge. Shorter on purpose: it restates the positive action
  // and the durable value of the profile, rather than applying pressure through
  // an unfinished or unclaimed state.
  vendor_claim_campaign_reminder: (p) => ({
    subject: localeSubject(
      p.locale,
      `${p.listingName}: tegyétek teljessé a Weddly-profilotokat`,
      `${p.listingName}: make your Weddly profile complete`,
      {
        es: `${p.listingName}: completad vuestro perfil de Weddly`,
        hr: `${p.listingName}: dopunite svoj Weddly profil`,
        de: `${p.listingName}: Vervollständigen Sie Ihr Weddly-Profil`,
      },
    ),
    ctaUrl: p.inviteUrl,
    hu: {
      preheader: "Saját fotók, árak és szabad időpontok: minden fontos részlet egy helyen.",
      greeting: "Szia!",
      paragraphs: [
        `A(z) **${p.listingName}** Weddly-profilja készen áll az átvételre. Egészítsétek ki saját fotókkal, árakkal és szabad időpontokkal, hogy a párok a tőletek származó információk alapján dönthessenek.`,
        offerSentenceHu(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Profil átvétele",
      ctaSubtext: "Kb. két perc: egy név és egy jelszó.",
      footnote: `A linket továbbíthatjátok annak, aki a profilotokat vagy a naptárat kezeli. Adatkezelési kérdésben a ${CONFIG.supportEmail} címen segítünk.`,
      secondaryLinks: [{ label: "Nézd meg úgy, ahogy a párok látják", url: p.listingUrl }],
    },
    en: {
      preheader: "Your photos, pricing and availability: everything couples need in one place.",
      greeting: "Hi there,",
      paragraphs: [
        `The Weddly profile for **${p.listingName}** is ready to claim. Add your photos, pricing and availability so couples can make decisions using information that comes directly from you.`,
        offerSentenceEn(p.freeMonths),
      ].filter((s) => s.length > 0),
      cta: "Take over your profile",
      ctaSubtext: "About two minutes: your name and a password.",
      footnote: `You may forward the link to whoever manages your profile or diary. For data questions, contact ${CONFIG.supportEmail}.`,
      secondaryLinks: [{ label: "See the page couples see", url: p.listingUrl }],
    },
    extra: {
      es: {
        preheader: "Vuestras fotos, precios y disponibilidad: todo lo que necesitan las parejas.",
        greeting: "Hola:",
        paragraphs: [
          `El perfil de Weddly de **${p.listingName}** está listo para reclamar. Añadid vuestras fotos, precios y disponibilidad para que las parejas decidan con información que viene directamente de vosotros.`,
          offerSentenceFor("es", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Reclamar el perfil",
        ctaSubtext: "Unos dos minutos: vuestro nombre y una contraseña.",
        footnote: `Podéis reenviar el enlace a quien gestione el perfil o el calendario. Para consultas sobre datos: ${CONFIG.supportEmail}.`,
        secondaryLinks: [{ label: "Ver la página como la ven las parejas", url: p.listingUrl }],
      },
      hr: {
        preheader: "Vaše fotografije, cijene i dostupnost: sve važne informacije na jednom mjestu.",
        greeting: "Pozdrav!",
        paragraphs: [
          `Weddly profil tvrtke **${p.listingName}** spreman je za preuzimanje. Dodajte svoje fotografije, cijene i dostupnost kako bi parovi odlučivali prema informacijama koje dolaze izravno od vas.`,
          offerSentenceFor("hr", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Preuzmite profil",
        ctaSubtext: "Otprilike dvije minute: ime i lozinka.",
        footnote: `Poveznicu možete proslijediti osobi koja vodi profil ili kalendar. Za pitanja o podacima: ${CONFIG.supportEmail}.`,
        secondaryLinks: [{ label: "Pogledajte stranicu kakvu vide parovi", url: p.listingUrl }],
      },
      de: {
        preheader: "Ihre Fotos, Preise und Verfügbarkeit: alle wichtigen Angaben an einem Ort.",
        greeting: "Hallo!",
        paragraphs: [
          `Das Weddly-Profil von **${p.listingName}** ist bereit zur Übernahme. Ergänzen Sie Ihre Fotos, Preise und freien Termine, damit Paare anhand Ihrer eigenen Angaben entscheiden können.`,
          offerSentenceFor("de", p.freeMonths),
        ].filter((x) => x.length > 0),
        cta: "Profil übernehmen",
        ctaSubtext: "Etwa zwei Minuten: Ihr Name und ein Passwort.",
        footnote: `Sie können den Link an die Person weiterleiten, die Ihr Profil oder Ihren Kalender verwaltet. Bei Fragen zu Daten: ${CONFIG.supportEmail}.`,
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
    whyLine: {
      hu: "Ezt azért kaptátok, mert van Weddly szolgáltatói fiókotok.",
      en: "You're getting this because you have a Weddly supplier account.",
    },
    subject:
      p.locale === "hu"
        ? "Elkészült a saját Weddly értékelő linketek"
        : "Your Weddly review link is ready",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "Kérjetek értékelést korábbi ügyfeleitektől a saját linketekkel.",
      greeting: p.businessName.trim() ? `Szia ${p.businessName.trim()}!` : "Szia!",
      paragraphs: [
        "A korábbi ügyfeleitek mostantól Weddly-fiók nélkül is írhatnak véleményt. Ehhez csak az e-mail-címükre van szükség.",
        "A vélemények segítenek a pároknak megismerni, milyen veletek dolgozni, mielőtt felveszik veletek a kapcsolatot.",
        `Ezt a linket küldjétek el azoknak a korábbi ügyfeleknek, akiktől véleményt szeretnétek kérni: **${p.reviewUrl}**`,
      ],
      cta: "Értékelések gyűjtése",
      ctaSubtext: "Nyissátok meg a nyilvános értékelő oldalatokat.",
      secondaryLinks: [
        { label: "Megosztás WhatsApp-on", url: p.whatsappUrl },
        { label: "Küldés e-mailben", url: p.mailtoUrl },
      ],
      footnote: "A linket bármikor elküldhetitek korábbi ügyfeleiteknek.",
    },
    en: {
      preheader: "Invite past clients to review your work with your own link.",
      greeting: p.businessName.trim() ? `Hi ${p.businessName.trim()},` : "Hi there,",
      paragraphs: [
        "Past clients can now review your business on Weddly without creating an account. They only need an email address.",
        "Reviews help couples understand what it is like to work with you before they get in touch.",
        `Send this review link to any past clients you would like to ask: **${p.reviewUrl}**`,
      ],
      cta: "Collect reviews",
      ctaSubtext: "Open your public review page.",
      secondaryLinks: [
        { label: "Share on WhatsApp", url: p.whatsappUrl },
        { label: "Send by email", url: p.mailtoUrl },
      ],
      footnote: "You can use this link at any time, including for older clients.",
    },
  }),
  // The single 7-day nudge, only to vendors who neither clicked nor opened the
  // first mail. Shorter: they have the context, this is a reminder of the ask.
  vendor_review_campaign_reminder: (p) => ({
    whyLine: {
      hu: "Ezt azért kaptátok, mert van Weddly szolgáltatói fiókotok.",
      en: "You're getting this because you have a Weddly supplier account.",
    },
    subject:
      p.locale === "hu"
        ? "Kérjetek értékelést korábbi ügyfeleitektől"
        : "Invite past clients to review your work",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "A saját értékelő linketek készen áll a megosztásra.",
      greeting: p.businessName.trim() ? `Szia ${p.businessName.trim()}!` : "Szia!",
      paragraphs: [
        "A korábbi ügyfeleitek Weddly-fiók létrehozása nélkül is értékelhetik a munkátokat.",
        `Osszátok meg velük a saját értékelő linketeket: **${p.reviewUrl}**. A visszajelzések hasznos támpontot adnak azoknak a pároknak, akik most választanak szolgáltatót.`,
      ],
      cta: "Értékelések gyűjtése",
      secondaryLinks: [
        { label: "Megosztás WhatsApp-on", url: p.whatsappUrl },
        { label: "Küldés e-mailben", url: p.mailtoUrl },
      ],
    },
    en: {
      preheader: "Your review link is ready to share with past clients.",
      greeting: p.businessName.trim() ? `Hi ${p.businessName.trim()},` : "Hi there,",
      paragraphs: [
        "Past clients can review your work without creating a Weddly account.",
        `Share your review link with them: **${p.reviewUrl}**. Their feedback gives couples useful context when choosing a supplier.`,
      ],
      cta: "Collect reviews",
      secondaryLinks: [
        { label: "Share on WhatsApp", url: p.whatsappUrl },
        { label: "Send by email", url: p.mailtoUrl },
      ],
    },
  }),
  // Personal invitation to an address shared by a couple already planning on
  // Weddly. The note explains exactly where the address came from, what Weddly
  // does, and that no account was created without the recipient's consent.
  // Personalised by first name and signed by the team, never an individual.
  personal_invite: (p) => ({
    subject:
      p.locale === "hu"
        ? "Tervezzétek meg az esküvőt a Weddlyvel"
        : "Plan your wedding with Weddly",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "Egy éppen esküvőt tervező pár a Weddly oldalán megadta az e-mail-címedet.",
      greeting: p.name.trim() ? `Szia ${givenNameFrom(p.name, "hu")}!` : "Szia!",
      paragraphs: [
        "Egy éppen esküvőt tervező pár a Weddly oldalán megadta az e-mail-címedet.",
        "A Weddly egy online esküvőtervező, ahol egy helyen kezelheted a költségvetést, a vendéglistát, az online RSVP-t, az ülésrendet, a szolgáltatókat és az esküvői weboldalatokat.",
        "Ha te is esküvőt tervezel, nézz körül, és próbáld ki:",
      ],
      cta: "Regisztrálok a Weddlyre",
      postCtaParagraphs: [
        "Ha pedig nem te készülsz esküvőre, de van a környezetedben valaki, aki éppen szervezi a nagy napot, nyugodtan továbbítsd neki ezt a levelet. 💌",
        "Az e-mail-címedet kizárólag ennek az üzenetnek az elküldéséhez kaptuk meg és használjuk. Fiókot nem hoztunk létre számodra – az csak a te jóváhagyásoddal, regisztráció után jön létre.",
      ],
      signoff: ["Üdv,", "a Weddly csapata"],
      suppressOutreachChrome: true,
      suppressFooterWhyLine: true,
      footerHelpLabel: "Kérdésed van?",
    },
    en: {
      preheader: "A couple currently planning their wedding on Weddly shared your email address.",
      greeting: p.name.trim() ? `Hi ${givenNameFrom(p.name, "en")},` : "Hi there,",
      paragraphs: [
        "A couple currently planning their wedding on Weddly shared your email address.",
        "Weddly is an online wedding planner where you can manage your budget, guest list, online RSVPs, seating plan, vendors and wedding website in one place.",
        "If you're planning a wedding too, take a look and give it a try:",
      ],
      cta: "Sign up for Weddly",
      postCtaParagraphs: [
        "If you're not the one getting married but know someone who is planning their big day, please forward this email to them. 💌",
        "We received and use your email address solely to send this message. We have not created an account for you – one will only be created with your approval, after you register.",
      ],
      signoff: ["Best,", "the Weddly team"],
      suppressOutreachChrome: true,
      suppressFooterWhyLine: true,
      footerHelpLabel: "Questions?",
    },
  }),
  // Admin re-engagement message for a registered couple before onboarding.
  // Keep it short and focused on the first useful setup step.
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
      preheader: "Nevek, dátum, vendégszám, és indulhat a közös tervezés.",
      greeting: p.name.trim() ? `Szia ${p.name.trim()}!` : "Szia!",
      paragraphs: [
        "A **Weddly**-fiókod és az esküvőterveződ készen áll az indulásra.",
        "Add meg a neveket, az esküvő dátumát és a várható vendégszámot. Ezután máris használhatod a **költségvetést**, az online RSVP-vel összekötött **vendéglistát** és az **ülésrendet**.",
        "Kezdjétek azzal, amit már tudtok; minden részletet bármikor módosíthattok.",
      ],
      cta: "Befejezem a beállítást",
      ctaSubtext: "2 perc az egész.",
      footnote:
        "Ezt azért kaptad, mert van egy Weddly-fiókod. Kérdésed van? Válaszolj erre a levélre.",
    },
    en: {
      preheader: "Names, date and guest count: everything you need to get started.",
      greeting: p.name.trim() ? `Hi ${p.name.trim()},` : "Hi there,",
      paragraphs: [
        "Your **Weddly** account and wedding planner are ready to get started.",
        "Add your names, wedding date and estimated guest count to set up a flexible **budget**, a **guest list** with online RSVPs and a draft **seating plan**.",
        "Start with what you already know; every detail can be changed later.",
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
        ? "Fejezd be az esküvőtervező beállítását"
        : "Your planner is ready when you are",
    ctaUrl: p.ctaUrl,
    hu: {
      preheader: "A terveződ készen áll: nevek, dátum, vendégszám, és indulhat.",
      greeting: p.name.trim() ? `Szia ${p.name.trim()}!` : "Szia!",
      paragraphs: [
        "A Weddly-fiókod és az esküvőterveződ készen áll.",
        "Add meg a neveket, az esküvő dátumát és a várható vendégszámot a költségvetés, a vendéglista és az ülésrend beállításához. Később mindent módosíthatsz.",
      ],
      cta: "Elkezdem most",
      ctaSubtext: "2 perc az egész.",
      footnote: "A beállítást bármikor folytathatod.",
    },
    en: {
      preheader: "Your planner is ready: add names, date and guest count to begin.",
      greeting: p.name.trim() ? `Hi ${p.name.trim()},` : "Hi there,",
      paragraphs: [
        "Your Weddly account and wedding planner are ready.",
        "Add your names, wedding date and estimated guest count to set up the budget, guest list and seating plan. You can change everything later.",
      ],
      cta: "Start now",
      ctaSubtext: "Takes 2 minutes.",
      footnote: "You can return and finish the setup whenever it suits you.",
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
      preheader: `${p.listingName} adatlapjának átvétele.`,
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
        "If you started this request, use the link below to set a password and take control of the listing.",
        "If you did not request this, ignore the email. Nothing will change unless the link is opened.",
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
        "The verification link was sent to the contact address on the listing, which is used to verify ownership. This is for your information; no action is needed unless the request looks suspicious.",
      ],
      cta: "Open admin",
      footnote: "Sent to admins whenever a listing claim starts.",
    },
  }),

  vendor_duplicate_admin_alert: (p, ctx) => {
    const matchLines = p.matches
      .map(
        (match) =>
          `• #${match.vendorAccountId} (${match.vendorCode ?? "no code"}): ${match.displayName}, owner ${match.ownerEmail}${match.contactEmail ? `, contact ${match.contactEmail}` : ""}`,
      )
      .join("\n");
    const newAccountLabel = p.newVendorAccountId == null ? "pending" : `#${p.newVendorAccountId}`;

    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `Lehetséges duplikált szolgáltató: ${p.displayName}`,
        `Possible duplicate vendor: ${p.displayName}`,
      ),
      ctaUrl: p.adminUrl,
      hu: {
        preheader: `${p.displayName} neve vagy email-címe egyezik egy meglévő szolgáltatóval.`,
        greeting: ctx.recipientName ? `Szia ${ctx.recipientName}!` : "Szia!",
        paragraphs: [
          "Egy új szolgáltatói fiók neve vagy email-címe egyezik legalább egy meglévő fiókkal.",
          [
            `• Forrás: ${p.source}`,
            `• Új fiók: ${newAccountLabel} — ${p.displayName} <${p.email}>`,
            "• Meglévő egyezések:",
            matchLines,
          ].join("\n"),
          "Ha ugyanaz a vállalkozás regisztrált kétszer, az admin felületen egyesítsd a fiókokat. Ha valódi névazonosság, nincs teendő.",
        ],
        cta: "Szolgáltatók ellenőrzése",
        footnote: "Ezt az értesítést minden név- vagy email-egyezésnél elküldjük az adminoknak.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          "A new vendor account name or email matches at least one existing account.",
          [
            `• Source: ${p.source}`,
            `• New account: ${newAccountLabel} — ${p.displayName} <${p.email}>`,
            "• Existing matches:",
            matchLines,
          ].join("\n"),
          "If the same business registered twice, merge the accounts in the admin console. If they are genuine namesakes, no action is needed.",
        ],
        cta: "Review vendors",
        footnote: "Sent to admins whenever a vendor name or email match is detected.",
      },
    };
  },

  personal_invite_bad_name_admin_alert: (p, ctx) => {
    const sampleLines = p.samples.map((s) => `• ${s.name || "(empty)"} <${s.email}>`).join("\n");
    return {
      subject: localeSubject(
        ctx.recipientLocale,
        `${p.count} gyanús név a(z) "${p.campaignSlug}" listában`,
        `${p.count} suspicious name(s) in "${p.campaignSlug}"`,
      ),
      ctaUrl: p.adminUrl,
      hu: {
        preheader: "Egy import számot vagy szokatlan írásjelet tartalmazó nevet hozott be.",
        greeting: ctx.recipientName ? `Szia ${ctx.recipientName}!` : "Szia!",
        paragraphs: [
          `A(z) "${p.campaignSlug}" személyes meghívó lista importja ${p.count} olyan sort tartalmazott, ahol a név mezőben szám vagy nem betű karakter szerepelt — ez általában azt jelenti, hogy a forrás CSV egy másik oszlopot (árat, azonosítót, dátumot) is belekevert a névbe. Ezeket a sorokat a rendszer nem importálta.`,
          ["• Első néhány érintett sor:", sampleLines].join("\n"),
          "Ellenőrizd a forrás CSV-t, mielőtt újra importálod ezeket a címeket.",
        ],
        cta: "Kampány megnyitása",
        footnote: "Ezt minden importnál elküldjük, ha bármelyik név gyanús karaktert tartalmaz.",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `The "${p.campaignSlug}" personal-invite import had ${p.count} row(s) where the name field contained a digit or non-letter character — usually a sign the source CSV mixed another column (a price, an id, a date) into the name. Those rows were not imported.`,
          ["• First few affected rows:", sampleLines].join("\n"),
          "Check the source CSV before re-importing those addresses.",
        ],
        cta: "Open campaign",
        footnote: "Sent whenever an import contains a name with a suspicious character.",
      },
    };
  },

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
        `A(z) ${p.supplierName} adatlapja mostantól elérhető a Weddly nyilvános szolgáltatói katalógusában.`,
        "A párok megtalálhatják és megnyithatják az adatlapot. Frissítéshez válaszolj erre az e-mailre, és segítünk.",
      ],
      cta: "Adatlap megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `We've reviewed your listing and ${p.supplierName} is now visible in Weddly's public supplier directory.`,
        "Couples can now find the listing. If the phone number, website or description needs updating, reply to this email and our team will help.",
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
      `Visszajelzés a ${p.supplierName} adatlapjáról`,
      `An update on your listing`,
    ),
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `Átnéztük a ${p.supplierName} adatlapját, és összefoglaltuk a következő lépést.`,
      greeting: "Szia!",
      paragraphs: [
        `Köszönjük a ${p.supplierName} adatlapját. A katalógust jelenleg egy szűkebb szolgáltatói körrel építjük tovább.`,
        ...(p.reason ? [`A csapatunk megjegyzése: „${p.reason}"`] : []),
        "Friss információval vagy pontosítással válaszolj erre az e-mailre, és ismét átnézzük az adatlapot.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `Thank you for submitting ${p.supplierName}. We are currently building the directory with a focused group of vendors.`,
        ...(p.reason ? [`A note from our team: "${p.reason}"`] : []),
        "Reply with updated information or context and our team will review the listing again.",
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
      preheader: `Egy felhasználó pontosítást javasolt a ${p.supplierName} adatlapjához.`,
      greeting: "Szia!",
      paragraphs: [
        `Egy felhasználó pontosítást javasolt a(z) ${p.supplierName} adatlapjához a Weddly katalógusban.`,
        `A visszajelzés témája: ${humanReportReasonHu(p.reason)}`,
        "Az adatlap továbbra is elérhető. Ha frissítenéd a címet, a leírást vagy a képeket, válaszolj erre az e-mailre, és segítünk.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `A user suggested an update to your ${p.supplierName} listing in the Weddly directory.`,
        `Feedback topic: ${humanReportReasonEn(p.reason)}`,
        "The listing remains available. Reply to update the address, description or photos and our team will help.",
      ],
      cta: "Open Weddly",
    },
  }),

  // Success confirmation after the vendor finishes the claim flow. Before
  // this, the verify click landed the vendor on a "set your password" page
  // and… nothing. This closes the loop with a Weddly-branded "you're in"
  // mail that doubles as proof-of-account for their records.
  vendor_claim_approved: (p, ctx) => ({
    subject: localeSubject(
      ctx.recipientLocale,
      `${p.listingName}: az adatlap a tiéd`,
      `${p.listingName} is yours`,
      {
        es: `${p.listingName} ya es tuyo`,
      },
    ),
    ctaUrl: p.managerUrl,
    hu: {
      preheader: `${p.listingName} mostantól a tiéd a Weddly-n.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A(z) ${p.listingName} adatlapja mostantól a Weddly szolgáltatói fiókodhoz tartozik.`,
        "Te szerkesztheted a leírást, az árakat, a képeket és az elérhetőségeket. A nyilvános katalógusban a párok az általad közzétett adatokat látják.",
        "Kérdés vagy frissítési kérés esetén válaszolj erre az e-mailre, és segítünk.",
      ],
      cta: "Adatlap kezelése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Done, ${p.listingName} is now linked to your Weddly vendor account.`,
        "From here on you can edit the listing yourself, description, pricing, photos, contact details. Couples browsing the directory will see exactly what you publish.",
        "If you have a question or something looks wrong, reply to this email and our team will help.",
      ],
      cta: "Manage your listing",
    },
    extra: {
      es: {
        preheader: `${p.listingName} ya está vinculado a tu cuenta de Weddly.`,
        greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
        paragraphs: [
          `${p.listingName} ya está vinculado a tu cuenta de proveedor de Weddly.`,
          "Ahora puedes editar la descripción, los precios, las fotos y los datos de contacto. Las parejas verán la información que publiques.",
          "Si tienes alguna pregunta o algo no parece correcto, responde a este correo y nuestro equipo te ayudará.",
        ],
        cta: "Gestionar anuncio",
      },
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
        "A belépésed változatlan: ugyanaz az e-mail cím és jelszó. Belépés után a szervezői felület fogad, ahol közös munkaterületen dolgozhatsz a párokkal.",
        "Ha kérdésed van, vagy mégis szolgáltatóként szeretnél megjelenni, válaszolj erre az e-mailre, és segítünk.",
      ],
      cta: "Szervezői felület",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We moved ${p.businessName} over to the planner side of Weddly, where wedding planning gets its own toolset.`,
        "Your sign-in is unchanged: same email, same password. Next time you log in you'll land on the planner workspace, where you plan alongside couples instead of advertising in the catalog.",
        "If you have questions or would prefer to be listed as a supplier, reply to this email and our team will help.",
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
    const dateEs = p.eventDate ? isoDateLabel(p.eventDate, "es") : "";
    const dateHr = p.eventDate ? isoDateLabel(p.eventDate, "hr") : "";
    const dateDe = p.eventDate ? isoDateLabel(p.eventDate, "de") : "";
    const sentHu = timestampLabel(p.sentAt, "hu");
    const sentEn = timestampLabel(p.sentAt, "en");
    const sentEs = timestampLabel(p.sentAt, "es");
    const sentHr = timestampLabel(p.sentAt, "hr");
    const sentDe = timestampLabel(p.sentAt, "de");

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
        `**Esküvő időpontja:** ${dateHu || "egyeztetés alatt"}`,
        ...(sentHu ? [`**Beérkezett:** ${sentHu}`] : []),
        closingHu,
      ];
      const enParas = [
        `**${p.coupleDisplayName}** got in touch through Weddly.`,
        `**Topic:** ${p.subject}`,
        `**Wedding date:** ${dateEn || "to be confirmed"}`,
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
          es: {
            preheader: `${p.subject}${dateEs ? ` · ${dateEs}` : ""}`,
            greeting: `Hola ${p.supplierName}:`,
            paragraphs: [
              `**${p.coupleDisplayName}** se ha puesto en contacto a través de Weddly.`,
              `**Asunto:** ${p.subject}`,
              `**Fecha de la boda:** ${dateEs || "por confirmar"}`,
              ...(sentEs ? [`**Recibido:** ${sentEs}`] : []),
              p.canReplyInApp
                ? "El mensaje está en tu lista de clientes. Puedes responder allí y conservar la conversación junto al resto de consultas."
                : "El mensaje está en tu lista de clientes, junto con los datos de contacto de la pareja.",
            ],
            cta: "Abrir consulta",
          },
          hr: {
            preheader: `${p.subject}${dateHr ? ` · ${dateHr}` : ""}`,
            greeting: `Pozdrav ${p.supplierName}!`,
            paragraphs: [
              `**${p.coupleDisplayName}** vam se javio preko Weddlyja.`,
              `**Tema:** ${p.subject}`,
              `**Datum vjenčanja:** ${dateHr || "u dogovoru"}`,
              ...(sentHr ? [`**Zaprimljeno:** ${sentHr}`] : []),
              p.canReplyInApp
                ? "Poruka vas čeka među klijentima. Ondje možete odgovoriti i ostaje uz ostale upite."
                : "Poruka vas čeka među klijentima, zajedno s kontaktom para, i ostaje uz ostale upite.",
            ],
            cta: "Otvorite upit",
          },
          de: {
            preheader: `${p.subject}${dateDe ? ` · ${dateDe}` : ""}`,
            greeting: `Hallo ${p.supplierName},`,
            paragraphs: [
              `**${p.coupleDisplayName}** hat sich über Weddly gemeldet.`,
              `**Thema:** ${p.subject}`,
              `**Hochzeitsdatum:** ${dateDe || "in Abstimmung"}`,
              ...(sentDe ? [`**Eingegangen:** ${sentDe}`] : []),
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
        `Megérkezett a megkeresésetek ${p.vendorName} csapatához`,
        `${p.vendorName} received your inquiry · Weddly`,
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
      `${p.coupleName} megkeresése készen áll a válaszra`,
      `${p.coupleName}'s inquiry is ready for your reply · Weddly`,
    ),
    ctaUrl: `${CONFIG.frontendBaseUrl}${p.clientUrl}`,
    hu: {
      preheader: `Nyissátok meg a ${p.eventDate} dátumra érkezett megkeresést.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `**${p.coupleName}** a ${p.eventDate} dátummal kapcsolatban keresett meg benneteket.`,
        "Egy rövid válasszal máris továbbvihetitek az egyeztetést.",
      ],
      cta: "Ügyfél megnyitása",
    },
    en: {
      preheader: `Open the inquiry for ${p.eventDate}.`,
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.coupleName}** contacted you about ${p.eventDate}.`,
        "A short reply is enough to move the conversation forward.",
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
      preheader: `Osszátok meg a tapasztalataitokat ${p.vendorName} munkájáról.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `A ${p.eventDate} napi esküvőtökön **${p.vendorName}** dolgozott veletek.`,
        "Egy őszinte értékelés hasznos támpontot ad a következő pároknak, és visszajelzést a szolgáltatónak.",
        "Válasszatok csillagértékelést, és ha szeretnétek, írjatok mellé pár szót.",
      ],
      cta: "Értékelem őket",
    },
    en: {
      preheader: `Share your experience of working with ${p.vendorName}.`,
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `**${p.vendorName}** worked with you at your wedding on ${p.eventDate}.`,
        "An honest rating helps other couples choose and gives the vendor useful feedback.",
        "Choose a star rating and add a short comment if you would like to share more.",
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
        { es: `${p.coupleName} te ha enviado un mensaje · Weddly` },
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
        es: {
          preheader: `${p.coupleName} te ha escrito.`,
          greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
          paragraphs: [`**${p.coupleName}** te ha enviado un mensaje:`, ...bodyParas],
          cta: "Responder en Weddly",
        },
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
          { es: `${p.coupleName} ha aceptado tu presupuesto · Weddly` },
        )
      : localeSubject(
          ctx.recipientLocale,
          `${p.coupleName} válaszolt az árajánlatra`,
          `${p.coupleName} answered your quote · Weddly`,
          { es: `${p.coupleName} ha respondido a tu presupuesto · Weddly` },
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
              `**${p.coupleName}** másik ajánlatot választott ehhez a megkereséshez: **${p.title}** (${p.totalText}).`,
              ...huReason,
              "A visszajelzés alapján frissített ajánlatot is küldhetsz ugyanerre a megkeresésre.",
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
              `**${p.coupleName}** selected a different offer for this inquiry: **${p.title}** (${p.totalText}).`,
              ...enReason,
              "You can send an updated offer on the same inquiry based on their feedback.",
            ],
        cta: "Open in Weddly",
      },
      extra: {
        es: {
          preheader: p.accepted
            ? `${p.coupleName} ha aceptado tu presupuesto de ${p.totalText}.`
            : `${p.coupleName} ha elegido otra opción.`,
          greeting: `Hola ${ctx.recipientName || ""}:`.trim(),
          paragraphs: p.accepted
            ? [
                `**${p.coupleName}** ha aceptado tu presupuesto: **${p.title}** (${p.totalText}).`,
                "Abre la ficha del cliente en Weddly para acordar el siguiente paso.",
              ]
            : [
                `**${p.coupleName}** no ha elegido este presupuesto: **${p.title}** (${p.totalText}).`,
                ...(p.declineReason ? [`Su comentario: "${p.declineReason}"`] : []),
                "Si quieres modificar la propuesta, puedes enviar un nuevo presupuesto para la misma consulta.",
              ],
          cta: "Abrir en Weddly",
        },
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
              "Köszönjük a jelentkezésed a Weddly tervezői programjába. A szervezői hozzáférésed a **meglévő fiókodon** aktív.",
              "Lépj be, és a felület végigvezet a profilod beállításán (vállalkozásnév és város), hogy megjelenj a pároknak szóló szervezői ajánlóban.",
            ]
          : p.nextStep === "sign_in"
            ? [
                "Köszönjük a jelentkezésed a Weddly tervezői programjába. Ezzel az e-mail címmel **már van Weddly-fiókod**.",
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
              "Thanks for applying to the Weddly planner programme. Your planner access is active on **your existing account**.",
              "Sign in and the app walks you through your profile (business name and city) so you appear in the planner directory couples browse.",
            ]
          : p.nextStep === "sign_in"
            ? [
                "Thanks for applying to the Weddly planner programme. This email address is linked to **an existing Weddly account**.",
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
          "Visszajelzés a szervezői meghívásról",
          "An update on your planner invitation · Weddly",
        ),
    ctaUrl: p.accepted
      ? `${CONFIG.frontendBaseUrl}/app/settings/workspace`
      : `${CONFIG.frontendBaseUrl}/app/vendors`,
    replyTo: p.accepted ? p.replyToEmail : undefined,
    hu: {
      preheader: p.accepted
        ? `${p.plannerLabel} elfogadta a meghívásod.`
        : `A szervezői ajánlóban folytathatjátok a keresést.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: p.accepted
        ? [
            `**${p.plannerLabel}** elfogadta a meghívásod, mostantól hozzáfér a munkaterületetekhez, és segíthet a szervezésben.`,
            "A hozzáférését bármikor visszavonhatod a munkaterület beállításai között.",
          ]
        : [
            `**${p.plannerLabel}** válaszolt a meghívásra. A közös munkaterülethez ezúttal nem csatlakozik.`,
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
            `**${p.plannerLabel}** responded to the invitation and will not join the workspace this time.`,
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
        "Erre az e-mail-címre feliratkozási kérés érkezett a Weddly hírlevelére: esküvőtervezési tippek és termékújdonságok, havonta nagyjából egy-két levél.",
        "A feliratkozást az alábbi gombbal erősítheted meg. A hírlevél kizárólag a megerősítés után indul.",
      ],
      cta: "Feliratkozás megerősítése",
      footnote: "A link 7 napig érvényes. Havonta nagyjából egy-két levelet küldünk.",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        "A subscription request was made for this address to receive the Weddly newsletter: wedding-planning tips and product news, roughly one or two emails a month.",
        "Confirm with the button below. The newsletter starts only after confirmation.",
      ],
      cta: "Confirm subscription",
      footnote: "The link is valid for 7 days. We send roughly one or two emails a month.",
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
        "Ezzel az e-mail-címmel szolgáltatói javaslat vagy értékelés indult a Weddly-n.",
        "Erősítsd meg a címet az alábbi gombbal, és már küldheted is a javaslatot vagy az értékelést.",
      ],
      cta: "E-mail-cím megerősítése",
      footnote: "A link 7 napig érvényes. A megerősítés után közvetlenül folytathatod a beküldést.",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        "A supplier suggestion or review was started on Weddly with this email address.",
        "Confirm the address below to submit the suggestion or review.",
      ],
      cta: "Confirm your email",
      footnote:
        "The link is valid for 7 days. After confirmation, you can continue directly to your submission.",
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
