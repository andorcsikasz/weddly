// Branded bilingual email template. Email-client safe — table layout, inline
// styles, hex colors with web-safe fallbacks. Width capped at 560px so it reads
// well on mobile and in the Gmail/Outlook/Apple Mail preview pane.
//
// One template, two locales: HU primary card on top, EN secondary card below
// (per CLAUDE.md — never persist per-user locale, bilingual is the safer
// fallback). Footer carries the unsubscribe link only when the email is
// `lifecycle` category; transactional mail just shows a "you got this because"
// hint.
//
// IMPORTANT: do not pull in CSS variables or media queries — most email
// clients strip <style> blocks. Keep everything inline.

import { CONFIG } from "../../config";

export type EmailCategory = "transactional" | "lifecycle";

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

export function renderEmail(input: RenderInput): RenderedEmail {
  const { hu, en, ctaUrl, category, unsubscribeToken } = input;
  const fallbackSubject = hu.paragraphs[0] ?? hu.greeting;

  const text = renderText(input);
  const html = renderHtml(input);
  return { html, text, fallbackSubject };

  // closures share `category` / `unsubscribeToken`, so keep them inline below
  function renderText({ hu, en, ctaUrl, category, unsubscribeToken }: RenderInput): string {
    const lines: string[] = [];
    // Plain-text counterpart of the brand header. The macron char (U+0112) is
    // valid UTF-8 and renders fine in every modern text-mode client; the only
    // place it might fail is a 1990s telnet reader, which we don't target.
    lines.push("WĒDDLY");
    lines.push("");
    lines.push(hu.greeting);
    lines.push("");
    for (const p of hu.paragraphs) lines.push(p);
    lines.push("");
    lines.push(`${hu.cta}: ${ctaUrl}`);
    if (hu.footnote) {
      lines.push("");
      lines.push(hu.footnote);
    }
    lines.push("");
    lines.push("— — —");
    lines.push("");
    lines.push(en.greeting);
    lines.push("");
    for (const p of en.paragraphs) lines.push(p);
    lines.push("");
    lines.push(`${en.cta}: ${ctaUrl}`);
    if (en.footnote) {
      lines.push("");
      lines.push(en.footnote);
    }
    lines.push("");
    lines.push("---");
    if (category === "lifecycle" && unsubscribeToken) {
      lines.push(
        `Nem kérsz emlékeztetőket? Leiratkozás / Don't want updates? Unsubscribe: ${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`,
      );
    } else {
      lines.push("You're getting this because it's about your Weddly account.");
    }
    lines.push("Weddly · weddly.xyz");
    return lines.join("\n");
  }

  function renderHtml({ hu, en, ctaUrl, category, unsubscribeToken }: RenderInput): string {
    const preheader = hu.preheader ?? hu.paragraphs[0] ?? "";
    // Long Hungarian compound names (couple display names, household labels)
    // can otherwise force horizontal scroll on narrow mobile mail clients.
    // word-break:break-word is well-supported across Gmail/Apple Mail; hyphens
    // is best-effort but degrades gracefully.
    const huParas = hu.paragraphs
      .map(
        (p) =>
          `<p style="margin:0 0 14px 0;color:${COLOR.ink};font-size:16px;line-height:1.55;word-break:break-word;hyphens:auto;">${escapeHtml(p)}</p>`,
      )
      .join("");
    const enParas = en.paragraphs
      .map(
        (p) =>
          `<p style="margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;line-height:1.55;word-break:break-word;hyphens:auto;">${escapeHtml(p)}</p>`,
      )
      .join("");

    const huFootnote = hu.footnote
      ? `<p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:13px;line-height:1.5;font-style:italic;">${escapeHtml(hu.footnote)}</p>`
      : "";
    const enFootnote = en.footnote
      ? `<p style="margin:10px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;font-style:italic;">${escapeHtml(en.footnote)}</p>`
      : "";

    const footer = renderFooter(category, unsubscribeToken);

    return `<!doctype html>
<html lang="hu">
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
            <!-- HU primary card -->
            <tr>
              <td style="background-color:${COLOR.card};border-radius:14px;padding:32px 32px 28px 32px;box-shadow:0 1px 2px rgba(31,29,27,0.04),0 4px 18px rgba(31,29,27,0.06);">
                <p style="margin:0 0 18px 0;color:${COLOR.ink};font-size:18px;font-weight:600;line-height:1.4;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(hu.greeting)}
                </p>
                ${huParas}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
                  <tr>
                    <td style="border-radius:8px;background-color:${COLOR.accent};">
                      <a href="${escapeAttr(ctaUrl)}"
                         style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:${COLOR.accentInk};text-decoration:none;border-radius:8px;letter-spacing:0.01em;">
                        ${escapeHtml(hu.cta)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${huFootnote}
              </td>
            </tr>
            <!-- Divider -->
            <tr>
              <td style="padding:18px 32px 0 32px;">
                <div style="border-top:1px solid ${COLOR.divider};font-size:0;line-height:0;height:1px;">&nbsp;</div>
              </td>
            </tr>
            <!-- EN secondary card -->
            <tr>
              <td style="padding:14px 32px 0 32px;">
                <p style="margin:0 0 12px 0;color:${COLOR.muted};font-size:11px;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;">
                  English
                </p>
                <p style="margin:0 0 12px 0;color:${COLOR.enInk};font-size:14px;font-weight:600;line-height:1.4;word-break:break-word;hyphens:auto;">
                  ${escapeHtml(en.greeting)}
                </p>
                ${enParas}
                <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;">
                  <a href="${escapeAttr(ctaUrl)}" style="color:${COLOR.accent};text-decoration:underline;font-weight:600;">
                    ${escapeHtml(en.cta)} →
                  </a>
                </p>
                ${enFootnote}
              </td>
            </tr>
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

  function renderFooter(category: EmailCategory, unsubscribeToken?: string): string {
    const why =
      category === "lifecycle"
        ? "Időnkénti emlékeztetőket kapsz a Weddly-től, mert van fiókod nálunk. / You're receiving occasional reminders from Weddly because you have an account with us."
        : "Ezt a levelet a fiókoddal kapcsolatban kaptad. / You got this email because it concerns your Weddly account.";
    const unsubLine =
      category === "lifecycle" && unsubscribeToken
        ? `<p style="margin:8px 0 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5;">
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/unsubscribe/${unsubscribeToken}`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              Leiratkozás / Unsubscribe
            </a>
            &nbsp;·&nbsp;
            <a href="${escapeAttr(`${CONFIG.frontendBaseUrl}/account/preferences`)}"
               style="color:${COLOR.muted};text-decoration:underline;">
              Preferenciák / Email preferences
            </a>
          </p>`
        : "";
    return `
      <p style="margin:0 0 6px 0;color:${COLOR.muted};font-size:12px;line-height:1.5;">${why}</p>
      ${unsubLine}
      <p style="margin:14px 0 0 0;color:${COLOR.muted};font-size:11px;line-height:1.5;letter-spacing:0.04em;">
        <span style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-weight:600;letter-spacing:0.24em;">WĒDDLY</span> · <a href="${escapeAttr(CONFIG.frontendBaseUrl)}" style="color:${COLOR.muted};text-decoration:underline;">weddly.xyz</a>
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
