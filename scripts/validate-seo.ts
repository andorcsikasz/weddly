/** Lightweight rendered-HTML SEO validator.
 *
 * Run against a production build served by the Bun backend:
 *   SEO_BASE_URL=http://127.0.0.1:8787 bun scripts/validate-seo.ts
 */

const base = (process.env.SEO_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

const publicPaths = [
  "/",
  "/eskuvoi-vendeglista",
  "/eskuvoi-koltsegvetes-tervezo",
  "/eskuvoi-ultetesi-rend-tervezo",
  "/online-eskuvoi-rsvp",
  "/eskuvoi-szolgaltatok",
  "/utmutato",
  "/utmutato/eskuvoi-vendeglista",
  "/utmutato/eskuvoi-koltsegvetes",
  "/utmutato/eskuvoi-ultetesi-rend",
] as const;

const privatePaths = ["/login", "/signup", "/rsvp", "/app", "/w/teszt-par/TITKOSKOD"];

function matches(html: string, pattern: RegExp, label: string, path: string): RegExpMatchArray {
  const match = html.match(pattern);
  if (!match) throw new Error(`${path}: missing ${label}`);
  return match;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function jsonLd(html: string, path: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse((match[1] ?? "").replace(/<\\\//g, "</")));
    } catch (error) {
      throw new Error(`${path}: invalid JSON-LD (${String(error)})`);
    }
  }
  if (blocks.length === 0) throw new Error(`${path}: missing JSON-LD`);
  return blocks;
}

const htmlByPath = new Map<string, string>();
const titles = new Map<string, string>();

for (const path of publicPaths) {
  const response = await fetch(`${base}${path}`, { headers: { Host: "tryweddly.com" } });
  if (response.status !== 200) throw new Error(`${path}: expected 200, got ${response.status}`);
  const html = await response.text();
  htmlByPath.set(path, html);

  // The canonical landing is international-first (EN). The Hungarian keyword
  // feature/guide routes intentionally remain HU-only until equivalent EN
  // slugs and content exist, so validate the actual route contract rather than
  // assuming one locale for the whole host.
  const expectedLocale = path === "/" ? "en" : "hu";
  if (!new RegExp(`<html lang="${expectedLocale}"(?:\\s|>)`).test(html)) {
    throw new Error(`${path}: expected html lang=${expectedLocale}`);
  }
  const ogLocale = matches(
    html,
    /<meta property="og:locale" content="([^"]+)"/,
    "Open Graph locale",
    path,
  )[1];
  const expectedOgLocale = expectedLocale === "en" ? "en_US" : "hu_HU";
  if (ogLocale !== expectedOgLocale) {
    throw new Error(`${path}: unexpected Open Graph locale: ${ogLocale}`);
  }

  const title = decodeHtml(matches(html, /<title>([^<]+)<\/title>/, "title", path)[1] ?? "");
  if (title.length === 0) throw new Error(`${path}: empty title`);
  if (
    path === "/" &&
    title !== "Wēddly · Low-cortisol wedding planning, with one live plan for both of you."
  ) {
    throw new Error(`${path}: unexpected homepage title: ${title}`);
  }
  if ([...titles.values()].includes(title)) throw new Error(`${path}: duplicate title: ${title}`);
  titles.set(path, title);

  const description = decodeHtml(
    matches(html, /<meta name="description" content="([^"]+)"/, "meta description", path)[1] ?? "",
  );
  if (description.length < 100 || description.length > 165) {
    throw new Error(`${path}: meta description length ${description.length}`);
  }

  const h1Count = (html.match(/<h1(?:\s[^>]*)?>/g) ?? []).length;
  if (h1Count !== 1) throw new Error(`${path}: expected exactly one h1, got ${h1Count}`);

  const canonical = matches(html, /<link rel="canonical" href="([^"]+)"/, "canonical", path)[1];
  const expectedCanonical = `https://tryweddly.com${path}`;
  if (canonical !== expectedCanonical) {
    throw new Error(`${path}: canonical ${canonical}, expected ${expectedCanonical}`);
  }

  const robots = matches(html, /<meta name="robots" content="([^"]+)"/, "robots", path)[1];
  if (robots !== "index,follow") throw new Error(`${path}: unexpected robots: ${robots}`);
  const visibleText = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  const localeTextPresent =
    expectedLocale === "en"
      ? /wedding/i.test(visibleText)
      : /[áéíóöőúüű]/i.test(visibleText) && /esküvő/i.test(visibleText);
  if (!localeTextPresent || !/Wēddly|Weddly/.test(visibleText)) {
    throw new Error(`${path}: ${expectedLocale.toUpperCase()} visible content check failed`);
  }
  jsonLd(html, path);
}

