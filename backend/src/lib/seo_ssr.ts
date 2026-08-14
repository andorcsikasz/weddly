// Single-domain SEO rendering.
//
// Up to May 2026 we ran two TLDs in parallel, weddly.hu = HU canonical,
// weddly.xyz = EN canonical, with cross-host hreflang. The .xyz project was
// retired (one DB, one canonical) and weddly.xyz now 301-redirects to
// weddly.hu, so search engines following the old hreflang chains would just
// de-index the EN alternate.
//
// Today: weddly.hu is the only canonical. The locale of the SSR'd HTML
// (which is what Googlebot indexes pre-JS) branches on the request's
// `Accept-Language` header, HU-preferring clients see the HU landing +
// HU meta; everyone else (the strategic international audience + most
// crawlers, which advertise `en-US`) sees the EN variant. Clients still
// flip locale at runtime via localStorage + the language switcher, so an
// HU user landing on the EN SSR shell snaps back to HU after hydration.
// `Host` is retained in the signal for the future host-based path (e.g.
// adding a separate weddly.com EN-canonical) but ignored today.

import type { BlogBlock } from "../../../shared/blog_posts";
import {
  FEATURE_PAGE_PATHS,
  GUIDE_PAGE_PATHS,
  marketingPageForPath,
  type MarketingPage,
} from "../../../shared/marketing_pages";
import { SEO_FAQ } from "../../../shared/seo_faq";
import { enPathFor, huPathFor, lookupRouteSeo, type RouteSeo } from "../../../shared/seo_routes";
import { toolFaqForPath } from "../../../shared/tool_faq";
import { supplierCategoryLabel } from "../../../shared/suppliers";
import { vendorPublicId } from "../../../shared/vendor_slug";
import { db } from "../db";
import { curatedOverrideMap } from "../domain/curated_overrides";
import { listListingPhotos } from "../domain/listings";
import { resolveSupplierBase } from "../domain/resolve_supplier";
import { DIRECTORY } from "../domain/suppliers_data";
import { normalizeSlugInput } from "../domain/slug";

