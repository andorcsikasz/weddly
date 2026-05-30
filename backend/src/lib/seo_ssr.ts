// Single-domain SEO rendering.
//
// Up to May 2026 we ran two TLDs in parallel — weddly.hu = HU canonical,
// weddly.xyz = EN canonical — with cross-host hreflang. The .xyz project was
// retired (one DB, one canonical) and weddly.xyz now 301-redirects to
// weddly.hu, so search engines following the old hreflang chains would just
// de-index the EN alternate.
//
// Today: weddly.hu is the only canonical. The locale of the SSR'd HTML
// (which is what Googlebot indexes pre-JS) branches on the request's
// `Accept-Language` header — HU-preferring clients see the HU landing +
// HU meta; everyone else (the strategic international audience + most
// crawlers, which advertise `en-US`) sees the EN variant. Clients still
// flip locale at runtime via localStorage + the language switcher, so an
// HU user landing on the EN SSR shell snaps back to HU after hydration.
// `Host` is retained in the signal for the future host-based path (e.g.
// adding a separate weddly.com EN-canonical) but ignored today.

import type { BlogBlock } from "../../../shared/blog_posts";
import { SEO_FAQ } from "../../../shared/seo_faq";
import { enPathFor, huPathFor, lookupRouteSeo, type RouteSeo } from "../../../shared/seo_routes";
import { db } from "../db";
import { normalizeSlugInput } from "../domain/slug";

export const HU_HOST = "weddly.hu";
/** Canonical host for every public URL in SEO output. */
export const CANONICAL_HOST = HU_HOST;

export type SeoLocale = "hu" | "en";

interface SitemapPath {
  path: string;
  priority: string;
  changefreq: string;
}

/** Static public paths. Blog post URLs are added dynamically at sitemap
 *  render time (see `publishedBlogPostPaths`) so admin edits ship into the
 *  sitemap without a backend redeploy.
 *
 *  Anything under /app, /onboarding, /invite/, /rsvp/, /reset-password/ is
 *  private-by-token and stays in robots.txt Disallow. Keep in sync with
 *  frontend/src/App.tsx public routes. */
const STATIC_PUBLIC_PATHS: ReadonlyArray<SitemapPath> = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  // Tool pages — high SEO value (each targets a long-tail HU query the
  // landing can't rank for on its own) so they get a higher priority than
  // the auth flows. Same path on both hosts; the locale switch happens via
  // Host header just like the landing.
  { path: "/eszkozok/eskuvo-koltsegvetes-kalkulator", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/eskuvo-visszaszamlalo", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/vendeglista-sablon", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/ultetesi-rend-keszito", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/rsvp-szoveg-generator", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/100-kerdes-eskuvo-elott", priority: "0.8", changefreq: "monthly" },
  { path: "/signup", priority: "0.7", changefreq: "monthly" },
  { path: "/blog", priority: "0.6", changefreq: "weekly" },
  { path: "/vendors", priority: "0.6", changefreq: "monthly" },
  { path: "/about", priority: "0.5", changefreq: "monthly" },
  { path: "/login", priority: "0.5", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/subscription-terms", priority: "0.3", changefreq: "yearly" },
  { path: "/imprint", priority: "0.3", changefreq: "yearly" },
];

/** Per-post URLs read from the `blog_posts` table at request time. Drafts
 *  (`is_published = 0`) are excluded so a half-written post doesn't end up
 *  in Google's index before the admin flips it live. */
function publishedBlogPostPaths(): SitemapPath[] {
  const rows = db
    .prepare("SELECT slug FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC")
    .all() as { slug: string }[];
  return rows.map((r) => ({
    path: `/blog/${r.slug}`,
    priority: "0.5",
    changefreq: "monthly",
  }));
}

/** `/blog/:slug` SSR meta lookup. Returns null for non-blog paths and for
 *  any slug that doesn't resolve (or whose post is a draft). The shared
 *  `lookupRouteSeo` no longer knows about blog posts — keeping the DB read
 *  here means admin edits land in the SSR'd <head> on the next request
 *  without a backend redeploy. */
function lookupBlogPostSeo(pathname: string): RouteSeo | null {
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1] ?? "";
  if (!slug) return null;
  const row = db
    .prepare(
      "SELECT hu_title, hu_lead, hu_seo_title, hu_seo_description, en_title, en_lead, en_seo_title, en_seo_description FROM blog_posts WHERE slug = ? AND is_published = 1",
    )
    .get(slug) as
    | {
        hu_title: string;
        hu_lead: string;
        hu_seo_title: string;
        hu_seo_description: string;
        en_title: string;
        en_lead: string;
        en_seo_title: string;
        en_seo_description: string;
      }
    | undefined;
  if (!row) return null;
  return {
    hu: {
      title: row.hu_seo_title,
      description: row.hu_seo_description,
      h1: row.hu_title,
      intro: row.hu_lead,
    },
    en: {
      title: row.en_seo_title,
      description: row.en_seo_description,
      h1: row.en_title,
      intro: row.en_lead,
    },
  };
}

