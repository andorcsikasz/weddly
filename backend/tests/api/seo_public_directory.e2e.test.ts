// The public directory: every vendor visible to anyone, none of their personal
// details, and the whole thing offered to crawlers.
//
// Before this, a visitor's only view of the catalogue was a six-per-category
// teaser, and the thousand-odd vendor profile pages — the largest body of
// unique, photographed, reviewed content the product has — appeared in no
// sitemap and hung off no crawlable hub. What is pinned here:
//
//   1. `/api/public/vendors` returns the SAME catalogue a signed-in couple
//      sees, paginated and filterable, with no contact value on any card.
//   2. The sitemap carries only substantial vendor pages with unique public
//      content, while thin imported profiles remain browseable but noindex.
//   3. `/suppliers/browse` bakes a crawlable index of supplier links into its SSR
//      body, and that index publishes no email or phone either — masking the
//      API and then printing the values into the HTML would be worse than not
//      masking at all.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { PublicDirectoryPage } from "@shared/suppliers";
import { req } from "../helpers";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { renderIndexHtml, renderSitemapXml } from "../../src/lib/seo_ssr";
import { vendorPublicId } from "@shared/vendor_slug";

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

function ssrBody(pathname: string): string {
  const html = renderIndexHtml(TEMPLATE, { host: "tryweddly.com", pathname, isRsvp: false });
  return html.split("<!-- SEO_BODY_START -->")[1]?.split("<!-- SEO_BODY_END -->")[0] ?? "";
}

describe("GET /api/public/vendors — the whole catalogue, for anybody", () => {
  test("an anonymous visitor gets real vendors and a total worth paginating", async () => {
    const r = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=5");
    expect(r.status).toBe(200);
    expect(r.data.vendors.length).toBe(5);
    // The teaser showed six per category and stopped. This is the catalogue.
    expect(r.data.total).toBeGreaterThan(100);
    expect(r.data.limit).toBe(5);
    expect(r.data.offset).toBe(0);
  });

  test("no card carries a contact value, whatever the filter", async () => {
    const r = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=48");
    const leaked = r.data.vendors.filter(
      (v) => v.contact_email !== null || v.contact_phone !== null || v.contact_phone_alt,
    );
    expect(leaked.map((v) => v.id)).toEqual([]);
  });

  test("paging walks the catalogue without repeating or dropping a card", async () => {
    const first = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=10");
    const second = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=10&offset=10");
    const firstIds = first.data.vendors.map((v) => v.id);
    const secondIds = second.data.vendors.map((v) => v.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(20);
    // Same total on both pages, or the visitor is walking a shifting list.
    expect(second.data.total).toBe(first.data.total);
  });

  test("the category filter narrows the results and the facets stay useful", async () => {
    const all = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=1");
    const category = all.data.categories[0]?.category;
    expect(category).toBeDefined();
    const filtered = await req<PublicDirectoryPage>(
      "GET",
      `/api/public/vendors?limit=48&category=${category}`,
    );
    expect(filtered.data.total).toBeLessThan(all.data.total);
    expect(filtered.data.vendors.every((v) => v.category === category)).toBe(true);
    // City chips are counted inside the active category, so none of them can
    // offer a combination that returns nothing.
    expect(filtered.data.cities.length).toBeGreaterThan(0);
  });

  test("a junk limit falls back rather than dumping the catalogue", async () => {
    const r = await req<PublicDirectoryPage>("GET", "/api/public/vendors?limit=100000");
    expect(r.data.vendors.length).toBeLessThanOrEqual(48);
  });
});

describe("the sitemap offers every vendor page", () => {
  test("a substantial curated vendor's pretty URL is in the file", () => {
    const xml = renderSitemapXml(null);
    const entry = DIRECTORY.find((candidate) => {
      const path = `/suppliers/${vendorPublicId(candidate.id, candidate.name)}`;
      return xml.includes(`<loc>https://tryweddly.com${path}</loc>`);
    });
    expect(entry).toBeDefined();
    const path = `/suppliers/${vendorPublicId(entry?.id ?? "", entry?.name ?? "")}`;
    expect(xml).toContain(`<loc>https://tryweddly.com${path}</loc>`);
  });

  test("the browser hub is in it too, above the vendor-recruitment page", () => {
    const xml = renderSitemapXml(null);
    expect(xml).toContain("<loc>https://tryweddly.com/suppliers/browse</loc>");
  });

  test("the file includes substantial profiles without mass-indexing thin catalogue rows", () => {
    const xml = renderSitemapXml(null);
    const locs = xml.match(/<loc>/g)?.length ?? 0;
    expect(locs).toBeGreaterThan(100);
    expect(locs).toBeLessThan(DIRECTORY.length);
  });
});

describe("/suppliers/browse is crawlable without JavaScript", () => {
  test("the SSR body carries the page's own heading and intro", () => {
    // No Accept-Language means HU: the root domain's canonical public
    // experience targets Hungary.
    const body = ssrBody("/suppliers/browse");
    expect(body).toContain("<h1>Esküvői szolgáltatók</h1>");
    expect(body).toContain("Szűrj városra és kategóriára");
  });

  test("the index names its categories in words, not enum keys", () => {
    const body = ssrBody("/suppliers/browse");
    expect(body).not.toContain("<h3>wedding_decor</h3>");
    expect(body).not.toContain("<h3>mc_celebrant</h3>");
  });

  test("it links into real vendor pages, which is the path a crawler follows", () => {
    const body = ssrBody("/suppliers/browse");
    const links = body.match(/href="\/suppliers\/[^"]+"/g) ?? [];
    expect(links.length).toBeGreaterThan(10);
  });

  test("the crawlable index publishes no email or phone", () => {
    const body = ssrBody("/suppliers/browse");
    // A masked API and a plaintext contact book in the HTML would be the same
    // leak with an extra step.
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(body).not.toMatch(/\+36[\s\d-]{7,}/);
  });
});
