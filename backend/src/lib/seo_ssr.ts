// Geo-targeted SEO rendering for the dual-domain deployment.
//
// weddly.hu = HU canonical, weddly.xyz = EN canonical. The Bun process serves
// both domains from the same app, so the SPA's `index.html`, `robots.txt`,
// and `sitemap.xml` are rendered per request based on the Host header. Google
// then sees two locale-specific, mutually-hreflang'd sites instead of one
// duplicated site, and the share-card scraper for each locale sees its own
// language.
//
// The SPA's runtime `useDocumentMeta` still updates title/description per
// route post-hydration (for the user's tab), but canonical/hreflang/og:url
// stay as whatever this module injects — those are the only signals Google's
// non-JS crawler ever sees.

import { SEO_FAQ } from "../../../shared/seo_faq";
import { lookupRouteSeo } from "../../../shared/seo_routes";

export const HU_HOST = "weddly.hu";
export const EN_HOST = "weddly.xyz";

export type SeoLocale = "hu" | "en";

/** Public, indexable paths. Anything under /app, /onboarding, /invite/,
 *  /rsvp/, /reset-password/ is private-by-token and stays in robots.txt
 *  Disallow. Keep in sync with frontend/src/App.tsx public routes. */
const PUBLIC_PATHS: ReadonlyArray<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  // Tool pages — high SEO value (each targets a long-tail HU query the
  // landing can't rank for on its own) so they get a higher priority than
  // the auth flows. Same path on both hosts; the locale switch happens via
  // Host header just like the landing.
  { path: "/eszkozok/eskuvo-koltsegvetes-kalkulator", priority: "0.8", changefreq: "monthly" },
  { path: "/signup", priority: "0.7", changefreq: "monthly" },
  { path: "/vendors", priority: "0.6", changefreq: "monthly" },
  { path: "/about", priority: "0.5", changefreq: "monthly" },
  { path: "/login", priority: "0.5", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/subscription-terms", priority: "0.3", changefreq: "yearly" },
  { path: "/imprint", priority: "0.3", changefreq: "yearly" },
];

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
    description:
      "Tervezzétek együtt az esküvőtöket egy nyugodt, közös felületen: költségvetés, vendégek, RSVP, ültetés, nyomtatható kártyák. A nyílt béta alatt ingyenes.",
    twDescription: "Közös felület mindkettőtöknek — a nyílt béta alatt ingyenes.",
    ogImageAlt: "Wēddly — közösen tervezzétek az esküvőtöket, nyugodtan.",
    brandName: "Wēddly",
    brandDescription:
      "Magyar esküvőtervező webalkalmazás pároknak: költségvetés, vendéglista, RSVP, ültetési rend és nyomtatható kártyák egy közös felületen.",
  },
  en: {
    lang: "en",
    ogLocale: "en_US",
    title: "Weddly · Your shared wedding-planning workspace",
    description:
      "Plan your wedding together in one calm, shared workspace — budget, guests, RSVP, seating and printable cards. Free throughout the open beta.",
    twDescription: "One shared workspace for both of you — free in the open beta.",
    ogImageAlt: "Weddly — plan your wedding together, calmly.",
    brandName: "Weddly",
    brandDescription:
      "Wedding planning web app for couples: budget, guest list, RSVP, seating chart and printable cards in one shared workspace.",
  },
};

const HEAD_START = "<!-- SEO_HEAD_START -->";
const HEAD_END = "<!-- SEO_HEAD_END -->";

/** Pick the SEO locale for a Host header. The `weddly.xyz` apex + any
 *  subdomain of it map to EN; everything else (weddly.hu, localhost, raw IPs,
 *  Railway preview domains) falls back to HU so dev keeps the long-standing
 *  HU default. */
export function localeForHost(host: string | null | undefined): SeoLocale {
  const h = (host ?? "").toLowerCase().split(":")[0] ?? "";
  if (h === EN_HOST || h.endsWith(`.${EN_HOST}`)) return "en";
  return "hu";
}

