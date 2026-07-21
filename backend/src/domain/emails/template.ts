// Branded locale-aware email template. Email-client safe, table layout,
// inline styles, hex colors with web-safe fallbacks. Width capped at 560px so
// it reads well on mobile and in the Gmail/Outlook/Apple Mail preview pane.
//
// Rendering modes:
//   - `recipientLocale="hu"` → single HU card, HU footer
//   - `recipientLocale="en"` → single EN card, EN footer
//   - `recipientLocale=null/undefined` → bilingual fallback (HU primary on top,
//     EN secondary below). Used for guests + pre-feature users whose
//     `users.locale` was never captured.
//
// IMPORTANT: do not pull in CSS variables or media queries, most email
// clients strip <style> blocks. Keep everything inline.

import { CONFIG } from "../../config";
import type { EmailCategory } from "./kinds";

export type { EmailCategory };
export type RecipientLocale = "hu" | "en" | null;

export interface LocaleBlock {
  /** Optional preheader (the gray inbox-preview text). Renders hidden in HTML. */
  preheader?: string;
  greeting: string;
  /** Body paragraphs. Each becomes a <p>. Plain text, escaped before render. */
  paragraphs: string[];
  cta: string;
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
  /** Affects footer copy + whether unsubscribe link shows. */
  category: EmailCategory;
  /** When category=lifecycle, this is appended as ?token=… so the link is
   *  one-click. The route is /unsubscribe/:token on the frontend. */
  unsubscribeToken?: string;
  /** Pick a single-language render when known. `null`/omitted falls back to
   *  the historical bilingual HU+EN layout, used for guests (we don't have
   *  per-guest locale yet) and users whose `users.locale` predates the
   *  feature. */
  recipientLocale?: RecipientLocale;
  /** Surface the named language on TOP of the bilingual stack. Only used
   *  when `recipientLocale` is null, when we don't know the recipient's
   *  language but DO know the submitter's, lead with the submitter's
   *  language and keep the other as a safety net below. */
  primaryLocaleHint?: "hu" | "en";
  /** When set, a 1×1 transparent tracking pixel is appended to the HTML body.
   *  Only used for guest_invite emails, see routes/email_track.ts. */
  trackingPixelUrl?: string;
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
  locale: "hu" | "en";
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
): PickedBlock[] {
  if (locale === "hu") return [{ locale: "hu", block: hu }];
  if (locale === "en") return [{ locale: "en", block: en }];
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
  const { hu, en, recipientLocale, primaryLocaleHint } = input;
  const blocks = pickBlocks(hu, en, recipientLocale ?? null, primaryLocaleHint);
  // Subject fallback follows the primary block, for an EN-only render, the
  // EN first paragraph stands in if the kind builder returned an empty
  // subject; for bilingual (null locale) we keep the historical HU fallback
  // so legacy callers see no behaviour change.
  const primary = blocks[0]?.block ?? hu;
  const fallbackSubject = primary.paragraphs[0] ?? primary.greeting;

  const text = renderText(input, blocks);
  const html = renderHtml(input, blocks);
  return { html, text, fallbackSubject };

  function renderText(
    { ctaUrl, category, unsubscribeToken }: RenderInput,
    blocks: PickedBlock[],
  ): string {
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
      for (const p of block.paragraphs) lines.push(stripBold(p));
      lines.push("");
      lines.push(`${block.cta}: ${ctaUrl}`);
      // Secondary links used to be HTML-only. For outreach mail one of them is
      // the opt-out, and a cold recipient reading in text mode has to be able
      // to act on it, so they belong in both renderings.
      if (block.secondaryLinks && block.secondaryLinks.length > 0) {
        lines.push("");
        for (const link of block.secondaryLinks) lines.push(`${link.label}: ${link.url}`);
      }
      if (block.footnote) {
        lines.push("");
        lines.push(block.footnote);
      }
      lines.push("");
    });
    lines.push(footerText(blocks, category, unsubscribeToken));
    return lines.join("\n");
  }

  function footerText(
    blocks: PickedBlock[],
    category: EmailCategory,
    unsubscribeToken?: string,
  ): string {
    const bilingual = blocks.length > 1;
    const onlyEn = blocks.length === 1 && blocks[0]?.locale === "en";
    const why = whyLineFor(category, bilingual, onlyEn);
    const unsubLabel = bilingual
      ? "Nem kérsz emlékeztetőket? Leiratkozás / Don't want updates? Unsubscribe"
      : onlyEn
        ? "Don't want updates? Unsubscribe"
        : "Nem kérsz emlékeztetőket? Leiratkozás";
    const out: string[] = ["---", why];
    out.push("Weddly · tryweddly.com");
    out.push(SOCIAL.map((s) => `${s.name}: ${s.href}`).join(" · "));
    // Last line, to mirror the HTML footer: present and functional, just not
    // the second thing the reader's eye lands on.
    if (category === "lifecycle" && unsubscribeToken) {
      out.push(`${unsubLabel}: ${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`);
    }
    return out.join("\n");
  }

  function renderHtml(
    { ctaUrl, category, plainCtaUrl, unsubscribeToken, trackingPixelUrl }: RenderInput,
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

    const footer = renderFooter(blocks, category, unsubscribeToken);
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
            <!-- Brand header, top-left lockup. The logo PNG is a dark square
                 with a white dove, so on the white card it reads as a dark
                 rounded tile for free. A hairline rule separates the masthead
                 from the letter. Wordmark in General Sans (the landing font). -->
            <tr>
              <td class="wd-header" align="left" style="padding:36px 40px 22px 40px;border-bottom:1px solid ${COLOR.divider};">
                <img src="${escapeAttr(`${CONFIG.frontendBaseUrl}/logo.png`)}" width="38" height="38" alt="Weddly" style="display:inline-block;vertical-align:middle;border:0;outline:none;width:38px;height:38px;border-radius:10px;" />
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
    locale: "hu" | "en",
    primary: boolean,
    ctaUrl: string,
    category: EmailCategory,
    plainCtaUrl: boolean,
  ): string {
    if (primary) {
      const paras = block.paragraphs
        .map(
          (p) =>
            `<p style="margin:0 0 16px 0;color:${COLOR.enInk};font-size:16px;line-height:1.6;word-break:break-word;hyphens:auto;">${renderBold(p)}</p>`,
        )
        .join("");
      const footnote = block.footnote
        ? `<p style="margin:18px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
        : "";
      // Left-aligned letter inside the white card: the greeting is a confident
      // General Sans headline, then body, then one dark espresso CTA, the
      // minimalist-precision "one statement, one action" rhythm. The dark
      // button is the single high-contrast element on the warm-white field.
      return `<tr>
              <td class="wd-card" align="left" style="padding:30px 40px 6px 40px;">
                <h1 class="wd-h1" style="margin:0 0 18px 0;color:${COLOR.ink};font-family:'General Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:27px;font-weight:600;line-height:1.24;letter-spacing:-0.015em;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(block.greeting)}
                </h1>
                ${renderOutreachOrientation(category, locale)}
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
                ${renderPlainUrlNote(ctaUrl, category, locale, plainCtaUrl)}
                ${renderSecondaryLinks(block.secondaryLinks)}
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
      .map(
        (p) =>
          `<p style="margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;word-break:break-word;hyphens:auto;">${renderBold(p)}</p>`,
      )
      .join("");
    const footnote = block.footnote
      ? `<p style="margin:10px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
      : "";
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
                ${footnote}
              </td>
            </tr>`;
  }

  function renderFooter(
    blocks: PickedBlock[],
    category: EmailCategory,
    unsubscribeToken?: string,
  ): string {
    const bilingual = blocks.length > 1;
    const onlyEn = blocks.length === 1 && blocks[0]?.locale === "en";
    const why = whyLineForHtml(category, bilingual, onlyEn);
    const unsubLabel = bilingual
      ? "Leiratkozás / Unsubscribe"
      : onlyEn
        ? "Unsubscribe"
        : "Leiratkozás";
    const prefsLabel = bilingual
      ? "Preferenciák / Email preferences"
      : onlyEn
        ? "Email preferences"
        : "Preferenciák";
    // Unsubscribe line, deliberately de-emphasized: it sits at the very BOTTOM
    // of the footer (see the return below), one notch smaller than the body
    // copy, so a casual reader scanning the footer doesn't land on it, but
    // anyone who wants out finds it exactly where every email keeps it. This is
    // as quiet as it may go and stay compliant: it must remain present, a
    // legible link, and a real colour against the card, never hidden, shrunk to
    // nothing, or blended into the background. The one-click List-Unsubscribe
    // header is untouched, so Gmail's native unsubscribe still works regardless.
    // Preferences leads the pair, since dialling reminders down is the softer
    // choice we'd rather a hesitant reader make than opt out of everything.
    const unsubLine =
      category === "lifecycle" && unsubscribeToken
        ? `<p style="margin:18px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;">
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/app/settings/account#email-preferences`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              ${prefsLabel}
            </a>
            &nbsp;·&nbsp;
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              ${unsubLabel}
            </a>
          </p>`
        : "";
    // Footer body copy is bumped to 13px (from the previous 11/12px), that
    // was below the 14px legibility floor for the median wedding-vendor
    // demographic (40-55 y/o on a phone, presbyopic, no Dynamic Type for HTML
    // email). 13px is the standard floor where pixel-fitted hinting still
    // looks crisp without bumping copy density too far.
    // Bilingual help label so a HU vendor on a cold mail isn't left guessing
    // what "Questions?" means, and the EN-only render stays clean.
    const helpLabel = bilingual ? "Kérdés? / Questions?" : onlyEn ? "Questions?" : "Kérdés?";
    return `
      <p style="margin:0 0 6px 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">${why}</p>
      <p style="margin:8px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">
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
      ${unsubLine}
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

// Cold recipients don't necessarily know what Weddly is, the body dives
// straight into "someone added you to our directory" without context.
// Inject a one-line "what is Weddly" orientation between the greeting and
// the first paragraph so the recipient has an anchor before the action ask.
// Only renders for outreach category, transactional/lifecycle recipients
// already have an account and don't need the intro.
function renderOutreachOrientation(category: EmailCategory, locale: "hu" | "en"): string {
  if (category !== "outreach") return "";
  const copy =
    locale === "hu"
      ? "A Weddly egy esküvőtervező eszköz pároknak, vendéglista, ülésrend, költségvetés, RSVP egy helyen."
      : "Weddly is a wedding-planning app for couples, guest list, seating, budget, RSVP in one place.";
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
  locale: "hu" | "en",
  force = false,
): string {
  if (category !== "outreach" && !force) return "";
  const label =
    locale === "hu" ? "Vagy másold be a böngészőbe:" : "Or copy this link into your browser:";
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
    hu: "Ezt a Weddly esküvőtervezőtől kaptad. Nincs fiókod nálunk, ha figyelmen kívül hagyod, nem történik semmi.",
    en: "You're getting this from Weddly, a wedding-planning app. You don't have an account with us, if you ignore this, nothing happens.",
    bilingual:
      "Ezt a Weddly esküvőtervezőtől kaptad, nincs fiókod nálunk. / You're getting this from Weddly, a wedding-planning app, you don't have an account with us.",
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
    hu: "Ezt a levelet a Weddly esküvőtervezőtől kaptad. Nincs fiókod nálunk, ha figyelmen kívül hagyod, nem történik semmi.",
    en: "You're receiving this from Weddly, a wedding-planning app. You don't have an account with us, if you ignore this, nothing happens.",
    bilingual:
      "Ezt a levelet a Weddly-től kaptad, és nincs fiókod nálunk. / You're receiving this from Weddly and you don't have an account with us.",
  },
};

function whyLineFor(category: EmailCategory, bilingual: boolean, onlyEn: boolean): string {
  const lines = WHY_LINE_TEXT[category];
  if (bilingual) return lines.bilingual;
  return onlyEn ? lines.en : lines.hu;
}

function whyLineForHtml(category: EmailCategory, bilingual: boolean, onlyEn: boolean): string {
  const lines = WHY_LINE_HTML[category];
  if (bilingual) return lines.bilingual;
  return onlyEn ? lines.en : lines.hu;
}
