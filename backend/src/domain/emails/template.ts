// Branded locale-aware email template. Email-client safe — table layout,
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
// IMPORTANT: do not pull in CSS variables or media queries — most email
// clients strip <style> blocks. Keep everything inline.

import { CONFIG } from "../../config";
import type { EmailCategory } from "./kinds";

export type { EmailCategory };
export type RecipientLocale = "hu" | "en" | null;

export interface LocaleBlock {
  /** Optional preheader (the gray inbox-preview text). Renders hidden in HTML. */
  preheader?: string;
  greeting: string;
  /** Body paragraphs. Each becomes a <p>. Plain text — escaped before render. */
  paragraphs: string[];
  cta: string;
  /** Plain (non-italic) line rendered directly under the CTA button. Use for
   *  load-bearing info that's part of the action — link expiry, single-use
   *  warning, time-sensitive caveats. Reserves the `footnote` slot for truly
   *  tertiary reassurance ("if you didn't ask for this, ignore it"). */
  ctaSubtext?: string;
  /** Small italic note rendered after the secondary links + below the CTA
   *  block. Use for reassurance copy that's nice-to-have, not load-bearing. */
  footnote?: string;
  /** Low-stakes investigation links rendered as a row underneath the primary
   *  CTA. Gives a skeptical recipient (especially on outreach mail) a path
   *  to verify the sender without committing to the action. Only honoured
   *  on the primary card — secondary cards already have a link-style CTA. */
  secondaryLinks?: Array<{ label: string; url: string }>;
}

export interface RenderInput {
  hu: LocaleBlock;
  en: LocaleBlock;
  /** Where the CTA button points. */
  ctaUrl: string;
  /** Affects footer copy + whether unsubscribe link shows. */
  category: EmailCategory;
  /** When category=lifecycle, this is appended as ?token=… so the link is
   *  one-click. The route is /unsubscribe/:token on the frontend. */
  unsubscribeToken?: string;
  /** Pick a single-language render when known. `null`/omitted falls back to
   *  the historical bilingual HU+EN layout — used for guests (we don't have
   *  per-guest locale yet) and users whose `users.locale` predates the
   *  feature. */
  recipientLocale?: RecipientLocale;
  /** Surface the named language on TOP of the bilingual stack. Only used
   *  when `recipientLocale` is null — when we don't know the recipient's
   *  language but DO know the submitter's, lead with the submitter's
   *  language and keep the other as a safety net below. */
  primaryLocaleHint?: "hu" | "en";
}

export interface RenderedEmail {
  html: string;
  text: string;
  /** First paragraph of the HU block, used when subject is empty. */
  fallbackSubject: string;
}

// Soft-Modern palette — matches the landing page tokens. Hex literals here
// (not Tailwind tokens) because email clients can't reach Tailwind. Keep this
// list in sync with `frontend/tailwind.config.js` whenever the brand shifts.
const COLOR = {
  bg: "#faf7f2", // warm cream surface
  card: "#ffffff",
  ink: "#1f1d1b", // near-black ink, slightly warm
  muted: "#6e6863",
  divider: "#ece6dd",
  accent: "#7c5a3e", // walnut, the brand's primary
  accentInk: "#ffffff",
  enInk: "#5a5550",
} as const;

interface PickedBlock {
  locale: "hu" | "en";
  block: LocaleBlock;
}

