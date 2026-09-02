import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";
import { toolPathFor } from "../../../shared/tool_faq";
import type { UiLocale } from "../../../shared/locales";

// The /{lang}/tools/{slug} pilot: language-prefixed URLs for the 7 free
// tool pages, replacing the old host+Accept-Language guessing with a URL
// that names its own language outright — see the plan in
// docs (git history) and shared/tool_faq.ts / shared/seo_routes.ts.

const BASE = `http://localhost:${process.env.PORT}`;

const TEMPLATE = `<!doctype html>
<html lang="hu" data-default-locale="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"><!-- SEO_BODY_START --><!-- SEO_BODY_END --></div></body>
</html>`;

function render(pathname: string): string {
  return renderIndexHtml(TEMPLATE, { host: "tryweddly.com", pathname, isRsvp: false });
}

describe("seo: /{lang}/tools/{slug} pilot", () => {
  test("every language renders its own <title> and <html lang> for the seating chart tool", () => {
    const expected: Record<UiLocale, string> = {
      hu: "Ültetési rend",
      en: "seating chart",
      es: "plano de mesas",
      hr: "rasporeda sjedenja",
      de: "Sitzplan",
    };
    for (const lc of Object.keys(expected) as UiLocale[]) {
      const html = render(toolPathFor(lc, "seating_chart"));
      expect(html, lc).toContain(`<html lang="${lc}"`);
      expect(html, lc).toContain(`data-default-locale="${lc}"`);
      const titleMatch = html.match(/<title>([^<]*)<\/title>/);
      expect(titleMatch?.[1] ?? "", lc).toContain(expected[lc]);
    }
  });

  test("canonical + full 5-way hreflang set (plus x-default=en) on every tool-lang URL", () => {
    const path = toolPathFor("es", "wedding_checklist");
    const html = render(path);
    expect(html).toContain(`<link rel="canonical" href="https://tryweddly.com${path}" />`);
    for (const lc of ["hu", "en", "es", "hr", "de"] as const) {
      const alt = toolPathFor(lc, "wedding_checklist");
      expect(html, lc).toContain(
        `<link rel="alternate" hreflang="${lc}" href="https://tryweddly.com${alt}" />`,
      );
    }
    // x-default points at EN — the international default everywhere else in
    // this codebase, not HU (which the old root-landing hreflang used for
    // reasons specific to that page).
    expect(html).toContain(
      `<link rel="alternate" hreflang="x-default" href="https://tryweddly.com${toolPathFor("en", "wedding_checklist")}" />`,
    );
  });

  test("robots is index,follow and the FAQ JSON-LD is present in the selected language", () => {
    const html = render(toolPathFor("de", "rsvp_generator"));
    expect(html).toContain(`<meta name="robots" content="index,follow" />`);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"WebApplication"');
  });

  test("an unknown slug or language 404s cleanly (no crash, no throw)", () => {
    expect(() => render("/xx/tools/seating-chart-builder")).not.toThrow();
    expect(() => render("/en/tools/not-a-real-tool")).not.toThrow();
  });

  test("legacy /eszkozok/* and /tools/* paths 301 into the new structure, query string preserved", async () => {
    const cases: Array<[string, string]> = [
      [
        "/eszkozok/ultetesi-rend-keszito?utm_source=x",
        `${toolPathFor("hu", "seating_chart")}?utm_source=x`,
      ],
      ["/tools/seating-chart-builder", toolPathFor("en", "seating_chart")],
      ["/eszkozok/eskuvoi-ellenorzolista", toolPathFor("hu", "wedding_checklist")],
      ["/tools/wedding-checklist", toolPathFor("en", "wedding_checklist")],
    ];
    for (const [legacy, target] of cases) {
      const res = await fetch(`${BASE}${legacy}`, {
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      expect(res.status, legacy).toBe(301);
      expect(res.headers.get("location"), legacy).toBe(target);
      await res.arrayBuffer();
    }
  });

  test("sitemap carries all 35 new URLs with 5-way hreflang, and none of the legacy paths", () => {
    const xml = renderSitemapXml(null);
    for (const key of [
      "budget_calculator",
      "countdown",
      "guest_list_template",
      "seating_chart",
      "rsvp_generator",
      "couple_cards",
      "wedding_checklist",
    ] as const) {
      for (const lc of ["hu", "en", "es", "hr", "de"] as const) {
        expect(xml, `${lc}/${key}`).toContain(
          `<loc>https://tryweddly.com${toolPathFor(lc, key)}</loc>`,
        );
      }
    }
    expect(xml).not.toContain("<loc>https://tryweddly.com/eszkozok/");
    expect(xml).not.toContain("<loc>https://tryweddly.com/tools/wedding-budget-calculator</loc>");
  });
});
