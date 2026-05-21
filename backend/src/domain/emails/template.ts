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

export type EmailCategory = "transactional" | "lifecycle";
export type RecipientLocale = "hu" | "en" | null;

export interface LocaleBlock {
  /** Optional preheader (the gray inbox-preview text). Renders hidden in HTML. */
  preheader?: string;
  greeting: string;
  /** Body paragraphs. Each becomes a <p>. Plain text — escaped before render. */
  paragraphs: string[];
  cta: string;
  /** Small italic post-CTA note (e.g. "this link expires in 7 days"). Optional. */
  footnote?: string;
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
 *  locale → bilingual fallback (HU primary, EN secondary) for back-compat
 *  with guests + pre-feature users. */
function pickBlocks(hu: LocaleBlock, en: LocaleBlock, locale: RecipientLocale): PickedBlock[] {
  if (locale === "hu") return [{ locale: "hu", block: hu }];
  if (locale === "en") return [{ locale: "en", block: en }];
  return [
    { locale: "hu", block: hu },
    { locale: "en", block: en },
  ];
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const { hu, en, recipientLocale } = input;
  const blocks = pickBlocks(hu, en, recipientLocale ?? null);
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
      for (const p of block.paragraphs) lines.push(p);
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
    const why = bilingual
      ? category === "lifecycle"
        ? "Időnkénti emlékeztetőket kapsz a Weddly-től. / You're getting occasional reminders from Weddly."
        : "Ezt a fiókoddal kapcsolatban kaptad. / You're getting this because it's about your Weddly account."
      : onlyEn
        ? category === "lifecycle"
          ? "You're getting occasional reminders from Weddly because you have an account with us."
          : "You're getting this because it's about your Weddly account."
        : category === "lifecycle"
          ? "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk."
          : "Ezt a levelet a fiókoddal kapcsolatban kaptad.";
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
    const preheader = blocks[0]?.block.preheader ?? blocks[0]?.block.paragraphs[0] ?? "";
    // First block always renders as the "primary" card (big bold greeting,
    // filled CTA button). Subsequent blocks render as "secondary" cards
    // (smaller, muted, link-style CTA, with the locale label above) — this
    // is what historic bilingual rendering looked like, and we preserve it
    // for the back-compat null-locale path.
    const cards = blocks
      .map(({ locale, block }, i) => renderCard(block, locale, i === 0, ctaUrl))
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
    <title>Weddly</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${COLOR.ink};">
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
              <td style="padding:28px 32px 8px 32px;">
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
  ): string {
    if (primary) {
      const paras = block.paragraphs
        .map(
          (p) =>
            `<p style="margin:0 0 14px 0;color:${COLOR.ink};font-size:16px;line-height:1.55;word-break:break-word;hyphens:auto;">${escapeHtml(p)}</p>`,
        )
        .join("");
      const footnote = block.footnote
        ? `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
        : "";
      return `<tr>
              <td style="background-color:${COLOR.card};border-radius:14px;padding:32px 32px 28px 32px;box-shadow:0 1px 2px rgba(31,29,27,0.04),0 4px 18px rgba(31,29,27,0.06);">
                <p style="margin:0 0 18px 0;color:${COLOR.ink};font-size:18px;font-weight:600;line-height:1.4;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(block.greeting)}
                </p>
                ${paras}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
                  <tr>
                    <td style="border-radius:8px;background-color:${COLOR.accent};">
                      <a href="${escapeAttr(ctaUrl)}"
                         style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:${COLOR.accentInk};text-decoration:none;border-radius:8px;letter-spacing:0.01em;">
                        ${escapeHtml(block.cta)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${footnote}
              </td>
            </tr>`;
    }
    // Secondary card — historic EN-below-HU bilingual fallback. The locale
    // label sits above the greeting so the reader knows what they're looking
    // at when the primary above was a different language.
    const langLabel = locale === "en" ? "English" : "Magyar";
    const paras = block.paragraphs
      .map(
        (p) =>
          `<p style="margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;word-break:break-word;hyphens:auto;">${escapeHtml(p)}</p>`,
      )
      .join("");
    const footnote = block.footnote
      ? `<p style="margin:10px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;font-style:italic;">${escapeHtml(block.footnote)}</p>`
      : "";
    return `<tr>
              <td style="padding:14px 32px 0 32px;">
                <p style="margin:0 0 12px 0;color:${COLOR.muted};font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;">
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
    const why = bilingual
      ? category === "lifecycle"
        ? "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk. / You're receiving occasional reminders from Weddly because you have an account with us."
        : "Ezt a levelet a fiókoddal kapcsolatban kaptad. / You got this email because it concerns your Weddly account."
      : onlyEn
        ? category === "lifecycle"
          ? "You're receiving occasional reminders from Weddly because you have an account with us."
          : "You got this email because it concerns your Weddly account."
        : category === "lifecycle"
          ? "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk."
          : "Ezt a levelet a fiókoddal kapcsolatban kaptad.";
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
        ? `<p style="margin:8px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;">
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
    return `
      <p style="margin:0 0 6px 0;color:${COLOR.muted};font-size:12px;line-height:1.5;">${why}</p>
      ${unsubLine}
      <p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:11px;line-height:1.5;letter-spacing:0.04em;">
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
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
