import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml } from "../../src/lib/seo_ssr";
import { ROUTE_SEO } from "../../../shared/seo_routes";

// Regression guard for the May 2026 SEO audit finding: the landing meta
// description was over the 120-160 char SERP window (HU 166, EN 179). Google
// truncates past ~160 and short snippets read as thin, so we pin both ends.
const MIN = 120;
const MAX = 160;

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

function descriptionFrom(html: string): string {
  const m = html.match(/<meta name="description" content="([^"]*)"/);
  if (!m) throw new Error("no meta description in rendered head");
  // The renderer HTML-escapes the content; good enough for a length check, but
  // decode the common entities so the count reflects the real text length.
  return (m[1] ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

describe("seo: landing meta description length", () => {
  test("HU landing description sits in the 120-160 window", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "weddly.hu",
      pathname: "/",
      isRsvp: false,
      acceptLanguage: "hu",
    });
    const len = descriptionFrom(html).length;
    expect(len).toBeGreaterThanOrEqual(MIN);
    expect(len).toBeLessThanOrEqual(MAX);
  });

  test("EN landing description sits in the 120-160 window", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: "weddly.hu",
      pathname: "/",
      isRsvp: false,
      acceptLanguage: "en-US",
    });
    const len = descriptionFrom(html).length;
    expect(len).toBeGreaterThanOrEqual(MIN);
    expect(len).toBeLessThanOrEqual(MAX);
  });
});

describe("seo: route description lengths never exceed the cap", () => {
  test("every ROUTE_SEO description (hu + en) is <= 160 chars", () => {
    const offenders: string[] = [];
    for (const [path, locales] of Object.entries(ROUTE_SEO)) {
      for (const locale of ["hu", "en"] as const) {
        const d = locales[locale]?.description ?? "";
        if (d.length > MAX) offenders.push(`${locale} ${path} (${d.length})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
