// Build the final Austrian vendor batch from public Gelbe Seiten Online
// search results, validating imagery independently on each vendor's website.

import type { SupplierCategory, VenueStyle } from "@shared/suppliers";
import { DIRECTORY } from "../src/domain/suppliers_data";
import { AUSTRIA_MARKET_2026_08 } from "../src/domain/suppliers_data_at_market_2026_08";
import { SLOVAKIA_OPEN_WEB_2026_08 } from "../src/domain/suppliers_data_sk_open_web";
import {
  fetchLinkPreview,
  fetchPageImageCandidates,
  withGalleryFullSizeCandidates,
} from "../src/lib/link_preview";
import { fetchRemoteImage } from "../src/lib/remote_image";

const BASE = "https://gelbe-seiten-online.at";
const TARGET = Number.parseInt(process.argv[2] ?? "60", 10);
const OUTPUT = new URL("../src/domain/suppliers_data_at_gsol_2026_08.ts", import.meta.url);
const OUTPUT_REPORT = new URL(
  "../../docs/austria-gsol-vendor-research-2026-08-19.json",
  import.meta.url,
);
const SEARCHES = [
  { term: "Hochzeitsservice und -bedarf", pages: 18 },
  { term: "Hochzeitsfotograf", pages: 2 },
  { term: "Hochzeitslocation", pages: 2 },
  { term: "Hochzeitsplaner", pages: 2 },
  { term: "Hochzeitsfloristik", pages: 2 },
  { term: "Brautmode", pages: 2 },
  { term: "Hochzeitsmusik", pages: 3 },
  { term: "Hochzeitsband", pages: 3 },
  { term: "Hochzeit DJ", pages: 3 },
  { term: "Hochzeitstorte", pages: 3 },
  { term: "Hochzeit Catering", pages: 3 },
  { term: "Hochzeit Dekoration", pages: 3 },
  { term: "Trauredner", pages: 3 },
  { term: "Hochzeitssaal", pages: 3 },
  { term: "Eventlocation Hochzeit", pages: 3 },
  { term: "Fotobox Hochzeit", pages: 3 },
  { term: "Brautstyling", pages: 3 },
  { term: "Eheringe", pages: 3 },
] as const;

interface Candidate {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  profileSource: string;
  discoverySource: string;
  galleryUrls: string[];
  venueStyle: VenueStyle | null;
}

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&szlig;/gi, "ß");
}