/** Choose which language blocks render, in display order. `null` recipient
 *  locale → bilingual fallback. `primaryLocaleHint` orders the bilingual
 *  stack — when the caller knows what language the *submitter* uses (e.g.
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
  // Subject fallback follows the primary block — for an EN-only render, the
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
        lines.push("— — —");
        lines.push("");
      }
      lines.push(block.greeting);
      lines.push("");
      for (const p of block.paragraphs) lines.push(stripBold(p));
      lines.push("");
      lines.push(`${block.cta}: ${ctaUrl}`);
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
    if (category === "lifecycle" && unsubscribeToken) {
      out.push(`${unsubLabel}: ${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`);
    }
    out.push("Weddly · weddly.hu");
    return out.join("\n");
  }

  function renderHtml(
    { ctaUrl, category, unsubscribeToken }: RenderInput,
    blocks: PickedBlock[],
  ): string {
    const preheader = capPreheader(
      blocks[0]?.block.preheader ?? blocks[0]?.block.paragraphs[0] ?? "",
    );
    // First block always renders as the "primary" card (big bold greeting,
    // filled CTA button). Subsequent blocks render as "secondary" cards
    // (smaller, muted, link-style CTA, with the locale label above) — this
    // is what historic bilingual rendering looked like, and we preserve it
    // for the back-compat null-locale path.
    const cards = blocks
      .map(({ locale, block }, i) => renderCard(block, locale, i === 0, ctaUrl, category))
      .join(
        `<tr><td style="padding:18px 32px 0 32px;"><div style="border-top:1px solid ${COLOR.divider};font-size:0;line-height:0;height:1px;">&nbsp;</div></td></tr>`,
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
    <!-- Pin the colour scheme to "light" — Apple Mail honours both meta tags,
         Gmail iOS partially. Until we hand-tune a dark palette, this keeps the
         cream + walnut brand identity readable; the auto-invert otherwise
         flips the cream bg to muddy brown and the walnut CTA loses contrast. -->
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Weddly</title>
    <style>
      /* General Sans — self-hosted at the Weddly CDN. Supported by Apple Mail,
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
      /* Mobile overrides — Apple Mail + Gmail iOS app respect <style>; Gmail
         web strips it, but the inline styles still apply as the fallback.
         Tighter inner padding gains ~24px of horizontal room on a 360–375px
         viewport; the larger CTA + 1.2 line-height gives a comfortable
         ≥50px tap target (the inline value is borderline 44px). */
      @media (max-width: 480px) {
        .wd-card { padding: 24px 20px 22px 20px !important; }
        .wd-cta { padding: 15px 26px !important; font-size: 16px !important; line-height: 1.2 !important; }
        .wd-secondary { padding: 14px 20px 0 20px !important; }
        .wd-footer { padding: 24px 20px 8px 20px !important; }
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
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
            <!-- Brand header — wide-tracked serif caps with a macron over the
                 E. The macron is precomposed (U+0112) so it renders consistently
                 across every email client without needing a stacked diacritic. -->
            <tr>
              <td align="center" style="padding:0 0 24px 0;">
                <span style="display:inline-block;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;letter-spacing:0.32em;color:${COLOR.ink};text-transform:none;">
                  WĒDDLY
                </span>
              </td>
            </tr>
            ${cards}
            <!-- Footer -->
            <tr>
              <td class="wd-footer" style="padding:28px 32px 8px 32px;">
                ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  function renderCard(
    block: LocaleBlock,
    locale: "hu" | "en",
    primary: boolean,
    ctaUrl: string,
    category: EmailCategory,
  ): string {
    if (primary) {
      const paras = block.paragraphs
        .map(
          (p) =>
            `<p style="margin:0 0 14px 0;color:${COLOR.ink};font-size:16px;line-height:1.55;word-break:break-word;hyphens:auto;">${renderBold(p)}</p>`,
        )
        .join("");
      const footnote = block.footnote
        ? `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
        : "";
      return `<tr>
              <td class="wd-card" style="background-color:${COLOR.card};border-radius:14px;padding:32px 32px 28px 32px;box-shadow:0 1px 2px rgba(31,29,27,0.04),0 4px 18px rgba(31,29,27,0.06);">
                <p style="margin:0 0 18px 0;color:${COLOR.ink};font-size:18px;font-weight:600;line-height:1.4;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(block.greeting)}
                </p>
                ${renderOutreachOrientation(category, locale)}
                ${paras}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
                  <tr>
                    <td style="border-radius:8px;background-color:${COLOR.accent};">
                      <a href="${escapeAttr(ctaUrl)}" class="wd-cta"
                         style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:${COLOR.accentInk};text-decoration:none;border-radius:8px;letter-spacing:0.01em;line-height:1.2;">
                        ${escapeHtml(block.cta)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${renderCtaSubtext(block.ctaSubtext)}
                ${renderPlainUrlNote(ctaUrl, category, locale)}
                ${renderSecondaryLinks(block.secondaryLinks)}
                ${footnote}
              </td>
            </tr>`;
    }
    // Secondary card — historic EN-below-HU bilingual fallback. The locale
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
              <td class="wd-secondary" lang="${locale}" style="padding:14px 32px 0 32px;">
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
    const unsubLine =
      category === "lifecycle" && unsubscribeToken
        ? `<p style="margin:8px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              ${unsubLabel}
            </a>
            &nbsp;·&nbsp;
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/account/preferences`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              ${prefsLabel}
            </a>
          </p>`
        : "";
    // Footer body copy is bumped to 13px (from the previous 11/12px) — that
    // was below the 14px legibility floor for the median wedding-vendor
    // demographic (40-55 y/o on a phone, presbyopic, no Dynamic Type for HTML
    // email). 13px is the standard floor where pixel-fitted hinting still
    // looks crisp without bumping copy density too far.
    // Bilingual help label so a HU vendor on a cold mail isn't left guessing
    // what "Questions?" means, and the EN-only render stays clean.
    const helpLabel = bilingual ? "Kérdés? / Questions?" : onlyEn ? "Questions?" : "Kérdés?";
    return `
      <p style="margin:0 0 6px 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">${why}</p>
      ${unsubLine}
      <p style="margin:8px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;">
        ${helpLabel} <a href="mailto:${escapeAttr(CONFIG.supportEmail)}" style="color:${COLOR.muted};text-decoration:underline;">${escapeHtml(CONFIG.supportEmail)}</a>
      </p>
      <p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;letter-spacing:0.04em;">
        <span style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-weight:600;letter-spacing:0.24em;">WĒDDLY</span> · <a href="${escapeAttr(CONFIG.frontendBaseUrl)}" style="color:${COLOR.muted};text-decoration:underline;">weddly.hu</a>
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
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Load-bearing copy directly under the CTA — link expiry, single-use
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

// Cold recipients don't necessarily know what Weddly is — the body dives
// straight into "someone added you to our directory" without context.
// Inject a one-line "what is Weddly" orientation between the greeting and
// the first paragraph so the recipient has an anchor before the action ask.
// Only renders for outreach category — transactional/lifecycle recipients
// already have an account and don't need the intro.
function renderOutreachOrientation(category: EmailCategory, locale: "hu" | "en"): string {
  if (category !== "outreach") return "";
  const copy =
    locale === "hu"
      ? "A Weddly egy esküvőtervező eszköz pároknak — vendéglista, ülésrend, költségvetés, RSVP egy helyen."
      : "Weddly is a wedding-planning app for couples — guest list, seating, budget, RSVP in one place.";
  return `<p style="margin:0 0 18px 0;color:${COLOR.muted};font-size:14px;line-height:1.5;font-style:italic;">${escapeHtml(copy)}</p>`;
}

// For unsolicited mail (outreach category), the CTA button hides its
// destination — a textbook phishing shape. Render the URL in plain text
// underneath so a skeptical recipient can verify the domain before clicking.
// Transactional + lifecycle mails (recipient has a Weddly account) skip this
// — the extra line is noise when there's no trust gap to bridge.
function renderPlainUrlNote(ctaUrl: string, category: EmailCategory, locale: "hu" | "en"): string {
  if (category !== "outreach") return "";
  const label =
    locale === "hu" ? "Vagy másold be a böngészőbe:" : "Or copy this link into your browser:";
  return `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;word-break:break-all;">
            ${escapeHtml(label)}<br />
            <span style="color:${COLOR.enInk};">${escapeHtml(ctaUrl)}</span>
          </p>`;
}

// Preheader is the gray "inbox preview" text. Gmail iOS truncates around 90
// chars and Apple Mail around 140; cap at 90 so the preview is consistent
// across clients and we never spill into the visible body (which leaks the
// preheader trick — looks broken). One-line cap, no ellipsis: clients add
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
    hu: "Ezt a Weddly esküvőtervezőtől kaptad. Nincs fiókod nálunk — ha figyelmen kívül hagyod, nem történik semmi.",
    en: "You're getting this from Weddly, a wedding-planning app. You don't have an account with us — if you ignore this, nothing happens.",
    bilingual:
      "Ezt a Weddly esküvőtervezőtől kaptad — nincs fiókod nálunk. / You're getting this from Weddly, a wedding-planning app — you don't have an account with us.",
  },
};

// Same map, slightly longer HU copy for the HTML footer (the previous code
// had separate strings for text and html footers — keep that split here).
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
    hu: "Ezt a levelet a Weddly esküvőtervezőtől kaptad. Nincs fiókod nálunk — ha figyelmen kívül hagyod, nem történik semmi.",
    en: "You're receiving this from Weddly, a wedding-planning app. You don't have an account with us — if you ignore this, nothing happens.",
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
