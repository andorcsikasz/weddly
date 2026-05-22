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

import { SEO_FAQ } from "../../../shared/seo_faq";
import { enPathFor, huPathFor, lookupRouteSeo } from "../../../shared/seo_routes";
import { db } from "../db";
import { normalizeSlugInput } from "../domain/slug";

export const HU_HOST = "weddly.hu";
/** Canonical host for every public URL in SEO output. */
export const CANONICAL_HOST = HU_HOST;

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
  { path: "/eszkozok/eskuvo-visszaszamlalo", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/vendeglista-sablon", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/ultetesi-rend-keszito", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/rsvp-szoveg-generator", priority: "0.8", changefreq: "monthly" },
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
      sameAs: [`https://${CANONICAL_HOST}`],
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
      // `priceCurrency` follows the SSR locale so the EN landing's structured
      // data quotes EUR instead of HUF — a London or Berlin visitor reading
      // the rich-result snippet shouldn't see a Hungarian-forint price tag,
      // even though every Weddly plan is currently free during open beta.
      offers: { "@type": "Offer", price: "0", priceCurrency: opts.locale === "hu" ? "HUF" : "EUR" },
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
  // EN canonical URL only differs from the HU one when `EN_CANONICAL_HOST`
  // env is set. Otherwise we stay single-host and skip the EN hreflang
  // link rel — emitting one that points back to the HU canonical would
  // trigger Google's duplicate-canonical warning and erode the HU rank.
  const enHostConfigured = enCanonicalHostEnv();
  const enUrl = enHostConfigured ? `https://${enHostConfigured}${enPath}` : null;
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
    const routeSeo = lookupRouteSeo(path);
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

// Captured at module-load (== deploy) time so every URL in the sitemap
// shares the same lastmod for this revision. Google ignores <priority> and
// <changefreq> per their docs; <lastmod> is the only signal in this trio
// they actually use to schedule recrawl.
const SITEMAP_LASTMOD = new Date().toISOString().slice(0, 10);

export function renderSitemapXml(_host: string | null): string {
  // Mirror the head-block hreflang policy: emit the EN alternate only when
  // `EN_CANONICAL_HOST` is configured. Otherwise we stay single-host and
  // each <url> just lists hu + x-default pointing at weddly.hu.
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
  for (const { path, priority, changefreq } of PUBLIC_PATHS) {
    const huPath = huPathFor(path);
    const enPath = enPathFor(path);
    const huHere = `https://${CANONICAL_HOST}${huPath}`;
    const enHere = enHostConfigured ? `https://${enHostConfigured}${enPath}` : null;
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
    `<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    urls,
    `</urlset>`,
    "",
  ].join("\n");
}
