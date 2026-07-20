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

## Deferred code work — DONE (2026-07-20)

The old blocker (a concurrent currency-preference feature breaking `bun run
build`) is long gone; the build is green. Both items shipped:

- **Per-tool FAQPage JSON-LD. DONE.** The 19 Q/A pairs per locale moved out of
  the frontend `tools.*` locale tree into **`shared/tool_faq.ts`**, mirroring
  the `shared/seo_faq.ts` pattern exactly: `seo_ssr.ts` emits them as the
  `FAQPage` block in the `isToolPath` branch, and the six React tool pages
  render the same array into their visible `<details>` cards. The keys were
  DELETED from `hu.ts`/`en.ts`/`keys.ts` rather than duplicated, so the
  structured data and the visible prose cannot drift — which is the whole point,
  since a divergence there is what Google treats as cloaking.
- **Bake `/tools/*` bodies into SSR. DONE (the prose that matters).** Because
  the FAQ now lives in `shared/`, `renderRouteBody` bakes it into an
  `<article>` on every tool path, in the same q→`h2` / a→`p` shape the visible
  cards use. Tool pages previously shipped only h1 + intro server-side; they now
  carry their full FAQ prose too.
  - **Deliberately NOT lifted:** the rest of `tools.*` is interactive
    calculator/generator microcopy (labels, placeholders, plurals, interpolated
    strings like `"{n} / {total}"`), not prose. Moving it out of the locale tree
    would drag it away from the `t()` plural/interpolation machinery to bake
    text nobody searches for. `CoupleCardsPage` is the clearest case: its real
    substance is the 100 questions in `frontend/src/lib/couple_cards.ts`, behind
    an interactive draw/flip UI.

### One correction worth recording

The scoping pass flagged a blocker that turns out not to exist: an SSR-vs-React
locale divergence that would have made baked bodies read as cloaking. In
production it can't happen. `server.ts` calls `localeForHost(host, null)` — it
passes `null` for `Accept-Language` — so **production SSR is always EN**, and
`detectInitial()` in `frontend/src/lib/i18n.tsx` also defaults to EN unless
localStorage says otherwise. The HU branch of `localeForHost` only fires for
tests and internal renders. Note this makes the i18n section of `CLAUDE.md`
stale, which describes both an Accept-Language SSR branch and a
`navigator.language` frontend branch that no longer decide anything.