/** Resolve route SEO: tries the blog DB first, then the static route map.
 *  Wraps `lookupRouteSeo` so the rest of seo_ssr.ts doesn't have to care
 *  whether a path is blog-backed or static. */
function resolveRouteSeo(pathname: string): RouteSeo | null {
  return lookupBlogPostSeo(pathname) ?? lookupRouteSeo(pathname);
}

interface BlogArticleMeta {
  huTitle: string;
  enTitle: string;
  /** 'YYYY-MM-DD'. */
  publishedAt: string;
  /** Epoch ms (db.now()). */
  updatedAt: number;
  coverImageUrl: string | null;
}

/** Article-level fields for the `/blog/:slug` JSON-LD (dates, cover image,
 *  per-locale headline). Separate from `lookupBlogPostSeo` because the SSR
 *  <head> meta only needs SEO title/description, whereas the Article schema
 *  also needs datePublished / dateModified / image. Returns null for
 *  non-blog paths and drafts (same `is_published = 1` predicate). */
function lookupBlogArticleMeta(pathname: string): BlogArticleMeta | null {
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1] ?? "";
  if (!slug) return null;
  const row = db
    .prepare(
      "SELECT hu_title, en_title, published_at, updated_at, cover_image_url FROM blog_posts WHERE slug = ? AND is_published = 1",
    )
    .get(slug) as
    | {
        hu_title: string;
        en_title: string;
        published_at: string;
        updated_at: number;
        cover_image_url: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    huTitle: row.hu_title,
    enTitle: row.en_title,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    coverImageUrl: row.cover_image_url,
  };
}

/** True for the public free-tool landing pages (`/eszkozok/*` HU and
 *  `/tools/*` EN). Each gets its own WebApplication + BreadcrumbList JSON-LD
 *  so AI engines and Google rich results treat them as discrete free tools
 *  rather than slices of the brand landing. */
function isToolPath(pathname: string): boolean {
  return /^\/(?:eszkozok|tools)\//.test(pathname);
}

/** Full article body blocks for `/blog/:slug`, parsed from the locale's
 *  `*_body_json` column. Returns null for non-blog paths, drafts, or
 *  unparseable JSON. Used to bake the whole post (not just h1 + lead) into
 *  the SSR HTML so AI/HTML-first crawlers read the real content instead of
 *  the JS-only render that drove the audit's 621% rendered-content flag. */
function lookupBlogPostBody(pathname: string, locale: SeoLocale): BlogBlock[] | null {
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1] ?? "";
  if (!slug) return null;
  const column = locale === "hu" ? "hu_body_json" : "en_body_json";
  const row = db
    .prepare(`SELECT ${column} AS body FROM blog_posts WHERE slug = ? AND is_published = 1`)
    .get(slug) as { body: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.body) as BlogBlock[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Escape text node content (not attributes). Quotes are safe in text. */
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render BlogBlock[] to semantic HTML for the SSR body. Mirrors the block
 *  types the React BlogPostPage renders so a crawler's SSR-vs-JS text diff
 *  stays trivial (Google flags large divergence as cloaking). */
function renderBlogBlocks(blocks: BlogBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "p":
        parts.push(`<p>${escapeText(block.text)}</p>`);
        break;
      case "h2":
        parts.push(`<h2>${escapeText(block.text)}</h2>`);
        break;
      case "h3":
        parts.push(`<h3>${escapeText(block.text)}</h3>`);
        break;
      case "ul":
        parts.push(`<ul>${block.items.map((i) => `<li>${escapeText(i)}</li>`).join("")}</ul>`);
        break;
      case "blockquote": {
        const body = block.text
          .split("\n\n")
          .map((p) => `<p>${escapeText(p)}</p>`)
          .join("");
        parts.push(`<blockquote>${body}<cite>${escapeText(block.cite)}</cite></blockquote>`);
        break;
      }
      case "cta":
        parts.push(`<p><a href="${escapeAttr(block.href)}">${escapeText(block.label)}</a></p>`);
        break;
    }
  }
  return parts.join("\n        ");
}

/** Absolute URL for a cover image that may be stored relative
 *  (`/uploads/blog/…`) or already absolute (admin-pasted http(s)). */
