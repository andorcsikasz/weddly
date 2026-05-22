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
  /** Surfaces the named language on TOP of the bilingual stack — used when
   *  we don't know the recipient's locale (a vendor with no Weddly account)
   *  but DO know the submitter's (the couple who triggered the mail). HU/EN
   *  bilingual still renders both blocks; the hint just reorders them. */
  primaryLocaleHint?: "hu" | "en";
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

// ─── Per-kind input shapes — each kind has its own narrow payload. ──────────

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
  /** The address the change is moving TO — shown so the owner can act if it's wrong. */
  newEmail: string;
  /** Where to start a password reset to lock everyone else out. */
  forgotUrl: string;
}
export interface PartnerInvitePayload {
  inviterName: string;
  inviteUrl: string;
  /** Optional couple display name — when present, used to personalize the
   *  body ("Your shared workspace: Anna & Bence"). Falls back gracefully
   *  when empty (e.g. a freshly-onboarded couple with no display name set). */
  coupleDisplayName?: string;
}
export interface PartnerInviteAcceptedPayload {
  /** Display name of the partner who just clicked accept. */
  partnerName: string;
  /** Optional couple display name for the body ("Anna & Bence"). */
  coupleDisplayName?: string;
  /** Where to land in /app — usually the dashboard. */
  dashboardUrl: string;
}
export interface PartnerInviteDeclinedPayload {
  /** Address the original invite was sent to. Lets the inviter recognise
   *  which invite this was about when they sent multiple. */
  invitedEmail: string;
  /** Where to (re-)issue an invite — typically /app/profile. */
  reinviteUrl: string;
}
export interface PartnerLeftWorkspacePayload {
  /** Display name of the partner who left. */
  partnerName: string;
  /** Optional couple display name for the body ("Anna & Bence"). */
  coupleDisplayName?: string;
  /** Where to (re-)issue an invite — typically /app/profile. */
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
  /** Where to land in the app — usually the dashboard. */
  dashboardUrl: string;
}
export interface AccountPurgedPayload {
  /** Display name the workspace had at purge time ("Anna & Bence"). */
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
   *  Empty string when admin chose not to add one — body softens accordingly. */
  note: string;
}
export interface RsvpReceivedForCouplePayload {
  guestName: string;
  rsvpStatus: "yes" | "no" | "maybe";
  guestPageUrl: string;
}
export interface RsvpReceivedHouseholdForCouplePayload {
  /** Household label as it sits in /app/guests — "Anna & Mark" etc. */
  householdLabel: string;
  /** One row per guest whose status moved in this submission. Order is
   *  preserved so the email reads naturally. */
  guests: {
    name: string;
    rsvpStatus: "yes" | "no" | "maybe";
  }[];
  guestPageUrl: string;
}
export interface RsvpThanksForGuestPayload {
  coupleDisplayName: string;
  weddingDate: string | null;
  rsvpStatus: "yes" | "no" | "maybe";
  rsvpPageUrl: string;
}
export interface GuestInvitePayload {
  /** "Anna & Bence" — used in the subject + body so the recipient knows
   *  whose wedding they're being invited to. */
  coupleDisplayName: string;
  /** Recipient's display name as it sits in the guest row. May be null when
   *  the couple created a placeholder row without typing a name yet. */
  guestName: string | null;
  /** Pre-formatted wedding date ("2026-09-12") or null if the couple hasn't
   *  pinned a date yet. */
  weddingDate: string | null;
  /** Full URL with the per-guest invite_code baked in — the recipient lands
   *  on /rsvp/{code} with the form pre-populated and just confirms. */
  rsvpUrl: string;
}
export interface OnboardingNudgePayload {
  onboardingUrl: string;
}
export interface MilestonePayload {
  /** Couple's friendly display name — "Anna & Bence". */
  coupleDisplayName: string;
  /** ISO date the wedding is happening. */
  weddingDate: string;
  /** Where in the app to land — usually the dashboard. */
  dashboardUrl: string;
}
export interface WeddingTodayPayload {
  coupleDisplayName: string;
}
export interface WeddingTodayFollowupPayload {
  /** "Anna & Bence" — couple's display name. */
  coupleDisplayName: string;
  /** Where to leave feedback / NPS. Typically a Weddly form route. */
  feedbackUrl: string;
}
export interface WeddingDateChangedPayload {
  /** "Anna & Bence" — couple's display name. */
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
  /** Couple's display name — "Anna & Bence". */
  coupleDisplayName: string;
  /** Pre-formatted wedding date the body references. */
  weddingDate: string;
  /** Number of guests whose RSVP status is still pending. */
  pendingCount: number;
  /** Where to land in /app — usually the guests page. */
  guestsUrl: string;
}

export interface VendorWaitlistReceivedPayload {
  /** What the vendor typed for their business — used to humanise the body. */
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
  /** Subject line the admin typed in the triage modal — used verbatim. */
  subject: string;
  /** Free-text body the admin edited in the modal. Multiple paragraphs are
   *  separated by blank lines; the builder splits on `\n\s*\n` and renders one
   *  `<p>` per chunk so HU and EN inline newlines don't blur together. */
  body: string;
  /** Triage outcome — drives a small contextual preheader so inbox preview
   *  shows the gist before the body opens. */
  outcome: "accepted" | "under_review" | "rejected";
}

