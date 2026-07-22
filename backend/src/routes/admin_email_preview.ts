// Admin-only email template preview. Renders every template kind with
// realistic stub data so the admin can inspect HTML output without sending
// a real email or creating fixture data.
//
// GET /api/admin/email-preview           → { kinds: { kind, category, subject }[] }
// GET /api/admin/email-preview/:kind     → { html, subject }
// GET /api/admin/email-preview/:kind?locale=en|hu  → single-locale render

import { requireAdmin } from "../domain/users";
import { buildEmail, type KindPayload } from "../domain/emails/templates";
import { type EmailKind, KIND_CATEGORY } from "../domain/emails/kinds";
import { type Ctx, HttpError, json, type Router } from "../lib/http";

// ─── Stub payloads ────────────────────────────────────────────────────────────
// One per kind. Data is intentionally illustrative ("Mia & Lucas", etc.) so
// the rendered output reads like a real email rather than "[name]" slots.

const BASE_URL = "https://tryweddly.com";

const STUBS: KindPayload = {
  welcome_verify: { verifyUrl: `${BASE_URL}/verify?token=preview-token` },
  verify_resend: { verifyUrl: `${BASE_URL}/verify?token=preview-token` },
  password_reset: { resetUrl: `${BASE_URL}/reset-password?token=preview-token` },
  password_changed: {
    forgotUrl: `${BASE_URL}/forgot-password`,
    changedAt: "2026-06-14 10:30",
  },
  new_device_signin: {
    signedInAt: "2026-06-14 10:30",
    forgotUrl: `${BASE_URL}/forgot-password`,
  },
  email_change_verify: {
    confirmUrl: `${BASE_URL}/change-email/preview-token`,
    oldEmail: "mia.old@example.com",
  },
  email_change_warning: {
    newEmail: "mia.new@example.com",
    forgotUrl: `${BASE_URL}/forgot-password`,
  },
  partner_invite: {
    inviterName: "Mia",
    inviteUrl: `${BASE_URL}/invite/preview-token`,
    coupleDisplayName: "Mia & Lucas",
  },
  partner_invite_accepted: {
    partnerName: "Lucas",
    coupleDisplayName: "Mia & Lucas",
    dashboardUrl: `${BASE_URL}/app`,
  },
  partner_invite_declined: {
    invitedEmail: "lucas@example.com",
    reinviteUrl: `${BASE_URL}/app/profile`,
  },
  partner_invite_reminder: {
    invitePartnerUrl: `${BASE_URL}/app#invite-partner`,
    coupleDisplayName: "Mia & Lucas",
  },
  // variant 0 of 3 — the preview always renders the first send of the series.
  founding_partner_push: {
    invitePartnerUrl: `${BASE_URL}/app#invite-partner`,
    inviteUrl: `${BASE_URL}/invite/preview-token`,
    shareMailtoUrl: "mailto:?subject=Join%20our%20wedding%20planner",
    spotsLeft: 47,
    coupleDisplayName: "Mia & Lucas",
    variant: 0,
  },
  partner_left_workspace: {
    partnerName: "Lucas",
    coupleDisplayName: "Mia & Lucas",
    reinviteUrl: `${BASE_URL}/app/profile`,
  },
  couple_paused: {
    requestedByName: "Mia",
    scheduledDeleteDate: "2026-07-14",
    cancelUrl: `${BASE_URL}/app/profile`,
  },
  couple_pause_cancelled: {
    cancelledByName: "Lucas",
    dashboardUrl: `${BASE_URL}/app`,
  },
  account_purged: { coupleDisplayName: "Mia & Lucas" },
  account_admin_purged: { coupleDisplayName: "Mia & Lucas" },
  account_flagged: {
    reason: "Suspicious activity — multiple accounts from same IP.",
    deadlineDateHu: "2026-06-21",
    deadlineDateEn: "June 21, 2026",
  },
  account_flag_cleared: { note: "User responded — concern addressed." },
  free_access_granted: { workspaceName: "Mia & Lucas" },
  rsvp_received_for_couple: {
    guestName: "Anna Kovács",
    rsvpStatus: "yes",
    guestPageUrl: `${BASE_URL}/app/guests`,
    progress: { total: 80, responded: 52, pct: 65 },
  },
  rsvp_received_household_for_couple: {
    householdLabel: "Kovács Anna & Kovács Béla",
    guests: [
      { name: "Kovács Anna", rsvpStatus: "yes" },
      { name: "Kovács Béla", rsvpStatus: "yes" },
    ],
    guestPageUrl: `${BASE_URL}/app/guests`,
    progress: { total: 80, responded: 54, pct: 68 },
  },
  rsvp_thanks_for_guest: {
    coupleDisplayName: "Mia & Lucas",
    weddingDate: "2026-09-12",
    rsvpStatus: "yes",
    rsvpPageUrl: `${BASE_URL}/rsvp/preview-code`,
  },
  guest_invite: {
    coupleDisplayName: "Mia & Lucas",
    guestName: "Anna Kovács",
    weddingDate: "2026-09-12",
    rsvpUrl: `${BASE_URL}/rsvp/preview-code`,
  },
  guest_major_update: {
    coupleDisplayName: "Mia & Lucas",
    guestName: "Anna Kovács",
    weddingDate: "2026-09-12",
    infoUrl: `${BASE_URL}/w/mia-lucas/preview-code`,
    subject: null,
    bodyParagraphs: ["A ceremónia helyszíne megváltozott, kérjük olvasd el a részleteket."],
  },
  guest_pre_wedding_info: {
    coupleDisplayName: "Mia & Lucas",
    guestName: "Anna Kovács",
    weddingDate: "2026-09-12",
    infoUrl: `${BASE_URL}/w/mia-lucas/preview-code`,
    subject: null,
    bodyParagraphs: ["Parkolás a helyszín mögött, a ceremónia 16:00-kor kezdődik."],
    envelopeTip:
      "Tipp a Weddlytől: egy vendég nálunk nagyjából 25 000 Ft. Jó kiindulópont a borítékba.",
  },
  onboarding_nudge: { onboardingUrl: `${BASE_URL}/onboarding` },
  onboarding_nudge_week: { onboardingUrl: `${BASE_URL}/onboarding` },
  honeymoon_nudge: {
    honeymoonUrl: `${BASE_URL}/app/honeymoon`,
    daysUntil: 62,
    coupleDisplayName: "Mia & Lucas",
  },
  milestone_t90: {
    coupleDisplayName: "Mia & Lucas",
    weddingDate: "2026-09-12",
    dashboardUrl: `${BASE_URL}/app`,
  },
  milestone_t30: {
    coupleDisplayName: "Mia & Lucas",
    weddingDate: "2026-09-12",
    dashboardUrl: `${BASE_URL}/app`,
  },
  milestone_t7: {
    coupleDisplayName: "Mia & Lucas",
    weddingDate: "2026-09-12",
    dashboardUrl: `${BASE_URL}/app`,
  },
  timeline_escalation: {
    coupleDisplayName: "Mia & Lucas",
    overdueCount: 3,
    dueSoonCount: 2,
    sampleTitles: ["Book photographer", "Send invites", "Confirm venue"],
    timelineUrl: `${BASE_URL}/app/timeline`,
  },
  wedding_today: { coupleDisplayName: "Mia & Lucas" },
  wedding_today_followup: {
    coupleDisplayName: "Mia & Lucas",
    feedbackUrl: `${BASE_URL}/app?feedback=1`,
  },
  wedding_date_changed: {
    coupleDisplayName: "Mia & Lucas",
    previousWeddingDate: "2026-09-12",
    newWeddingDate: "2026-10-03",
    rsvpPageUrl: `${BASE_URL}/rsvp/preview-code`,
  },
  rsvp_deadline_approaching: {
    coupleDisplayName: "Mia & Lucas",
    weddingDate: "2026-09-12",
    pendingCount: 12,
    guestsUrl: `${BASE_URL}/app/guests`,
  },
  rsvp_followup_missing_meal: {
    coupleDisplayName: "Mia & Lucas",
    rsvpPageUrl: `${BASE_URL}/rsvp/preview-code`,
  },
  admin_moderation_digest: {
    awaitingReviewSuppliers: 4,
    newVendorWaitlistEntries: 7,
    pendingListingClaims: 2,
    unresolvedUserFlags: 1,
    adminUrl: `${BASE_URL}/app/admin/suppliers`,
    newCouplesThisWeek: 11,
    newCouplesLastWeek: 8,
    newUsersThisWeek: 14,
    newUsersLastWeek: 12,
  },
  rsvp_weekly_digest_for_couple: {
    coupleDisplayName: "Mia & Lucas",
    yesCount: 8,
    noCount: 2,
    maybeCount: 1,
    guestsUrl: `${BASE_URL}/app/guests`,
  },
  vendor_waitlist_received: {
    businessName: "Bloom Studio",
    categoryLabel: "Decor & floral",
    location: "Budapest, Hungary",
    landingUrl: BASE_URL,
  },
  vendor_waitlist_decision: {
    subject: "Your Weddly vendor application",
    body: "Thank you for your patience. We've reviewed your submission and would love to have you on board.\n\nWe'll be in touch within the next few weeks with next steps.",
    outcome: "accepted",
  },
  vendor_activation: {
    businessName: "Bloom Studio",
    activateUrl: `${BASE_URL}/vendor/activate/preview-token`,
    introMessage:
      'Szia Bloom Studio!\n\nKöszönjük, hogy jelentkeztetek a Wēddly szolgáltatói várólistájára. A csapatunk személyesen átnézte a profilotokat, és szeretnénk szerepeltetni titeket a pároknak ajánlott szolgáltatók között.\n\n**A következő lépés: aktiváljátok a fiókotokat a lenti „Fiók aktiválása" gombbal** (nincs szükség bankkártyára).\n\nÜdv,\nA Wēddly csapata',
    subject: "Wēddly: szívesen látnánk titeket a katalógusban",
  },
  vendor_profile_share: {
    businessName: "Bloom Studio",
    shareUrl: `${BASE_URL}/vendors/v11`,
    editUrl: `${BASE_URL}/vendor/listing`,
    reviewsUrl: `${BASE_URL}/vendor/reviews`,
    missing: { photos: true, bio: false, calendar: true, packages: true },
  },
  vendor_profile_incomplete: {
    businessName: "Bloom Studio",
    editUrl: `${BASE_URL}/vendor/listing`,
    missing: { photos: true, bio: true, pricing: false, packages: true, availability: false },
    variant: 0,
  },
  planner_profile_incomplete: {
    fullName: "Rita Kruczli",
    businessName: null,
    editUrl: `${BASE_URL}/app/planner/settings/account`,
    missing: { businessName: true, city: true, bio: true, styles: false },
  },
  planner_waitlist_decision: {
    subject: "Wēddly: jóváhagytuk a szervezői hozzáférésed",
    body: "Szia Anna!\n\nÁtnéztük a profilodat, és aktiváltuk a szervezői hozzáférésed. Lépj be, és a szervezői vezérlőpultból indítsd el az onboardingot.\n\nÜdv,\nA Wēddly csapata",
    outcome: "accepted",
  },
  planner_provisioned: {
    plannerName: "Anna",
    businessName: "Anna Weddings",
    category: "esküvőszervező",
    activateUrl: `${BASE_URL}/planner/activate/preview-token`,
    freeUntilHu: "2028. július 3.",
    freeUntilEn: "3 July 2028",
  },
  planner_onboarding_invite: {
    plannerName: "Anna",
    businessName: "Anna Weddings",
    activateUrl: `${BASE_URL}/planner/activate/preview-token`,
    freeUntilHu: "2028. július 3.",
    freeUntilEn: "3 July 2028",
  },
  community_supplier_verify: {
    supplierName: "Bloom Studio",
    verifyUrl: `${BASE_URL}/supplier/verify?token=preview`,
  },
  community_supplier_published: {
    supplierName: "Bloom Studio",
    listingUrl: `${BASE_URL}/vendors/bloom-studio`,
  },
  community_supplier_rejected: {
    supplierName: "Bloom Studio",
    reason: "Duplicate listing already exists in our directory.",
  },
  community_supplier_reported: {
    supplierName: "Bloom Studio",
    reason: "wrong_info",
  },
  vendor_claim_campaign: {
    listingName: "Bloom Studio",
    categoryLabel: "Fotó",
    city: "Budapest",
    inviteUrl: `${BASE_URL}/r/vendor-invite/preview`,
    optOutUrl: `${BASE_URL}/email-optout/preview`,
    monthlyVisitors: 3000,
    freeMonths: 12,
    locale: "hu",
  },
  vendor_claim_campaign_reminder: {
    listingName: "Bloom Studio",
    categoryLabel: "Fotó",
    city: "Budapest",
    inviteUrl: `${BASE_URL}/r/vendor-invite/preview`,
    optOutUrl: `${BASE_URL}/email-optout/preview`,
    monthlyVisitors: 3000,
    freeMonths: 3,
    locale: "hu",
  },
  vendor_review_campaign: {
    businessName: "Bloom Studio",
    reviewUrl: `${BASE_URL}/vendors/bloom-studio-v12`,
    shareUrl: `${BASE_URL}/vendors/bloom-studio-v12?review=1`,
    ctaUrl: `${BASE_URL}/r/vendor-review/preview`,
    whatsappUrl: "https://wa.me/?text=preview",
    mailtoUrl: "mailto:?subject=preview",
    dashboardUrl: `${BASE_URL}/vendor/reviews`,
    locale: "hu",
  },
  vendor_review_campaign_reminder: {
    businessName: "Bloom Studio",
    reviewUrl: `${BASE_URL}/vendors/bloom-studio-v12`,
    shareUrl: `${BASE_URL}/vendors/bloom-studio-v12?review=1`,
    ctaUrl: `${BASE_URL}/r/vendor-review/preview`,
    whatsappUrl: "https://wa.me/?text=preview",
    mailtoUrl: "mailto:?subject=preview",
    dashboardUrl: `${BASE_URL}/vendor/reviews`,
    locale: "en",
  },
  vendor_claim_verify: {
    listingName: "Bloom Studio",
    verifyUrl: `${BASE_URL}/vendor/claim?token=preview`,
  },
  vendor_claim_admin_alert: {
    listingName: "Bloom Studio",
    listingId: "bloom-studio",
    claimantEmail: "owner@bloomstudio.com",
    contactEmailMasked: "c***@bloomstudio.com",
    adminUrl: `${BASE_URL}/app/admin/suppliers`,
  },
  vendor_claim_approved: {
    listingName: "Bloom Studio",
    managerUrl: `${BASE_URL}/vendor`,
  },
  supplier_outreach: {
    coupleDisplayName: "Mia & Lucas",
    coupleReplyEmail: "mia@example.com",
    coupleReplyName: "Mia Johnson",
    supplierName: "Bloom Studio",
    subject: "Florals for our September wedding",
    body: "Hi, we came across your portfolio and love your work.\n\nWe're planning a 80-person garden wedding on September 12, 2026 and are looking for a florist for ceremony + reception. Would you be available, and could you share your packages?",
    outreachUrl: `${BASE_URL}/app/outreach`,
  },
  planner_access_requested: {
    plannerLabel: "Eventful Studio",
    replyToEmail: "hello@eventful.studio",
  },
  planner_message: {
    subject: "Venue walkthrough next week",
    bodyText:
      "Hi both,\n\nGreat news — the venue confirmed Tuesday at 3pm for the walkthrough.\nLet me know if that still works for you.\n\nBest,\nAnna",
    senderName: "Anna Nagy",
    senderEmail: "anna@eventful.studio",
  },
  planner_access_approved: { coupleName: "Mia & Lucas" },
  planner_client_invite: {
    coupleName: "Mia & Lucas",
    replyToEmail: "mia@example.com",
  },
  planner_email_invite: {
    plannerLabel: "Eventful Studio",
    inviteUrl: "https://tryweddly.com/signup?planner_invite=sample-token",
    replyToEmail: "hello@eventful.studio",
  },
  planner_waitlist_received: {
    plannerName: "Anna",
    hasAccount: false,
  },
  planner_access_invite: {
    plannerName: "Anna",
    hasAccount: true,
  },
  planner_invite_outcome: {
    plannerLabel: "Eventful Studio",
    accepted: true,
    replyToEmail: "hello@eventful.studio",
  },
  newsletter_confirm: {
    confirmUrl: `${BASE_URL}/newsletter/confirm/preview-token`,
  },
  visitor_verify: {
    verifyUrl: `${BASE_URL}/visitor/verify/preview-token`,
  },
  admin_feedback_reply: {
    replyText:
      "Köszönjük a visszajelzést! Az asztalok elrendezését a „Terem” elrendezés alatt tudod módosítani, az „Ültetés” pedig a vendégek asztalokhoz rendelésére való.\n\nHa bármi elakad, írj bátran.",
    originalMessage: "Az ülésrendnél nem találom, hogyan lehet a székeket módosítani.",
  },
};