// Canonical apex moved from weddly.hu to tryweddly.com in the June 2026 domain
// cutover. weddly.hu / weddly.xyz now 301-redirect here (see server.ts
// LEGACY_HOSTS), so every public URL, canonical, og:url, sitemap, JSON-LD —
// resolves to tryweddly.com. The constant name keeps its history.
export const HU_HOST = "tryweddly.com";
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
  ...FEATURE_PAGE_PATHS.map((path) => ({ path, priority: "0.9", changefreq: "monthly" })),
  ...GUIDE_PAGE_PATHS.map((path) => ({ path, priority: "0.8", changefreq: "monthly" })),
  // Tool pages, high SEO value (each targets a long-tail HU query the
  // landing can't rank for on its own) so they get a higher priority than
  // the auth flows. Same path on both hosts; the locale switch happens via
  // Host header just like the landing.
  { path: "/eszkozok/eskuvo-koltsegvetes-kalkulator", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/eskuvo-visszaszamlalo", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/vendeglista-sablon", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/ultetesi-rend-keszito", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/rsvp-szoveg-generator", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/100-kerdes-eskuvo-elott", priority: "0.8", changefreq: "monthly" },
  { path: "/eszkozok/eskuvoi-ellenorzolista", priority: "0.8", changefreq: "monthly" },
  { path: "/blog", priority: "0.6", changefreq: "weekly" },
  // The public directory browser. Higher than the vendor-recruitment page it
  // sits under: it is the hub every one of the thousand-odd profile URLs below
  // hangs off, and the query a visitor actually types.
  { path: "/suppliers/browse", priority: "0.8", changefreq: "daily" },
  { path: "/suppliers", priority: "0.6", changefreq: "monthly" },
  { path: "/about", priority: "0.5", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/subscription-terms", priority: "0.3", changefreq: "yearly" },
  { path: "/imprint", priority: "0.3", changefreq: "yearly" },
];

/** Every public vendor page, as the pretty URL the product links to.
 *
 *  A thousand-odd profile pages with per-vendor titles, descriptions, photos and
 *  reviews were reachable only by clicking through the app, so nothing but the
 *  handful of statically-listed paths was ever offered to a crawler. This is the
 *  single largest indexable surface Weddly has, and it costs one query.
 *
 *  Assembled from the same places the directory itself is: the static curated
 *  catalogue minus admin-hidden entries, plus every active DB-backed listing.
 *  An unclaimed IMPORTED profile is included on purpose — its page renders a
 *  teaser (name, town, one photo, no bio), which is a thin but honest page, and
 *  leaving it out of the sitemap would not stop it being crawled anyway. */
function publicVendorSitemapPaths(): string[] {
  const hidden = new Set(curatedOverrideMap().keys());
  const paths: string[] = [];
  const seen = new Set<string>();
  const push = (id: string, name: string) => {
    if (hidden.has(id) || seen.has(id)) return;
    const base = resolveSupplierBase(id);
    if (!base) return;
    const listing = db
      .prepare("SELECT vendor_account_id, profile_imported FROM listings WHERE id = ?")
      .get(base.id) as { vendor_account_id: number | null; profile_imported: number } | undefined;
    // Imported, unclaimed listings expose only a teaser and deliberately hide
    // their bio. They are useful browse results, but not substantial enough to
    // be sitemap candidates. Require a real public description plus category,
    // location and an image before actively asking search engines to index it.
    const unclaimedImport = listing?.profile_imported === 1 && listing.vendor_account_id == null;
    const hasDescription = base.blurb_hu.trim().length >= 80;
    const hasImage = Boolean(
      firstNonBlank(
        base.hero_image_url,
        base.gallery_urls?.[0],
        listListingPhotos(base.id)[0]?.url,
      ),
    );
    if (unclaimedImport || !hasDescription || !base.category || !base.city || !hasImage) return;
    seen.add(id);
    paths.push(`/suppliers/${vendorPublicId(id, name)}`);
  };
  for (const entry of DIRECTORY) push(entry.id, entry.name);
  const rows = db.prepare("SELECT id, name FROM listings WHERE status = 'active'").all() as {
    id: string;
    name: string;
  }[];
  for (const row of rows) push(row.id, row.name);
  return paths;
}

/** `/suppliers/browse`, with or without a trailing slash. Query strings never
 *  reach here (the SSR entry point passes a bare pathname), so a category
 *  filter is a variation of the same indexable URL, not one of its own. */
function isBrowsePath(pathname: string): boolean {
  return pathname === "/suppliers/browse" || pathname === "/suppliers/browse/";
}

/** How many vendors the SSR'd browse body links to. Enough to give a crawler a
 *  wide entry into the catalogue and a reader a real sense of it, small enough
 *  that the HTML stays a page rather than a database dump. */
const BROWSE_INDEX_LIMIT = 90;

/** A crawlable list of vendor links for the browse page's SSR body, grouped by
 *  category so the block reads as an index rather than a wall of names.
 *
 *  Deliberately name + town only. The card the visitor sees carries a photo, a
 *  price band and a rating; none of those belong in a text index, and NO
 *  contact detail appears here — the whole point of the masking elsewhere would
 *  be lost if the crawlable HTML published what the API withholds. */
function renderVendorIndexHtml(locale: SeoLocale): string {
  const hidden = new Set(curatedOverrideMap().keys());
  const byCategory = new Map<string, { name: string; city: string; path: string }[]>();
  let taken = 0;
  for (const entry of DIRECTORY) {
    if (taken >= BROWSE_INDEX_LIMIT) break;
    if (hidden.has(entry.id)) continue;
    // A listing with no photograph is a thin card; the visible browser ranks
    // those last, so the index leads with the same ones.
    if (!entry.hero_image_url && !(entry.gallery_urls && entry.gallery_urls.length > 0)) continue;
    const list = byCategory.get(entry.category) ?? [];
    if (list.length >= 8) continue;
    list.push({
      name: entry.name,
      city: entry.city,
      path: `/suppliers/${vendorPublicId(entry.id, entry.name)}`,
    });
    byCategory.set(entry.category, list);
    taken += 1;
  }
  if (byCategory.size === 0) return "";

  const heading = locale === "hu" ? "Szolgáltatók kategóriánként" : "Vendors by category";
  const sections: string[] = [`<h2>${escapeText(heading)}</h2>`];
  for (const [category, vendors] of byCategory) {
    const items = vendors
      .map(
        (v) =>
          `<li><a href="${escapeAttr(v.path)}">${escapeText(v.name)}</a>${
            v.city ? ` · ${escapeText(v.city)}` : ""
          }</li>`,
      )
      .join("\n          ");
    sections.push(
      `<h3>${escapeText(supplierCategoryLabel(category, locale))}</h3>`,
      `<ul>\n          ${items}\n        </ul>`,
    );
  }
  return `<article>\n        ${sections.join("\n        ")}\n      </article>`;
}

/** Per-post rows read from the `blog_posts` table at request time. Drafts
 *  (`is_published = 0`) are excluded so a half-written post doesn't end up
 *  in Google's index before the admin flips it live. Used by the sitemap to
 *  emit both the HU canonical and the EN alternate as separate `<url>` entries
 *  when `en_slug` is set on the row. */
function publishedBlogPostRows(): { slug: string; en_slug: string | null }[] {
  return db
    .prepare(
      "SELECT slug, en_slug FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC",
    )
    .all() as { slug: string; en_slug: string | null }[];
}

/** `/blog/:slug` SSR meta lookup. Returns null for non-blog paths and for
 *  any slug that doesn't resolve (or whose post is a draft). The shared
 *  `lookupRouteSeo` no longer knows about blog posts, keeping the DB read
 *  here means admin edits land in the SSR'd <head> on the next request
 *  without a backend redeploy. */
function lookupBlogPostSeo(pathname: string): RouteSeo | null {
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1] ?? "";
  if (!slug) return null;
  const row = db
    .prepare(
      "SELECT hu_title, hu_lead, hu_seo_title, hu_seo_description, en_title, en_lead, en_seo_title, en_seo_description FROM blog_posts WHERE (slug = ? OR (en_slug IS NOT NULL AND en_slug = ?)) AND is_published = 1",
    )
    .get(slug, slug) as
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

/** Used by the SPA fallback to distinguish a real public route from an
 * arbitrary URL. This keeps unknown public paths from inheriting index.html
 * with a misleading 200 status. */
export function hasPublicSeoPage(pathname: string): boolean {
  if (pathname === "/") return true;
  return (
    resolveRouteSeo(pathname) !== null ||
    lookupWeddingSiteMeta(pathname) !== null ||
    lookupVendorPageMeta(pathname) !== null
  );
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
      "SELECT hu_title, en_title, published_at, updated_at, cover_image_url FROM blog_posts WHERE (slug = ? OR (en_slug IS NOT NULL AND en_slug = ?)) AND is_published = 1",
    )
    .get(slug, slug) as
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

interface BlogSlugPair {
  huSlug: string;
  enSlug: string | null;
  /** True if the request arrived via the EN slug (not the HU slug). */
  accessedViaEnSlug: boolean;
}

/** Given the slug from a `/blog/:slug` path, find the post's canonical slug
 *  pair. Handles both HU-slug access and EN-slug access. Returns null for
 *  non-blog paths, unknown slugs, or drafts. */
function lookupBlogSlugPair(pathname: string): BlogSlugPair | null {
  const match = /^\/blog\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const inputSlug = match[1] ?? "";
  if (!inputSlug) return null;
  const row = db
    .prepare(
      "SELECT slug, en_slug FROM blog_posts WHERE (slug = ? OR (en_slug IS NOT NULL AND en_slug = ?)) AND is_published = 1",
    )
    .get(inputSlug, inputSlug) as { slug: string; en_slug: string | null } | undefined;
  if (!row) return null;
  return {
    huSlug: row.slug,
    enSlug: row.en_slug,
    accessedViaEnSlug: inputSlug !== row.slug,
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
    .prepare(
      `SELECT ${column} AS body FROM blog_posts WHERE (slug = ? OR (en_slug IS NOT NULL AND en_slug = ?)) AND is_published = 1`,
    )
    .get(slug, slug) as { body: string } | undefined;
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
      case "img": {
        // Mirror the React <figure>: image + optional caption/credit. The
        // credit links to the source page (attribution + an outbound link a
        // crawler can follow). Caption text helps the image rank for the venue.
        const caption = block.caption ? escapeText(block.caption) : "";
        const creditInner = block.credit ? escapeText(block.credit) : "";
        const credit = creditInner
          ? block.creditHref
            ? `<a href="${escapeAttr(block.creditHref)}">${creditInner}</a>`
            : creditInner
          : "";
        const figcaption =
          caption || credit
            ? `<figcaption>${[caption, credit].filter(Boolean).join(" · ")}</figcaption>`
            : "";
        parts.push(
          `<figure><img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}" loading="lazy">${figcaption}</figure>`,
        );
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
    title: "Esküvőszervező alkalmazás pároknak | Weddly",
    description:
      "Tervezzétek együtt az esküvőt: közös költségvetés, vendéglista, személyes RSVP-linkek és vizuális ültetési rend egy helyen, pároknak.",
    twDescription: "Nyugodt esküvőszervezés, egyetlen közös, naprakész tervvel kettőtöknek.",
    ogImageAlt: "Wēddly · Nyugodt esküvőszervezés, egyetlen közös, naprakész tervvel kettőtöknek.",
    brandName: "Wēddly",
    brandDescription:
      "Magyar esküvőtervező webalkalmazás pároknak: költségvetés, vendéglista, RSVP, ültetési rend és nyomtatható kártyák egy közös felületen.",
  },
  en: {
    lang: "en",
    ogLocale: "en_US",
    title: "Wēddly · Low-cortisol wedding planning, with one live plan for both of you.",
    // Kept inside the 120-160 char SERP window (see meta-length guard in
    // tests/api/seo_meta_length.e2e.test.ts).
    description:
      "Low-cortisol wedding planning, with one live plan for both of you. Two logins keep the budget, guest list, RSVPs and seating in sync.",
    twDescription: "Low-cortisol wedding planning, with one live plan for both of you.",
    ogImageAlt: "Wēddly · Low-cortisol wedding planning, with one live plan for both of you.",
    brandName: "Wēddly",
    brandDescription:
      "Wedding planning web app for couples: budget, guest list, RSVP, seating chart and printable cards in one shared workspace.",
  },
};

const HEAD_START = "<!-- SEO_HEAD_START -->";
const HEAD_END = "<!-- SEO_HEAD_END -->";

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

/** The Plausible tag or "" when unset. Even a cookieless deployment is optional
 * audience measurement, so it follows the same statistics-consent gate. */
function plausibleScriptTag(): string {
  const domain = plausibleDomainEnv();
  if (!domain) return "";
  return `<script type="text/plain" data-cookieconsent="statistics" defer data-domain="${escapeAttr(domain)}" src="https://plausible.io/js/script.js"></script>`;
}

/** Google Tag Manager container id (e.g. "GTM-K9NCXCL9"). Activated by the
 *  `GTM_CONTAINER_ID` env var; empty/unset = no GTM injected (so dev + tests
 *  stay analytics-free, same gate as Plausible above). Read fresh on every
 *  call. www.googletagmanager.com + the GA4 collect origins are whitelisted in
 *  the CSP (script-src / img-src / connect-src) in server.ts. */
function gtmContainerIdEnv(): string {
  return (process.env.GTM_CONTAINER_ID ?? "").trim();
}

/** The exact inline bootstrap from GTM's canonical snippet. It pushes the
 *  `gtm.js` event onto the dataLayer BEFORE gtm.js loads, that event is what
 *  fires the Page View ("All Pages") trigger. Without it gtm.js only ever
 *  emits `gtm.dom` + `gtm.load`, so every tag bound to the standard Page View
 *  trigger silently never fires (the symptom we shipped with for months). The
 *  earlier "gtm.js creates dataLayer itself so the push is non-essential"
 *  reasoning was wrong: gtm.js does NOT synthesise its own `gtm.js` event.
 *  Kept byte-identical so its CSP hash below stays stable. */
const GTM_INLINE_BOOTSTRAP =
  "window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});";

/** CSP `script-src` source token that allow-lists GTM_INLINE_BOOTSTRAP under a
 *  policy with no 'unsafe-inline'. Computed from the snippet at module load so
 *  it can never drift out of sync with the emitted bytes. server.ts splices
 *  this into the script-src directive. */
export const GTM_INLINE_CSP_HASH = `'sha256-${new Bun.CryptoHasher("sha256")
  .update(GTM_INLINE_BOOTSTRAP)
  .digest("base64")}'`;

/** The GTM head snippet (inline bootstrap + async loader) or "" when unset.
 *  The inline bootstrap is allow-listed via the hash above, so it runs under
 *  our hash-based CSP without 'unsafe-inline'. The GA4 config tag (G-…) is
 *  wired up inside the GTM web UI, not in code, so it does not appear here.
 *  Container ids are public by design; we still guard the format to keep
 *  anything odd in the env out of the page source.
 *  The gtm.js loader is tagged data-cookieconsent="statistics" so Cookiebot
 *  auto-blocking holds it until the visitor consents. The dataLayer bootstrap
 *  runs immediately (harmless, no cookies, no network) so any pre-consent
 *  dataLayer.push() calls queue correctly. */
function gtmScriptTag(): string {
  const id = gtmContainerIdEnv();
  if (!id || !/^GTM-[A-Z0-9]+$/.test(id)) return "";
  return (
    `<script>${GTM_INLINE_BOOTSTRAP}</script>` +
    `<script type="text/plain" data-cookieconsent="statistics" async src="https://www.googletagmanager.com/gtm.js?id=${id}"></script>`
  );
}

// ── Direct GA4 (bypass GTM) ───────────────────────────────────────────────────
// Activated by GA4_MEASUREMENT_ID env var (e.g. "G-XXXXXXXXXX"). Both the
// remote loader and inline config remain inert until Cookiebot records
// statistics consent. Remove this var if a GA4 Configuration tag is later
// added inside GTM to avoid double-counting.

function ga4MeasurementIdEnv(): string {
  return (process.env.GA4_MEASUREMENT_ID ?? "").trim();
}

function ga4InlineScript(id: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}');`;
}

/** script-src CSP hash for the inline GA4 init script, or "" when
 *  GA4_MEASUREMENT_ID is not set. server.ts splices this into script-src. */
export const GA4_CSP_HASHES: string = (() => {
  const id = ga4MeasurementIdEnv();
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return "";
  return `'sha256-${new Bun.CryptoHasher("sha256").update(ga4InlineScript(id)).digest("base64")}'`;
})();

function ga4ScriptTag(): string {
  const id = ga4MeasurementIdEnv();
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return "";
  return (
    `<script type="text/plain" data-cookieconsent="statistics" async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>` +
    `<script type="text/plain" data-cookieconsent="statistics">${ga4InlineScript(id)}</script>`
  );
}

/** True when the request landed on the configured EN canonical host. Used
 *  by `localeForHost` to force EN regardless of `Accept-Language`. */
function hostIsEnCanonical(host: string | null | undefined): boolean {
  const en = enCanonicalHostEnv();
  if (!en || !host) return false;
  return host.toLowerCase() === en;
}

/** Parse an `Accept-Language` header value and return whether the client's
 *  top-preference language is Hungarian. Strict first-tag check: the user's
 *  PRIMARY preference wins; secondary q-weighted fallbacks are ignored so a
 *  US browser with HU as a courtesy fallback still renders EN. */
function prefersHungarian(acceptLanguage: string | null | undefined): boolean {
  if (!acceptLanguage) return false;
  const first = acceptLanguage.split(",")[0]?.split(";")[0]?.trim().toLowerCase() ?? "";
  return first === "hu" || first.startsWith("hu-");
}

/** SEO locale for a request. EN is the default everywhere, the product
 *  is positioned as international-first, so when production server.ts
 *  passes `null` for acceptLanguage (its new behaviour) the render is
 *  always EN. The Accept-Language branch is kept so callers (mostly
 *  tests + internal renders) can still exercise HU output by passing an
 *  explicit `hu-*` value; nothing in production code paths sends that.
 *  A user who wants HU in the live product picks it via the locale
 *  switcher (saved to localStorage on the client). */
export function localeForHost(
  host: string | null | undefined,
  acceptLanguage: string | null | undefined = null,
): SeoLocale {
  if (hostIsEnCanonical(host)) return "en";
  if (acceptLanguage == null) return "en";
  return prefersHungarian(acceptLanguage) ? "hu" : "en";
}

/** Hungarian feature/guide routes have no translated body yet. Keep the
 * document language and social metadata aligned with their actual content,
 * even though the shared landing defaults to English. */
function localeForPath(
  host: string | null | undefined,
  acceptLanguage: string | null | undefined,
  pathname: string,
): SeoLocale {
  return marketingPageForPath(pathname) ? "hu" : localeForHost(host, acceptLanguage);
}

/** Canonical hostname for SEO link rels. When `EN_CANONICAL_HOST` is set
 *  in the environment, EN renders point to that host (e.g. `weddly.com`)
 *  so the `hreflang` pair can advertise distinct URLs across locales.
 *  When unset, both locales return the HU apex, the single-host
 *  fallback that keeps existing tests + deploys working unchanged. */
export function canonicalHostFor(locale: SeoLocale): string {
  if (locale === "en") {
    const en = enCanonicalHostEnv();
    if (en) return en;
  }
  return HU_HOST;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  vendorMeta?: VendorPageMeta | null;
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
    email: "hello@tryweddly.com",
    founder: { "@type": "Person", name: "Csíkász Andor" },
    sameAs: [
      `https://${CANONICAL_HOST}`,
      "https://www.instagram.com/tryweddly",
      "https://www.facebook.com/tryweddly",
      "https://www.tiktok.com/@tryweddly.com",
    ],
  };
  const blocks: object[] = [
    {
      "@context": "https://schema.org",
      ...organization,
      description: meta.brandDescription,
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
    const marketingPage = marketingPageForPath(path);
    const article = lookupBlogArticleMeta(path);
    if (marketingPage) {
      const crumbItems = [
        { "@type": "ListItem", position: 1, name: "Főoldal", item: `${origin}/` },
        ...(marketingPage.kind === "guide"
          ? [
              {
                "@type": "ListItem",
                position: 2,
                name: "Esküvőszervezési útmutatók",
                item: `${origin}/utmutato`,
              },
            ]
          : []),
        {
          "@type": "ListItem",
          position: marketingPage.kind === "guide" ? 3 : 2,
          name: marketingPage.h1,
          item: `${origin}${path}`,
        },
      ];
      blocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbItems,
      });
      if (marketingPage.kind === "guide" && marketingPage.published && marketingPage.updated) {
        blocks.push({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: marketingPage.h1,
          description: marketingPage.description,
          datePublished: marketingPage.published,
          dateModified: marketingPage.updated,
          author: organization,
          publisher: organization,
          mainEntityOfPage: { "@type": "WebPage", "@id": `${origin}${path}` },
          inLanguage: "hu-HU",
        });
      }
      if (marketingPage.faqs && marketingPage.faqs.length > 0) {
        blocks.push({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: marketingPage.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        });
      }
    } else if (opts.vendorMeta) {
      const vendorDescription = (
        opts.locale === "hu" ? opts.vendorMeta.blurbHu : opts.vendorMeta.blurbEn
      ).trim();
      blocks.push({
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: opts.vendorMeta.name,
        description: vendorDescription || undefined,
        url: `${origin}/suppliers/${opts.vendorMeta.publicId}`,
        image: opts.vendorMeta.heroImageUrl
          ? absoluteImageUrl(origin, opts.vendorMeta.heroImageUrl)
          : undefined,
        areaServed: opts.vendorMeta.city,
        knowsAbout: supplierCategoryLabel(opts.vendorMeta.category, opts.locale),
      });
      blocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: crumbLabels.home, item: `${origin}/` },
          {
            "@type": "ListItem",
            position: 2,
            name: opts.locale === "hu" ? "Esküvői szolgáltatók" : "Wedding suppliers",
            item: `${origin}/suppliers/browse`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: opts.vendorMeta.name,
            item: `${origin}/suppliers/${opts.vendorMeta.publicId}`,
          },
        ],
      });
    } else if (article) {
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
        // Per-tool FAQPage, same treatment the landing gets. The copy comes
        // from shared/tool_faq.ts, which the React tool pages ALSO render, so
        // the structured data and the visible <details> cards are guaranteed to
        // be the same strings — a mismatch here reads as cloaking.
        const toolFaq = toolFaqForPath(path, opts.locale);
        if (toolFaq && toolFaq.length > 0) {
          blocks.push({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: toolFaq.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          });
        }
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
 *  given host + path. Returns just the inner block, the caller splices it
 *  into the template between the sentinels.
 *
 *  Per-route title/description override (from shared/seo_routes.ts) is what
 *  stops every public URL from re-using the landing's meta, Googlebot's
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

/** Per-vendor meta for the public vendor page (`/vendors/:id`). Powers the
 *  share-card `<title>` / description / og:image when a couple sends a vendor
 *  link to someone with no Weddly account — the WhatsApp/iMessage/Slack
 *  preview must show the vendor's name + photo, not the brand strapline. Same
 *  role `lookupWeddingSiteMeta` plays for `/w/:slug`. Returns null for the
 *  static `/vendors` and `/vendors/signup` routes and for any id that doesn't
 *  resolve to a publicly-visible listing. */
export interface VendorPageMeta {
  name: string;
  city: string;
  category: string;
  blurbHu: string;
  blurbEn: string;
  heroImageUrl: string | null;
  /** Pretty public id (`magyar-foto-v12`) — the canonical `/vendors/:id` slug,
   *  so a link shared with the bare id or a stale name consolidates onto it. */
  publicId: string;
  indexable: boolean;
}

const VENDOR_PATH_RE = /^\/suppliers\/([^/?#]+)/;

export function lookupVendorPageMeta(pathname: string | null | undefined): VendorPageMeta | null {
  if (!pathname) return null;
  const m = VENDOR_PATH_RE.exec(pathname);
  if (!m) return null;
  const idRaw = decodeURIComponent(m[1] ?? "").trim();
  // `/vendors/signup` is the vendor-registration route, not a vendor id.
  if (!idRaw || idRaw === "signup" || idRaw.length > 80) return null;
  const base = resolveSupplierBase(idRaw);
  if (!base) return null;
  // Share-card image priority, so the FB/Messenger preview shows the VENDOR's
  // picture whenever one exists, and the brand card only as a last resort:
  //   1. the vendor-uploaded / re-hosted hero (CSP-safe local path) from the
  //      listings table,
  //   2. whatever hero the resolved base carries,
  //   3. the vendor's FIRST gallery photo (a videographer/photographer often
  //      uploads a portfolio but never sets a dedicated hero — without this
  //      they'd fall back to the brand og.png despite having real photos),
  //   4. null -> buildHeadBlock uses the brand og.png.
  // Blank/whitespace values count as "no image" so we never emit a broken
  // og:image with no fallback behind it.
  // Use the resolved base's canonical id (`v{N}`) — `idRaw` may be the pretty
  // `magyar-foto-v12` form, which wouldn't match the listings/photos rows.
  const listing = db
    .prepare(
      "SELECT hero_image_url, vendor_account_id, profile_imported FROM listings WHERE id = ?",
    )
    .get(base.id) as
    | {
        hero_image_url: string | null;
        vendor_account_id: number | null;
        profile_imported: number;
      }
    | undefined;
  const unclaimedImport = listing?.profile_imported === 1 && listing.vendor_account_id == null;
  let heroImageUrl = unclaimedImport
    ? null
    : firstNonBlank(listing?.hero_image_url, base.hero_image_url);
  if (!unclaimedImport && !heroImageUrl) {
    heroImageUrl = firstNonBlank(listListingPhotos(base.id)[0]?.url);
  }
  // The share card and the SSR <meta description> are public HTML, so an
  // imported profile that nobody has claimed must not put its bio there
  // either — redacting it in the API and then baking it into the page source
  // would publish it just the same, and to crawlers at that. The photo and the
  // name/town stay: that's the one picture the teaser is allowed.
  const redacted = unclaimedImport;
  const publicDescription = redacted ? "" : base.blurb_hu.trim();
  return {
    name: base.name,
    city: base.city,
    category: base.category,
    blurbHu: redacted ? "" : base.blurb_hu,
    blurbEn: redacted ? "" : base.blurb_en,
    heroImageUrl,
    publicId: vendorPublicId(base.id, base.name),
    indexable: Boolean(
      publicDescription.length >= 80 && base.category && base.city && heroImageUrl,
    ),
  };
}

/** First argument that is a non-empty, non-whitespace string, else null. Guards
 *  the og:image chain against blank DB values that would otherwise produce a
 *  broken image URL with no fallback. */
function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** The landing hero is a CSS `background-image`, so the browser cannot even
 *  learn it exists until the stylesheet has downloaded and parsed, and it is
 *  the page's LCP element, which means LCP waits on that whole chain. A
 *  `rel=preload` starts it in parallel with the CSS instead.
 *
 *  Emitted for the landing route ONLY, and that is the reason it lives here
 *  rather than as a static tag in index.html: the same `<head>` serves
 *  /app, /blog and every vendor page, and a preload on those is a quarter of
 *  a megabyte fetched for a hero that never renders. Preload does not honour
 *  `display: none`, only `media`, so the two covers are split on the exact
 *  breakpoint `.hero-photo-img` uses (639/640px) and a viewport downloads one
 *  of them, never both. */
function heroPreloadTags(path: string): string[] {
  if (path !== "/" && path !== "") return [];
  return [
    `<link rel="preload" as="image" href="/cover-hero.jpg" fetchpriority="high" media="(min-width: 640px)" />`,
    `<link rel="preload" as="image" href="/hero-mobile-cover.jpg" fetchpriority="high" media="(max-width: 639px)" />`,
  ];
}

function isIndexableHtmlPath(
  path: string,
  opts: { weddingMeta?: WeddingSiteMeta | null; vendorMeta?: VendorPageMeta | null },
): boolean {
  if (path === "/" || marketingPageForPath(path)) return true;
  if (isToolPath(path) || path === "/blog" || lookupBlogPostSeo(path)) return true;
  if (
    path === "/about" ||
    path === "/privacy" ||
    path === "/terms" ||
    path === "/terms/vendor-subscription" ||
    path === "/imprint" ||
    path === "/impresszum" ||
    path === "/suppliers" ||
    path === "/suppliers/browse" ||
    path === "/planners"
  ) {
    return true;
  }
  if (opts.vendorMeta?.indexable || opts.weddingMeta) return true;
  return false;
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
   *  the brand og.png. The whole viral loop hinges on this, the share
   *  card on FB / WhatsApp / iMessage must say "Mia & Lucas · 12 Sept 2026"
   *  and show their cover image, not "Plan your wedding together". */
  weddingMeta?: WeddingSiteMeta | null;
  /** Per-vendor overrides for the `/vendors/:id` public page — same role as
   *  `weddingMeta`, applied to the vendor share card. */
  vendorMeta?: VendorPageMeta | null;
}): string {
  const locale = localeForPath(opts.host, opts.acceptLanguage ?? null, opts.pathname || "/");
  const defaultMeta = META[locale];
  const altDefaultMeta = META[locale === "hu" ? "en" : "hu"];
  const canonicalHost = canonicalHostFor(locale);
  const path = opts.pathname || "/";
  const robots = isIndexableHtmlPath(path, opts) ? "index,follow" : "noindex,follow";
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
  const hungarianOnly = marketingPageForPath(path) !== null;
  let enUrl: string | null;
  if (hungarianOnly) {
    enUrl = null;
  } else if (enHostConfigured) {
    enUrl = `https://${enHostConfigured}${enPath}`;
  } else if (enPath !== huPath) {
    enUrl = `https://${CANONICAL_HOST}${enPath}`;
  } else {
    enUrl = null;
  }
  // Blog posts: override HU/EN URLs using the per-post en_slug from the DB.
  // For tool pages the SLUG_PAIRS map already handled this above; blogs need
  // a separate DB lookup because their pairings live in blog_posts.en_slug.
  const blogPair = lookupBlogSlugPair(path);
  let finalHuUrl = huUrl;
  let finalEnUrl = enUrl;
  if (blogPair) {
    finalHuUrl = `https://${CANONICAL_HOST}/blog/${blogPair.huSlug}`;
    finalEnUrl = blogPair.enSlug
      ? `https://${enHostConfigured || CANONICAL_HOST}/blog/${blogPair.enSlug}`
      : null;
  }
  // Canonical follows the locale of the current render: HU render → HU URL
  // with HU slug; EN render (only meaningful when multi-host is active) →
  // EN URL with EN slug. Falls back to the path-on-canonical-host shape
  // for non-paired routes, `huPathFor`/`enPathFor` return `path` itself
  // for anything outside `SLUG_PAIRS`, so /about, /signup, /vendors etc.
  // keep their historical canonical exactly.
  // A vendor page's canonical is always its pretty `/vendors/<slug>-v{N}` URL,
  // regardless of whether it was reached via the bare id or an outdated name —
  // so search + social consolidate onto one address.
  const canonicalUrl = opts.vendorMeta
    ? `https://${canonicalHost}/suppliers/${opts.vendorMeta.publicId}`
    : blogPair
      ? blogPair.accessedViaEnSlug && finalEnUrl
        ? finalEnUrl
        : finalHuUrl
      : locale === "en" && enUrl
        ? enUrl
        : huUrl;
  // Per-post Open Graph image. Priority: couple cover (/w/:slug) → published
  // blog post cover → /og-rsvp.png on RSVP routes → brand /og.png. Giving each
  // blog post its own share card (instead of nine copies of og.png) is the
  // single biggest lever on social CTR for the magazine content. The cover is
  // passed through as-is when absolute (admin-pasted) and made absolute against
  // the canonical host when stored relative (/uploads/blog/…).
  // `ogImageAlt` tracks the chosen image so og:image:alt / twitter:image:alt
  // describe the actual picture, not always the brand strapline.
  const blogArticle = lookupBlogArticleMeta(path);
  const blogCover = blogArticle
    ? absoluteImageUrl(`https://${canonicalHost}`, blogArticle.coverImageUrl)
    : null;
  let ogImage: string;
  let ogImageAlt: string;
  // Brand images are the known 1200×630 PNGs we ship, only those get the
  // exact dimension/type hints below. Custom covers (couple- or admin-pasted)
  // have unknown size/format, so we skip the hints and let scrapers measure.
  let isBrandOgImage: boolean;
  if (opts.weddingMeta?.cover_image_url) {
    ogImage = opts.weddingMeta.cover_image_url;
    ogImageAlt = opts.weddingMeta.display_name;
    isBrandOgImage = false;
  } else if (opts.vendorMeta?.heroImageUrl) {
    // Vendor hero is stored relative (`/uploads/…`) — make it absolute against
    // the canonical host so scrapers can fetch it. Unknown size/format, so no
    // dimension hints (same as blog/wedding covers).
    ogImage = absoluteImageUrl(`https://${canonicalHost}`, opts.vendorMeta.heroImageUrl) as string;
    ogImageAlt = opts.vendorMeta.name;
    isBrandOgImage = false;
  } else if (blogArticle && blogCover) {
    ogImage = blogCover;
    ogImageAlt = locale === "hu" ? blogArticle.huTitle : blogArticle.enTitle;
    isBrandOgImage = false;
  } else if (opts.isRsvp) {
    ogImage = `https://${canonicalHost}/og-rsvp.png`;
    ogImageAlt = defaultMeta.ogImageAlt;
    isBrandOgImage = true;
  } else {
    ogImage = `https://${canonicalHost}/og.png`;
    ogImageAlt = defaultMeta.ogImageAlt;
    isBrandOgImage = true;
  }

  // Route-specific title + description take precedence over the landing
  // defaults so each public path ships a unique <title> / description in
  // the initial HTML. Twitter description, og image, locales etc. stay
  // from the landing META (those are brand-level, not page-level).
  // The wedding-site override is highest priority, couple-personalised
  // share cards beat both route SEO and brand defaults.
  let title: string;
  let description: string;
  let twDescription: string;
  if (opts.weddingMeta) {
    const wm = opts.weddingMeta;
    const dateBlock = wm.wedding_date ?? "";
    const venueBlock = wm.venue_name ? ` · ${wm.venue_name}` : "";
    title = `${wm.display_name}${dateBlock ? ` · ${dateBlock}` : ""}${venueBlock}`;
    // Localised description sentence, same shape for HU + EN, just the
    // connector word changes. Keeps the share-card body warm without
    // having to drop the names into a long brand pitch.
    description =
      locale === "hu"
        ? `${wm.display_name} esküvői oldala, programterv, helyszín, RSVP.`
        : `${wm.display_name}, schedule, venue and RSVP in one place.`;
    twDescription = description;
  } else if (opts.vendorMeta) {
    const vm = opts.vendorMeta;
    title = `${vm.name} · ${vm.city}`;
    // Prefer the vendor's own blurb (locale-matched, collapsed + clipped to the
    // SERP window); fall back to a short brand sentence when they haven't
    // written one (the unclaimed-listing majority).
    const blurb = (locale === "hu" ? vm.blurbHu : vm.blurbEn).replace(/\s+/g, " ").trim();
    const clipped = blurb.length > 155 ? `${blurb.slice(0, 152).trimEnd()}…` : blurb;
    description =
      clipped ||
      (locale === "hu"
        ? `${vm.name} a Weddly esküvői szolgáltató katalógusában.`
        : `${vm.name} on Weddly's wedding vendor directory.`);
    twDescription = description;
  } else {
    const routeSeo = resolveRouteSeo(path);
    title = routeSeo ? routeSeo[locale].title : defaultMeta.title;
    description = routeSeo ? routeSeo[locale].description : defaultMeta.description;
    twDescription = routeSeo ? routeSeo[locale].description : defaultMeta.twDescription;
  }

  return [
    ...heroPreloadTags(path),
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="application-name" content="${escapeAttr(defaultMeta.brandName)}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Wēddly" />`,
    `<meta property="og:locale" content="${defaultMeta.ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${altDefaultMeta.ogLocale}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    ...(isBrandOgImage
      ? [
          `<meta property="og:image:type" content="image/png" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
        ]
      : []),
    `<meta property="og:image:alt" content="${escapeAttr(ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(twDescription)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`,
    `<meta name="twitter:image:alt" content="${escapeAttr(ogImageAlt)}" />`,
    `<link rel="alternate" hreflang="hu-HU" href="${finalHuUrl}" />`,
    ...(finalEnUrl ? [`<link rel="alternate" hreflang="en" href="${finalEnUrl}" />`] : []),
    `<link rel="alternate" hreflang="x-default" href="${finalHuUrl}" />`,
    buildJsonLd({ locale, canonicalHost, pathname: path, vendorMeta: opts.vendorMeta }),
    ...(plausibleScriptTag() ? [plausibleScriptTag()] : []),
    ...(gtmScriptTag() ? [gtmScriptTag()] : []),
    ...(ga4ScriptTag() ? [ga4ScriptTag()] : []),
  ].join("\n    ");
}

function renderMarketingPageHtml(page: MarketingPage): string {
  const breadcrumb = [
    `<a href="/">Főoldal</a>`,
    ...(page.kind === "guide" ? [`<a href="/utmutato">Útmutatók</a>`] : []),
    `<span aria-current="page">${escapeText(page.eyebrow)}</span>`,
  ].join(" › ");
  const sections = page.sections
    .map((section) => {
      const paragraphs = section.paragraphs.map((p) => `<p>${escapeText(p)}</p>`).join("\n");
      const bullets = section.bullets
        ? `<ul>${section.bullets.map((item) => `<li>${escapeText(item)}</li>`).join("")}</ul>`
        : "";
      const image = section.image
        ? `<img src="${escapeAttr(section.image.url)}" alt="${escapeAttr(section.image.alt)}" loading="lazy" />`
        : "";
      return `<section><h2>${escapeText(section.heading)}</h2>${paragraphs}${bullets}${image}</section>`;
    })
    .join("\n");
  const guideCards =
    page.guideCards && page.guideCards.length > 0
      ? `<section><h2>A három útmutató</h2><ul>${page.guideCards
          .map(
            (card) =>
              `<li><a href="${escapeAttr(card.href)}"><img src="${escapeAttr(card.image.url)}" alt="${escapeAttr(card.image.alt)}" loading="lazy" /><h3>${escapeText(card.label)}</h3><p>${escapeText(card.description)}</p></a></li>`,
          )
          .join("")}</ul></section>`
      : "";
  const steps = page.steps
    ? `<section><h2>Így működik lépésről lépésre</h2><ol>${page.steps
        .map((step) => `<li><h3>${escapeText(step.title)}</h3><p>${escapeText(step.body)}</p></li>`)
        .join("")}</ol></section>`
    : "";
  const faq = page.faqs
    ? `<section><h2>Gyakori kérdések</h2>${page.faqs
        .map(
          (item) =>
            `<details><summary>${escapeText(item.question)}</summary><p>${escapeText(item.answer)}</p></details>`,
        )
        .join("")}</section>`
    : "";
  const dates =
    page.published && page.updated
      ? `<p>Közzétéve: <time datetime="${escapeAttr(page.published)}">${escapeText(page.published)}</time> · Frissítve: <time datetime="${escapeAttr(page.updated)}">${escapeText(page.updated)}</time></p>`
      : "";
  const cta = page.cta
    ? `<aside><h2>${escapeText(page.cta.title)}</h2><p>${escapeText(page.cta.body)}</p><a href="${escapeAttr(page.cta.href)}">${escapeText(page.cta.label)}</a></aside>`
    : "";
  const related = `<nav aria-label="Kapcsolódó Weddly-oldalak"><h2>Kapcsolódó oldalak</h2><ul>${page.related
    .map((link) => `<li><a href="${escapeAttr(link.href)}">${escapeText(link.label)}</a></li>`)
    .join("")}</ul></nav>`;
  const heroImage = page.heroImage
    ? `<img src="${escapeAttr(page.heroImage.url)}" alt="${escapeAttr(page.heroImage.alt)}" />`
    : "";
  return [
    `<nav aria-label="Morzsanavigáció">${breadcrumb}</nav>`,
    `<header><p>${escapeText(page.eyebrow)}</p><h1>${escapeText(page.h1)}</h1><p>${escapeText(page.intro)}</p>${dates}${heroImage}</header>`,
    `<article>${sections}${guideCards}${steps}${faq}</article>`,
    cta,
    related,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Build a tiny route-specific SSR body (h1 + intro + footer nav). Returns
 *  null for the landing and unknown paths, those keep whatever body the
 *  prerender script baked into the template. Used by renderIndexHtml below
 *  to give Googlebot a distinct <h1> + paragraph on each public URL
 *  instead of nine copies of the landing's hero. */
function renderRouteBody(pathname: string, locale: SeoLocale): string | null {
  const vendor = lookupVendorPageMeta(pathname);
  if (vendor) {
    const category = supplierCategoryLabel(vendor.category, locale);
    const description = locale === "hu" ? vendor.blurbHu : vendor.blurbEn;
    const directoryLabel = locale === "hu" ? "Esküvői szolgáltatók" : "Wedding suppliers";
    return [
      `<nav aria-label="${locale === "hu" ? "Morzsanavigáció" : "Breadcrumb"}"><a href="/">${locale === "hu" ? "Főoldal" : "Home"}</a> › <a href="/suppliers/browse">${directoryLabel}</a> › <span aria-current="page">${escapeText(vendor.name)}</span></nav>`,
      `<header><h1>${escapeText(vendor.name)}</h1><p>${escapeText(category)} · ${escapeText(vendor.city)}</p>${description ? `<p>${escapeText(description)}</p>` : ""}</header>`,
      `<p><a href="/suppliers/browse">${directoryLabel}</a></p>`,
    ].join("\n");
  }
  const routeSeo = resolveRouteSeo(pathname);
  if (!routeSeo) return null;
  const entry = routeSeo[locale];
  const marketingPage = marketingPageForPath(pathname);
  if (marketingPage) return renderMarketingPageHtml(marketingPage);
  // Footer link target for the imprint route depends on locale (HU mounts at
  // /impresszum, EN at /imprint, both reach the same React page).
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
  // lead.
  const blogBlocks = lookupBlogPostBody(pathname, locale);
  let articleHtml = blogBlocks
    ? `<article>\n        ${renderBlogBlocks(blogBlocks)}\n      </article>`
    : null;

  // Tool pages used to stop at the h1 + intro, because their copy lived in the
  // frontend locale tree where the backend can't reach it. Their FAQ now lives
  // in shared/tool_faq.ts (so the FAQPage JSON-LD can't drift from the visible
  // cards), which means the single richest block of unique prose on each tool
  // page is finally bakeable. Rendered as the same q→h2 / a→p shape the visible
  // <details> cards use, so the crawled text matches what a reader sees.
  //
  // The rest of each tool page (the interactive calculator/generator copy) is
  // still React-only: it's UI microcopy with interpolation and plurals, not
  // prose, so lifting it out of the locale tree would cost more than it earns.
  if (!articleHtml) {
    const toolFaq = toolFaqForPath(pathname, locale);
    if (toolFaq && toolFaq.length > 0) {
      const faqHtml = toolFaq
        .map((f) => `<h2>${escapeText(f.q)}</h2>\n        <p>${escapeText(f.a)}</p>`)
        .join("\n        ");
      articleHtml = `<article>\n        ${faqHtml}\n      </article>`;
    }
  }

  // The directory browser gets a real, crawlable index of the catalogue baked
  // into the HTML. The React page renders the same names and links from the
  // API, so this is a reflection of the page rather than a second, hidden one;
  // what it adds is a path a crawler can follow from the hub into the profile
  // pages without executing any JavaScript. Capped: this is an entry point,
  // and the sitemap carries the complete set.
  if (!articleHtml && isBrowsePath(pathname)) {
    articleHtml = renderVendorIndexHtml(locale);
  }

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
    `    <a href="/suppliers">${escapeAttr(labels.vendors)}</a> · `,
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
    /** Raw `Accept-Language` request header. Optional, when omitted, locale
     *  resolution falls back to the historical HU default. Production
     *  callers in server.ts forward the real header so the SSR'd HTML
     *  advertises the right lang/og:locale per request. */
    acceptLanguage?: string | null;
  },
): string {
  const locale = localeForPath(opts.host, opts.acceptLanguage ?? null, opts.pathname || "/");
  // Look up the couple + vendor meta once at the boundary, `buildHeadBlock` is
  // a pure string-builder so we keep the DB read here.
  const weddingMeta = lookupWeddingSiteMeta(opts.pathname);
  const vendorMeta = weddingMeta ? null : lookupVendorPageMeta(opts.pathname);
  const head = buildHeadBlock({ ...opts, weddingMeta, vendorMeta });

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
  // script baked into the template, that's already the rich landing body
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

  return out
    .replace(/<html lang="[^"]*"/, `<html lang="${META[locale].lang}"`)
    .replace(/data-default-locale="[^"]*"/, `data-default-locale="${locale}"`);
}

export function renderRobotsTxt(_host: string | null): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
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

/** /llms.txt, the proposed standard that points LLMs/AI search engines at a
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

  // Free tools, the strongest citable assets (each answers a high-intent
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

  // Published blog posts grouped by category. EN fields; EN-slug URLs when
  // available, else HU-slug URLs (both serve EN copy to en-US crawlers).
  const posts = db
    .prepare(
      "SELECT slug, en_slug, en_title, en_seo_description, en_category FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC",
    )
    .all() as {
    slug: string;
    en_slug: string | null;
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
        const postUrl = `${origin}/blog/${post.en_slug ?? post.slug}`;
        lines.push(`- [${post.en_title}](${postUrl}): ${post.en_seo_description}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "## Key pages",
    "",
    `- [About Weddly](${origin}/about): What Weddly is and who it's for.`,
    `- [For suppliers](${origin}/suppliers): How wedding suppliers can join the directory.`,
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
      `    <xhtml:link rel="alternate" hreflang="hu-HU" href="${huHref}" />`,
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

  // Static public paths (tools, landing, auth pages, etc.)
  for (const { path, priority, changefreq } of STATIC_PUBLIC_PATHS) {
    const huPath = huPathFor(path);
    const enPath = enPathFor(path);
    const huHere = `https://${CANONICAL_HOST}${huPath}`;
    const enHere = marketingPageForPath(path)
      ? null
      : enPath !== huPath || enHostConfigured
        ? `https://${enHostConfigured || CANONICAL_HOST}${enPath}`
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

  // Every public vendor profile. One <loc> each, no hreflang pair: a vendor
  // page is one URL that renders in the visitor's language, not two slugs.
  // These are the bulk of the file (a thousand-odd URLs against a dozen static
  // paths), and they are the reason the file exists at this size: without them
  // the product's largest body of unique, photographed, reviewed content was
  // reachable only by crawling links from inside the app.
  for (const path of publicVendorSitemapPaths()) {
    const here = `https://${CANONICAL_HOST}${path}`;
    blocks.push(
      [
        "  <url>",
        `    <loc>${here}</loc>`,
        `    <lastmod>${SITEMAP_LASTMOD}</lastmod>`,
        "    <changefreq>weekly</changefreq>",
        "    <priority>0.6</priority>",
        "  </url>",
      ].join("\n"),
    );
  }

  // Blog posts: HU canonical + EN alternate via per-post en_slug.
  // Each post with an en_slug gets two <url> blocks (bidirectional hreflang
  // pair); posts without one get a single HU <url> with no EN alternate.
  for (const row of publishedBlogPostRows()) {
    const huHere = `https://${CANONICAL_HOST}/blog/${row.slug}`;
    const enHere = row.en_slug
      ? `https://${enHostConfigured || CANONICAL_HOST}/blog/${row.en_slug}`
      : null;
    blocks.push(buildUrlBlock(huHere, huHere, enHere, "0.7", "monthly"));
    if (enHere) {
      blocks.push(buildUrlBlock(enHere, huHere, enHere, "0.7", "monthly"));
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
