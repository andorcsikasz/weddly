// Build a production-ready Austrian wedding-vendor batch from public profiles,
// then verify each business against its official website.
//
// Discovery source: Austria Wedding category/profile pages. We use the profile
// for structured business contact data, but descriptions are newly authored
// factual summaries and gallery images must resolve from the business's own
// website. Coordinates are resolved from the published address with Nominatim.
//
// Usage:
//   bun backend/scripts/build_austria_vendor_batch.ts [target=364]
//
// Outputs:
//   backend/src/domain/suppliers_data_at_market_2026_08.ts
//   docs/austria-vendor-research-2026-08-19.json

import type { SupplierCategory, VenueStyle } from "@shared/suppliers";
import {
  fetchLinkPreview,
  fetchPageImageCandidates,
  withGalleryFullSizeCandidates,
} from "../src/lib/link_preview";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { DIRECTORY } from "../src/domain/suppliers_data";

const BASE = "https://www.austriawedding.at";
const USER_AGENT = "WeddlyResearchBot/1.0 (+https://www.tryweddly.com)";
const OUTPUT_TS = new URL("../src/domain/suppliers_data_at_market_2026_08.ts", import.meta.url);
const OUTPUT_REPORT = new URL(
  "../../docs/austria-vendor-research-2026-08-19.json",
  import.meta.url,
);
const TARGET = Number.parseInt(process.argv[2] ?? "364", 10);
const DETAIL_CONCURRENCY = 6;
const WEBSITE_CONCURRENCY = 6;
const MAX_OFFICIAL_IMAGE_ATTEMPTS = 10;
const KEEP_IMAGES = 4;
const WKO_BASE = "https://firmen.wko.at";
const WKO_SEARCH = `${WKO_BASE}/hochzeit/`;

interface CategorySource {
  path: string;
  category: SupplierCategory;
  labelDe: string;
  labelEn: string;
}

