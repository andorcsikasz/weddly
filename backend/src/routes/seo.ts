// Crawler-facing SEO routes: robots.txt and sitemap.xml.
//
// These are dynamic — their content depends on the request Host so weddly.hu
// vs weddly.xyz get their own canonical Sitemap line + their own per-host
// URL set. They live as proper routes (not as fall-throughs in
// `tryServeStatic`) so they're reachable regardless of SERVE_FRONTEND and so
// e2e tests can exercise them without spinning up the SPA bundle.

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
