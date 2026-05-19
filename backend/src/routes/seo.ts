// Crawler-facing SEO routes: robots.txt and sitemap.xml.
//
// Single-host deployment as of May 2026 — the renderers ignore the Host and
// always emit canonical URLs against weddly.hu, but we still take Host as a
// parameter so the routing signature stays compatible with future
// multi-locale work.

import type { Router } from "../lib/http";
import { renderRobotsTxt, renderSitemapXml } from "../lib/seo_ssr";

const ROBOTS_CACHE = "public, max-age=300, s-maxage=300";
const SITEMAP_CACHE = "public, max-age=300, s-maxage=300";

export function registerSeoRoutes(router: Router): void {
  router.get("/robots.txt", (ctx) => {
    const body = renderRobotsTxt(ctx.req.headers.get("host"));
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": ROBOTS_CACHE,
      },
    });
  });

  router.get("/sitemap.xml", (ctx) => {
    const body = renderSitemapXml(ctx.req.headers.get("host"));
    return new Response(body, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": SITEMAP_CACHE,
      },
    });
  });
}
