/**
 * Build an auditable AT/SK wedding-vendor candidate set from public profiles.
 *
 * This is research only: it does not touch the database. A row is emitted only
 * when name, complete postal address, phone, email, vendor website and at least
 * three remotely fetchable profile images are all present. Austrian email
 * addresses are additionally resolved from the vendor's own public website.
 *
 * Usage:
 *   bun backend/scripts/research_at_sk_directory.ts > docs/vendor-research-at-sk-2000.json
 */

type Category =
  | "venue"
  | "wedding_planner"
  | "catering"
  | "cake_dessert"
  | "wedding_decor"
  | "florist"
  | "rental_equipment"
  | "photography"
  | "videography"
  | "photo_booth"
  | "dj"
  | "live_music"
  | "bridal_boutique"
  | "suit_formal"
  | "hair_makeup"
  | "wedding_jewelry"
  | "invitation_graphics"
  | "transport"
  | "other";

type Candidate = {
  source_profile: string;
  country: "AT" | "SK";
  name: string;
  category: Category;
  street: string;
  postal_code: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  lat: number | null;
  lng: number | null;
  gallery_urls: string[];
};

const UA = "Mozilla/5.0 (compatible; WeddlyDirectoryResearch/1.0; +https://weddly.hu)";
const timeoutMs = 15_000;

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&auml;", "ä")
    .replaceAll("&ouml;", "ö")
    .replaceAll("&uuml;", "ü")
    .replaceAll("&Auml;", "Ä")
    .replaceAll("&Ouml;", "Ö")
    .replaceAll("&Uuml;", "Ü")
    .replaceAll("&szlig;", "ß")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function textOnly(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("html") &&
      !contentType.includes("xml") &&
      !contentType.includes("text")
    )
      return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function pooledMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R | null>,
): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const value = await fn(items[index]!, index);
      if (value !== null) output.push(value);
    }
  });
  await Promise.all(workers);
  return output;
}