export interface CommunitySupplierVerifyPayload {
  /** Business / listing name surfaced in the email body. */
  supplierName: string;
  /** Full URL the recipient clicks to confirm — includes the single-use token. */
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
  /** Full URL the recipient clicks to claim — includes the single-use token. */
  verifyUrl: string;
}

export interface VendorClaimApprovedPayload {
  /** Listing name to acknowledge ("Your listing 'Bloom Studio' is live"). */
  listingName: string;
  /** Where the vendor manages their listing from now on — typically /vendor. */
  managerUrl: string;
}

export interface SupplierOutreachPayload {
  /** "Anna & Bence" — couple's display name. Used in the From label and the
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
  /** Body text the couple typed in /app/outreach. Plain text — newlines
   *  preserved by the renderer. */
  body: string;
  /** Where the couple can find the campaign in-app — footer link. */
  outreachUrl: string;
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
  partner_left_workspace: PartnerLeftWorkspacePayload;
  couple_paused: CouplePausedPayload;
  couple_pause_cancelled: CouplePauseCancelledPayload;
  account_purged: AccountPurgedPayload;
  account_admin_purged: AccountAdminPurgedPayload;
  account_flagged: AccountFlaggedPayload;
  account_flag_cleared: AccountFlagClearedPayload;
  rsvp_received_for_couple: RsvpReceivedForCouplePayload;
  rsvp_received_household_for_couple: RsvpReceivedHouseholdForCouplePayload;
  rsvp_thanks_for_guest: RsvpThanksForGuestPayload;
  guest_invite: GuestInvitePayload;
  onboarding_nudge: OnboardingNudgePayload;
  milestone_t90: MilestonePayload;
  milestone_t30: MilestonePayload;
  milestone_t7: MilestonePayload;
  wedding_today: WeddingTodayPayload;
  wedding_today_followup: WeddingTodayFollowupPayload;
  wedding_date_changed: WeddingDateChangedPayload;
  rsvp_deadline_approaching: RsvpDeadlineApproachingPayload;
  vendor_waitlist_received: VendorWaitlistReceivedPayload;
  vendor_waitlist_decision: VendorWaitlistDecisionPayload;
  community_supplier_verify: CommunitySupplierVerifyPayload;
  community_supplier_published: CommunitySupplierPublishedPayload;
  community_supplier_rejected: CommunitySupplierRejectedPayload;
  community_supplier_reported: CommunitySupplierReportedPayload;
  vendor_claim_verify: VendorClaimVerifyPayload;
  vendor_claim_approved: VendorClaimApprovedPayload;
  supplier_outreach: SupplierOutreachPayload;
};

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildEmail<K extends EmailKind>(
  kind: K,
  payload: KindPayload[K],
  context: BuildContext,
): BuiltEmail {
  const built = BUILDERS[kind](payload as never, context);
  const category = KIND_CATEGORY[kind];
  const ctaUrl = appendEmailUtm(built.ctaUrl, kind, category);
  const rendered = renderEmail({
    hu: built.hu,
    en: built.en,
    ctaUrl,
    category,
    unsubscribeToken: context.unsubscribeToken,
    recipientLocale: context.recipientLocale,
    primaryLocaleHint: context.primaryLocaleHint,
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
}

type Builder<K extends EmailKind> = (payload: KindPayload[K], ctx: BuildContext) => RawTemplate;

const BUILDERS: { [K in EmailKind]: Builder<K> } = {
  welcome_verify: (p, ctx) => ({
    subject: "Üdv a Weddly-n / Welcome to Weddly",
    ctaUrl: p.verifyUrl,
    hu: {
      preheader: "Erősítsd meg az e-mail címed, hogy később vissza tudd állítani a fiókod.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Üdv a Weddly-n — örülünk, hogy itt vagytok.",
        "A nyugodt esküvőtervezéshez minden eszköz a kezedben van: vendéglista, ülésrend, költségvetés, RSVP, nyomtatható meghívók. Minden egyetlen helyen, magyarul.",
        "Még egy lépés van hátra: erősítsd meg az e-mail címed. Ez azért fontos, hogy később, ha elfelejtenéd a jelszót, vissza tudd állítani — különben elveszhet a teljes esküvőtervező munkád.",
      ],
      cta: "E-mail cím megerősítése",
      ctaSubtext: "A link 7 napig érvényes.",
      footnote: "Akkor is bejelentkezhetsz, ha most még nem kattintasz.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Welcome to Weddly — we're glad you're here.",
        "Everything you need for a calm wedding-planning process is in one place: guest list, seating plan, budget, RSVP, printable stationery.",
        "One quick thing: please confirm your email so you can recover your account if you ever lose your password.",
      ],
      cta: "Confirm your email",
      ctaSubtext: "The link is valid for 7 days.",
      footnote: "You can keep using Weddly while you wait.",
    },
  }),

  verify_resend: (p, ctx) => ({
    subject: "Új megerősítő link / fresh verification link",
    ctaUrl: p.verifyUrl,
    hu: {
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Itt egy új link az e-mail cím megerősítéséhez.",
        "Ha nem te kérted, hagyd figyelmen kívül ezt a levelet — a régi linket továbbra is használhatod, amíg le nem jár.",
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
        "Új jelszót kértél a Weddly fiókodhoz. A link biztonsági okokból 1 órán át érvényes.",
        "Ha nem te kérted, ne kattints rá és ne add meg senkinek — a fiókod a régi jelszóval továbbra is biztonságban van.",
      ],
      cta: "Új jelszó beállítása",
      ctaSubtext: "Egyszer használható, 1 órán át érvényes link.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "You asked to reset your Weddly password. For your security this link is valid for 1 hour.",
        "If you didn't request this, you can ignore the email — your account is still safe.",
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
        `A Weddly fiókod jelszavát az imént (${p.changedAt}) megváltoztattuk.`,
        "Minden eddigi bejelentkezésedet kiléptettük, így új jelszóval kell újra belépned mindenhol.",
        "Ha NEM te voltál, azonnal állíts vissza új jelszót a lenti linkkel — ezzel azonnal kizárod azt, aki most lépett be.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, ezt a levelet figyelmen kívül hagyhatod.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Your Weddly password was just changed (${p.changedAt}).`,
        "We've signed out all of your existing sessions, so you'll need to log back in everywhere with the new password.",
        "If this wasn't you, request a fresh password immediately using the link below — that will lock out whoever just got in.",
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
        `Bejelentkezést észleltünk a Weddly fiókodba egy olyan eszközről, amit eddig nem láttunk (${p.signedInAt}).`,
        "Ha te voltál (új gép, új telefon, böngészőcsere, vagy más hálózat) — minden rendben, nincs teendő.",
        "Ha NEM te voltál, ez azt jelenti, hogy valaki más belépett a fiókodba a jelszavaddal. Kérj azonnal új jelszót a lenti linkkel — ezzel azonnal kilépteted őt mindenhonnan.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, nyugodtan figyelmen kívül hagyhatod ezt a levelet.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We noticed a sign-in to your Weddly account from a device we haven't seen before (${p.signedInAt}).`,
        "If it was you (new computer, new phone, different browser, different network) — all good, nothing to do.",
        "If it wasn't, someone else just got into your account with your password. Reset your password now using the link below — that will sign them out everywhere.",
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
        "Biztonsági okból minden eddigi bejelentkezésedet ki fogjuk léptetni, amikor megerősíted — bárhol használnál Weddly-t, újra be kell jelentkezned.",
      ],
      cta: "Új e-mail cím megerősítése",
      footnote: "Ha nem te kérted, hagyd figyelmen kívül — a régi cím marad érvényben.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `You asked to change the email on your Weddly account. The current one is ${p.oldEmail}.`,
        "Click below to make this new address your sign-in. From here on it'll receive every important message we send you and is what you'd use to reset a forgotten password.",
        "For your security we'll sign you out everywhere when you confirm — you'll need to log back in on each device.",
      ],
      cta: "Confirm new email",
      footnote: "If you didn't request this, ignore the email — your old address stays in place.",
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
        "Amíg ezt nem erősítik meg az új címen, a fiókod a jelenlegi címen marad — ezt az értesítést is ezért kapod, hogy figyelmeztessünk.",
        "Ha NEM te kezdeményezted, ez azt jelenti, hogy valaki be tud lépni a fiókodba. Kérj azonnal új jelszót a lenti linkkel — ezzel azonnal kizárod.",
      ],
      cta: "Új jelszó kérése",
      footnote: "Ha te voltál, ezt nyugodtan figyelmen kívül hagyhatod.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Someone just asked to change the email on your Weddly account to ${p.newEmail}.`,
        "Until that new address confirms the change, your account stays tied to this email — and you're seeing this as the heads-up.",
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
        preheader: "Közös vendéglista, ülésrend, költségvetés — egy munkamenetben.",
        greeting: "Szia!",
        paragraphs: [
          `${p.inviterName} elkezdte tervezni az esküvőt a Weddly-n, és meghívott, hogy csatlakozz hozzá.${coupleSuffixHu}`,
          "Egy közös munkamenetben dolgoztok: vendéglista, ülésrend, költségvetés, RSVP linkek, nyomtatható helykártyák és asztalterv. Minden valós időben szinkronban — semmi táblázat-pingpong, semmi „melyik a legfrissebb verzió”.",
          "Magyar nyelvű, ingyenes a nyilvános béta alatt, és semmilyen szállítóhoz nem köt — az adatok a tiétek maradnak.",
        ],
        cta: "Csatlakozom a tervezéshez",
        ctaSubtext: "A link 7 napig érvényes.",
        footnote: "Ha véletlenül kaptad, hagyd figyelmen kívül — semmi sem fog történni.",
      },
      en: {
        greeting: "Hello,",
        paragraphs: [
          `${p.inviterName} started planning your wedding on Weddly and invited you to join.${coupleSuffixEn}`,
          'One shared workspace covers guest list, seating chart, budget, RSVP links, printable place cards and table plans — in real-time sync. No more spreadsheet ping-pong or "which version was the latest?".',
          "Free during the open beta, no vendor lock-in — your data stays yours.",
        ],
        cta: "Join the workspace",
        ctaSubtext: "Link valid for 7 days.",
        footnote: "Got this by mistake? Ignore it — nothing happens.",
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
          "Mostantól minden adatot együtt szerkesztetek — vendéglista, ülésrend, költségvetés, RSVP linkek. Ami valamelyikőtök változtat, a másikon azonnal látszik.",
        ],
        cta: "Vezérlőpult megnyitása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `Good news — ${p.partnerName} accepted your invite and joined the wedding planner.${coupleEn}`,
          "You'll both be editing the same data from here on — guest list, seating, budget, RSVP links. Changes made by either of you show up instantly on the other side.",
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
        `A ${p.invitedEmail} címre küldött meghívót visszautasították — nem csatlakozik most az esküvőtervezőhöz.`,
        "Ha rossz címre küldted, vagy más személyt szeretnél meghívni, küldhetsz új meghívót a Profil oldalon. Egyébként szépen tovább tudsz tervezni egyedül is — minden funkció elérhető marad.",
      ],
      cta: "Új meghívó küldése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `The invite you sent to ${p.invitedEmail} was declined — they won't be joining the planner.`,
        "If you sent it to the wrong address or want to invite someone else, you can issue a fresh invite from your Profile page. Otherwise the planner stays fully usable solo — nothing's gated behind a partner.",
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
          `${p.partnerName} kilépett${coupleHu}esküvőtervezőjéből — innentől már nem szerkeszthet, és nem jelenik meg a vendéglistában, ülésrendben, költségvetésben.`,
          "Minden adat helyén marad. Ha másik személyt szeretnél meghívni közös tervezésre, küldhetsz új meghívót a Profil oldalon. Egyedül is szépen folytatódik a tervezés — minden funkció elérhető.",
        ],
        cta: "Új partner meghívása",
      },
      en: {
        greeting: `Hi ${ctx.recipientName || "there"},`,
        paragraphs: [
          `${p.partnerName} left${coupleEn}wedding planner — from here on they can't edit, and won't appear in the guest list, seating, or budget views.`,
          "All your data stays in place. If you'd like to invite someone else to plan together, you can issue a fresh invite from your Profile page. Solo planning keeps working fully — nothing's gated behind a partner.",
        ],
        cta: "Invite a new partner",
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
        `30 nap múlva (${p.scheduledDeleteDate}) az adatok véglegesen törlődnek — vendéglista, ülésrend, költségvetés, minden. Ezt utólag nem tudjuk visszaállítani.`,
        "Ha mégsem akartátok, vagy meggondoltátok magatokat, bármelyikőtök visszavonhatja a Profil oldalon.",
      ],
      cta: "Szüneteltetés visszavonása",
      footnote: "Ezt az értesítést mindketten megkapjátok, hogy bármelyikőtök tudjon dönteni.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.requestedByName} paused your shared wedding workspace.`,
        `In 30 days (${p.scheduledDeleteDate}) all of your data — guests, seating, budget — will be permanently deleted. We can't restore it after that.`,
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
        `${p.cancelledByName} visszavonta a közös esküvőtervezőtök szüneteltetését — a 30 napos visszaszámlálás leállt, és minden adat helyén marad.`,
        "Mostantól újra szerkeszthettek mindent: vendéglistát, ülésrendet, költségvetést.",
      ],
      cta: "Vissza a Weddly-re",
      footnote: "Ezt az értesítést mindketten megkapjátok.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.cancelledByName} cancelled the pause on your shared wedding workspace — the 30-day delete countdown is off, and all of your data stays in place.`,
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
        "Vendéglista, ülésrend, költségvetés, RSVP-k — mind eltávolítva. A bejelentkezésetek innentől nem működik.",
        "Köszönjük, hogy egy ideig velünk voltatok. Ha valaha újra szükségetek lenne rá, bármikor új fiókkal indulhattok.",
      ],
      cta: "Vissza a Weddly-re",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `The 30-day pause window has now expired, and all of ${p.coupleDisplayName}'s wedding-planning data has been deleted from Weddly.`,
        "Guest list, seating chart, budget, RSVPs — all removed. Your sign-in no longer works from this point on.",
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
            `A Weddly adminisztrátora törölte ${p.coupleDisplayName} esküvőtervező munkaterületét. Minden hozzátartozó adat — vendéglista, ülésrend, költségvetés, RSVP-k — eltávolítva, és a bejelentkezésetek innentől nem működik.`,
            "Ha úgy gondolod, hogy ez tévedésből történt, válaszolj erre az e-mailre — visszanézzük.",
          ]
        : [
            "A Weddly adminisztrátora törölte a fiókodat. A bejelentkezésed innentől nem működik, és nincs visszaállítási lehetőség.",
            "Ha úgy gondolod, hogy ez tévedésből történt, válaszolj erre az e-mailre — visszanézzük.",
          ],
      cta: "Weddly",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: p.coupleDisplayName
        ? [
            `A Weddly administrator has deleted ${p.coupleDisplayName}'s wedding-planning workspace. All of the associated data — guest list, seating, budget, RSVPs — has been removed, and your sign-in no longer works from this point on.`,
            "If you think this was a mistake, just reply to this email and we'll take a look.",
          ]
        : [
            "A Weddly administrator has deleted your account. Your sign-in no longer works from this point on, and the deletion cannot be undone.",
            "If you think this was a mistake, just reply to this email and we'll take a look.",
          ],
      cta: "Weddly",
    },
  }),

  // Moderation flag — fires the moment an admin clicks "Flag" on a user
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
        `Ha úgy érzed, hogy ez tévedés vagy szeretnéd elmagyarázni a helyzetet, válaszolj erre az e-mailre ${p.deadlineDateHu}-ig.`,
        "Ha eddig az időpontig nem kapunk választ, a fiókodat és a hozzátartozó adatokat (vendéglista, ülésrend, költségvetés, RSVP-k) automatikusan és véglegesen töröljük.",
      ],
      cta: "Weddly",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "A Weddly administrator has flagged your account for review. We'd like to hear from you about the following concern:",
        `"${p.reason}"`,
        `If you think this is a mistake or want to explain the situation, just reply to this email by ${p.deadlineDateEn}.`,
        "If we don't hear back by then, your account and all associated data (guest list, seating, budget, RSVPs) will be automatically and permanently deleted.",
      ],
      cta: "Weddly",
    },
  }),

  // Admin cleared the flag on a previously-flagged user. The flagged mail
  // promised "we'll delete your account if we don't hear back by X" — this
  // closes that loop so the user isn't left with the original threatening
  // message as the last communication from us.
  account_flag_cleared: (p, ctx) => ({
    subject: "Fiók ellenőrzés lezárva / Account review cleared",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: "A fiókodon álló jelölést feloldottuk.",
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "A korábban a fiókodra tett ellenőrzési jelölést feloldottuk — minden szolgáltatás megint elérhető, és semmilyen adatot nem törlünk.",
        ...(p.note ? [`Megjegyzés tőlünk: „${p.note}"`] : []),
        "Ha bármi kérdés van ezzel kapcsolatban, válaszolj erre az e-mailre.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "The review flag that was on your account has been cleared — every feature is available again, and no data will be deleted.",
        ...(p.note ? [`Note from us: "${p.note}"`] : []),
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
        `${p.guestName} most válaszolt a meghívóra: ${rsvpStatusHu(p.rsvpStatus)}.`,
        "Megnézheted a részleteket — ételválasztás, +1, szállásigény, zenekívánság — a vendéglistán.",
      ],
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.guestName} just responded: ${rsvpStatusEn(p.rsvpStatus)}.`,
        "Open the guest list to see meal choice, +1, accommodation, and song requests.",
      ],
      cta: "Open guest list",
    },
  }),

  rsvp_received_household_for_couple: (p, ctx) => ({
    subject: rsvpHouseholdSubject(p),
    ctaUrl: p.guestPageUrl,
    hu: {
      preheader: `${p.householdLabel}: ${p.guests.length} fő válaszolt.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `${p.householdLabel} (${p.guests.length} fő) most töltötte ki a meghívót:`,
        p.guests.map((g) => `• ${g.name} — ${rsvpStatusHu(g.rsvpStatus)}`).join("\n"),
        "Megnézheted a részleteket — ételválasztás, +1, szállásigény, zenekívánság — a vendéglistán.",
      ],
      cta: "Vendéglista megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `${p.householdLabel} (${p.guests.length} guests) just RSVPd together:`,
        p.guests.map((g) => `• ${g.name} — ${rsvpStatusEn(g.rsvpStatus)}`).join("\n"),
        "Open the guest list to see meal choice, +1, accommodation, and song requests.",
      ],
      cta: "Open guest list",
    },
  }),

  rsvp_thanks_for_guest: (p, ctx) => ({
    subject: `RSVP elküldve / RSVP confirmed — ${p.coupleDisplayName}`,
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
        `Thanks — we've recorded your RSVP for ${p.coupleDisplayName}'s wedding.`,
        rsvpThanksDetailEn(p),
      ],
      cta: "Update your response",
      footnote: "Open the link any time if anything changes.",
    },
  }),

  guest_invite: (p) => {
    const dateHu = p.weddingDate ? ` (${p.weddingDate})` : "";
    const dateEn = p.weddingDate ? ` (${p.weddingDate})` : "";
    const greetingHuName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    const greetingEnName = p.guestName ? ` ${p.guestName.split(" ")[0]}` : "";
    return {
      subject: `${p.coupleDisplayName} meghívnak az esküvőjükre / invite you to their wedding`,
      ctaUrl: p.rsvpUrl,
      hu: {
        preheader: "Egy kattintás — visszajelzés, ételválasztás, szállásigény.",
        greeting: `Szia${greetingHuName}!`,
        paragraphs: [
          `${p.coupleDisplayName} szeretettel meghívnak az esküvőjükre${dateHu}.`,
          "A lenti gombra kattintva egyetlen oldalon visszajelezhetsz: jössz-e, mit ennél, kell-e szállás, és van-e zenekívánságod. Bármikor frissítheted, ha valami változna.",
        ],
        cta: "Visszajelzés küldése",
        footnote: "Ha véletlenül kaptad, hagyd figyelmen kívül — semmi sem fog történni.",
      },
      en: {
        greeting: `Hi${greetingEnName},`,
        paragraphs: [
          `${p.coupleDisplayName} would love to have you at their wedding${dateEn}.`,
          "One click on the button below opens a single page where you can confirm attendance, pick a meal, flag accommodation needs, and request a song. You can update your answer any time.",
        ],
        cta: "RSVP now",
        footnote: "Got this by mistake? Ignore it — nothing happens.",
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
        "Pár perc az egész — pár adat (nevek, dátum, vendégszám), és máris kapsz egy szabható költségvetést, vendéglistát és ülésrend-vázat.",
        "Ha most nem alkalmas, leiratkozhatsz az emlékeztetőkről a levél alján.",
      ],
      cta: "Befejezem a tervező beállítását",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Quick reminder: you signed up for Weddly but haven't finished the initial setup yet.",
        "It only takes a few minutes — a few facts (names, date, guest count) and we'll seed a budget, guest list, and seating skeleton for you.",
        "If now's not a good time, you can opt out of these reminders from the footer below.",
      ],
      cta: "Finish my planner",
    },
  }),

  milestone_t90: (p, ctx) => ({
    subject: "3 hónap az esküvőtökig / 3 months to the wedding",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName} — 3 hónap maradt. Mi van még hátra?`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Pontosan 3 hónap múlva van a nagy nap.",
        "Most jó alkalom: véglegesítsétek a vendéglistát, küldjétek ki az RSVP linkeket, és nézzétek át a költségvetést, hogy nincs-e elszállás. A Weddly mindenhez egy gombnyira van.",
      ],
      cta: "Folytatás a vezérlőpulton",
      footnote: "Ezt a levelet csak párszor küldjük: 90, 30 és 7 nappal előtte.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "You're exactly 3 months out from the big day.",
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
      preheader: `${p.coupleDisplayName} — 30 nap. Itt egy pár fontos teendő.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Egy hónap maradt — innen kezdődik a célegyenes.",
        "Ezen a héten a legfontosabbak: véglegesítsétek az ülésrendet, döntsetek a menüsorokról és az ételválasztásokról, küldjetek emlékeztetőt a még nem válaszoló vendégeknek. Minden eszköz a kezetekben van.",
      ],
      cta: "Vezérlőpult megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "One month left — the home stretch.",
        "This week's priorities: finalize seating, lock the menu and meal counts, and chase any guests who still haven't RSVP'd.",
      ],
      cta: "Open dashboard",
    },
  }),

  milestone_t7: (p, ctx) => ({
    subject: "1 hét! / 1 week to go",
    ctaUrl: p.dashboardUrl,
    hu: {
      preheader: `${p.coupleDisplayName} — utolsó hét. Nyomtatás, ülésrend, részletek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        "Egy hét — most már tényleg közel van.",
        "Két dolog, amit érdemes most lezárni: nyomtassátok ki a végleges ülésrendet (A4/A3) és a névkártyákat (A6) a Nyomtatás fülön; küldjétek el a végleges fejszámot a helyszínnek és a catering-nek.",
        "Pihenjetek is. A nehezén túl vagytok.",
      ],
      cta: "Nyomtatás megnyitása",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "One week left.",
        "Two things worth closing this week: print the final seating chart (A4/A3) and place cards (A6) from the Print tab; share the final headcount with your venue and caterer.",
        "And rest. You've earned it.",
      ],
      cta: "Open print tab",
    },
  }),

  wedding_date_changed: (p, ctx) => {
    const fromHu = p.previousWeddingDate ? `${p.previousWeddingDate} → ` : "";
    const toHu = p.newWeddingDate ?? "új időpont egyeztetés alatt";
    const fromEn = p.previousWeddingDate ? `${p.previousWeddingDate} → ` : "";
    const toEn = p.newWeddingDate ?? "TBD (a new date will follow)";
    return {
      subject: `Új esküvői időpont / Wedding date update — ${p.coupleDisplayName}`,
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

  rsvp_deadline_approaching: (p, ctx) => ({
    subject: `${p.pendingCount} vendég még nem válaszolt / ${p.pendingCount} guests haven't RSVP'd`,
    ctaUrl: p.guestsUrl,
    hu: {
      preheader: `${p.coupleDisplayName} — 2 hét az esküvőig.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Két hét múlva van az esküvőtök (${p.weddingDate}), és ${p.pendingCount} vendég még nem küldte el az RSVP-jét.`,
        "A vendéglistán egy kattintás emlékeztetőt küldeni mindenkinek, aki még nem válaszolt. Most a jó pillanat — innentől kezdve egyre nehezebb lesz pontos fejszámot adni a helyszínnek és a catering-nek.",
      ],
      cta: "Vendéglista megnyitása",
      footnote: "Ezt az emlékeztetőt csak egyszer küldjük, T-14 napon.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Your wedding is two weeks away (${p.weddingDate}), and ${p.pendingCount} guests still haven't sent their RSVP.`,
        "On the guest list, one click sends a reminder to everyone who hasn't replied yet. Now's the right moment — it gets harder from here to give the venue and caterer a clean headcount.",
      ],
      cta: "Open guest list",
      footnote: "We only send this nudge once, at T-14 days.",
    },
  }),

  vendor_waitlist_received: (p, ctx) => ({
    subject: "Várólistára kerültél / You're on the Weddly vendor waitlist",
    ctaUrl: p.landingUrl,
    hu: {
      preheader: "Megkaptuk a jelentkezést — várólistán vagytok.",
      greeting: `Szia ${ctx.recipientName || p.businessName || ""}!`.trim(),
      paragraphs: [
        `Megkaptuk a(z) ${p.businessName} jelentkezését a Wēddly szolgáltatói várólistájára (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "Még nem nyitottunk a szolgáltatóknak — egy szűk kategóriánkénti listát építünk, hogy a párok ne 200 szolgáltatóból válogassanak, hanem azokból, akik tényleg passzolnak hozzájuk. Amint nyitunk, e-mailben jelentkezünk.",
        "Addig is, ha van bármi kérdés vagy szeretnétek többet mesélni magatokról, válaszoljatok erre a levélre — emberek olvassák.",
      ],
      cta: "Wēddly megnyitása",
      footnote: "Csak akkor írunk, amikor van új a várólistáddal.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || p.businessName || "there"},`,
      paragraphs: [
        `We've received ${p.businessName}'s submission to the Weddly vendor waitlist (${p.categoryLabel}${p.location ? ` · ${p.location}` : ""}).`,
        "We aren't onboarding suppliers yet — we're building a tight, per-category list so couples don't wade through 200 vendors but see the ones who actually fit. We'll email you the moment we open to applications in your category.",
        "If you'd like to share more or have any questions in the meantime, just reply to this email — a real person reads it.",
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

  wedding_today_followup: (p, ctx) => ({
    subject: `Milyen volt? / How was the wedding? — ${p.coupleDisplayName}`,
    ctaUrl: p.feedbackUrl,
    hu: {
      preheader: `Köszönjük, hogy a Weddly-vel terveztetek.`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Reméljük, hogy ${p.coupleDisplayName} szuper hétvégét töltöttetek el a hozzátok közel állókkal.`,
        "Egy kérésünk lenne — ha pár perced van, mondd el, milyen volt a Weddly tervezőként. Mi vált be, mi hiányzott, mit változtatnál. A visszajelzéseitek alapján fejlesztjük a következő funkciókat.",
      ],
      cta: "Visszajelzés küldése",
      footnote: "Pár perc az egész — válaszolhatsz erre az e-mailre is.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `We hope ${p.coupleDisplayName} had a wonderful weekend with the people who matter most.`,
        "One ask — if you have a few minutes, tell us what Weddly was like as a planner. What worked, what didn't, what you'd change. Your feedback shapes what we build next.",
      ],
      cta: "Share feedback",
      footnote: "Quick to do — you can also just reply to this email.",
    },
  }),

  wedding_today: (p, ctx) => ({
    subject: "Ma van a nap / Today's the day 💛",
    ctaUrl: CONFIG.frontendBaseUrl,
    hu: {
      preheader: `${p.coupleDisplayName} — gratulálunk!`,
      greeting: `Szia ${ctx.recipientName || ""}!`.trim(),
      paragraphs: [
        `Ma van a nap — ${p.coupleDisplayName}.`,
        "Köszönjük, hogy velünk terveztetek. Élvezzétek minden percét, mi addig csendben tartjuk a háttérben az adataitokat — bármikor visszanézhetitek később.",
      ],
      cta: "Vissza a Weddly-re",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Today's the day — ${p.coupleDisplayName}.`,
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
        "Ha szeretnéd, hogy a párok lássák, vedd át a hirdetést az alábbi linkkel — addig nem jelenik meg.",
        "Ha nem te küldted és nem szeretnéd, hogy itt szerepelj, hagyd figyelmen kívül ezt a levelet. Kattintás nélkül a hirdetés nem kerül publikálásra.",
      ],
      // "Átvétele" instead of "megerősítése" — the recipient never asked for
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
        "If you'd like couples to see the listing, claim it via the button below — until then it stays hidden from the public.",
        "If this wasn't you and you don't want a listing, just ignore this email — the listing won't publish without a click.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // P2.C — vendor claim verify mail. Categorised as `outreach`: anyone (no
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
        "Ha te vagy, kattints az alábbi linkre — ezzel jelszót állíthatsz be, és innentől te szerkesztheted a saját adataidat a katalógusban.",
        "Ha nem te kezdeményezted, hagyd figyelmen kívül ezt az emailt — kattintás nélkül semmi sem történik.",
      ],
      cta: "Listing átvétele",
      ctaSubtext: "A link 7 napig érvényes.",
      secondaryLinks: [{ label: "Mi az a Weddly?", url: CONFIG.frontendBaseUrl }],
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `Someone wants to claim the ${p.listingName} listing on Weddly.`,
        "If that's you, click the link below — you'll set a password and from then on manage the listing yourself in the directory.",
        "If you didn't request this, just ignore the email — nothing happens without clicking the link.",
      ],
      cta: "Claim your listing",
      ctaSubtext: "Link expires in 7 days.",
      secondaryLinks: [{ label: "What is Weddly?", url: CONFIG.frontendBaseUrl }],
    },
  }),
  // Admin moderation flipped a verified community-submitted supplier to
  // 'active' — it's now visible to couples. Closes the verify → moderation
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
        "A párok mostantól rátalálhatnak. Ha bármi adat változna (telefonszám, weboldal, leírás), válaszolj erre az emailre — emberek olvassák.",
      ],
      cta: "Hirdetés megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `We've reviewed your listing and ${p.supplierName} is now visible in Weddly's public supplier directory.`,
        "Couples can find you from here. If anything needs updating (phone, website, description), just reply to this email — a human reads it.",
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
        "Ha úgy gondolod, hogy ez tévedés, válaszolj erre az e-mailre — emberek olvassák.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `We've reviewed the listing and ${p.supplierName} doesn't fit Weddly's directory at this time.`,
        ...(p.reason ? [`Reason from our team: "${p.reason}"`] : []),
        "If you think this is a mistake, just reply to this email — a human reads it.",
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
        "Ez egy elsőjelzés — most még semmi nem változik a publikus megjelenésen. Ha tudod, hogy mi az amit pontosítani lehet (cím, leírás, képek), válaszolj erre az emailre és segítünk frissíteni.",
      ],
      cta: "Weddly megnyitása",
    },
    en: {
      greeting: "Hi there,",
      paragraphs: [
        `A user sent feedback on your ${p.supplierName} listing in the Weddly directory.`,
        `Report reason: ${humanReportReasonEn(p.reason)}`,
        "This is a first signal — nothing changes on the public side yet. If you know what could be tightened up (address, description, photos), reply to this email and we'll help you update.",
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
        "Innentől te szerkesztheted az adatokat — leírás, árak, képek, elérhetőség. A párok ugyanazt látják mint te a publikus katalógusban.",
        "Ha kérdés van vagy bármi nem stimmel, válaszolj erre az emailre — emberek olvassák.",
      ],
      cta: "Listing kezelése",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        `Done — ${p.listingName} is now linked to your Weddly vendor account.`,
        "From here on you can edit the listing yourself — description, pricing, photos, contact details. Couples browsing the directory will see exactly what you publish.",
        "Questions or anything off? Reply to this email — a human reads it.",
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
      `Ha bármi felmerül, közvetlenül erre az e-mail címre válaszolhatsz: ${p.coupleReplyEmail} — ${p.coupleReplyName}.`,
    ];
    const enParas: string[] = [
      `We're ${p.coupleDisplayName}, planning our wedding with Weddly, and reaching out about your services.`,
      ...bodyParas,
      `Reply directly to this email and it'll land in our inbox: ${p.coupleReplyEmail} — ${p.coupleReplyName}.`,
    ];
    return {
      subject: `${p.coupleDisplayName} — ${p.subject}`,
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
  return `${headHu} — ${tally}`;
}