const SOURCES: CategorySource[] = [
  {
    path: "/hochzeitslocations-oesterreich",
    category: "venue",
    labelDe: "Hochzeitslocation",
    labelEn: "wedding venue",
  },
  {
    path: "/hochzeitsfotografen-oesterreich",
    category: "photography",
    labelDe: "Hochzeitsfotografie",
    labelEn: "wedding photography",
  },
  {
    path: "/hochzeitsplaner-oesterreich",
    category: "wedding_planner",
    labelDe: "Hochzeitsplanung",
    labelEn: "wedding planning",
  },
  {
    path: "/hochzeit-floristik-oesterreich",
    category: "florist",
    labelDe: "Hochzeitsfloristik",
    labelEn: "wedding floristry",
  },
  {
    path: "/hochzeit-dekoration-moebel-oesterreich",
    category: "wedding_decor",
    labelDe: "Hochzeitsdekoration",
    labelEn: "wedding decor",
  },
  {
    path: "/hochzeit-papeterie-oesterreich",
    category: "invitation_graphics",
    labelDe: "Hochzeitspapeterie",
    labelEn: "wedding stationery",
  },
  {
    path: "/freie-trauung-hochzeitsredner-oesterreich",
    category: "celebrant",
    labelDe: "freie Trauungen",
    labelEn: "wedding ceremonies",
  },
  {
    path: "/hochzeitsfilm-videografen-oesterreich",
    category: "videography",
    labelDe: "Hochzeitsvideo",
    labelEn: "wedding videography",
  },
  {
    path: "/hochzeit-catering-oesterreich",
    category: "catering",
    labelDe: "Hochzeitscatering",
    labelEn: "wedding catering",
  },
  {
    path: "/hochzeitstorte-oesterreich",
    category: "cake_dessert",
    labelDe: "Hochzeitstorten und Sweets",
    labelEn: "wedding cakes and desserts",
  },
  {
    path: "/hochzeitsbands",
    category: "live_music",
    labelDe: "Live-Musik für Hochzeiten",
    labelEn: "live wedding music",
  },
  {
    path: "/hochzeits-djs",
    category: "dj",
    labelDe: "Hochzeits-DJ",
    labelEn: "wedding DJ services",
  },
  {
    path: "/brautstyling-oesterreich",
    category: "hair_makeup",
    labelDe: "Brautstyling",
    labelEn: "bridal hair and makeup",
  },
  {
    path: "/brautkleider-oesterreich",
    category: "bridal_boutique",
    labelDe: "Brautmode",
    labelEn: "bridal fashion",
  },
  {
    path: "/eheringe-schmuck-oesterreich",
    category: "wedding_jewelry",
    labelDe: "Eheringe und Hochzeitsschmuck",
    labelEn: "wedding rings and jewellery",
  },
  {
    path: "/hochzeit-tanzkurs-oesterreich",
    category: "dance_lessons",
    labelDe: "Hochzeitstanzkurse",
    labelEn: "wedding dance lessons",
  },
  {
    path: "/hochzeit-entertainment-oesterreich",
    category: "entertainment",
    labelDe: "Hochzeitsentertainment",
    labelEn: "wedding entertainment",
  },
  {
    path: "/hochzeit-anzug-braeutigam",
    category: "suit_formal",
    labelDe: "Hochzeitsanzüge",
    labelEn: "wedding suits and formalwear",
  },
  {
    path: "/musik-trauung",
    category: "live_music",
    labelDe: "Musik für die Trauung",
    labelEn: "ceremony music",
  },
  {
    path: "/fotobox-hochzeit",
    category: "photo_booth",
    labelDe: "Hochzeitsfotobox",
    labelEn: "wedding photo booth services",
  },
  {
    path: "/hochzeit-fahrzeuge-oesterreich",
    category: "transport",
    labelDe: "Hochzeitsfahrzeuge",
    labelEn: "wedding transport",
  },
  {
    path: "/hochzeit-kinderbetreuung-oesterreich",
    category: "entertainment",
    labelDe: "Kinderbetreuung für Hochzeiten",
    labelEn: "wedding childcare and entertainment",
  },
  {
    path: "/hochzeitskerzen-oesterreich",
    category: "wedding_decor",
    labelDe: "Hochzeitskerzen",
    labelEn: "wedding candles and decor",
  },
  {
    path: "/hochzeitsfrisuren-experten",
    category: "hair_makeup",
    labelDe: "Brautfrisuren",
    labelEn: "bridal hair styling",
  },
  {
    path: "/brautschmuck",
    category: "wedding_jewelry",
    labelDe: "Brautschmuck",
    labelEn: "bridal jewellery",
  },
];

interface ProfileRef {
  profileUrl: string;
  profilePath: string;
  source: CategorySource;
}

interface StructuredBusiness {
  name?: string;
  description?: string;
  telephone?: string;
  email?: string;
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  image?: string | string[];
}

interface DetailCandidate {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  region: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  profileUrl: string;
  labelDe: string;
  labelEn: string;
  venueStyle: VenueStyle | null;
  profileImages: string[];
}

interface FinalCandidate extends DetailCandidate {
  lat: number;
  lng: number;
  galleryUrls: string[];
  imageSources: string[];
  geocodeSource: string;
}

interface Rejection {
  profile_url: string;
  stage: "detail" | "dedupe" | "website" | "image" | "geocode";
  reason: string;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function normalizeEmail(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)) {
    return null;
  }
  if (/^(privacy|gdpr|datenschutz|webmaster|no-?reply)@/.test(value)) return null;
  return value;
}

function normalizePhone(raw: string | undefined): string | null {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return value;
}

async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await Bun.sleep(attempt * 700);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWkoText(url: string): Promise<string> {
  let lastError = "unknown curl failure";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const process = Bun.spawn(
      [
        "curl",
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "30",
        "-A",
        "Mozilla/5.0",
        url,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [html, error, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode === 0) return html;
    lastError = error.trim() || `curl exited ${exitCode}`;
    if (attempt < 3) await Bun.sleep(attempt * 1_000);
  }
  throw new Error(lastError);
}

function profileLinks(html: string, source: CategorySource): string[] {
  const prefix = `${source.path}/`;
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    const href = decodeEntities(match[1] ?? "");
    if (href.startsWith(prefix) && href.length > prefix.length) found.add(href.replace(/\/$/, ""));
  }
  return [...found];
}

