import "../setup";

import { describe, expect, test } from "bun:test";
import { renderIndexHtml } from "../../src/lib/seo_ssr";

// JSON-LD coverage for the GEO/rich-result schema added after the May 2026
// audit: Article + BreadcrumbList on blog posts, WebApplication +
// BreadcrumbList on tool pages, plus the existing root SoftwareApplication +
// FAQPage. All SSR-injected so an AI/HTML-first crawl reads them pre-hydration.

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

// One of the 12 seeded posts (see shared/blog_posts.ts; setup logs
// "blog.seeded 12").
const BLOG_PATH = "/blog/bibliai-idezetek-eskuvore";
const TOOL_PATH = "/eszkozok/eskuvo-koltsegvetes-kalkulator";

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").replace(/<\\\//g, "</");
    out.push(JSON.parse(raw) as Record<string, unknown>);
  }
  return out;
}

function render(pathname: string, acceptLanguage: string): Record<string, unknown>[] {
  const html = renderIndexHtml(TEMPLATE, {
    host: "weddly.hu",
    pathname,
    isRsvp: false,
    acceptLanguage,
  });
  return jsonLdBlocks(html);
}

function byType(
  blocks: Record<string, unknown>[],
  type: string,
): Record<string, unknown> | undefined {
  return blocks.find((b) => b["@type"] === type);
}

describe("seo json-ld: every page", () => {
  test("Organization + WebSite present on a blog post", () => {
    const blocks = render(BLOG_PATH, "hu");
    expect(byType(blocks, "Organization")).toBeDefined();
    expect(byType(blocks, "WebSite")).toBeDefined();
  });
});

describe("seo json-ld: blog post", () => {
  test("emits a dated, authored Article", () => {
    const blocks = render(BLOG_PATH, "hu");
    const article = byType(blocks, "Article");
    expect(article).toBeDefined();
    expect(typeof article?.headline).toBe("string");
    expect((article?.headline as string).length).toBeGreaterThan(0);
    // datePublished is the 'YYYY-MM-DD' seed value; dateModified is ISO.
    expect(article?.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article?.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((article?.author as Record<string, unknown>)?.["@type"]).toBe("Organization");
    expect((article?.publisher as Record<string, unknown>)?.["@type"]).toBe("Organization");
    expect(article?.inLanguage).toBe("hu-HU");
  });

  test("emits a 3-level BreadcrumbList ending at the post", () => {
    const blocks = render(BLOG_PATH, "hu");
    const crumb = byType(blocks, "BreadcrumbList");
    const items = crumb?.itemListElement as Record<string, unknown>[] | undefined;
    expect(items?.length).toBe(3);
    expect(items?.[0]?.name).toBe("Főoldal");
    expect(items?.[2]?.item as string).toContain(BLOG_PATH);
  });

  test("EN render localises the breadcrumb labels", () => {
    const blocks = render(BLOG_PATH, "en-US");
    const crumb = byType(blocks, "BreadcrumbList");
    const items = crumb?.itemListElement as Record<string, unknown>[] | undefined;
    expect(items?.[0]?.name).toBe("Home");
    const article = byType(blocks, "Article");
    expect(article?.inLanguage).toBe("en-US");
  });
});

describe("seo json-ld: tool page", () => {
  test("emits a free WebApplication", () => {
    const blocks = render(TOOL_PATH, "hu");
    const app = byType(blocks, "WebApplication");
    expect(app).toBeDefined();
    expect(typeof app?.name).toBe("string");
    expect((app?.offers as Record<string, unknown>)?.price).toBe("0");
    expect((app?.offers as Record<string, unknown>)?.priceCurrency).toBe("HUF");
    expect(app?.url).toContain(TOOL_PATH);
  });

  test("emits a 2-level BreadcrumbList", () => {
    const blocks = render(TOOL_PATH, "hu");
    const crumb = byType(blocks, "BreadcrumbList");
    const items = crumb?.itemListElement as Record<string, unknown>[] | undefined;
    expect(items?.length).toBe(2);
  });

  test("EN tool render quotes EUR", () => {
    const blocks = render("/tools/wedding-budget-calculator", "en-US");
    const app = byType(blocks, "WebApplication");
    expect((app?.offers as Record<string, unknown>)?.priceCurrency).toBe("EUR");
  });
});

describe("seo json-ld: root regression", () => {
  test("landing still emits SoftwareApplication + FAQPage", () => {
    const blocks = render("/", "hu");
    expect(byType(blocks, "SoftwareApplication")).toBeDefined();
    expect(byType(blocks, "FAQPage")).toBeDefined();
    // ...and NOT an Article or WebApplication.
    expect(byType(blocks, "Article")).toBeUndefined();
    expect(byType(blocks, "WebApplication")).toBeUndefined();
  });
});
