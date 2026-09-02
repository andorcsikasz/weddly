import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";
import { toolPathFor } from "../../../shared/tool_faq";

// Same-host EN exposure: slug-paired routes (the tools, /eszkozok/X vs
// /tools/X) get a real EN alternate URL on weddly.hu even without an
// EN_CANONICAL_HOST, surfacing the EN tool pages. Non-paired routes (landing,
// blog, about) share one URL per locale via Accept-Language and emit no EN
// alternate (avoids the duplicate-canonical trap).

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

const HU_TOOL = "/eszkozok/eskuvo-koltsegvetes-kalkulator";
const EN_TOOL = "/tools/wedding-budget-calculator";

function render(pathname: string, acceptLanguage: string): string {
  return renderIndexHtml(TEMPLATE, { host: "weddly.hu", pathname, isRsvp: false, acceptLanguage });
}

describe("seo: same-host EN hreflang for paired tool routes", () => {
  test("HU tool page emits an EN alternate pointing at the EN slug on weddly.hu", () => {
    const html = render(HU_TOOL, "hu");
    expect(html).toContain(
      `<link rel="alternate" hreflang="hu-HU" href="https://tryweddly.com${HU_TOOL}" />`,
    );
    expect(html).toContain(
      `<link rel="alternate" hreflang="en" href="https://tryweddly.com${EN_TOOL}" />`,
    );
    expect(html).toContain(
      `<link rel="alternate" hreflang="x-default" href="https://tryweddly.com${HU_TOOL}" />`,
    );
  });

  test("EN-rendered tool page canonicalises to the EN slug", () => {
    const html = render(HU_TOOL, "en-US");
    expect(html).toContain(`<link rel="canonical" href="https://tryweddly.com${EN_TOOL}" />`);
  });

  test("HU-rendered tool page canonicalises to the HU slug", () => {
    const html = render(HU_TOOL, "hu");
    expect(html).toContain(`<link rel="canonical" href="https://tryweddly.com${HU_TOOL}" />`);
  });
});

describe("seo: non-paired routes emit no EN alternate (single URL)", () => {
  test("/about has hu + x-default but no en alternate", () => {
    const html = render("/about", "hu");
    expect(html).toContain(`hreflang="hu-HU" href="https://tryweddly.com/about"`);
    expect(html).toContain(`hreflang="x-default" href="https://tryweddly.com/about"`);
    expect(html).not.toContain(`hreflang="en"`);
  });

  test("a translated blog post emits its EN alternate (paired en_slug)", () => {
    // bibliai-idezetek-eskuvore is paired with the EN slug bible-verses-for-
    // weddings (SEED_EN_SLUG_BY_SLUG), so the SSR head exposes the EN alternate.
    const html = render("/blog/bibliai-idezetek-eskuvore", "hu");
    expect(html).toContain(
      `<link rel="alternate" hreflang="en" href="https://tryweddly.com/blog/bible-verses-for-weddings" />`,
    );
  });
});

describe("seo: single-host production request (no Accept-Language) picks locale from the tool URL itself", () => {
  // server.ts's real production call passes `acceptLanguage: null` — no
  // header forwarded at all. Before this, that fell straight through to the
  // global EN default, so a fresh visit (or Googlebot's crawl) to the
  // Hungarian-slugged, Hungarian-titled tool URL rendered English title,
  // body and `<html lang>`, despite ROUTE_SEO carrying real HU copy for it.
  function renderNoHeader(pathname: string): string {
    return renderIndexHtml(TEMPLATE, { host: "tryweddly.com", pathname, isRsvp: false });
  }

  test("HU tool slug renders its real HU title/h1/lang, not the EN default", () => {
    const html = renderNoHeader(HU_TOOL);
    expect(html).toContain("<title>Esküvő költségvetés kalkulátor · Wēddly</title>");
    expect(html).toContain("Esküvő költségvetés kalkulátor");
    expect(html).toContain('<html lang="hu">');
    expect(html).not.toContain("Wedding budget calculator");
  });

  test("EN tool slug still renders EN — unaffected by the fix", () => {
    const html = renderNoHeader(EN_TOOL);
    expect(html).toContain("<title>Wedding budget calculator · Wēddly</title>");
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("Esküvő költségvetés kalkulátor");
  });

  test("a non-tool route (no slug pair) keeps the global EN default", () => {
    const html = renderNoHeader("/about");
    expect(html).toContain('<html lang="en">');
  });
});

describe("seo: sitemap lists the language-prefixed tool URLs, not the legacy paths", () => {
  test("includes a <loc> for the HU and EN /{lang}/tools/{slug} URLs, not the old /eszkozok or /tools paths", () => {
    const xml = renderSitemapXml("weddly.hu");
    expect(xml).toContain(
      `<loc>https://tryweddly.com${toolPathFor("en", "budget_calculator")}</loc>`,
    );
    expect(xml).toContain(
      `<loc>https://tryweddly.com${toolPathFor("hu", "budget_calculator")}</loc>`,
    );
    expect(xml).not.toContain(`<loc>https://tryweddly.com${EN_TOOL}</loc>`);
    expect(xml).not.toContain(`<loc>https://tryweddly.com${HU_TOOL}</loc>`);
  });

  test("does not emit a duplicate EN loc for non-paired routes", () => {
    const xml = renderSitemapXml("weddly.hu");
    // /about appears once (no distinct EN slug), not twice.
    const aboutLocs = (xml.match(/<loc>https:\/\/tryweddly\.com\/about<\/loc>/g) ?? []).length;
    expect(aboutLocs).toBe(1);
  });
});