function absoluteImageUrl(origin: string, url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${origin}${url}`;
}

interface LocaleMeta {
  lang: string;
  ogLocale: string;
  title: string;
  description: string;
  twDescription: string;
  ogImageAlt: string;
  /** Human "product name" used in Organization / SoftwareApplication JSON-LD. */
  brandName: string;
  /** Short description for Organization schema. */
  brandDescription: string;
}

const META: Record<SeoLocale, LocaleMeta> = {
  hu: {
    lang: "hu",
    ogLocale: "hu_HU",
    title: "Wēddly · Közös esküvőtervezés egy helyen",
    // Kept inside the 120-160 char SERP window (see meta-length guard in
    // tests/api/seo_meta_length.e2e.test.ts). The May 2026 audit flagged the old 166-char
    // description as over the cap.
    description:
      "Tervezzétek együtt az esküvőtöket egy közös felületen: költségvetés, vendéglista, RSVP, ültetési rend és nyomtatható kártyák. Mindketten ugyanazt látjátok.",
    twDescription: "Közös felület mindkettőtöknek, egy helyen.",
    ogImageAlt: "Wēddly — közösen tervezzétek az esküvőtöket, nyugodtan.",
    brandName: "Wēddly",
    brandDescription:
      "Magyar esküvőtervező webalkalmazás pároknak: költségvetés, vendéglista, RSVP, ültetési rend és nyomtatható kártyák egy közös felületen.",
  },
  en: {
    lang: "en",
    ogLocale: "en_US",
    title: "Weddly · Your shared wedding-planning workspace",
    // Kept inside the 120-160 char SERP window (see meta-length guard in
    // tests/api/seo_meta_length.e2e.test.ts).
    description:
      "Plan your wedding together in one shared workspace: budget, guest list, RSVP, seating and printable cards. Both of you see the same live picture.",
    twDescription: "One shared workspace for both of you, in real time.",
    ogImageAlt: "Weddly — plan your wedding together, calmly.",
    brandName: "Weddly",
    brandDescription:
      "Wedding planning web app for couples: budget, guest list, RSVP, seating chart and printable cards in one shared workspace.",
  },
};

const HEAD_START = "<!-- SEO_HEAD_START -->";
const HEAD_END = "<!-- SEO_HEAD_END -->";

/** Parse an `Accept-Language` header value and return whether the client's
 *  top-preference language is Hungarian. Strict first-tag check: the user's
 *  PRIMARY preference wins; secondary q-weighted fallbacks are ignored on
 *  purpose so e.g. `en-US,en;q=0.9,hu;q=0.5` (most US browsers, with HU as
 *  a courtesy fallback) renders EN — not HU. */
function prefersHungarian(acceptLanguage: string | null | undefined): boolean {
  if (!acceptLanguage) return false;
  const first = acceptLanguage.split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  return first === "hu" || first.startsWith("hu-");
}

/** Optional EN-canonical host (e.g. "weddly.com"). Activated by the
 *  `EN_CANONICAL_HOST` env var; empty/unset = single-host mode (the
 *  historical behaviour, just Accept-Language branching on weddly.hu).
 *  Read fresh on every call so tests can flip the env around assertions
 *  without restarting the server. */
function enCanonicalHostEnv(): string {
  return (process.env.EN_CANONICAL_HOST ?? "").trim().toLowerCase();
}

/** Plausible analytics domain (e.g. "weddly.hu"). Activated by the
 *  `PLAUSIBLE_DOMAIN` env var; empty/unset = no analytics script injected.
 *  Read fresh on every call so tests can flip it around assertions without a
 *  server restart. plausible.io is already whitelisted in the CSP
 *  (script-src + connect-src) in server.ts. */
function plausibleDomainEnv(): string {
  return (process.env.PLAUSIBLE_DOMAIN ?? "").trim();
}

/** The Plausible <script> tag (head, deferred, cookieless) or "" when unset. */
function plausibleScriptTag(): string {
  const domain = plausibleDomainEnv();
  if (!domain) return "";
  return `<script defer data-domain="${escapeAttr(domain)}" src="https://plausible.io/js/script.js"></script>`;
}

/** True when the request landed on the configured EN canonical host. Used
 *  by `localeForHost` to force EN regardless of `Accept-Language`. */
function hostIsEnCanonical(host: string | null | undefined): boolean {
  const en = enCanonicalHostEnv();
  if (!en || !host) return false;
  return host.toLowerCase() === en;
}

/** SEO locale for a request. Two-tier signal:
 *   1. Host-driven: visits to the EN canonical (e.g. `weddly.com`) always
 *      render EN — that's the multi-host pair Google expects for an
 *      `hreflang="en"` alternate to be meaningful.
 *   2. Accept-Language: HU-preferring clients get HU; everyone else gets EN.
 *      Strict first-tag check — see `prefersHungarian`.
 *  `acceptLanguage=null/undefined` defaults to HU for back-compat with old
 *  callers and the SEO test suite. Production callers always pass the
 *  real header. */
export function localeForHost(
  host: string | null | undefined,
  acceptLanguage: string | null | undefined = null,
): SeoLocale {
  if (hostIsEnCanonical(host)) return "en";
  if (acceptLanguage == null) return "hu";
  return prefersHungarian(acceptLanguage) ? "hu" : "en";
}

/** Canonical hostname for SEO link rels. When `EN_CANONICAL_HOST` is set
 *  in the environment, EN renders point to that host (e.g. `weddly.com`)
 *  so the `hreflang` pair can advertise distinct URLs across locales.
 *  When unset, both locales return the HU apex — the single-host
 *  fallback that keeps existing tests + deploys working unchanged. */
export function canonicalHostFor(locale: SeoLocale): string {
  if (locale === "en") {
    const en = enCanonicalHostEnv();
    if (en) return en;
  }
  return HU_HOST;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Build a <script type="application/ld+json"> block for the host + path.
 *
 *  Organization + WebSite go on every page. Then, by page type:
 *   - root: SoftwareApplication + FAQPage (Google's docs: FAQPage must
 *     reflect visible FAQ on the same page, which is the landing).
 *   - /blog/:slug: Article (dated, authored) + BreadcrumbList.
 *   - /eszkozok/* and /tools/*: WebApplication (free tool) + BreadcrumbList.
 *
 *  The blog/tool blocks turn the strongest long-tail + AI-citation assets
 *  into dated, attributable, machine-readable entities. They're SSR-injected
 *  into <head> before hydration, so they survive a JS-light crawl. */
function buildJsonLd(opts: {
  locale: SeoLocale;
  canonicalHost: string;
  pathname: string;
}): string {
  const meta = META[opts.locale];
  const origin = `https://${opts.canonicalHost}`;
  const path = opts.pathname || "/";
  const inLanguage = opts.locale === "hu" ? "hu-HU" : "en-US";
  const priceCurrency = opts.locale === "hu" ? "HUF" : "EUR";
  const organization = {
    "@type": "Organization",
    name: meta.brandName,
    url: origin,
    logo: `${origin}/logo.png`,
  };
  const blocks: object[] = [
    {
      "@context": "https://schema.org",
      ...organization,
      description: meta.brandDescription,
      sameAs: [`https://${CANONICAL_HOST}`],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: meta.brandName,
      url: origin,
      inLanguage,
    },
  ];

  // Localised breadcrumb labels (Home / Blog).
  const crumbLabels =
    opts.locale === "hu"
      ? { home: "Főoldal", blog: "Esküvői magazin" }
      : { home: "Home", blog: "Wedding blog" };

  if (path === "/" || path === "") {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: meta.brandName,
      description: meta.description,
      applicationCategory: "LifestyleApplication",
      operatingSystem: "Web",
      url: origin,
      // `priceCurrency` follows the SSR locale so the EN landing's structured
      // data quotes EUR instead of HUF — a London or Berlin visitor reading
      // the rich-result snippet shouldn't see a Hungarian-forint price tag,
      // even though every Weddly plan is currently free during open beta.
      offers: { "@type": "Offer", price: "0", priceCurrency },
    });
    blocks.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: SEO_FAQ[opts.locale].map((entry) => ({
        "@type": "Question",
        name: entry.q,
        acceptedAnswer: { "@type": "Answer", text: entry.a },
      })),
    });
  } else {
    const article = lookupBlogArticleMeta(path);
    if (article) {
      const headline = opts.locale === "hu" ? article.huTitle : article.enTitle;
      const image = absoluteImageUrl(origin, article.coverImageUrl);
      blocks.push({
        "@context": "https://schema.org",
        "@type": "Article",
        headline,
        datePublished: article.publishedAt,
        dateModified: new Date(article.updatedAt).toISOString(),
        ...(image ? { image } : {}),
        author: organization,
        publisher: {
          "@type": "Organization",
          name: meta.brandName,
          logo: { "@type": "ImageObject", url: `${origin}/logo.png` },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": `${origin}${path}` },
        inLanguage,
      });
      blocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: crumbLabels.home, item: `${origin}/` },
          { "@type": "ListItem", position: 2, name: crumbLabels.blog, item: `${origin}/blog` },
          { "@type": "ListItem", position: 3, name: headline, item: `${origin}${path}` },
        ],
      });
    } else if (isToolPath(path)) {
      const routeSeo = lookupRouteSeo(path);
      const entry = routeSeo?.[opts.locale];
      if (entry) {
        blocks.push({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: entry.h1,
          description: entry.description,
          url: `${origin}${path}`,
          applicationCategory: "LifestyleApplication",
          operatingSystem: "Web",
          isPartOf: { "@type": "WebSite", name: meta.brandName, url: origin },
          offers: { "@type": "Offer", price: "0", priceCurrency },
          inLanguage,
        });
        blocks.push({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: crumbLabels.home, item: `${origin}/` },
            { "@type": "ListItem", position: 2, name: entry.h1, item: `${origin}${path}` },
          ],
        });
      }
    }
  }
  // Each block in its own <script> tag (Google's recommended pattern; easier
  // for testing-tool diffs than one combined array).
  return blocks
    .map((b) => {
      // Escape `</` to avoid breaking out of the <script> if a string ever
      // contains a closing tag. JSON.stringify already escapes nothing else
      // that matters here.
      const json = JSON.stringify(b).replace(/<\//g, "<\\/");
      return `<script type="application/ld+json">${json}</script>`;
    })
    .join("\n    ");
}

