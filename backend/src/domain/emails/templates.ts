// Per-kind email copy. The dispatcher (`send.ts`) calls one of these to
// produce the rendered HTML/text + the subject line. Keep the copy here so
// translators can find every string in one place; long-form content stays
// out of the dispatcher's plumbing code.

import { CONFIG } from "../../config";
import { type EmailKind, KIND_CATEGORY } from "./kinds";
import { type LocaleBlock, type RenderedEmail, renderEmail } from "./template";

export interface BuildContext {
  /** Recipient's display name for the greeting. Falls back to "" if unknown. */
  recipientName: string;
  /** Used by the unsubscribe footer link (only rendered for lifecycle mail). */
  unsubscribeToken?: string;
}

export interface BuiltEmail {
  subject: string;
  rendered: RenderedEmail;
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
export interface CouplePausedPayload {
  /** Display name of the partner who clicked Pause. */
  requestedByName: string;
  /** Pre-formatted, locale-friendly date when the workspace will purge. */
  scheduledDeleteDate: string;
  /** Page where either partner can cancel the pause. */
  cancelUrl: string;
}
export interface AccountPurgedPayload {
  /** Display name the workspace had at purge time ("Anna & Bence"). */
  coupleDisplayName: string;
}
export interface RsvpReceivedForCouplePayload {
  guestName: string;
  rsvpStatus: "yes" | "no" | "maybe";
  guestPageUrl: string;
}
export interface RsvpThanksForGuestPayload {
  coupleDisplayName: string;
  weddingDate: string | null;
  rsvpStatus: "yes" | "no" | "maybe";
  rsvpPageUrl: string;
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

export interface VendorWaitlistReceivedPayload {
  /** What the vendor typed for their business — used to humanise the body. */
  businessName: string;
  /** Localised category label (already resolved). E.g. "Virágdekoráció" /
   *  "Decor & floral". The route picks the right side based on the email
   *  language; we'll fall back to the slug if neither was provided. */
  categoryLabel: string;
  /** Where they can read more about Weddly while they wait. */
  landingUrl: string;
}

export type KindPayload = {
  welcome_verify: WelcomeVerifyPayload;
  verify_resend: VerifyResendPayload;
  password_reset: PasswordResetPayload;
  password_changed: PasswordChangedPayload;
  email_change_verify: EmailChangeVerifyPayload;
  email_change_warning: EmailChangeWarningPayload;
  partner_invite: PartnerInvitePayload;
  couple_paused: CouplePausedPayload;
  account_purged: AccountPurgedPayload;
  rsvp_received_for_couple: RsvpReceivedForCouplePayload;
  rsvp_thanks_for_guest: RsvpThanksForGuestPayload;
  onboarding_nudge: OnboardingNudgePayload;
  milestone_t90: MilestonePayload;
  milestone_t30: MilestonePayload;
  milestone_t7: MilestonePayload;
  wedding_today: WeddingTodayPayload;
  wedding_date_changed: WeddingDateChangedPayload;
  vendor_waitlist_received: VendorWaitlistReceivedPayload;
};

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildEmail<K extends EmailKind>(
  kind: K,
  payload: KindPayload[K],
  context: BuildContext,
): BuiltEmail {
  const built = BUILDERS[kind](payload as never, context);
  const category = KIND_CATEGORY[kind];
  const rendered = renderEmail({
    hu: built.hu,
    en: built.en,
    ctaUrl: built.ctaUrl,
    category,
    unsubscribeToken: context.unsubscribeToken,
  });
  return { subject: built.subject, rendered };
}

interface RawTemplate {
  subject: string;
  hu: LocaleBlock;
  en: LocaleBlock;
  ctaUrl: string;
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
      footnote: "A link 7 napig érvényes. Akkor is bejelentkezhetsz, ha most még nem kattintasz.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Welcome to Weddly — we're glad you're here.",
        "Everything you need for a calm wedding-planning process is in one place: guest list, seating plan, budget, RSVP, printable stationery.",
        "One quick thing: please confirm your email so you can recover your account if you ever lose your password.",
      ],
      cta: "Confirm your email",
      footnote: "The link is valid for 7 days. You can keep using Weddly while you wait.",
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
      footnote: "A link 7 napig érvényes.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "Here's a fresh email-verification link.",
        "If you didn't ask for this, you can safely ignore it.",
      ],
      cta: "Confirm your email",
      footnote: "Valid for seven days.",
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
      footnote:
        "Egyszer használható link. Ha lejárna, indítsd újra a folyamatot a bejelentkezésnél.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || "there"},`,
      paragraphs: [
        "You asked to reset your Weddly password. For your security this link is valid for 1 hour.",
        "If you didn't request this, you can ignore the email — your account is still safe.",
      ],
      cta: "Set a new password",
      footnote: "Single-use link. Restart from the login page if it expires.",
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
        footnote:
          "A link 7 napig érvényes. Ha véletlenül kaptad, hagyd figyelmen kívül — semmi sem fog történni.",
      },
      en: {
        greeting: "Hello,",
        paragraphs: [
          `${p.inviterName} started planning your wedding on Weddly and invited you to join.${coupleSuffixEn}`,
          'One shared workspace covers guest list, seating chart, budget, RSVP links, printable place cards and table plans — in real-time sync. No more spreadsheet ping-pong or "which version was the latest?".',
          "Free during the open beta, no vendor lock-in — your data stays yours.",
        ],
        cta: "Join the workspace",
        footnote: "Link valid for 7 days. Got this by mistake? Ignore it — nothing happens.",
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

  vendor_waitlist_received: (p, ctx) => ({
    subject: "Várólistára kerültél / You're on the Weddly vendor waitlist",
    ctaUrl: p.landingUrl,
    hu: {
      preheader: "Megkaptuk a jelentkezést — várólistán vagytok.",
      greeting: `Szia ${ctx.recipientName || p.businessName || ""}!`.trim(),
      paragraphs: [
        `Megkaptuk a(z) ${p.businessName} jelentkezését a Wēddly szolgáltatói várólistájára (${p.categoryLabel}).`,
        "Még nem nyitottunk a szolgáltatóknak — egy szűk kategóriánkénti listát építünk, hogy a párok ne 200 szolgáltatóból válogassanak, hanem azokból, akik tényleg passzolnak hozzájuk. Amint nyitunk, e-mailben jelentkezünk.",
        "Addig is, ha van bármi kérdés vagy szeretnétek többet mesélni magatokról, válaszoljatok erre a levélre — emberek olvassák.",
      ],
      cta: "Wēddly megnyitása",
      footnote: "Csak akkor írunk, amikor van új a várólistáddal.",
    },
    en: {
      greeting: `Hi ${ctx.recipientName || p.businessName || "there"},`,
      paragraphs: [
        `We've received ${p.businessName}'s submission to the Weddly vendor waitlist (${p.categoryLabel}).`,
        "We aren't onboarding suppliers yet — we're building a tight, per-category list so couples don't wade through 200 vendors but see the ones who actually fit. We'll email you the moment we open to applications in your category.",
        "If you'd like to share more or have any questions in the meantime, just reply to this email — a real person reads it.",
      ],
      cta: "Open Weddly",
      footnote: "We'll only email when there's an update for your waitlist entry.",
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