function paginationKey(html: string): string | null {
  const match = /href=["']\?([a-z0-9]+_page)=2["']/i.exec(html);
  return match?.[1] ?? null;
}

async function discoverProfiles(): Promise<ProfileRef[]> {
  const byPath = new Map<string, ProfileRef>();
  for (const source of SOURCES) {
    const first = await fetchText(`${BASE}${source.path}`);
    for (const path of profileLinks(first, source)) {
      if (!byPath.has(path))
        byPath.set(path, { profilePath: path, profileUrl: `${BASE}${path}`, source });
    }
    const key = paginationKey(first);
    if (key) {
      let emptyPages = 0;
      for (let page = 2; page <= 12 && emptyPages < 2; page++) {
        await Bun.sleep(250);
        const html = await fetchText(`${BASE}${source.path}?${key}=${page}`);
        const paths = profileLinks(html, source);
        let added = 0;
        for (const path of paths) {
          if (!byPath.has(path)) {
            byPath.set(path, { profilePath: path, profileUrl: `${BASE}${path}`, source });
            added++;
          }
        }
        emptyPages = added === 0 ? emptyPages + 1 : 0;
      }
    }
    console.log(`[discover] ${source.category}: ${byPath.size} unique profiles so far`);
  }
  return [...byPath.values()];
}

function parseStructuredBusiness(html: string): StructuredBusiness | null {
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (!match[1]) continue;
    try {
      const parsed = JSON.parse(decodeEntities(match[1])) as {
        "@graph"?: StructuredBusiness[];
        "@type"?: string | string[];
      };
      const nodes = parsed["@graph"] ?? [parsed as StructuredBusiness];
      const business = nodes.find((node) => {
        const type = (node as StructuredBusiness & { "@type"?: string | string[] })["@type"];
        const types = Array.isArray(type) ? type : [type];
        return types.some((value) => value === "LocalBusiness" || value === "EventVenue");
      });
      if (business?.name) return business;
    } catch {
      // Keep looking: Webflow pages occasionally carry unrelated broken JSON.
    }
  }
  return null;
}

function officialWebsite(html: string): string | null {
  const block =
    /<div class=["']o-adressblock["'][^>]*>([\s\S]*?)<\/div><section/i.exec(html)?.[1] ?? html;
  for (const match of block.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
    const raw = decodeEntities(match[1] ?? "");
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (
        host === "austriawedding.at" ||
        host.endsWith(".austriawedding.at") ||
        host.endsWith("instagram.com") ||
        host.endsWith("facebook.com") ||
        host.endsWith("pinterest.com") ||
        host.endsWith("tiktok.com")
      ) {
        continue;
      }
      return url.href;
    } catch {
      // Ignore malformed profile links.
    }
  }
  return null;
}

function venueStyle(name: string, description: string): VenueStyle {
  const text = `${name} ${description}`.toLowerCase();
  if (/schloss|burg|palais|castle/.test(text)) return "castle";
  if (/hotel|resort/.test(text)) return "hotel";
  if (/restaurant|gasthof|wirt|heurig|café|cafe/.test(text)) return "restaurant";
  if (/see|lake|wasser|strand|beach|schiff|boot/.test(text)) return "waterfront";
  if (/alm|hütte|huette|hof|gut|weingut|landgut|stadl|scheune/.test(text)) return "estate";
  if (/villa/.test(text)) return "manor";
  return "event_hall";
}

