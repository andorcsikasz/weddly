import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";

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
    expect(html).toContain(`<link rel="alternate" hreflang="hu" href="https://weddly.hu${HU_TOOL}" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="https://weddly.hu${EN_TOOL}" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="https://weddly.hu${HU_TOOL}" />`);
  });

  test("EN-rendered tool page canonicalises to the EN slug", () => {
    const html = render(HU_TOOL, "en-US");
    expect(html).toContain(`<link rel="canonical" href="https://weddly.hu${EN_TOOL}" />`);
  });

  test("HU-rendered tool page canonicalises to the HU slug", () => {
    const html = render(HU_TOOL, "hu");
    expect(html).toContain(`<link rel="canonical" href="https://weddly.hu${HU_TOOL}" />`);
  });
});

describe("seo: non-paired routes emit no EN alternate (single URL)", () => {
  test("/about has hu + x-default but no en alternate", () => {
    const html = render("/about", "hu");
    expect(html).toContain(`hreflang="hu" href="https://weddly.hu/about"`);
    expect(html).toContain(`hreflang="x-default" href="https://weddly.hu/about"`);
    expect(html).not.toContain(`hreflang="en"`);
  });

  test("blog post has no en alternate (single slug)", () => {
    const html = render("/blog/bibliai-idezetek-eskuvore", "hu");
    expect(html).not.toContain(`hreflang="en"`);
  });
});

describe("seo: sitemap lists EN tool URLs in single-host mode", () => {
  test("includes a <loc> for the EN tool slug on weddly.hu", () => {
    const xml = renderSitemapXml("weddly.hu");
    expect(xml).toContain(`<loc>https://weddly.hu${EN_TOOL}</loc>`);
    expect(xml).toContain(`<loc>https://weddly.hu${HU_TOOL}</loc>`);
  });

  test("does not emit a duplicate EN loc for non-paired routes", () => {
    const xml = renderSitemapXml("weddly.hu");
    // /about appears once (no distinct EN slug), not twice.
    const aboutLocs = (xml.match(/<loc>https:\/\/weddly\.hu\/about<\/loc>/g) ?? []).length;
    expect(aboutLocs).toBe(1);
  });
});
