import "../setup";

import { describe, expect, test } from "bun:test";
import { HU_HOST, renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";
import { lookupRouteSeo, SLUG_PAIRS, huPathFor, enPathFor } from "../../../shared/seo_routes";

// Pinned SSR template, minimal but valid: the renderer only cares about the
// SEO_HEAD markers + the <html lang=...> attr it rewrites. Mirrors how the
// `seo: multi-host` block in e2e.test.ts builds its fixtures.
const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

const HU_PATH = "/eszkozok/100-kerdes-eskuvo-elott";
const EN_PATH = "/tools/100-questions-before-marriage";

describe("seo: couple-cards tool route map", () => {
  test("lookupRouteSeo resolves the HU slug with both locale variants", () => {
    const seo = lookupRouteSeo(HU_PATH);
    expect(seo).not.toBeNull();
    expect(seo?.hu.h1).toBe("100 kérdés az esküvő előtt");
    expect(seo?.hu.title).toContain("100 kérdés az esküvő előtt");
    expect(seo?.en.h1).toBe("100 Questions Before You Say Yes");
    expect(seo?.en.title).toContain("100 Questions Before You Say Yes");
  });

  test("EN slug resolves to the same bilingual entry via the slug pair", () => {
    // The EN path doesn't have its own ROUTE_SEO key — it shares the HU
    // entry via the SLUG_PAIRS mapping inside lookupRouteSeo. This is the
    // single source of truth for "the EN canonical exists and points back".
    const seo = lookupRouteSeo(EN_PATH);
    expect(seo).not.toBeNull();
    expect(seo?.en.h1).toBe("100 Questions Before You Say Yes");
  });

  test("SLUG_PAIRS contains the bidirectional HU↔EN pair", () => {
    expect(SLUG_PAIRS).toContainEqual({ hu: HU_PATH, en: EN_PATH });
    expect(huPathFor(EN_PATH)).toBe(HU_PATH);
    expect(enPathFor(HU_PATH)).toBe(EN_PATH);
  });
});

describe("seo: couple-cards SSR meta injection", () => {
  test("HU host + HU Accept-Language renders HU title + meta", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "weddly.hu",
      pathname: HU_PATH,
      isRsvp: false,
      acceptLanguage: "hu-HU,hu;q=0.9",
    });
    expect(html).toContain("100 kérdés az esküvő előtt");
    // Locale-distinctive sentence from the HU description meta — keeps the
    // assertion stable as the description copy is tweaked.
    expect(html).toContain("Ingyenes, regisztráció nélkül");
    // Canonical points to itself on the HU canonical host.
    expect(html).toContain(`<link rel="canonical" href="https://${HU_HOST}${HU_PATH}" />`);
    // HU lang attr survives the rewrite — Googlebot reads this as the
    // page's primary language.
    expect(html).toContain(`<html lang="hu"`);
  });

  test("HU slug with EN Accept-Language renders EN copy", () => {
    // A Hungarian URL with `en-US` headers (the default for most crawlers
    // and international visitors) must serve the EN body. This is the
    // accept-language branch that lets Googlebot index the EN copy without
    // needing the multi-host EN_CANONICAL_HOST setup turned on.
    const html = renderIndexHtml(TEMPLATE, {
      host: "weddly.hu",
      pathname: HU_PATH,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain("100 Questions Before You Say Yes");
    expect(html).toContain("Four decks of 25");
    expect(html).toContain(`<html lang="en"`);
  });
});

describe("seo: couple-cards sitemap entry", () => {
  test("sitemap.xml includes the new HU tool URL with a lastmod", () => {
    const body = renderSitemapXml("weddly.hu");
    expect(body).toContain(`<loc>https://${HU_HOST}${HU_PATH}</loc>`);
    // STATIC_PUBLIC_PATHS entries all carry a lastmod stamp — without it
    // Google can't schedule a recrawl when copy changes.
    expect(body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
});