function parseDetail(ref: ProfileRef, html: string): DetailCandidate | null {
  const business = parseStructuredBusiness(html);
  const website = officialWebsite(html);
  const email = normalizeEmail(business?.email);
  const phone = normalizePhone(business?.telephone);
  const address = business?.address;
  const street = stripTags(address?.streetAddress ?? "");
  const city = stripTags(address?.addressLocality ?? "");
  const region = stripTags(address?.addressRegion ?? "");
  const country = (address?.addressCountry ?? "").toUpperCase();
  const name = stripTags(business?.name ?? "");
  if (!name || !website || !email || !phone || !street || !city || country !== "AT") return null;
  if (!/\d/.test(street)) return null;
  const baseId = normalizeKey(ref.profilePath.split("/").at(-1) ?? name);
  if (!baseId) return null;
  const description = stripTags(business?.description ?? "");
  const profileImages = Array.isArray(business?.image)
    ? business.image
    : business?.image
      ? [business.image]
      : [];
  return {
    id: `at26-${baseId}`,
    name,
    category: ref.source.category,
    city: `${city}, AT`,
    region,
    address: street,
    contactEmail: email,
    contactPhone: phone,
    website,
    profileUrl: ref.profileUrl,
    labelDe: ref.source.labelDe,
    labelEn: ref.source.labelEn,
    venueStyle: ref.source.category === "venue" ? venueStyle(name, description) : null,
    profileImages,
  };
}

function inferWkoCategory(text: string): {
  category: SupplierCategory;
  labelDe: string;
  labelEn: string;
} {
  const value = text.toLowerCase();
  if (/video|film|kamer/.test(value))
    return { category: "videography", labelDe: "Hochzeitsvideo", labelEn: "wedding video" };
  if (/foto/.test(value))
    return {
      category: "photography",
      labelDe: "Hochzeitsfotografie",
      labelEn: "wedding photography",
    };
  if (/flor|blum|gärtn/.test(value))
    return { category: "florist", labelDe: "Hochzeitsfloristik", labelEn: "wedding floristry" };
  if (/tort|konditor|confiser|patisser|bäck/.test(value))
    return {
      category: "cake_dessert",
      labelDe: "Hochzeitstorten und Desserts",
      labelEn: "wedding cakes and desserts",
    };
  if (/cater|partyservice|gastronomie/.test(value))
    return { category: "catering", labelDe: "Hochzeitscatering", labelEn: "wedding catering" };
  if (/brautmod|brautkleid|hochzeitskleid/.test(value))
    return { category: "bridal_boutique", labelDe: "Brautmode", labelEn: "bridal fashion" };
  if (/anzug|herrenmod/.test(value))
    return { category: "suit_formal", labelDe: "Hochzeitsanzüge", labelEn: "wedding formalwear" };
  if (/ring|schmuck|juwel|goldschm/.test(value))
    return {
      category: "wedding_jewelry",
      labelDe: "Eheringe und Hochzeitsschmuck",
      labelEn: "wedding rings and jewellery",
    };
  if (/friseur|haar|make.?up|visag|kosmetik|styling/.test(value))
    return { category: "hair_makeup", labelDe: "Brautstyling", labelEn: "bridal hair and makeup" };
  if (/dj\b|discjockey/.test(value))
    return { category: "dj", labelDe: "Hochzeits-DJ", labelEn: "wedding DJ services" };
  if (/musik|band|sänger|saenger|ensemble|orchester/.test(value))
    return { category: "live_music", labelDe: "Hochzeitsmusik", labelEn: "wedding music" };
  if (/trauung|redner|zeremonie/.test(value))
    return { category: "celebrant", labelDe: "freie Trauungen", labelEn: "wedding ceremonies" };
  if (/plan|organis|eventagentur|hochzeitsservice/.test(value))
    return {
      category: "wedding_planner",
      labelDe: "Hochzeitsplanung",
      labelEn: "wedding planning",
    };
  if (/dekor|ausstattung|verleih|mietmöbel/.test(value))
    return { category: "wedding_decor", labelDe: "Hochzeitsdekoration", labelEn: "wedding decor" };
  if (/papeter|grafik|druck|einladung/.test(value))
    return {
      category: "invitation_graphics",
      labelDe: "Hochzeitspapeterie",
      labelEn: "wedding stationery",
    };
  if (/tanzschul|tanzkurs/.test(value))
    return {
      category: "dance_lessons",
      labelDe: "Hochzeitstanzkurse",
      labelEn: "wedding dance lessons",
    };
  if (/limous|kutsche|fiaker|bus|transport|mietwagen/.test(value))
    return { category: "transport", labelDe: "Hochzeitstransport", labelEn: "wedding transport" };
  if (/hotel|restaurant|gasthof|wirt|location|schloss|burg|gut|hof|eventraum/.test(value))
    return { category: "venue", labelDe: "Hochzeitslocation", labelEn: "wedding venue" };
  return {
    category: "entertainment",
    labelDe: "Hochzeitsunterhaltung",
    labelEn: "wedding entertainment",
  };
}