function normalizeWebsite(raw: string): string | null {
  try {
    const url = new URL(decodeHtml(raw.trim()));
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const rejectedEmailDomains = [
  "example.com",
  "hochzeit.click",
  "hochzeits-location.info",
  "hochzeits-band.info",
  "svadobnyvyhladavac.sk",
  "nasa-svadba.sk",
  "sentry.io",
  "wixpress.com",
  "wordpress.org",
];

function extractEmails(html: string, website: string): string[] {
  const expanded = decodeHtml(html)
    .replace(/\s*(?:\(at\)|\[at\]|\sat\s)\s*/gi, "@")
    .replace(/\s*(?:\(dot\)|\[dot\]|\sdot\s)\s*/gi, ".");
  const host = new URL(website).hostname.replace(/^www\./, "");
  return unique(
    (expanded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
      .map((email) => email.replace(/^mailto:/i, "").toLowerCase())
      .filter((email) => !rejectedEmailDomains.some((domain) => email.endsWith(`@${domain}`)))
      .filter((email) => !/\.(png|jpe?g|webp|svg)$/i.test(email)),
  ).sort((a, b) => {
    const aOwn = a.endsWith(`@${host}`) ? 0 : 1;
    const bOwn = b.endsWith(`@${host}`) ? 0 : 1;
    return aOwn - bOwn;
  });
}

async function emailFromVendorWebsite(website: string): Promise<string | null> {
  const home = await fetchText(website);
  if (!home) return null;
  const direct = extractEmails(home, website);
  if (direct[0]) return direct[0];

  const links = unique(
    [...home.matchAll(/href=["']([^"']+)["']/gi)]
      .map((match) => match[1]!)
      .filter((href) => /kontakt|contact|impressum|imprint|ueber-uns|über-uns/i.test(href))
      .map((href) => {
        try {
          return new URL(decodeHtml(href), website).toString();
        } catch {
          return null;
        }
      })
      .filter((url): url is string => Boolean(url))
      .filter((url) => new URL(url).hostname === new URL(website).hostname)
      .slice(0, 4),
  );

  for (const link of links) {
    const page = await fetchText(link);
    if (!page) continue;
    const emails = extractEmails(page, website);
    if (emails[0]) return emails[0];
  }
  return null;
}

function inferSkCategory(value: string, isVenue: boolean): Category {
  if (isVenue) return "venue";
  const s = value.toLocaleLowerCase("sk");
  if (/catering|gastron|jedlo|menu/.test(s)) return "catering";
  if (/tort|cukr|koláč|dezert|candy|sweet/.test(s)) return "cake_dessert";
  if (/fotobox|fotobúd|fotokút/.test(s)) return "photo_booth";
  if (/kamer|video|film/.test(s)) return "videography";
  if (/fotograf|foto /.test(s)) return "photography";
  if (/dj\b|dídžej/.test(s)) return "dj";
  if (/kapel|hudob|music|spev|saxof|husl/.test(s)) return "live_music";
  if (/kvet|flor/.test(s)) return "florist";
  if (/výzdob|vyzdob|dekor/.test(s)) return "wedding_decor";
  if (/plán|plan|agentúr|organiz/.test(s)) return "wedding_planner";
  if (/oznámen|pozván|papiern|grafik|tlačov/.test(s)) return "invitation_graphics";
  if (/make.?up|vizáž|účes|kader|hair|styling/.test(s)) return "hair_makeup";
  if (/pánsk|oblek/.test(s)) return "suit_formal";
  if (/salón|svadobné šaty|braut|bridal/.test(s)) return "bridal_boutique";
  if (/šperk|obrúč|prsteň|klenot/.test(s)) return "wedding_jewelry";
  if (/auto|limuz|doprava|transport|bus/.test(s)) return "transport";
  if (/prenáj|inventár|mobiliár/.test(s)) return "rental_equipment";
  return "other";
}

function skField(block: string, label: string): string | null {
  const match = block.match(new RegExp(`<strong>${label}<\\/strong>\\s*([^<]+)`, "i"));
  const value = match ? textOnly(match[1]!) : "";
  return value || null;
}

function parseSkProfile(url: string, html: string, isVenue: boolean): Candidate | null {
  const name = textOnly(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const contact =
    html.match(/<span>Kontaktné informácie<\/span>([\s\S]*?)<span>Sociálne profily/i)?.[1] ?? "";
  const address = textOnly(contact.match(/daddr=[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
  const phone =
    [...contact.matchAll(/href=["']tel:([^"']*)["']/gi)]
      .map((match) => decodeHtml(match[1]!).trim())
      .find(Boolean) ?? "";
  const email = skField(contact, "E-mail")?.toLowerCase() ?? null;
  const websiteRaw =
    contact.match(/<strong>Webové stránky<\/strong>[\s\S]{0,300}?href=["']([^"']+)/i)?.[1] ?? "";
  const website = normalizeWebsite(websiteRaw);
  const addressMatch = address.match(/^(.*?),\s*(\d{3}\s?\d{2})\s+([^,]+),\s*Slovensko$/i);
  const images = unique(
    [...html.matchAll(/<li class=["']cbp-slider-item["']>[\s\S]*?<img[^>]+src=["']([^"']+)/gi)]
      .map((match) => decodeHtml(match[1]!).trim())
      .filter((image) => /^https?:\/\//.test(image)),
  ).slice(0, 3);
  if (!name || !addressMatch || !phone || !email || !website || images.length < 3) return null;
  if (!email.includes("@") || email.endsWith("@nasa-svadba.sk")) return null;
  const combined = `${name} ${url} ${textOnly(html.match(/<div class=["']conten-desc["']>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "")}`;
  return {
    source_profile: url,
    country: "SK",
    name,
    category: inferSkCategory(combined, isVenue),
    street: addressMatch[1]!.trim(),
    postal_code: addressMatch[2]!.replace(/\s/g, ""),
    city: addressMatch[3]!.trim(),
    address,
    phone,
    email,
    website,
    lat: null,
    lng: null,
    gallery_urls: images,
  };
}

function extractDiscoverizeJson(html: string): Record<string, any> | null {
  for (const match of html.matchAll(
    /<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]!).trim());
      if (parsed?.["@type"] === "LocalBusiness" && parsed?.address?.addressCountry) return parsed;
    } catch {
      // Ignore unrelated or invalid structured-data blocks.
    }
  }
  return null;
}

async function parseAtProfile(
  url: string,
  html: string,
  category: "venue" | "live_music",
): Promise<Candidate | null> {
  const data = extractDiscoverizeJson(html);
  if (!data || data.address?.addressCountry !== "AT") return null;
  const websiteRaw =
    html.match(/class=["'][^"']*jq-link-to-website[^"']*["'][^>]+href=["']([^"']+)/i)?.[1] ?? "";
  const website = normalizeWebsite(websiteRaw);
  const street = String(data.address?.streetAddress ?? "").trim();
  const postalCode = String(data.address?.postalCode ?? "").trim();
  const city = String(data.address?.addressLocality ?? "").trim();
  const phone = String(data.telephone ?? "").trim();
  const name = String(data.name ?? "").trim();
  const images = unique(
    [
      ...html.matchAll(
        /(?:src|href)=["'](https:\/\/(?:hochzeits-location|hochzeits-band)\.info\/img\/[^"']+)/gi,
      ),
    ]
      .map((match) => decodeHtml(match[1]!).trim())
      .filter((image) => !/logo|icon/i.test(image)),
  ).slice(0, 3);
  if (images.length < 3 && typeof data.image === "string") images.unshift(data.image);
  const gallery = unique(images).slice(0, 3);
  if (!website || !street || !postalCode || !city || !phone || !name || gallery.length < 3)
    return null;
  const email = await emailFromVendorWebsite(website);
  if (!email) return null;
  return {
    source_profile: url,
    country: "AT",
    name,
    category,
    street,
    postal_code: postalCode,
    city,
    address: `${street}, ${postalCode} ${city}, Österreich`,
    phone,
    email,
    website,
    lat: Number.isFinite(Number(data.geo?.latitude)) ? Number(data.geo.latitude) : null,
    lng: Number.isFinite(Number(data.geo?.longitude)) ? Number(data.geo.longitude) : null,
    gallery_urls: gallery,
  };
}

async function sitemapUrls(url: string, pattern: RegExp, gzipped = false): Promise<string[]> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`Sitemap ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some CDNs send the .xml.gz resource already decoded and others leave the
  // gzip bytes intact without a Content-Encoding header. Detect the magic
  // bytes instead of assuming either behaviour.
  const xml =
    gzipped && bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new TextDecoder().decode(Bun.gunzipSync(bytes))
      : new TextDecoder().decode(bytes);
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => decodeHtml(match[1]!))
    .filter((candidate) => pattern.test(candidate));
}

const researchCountry = process.env.RESEARCH_COUNTRY?.toUpperCase();
let sk: Candidate[] = [];
let at: Candidate[] = [];

if (researchCountry !== "AT") {
  const skServiceUrls = await sitemapUrls(
    "https://www.svadobnyvyhladavac.sk/sluzby-sitemap.xml",
    /\/sluzby\/[^/]+\/$/,
  );
  const skVenueUrls = await sitemapUrls(
    "https://www.svadobnyvyhladavac.sk/miesta-sitemap.xml",
    /\/miesta\/[^/]+\/$/,
  );
  const skInputs = [
    ...skServiceUrls.map((url) => ({ url, isVenue: false })),
    ...skVenueUrls.map((url) => ({ url, isVenue: true })),
  ];
  console.error(`Checking ${skInputs.length} Slovak profiles`);
  sk = await pooledMap(skInputs, 8, async ({ url, isVenue }) => {
    const html = await fetchText(url);
    return html ? parseSkProfile(url, html, isVenue) : null;
  });
  console.error(`Accepted ${sk.length} complete Slovak profiles`);
}

if (researchCountry !== "SK") {
  const atLocationUrls = await sitemapUrls(
    "https://hochzeits-location.info/sitemap1.xml.gz",
    /\/hochzeitslocation\/[^/]+$/,
    true,
  );
  const atBandUrls = await sitemapUrls(
    "https://hochzeits-band.info/sitemap1.xml.gz",
    /\/hochzeitsband\/[^/]+$/,
    true,
  );

  // The sitemap begins with Austrian inventory. Fetching bounded slices keeps
  // the research run polite while leaving ample headroom for the target.
  const atInputs = [
    ...atLocationUrls.slice(0, 700).map((url) => ({ url, category: "venue" as const })),
    ...atBandUrls.slice(0, 250).map((url) => ({ url, category: "live_music" as const })),
  ];
  console.error(`Checking ${atInputs.length} Austrian candidates`);
  at = await pooledMap(atInputs, 8, async ({ url, category }) => {
    const html = await fetchText(url);
    return html ? parseAtProfile(url, html, category) : null;
  });
  console.error(`Accepted ${at.length} complete Austrian profiles`);
}

const candidates = [...at, ...sk]
  .filter((candidate, index, all) => {
    const key = `${candidate.country}|${candidate.name.toLocaleLowerCase()}|${candidate.address.toLocaleLowerCase()}`;
    return (
      all.findIndex(
        (other) =>
          `${other.country}|${other.name.toLocaleLowerCase()}|${other.address.toLocaleLowerCase()}` ===
          key,
      ) === index
    );
  })
  .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

const counts = candidates.reduce<Record<string, number>>((acc, candidate) => {
  const key = `${candidate.country}:${candidate.category}`;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      rules: {
        required: ["name", "complete address", "phone", "email", "vendor website", "3 images"],
        austria_email_source: "vendor website/contact/imprint",
        slovakia_source: "public vendor profile",
      },
      counts,
      total: candidates.length,
      candidates,
    },
    null,
    2,
  ),
);