/** Build the SEO `<head>` block (everything between the sentinels) for the
 *  given host + path. Returns just the inner block — the caller splices it
 *  into the template between the sentinels.
 *
 *  Per-route title/description override (from shared/seo_routes.ts) is what
 *  stops every public URL from re-using the landing's meta — Googlebot's
 *  HTML-only crawl then sees a distinct title + description per indexed
 *  page instead of "the same page repeated nine times". */
/** Slug-to-meta lookup for the public wedding website (`/w/:slug`). Returns
 *  null if the path isn't a wedding URL, the slug doesn't resolve, the
 *  workspace isn't active, OR the couple hasn't opted in (`is_public = 0`).
 *  Same SELECT predicate as `routes/public_wedding.ts:resolveCoupleBySlug`
 *  so the SSR <head> and the JSON endpoint can never disagree. */
export interface WeddingSiteMeta {
  display_name: string;
  wedding_date: string | null;
  venue_name: string | null;
  cover_image_url: string | null;
}

const WEDDING_PATH_RE = /^\/w\/([^/?#]+)/;

export function lookupWeddingSiteMeta(pathname: string | null | undefined): WeddingSiteMeta | null {
  if (!pathname) return null;
  const m = WEDDING_PATH_RE.exec(pathname);
  if (!m) return null;
  const slugRaw = decodeURIComponent(m[1] ?? "");
  if (!slugRaw || slugRaw.length > 64) return null;
  const slug = normalizeSlugInput(slugRaw);
  if (!slug) return null;
  const row = db
    .prepare(
      "SELECT display_name, wedding_date, venue_name, cover_image_url FROM couples WHERE slug = ? AND status = 'active' AND is_public = 1",
    )
    .get(slug) as
    | {
        display_name: string;
        wedding_date: string | null;
        venue_name: string | null;
        cover_image_url: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    display_name: row.display_name,
    wedding_date: row.wedding_date,
    venue_name: row.venue_name,
    cover_image_url: row.cover_image_url,
  };
}

function buildHeadBlock(opts: {
  host: string | null;
  pathname: string;
  isRsvp: boolean;
  /** Forwarded from the request so the SSR'd `<head>` advertises the right
   *  lang/og:locale to crawlers. Optional so server.ts can pass the real
   *  header and the SEO test suite can omit it (keeping the HU baseline). */
  acceptLanguage?: string | null;
  /** Couple-specific overrides for the `/w/:slug` route. When present, the
   *  `<title>` + meta description + OG/Twitter title+description switch
   *  to a personalised string and `cover_image_url` (if set) replaces
   *  the brand og.png. The whole viral loop hinges on this — the share
   *  card on FB / WhatsApp / iMessage must say "Anna & Bence · 12 Sept 2026"
   *  and show their cover image, not "Plan your wedding together". */
  weddingMeta?: WeddingSiteMeta | null;
}): string {
  const locale = localeForHost(opts.host, opts.acceptLanguage ?? null);
  const defaultMeta = META[locale];
  const altDefaultMeta = META[locale === "hu" ? "en" : "hu"];
  const canonicalHost = canonicalHostFor(locale);
  const path = opts.pathname || "/";
  // Slug-pair lookup so the HU canonical always points to the HU slug and
  // the EN canonical always points to the EN slug, even if the visitor
  // landed on the "wrong" half of the pair (e.g. `weddly.com/eszkozok/X`
  // → canonical sends them to the EN slug on the EN host).
  const huPath = huPathFor(path);
  const enPath = enPathFor(path);
  const huUrl = `https://${CANONICAL_HOST}${huPath}`;
  // EN alternate URL resolution:
  //   1. `EN_CANONICAL_HOST` set  -> EN lives on its own host (e.g. weddly.com).
  //   2. single-host + paired slug -> the route has a DISTINCT EN slug on the
  //      same canonical host (the tools: /eszkozok/X vs /tools/X). That's a
  //      real, non-duplicate URL, so an hreflang="en" alternate is correct
  //      and surfaces the EN tool page for indexing.
  //   3. single-host + non-paired  -> HU and EN share ONE URL (landing, blog,
  //      about) via Accept-Language. Emitting an EN alternate that points back
  //      at the HU canonical is the duplicate-canonical trap, so we skip it.
  const enHostConfigured = enCanonicalHostEnv();
  let enUrl: string | null;
  if (enHostConfigured) {
    enUrl = `https://${enHostConfigured}${enPath}`;
  } else if (enPath !== huPath) {
    enUrl = `https://${CANONICAL_HOST}${enPath}`;
  } else {
    enUrl = null;
  }
  // Canonical follows the locale of the current render: HU render → HU URL
  // with HU slug; EN render (only meaningful when multi-host is active) →
  // EN URL with EN slug. Falls back to the path-on-canonical-host shape
  // for non-paired routes — `huPathFor`/`enPathFor` return `path` itself
  // for anything outside `SLUG_PAIRS`, so /about, /signup, /vendors etc.
  // keep their historical canonical exactly.
  const canonicalUrl = locale === "en" && enUrl ? enUrl : huUrl;
  // Couple-specific OG image when the couple set a cover URL; falls back
  // to /og-rsvp.png on RSVP routes and the brand /og.png everywhere else.
  // External URLs are passed through as-is (couple-pasted Imgur / Cloudinary).
  let ogImage: string;
  if (opts.weddingMeta?.cover_image_url) {
    ogImage = opts.weddingMeta.cover_image_url;
  } else if (opts.isRsvp) {
    ogImage = `https://${canonicalHost}/og-rsvp.png`;
  } else {
    ogImage = `https://${canonicalHost}/og.png`;
  }

  // Route-specific title + description take precedence over the landing
  // defaults so each public path ships a unique <title> / description in
  // the initial HTML. Twitter description, og image, locales etc. stay
  // from the landing META (those are brand-level, not page-level).
  // The wedding-site override is highest priority — couple-personalised
  // share cards beat both route SEO and brand defaults.
  let title: string;
  let description: string;
  let twDescription: string;
  if (opts.weddingMeta) {
    const wm = opts.weddingMeta;
    const dateBlock = wm.wedding_date ?? "";
    const venueBlock = wm.venue_name ? ` · ${wm.venue_name}` : "";
    title = `${wm.display_name}${dateBlock ? ` · ${dateBlock}` : ""}${venueBlock}`;
    // Localised description sentence — same shape for HU + EN, just the
    // connector word changes. Keeps the share-card body warm without
    // having to drop the names into a long brand pitch.
    description =
      locale === "hu"
        ? `${wm.display_name} esküvői oldala — programterv, helyszín, RSVP.`
        : `${wm.display_name} — schedule, venue and RSVP in one place.`;
    twDescription = description;
  } else {
    const routeSeo = resolveRouteSeo(path);
    title = routeSeo ? routeSeo[locale].title : defaultMeta.title;
    description = routeSeo ? routeSeo[locale].description : defaultMeta.description;
    twDescription = routeSeo ? routeSeo[locale].description : defaultMeta.twDescription;
  }

  return [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<meta name="application-name" content="${escapeAttr(defaultMeta.brandName)}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Wēddly" />`,
    `<meta property="og:locale" content="${defaultMeta.ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${altDefaultMeta.ogLocale}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(defaultMeta.ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(twDescription)}" />`,
    `<meta name="twitter:image" content="${ogImage}" />`,
    `<link rel="alternate" hreflang="hu" href="${huUrl}" />`,
    ...(enUrl ? [`<link rel="alternate" hreflang="en" href="${enUrl}" />`] : []),
    `<link rel="alternate" hreflang="x-default" href="${huUrl}" />`,
    buildJsonLd({ locale, canonicalHost, pathname: path }),
    ...(plausibleScriptTag() ? [plausibleScriptTag()] : []),
  ].join("\n    ");
}

/** Build a tiny route-specific SSR body (h1 + intro + footer nav). Returns
 *  null for the landing and unknown paths — those keep whatever body the
 *  prerender script baked into the template. Used by renderIndexHtml below
 *  to give Googlebot a distinct <h1> + paragraph on each public URL
 *  instead of nine copies of the landing's hero. */
function renderRouteBody(pathname: string, locale: SeoLocale): string | null {
  const routeSeo = resolveRouteSeo(pathname);
  if (!routeSeo) return null;
  const entry = routeSeo[locale];
  // Footer link target for the imprint route depends on locale (HU mounts at
  // /impresszum, EN at /imprint — both reach the same React page).
  const imprintHref = locale === "hu" ? "/impresszum" : "/imprint";
  const labels =
    locale === "hu"
      ? {
          about: "Rólunk",
          privacy: "Adatvédelem",
          terms: "Felhasználási feltételek",
          imprint: "Impresszum",
          signup: "Regisztráció",
          login: "Bejelentkezés",
          vendors: "Szolgáltatóknak",
          home: "Főoldal",
        }
      : {
          about: "About",
          privacy: "Privacy",
          terms: "Terms",
          imprint: "Imprint",
          signup: "Sign up",
          login: "Sign in",
          vendors: "For vendors",
          home: "Home",
        };
  // Blog posts bake their full body (every paragraph, heading, list and
  // quote) so the SSR HTML carries the whole 7-9 minute read, not just the
  // lead. Tool/static routes keep the lean h1 + intro (their unique copy
  // lives in React components, not in shared data).
  const blogBlocks = lookupBlogPostBody(pathname, locale);
  const articleHtml = blogBlocks
    ? `<article>\n        ${renderBlogBlocks(blogBlocks)}\n      </article>`
    : null;

  return [
    `<header>`,
    `  <h1>${escapeAttr(entry.h1)}</h1>`,
    `  <p>${escapeAttr(entry.intro)}</p>`,
    `</header>`,
    ...(articleHtml ? [articleHtml] : []),
    `<footer>`,
    `  <nav>`,
    `    <a href="/">${escapeAttr(labels.home)}</a> · `,
    `    <a href="/signup">${escapeAttr(labels.signup)}</a> · `,
    `    <a href="/login">${escapeAttr(labels.login)}</a> · `,
    `    <a href="/vendors">${escapeAttr(labels.vendors)}</a> · `,
    `    <a href="/about">${escapeAttr(labels.about)}</a> · `,
    `    <a href="/privacy">${escapeAttr(labels.privacy)}</a> · `,
    `    <a href="/terms">${escapeAttr(labels.terms)}</a> · `,
    `    <a href="${imprintHref}">${escapeAttr(labels.imprint)}</a>`,
    `  </nav>`,
    `</footer>`,
  ].join("\n      ");
}

const BODY_START = "<!-- SEO_BODY_START -->";
const BODY_END = "<!-- SEO_BODY_END -->";

/** Splice the host-aware `<head>` block into the index.html template,
 *  replacing whatever sits between `<!-- SEO_HEAD_START -->` and
 *  `<!-- SEO_HEAD_END -->`. Also flips the `<html lang>` attribute and,
 *  for known non-landing routes, replaces the prerendered landing body
 *  with a route-specific h1 + intro between
 *  `<!-- SEO_BODY_START -->` / `<!-- SEO_BODY_END -->`. */
export function renderIndexHtml(
  template: string,
  opts: {
    host: string | null;
    pathname: string;
    isRsvp: boolean;
    /** Raw `Accept-Language` request header. Optional — when omitted, locale
     *  resolution falls back to the historical HU default. Production
     *  callers in server.ts forward the real header so the SSR'd HTML
     *  advertises the right lang/og:locale per request. */
    acceptLanguage?: string | null;
  },
): string {
  const locale = localeForHost(opts.host, opts.acceptLanguage ?? null);
  // Look up the couple meta once at the boundary — `buildHeadBlock` is a
  // pure string-builder so we keep the DB read here.
  const weddingMeta = lookupWeddingSiteMeta(opts.pathname);
  const head = buildHeadBlock({ ...opts, weddingMeta });

  // Splice the <head> block.
  let out: string;
  const startIdx = template.indexOf(HEAD_START);
  const endIdx = template.indexOf(HEAD_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Template lost its sentinels (build mishap / hand-edit). Fail open: serve
    // the template unchanged rather than 500.
    out = template;
  } else {
    const before = template.slice(0, startIdx + HEAD_START.length);
    const after = template.slice(endIdx);
    out = `${before}\n    ${head}\n    ${after}`;
  }

  // Splice the route-specific body if this is a known non-landing public
  // route. For "/" and unknown paths we keep whatever body the prerender
  // script baked into the template — that's already the rich landing body
  // on landing files, and the same body is harmless as a fallback for
  // unknown paths.
  const routeBody = renderRouteBody(opts.pathname || "/", locale);
  if (routeBody) {
    const bodyStartIdx = out.indexOf(BODY_START);
    const bodyEndIdx = out.indexOf(BODY_END);
    if (bodyStartIdx !== -1 && bodyEndIdx !== -1 && bodyEndIdx > bodyStartIdx) {
      const before = out.slice(0, bodyStartIdx + BODY_START.length);
      const after = out.slice(bodyEndIdx);
      out = `${before}\n      ${routeBody}\n      ${after}`;
    }
  }

  return out.replace(/<html lang="[^"]*"/, `<html lang="${META[locale].lang}"`);
}

export function renderRobotsTxt(_host: string | null): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /onboarding",
    "Disallow: /invite/",
    "Disallow: /rsvp/",
    "Disallow: /reset-password/",
    "",
    `Sitemap: https://${CANONICAL_HOST}/sitemap.xml`,
    "",
  ].join("\n");
}

/** /llms.txt — the proposed standard that points LLMs/AI search engines at a
 *  site's most useful, citable content. Generated (not hand-maintained) from
 *  the same tool route table + blog_posts query that feed the sitemap, so it
 *  never drifts out of sync. English-primary because the international
 *  audience is the strategic focus and most AI crawlers advertise en-US; the
 *  canonical URLs serve the matching locale via Accept-Language. */
export function renderLlmsTxt(_host: string | null): string {
  const origin = `https://${CANONICAL_HOST}`;
  const lines: string[] = [
    "# Weddly",
    "",
    "> Weddly is a shared wedding-planning workspace for couples: budget, guest list, RSVP links, a visual drag-and-drop seating chart and printable place/seating cards, all in one place that both partners edit in real time. Free during the open beta.",
    "",
  ];

  // Free tools — the strongest citable assets (each answers a high-intent
  // wedding query). List the EN canonical slug with the EN title/description.
  const toolPaths = STATIC_PUBLIC_PATHS.filter((p) => isToolPath(p.path));
  if (toolPaths.length > 0) {
    lines.push("## Free wedding tools", "");
    for (const { path } of toolPaths) {
      const seo = lookupRouteSeo(path);
      if (!seo) continue;
      lines.push(`- [${seo.en.h1}](${origin}${enPathFor(path)}): ${seo.en.description}`);
    }
    lines.push("");
  }

  // Published blog posts grouped by category. EN fields; HU-slug URLs (single
  // host) that serve EN copy to en-US crawlers.
  const posts = db
    .prepare(
      "SELECT slug, en_title, en_seo_description, en_category FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC",
    )
    .all() as {
    slug: string;
    en_title: string;
    en_seo_description: string;
    en_category: string;
  }[];
  if (posts.length > 0) {
    lines.push("## Wedding blog", "");
    const byCategory = new Map<string, typeof posts>();
    for (const post of posts) {
      const cat = post.en_category || "Articles";
      const bucket = byCategory.get(cat) ?? [];
      bucket.push(post);
      byCategory.set(cat, bucket);
    }
    for (const [category, bucket] of byCategory) {
      lines.push(`### ${category}`);
      for (const post of bucket) {
        lines.push(`- [${post.en_title}](${origin}/blog/${post.slug}): ${post.en_seo_description}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "## Key pages",
    "",
    `- [About Weddly](${origin}/about): What Weddly is and who it's for.`,
    `- [For vendors](${origin}/vendors): How wedding vendors can join the directory.`,
    `- [Blog index](${origin}/blog): All wedding-planning articles.`,
    "",
  );

  return lines.join("\n");
}

// Captured at module-load (== deploy) time so every URL in the sitemap
// shares the same lastmod for this revision. Google ignores <priority> and
// <changefreq> per their docs; <lastmod> is the only signal in this trio
// they actually use to schedule recrawl.
const SITEMAP_LASTMOD = new Date().toISOString().slice(0, 10);

export function renderSitemapXml(_host: string | null): string {
  // Mirror the head-block hreflang policy: emit the EN alternate when
  // `EN_CANONICAL_HOST` is configured OR (single-host) when the route has a
  // distinct EN slug. Non-paired routes stay hu + x-default only.
  const enHostConfigured = enCanonicalHostEnv();

  function buildUrlBlock(
    loc: string,
    huHref: string,
    enHref: string | null,
    priority: string,
    changefreq: string,
  ): string {
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${SITEMAP_LASTMOD}</lastmod>`,
      `    <xhtml:link rel="alternate" hreflang="hu" href="${huHref}" />`,
      ...(enHref ? [`    <xhtml:link rel="alternate" hreflang="en" href="${enHref}" />`] : []),
      // x-default stays HU per Google's docs: it's the fallback for crawlers
      // that don't advertise a locale preference, and the HU canonical is
      // the historical default for this product.
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${huHref}" />`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      "  </url>",
    ].join("\n");
  }

  const blocks: string[] = [];
  const allPaths: ReadonlyArray<SitemapPath> = [
    ...STATIC_PUBLIC_PATHS,
    ...publishedBlogPostPaths(),
  ];
  for (const { path, priority, changefreq } of allPaths) {
    const huPath = huPathFor(path);
    const enPath = enPathFor(path);
    const huHere = `https://${CANONICAL_HOST}${huPath}`;
    const enHere = enHostConfigured
      ? `https://${enHostConfigured}${enPath}`
      : enPath !== huPath
        ? `https://${CANONICAL_HOST}${enPath}`
        : null;
    // 1. HU canonical <url>: <loc> on weddly.hu/{huPath}, alternates point at
    //    self (hu) + paired EN URL when multi-host is on.
    blocks.push(buildUrlBlock(huHere, huHere, enHere, priority, changefreq));
    // 2. When multi-host is on AND the path has a distinct EN slug pair,
    //    emit a parallel <url> for the EN canonical so the EN slug gets its
    //    own <loc> entry instead of only appearing as an alternate. This is
    //    the bidirectional pair Google expects per their hreflang docs.
    if (enHere && enPath !== huPath) {
      blocks.push(buildUrlBlock(enHere, huHere, enHere, priority, changefreq));
    }
  }
  const urls = blocks.join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    urls,
    `</urlset>`,
    "",
  ].join("\n");
}