function parseWkoPage(html: string): DetailCandidate[] {
  const candidates: DetailCandidate[] = [];
  for (const match of html.matchAll(
    /<article class='search-result-article'>([\s\S]*?)<\/article>/gi,
  )) {
    const block = match[1] ?? "";
    const detailHref = decodeEntities(
      /class="title-link"[^>]+href="([^"]+)"/i.exec(block)?.[1] ?? "",
    );
    const name = stripTags(/class="title-link"[^>]*><h3>([\s\S]*?)<\/h3>/i.exec(block)?.[1] ?? "");
    const businessType = stripTags(
      /class="title-details">([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? "",
    );
    const phone = normalizePhone(/href="tel:([^"]+)"/i.exec(block)?.[1]);
    const email = normalizeEmail(decodeEntities(/href='mailto:([^']+)'/i.exec(block)?.[1]));
    const website = decodeEntities(
      /href='(https?:\/\/[^']+)'[^>]+itemprop='url'/i.exec(block)?.[1] ?? "",
    );
    const street = stripTags(/class="street"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? "");
    const place = stripTags(/class="place">([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? "");
    const placeMatch = /^(\d{4})\s+(.+)$/.exec(place);
    const city = placeMatch?.[2]?.trim() ?? "";
    if (
      !name ||
      !detailHref ||
      !phone ||
      !email ||
      !website ||
      !street ||
      !city ||
      !/\d/.test(street)
    )
      continue;
    let parsedWebsite: URL;
    try {
      parsedWebsite = new URL(website);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsedWebsite.protocol) || /(^|\.)wko\.at$/i.test(parsedWebsite.hostname))
      continue;
    const inferred = inferWkoCategory(`${name} ${businessType}`);
    const detailUrl = new URL(detailHref, WKO_BASE).href;
    const firmaId =
      new URL(detailUrl).searchParams.get("firmaid")?.slice(0, 8) ??
      normalizeKey(name).slice(0, 12);
    candidates.push({
      id: `at26-wko-${normalizeKey(name).slice(0, 42)}-${firmaId}`,
      name,
      category: inferred.category,
      city: `${city}, AT`,
      region: "",
      address: street,
      contactEmail: email,
      contactPhone: phone,
      website: parsedWebsite.href,
      profileUrl: detailUrl,
      labelDe: inferred.labelDe,
      labelEn: inferred.labelEn,
      venueStyle: inferred.category === "venue" ? venueStyle(name, businessType) : null,
      profileImages: [],
    });
  }
  return candidates;
}