const sitemapResponse = await fetch(`${base}/sitemap.xml`, { headers: { Host: "tryweddly.com" } });
if (sitemapResponse.status !== 200) {
  throw new Error(`/sitemap.xml: expected 200, got ${sitemapResponse.status}`);
}
const sitemap = await sitemapResponse.text();

const supplierUrl = [...sitemap.matchAll(/<loc>(https:\/\/tryweddly\.com\/vendors\/[^<]+)<\/loc>/g)]
  .map((match) => match[1] ?? "")
  .find((url) => !url.endsWith("/vendors/browse"));
if (supplierUrl) {
  const supplierResponse = await fetch(supplierUrl, { headers: { Host: "tryweddly.com" } });
  if (supplierResponse.status !== 200) {
    throw new Error(`supplier detail: expected 200, got ${supplierResponse.status}`);
  }
  const supplierHtml = await supplierResponse.text();
  const supplierSchemas = jsonLd(supplierHtml, new URL(supplierUrl).pathname) as Array<
    Record<string, unknown>
  >;
  if (!supplierSchemas.some((schema) => schema["@type"] === "LocalBusiness")) {
    throw new Error("supplier detail: missing LocalBusiness JSON-LD");
  }
  if (!supplierSchemas.some((schema) => schema["@type"] === "BreadcrumbList")) {
    throw new Error("supplier detail: missing BreadcrumbList JSON-LD");
  }
}

for (const path of publicPaths) {
  const url = `https://tryweddly.com${path}`;
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error(`${path}: missing from sitemap`);
}

for (const target of publicPaths) {
  const incoming = [...htmlByPath.entries()].some(
    ([source, html]) => source !== target && html.includes(`href="${target}"`),
  );
  if (!incoming) throw new Error(`${target}: no incoming ordinary HTML link`);
}

for (const path of privatePaths) {
  const response = await fetch(`${base}${path}`, { headers: { Host: "tryweddly.com" } });
  const robotsHeader = response.headers.get("x-robots-tag") ?? "";
  const html = await response.text();
  const robotsMeta = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? "";
  if (!robotsHeader.includes("noindex") && !robotsMeta.includes("noindex")) {
    throw new Error(`${path}: missing noindex control`);
  }
  if (sitemap.includes(`<loc>https://tryweddly.com${path}</loc>`)) {
    throw new Error(`${path}: private/auth route present in sitemap`);
  }
}

for (const forbidden of ["/api/", "/app", "/login", "/signup", "/rsvp", "/w/"]) {
  if (sitemap.includes(`<loc>https://tryweddly.com${forbidden}`)) {
    throw new Error(`sitemap contains forbidden URL prefix: ${forbidden}`);
  }
}

const filteredDirectory = await fetch(`${base}/vendors/browse?category=ures-talalat`, {
  headers: { Host: "tryweddly.com" },
});
if (!(filteredDirectory.headers.get("x-robots-tag") ?? "").includes("noindex")) {
  throw new Error("filtered supplier directory: missing noindex header");
}

const robotsResponse = await fetch(`${base}/robots.txt`, { headers: { Host: "tryweddly.com" } });
const robots = await robotsResponse.text();
if (
  robotsResponse.status !== 200 ||
  !robots.includes("Disallow: /api/") ||
  !robots.includes("Sitemap: https://tryweddly.com/sitemap.xml")
) {
  throw new Error("robots.txt: missing API exclusion or canonical sitemap reference");
}

const missing = await fetch(`${base}/biztosan-nem-letezo-oldal`, {
  headers: { Host: "tryweddly.com" },
});
if (missing.status !== 404) throw new Error(`missing route: expected 404, got ${missing.status}`);

console.log(
  `SEO validation passed: ${publicPaths.length} public routes, sitemap, noindex and 404.`,
);