function textOnly(value: string): string {
  return decode(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function key(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function websiteKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
}

function inferCategory(value: string): SupplierCategory {
  const text = value.toLowerCase();
  if (/video|film|kamer/.test(text)) return "videography";
  if (/foto/.test(text)) return "photography";
  if (/flor|blum|gärtn/.test(text)) return "florist";
  if (/tort|konditor|confiser|patisser|bäck/.test(text)) return "cake_dessert";
  if (/cater|partyservice|gastronomie/.test(text)) return "catering";
  if (/brautmod|brautkleid|hochzeitskleid/.test(text)) return "bridal_boutique";
  if (/anzug|herrenmod/.test(text)) return "suit_formal";
  if (/ring|schmuck|juwel|goldschm/.test(text)) return "wedding_jewelry";
  if (/friseur|haar|make.?up|visag|kosmetik|styling/.test(text)) return "hair_makeup";
  if (/dj\b|discjockey/.test(text)) return "dj";
  if (/musik|band|sänger|saenger|ensemble|orchester/.test(text)) return "live_music";
  if (/trauung|redner|zeremonie/.test(text)) return "celebrant";
  if (/plan|organis|eventagentur|hochzeitsservice/.test(text)) return "wedding_planner";
  if (/dekor|ausstattung|verleih|mietmöbel/.test(text)) return "wedding_decor";
  if (/papeter|grafik|druck|einladung/.test(text)) return "invitation_graphics";
  if (/tanzschul|tanzkurs/.test(text)) return "dance_lessons";
  if (/limous|kutsche|fiaker|bus|transport|mietwagen/.test(text)) return "transport";
  if (/hotel|restaurant|gasthof|wirt|location|schloss|burg|gut|hof|eventraum/.test(text))
    return "venue";
  return "entertainment";
}

function inferVenueStyle(value: string): VenueStyle {
  const text = value.toLowerCase();
  if (/schloss|burg|palais/.test(text)) return "castle";
  if (/hotel|resort/.test(text)) return "hotel";
  if (/restaurant|gasthof|wirt/.test(text)) return "restaurant";
  if (/see|wasser|strand|schiff|boot/.test(text)) return "waterfront";
  if (/hof|gut|weingut|stadl|scheune/.test(text)) return "estate";
  return "event_hall";
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parsePage(html: string, discoverySource: string): Omit<Candidate, "galleryUrls">[] {
  const output: Omit<Candidate, "galleryUrls">[] = [];
  const chunks = html.split(/<h3 class="fw-bold[^>]*>/i).slice(1);
  for (const chunk of chunks) {
    const heading = /^\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/i.exec(chunk);
    if (!heading?.[1] || !heading[2]) continue;
    const profileSource = new URL(decode(heading[1]), BASE).href;
    const name = textOnly(heading[2]);
    const businessType = textOnly(
      /<span class="fw-bold">([\s\S]*?)<\/span>/i.exec(chunk)?.[1] ?? "",
    );
    const phone = decode(/href="tel:([^"]+)"/i.exec(chunk)?.[1] ?? "").trim();
    const email = decode(/href="mailto:([^"]+)"/i.exec(chunk)?.[1] ?? "")
      .trim()
      .toLowerCase();
    const website = decode(
      /<svg title="Homepage"[\s\S]{0,1800}?<a[^>]+href="(https?:\/\/[^\"]+)"/i.exec(chunk)?.[1] ??
        "",
    );
    const addressMatch = /<div class="">\s*([^<]+)<br>\s*([^<]+)<\/div>/i.exec(chunk);
    const street = textOnly(addressMatch?.[1] ?? "");
    const place = textOnly(addressMatch?.[2] ?? "");
    const cityMatch = /^(\d{4})\s+(.+)$/.exec(place);
    const postalCode = cityMatch?.[1] ?? "";
    const city = cityMatch?.[2]?.trim() ?? "";
    const relevance = `${name} ${businessType}`;
    if (
      !/hochzeit|wedding|braut|trauung|foto|event|dekor|flor|cater|musik|band|\bdj\b|location|hotel|restaurant|gasthof|konditor/i.test(
        relevance,
      )
    )
      continue;
    if (
      !name ||
      !phone ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      !website ||
      !street ||
      !/\d/.test(street) ||
      !postalCode ||
      !city
    )
      continue;
    const category = inferCategory(relevance);
    output.push({
      id: `at26-gsol-${key(name).slice(0, 48)}-${key(profileSource).slice(-5)}`,
      name,
      category,
      city: `${city}, AT`,
      address: `${street}, ${postalCode}`,
      phone,
      email,
      website,
      profileSource,
      discoverySource,
      venueStyle: category === "venue" ? inferVenueStyle(relevance) : null,
    });
  }
  return output;
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

function usefulImage(url: string): boolean {
  return !/(?:^|[-_/.])(logo|icon|favicon|avatar|badge|sprite|placeholder)(?:[-_/.]|$)/i.test(
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
  ]).filter(usefulImage);
  const output: string[] = [];
  const seen = new Set<string>();
  for (const url of candidates.slice(0, 12)) {
    const imageKey = url.split("?")[0]?.split("/").at(-1)?.toLowerCase() ?? url;
    if (seen.has(imageKey)) continue;
    seen.add(imageKey);
    const image = await fetchRemoteImage(url).catch(() => null);
    if (!image?.width || !image.height) continue;
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    if (short < 400 || long < 600 || long / short > 3.5) continue;
    output.push(url);
    if (output.length >= 4) break;
  }
  return output;
}

async function candidateImages(candidate: Omit<Candidate, "galleryUrls">): Promise<string[]> {
  const official = await officialImages(candidate.website);
  if (official.length > 0) return official;
  const profileCandidates = await fetchPageImageCandidates(candidate.profileSource).catch(
    () => [] as string[],
  );
  return validatedProfileImages(profileCandidates);
}

async function validatedProfileImages(candidates: string[]): Promise<string[]> {
  const output: string[] = [];
  const seen = new Set<string>();
  const fullSize = candidates.flatMap((url) => [
    url.replace(/_m(?=\.[a-z0-9]+(?:\?|$))/i, ""),
    url,
  ]);
  for (const url of withGalleryFullSizeCandidates(fullSize).filter(usefulImage).slice(0, 30)) {
    if (!/\/media_at\//i.test(url) || /\/images\//i.test(url)) continue;
    const imageKey = url.split("?")[0]?.split("/").at(-1)?.toLowerCase() ?? url;
    if (seen.has(imageKey)) continue;
    seen.add(imageKey);
    const image = await fetchRemoteImage(url).catch(() => null);
    if (!image?.width || !image.height) continue;
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    if (short < 300 || long < 450 || long / short > 3.5) continue;
    output.push(url);
    if (output.length >= 4) break;
  }
  return output;
}

if (!Number.isInteger(TARGET) || TARGET < 1) throw new Error("target must be positive");

const discovered: Omit<Candidate, "galleryUrls">[] = [];
for (const search of SEARCHES) {
  for (let page = 1; page <= search.pages; page++) {
    const path = `/suche/${encodeURIComponent(search.term)}${page > 1 ? `?page=${page}` : ""}`;
    const url = `${BASE}${path}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const rows = parsePage(html, url);
    discovered.push(...rows);
    if (!/pagination/i.test(html) && page > 1) break;
    await Bun.sleep(250);
  }
  console.log(`[discover] ${search.term}: ${discovered.length} complete relevant rows so far`);
}

const allExisting = [...DIRECTORY, ...AUSTRIA_MARKET_2026_08, ...SLOVAKIA_OPEN_WEB_2026_08];
const names = new Set(allExisting.map((entry) => key(entry.name)));
const websites = new Set(allExisting.map((entry) => websiteKey(entry.website)));
const unique: Omit<Candidate, "galleryUrls">[] = [];
for (const candidate of discovered) {
  const name = key(candidate.name);
  const website = websiteKey(candidate.website);
  if (names.has(name) || websites.has(website)) continue;
  names.add(name);
  websites.add(website);
  unique.push(candidate);
}
console.log(`[images] ${unique.length} unique candidates`);

let verified = 0;
const checked = await mapLimit(unique, 6, async (candidate) => {
  const galleryUrls = await candidateImages(candidate);
  if (galleryUrls.length === 0) return null;
  verified++;
  if (verified % 20 === 0) console.log(`[images] ${verified} official portfolios verified`);
  return { ...candidate, galleryUrls } satisfies Candidate;
});
const accepted = checked.filter((value): value is Candidate => value !== null).slice(0, TARGET);

function quote(value: string): string {
  return JSON.stringify(value);
}

const rendered = accepted.map((candidate) => {
  const city = candidate.city.replace(/,\s*AT$/, "");
  const blurbHu = `${candidate.name} esküvői szolgáltató ${city} településen. A vállalkozás teljes címet, közvetlen telefonos és e-mailes elérhetőséget, valamint saját online portfóliót tesz közzé.`;
  const blurbEn = `${candidate.name} is a wedding vendor based in ${city}. The business publishes a full address, direct phone and email contacts, and its own online portfolio.`;
  return `  {
    id: ${quote(candidate.id)},
    name: ${quote(candidate.name)},
    category: ${quote(candidate.category)},
    city: ${quote(candidate.city)},
    address: ${quote(candidate.address)},
    capacity_min: null,
    capacity_max: null,
    blurb_hu: ${quote(blurbHu)},
    blurb_en: ${quote(blurbEn)},
    website: ${quote(candidate.website)},
    gallery_urls: ${JSON.stringify(candidate.galleryUrls, null, 6).replace(/^/gm, "    ").trimStart()},
    contact_email: ${quote(candidate.email)},
    contact_phone: ${quote(candidate.phone)},
    lat: null,
    lng: null,
    source: "curated",
    price_band: null,${candidate.venueStyle ? `\n    venue_style: ${quote(candidate.venueStyle)},` : ""}
  },`;
});

await Bun.write(
  OUTPUT,
  `// Generated from public Austrian business-directory results, August 2026.
// Contact, discovery and official image sources are retained in the research report.

import type { RawDirectoryEntry } from "./suppliers_data";

export const AUSTRIA_GSOL_2026_08: RawDirectoryEntry[] = [
${rendered.join("\n")}
];
`,
);
await Bun.write(
  OUTPUT_REPORT,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      accepted_count: accepted.length,
      target: TARGET,
      discovered_count: discovered.length,
      unique_count: unique.length,
      records: accepted,
    },
    null,
    2,
  )}\n`,
);
console.log(`[done] accepted ${accepted.length}/${TARGET}`);
if (accepted.length < TARGET) process.exitCode = 2;
