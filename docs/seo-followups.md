# SEO follow-ups (non-code handoffs)

Items the May 2026 SEO work surfaced that cannot be done in the codebase. Only
the genuinely new ones are listed here. The email/DNS/storage/analytics basics
already live in [launch-checklist.md](./launch-checklist.md); this file does not
repeat them.

## Do these (new)

- [ ] **Cloudflare single-hop redirect.** The audit flagged ~0.63s lost to a
  multi-hop redirect chain on the first mobile request. The app already does one
  clean hop (`server.ts` redirects legacy/www/.xyz to the apex), but chains form
  at the edge (http to https to www to apex). In Cloudflare: enable **Always Use
  HTTPS** and add one rule that rewrites every variant
  (`http://`, `www.`, `weddly.xyz`) straight to `https://weddly.hu/...` in a
  single 301, before the request reaches Railway.

- [ ] **Google Search Console.** This is the prerequisite that makes any earned
  backlink and indexed page measurable.
  1. Verify the `weddly.hu` property (DNS TXT record via Cloudflare).
  2. Submit `https://weddly.hu/sitemap.xml`.
  3. Confirm the HU/EN `hreflang` pairing is read without errors (the
     International Targeting / coverage reports). EN tool URLs (`/tools/*`) now
     have distinct canonical + hreflang entries.

## Corrections to launch-checklist.md

- **Plausible activation changed.** launch-checklist.md says set
  `VITE_PLAUSIBLE_DOMAIN` and rebuild. The analytics script is now injected
  **server-side** in the SSR `<head>`, gated on a runtime env var. Set
  **`PLAUSIBLE_DOMAIN=weddly.hu`** on Railway (no rebuild needed) and create the
  Plausible site. The old `VITE_PLAUSIBLE_DOMAIN` note is obsolete.

- **Sitemap is dynamic now.** launch-checklist.md mentions editing
  `frontend/public/sitemap.xml` to an absolute domain. That static file is
  superseded: `/sitemap.xml` is generated per request by `renderSitemapXml`
  with absolute `https://weddly.hu` URLs and hreflang alternates, and it
  excludes drafts. No static file to maintain.

## Already covered in launch-checklist.md (do not duplicate)

- SPF / DKIM / DMARC DNS records (Resend): [launch-checklist.md](./launch-checklist.md), section A.
- Cloudflare R2 backup bucket: section C.
- Cookie-banner decision (Plausible is cookieless): section on analytics.

## Deferred code work (blocked on the frontend build)

These are real GEO wins but need the frontend to build again first (a concurrent
currency-preference feature currently breaks `bun run build`):

- **Bake `/tools/*` page bodies into SSR.** Blog bodies are baked; tool pages
  still ship only h1 + intro server-side. Clean fix: lift the per-tool copy out
  of the frontend `tools.*` locale tree into `shared/`, then render it in
  `renderRouteBody` (like the blog) and have the React tool pages read the same
  source. Avoids importing frontend types into backend `tsc`.
- **Per-tool FAQPage JSON-LD.** Same blocker: the tool FAQ text lives in the
  frontend locale tree. Do it together with the tool-body baking once the build
  is green.