function rsvpThanksDetailHu(p: RsvpThanksForGuestPayload): string {
  if (p.rsvpStatus === "yes") {
    return p.weddingDate
      ? `Találkozunk ${p.weddingDate}-n. Ha valami változna, a lenti gombbal bármikor módosíthatod.`
      : "Találkozunk! Ha valami változna, a lenti gombbal bármikor módosíthatod.";
  }
  if (p.rsvpStatus === "no") {
    return "Sajnáljuk, hogy nem tudsz jönni — köszönjük, hogy szóltál. Ha mégis változna, a lenti linken bármikor módosíthatod.";
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
    return "Sorry you can't make it — thanks for letting us know. The link below stays open if plans change.";
  }
  return "Thanks for letting us know. You can update your answer any time using the link below.";
}

// Splits the admin's free-text body on blank-line boundaries (`\n\s*\n`) into
// paragraph chunks the renderer can wrap in <p> tags. Single newlines inside
// a paragraph are preserved as a space — most admins type prose, not lists.
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.replace(/\s*\n\s*/g, " ").trim())
    .filter((chunk) => chunk.length > 0);
}

// UTM tagging on every CTA. Centralised here so future kinds inherit it
// without each builder having to remember. `utm_medium` mirrors the category
// (transactional / lifecycle / outreach) so analytics dashboards can segment
// without re-deriving from the campaign name. `utm_content=cta` reserves the
// `cta` slot for the primary button — secondary links (when we add them) can
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
