import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml } from "../../src/lib/seo_ssr";

// The audit's "621% rendered content" flag came from sub-pages baking only an
// h1 + lead into the SSR HTML while the full text rendered in JS only. Blog
// posts now bake their entire body (every paragraph/heading/list/quote) so an
// AI/HTML-first crawl reads the whole 7-9 minute article. These tests pin that.

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body>
  <div id="root">
    <div class="seo-prerender">
      <!-- SEO_BODY_START -->
      <h1>landing</h1>
      <!-- SEO_BODY_END -->
    </div>
  </div>
</body>
</html>`;

const BLOG_PATH = "/blog/bibliai-idezetek-eskuvore";
const TOOL_PATH = "/eszkozok/eskuvo-koltsegvetes-kalkulator";

function render(pathname: string, acceptLanguage: string): string {
  return renderIndexHtml(TEMPLATE, {
    host: "weddly.hu",
    pathname,
    isRsvp: false,
    acceptLanguage,
  });
}

/** Strip tags and collapse whitespace, for a rough word count of baked text. */
function visibleWordCount(html: string): number {
  const body = html.split("<!-- SEO_BODY_START -->")[1]?.split("<!-- SEO_BODY_END -->")[0] ?? "";
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

describe("seo: blog post body is baked into SSR HTML", () => {
  test("renders an <article> with many paragraphs and headings", () => {
    const html = render(BLOG_PATH, "hu");
    const body = html.split("<!-- SEO_BODY_START -->")[1] ?? "";
    expect(body).toContain("<article>");
    expect((body.match(/<p>/g) ?? []).length).toBeGreaterThan(10);
    expect((body.match(/<h2>/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test("bakes a substantial word count, not just the lead", () => {
    // The old behaviour was h1 + one-sentence lead (~30 words). A full post is
    // many hundreds of words.
    expect(visibleWordCount(render(BLOG_PATH, "hu"))).toBeGreaterThan(400);
  });

  test("HU and EN render different baked text", () => {
    const hu = render(BLOG_PATH, "hu");
    const en = render(BLOG_PATH, "en-US");
    expect(hu).not.toBe(en);
    expect(visibleWordCount(en)).toBeGreaterThan(400);
  });

  test("renders a clean article (no undefined/null/object leaks, balanced tags)", () => {
    const article = render(BLOG_PATH, "hu").match(/<article>[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(article.length).toBeGreaterThan(0);
    expect(article).not.toContain("undefined");
    expect(article).not.toContain("[object Object]");
    expect((article.match(/<article>/g) ?? []).length).toBe(1);
    expect((article.match(/<\/article>/g) ?? []).length).toBe(1);
  });
});

describe("seo: tool pages stay lean (no DB body to bake)", () => {
  test("tool route does not emit an <article> body", () => {
    const body = render(TOOL_PATH, "hu").split("<!-- SEO_BODY_START -->")[1] ?? "";
    expect(body).toContain("<h1>");
    expect(body).not.toContain("<article>");
  });
});
