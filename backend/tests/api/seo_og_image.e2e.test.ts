import "../setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getBlogPostBySlug, setBlogPostCoverImage } from "../../src/domain/blog";
import { HU_HOST, renderIndexHtml } from "../../src/lib/seo_ssr";

// Per-post Open Graph / Twitter image: a published blog post with a cover
// image gets its OWN share card instead of the brand og.png shared by every
// page. Brand pages keep og.png + its exact 1200×1200 PNG dimension hints;
// custom covers (blog/couple) drop the hints since their real size is unknown.

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

// One of the seeded posts (shared/blog_posts.ts; none seed a cover).
const BLOG_SLUG = "bibliai-idezetek-eskuvore";
const BLOG_PATH = `/blog/${BLOG_SLUG}`;
const RELATIVE_COVER = "/uploads/blog/biblia-cover.jpg";
const ABSOLUTE_COVER = "https://images.example.com/biblia-cover.jpg";

function render(pathname: string, acceptLanguage = "hu"): string {
  return renderIndexHtml(TEMPLATE, { host: "weddly.hu", pathname, isRsvp: false, acceptLanguage });
}

function metaContent(html: string, key: string): string | null {
  // Matches both `property="og:image"` and `name="twitter:image"` forms.
  const re = new RegExp(
    `<meta (?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)" />`,
  );
  return re.exec(html)?.[1] ?? null;
}

describe("seo: per-post Open Graph image", () => {
  let blogId: number;

  beforeAll(() => {
    const post = getBlogPostBySlug(BLOG_SLUG);
    if (!post) throw new Error(`seed missing: ${BLOG_SLUG}`);
    blogId = post.id;
  });

  afterAll(() => {
    // Restore the seeded state so sibling tests see no cover.
    setBlogPostCoverImage(blogId, null);
  });

  test("falls back to brand og.png when the post has no cover", () => {
    setBlogPostCoverImage(blogId, null);
    const html = render(BLOG_PATH);
    expect(metaContent(html, "og:image")).toBe(`https://${HU_HOST}/og.png`);
    expect(metaContent(html, "twitter:image")).toBe(`https://${HU_HOST}/og.png`);
    // Brand image keeps the exact dimension/type hints.
    expect(html).toContain(`<meta property="og:image:width" content="1200" />`);
    expect(html).toContain(`<meta property="og:image:type" content="image/png" />`);
  });

  test("relative cover is made absolute against the canonical host", () => {
    setBlogPostCoverImage(blogId, RELATIVE_COVER);
    const html = render(BLOG_PATH);
    const expected = `https://${HU_HOST}${RELATIVE_COVER}`;
    expect(metaContent(html, "og:image")).toBe(expected);
    expect(metaContent(html, "twitter:image")).toBe(expected);
  });

  test("absolute cover is passed through untouched", () => {
    setBlogPostCoverImage(blogId, ABSOLUTE_COVER);
    const html = render(BLOG_PATH);
    expect(metaContent(html, "og:image")).toBe(ABSOLUTE_COVER);
    expect(metaContent(html, "twitter:image")).toBe(ABSOLUTE_COVER);
  });

  test("custom cover drops the brand dimension/type hints", () => {
    setBlogPostCoverImage(blogId, RELATIVE_COVER);
    const html = render(BLOG_PATH);
    expect(html).not.toContain(`<meta property="og:image:width"`);
    expect(html).not.toContain(`<meta property="og:image:height"`);
    expect(html).not.toContain(`<meta property="og:image:type"`);
  });

  test("og/twitter image alt describes the post, localised per render", () => {
    setBlogPostCoverImage(blogId, RELATIVE_COVER);
    const hu = render(BLOG_PATH, "hu");
    const en = render(BLOG_PATH, "en-US");
    const huAlt = metaContent(hu, "og:image:alt") ?? "";
    const enAlt = metaContent(en, "og:image:alt") ?? "";
    expect(huAlt.length).toBeGreaterThan(0);
    expect(huAlt).toContain("Bibliai");
    expect(enAlt).not.toBe(huAlt);
    // twitter:image:alt mirrors og:image:alt.
    expect(metaContent(hu, "twitter:image:alt")).toBe(huAlt);
  });
});

describe("seo: brand pages keep og.png + dimension hints", () => {
  test("landing emits og.png with 1200×1200 PNG hints and a brand alt", () => {
    const html = render("/");
    expect(metaContent(html, "og:image")).toBe(`https://${HU_HOST}/og.png`);
    expect(html).toContain(`<meta property="og:image:width" content="1200" />`);
    expect(html).toContain(`<meta property="og:image:height" content="1200" />`);
    expect(metaContent(html, "twitter:image:alt")).toBe(metaContent(html, "og:image:alt"));
  });
});
