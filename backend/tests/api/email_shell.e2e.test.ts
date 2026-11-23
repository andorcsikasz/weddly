// The email shell follows the app's current UI tokens: Outfit, the neutral
// ink/paper ramps, a white rounded card on a paper ground, and the near-black
// button. These are pure renderer checks, no DB, so they pin the shell without
// depending on any one kind's copy.

import "../setup";

import { describe, expect, test } from "bun:test";
import { renderEmail } from "../../src/domain/emails/template";
import { CONFIG } from "../../src/config";

const block = {
  greeting: "Hello there",
  paragraphs: ["A body paragraph."],
  cta: "Open Weddly",
};

function render(recipientLocale: "en" | null = "en") {
  return renderEmail({
    hu: { ...block, greeting: "Helló" },
    en: block,
    ctaUrl: "https://tryweddly.com/app",
    category: "transactional",
    recipientLocale,
  }).html;
}

describe("email shell follows the app UI system", () => {
  test("uses Outfit and no longer ships General Sans or the oat palette", () => {
    const html = render();
    expect(html).toContain("font-family:'Outfit'");
    expect(html).toContain("/fonts/outfit-latin.woff2");
    expect(html).toContain("/fonts/outfit-latin-ext.woff2");
    expect(html).not.toContain("General Sans");
    expect(html).not.toContain("#f4efe7"); // old oat canvas
    expect(html).not.toContain("#7c5a3e"); // old walnut accent
    expect(html).not.toContain("#1c1714"); // old espresso ink
  });

  test("neutral ground, white card, near-black button with a 12px radius", () => {
    const html = render();
    expect(html).toContain("background-color:#f5f5f5"); // paper-200 ground
    expect(html).toContain("background-color:#ffffff"); // white card
    expect(html).toContain("border-radius:16px"); // rounded-2xl card
    expect(html).toContain("background-color:#0a0a0a"); // btn-primary fill
    expect(html).toContain("border-radius:12px;background-color:#0a0a0a");
  });

  test("hairlines carry a hex fallback before the alpha value", () => {
    const html = render();
    // The hex declaration must come first: Outlook drops the rgb() form and
    // would otherwise draw no card border at all.
    expect(html).toContain("border:1px solid #ebebeb;border:1px solid rgb(0 0 0 / 0.08);");
    // The divider between the Hungarian and English cards only exists on the
    // bilingual render (null locale), so the top rule is checked there.
    const bilingual = render(null);
    expect(bilingual).toContain(
      "border-top:1px solid #ebebeb;border-top:1px solid rgb(0 0 0 / 0.08);",
    );
  });

  test("the masthead logo keeps the exact URL the CID swap matches on", () => {
    // lib/mailer.ts replaces `src="<frontendBaseUrl>/email/logo.png"` with the
    // inline attachment. Changing the shape here would silently send a remote
    // image that Gmail hides for a new sender.
    const html = render();
    expect(html).toContain(`src="${CONFIG.frontendBaseUrl}/email/logo.png"`);
  });

  test("the footer sits on the ground, after the letter card", () => {
    const html = render();
    const cardAt = html.indexOf('border-radius:16px;">');
    const footerAt = html.indexOf('class="wd-footer"');
    expect(cardAt).toBeGreaterThan(0);
    expect(footerAt).toBeGreaterThan(cardAt);
  });
});
