// Crawler-facing SEO routes: robots.txt, sitemap.xml and llms.txt.
//
// Single-host deployment as of May 2026 — the renderers ignore the Host and
// always emit canonical URLs against weddly.hu, but we still take Host as a
// parameter so the routing signature stays compatible with future
// multi-locale work.

import type { Router } from "../lib/http";
import { renderLlmsTxt, renderRobotsTxt, renderSitemapXml } from "../lib/seo_ssr";

const ROBOTS_CACHE = "public, max-age=300, s-maxage=300";
const SITEMAP_CACHE = "public, max-age=300, s-maxage=300";
const LLMS_CACHE = "public, max-age=300, s-maxage=300";
const SITEMAP_TTL_MS = 5 * 60 * 1000;
let sitemapMemoryCache: { body: string; expiresAt: number } | null = null;

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
    const ts = Date.now();
    const body =
      sitemapMemoryCache && sitemapMemoryCache.expiresAt > ts
        ? sitemapMemoryCache.body
        : renderSitemapXml(ctx.req.headers.get("host"));
    if (!sitemapMemoryCache || sitemapMemoryCache.expiresAt <= ts) {
      sitemapMemoryCache = { body, expiresAt: ts + SITEMAP_TTL_MS };
    }
    return new Response(body, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": SITEMAP_CACHE,
      },
    });
  });

  router.get("/llms.txt", (ctx) => {
    const body = renderLlmsTxt(ctx.req.headers.get("host"));
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": LLMS_CACHE,
      },
    });
  });
}
