// Branded locale-aware email template. Email-client safe, table layout,
// inline styles, hex colors with web-safe fallbacks. Width capped at 560px so
// it reads well on mobile and in the Gmail/Outlook/Apple Mail preview pane.
//
// Rendering modes:
//   - `recipientLocale="hu"` / `"en"` → single card + footer in that language
//   - any other shipped UI locale → single card in that language IF the kind
//     supplied a block for it (`extra`), otherwise the EN card. Deliberately
//     NOT the bilingual stack: a Croatian reader has no more use for Hungarian
//     than for Finnish, and the stack exists for recipients whose language we
//     do not know, not for one we do.
//   - `recipientLocale=null/undefined` → bilingual fallback (HU primary on top,
//     EN secondary below). Used for guests + pre-feature users whose
//     `users.locale` was never captured.
//
// IMPORTANT: do not pull in CSS variables or media queries, most email
// clients strip <style> blocks. Keep everything inline.

import type { UiLocale } from "@shared/locales";
import { CONFIG } from "../../config";
import type { EmailCategory } from "./kinds";

export type { EmailCategory };
export type RecipientLocale = UiLocale | null;

/** The locales whose copy is supplied per-kind through `RenderInput.extra`.
 *  HU and EN are required on every kind and have their own top-level fields. */
export type ExtraLocale = Exclude<UiLocale, "hu" | "en">;

/** A per-kind replacement for the "why am I getting this" footer line. HU and
 *  EN are required for the same reason every card requires them; anything else
 *  is optional and falls back to EN, so a kind can override the line before it
 *  has been translated into every shipped language. */
export interface WhyLineOverride {
  hu: string;
  en: string;
  extra?: Partial<Record<ExtraLocale, string>>;
}

export interface LocaleBlock {
  /** Optional preheader (the gray inbox-preview text). Renders hidden in HTML. */
  preheader?: string;
  greeting: string;
  /** Body paragraphs. Each becomes a <p>. Plain text, escaped before render. */
  paragraphs: string[];
  cta: string;
  /** Copy that belongs after the primary action. Used when the action splits
   *  the letter rather than closing it (for example: register yourself, or
   *  forward this note to the person planning the wedding). */
  postCtaParagraphs?: string[];
  /** Optional letter-style closing, one rendered line per entry. */
  signoff?: string[];
  /** Omit the generic cold-email orientation and visible CTA URL when this
   *  language block already provides a complete introduction. */
  suppressOutreachChrome?: boolean;
  /** Omit the generic "why am I getting this" footer line when the body
   *  already carries the complete source/privacy explanation. */
  suppressFooterWhyLine?: boolean;
  /** Per-message wording for the support prompt in the footer. */
  footerHelpLabel?: string;
  /** Plain (non-italic) line rendered directly under the CTA button. Use for
   *  load-bearing info that's part of the action, link expiry, single-use
   *  warning, time-sensitive caveats. Reserves the `footnote` slot for truly
   *  tertiary reassurance ("if you didn't ask for this, ignore it"). */
  ctaSubtext?: string;
  /** Small italic note rendered after the secondary links + below the CTA
   *  block. Use for reassurance copy that's nice-to-have, not load-bearing. */
  footnote?: string;
  /** Low-stakes investigation links rendered as a row underneath the primary
   *  CTA. Gives a skeptical recipient (especially on outreach mail) a path
   *  to verify the sender without committing to the action. Only honoured
   *  on the primary card, secondary cards already have a link-style CTA. */
  secondaryLinks?: Array<{ label: string; url: string }>;
}

export interface RenderInput {
  hu: LocaleBlock;
  en: LocaleBlock;
  /** Where the CTA button points. */
  ctaUrl: string;
  /** When true, also render `ctaUrl` as a clickable copy-paste line under the
   *  button, regardless of category. For account-action mail (activation) so a
   *  vendor whose client mangles the button still has a plain link. Outreach
   *  mail shows this by category already, this forces it on for other kinds. */
  plainCtaUrl?: boolean;
  /** Affects the explanatory footer copy. */
  category: EmailCategory;
  /** Pick a single-language render when known. `null`/omitted falls back to
   *  the historical bilingual HU+EN layout, used for guests (we don't have
   *  per-guest locale yet) and users whose `users.locale` predates the
   *  feature. */
  recipientLocale?: RecipientLocale;
  /** Per-kind copy for the locales that shipped after the HU/EN split. Every
   *  kind supplies `hu` + `en`; this is where a kind ALSO carries Croatian,
   *  German or Spanish. Absent (or absent for the recipient's language) means
   *  they read the English card, which is why adding a language to one kind
   *  never touches the other ~90. */
  extra?: Partial<Record<ExtraLocale, LocaleBlock>>;
  /** Surface the named language on TOP of the bilingual stack. Only used
   *  when `recipientLocale` is null, when we don't know the recipient's
   *  language but DO know the submitter's, lead with the submitter's
   *  language and keep the other as a safety net below. */
  primaryLocaleHint?: "hu" | "en";
  /** When set, a 1×1 transparent tracking pixel is appended to the HTML body.
   *  Only used for guest_invite emails, see routes/email_track.ts. */
  trackingPixelUrl?: string;
  /** Replaces the per-category "why am I getting this" footer line. Exists for
   *  the one shape the category map can't describe: cold outreach to someone
   *  who DOES have an account, because we opened it for them
   *  (`planner_suggested_invite`). The stock outreach line claims they have no
   *  account, which the body of that mail contradicts on the first read. Use
   *  sparingly, the whole point of the category line is that it's uniform. */
  /** `extra` carries the same per-locale blocks the CARD does. Without it a
   *  Croatian or German recipient of an overridden kind got the English line
   *  under a fully translated body, which is the exact drift the per-locale
   *  footer tables were introduced to end. */
  whyLine?: WhyLineOverride;
}

