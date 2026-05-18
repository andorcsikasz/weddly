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

export const HU_HOST = "weddly.hu";
export const EN_HOST = "weddly.xyz";

export type SeoLocale = "hu" | "en";

/** Public, indexable paths. Anything under /app, /onboarding, /invite/,
 *  /rsvp/, /reset-password/ is private-by-token and stays in robots.txt
 *  Disallow. Keep in sync with frontend/src/App.tsx public routes. */
const PUBLIC_PATHS: ReadonlyArray<{ path: string; priority: string; changefreq: string }> = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
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
}

const META: Record<SeoLocale, LocaleMeta> = {
  hu: {
    lang: "hu",
    ogLocale: "hu_HU",
    title: "Wēddly — az egész esküvőtök egy helyen",
    description:
      "Költségvetés, vendéglista, RSVP, ültetés és nyomtatványok egy közös felületen. Pár perc beállítás, és estékből percek lesznek.",
    twDescription: "Egy közös felület mindkettőtöknek. A nyílt béta alatt ingyenes.",
    ogImageAlt: "Wēddly — közösen tervezzétek az esküvőtöket, nyugodtan.",
  },
  en: {
    lang: "en",
    ogLocale: "en_US",
    title: "Weddly — your whole wedding in one shared workspace",
    description:
      "Budget, guest list, RSVP links, visual seating and printable cards live together in one shared workspace. Set up in minutes; free throughout the open beta.",
    twDescription: "One shared workspace for both of you. Free throughout the open beta.",
    ogImageAlt: "Weddly — plan your wedding together, calmly.",
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

/** Build the SEO `<head>` block (everything between the sentinels) for the
 *  given host + path. Returns just the inner block — the caller splices it
 *  into the template between the sentinels. */
function buildHeadBlock(opts: { host: string | null; pathname: string; isRsvp: boolean }): string {
  const locale = localeForHost(opts.host);
  const meta = META[locale];
  const altMeta = META[locale === "hu" ? "en" : "hu"];
  const canonicalHost = canonicalHostFor(locale);
  const path = opts.pathname || "/";
  const canonicalUrl = `https://${canonicalHost}${path}`;
  const huUrl = `https://${HU_HOST}${path}`;
  const enUrl = `https://${EN_HOST}${path}`;
  const ogImage = opts.isRsvp ? "/og-rsvp.png" : "/og.png";

  return [
    `<title>${escapeAttr(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Wēddly" />`,
    `<meta property="og:locale" content="${meta.ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${altMeta.ogLocale}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(meta.ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.twDescription)}" />`,
    `<meta name="twitter:image" content="${ogImage}" />`,
    `<link rel="alternate" hreflang="hu" href="${huUrl}" />`,
    `<link rel="alternate" hreflang="en" href="${enUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${huUrl}" />`,
  ].join("\n    ");
}

/** Splice the host-aware `<head>` block into the index.html template,
 *  replacing whatever sits between `<!-- SEO_HEAD_START -->` and
 *  `<!-- SEO_HEAD_END -->`. Also flips the `<html lang>` attribute. */
export function renderIndexHtml(
  template: string,
  opts: { host: string | null; pathname: string; isRsvp: boolean },
): string {
  const locale = localeForHost(opts.host);
  const head = buildHeadBlock(opts);

  const startIdx = template.indexOf(HEAD_START);
  const endIdx = template.indexOf(HEAD_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Template lost its sentinels (build mishap / hand-edit). Fail open: return
    // the template unchanged so we at least serve the page rather than 500.
    return template.replace(/<html lang="[^"]*"/, `<html lang="${META[locale].lang}"`);
  }
  const before = template.slice(0, startIdx + HEAD_START.length);
  const after = template.slice(endIdx);
  const out = `${before}\n    ${head}\n    ${after}`;
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
