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
  /** Human "product name" used in Organization / SoftwareApplication JSON-LD. */
  brandName: string;
  /** Short description for Organization schema. */
  brandDescription: string;
  /** Per-locale FAQ entries surfaced in FAQPage schema on the root path. Must
   *  match the visible landing-page FAQ exactly — Google flags divergence. */
  faq: ReadonlyArray<{ q: string; a: string }>;
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
    faq: [
      {
        q: "Tényleg ingyenes a Wēddly?",
        a: "Igen — a nyílt béta alatt mindent ingyen használhattok. A v2-ben jönnek majd fizetős csomagok extra funkciókhoz (plusz tárhely, prémium sablonok), de a költségvetés, vendéglista, RSVP és ültetés ingyenes marad.",
      },
      {
        q: "Mindketten tudjuk használni?",
        a: "Igen. Egyikőtök regisztrál, és egy linkkel meghívja a másikat. Ugyanazt a felületet látjátok, mindketten saját belépéssel.",
      },
      {
        q: "Mi történik az adatainkkal?",
        a: "A tiétek. Minden változást auditnaplóban követünk. Bármikor szüneteltethetitek a felületet; ha 30 napon belül visszajöttök, ott folytatjátok, ahol abbahagytátok — ügyfélszolgálatra sincs szükség.",
      },
      {
        q: "Mi történik az adatainkkal az esküvő után?",
        a: "Ott maradnak — addig, ameddig csak szeretnétek, mintha egy esküvői albumot tartanátok a polcon. A Profil oldalról bármikor szüneteltethetitek a felületet: 30 napig megőrizzük az adatokat, utána véglegesen töröljük. A határidőig bármelyikőtök vissza tudja vonni a kérést.",
      },
      {
        q: "Kell hozzá esküvőszervező?",
        a: "Megoldjátok kettesben is — a Wēddly végigvezet a költségvetésen, vendéglistán és ültetésen. Ha van szervezőtök, ő is csatlakozhat egy harmadik belépéssel ugyanahhoz a felülethez.",
      },
      {
        q: "Készen áll a mi esküvőnkre?",
        a: "Az élő költségvetés, RSVP linkek, vizuális ültetés és nyomtatható kártyák (A4 / A6 / A3) ma már működnek. A szolgáltatói lista válogatott; a foglalás a v2-ben jön.",
      },
    ],
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
    faq: [
      {
        q: "Is Weddly really free?",
        a: "Yes — everything is free throughout the open beta. Paid tiers will arrive in v2 for extras (extra storage, premium templates), but budget, guest list, RSVP and seating stay free.",
      },
      {
        q: "Can both of us use it?",
        a: "Yes. One of you signs up and invites the other with a link. You both see the same workspace with your own logins.",
      },
      {
        q: "What happens to our data?",
        a: "It's yours. Every change goes into an audit log. You can pause the workspace any time; come back within 30 days and pick up exactly where you left off — no support ticket needed.",
      },
      {
        q: "What happens to our data after the wedding?",
        a: "It stays — as long as you want, like a wedding album on a shelf. From the Profile page you can pause the workspace any time: we keep the data for 30 days, then delete it permanently. Either of you can undo the request until that deadline.",
      },
      {
        q: "Do we need a wedding planner?",
        a: "You can plan it together — Weddly walks you through budget, guests and seating. If you do work with a planner, they can join the same workspace with a third login.",
      },
      {
        q: "Is it ready for our wedding?",
        a: "Live budget, RSVP links, visual seating and printable cards (A4 / A6 / A3) work today. The supplier directory is curated for browsing; bookings land in v2.",
      },
    ],
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
      mainEntity: meta.faq.map((entry) => ({
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
  // Absolute og/twitter image URL — some scrapers (Facebook, LinkedIn) only
  // honour absolute paths. Stays on the canonical host so the preview card
  // attribution matches the click target the share resolves to.
  const ogImage = `https://${canonicalHost}${opts.isRsvp ? "/og-rsvp.png" : "/og.png"}`;

  return [
    `<title>${escapeAttr(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="application-name" content="${escapeAttr(meta.brandName)}" />`,
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
    buildJsonLd({ locale, canonicalHost, pathname: path }),
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