export interface RenderedEmail {
  html: string;
  text: string;
  /** First paragraph of the HU block, used when subject is empty. */
  fallbackSubject: string;
}

// Soft-Modern palette, matches the landing page tokens. Hex literals here
// (not Tailwind tokens) because email clients can't reach Tailwind. Keep this
// list in sync with `frontend/tailwind.config.js` whenever the brand shifts.
// Light "specialty-coffee" palette, minimalist-precision structure (Stripe /
// Linear / Vercel discipline) in the warm umber/oat brand tones. A white card
// floats on a warm oat-paper canvas, lifted by a 1px warm border (no shadow —
// shadows render as grey boxes in Outlook). One chroma only: walnut, on links.
// The dark espresso button is the single high-contrast element. The logo PNG is
// a dark square with a white dove, so on the white card it reads as a dark
// rounded tile for free, no compositing needed.
const COLOR = {
  bg: "#f4efe7", // warm oat-paper canvas, the envelope the card sits on
  card: "#ffffff", // true white card, lifts cleanly off the oat field
  ink: "#1c1714", // warm near-black, headline + wordmark (never pure #000)
  muted: "#7a7065", // warm taupe, footer, asides, the "why am I getting this" line
  divider: "#ece7e0", // warm hairline rule
  accent: "#7c5a3e", // walnut, links + secondary CTAs (the only chroma in the email)
  accentInk: "#ffffff", // text that sits ON the dark button
  enInk: "#3d352e", // body ink, a shade softer than the near-black headline
  cta: "#1c1714", // dark espresso button fill (the requested dark button)
  cardBorder: "#eae4dc", // 1px warm card border, replaces the drop shadow
} as const;

// Social channels surfaced in the footer. Icons are 48×48 monochrome PNGs
// (muted #6e6863) served from the frontend's static `/email/` dir so they load
// in Gmail/Outlook/Apple Mail without inline SVG (which Gmail strips). Rendered
// at 24×24. `${CONFIG.frontendBaseUrl}` keeps dev/prod hosts in sync.
const SOCIAL: ReadonlyArray<{ name: string; href: string; icon: string }> = [
  { name: "Instagram", href: "https://www.instagram.com/tryweddly", icon: "instagram.png" },
  { name: "Facebook", href: "https://www.facebook.com/tryweddly", icon: "facebook.png" },
  { name: "TikTok", href: "https://www.tiktok.com/@tryweddly.com", icon: "tiktok.png" },
];

interface PickedBlock {
  locale: UiLocale;
  block: LocaleBlock;
}

/** Choose which language blocks render, in display order. `null` recipient
 *  locale → bilingual fallback. `primaryLocaleHint` orders the bilingual
 *  stack, when the caller knows what language the *submitter* uses (e.g.
 *  the couple-of-record's `users.locale` for a community-listing verify
 *  mail), surface that block on top. The opposite-language block still
 *  renders below as a safety net since the recipient's actual locale is
 *  unknown. HU-first remains the back-compat default. */