export function canonicalHostFor(locale: SeoLocale): string {
  return locale === "en" ? EN_HOST : HU_HOST;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Build a <script type="application/ld+json"> block for the host + path.
 *  Organization + WebSite go on every page; SoftwareApplication + FAQPage
 *  only on the root path (Google's docs: FAQPage must reflect visible FAQ
 *  on the same page, which is the landing). */
function buildJsonLd(opts: {
  locale: SeoLocale;
  canonicalHost: string;
  pathname: string;
}): string {
  const meta = META[opts.locale];
  const origin = `https://${opts.canonicalHost}`;
  const blocks: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: meta.brandName,
      url: origin,
      logo: `${origin}/logo.png`,
      description: meta.brandDescription,
      sameAs: [`https://${HU_HOST}`, `https://${EN_HOST}`],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: meta.brandName,
      url: origin,
      inLanguage: opts.locale === "hu" ? "hu-HU" : "en-US",
    },
  ];
  if (opts.pathname === "/" || opts.pathname === "") {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: meta.brandName,
      description: meta.description,
      applicationCategory: "LifestyleApplication",
      operatingSystem: "Web",
      url: origin,
      offers: { "@type": "Offer", price: "0", priceCurrency: "HUF" },
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
function buildHeadBlock(opts: { host: string | null; pathname: string; isRsvp: boolean }): string {
  const locale = localeForHost(opts.host);
  const defaultMeta = META[locale];
  const altDefaultMeta = META[locale === "hu" ? "en" : "hu"];
  const canonicalHost = canonicalHostFor(locale);
  const path = opts.pathname || "/";
  const canonicalUrl = `https://${canonicalHost}${path}`;
  const huUrl = `https://${HU_HOST}${path}`;
  const enUrl = `https://${EN_HOST}${path}`;
  const ogImage = `https://${canonicalHost}${opts.isRsvp ? "/og-rsvp.png" : "/og.png"}`;

  // Route-specific title + description take precedence over the landing
  // defaults so each public path ships a unique <title> / description in
  // the initial HTML. Twitter description, og image, locales etc. stay
  // from the landing META (those are brand-level, not page-level).
  const routeSeo = lookupRouteSeo(path);
  const title = routeSeo ? routeSeo[locale].title : defaultMeta.title;
  const description = routeSeo ? routeSeo[locale].description : defaultMeta.description;
  const twDescription = routeSeo ? routeSeo[locale].description : defaultMeta.twDescription;

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
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${huUrl}" />`,
    buildJsonLd({ locale, canonicalHost, pathname: path }),
  ].join("\n    ");
}

/** Build a tiny route-specific SSR body (h1 + intro + footer nav). Returns
 *  null for the landing and unknown paths — those keep whatever body the
 *  prerender script baked into the template. Used by renderIndexHtml below
 *  to give Googlebot a distinct <h1> + paragraph on each public URL
 *  instead of nine copies of the landing's hero. */
function renderRouteBody(pathname: string, locale: SeoLocale): string | null {
  const routeSeo = lookupRouteSeo(pathname);
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
  return [
    `<header>`,
    `  <h1>${escapeAttr(entry.h1)}</h1>`,
    `  <p>${escapeAttr(entry.intro)}</p>`,
    `</header>`,
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
  opts: { host: string | null; pathname: string; isRsvp: boolean },
): string {
  const locale = localeForHost(opts.host);
  const head = buildHeadBlock(opts);

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

export function renderRobotsTxt(host: string | null): string {
  const locale = localeForHost(host);
  const canonicalHost = canonicalHostFor(locale);
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /onboarding",
    "Disallow: /invite/",
    "Disallow: /rsvp/",
    "Disallow: /reset-password/",
    "",
    `Sitemap: https://${canonicalHost}/sitemap.xml`,
    "",
  ].join("\n");
}

// Captured at module-load (== deploy) time so every URL in the sitemap
// shares the same lastmod for this revision. Google ignores <priority> and
// <changefreq> per their docs; <lastmod> is the only signal in this trio
// they actually use to schedule recrawl.
const SITEMAP_LASTMOD = new Date().toISOString().slice(0, 10);

export function renderSitemapXml(host: string | null): string {
  const locale = localeForHost(host);
  const canonicalHost = canonicalHostFor(locale);
  const altLocale: SeoLocale = locale === "hu" ? "en" : "hu";
  const altHost = canonicalHostFor(altLocale);

  const urls = PUBLIC_PATHS.map(({ path, priority, changefreq }) => {
    const here = `https://${canonicalHost}${path}`;
    const there = `https://${altHost}${path}`;
    const xDefault = `https://${HU_HOST}${path}`;
    return [
      "  <url>",
      `    <loc>${here}</loc>`,
      `    <lastmod>${SITEMAP_LASTMOD}</lastmod>`,
      `    <xhtml:link rel="alternate" hreflang="${locale}" href="${here}" />`,
      `    <xhtml:link rel="alternate" hreflang="${altLocale}" href="${there}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${xDefault}" />`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      "  </url>",
    ].join("\n");
  }).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    urls,
    `</urlset>`,
    "",
  ].join("\n");
}