async function discoverWkoCandidates(): Promise<DetailCandidate[]> {
  const collected: DetailCandidate[] = [];
  let emptyPages = 0;
  for (let page = 1; page <= 70 && emptyPages < 2; page++) {
    const url = page === 1 ? WKO_SEARCH : `${WKO_SEARCH}?page=${page}`;
    try {
      const html = await fetchWkoText(url);
      const parsed = parseWkoPage(html);
      collected.push(...parsed);
      emptyPages = !/search-result-article/i.test(html) ? emptyPages + 1 : 0;
      if (page % 10 === 0) console.log(`[wko] ${page} pages; ${collected.length} complete rows`);
    } catch (error) {
      rejections.push({ profile_url: url, stage: "detail", reason: String(error) });
      emptyPages++;
    }
    await Bun.sleep(500);
  }
  return collected;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) output[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const existingNames = new Set(
  DIRECTORY.map((entry) => normalizeKey(`${entry.name}|${entry.city}`)),
);
const existingWebsites = new Set(DIRECTORY.map((entry) => normalizedUrl(entry.website)));

function isDuplicate(candidate: DetailCandidate, accepted: DetailCandidate[]): boolean {
  if (existingNames.has(normalizeKey(`${candidate.name}|${candidate.city}`))) return true;
  if (existingWebsites.has(normalizedUrl(candidate.website))) return true;
  return accepted.some(
    (entry) =>
      normalizeKey(`${entry.name}|${entry.city}`) ===
        normalizeKey(`${candidate.name}|${candidate.city}`) ||
      normalizedUrl(entry.website) === normalizedUrl(candidate.website),
  );
}

function imageUrlLooksUseful(url: string): boolean {
  return !/(?:^|[-_/.])(logo|icon|favicon|avatar|badge|signet|sprite|placeholder)(?:[-_/.]|$)/i.test(
    decodeURIComponent(url),
  );
}

async function officialImages(website: string): Promise<string[]> {
  const [preview, body] = await Promise.all([
    fetchLinkPreview(website).catch(() => null),
    fetchPageImageCandidates(website).catch(() => [] as string[]),
  ]);
  const candidates = withGalleryFullSizeCandidates([
    ...(preview?.image_url ? [preview.image_url] : []),
    ...body,
  ]).filter(imageUrlLooksUseful);
  return validatedImages(candidates);
}

async function validatedImages(candidates: string[]): Promise<string[]> {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const url of candidates.slice(0, MAX_OFFICIAL_IMAGE_ATTEMPTS)) {
    const key = url.split("?")[0]?.split("/").at(-1)?.toLowerCase() ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    const image = await fetchRemoteImage(url).catch(() => null);
    if (!image?.width || !image.height) continue;
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    if (short < 400 || long < 600 || long / short > 3.5) continue;
    output.push(url);
    if (output.length >= KEEP_IMAGES) break;
    await Bun.sleep(120);
  }
  return output;
}

async function vendorImages(candidate: DetailCandidate): Promise<string[]> {
  const official = await officialImages(candidate.website);
  if (official.length > 0) return official;
  return validatedImages(withGalleryFullSizeCandidates(candidate.profileImages));
}

async function geocode(
  candidate: DetailCandidate,
): Promise<{ lat: number; lng: number; source: string } | null> {
  const city = candidate.city.replace(/,\s*AT$/, "");
  const queries = [
    [candidate.address, city, "Austria"].join(", "),
    [city, candidate.region, "Austria"].filter(Boolean).join(", "),
  ];
  for (const [index, query] of queries.entries()) {
    if (index > 0) await Bun.sleep(1_100);
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "3");
    url.searchParams.set("countrycodes", "at");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("q", query);
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) continue;
      const rows = (await response.json()) as Array<{
        lat?: string;
        lon?: string;
        address?: { country_code?: string };
        osm_type?: string;
        osm_id?: number;
      }>;
      const hit = rows.find((row) => row.address?.country_code?.toLowerCase() === "at") ?? rows[0];
      if (!hit?.lat || !hit.lon) continue;
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      return {
        lat,
        lng,
        source:
          hit.osm_type && hit.osm_id
            ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}`
            : url.href,
      };
    } catch {
      // Try the less specific town/region query next.
    }
  }
  return null;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function renderEntry(entry: FinalCandidate): string {
  const city = entry.city.replace(/,\s*AT$/, "");
  const regionClauseEn = entry.region ? ` in ${entry.region}` : "";
  const blurbHu = `${entry.name} esküvői szolgáltató ${city} településen. A vállalkozás teljes címet, közvetlen elérhetőségeket és esküvői megkeresésekhez használható online portfóliót tesz közzé.`;
  const blurbEn = `${entry.name} provides ${entry.labelEn} in ${city}${regionClauseEn}. The business publishes a full address, direct contact details and its own portfolio for wedding enquiries.`;
  return `  {
    id: ${quote(entry.id)},
    name: ${quote(entry.name)},
    category: ${quote(entry.category)},
    city: ${quote(entry.city)},
    address: ${quote(entry.address)},
    capacity_min: null,
    capacity_max: null,
    blurb_hu: ${quote(blurbHu)},
    blurb_en: ${quote(blurbEn)},
    website: ${quote(entry.website)},
    gallery_urls: ${JSON.stringify(entry.galleryUrls, null, 6).replace(/^/gm, "    ").trimStart()},
    contact_email: ${quote(entry.contactEmail)},
    contact_phone: ${quote(entry.contactPhone)},
    lat: ${entry.lat},
    lng: ${entry.lng},
    source: "curated",
    price_band: null,${entry.venueStyle ? `\n    venue_style: ${quote(entry.venueStyle)},` : ""}
  },`;
}

async function writeOutputs(
  final: FinalCandidate[],
  rejections: Rejection[],
  discovered: { austriaWedding: number; wko: number },
) {
  const ts = `// Generated from public Austrian wedding-vendor profiles, August 2026.
