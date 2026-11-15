import "../setup";

import { describe, expect, test } from "bun:test";
import { HU_HOST, lookupVendorPageMeta, renderIndexHtml } from "../../src/lib/seo_ssr";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { vendorPublicId } from "../../../shared/vendor_slug";

// The link a couple copies from the address bar is the APP url, not the public
// one: `/app/suppliers/<id>` for a venue, `/app/vendors?guests=N` for the list.
// iMessage and friends fetch them without a session, so the SSR head must carry
// the share card. The pages themselves stay noindex.

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta (?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)" />`,
  );
  return re.exec(html)?.[1] ?? null;
}

function render(pathname: string): string {
  return renderIndexHtml(TEMPLATE, {
    host: HU_HOST,
    pathname,
    isRsvp: false,
    acceptLanguage: "en-US,en;q=0.9",
  });
}

const venue = DIRECTORY.find((entry) => entry.hero_image_url);

describe("share card: a venue opened inside the app", () => {
  test("/app/suppliers/<id> carries the venue's own photo, not the brand mark", () => {
    if (!venue) throw new Error("no curated entry with a hero photo to test against");
    const meta = lookupVendorPageMeta(`/suppliers/${venue.id}`);
    expect(meta?.heroImageUrl).toBeTruthy();

    const html = render(`/app/suppliers/${encodeURIComponent(venue.id)}`);
    const image = metaContent(html, "og:image");
    expect(image).toBeTruthy();
    expect(image).not.toBe(`https://${HU_HOST}/og.png`);
    expect(image?.endsWith(meta?.heroImageUrl ?? "")).toBe(true);
    expect(metaContent(html, "twitter:image")).toBe(image);
  });

  test("the canonical points at the PUBLIC venue page, and the app page stays noindex", () => {
    if (!venue) throw new Error("no curated entry with a hero photo to test against");
    const html = render(`/app/suppliers/${encodeURIComponent(venue.id)}`);
    const publicUrl = `https://${HU_HOST}/suppliers/${vendorPublicId(venue.id, venue.name)}`;
    expect(html).toContain(`<link rel="canonical" href="${publicUrl}" />`);
    expect(metaContent(html, "robots")).toBe("noindex,follow");
  });
});

describe("share card: the in-app vendor list", () => {
  test("/app/vendors gets the vendor-directory card, not the dove logo", () => {
    const html = render("/app/vendors");
    expect(metaContent(html, "og:image")).toBe(`https://${HU_HOST}/og-vendors.png`);
    expect(metaContent(html, "twitter:image")).toBe(`https://${HU_HOST}/og-vendors.png`);
    expect(html).toContain(`<meta property="og:image:width" content="1200" />`);
    expect(html).toContain(`<meta property="og:image:height" content="630" />`);
    expect(metaContent(html, "og:title")).toContain("Wēddly");
    expect(metaContent(html, "robots")).toBe("noindex,follow");
  });

  test("the list card reads Hungarian for an HU locale", () => {
    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: "/app/vendors",
      isRsvp: false,
      acceptLanguage: "hu-HU,hu;q=0.9",
    });
    expect(metaContent(html, "og:title")).toBe("Szolgáltatók · Wēddly");
  });
});