const ALL_KINDS = Object.keys(KIND_CATEGORY) as EmailKind[];

function previewAll() {
  return ALL_KINDS.map((kind) => {
    const category = KIND_CATEGORY[kind];
    const stub = STUBS[kind] as never;
    let subject: string = kind;
    try {
      const built = buildEmail(kind, stub, { recipientName: "Mia" });
      subject = built.subject;
    } catch {
      // subject stays as the kind slug if build fails
    }
    return { kind, category, subject };
  });
}

export function registerAdminEmailPreviewRoutes(router: Router) {
  router.get("/api/admin/email-preview", (ctx: Ctx) => {
    requireAdmin(ctx);
    return json({ kinds: previewAll() });
  });

  router.get("/api/admin/email-preview/:kind", (ctx: Ctx) => {
    requireAdmin(ctx);
    const kind = ctx.params.kind as EmailKind;
    if (!(kind in KIND_CATEGORY)) throw new HttpError(404, "Unknown email kind");

    const locale = ctx.url.searchParams.get("locale") as "hu" | "en" | null;
    const stub = STUBS[kind] as never;
    const built = buildEmail(kind, stub, {
      recipientName: "Mia",
      recipientLocale: locale ?? undefined,
    });

    return json({ html: built.rendered.html, subject: built.subject });
  });
}