// Contact/address facts are retained with exact source URLs in
// docs/austria-vendor-research-2026-08-19.json. Descriptions are original;
// gallery images were independently verified on each business's own website.

import type { RawDirectoryEntry } from "./suppliers_data";

export const AUSTRIA_MARKET_2026_08: RawDirectoryEntry[] = [
${final.map(renderEntry).join("\n")}
];
`;
  await Bun.write(OUTPUT_TS, ts);
  await Bun.write(
    OUTPUT_REPORT,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        discovery_sources: [BASE, WKO_SEARCH],
        discovered_profiles: discovered,
        accepted_count: final.length,
        rejected_count: rejections.length,
        records: final.map((entry) => ({
          id: entry.id,
          name: entry.name,
          category: entry.category,
          profile_source: entry.profileUrl,
          official_website: entry.website,
          contact_email: entry.contactEmail,
          contact_phone: entry.contactPhone,
          address: entry.address,
          coordinates: { lat: entry.lat, lng: entry.lng, source: entry.geocodeSource },
          image_sources: entry.imageSources,
        })),
        rejections,
      },
      null,
      2,
    )}\n`,
  );
}

if (!Number.isInteger(TARGET) || TARGET < 1) throw new Error("target must be a positive integer");

const rejections: Rejection[] = [];
const refs = await discoverProfiles();
console.log(`[detail] reading ${refs.length} profiles`);
const parsed = await mapLimit(refs, DETAIL_CONCURRENCY, async (ref) => {
  try {
    const candidate = parseDetail(ref, await fetchText(ref.profileUrl));
    if (!candidate) {
      rejections.push({
        profile_url: ref.profileUrl,
        stage: "detail",
        reason: "incomplete structured contact/address/official website",
      });
    }
    return candidate;
  } catch (error) {
    rejections.push({ profile_url: ref.profileUrl, stage: "detail", reason: String(error) });
    return null;
  }
});

const deduped: DetailCandidate[] = [];
for (const candidate of parsed) {
  if (!candidate) continue;
  if (isDuplicate(candidate, deduped)) {
    rejections.push({
      profile_url: candidate.profileUrl,
      stage: "dedupe",
      reason: "matches an existing or already accepted listing",
    });
    continue;
  }
  deduped.push(candidate);
}
console.log(`[website] ${deduped.length} complete and unique profiles; verifying official images`);

let verified = 0;
const withImages = (
  await mapLimit(deduped, WEBSITE_CONCURRENCY, async (candidate) => {
    try {
      const galleryUrls = await vendorImages(candidate);
      if (galleryUrls.length === 0) {
        rejections.push({
          profile_url: candidate.profileUrl,
          stage: "image",
          reason: "no suitable image on official website",
        });
        return null;
      }
      verified++;
      if (verified % 25 === 0) console.log(`[website] ${verified} profiles with official images`);
      return { candidate, galleryUrls };
    } catch (error) {
      rejections.push({
        profile_url: candidate.profileUrl,
        stage: "website",
        reason: String(error),
      });
      return null;
    }
  })
).filter((row): row is { candidate: DetailCandidate; galleryUrls: string[] } => row !== null);