function pickBlocks(
  hu: LocaleBlock,
  en: LocaleBlock,
  locale: RecipientLocale,
  primaryLocaleHint?: "hu" | "en",
  extra?: Partial<Record<ExtraLocale, LocaleBlock>>,
): PickedBlock[] {
  if (locale === "hu") return [{ locale: "hu", block: hu }];
  if (locale === "en") return [{ locale: "en", block: en }];
  if (locale) {
    // A locale that shipped after the HU/EN split. Its own card when this kind
    // has been translated, English alone when it hasn't — never the bilingual
    // HU+EN stack, which would put Hungarian in front of a German reader.
    const block = extra?.[locale];
    return block ? [{ locale, block }] : [{ locale: "en", block: en }];
  }
  if (primaryLocaleHint === "en") {
    return [
      { locale: "en", block: en },
      { locale: "hu", block: hu },
    ];
  }
  return [
    { locale: "hu", block: hu },
    { locale: "en", block: en },
  ];
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const { hu, en, recipientLocale, primaryLocaleHint, extra } = input;
  const blocks = pickBlocks(hu, en, recipientLocale ?? null, primaryLocaleHint, extra);
  // Subject fallback follows the primary block, for an EN-only render, the
  // EN first paragraph stands in if the kind builder returned an empty
  // subject; for bilingual (null locale) we keep the historical HU fallback
  // so legacy callers see no behaviour change.
  const primary = blocks[0]?.block ?? hu;
  const fallbackSubject = primary.paragraphs[0] ?? primary.greeting;

  const text = renderText(input, blocks);
  const html = renderHtml(input, blocks);
  return { html, text, fallbackSubject };

  function renderText({ ctaUrl, category, whyLine }: RenderInput, blocks: PickedBlock[]): string {
    const lines: string[] = [];
    // Plain-text counterpart of the brand header. The macron char (U+0112) is
    // valid UTF-8 and renders fine in every modern text-mode client; the only
    // place it might fail is a 1990s telnet reader, which we don't target.
    lines.push("WĒDDLY");
    lines.push("");
    blocks.forEach(({ block }, i) => {
      if (i > 0) {
        lines.push("· · ·");
        lines.push("");
      }
      lines.push(block.greeting);
      lines.push("");
      for (const p of block.paragraphs) lines.push(paragraphToText(p));
      lines.push("");
      lines.push(`${block.cta}: ${ctaUrl}`);
      // Secondary links used to be HTML-only. For outreach mail one of them is
      // the opt-out, and a cold recipient reading in text mode has to be able
      // to act on it, so they belong in both renderings.
      if (block.secondaryLinks && block.secondaryLinks.length > 0) {
        lines.push("");
        for (const link of block.secondaryLinks) lines.push(`${link.label}: ${link.url}`);
      }
      if (block.postCtaParagraphs && block.postCtaParagraphs.length > 0) {
        lines.push("");
        block.postCtaParagraphs.forEach((p, index) => {
          if (index > 0) lines.push("");
          lines.push(paragraphToText(p));
        });
      }
      if (block.signoff && block.signoff.length > 0) {
        lines.push("");
        lines.push(...block.signoff);
      }
      if (block.footnote) {
        lines.push("");
        lines.push(block.footnote);
      }
      lines.push("");
    });
    lines.push(footerText(blocks, category, whyLine));
    return lines.join("\n");
  }

  function footerText(
    blocks: PickedBlock[],
    category: EmailCategory,
    whyOverride?: { hu: string; en: string },
  ): string {
    // null = the bilingual stack; otherwise the one language on the card.
    const single = blocks.length === 1 ? (blocks[0]?.locale ?? "en") : null;
    const primary = blocks[0]?.block;
    const out: string[] = ["---"];
    if (!primary?.suppressFooterWhyLine) {
      out.push(whyLineFor(category, single, whyOverride));
    }
    if (primary?.footerHelpLabel) {
      out.push(`${primary.footerHelpLabel} ${CONFIG.supportEmail}`);
    }
    if (primary?.suppressFooterWhyLine) {
      out.push(SOCIAL.map((s) => `${s.name}: ${s.href}`).join(" · "));
      out.push("Weddly · tryweddly.com");
    } else {
      out.push("Weddly · tryweddly.com");
      out.push(SOCIAL.map((s) => `${s.name}: ${s.href}`).join(" · "));
    }
    return out.join("\n");
  }

  function renderHtml(
    { ctaUrl, category, plainCtaUrl, trackingPixelUrl, whyLine }: RenderInput,
    blocks: PickedBlock[],
  ): string {
    const preheader = capPreheader(
      blocks[0]?.block.preheader ?? blocks[0]?.block.paragraphs[0] ?? "",
    );
    // First block always renders as the "primary" card (big bold greeting,
    // filled CTA button). Subsequent blocks render as "secondary" cards
    // (smaller, muted, link-style CTA, with the locale label above), this
    // is what historic bilingual rendering looked like, and we preserve it
    // for the back-compat null-locale path.
    const cards = blocks
      .map(({ locale, block }, i) =>
        renderCard(block, locale, i === 0, ctaUrl, category, plainCtaUrl ?? false),
      )
      .join(
        `<tr><td style="padding:18px 40px 0 40px;"><div style="border-top:1px solid ${COLOR.divider};font-size:0;line-height:0;height:1px;">&nbsp;</div></td></tr>`,
      );

    const footer = renderFooter(blocks, category, whyLine);
    // `<html lang>` follows the first block so screen-reader pronunciation
    // matches the language the body opens in.
    const htmlLang = blocks[0]?.locale ?? "hu";

    return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Hand-tuned light template. We pin "light" so Apple Mail + Outlook.com
         skip their dark-mode auto-invert (which muddies the warm oat canvas and
         drops contrast on the dark button). Every colour below is explicit, so
         clients that ignore these tags still render exactly as intended. -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Weddly</title>
    <style>
      /* General Sans, self-hosted at the Weddly CDN. Supported by Apple Mail,
         Outlook.com, Samsung Mail, and Thunderbird; Gmail web strips <style>
         entirely so the system-font stack in the inline font-family is the
         Gmail fallback. woff2 only: every client that honours @font-face also
         supports woff2. */
      @font-face {
        font-family: 'General Sans';
        font-style: normal;
        font-weight: 400;
        src: url('${CONFIG.frontendBaseUrl}/fonts/general-sans-400.woff2') format('woff2');
      }
      @font-face {
        font-family: 'General Sans';
        font-style: normal;
        font-weight: 500;
        src: url('${CONFIG.frontendBaseUrl}/fonts/general-sans-500.woff2') format('woff2');
      }
      @font-face {
        font-family: 'General Sans';
        font-style: normal;
        font-weight: 600;
        src: url('${CONFIG.frontendBaseUrl}/fonts/general-sans-600.woff2') format('woff2');
      }
      /* Mobile overrides, Apple Mail + Gmail iOS app respect <style>; Gmail
         web strips it, but the inline styles still apply as the fallback.
         Tighter inner padding gains ~24px of horizontal room on a 360–375px
         viewport; the larger CTA + 1.2 line-height gives a comfortable
         ≥50px tap target (the inline value is borderline 44px). */
      @media (max-width: 480px) {
        .wd-card { padding: 26px 24px 4px 24px !important; }
        .wd-h1 { font-size: 23px !important; line-height: 1.25 !important; }
        .wd-cta { padding: 15px 28px !important; font-size: 16px !important; line-height: 1.2 !important; }
        .wd-secondary { padding: 18px 24px 0 24px !important; }
        .wd-footer { padding: 22px 24px 26px 24px !important; }
        .wd-header { padding: 28px 24px 18px 24px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR.bg};font-family:'General Sans',-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;color:${COLOR.ink};">
    <!-- Preheader: shown in inbox preview, hidden in body -->
    <div style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.bg};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${COLOR.card};border:1px solid ${COLOR.cardBorder};border-radius:14px;">
            <!-- Brand header, top-left lockup. /email/logo.png is a dedicated
                 icon-only asset (dark square, white dove, no baked-in text) —
                 NOT the site-wide /logo.png, which now carries the full
                 wordmark lockup and would be illegible shrunk to 38px next to
                 the HTML wordmark span below. So on the white card it reads
                 as a dark rounded tile for free. A hairline rule separates
                 the masthead from the letter. Wordmark in General Sans (the
                 landing font). -->
            <tr>
              <td class="wd-header" align="left" style="padding:36px 40px 22px 40px;border-bottom:1px solid ${COLOR.divider};">
                <img src="${escapeAttr(`${CONFIG.frontendBaseUrl}/email/logo.png`)}" width="38" height="38" alt="Weddly" style="display:inline-block;vertical-align:middle;border:0;outline:none;width:38px;height:38px;border-radius:10px;" />
                <span style="display:inline-block;vertical-align:middle;margin-left:11px;font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:19px;font-weight:600;letter-spacing:0.24em;color:${COLOR.ink};">WĒDDLY</span>
              </td>
            </tr>
            ${cards}
            <!-- Footer -->
            <tr>
              <td class="wd-footer" style="padding:24px 40px 30px 40px;border-top:1px solid ${COLOR.divider};">
                ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${trackingPixelUrl ? `<img src="${escapeAttr(trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;overflow:hidden;" />` : ""}
  </body>
</html>`;
  }

  function renderCard(
    block: LocaleBlock,
    locale: UiLocale,
    primary: boolean,
    ctaUrl: string,
    category: EmailCategory,
    plainCtaUrl: boolean,
  ): string {
    if (primary) {
      const paras = block.paragraphs
        .map((p) =>
          renderRichParagraph(p, {
            paragraph: `margin:0 0 16px 0;color:${COLOR.enInk};font-size:16px;line-height:1.6;word-break:break-word;hyphens:auto;`,
            list: `margin:0 0 16px 0;padding-left:22px;color:${COLOR.enInk};font-size:16px;line-height:1.6;`,
            item: "margin:0 0 6px 0;",
          }),
        )
        .join("");
      const footnote = block.footnote
        ? `<p style="margin:18px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
        : "";
      const postCtaParagraphs = renderPostCtaParagraphs(block.postCtaParagraphs, false);
      const signoff = renderSignoff(block.signoff, false);
      // Left-aligned letter inside the white card: the greeting is a confident
      // General Sans headline, then body, then one dark espresso CTA, the
      // minimalist-precision "one statement, one action" rhythm. The dark
      // button is the single high-contrast element on the warm-white field.
      return `<tr>
              <td class="wd-card" align="left" style="padding:30px 40px 6px 40px;">
                <h1 class="wd-h1" style="margin:0 0 18px 0;color:${COLOR.ink};font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:27px;font-weight:600;line-height:1.24;letter-spacing:-0.015em;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(block.greeting)}
                </h1>
                ${block.suppressOutreachChrome ? "" : renderOutreachOrientation(category, locale)}
                ${paras}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0 0;">
                  <tr>
                    <td style="border-radius:10px;background-color:${COLOR.cta};">
                      <a href="${escapeAttr(ctaUrl)}" class="wd-cta"
                         style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:600;color:${COLOR.accentInk};text-decoration:none;border-radius:10px;letter-spacing:0.01em;line-height:1.2;">
                        ${escapeHtml(block.cta)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${renderCtaSubtext(block.ctaSubtext)}
                ${
                  block.suppressOutreachChrome
                    ? ""
                    : renderPlainUrlNote(ctaUrl, category, locale, plainCtaUrl)
                }
                ${renderSecondaryLinks(block.secondaryLinks)}
                ${postCtaParagraphs}
                ${signoff}
                ${footnote}
              </td>
            </tr>`;
    }
    // Secondary card, historic EN-below-HU bilingual fallback. The locale
    // label sits above the greeting so the reader knows what they're looking
    // at when the primary above was a different language. The `lang` attribute
    // on the wrapper td matters for screen readers: without it, VoiceOver
    // pronounces the secondary EN block with HU phonemes (and vice-versa)
    // because the outer <html lang> only covers the primary block.
    const langLabel = locale === "en" ? "English" : "Magyar";
    const paras = block.paragraphs
      .map((p) =>
        renderRichParagraph(p, {
          paragraph: `margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;word-break:break-word;hyphens:auto;`,
          list: `margin:0 0 12px 0;padding-left:20px;color:${COLOR.enInk};font-size:14px;line-height:1.55;`,
          item: "margin:0 0 4px 0;",
        }),
      )
      .join("");
    const footnote = block.footnote
      ? `<p style="margin:10px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
      : "";
    const postCtaParagraphs = renderPostCtaParagraphs(block.postCtaParagraphs, true);
    const signoff = renderSignoff(block.signoff, true);
    return `<tr>
              <td class="wd-secondary" lang="${locale}" style="padding:16px 40px 0 40px;">
                <p style="margin:0 0 12px 0;color:${COLOR.muted};font-size:12px;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;" aria-hidden="true">
                  ${langLabel}
                </p>
                <p style="margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;font-weight:600;line-height:1.4;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(block.greeting)}
                </p>
                ${paras}
                <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;">
                  <a href="${escapeAttr(ctaUrl)}" style="color:${COLOR.accent};text-decoration:underline;font-weight:600;">
                    ${escapeHtml(block.cta)} →
                  </a>
                </p>
                ${postCtaParagraphs}
                ${signoff}
                ${footnote}
              </td>
            </tr>`;
  }

  function renderFooter(
    blocks: PickedBlock[],
    category: EmailCategory,
    whyOverride?: { hu: string; en: string },
  ): string {
    const single = blocks.length === 1 ? (blocks[0]?.locale ?? "en") : null;
    const primary = blocks[0]?.block;
    const why = whyLineForHtml(category, single, whyOverride);
    // Footer body copy is bumped to 13px (from the previous 11/12px), that
    // was below the 14px legibility floor for the median wedding-vendor
    // demographic (40-55 y/o on a phone, presbyopic, no Dynamic Type for HTML
    // email). 13px is the standard floor where pixel-fitted hinting still
    // looks crisp without bumping copy density too far.
    // Bilingual help label so a HU vendor on a cold mail isn't left guessing
    // what "Questions?" means, and every single-language render stays clean.
    const helpLabel =
      primary?.footerHelpLabel ?? HELP_LABELS[single ?? "bilingual"] ?? HELP_LABELS.en!;
    return `
      ${primary?.suppressFooterWhyLine ? "" : `<p style="margin:0 0 6px 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">${why}</p>`}
      <p style="margin:${primary?.suppressFooterWhyLine ? "0" : "8px"} 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">
        ${helpLabel} <a href="mailto:${escapeAttr(CONFIG.supportEmail)}" style="color:${COLOR.muted};text-decoration:underline;">${escapeHtml(CONFIG.supportEmail)}</a>
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0 0;">
        <tr>
          ${SOCIAL.map(
            (s) => `<td style="padding-right:14px;">
            <a href="${escapeAttr(s.href)}" style="text-decoration:none;" aria-label="${escapeAttr(s.name)}">
              <img src="${escapeAttr(`${CONFIG.frontendBaseUrl}/email/${s.icon}`)}" width="24" height="24" alt="${escapeAttr(s.name)}" style="display:block;border:0;outline:none;width:24px;height:24px;" />
            </a>
          </td>`,
          ).join("")}
        </tr>
      </table>
      <p style="margin:16px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;letter-spacing:0.04em;">
        <span style="font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;letter-spacing:0.22em;color:${COLOR.enInk};">WĒDDLY</span> · <a href="${escapeAttr(CONFIG.frontendBaseUrl)}" style="color:${COLOR.muted};text-decoration:underline;">tryweddly.com</a>
      </p>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render a paragraph string with **bold** markers → <strong> in HTML.
 *  Segments outside markers are plain-escaped; segments inside get wrapped
 *  in a weight-600 <strong> so General Sans semibold renders correctly. */
function renderBold(s: string): string {
  return s
    .split(/\*\*(.+?)\*\*/)
    .map((chunk, i) =>
      i % 2 === 1
        ? `<strong style="font-weight:600;">${escapeHtml(chunk)}</strong>`
        : escapeHtml(chunk),
    )
    .join("");
}

/** Strip **bold** markers for the plain-text variant. */
function stripBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

/** Render one paragraph string into HTML, with support for an embedded bullet
 *  list: any run of lines beginning with `- ` becomes a `<ul>`, and the
 *  surrounding non-bullet lines render as normal `<p>`s. This lets a builder
 *  hand a lead line + bullets as a single paragraph
 *  (`"Missing:\n- photos\n- a bio"`) without the renderer needing a separate
 *  list field. Falls back to a plain `<p>` when there are no bullet lines. */
function renderRichParagraph(
  p: string,
  styles: { paragraph: string; list: string; item: string },
): string {
  const lines = p.split("\n");
  if (!lines.some((l) => /^\s*-\s+/.test(l))) {
    return `<p style="${styles.paragraph}">${renderBold(p)}</p>`;
  }
  const out: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      `<ul style="${styles.list}">${bullets
        .map((b) => `<li style="${styles.item}">${renderBold(b)}</li>`)
        .join("")}</ul>`,
    );
    bullets = [];
  };
  for (const line of lines) {
    const m = /^\s*-\s+(.*)$/.exec(line);
    if (m) {
      bullets.push(m[1] ?? "");
    } else {
      flush();
      if (line.trim().length > 0)
        out.push(`<p style="${styles.paragraph}">${renderBold(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

/** Plain-text form of a paragraph: strip bold, and turn `- item` bullet lines
 *  into `• item` so the text alternative reads as a list too. */
function paragraphToText(p: string): string {
  return p
    .split("\n")
    .map((line) => stripBold(line).replace(/^\s*-\s+/, "• "))
    .join("\n");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Load-bearing copy directly under the CTA, link expiry, single-use
// warnings. Same colour + size as the other shell text, no italics so the
// reader doesn't mistake it for an aside.
function renderCtaSubtext(text: string | undefined): string {
  if (!text) return "";
  return `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">${escapeHtml(text)}</p>`;
}

// Investigation-link row under the CTA. Used for outreach mail mostly —
// gives a skeptic an "is this real?" path without forcing them to click the
// action button. Walnut underline, 14px, no italics so it reads as a real
// link, not commentary.
function renderSecondaryLinks(links: Array<{ label: string; url: string }> | undefined): string {
  if (!links || links.length === 0) return "";
  const rows = links
    .map(
      (l) =>
        `<a href="${escapeAttr(l.url)}" style="color:${COLOR.accent};text-decoration:underline;font-weight:600;font-size:14px;line-height:1.5;display:inline-block;margin-right:18px;">${escapeHtml(l.label)} →</a>`,
    )
    .join("");
  return `<p style="margin:14px 0 0 0;">${rows}</p>`;
}

function renderPostCtaParagraphs(paragraphs: string[] | undefined, compact: boolean): string {
  if (!paragraphs || paragraphs.length === 0) return "";
  const style = compact
    ? `margin:12px 0 0 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;word-break:break-word;hyphens:auto;`
    : `margin:20px 0 0 0;color:${COLOR.enInk};font-size:16px;line-height:1.6;word-break:break-word;hyphens:auto;`;
  return paragraphs.map((p) => `<p style="${style}">${renderBold(p)}</p>`).join("");
}

function renderSignoff(lines: string[] | undefined, compact: boolean): string {
  if (!lines || lines.length === 0) return "";
  const style = compact
    ? `margin:16px 0 0 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;`
    : `margin:22px 0 0 0;color:${COLOR.enInk};font-size:16px;line-height:1.6;`;
  return `<p style="${style}">${lines.map(escapeHtml).join("<br />")}</p>`;
}

/** The one-line "what is Weddly" orientation on cold mail, and the copy-paste
 *  label under a forced plain URL. Both are chrome the kind builders never
 *  author, so they live here per locale with the usual EN fallback. */
const ORIENTATION: Partial<Record<UiLocale, string>> = {
  hu: "A Weddly egy esküvőtervező pároknak: vendéglista, ülésrend, költségvetés és RSVP egy helyen.",
  en: "Weddly is a wedding-planning app for couples, with guest lists, seating, budgets and RSVPs in one place.",
  es: "Weddly es una app de organización de bodas para parejas: invitados, mesas, presupuesto y confirmaciones en un solo sitio.",
  hr: "Weddly je alat za planiranje vjenčanja za parove: popis gostiju, raspored sjedenja, proračun i potvrde dolaska na jednom mjestu.",
  de: "Weddly ist eine App für die Hochzeitsplanung: Gästeliste, Sitzplan, Budget und Zusagen an einem Ort.",
};

const COPY_LINK_LABEL: Partial<Record<UiLocale, string>> = {
  hu: "Vagy másold be a böngészőbe:",
  en: "Or copy this link into your browser:",
  es: "O copia este enlace en tu navegador:",
  hr: "Ili zalijepite ovu poveznicu u preglednik:",
  de: "Oder kopieren Sie diesen Link in Ihren Browser:",
};

// Cold recipients don't necessarily know what Weddly is, the body dives
// straight into "someone added you to our directory" without context.
// Inject a one-line "what is Weddly" orientation between the greeting and
// the first paragraph so the recipient has an anchor before the action ask.
// Only renders for outreach category, transactional/lifecycle recipients
// already have an account and don't need the intro.
function renderOutreachOrientation(category: EmailCategory, locale: UiLocale): string {
  if (category !== "outreach") return "";
  const copy =
    ORIENTATION[locale] ??
    "Weddly is a wedding-planning app for couples, with guest lists, seating, budgets and RSVPs in one place.";
  return `<p style="margin:0 0 18px 0;color:${COLOR.muted};font-size:14px;line-height:1.5;font-style:italic;">${escapeHtml(copy)}</p>`;
}

// For unsolicited mail (outreach category), the CTA button hides its
// destination, a textbook phishing shape. Render the URL in plain text
// underneath so a skeptical recipient can verify the domain before clicking.
// Transactional + lifecycle mails (recipient has a Weddly account) skip this
//, the extra line is noise when there's no trust gap to bridge — UNLESS the
// builder forces it (`force`) for an account-action link (activation), where a
// copy-paste fallback matters if the button gets mangled. When forced, the URL
// is also clickable (the recipient asked for this account); the outreach
// variant stays a plain <span> so a skeptic reads the domain before clicking.
function renderPlainUrlNote(
  ctaUrl: string,
  category: EmailCategory,
  locale: UiLocale,
  force = false,
): string {
  if (category !== "outreach" && !force) return "";
  const label = COPY_LINK_LABEL[locale] ?? "Or copy this link into your browser:";
  const urlHtml = force
    ? `<a href="${escapeAttr(ctaUrl)}" style="color:${COLOR.accent};text-decoration:underline;">${escapeHtml(ctaUrl)}</a>`
    : `<span style="color:${COLOR.enInk};">${escapeHtml(ctaUrl)}</span>`;
  return `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;word-break:break-all;">
            ${escapeHtml(label)}<br />
            ${urlHtml}
          </p>`;
}

// Preheader is the gray "inbox preview" text. Gmail iOS truncates around 90
// chars and Apple Mail around 140; cap at 90 so the preview is consistent
// across clients and we never spill into the visible body (which leaks the
// preheader trick, looks broken). One-line cap, no ellipsis: clients add
// their own "…" when they truncate further.
function capPreheader(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 90) return trimmed;
  return `${trimmed.slice(0, 89).trimEnd()}…`;
}

// Per-category "why am I getting this email" copy. Outreach (cold mail to a
// recipient with no Weddly account) explicitly states the no-account stance —
// telling a vendor who's never heard of us that "this concerns your account"
// reads as phishing.
/** "Questions?" above the support address, per single-card locale, plus the
 *  bilingual form under the `bilingual` key. Same EN fallback as everything
 *  else in the footer. */
const HELP_LABELS: Partial<Record<UiLocale | "bilingual", string>> = {
  bilingual: "Kérdés? / Questions?",
  hu: "Kérdés?",
  en: "Questions?",
  es: "¿Preguntas?",
  hr: "Pitanja?",
  de: "Fragen?",
};

/** The "why am I getting this" line in the locales beyond HU/EN. Same fallback
 *  rule: a locale with no entry reads the English line. */
const WHY_LINE_EXTRA: Partial<Record<UiLocale, Record<EmailCategory, string>>> = {
  es: {
    lifecycle: "Recibes recordatorios ocasionales de Weddly porque tienes una cuenta con nosotros.",
    transactional: "Recibes este correo porque tiene que ver con tu cuenta de Weddly.",
    outreach:
      "Este es un mensaje de Weddly, una app de organización de bodas. Solo se crea una cuenta con tu aprobación.",
  },
  hr: {
    lifecycle: "Povremene podsjetnike od Weddlyja primate jer kod nas imate račun.",
    transactional: "Ovu poruku primate jer se tiče vašeg Weddly računa.",
    outreach:
      "Ovo je poruka Weddlyja, aplikacije za planiranje vjenčanja. Račun se otvara samo uz vaše odobrenje.",
  },
  de: {
    lifecycle:
      "Sie erhalten gelegentliche Erinnerungen von Weddly, weil Sie ein Konto bei uns haben.",
    transactional: "Sie erhalten diese E-Mail, weil sie Ihr Weddly-Konto betrifft.",
    outreach:
      "Dies ist eine Nachricht von Weddly, einer App für die Hochzeitsplanung. Ein Konto entsteht nur mit Ihrer Zustimmung.",
  },
};

const WHY_LINE_TEXT: Record<EmailCategory, { hu: string; en: string; bilingual: string }> = {
  lifecycle: {
    hu: "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk.",
    en: "You're getting occasional reminders from Weddly because you have an account with us.",
    bilingual:
      "Időnkénti emlékeztetőket kapsz a Weddly-től. / You're getting occasional reminders from Weddly.",
  },
  transactional: {
    hu: "Ezt a levelet a fiókoddal kapcsolatban kaptad.",
    en: "You're getting this because it's about your Weddly account.",
    bilingual:
      "Ezt a fiókoddal kapcsolatban kaptad. / You're getting this because it's about your Weddly account.",
  },
  outreach: {
    hu: "Bemutatkozó levél a Weddly esküvőtervezőtől. Fiók kizárólag a te jóváhagyásoddal jön létre.",
    en: "An introduction from Weddly, a wedding-planning app. An account is created only with your approval.",
    bilingual:
      "Bemutatkozó levél a Weddlytől; fiók csak a jóváhagyásoddal jön létre. / An introduction from Weddly; an account is created only with your approval.",
  },
};

// Same map, slightly longer HU copy for the HTML footer (the previous code
// had separate strings for text and html footers, keep that split here).
const WHY_LINE_HTML: Record<EmailCategory, { hu: string; en: string; bilingual: string }> = {
  lifecycle: {
    hu: "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk.",
    en: "You're receiving occasional reminders from Weddly because you have an account with us.",
    bilingual:
      "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk. / You're receiving occasional reminders from Weddly because you have an account with us.",
  },
  transactional: {
    hu: "Ezt a levelet a fiókoddal kapcsolatban kaptad.",
    en: "You got this email because it concerns your Weddly account.",
    bilingual:
      "Ezt a levelet a fiókoddal kapcsolatban kaptad. / You got this email because it concerns your Weddly account.",
  },
  outreach: {
    hu: "Bemutatkozó levél a Weddly esküvőtervezőtől. Fiók kizárólag a te jóváhagyásoddal jön létre.",
    en: "An introduction from Weddly, a wedding-planning app. An account is created only with your approval.",
    bilingual:
      "Bemutatkozó levél a Weddlytől; fiók csak a jóváhagyásoddal jön létre. / An introduction from Weddly; an account is created only with your approval.",
  },
};

/** Resolve the footer's "why am I getting this" line, honouring a per-kind
 *  override. An override has no separate bilingual string: the kinds that need
 *  one render single-language anyway, and stacking both languages is the
 *  fallback shape, so we join them the same way the category map does. */
function pickWhy(
  lines: { hu: string; en: string; bilingual: string },
  category: EmailCategory,
  single: UiLocale | null,
  override?: WhyLineOverride,
): string {
  // An override replaces the CATEGORY line, so a locale it did not translate
  // must fall back to the override's own English rather than to the category
  // line: the override exists precisely because that line was wrong here.
  if (override) {
    if (single === null) return `${override.hu} / ${override.en}`;
    if (single === "hu") return override.hu;
    if (single === "en") return override.en;
    // Same fallback shape as the card: this locale's line when the kind wrote
    // one, English otherwise, never Hungarian.
    return override.extra?.[single] ?? override.en;
  }
  if (single === null) return lines.bilingual;
  if (single === "hu") return lines.hu;
  return WHY_LINE_EXTRA[single]?.[category] ?? lines.en;
}

function whyLineFor(
  category: EmailCategory,
  single: UiLocale | null,
  override?: WhyLineOverride,
): string {
  return pickWhy(WHY_LINE_TEXT[category], category, single, override);
}

function whyLineForHtml(
  category: EmailCategory,
  single: UiLocale | null,
  override?: WhyLineOverride,
): string {
  return pickWhy(WHY_LINE_HTML[category], category, single, override);
}