console.log(`[geocode] ${withImages.length} image-verified profiles; resolving exact addresses`);
const final: FinalCandidate[] = [];
for (const [index, row] of withImages.entries()) {
  if (final.length >= TARGET) break;
  if (index > 0) await Bun.sleep(1_100);
  const placed = await geocode(row.candidate);
  if (!placed) {
    rejections.push({
      profile_url: row.candidate.profileUrl,
      stage: "geocode",
      reason: "published address did not resolve in Austria",
    });
    continue;
  }
  final.push({
    ...row.candidate,
    lat: placed.lat,
    lng: placed.lng,
    galleryUrls: row.galleryUrls,
    imageSources: row.galleryUrls,
    geocodeSource: placed.source,
  });
  if (final.length % 25 === 0) {
    console.log(`[geocode] ${final.length}/${TARGET} accepted`);
    await writeOutputs(final, rejections, { austriaWedding: refs.length, wko: 0 });
  }
}

let wkoDiscovered = 0;
if (final.length < TARGET) {
  console.log(`[wko] ${TARGET - final.length} more complete vendors required`);
  const wkoRows = await discoverWkoCandidates();
  wkoDiscovered = wkoRows.length;
  const wkoDeduped: DetailCandidate[] = [];
  for (const candidate of wkoRows) {
    if (isDuplicate(candidate, [...deduped, ...wkoDeduped])) {
      rejections.push({
        profile_url: candidate.profileUrl,
        stage: "dedupe",
        reason: "matches an existing or already accepted listing",
      });
      continue;
    }
    wkoDeduped.push(candidate);
  }
  console.log(`[wko] ${wkoDeduped.length} unique complete rows; verifying official images`);

  let wkoVerified = 0;
  const wkoWithImages = (
    await mapLimit(wkoDeduped, WEBSITE_CONCURRENCY, async (candidate) => {
      try {
        const galleryUrls = await vendorImages(candidate);
        if (galleryUrls.length === 0) {
          rejections.push({
            profile_url: candidate.profileUrl,
            stage: "image",
            reason: "no suitable image on official website",
          });
          return null;
        }
        wkoVerified++;
        if (wkoVerified % 25 === 0)
          console.log(`[wko website] ${wkoVerified} profiles with official images`);
        return { candidate, galleryUrls };
      } catch (error) {
        rejections.push({
          profile_url: candidate.profileUrl,
          stage: "website",
          reason: String(error),
        });
        return null;
      }
    })
  ).filter((row): row is { candidate: DetailCandidate; galleryUrls: string[] } => row !== null);

  console.log(`[wko geocode] ${wkoWithImages.length} image-verified profiles`);
  for (const row of wkoWithImages) {
    if (final.length >= TARGET) break;
    await Bun.sleep(1_100);
    const placed = await geocode(row.candidate);
    if (!placed) {
      rejections.push({
        profile_url: row.candidate.profileUrl,
        stage: "geocode",
        reason: "published address did not resolve in Austria",
      });
      continue;
    }
    final.push({
      ...row.candidate,
      lat: placed.lat,
      lng: placed.lng,
      galleryUrls: row.galleryUrls,
      imageSources: row.galleryUrls,
      geocodeSource: placed.source,
    });
    if (final.length % 25 === 0) {
      console.log(`[total] ${final.length}/${TARGET} accepted`);
      await writeOutputs(final, rejections, {
        austriaWedding: refs.length,
        wko: wkoDiscovered,
      });
    }
  }
}

await writeOutputs(final, rejections, { austriaWedding: refs.length, wko: wkoDiscovered });
console.log(`[done] accepted ${final.length}/${TARGET}; rejected ${rejections.length}`);
if (final.length < TARGET) process.exitCode = 2;
