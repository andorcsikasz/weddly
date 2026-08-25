#!/usr/bin/env bun

// Discover Hungarian wedding businesses from a public directory, then keep
// only complete, unique records whose official website supplies a usable
// first-party image. The discovery response is deliberately sanitised: its
// account-management tokens and internal fields never enter our report.
//
// Usage:
//   HU_VENDOR_PAGES=60 HU_VENDOR_CONCURRENCY=8 \
//     bun backend/scripts/build_hungary_vendor_batch.ts

// Output:
//   backend/src/domain/suppliers_data_hu_scale_2026_08.ts
//   docs/hungary-vendor-research-2026-08-25.json

// The generated descriptions are original factual summaries. They contain
// three sentences in both Hungarian and English, and do not copy profile text.

import type { SupplierCategory } from "@shared/suppliers";
import { DIRECTORY } from "../src/domain/suppliers_data";
import { isAcceptableHero, officialSupplierWebsite } from "../src/domain/listing_image_backfill";
import { extractBodyImageCandidates, extractLinkPreview } from "../src/lib/link_preview";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { assertSafeFetchUrl } from "../src/lib/ssrf";

const DISCOVERY_ORIGIN = "https://naszdal.hu";
const DISCOVERY_API = `${DISCOVERY_ORIGIN}/api/vendors`;
const OUTPUT = new URL("../src/domain/suppliers_data_hu_scale_2026_08.ts", import.meta.url);
const REPORT = new URL("../../docs/hungary-vendor-research-2026-08-25.json", import.meta.url);
const TARGET_HUNGARY_TOTAL = 1_000;
const PAGE_COUNT = Math.max(1, Number(process.env.HU_VENDOR_PAGES ?? 60));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.HU_VENDOR_CONCURRENCY ?? 8)));

interface DiscoveryVendor {
  id: string;
  name: string;
  category: string;
  city: string;
  county: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  photo_url: string | null;
  place_id: string | null;
  rating: string | number | null;
  reviews: number | null;
  status?: string;
}

interface DiscoveryPage {
  vendors: DiscoveryVendor[];
  total: number;
  hasMore: boolean;
}

interface Candidate {
  discovery_id: string;
  discovery_profile: string;
  name: string;
  category: SupplierCategory;
  city: string;
  county: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  place_id: string | null;
  rating: number | null;
  reviews: number | null;
}

interface Accepted extends Candidate {
  id: string;
  gallery_urls: string[];
}

const CATEGORY_MAP: Record<string, SupplierCategory> = {
  "Autó & Transzfer": "transport",
  Catering: "catering",
  Ceremóniamester: "mc_celebrant",
  Dekoráció: "wedding_decor",
  Egyéb: "other",
  Esküvőszervező: "wedding_planner",
  "Fotós & Videós": "photography",
  Helyszín: "venue",
  "Meghívó & Nyomda": "invitation_graphics",
  "Ruha & Divat": "bridal_boutique",
  "Smink & Frizura": "hair_makeup",
  Szertartásvezető: "celebrant",
  Tortakészítő: "cake_dessert",
  Táncoktatás: "dance_lessons",
  Virágdekorátor: "florist",
  "Zenekar / DJ": "dj",
  Ékszer: "wedding_jewelry",
};

const CATEGORY_COPY: Record<
  SupplierCategory,
  { hu: string; en: string; askHu: string; askEn: string }
> = {
  wedding_planner: {
    hu: "esküvőszervező",
    en: "wedding planner",
    askHu:
      "A tervezési csomagot, a szolgáltatói feladatokat és az esküvőnapi jelenlétet közvetlenül érdemes egyeztetni.",
    askEn:
      "Couples should confirm the planning scope, supplier responsibilities and wedding-day presence directly.",
  },
  venue: {
    hu: "esküvői helyszín",
    en: "wedding venue",
    askHu:
      "A férőhelyet, a cateringet, a zajkorlátot és az esőtervet a választott dátumra közvetlenül kell ellenőrizni.",
    askEn:
      "Couples should check capacity, catering, sound limits and the wet-weather plan directly for their date.",
  },
  accommodation: {
    hu: "esküvői vendégek fogadására alkalmas szálláshely",
    en: "accommodation for wedding guests",
    askHu:
      "A csoportos kapacitást, a minimum éjszakaszámot és a transzfer lehetőségét közvetlenül érdemes megerősíteni.",
    askEn: "Couples should confirm group capacity, minimum stays and transfer options directly.",
  },
  tent_pavilion: {
    hu: "sátor- és pavilonszolgáltató",
    en: "tent and pavilion provider",
    askHu:
      "A méretet, padlózatot, építést, időjárási feltételeket és bontást tételesen kell egyeztetni.",
    askEn:
      "Couples should itemise dimensions, flooring, setup, weather limits and teardown in the quote.",
  },
  catering: {
    hu: "esküvői catering szolgáltató",
    en: "wedding catering provider",
    askHu:
      "A menüt, személyzetet, eszközöket, kiszállást és speciális étrendeket tételes ajánlatban érdemes kérni.",
    askEn:
      "Couples should request an itemised quote covering the menu, staff, equipment, travel and special diets.",
  },
  cake_dessert: {
    hu: "torta- és desszertkészítő",
    en: "cake and dessert provider",
    askHu:
      "A torta méretét, a kóstolást, a hűtést, a dekorációt és a kiszállítást közvetlenül érdemes egyeztetni.",
    askEn:
      "Couples should confirm sizing, tasting, refrigeration, decoration and delivery directly.",
  },
  bar_drinks: {
    hu: "esküvői bár- és italszolgáltató",
    en: "wedding bar and drinks provider",
    askHu:
      "Az itallapot, személyzetet, eszközöket és fogyasztási feltételeket tételesen érdemes egyeztetni.",
    askEn: "Couples should itemise the drinks list, staff, equipment and consumption terms.",
  },
  food_trucks: {
    hu: "mobil vendéglátó",
    en: "mobile food provider",
    askHu:
      "A beállást, az áram- és vízigényt, az adagkapacitást és a kiszállási díjat előre kell megerősíteni.",
    askEn: "Couples should confirm access, utilities, serving capacity and travel fees in advance.",
  },
  wedding_decor: {
    hu: "esküvői dekorációs szolgáltató",
    en: "wedding decoration provider",
    askHu:
      "A látványtervet, a bérelt elemeket, a szállítást, az építést és a bontást részletes ajánlatban érdemes kérni.",
    askEn:
      "Couples should request a detailed quote covering the design, hired pieces, delivery, setup and teardown.",
  },
  florist: {
    hu: "esküvői virágkötő",
    en: "wedding florist",
    askHu:
      "A menyasszonyi csokrot, a helyszíni virágokat, a kiszállítást és a bontást ajánlatban érdemes rögzíteni.",
    askEn:
      "Couples should put the bridal bouquet, venue flowers, delivery and teardown into the quote.",
  },
  lighting: {
    hu: "rendezvényvilágítási szolgáltató",
    en: "event-lighting provider",
    askHu:
      "A fénytervet, az áramigényt, az építést, az ügyeletet és a bontást tételesen kell egyeztetni.",
    askEn:
      "Couples should itemise the lighting plan, power, setup, on-site technician and teardown.",
  },
  rental_equipment: {
    hu: "rendezvényeszköz-kölcsönző",
    en: "event-equipment rental provider",
    askHu: "A készletet, szállítást, építést, bontást és kauciót tételes ajánlatban érdemes kérni.",
    askEn:
      "Couples should request an itemised quote covering stock, delivery, setup, teardown and deposit.",
  },
  photography: {
    hu: "esküvői fotós vagy videós szolgáltató",
    en: "wedding photography or video provider",
    askHu:
      "A csomag tartalmát, a rendelkezésre állási időt, az utazást és az átadási határidőt írásban kell megerősíteni.",
    askEn:
      "Couples should confirm the package, coverage time, travel and delivery deadline in writing.",
  },
  videography: {
    hu: "esküvői videós szolgáltató",
    en: "wedding video provider",
    askHu:
      "A stáb létszámát, a filmek hosszát, az utazást és az átadási határidőt szerződésben érdemes rögzíteni.",
    askEn:
      "Couples should define crew size, film lengths, travel and delivery deadline in the contract.",
  },
  content_creator: {
    hu: "rendezvényes tartalomkészítő",
    en: "event content creator",
    askHu: "A forgatási időt, a formátumokat és az átadási határidőt írásban érdemes rögzíteni.",
    askEn: "Couples should put coverage time, formats and delivery timing in writing.",
  },
  photo_booth: {
    hu: "fotóautomata-szolgáltató",
    en: "photo-booth provider",
    askHu:
      "Az üzemidőt, a kellékeket, a nyomatokat és a technikai igényeket előre kell egyeztetni.",
    askEn:
      "Couples should confirm operating hours, props, prints and technical requirements in advance.",
  },
  dj: {
    hu: "esküvői zenei szolgáltató",
    en: "wedding music provider",
    askHu:
      "A repertoárt, a játékidőt, a hang- és fénytechnikát, valamint a műsorvezetői feladatokat előre kell tisztázni.",
    askEn:
      "Couples should clarify the repertoire, playing time, sound and lighting, and any MC duties in advance.",
  },
  live_music: {
    hu: "esküvői élőzenei szolgáltató",
    en: "wedding live-music provider",
    askHu:
      "A felállást, repertoárt, játékidőt és technikai igényeket szerződésben érdemes rögzíteni.",
    askEn:
      "Couples should define the lineup, repertoire, playing time and technical rider in the contract.",
  },
  entertainment: {
    hu: "esküvői szórakoztató szolgáltató",
    en: "wedding entertainment provider",
    askHu: "A műsor tartalmát, hosszát, technikai igényét és utazási díját előre kell egyeztetni.",
    askEn: "Couples should confirm the act, duration, technical needs and travel fee in advance.",
  },
  mc_celebrant: {
    hu: "esküvői ceremóniamester",
    en: "wedding master of ceremonies",
    askHu:
      "A forgatókönyvet, a nyelvet, a helyszíni óraszámot és az utazást írásban érdemes rögzíteni.",
    askEn: "Couples should put the running order, language, hours on site and travel in writing.",
  },
  celebrant: {
    hu: "esküvői szertartásvezető",
    en: "wedding celebrant",
    askHu:
      "A személyes szöveget, a nyelvet, a próbát és a jogi szertartástól való elkülönítést előre érdemes egyeztetni.",
    askEn:
      "Couples should confirm the personal script, language, rehearsal and separation from the legal ceremony.",
  },
  dance_lessons: {
    hu: "esküvőitánc-oktató",
    en: "wedding-dance teacher",
    askHu:
      "A koreográfiát, az óraszámot, a próbatermet és a zenei vágást közvetlenül kell egyeztetni.",
    askEn: "Couples should confirm choreography, lesson count, studio and music editing directly.",
  },
  sound_tech: {
    hu: "rendezvénytechnikai szolgáltató",
    en: "event sound provider",
    askHu: "A rendszer méretét, a személyzetet és a tartalék megoldást tételesen érdemes kérni.",
    askEn: "Couples should itemise system size, crew and backup arrangements.",
  },
  bridal_boutique: {
    hu: "menyasszonyi és alkalmi ruhákkal foglalkozó szolgáltató",
    en: "bridal and occasion-wear provider",
    askHu:
      "A próbaidőpontot, az átalakítást, a kölcsönzési feltételeket és az átvételt előre érdemes egyeztetni.",
    askEn: "Couples should confirm fittings, alterations, rental terms and collection in advance.",
  },
  suit_formal: {
    hu: "férfi alkalmi öltözéket kínáló szolgáltató",
    en: "men's formalwear provider",
    askHu:
      "A méretre igazítást, a rendelési határidőt és az esküvő előtti átvételt közvetlenül kell egyeztetni.",
    askEn:
      "Couples should confirm alterations, order lead time and pre-wedding collection directly.",
  },
  hair_makeup: {
    hu: "menyasszonyi hajjal vagy sminkkel foglalkozó szépségszolgáltató",
    en: "bridal hair or makeup provider",
    askHu:
      "A próbát, a helyszíni kiszállást, az időigényt és a választott dátum elérhetőségét közvetlenül kell megerősíteni.",
    askEn:
      "Couples should confirm trials, on-location service, timing and availability for the date directly.",
  },
  nails: {
    hu: "menyasszonyi körömápolási szolgáltató",
    en: "bridal nail-care provider",
    askHu:
      "A menyasszonyi időpontot, a próbadíszítést és a tartóssági igényeket közvetlenül érdemes egyeztetni.",
    askEn:
      "Couples should confirm the bridal appointment, trial design and durability requirements directly.",
  },
  wedding_jewelry: {
    hu: "esküvői ékszer- és karikagyűrű-szolgáltató",
    en: "wedding-jewellery and ring provider",
    askHu:
      "A karikagyűrű-kínálatot, az egyedi méretezést és az elkészítési határidőt közvetlenül kell egyeztetni.",
    askEn:
      "Couples should ask directly about wedding rings, custom sizing and production lead time.",
  },
  invitation_graphics: {
    hu: "esküvői meghívó- és papírtermék-készítő",
    en: "wedding invitation and paper-goods provider",
    askHu:
      "A mintapéldányt, a darabszámot, a személyre szabást és a szállítási határidőt írásban érdemes rögzíteni.",
    askEn: "Couples should put the proof, quantity, personalisation and delivery date in writing.",
  },
  transport: {
    hu: "esküvői személyszállító szolgáltató",
    en: "wedding transport provider",
    askHu:
      "Az útvonalat, a férőhelyet, a várakozási időt és az éjszakai díjat előre kell rögzíteni.",
    askEn: "Couples should agree the route, capacity, waiting time and late-night rate in advance.",
  },
  other: {
    hu: "esküvőhöz kapcsolódó szolgáltató",
    en: "wedding-related provider",
    askHu:
      "A pontos szolgáltatási kört, díjazást és rendelkezésre állást közvetlenül érdemes egyeztetni.",
    askEn: "Couples should confirm the exact scope, pricing and availability directly.",
  },
};

function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function websiteKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
}

function cleanEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  if (/\.(?:png|jpe?g|webp|gif)$/i.test(email)) return null;
  return email;
}

function cleanPhone(value: string | null): string | null {
  const phone = value?.replace(/\s+/g, " ").trim() ?? "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? phone : null;
}

function quote(value: unknown): string {
  return JSON.stringify(value);
}

async function fetchDiscovery(): Promise<DiscoveryVendor[]> {
  const pages = Array.from({ length: PAGE_COUNT }, (_, index) => index + 1);
  const out: DiscoveryVendor[] = [];
  for (let start = 0; start < pages.length; start += 4) {
    const part = pages.slice(start, start + 4);
    const results = await Promise.all(
      part.map(async (page) => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const response = await fetch(`${DISCOVERY_API}?page=${page}`, {
            headers: { "User-Agent": "WeddlyResearchBot/1.0 (+https://weddly.hu)" },
          });
          if (response.ok) return (await response.json()) as DiscoveryPage;
          if (response.status !== 429 || attempt === 5) {
            throw new Error(`discovery page ${page}: HTTP ${response.status}`);
          }
          const retryAfter = Number(response.headers.get("retry-after") ?? 0);
          await Bun.sleep(Math.max(retryAfter * 1_000, 1_000 * 2 ** attempt));
        }
        throw new Error(`discovery page ${page}: retry loop exhausted`);
      }),
    );
    out.push(...results.flatMap((result) => result.vendors));
    await Bun.sleep(250);
  }
  return out;
}

function roundRobinByCategory(candidates: Candidate[]): Candidate[] {
  const existingCounts = new Map<SupplierCategory, number>();
  for (const entry of DIRECTORY) {
    if (entry.country !== "HU" || entry.id.startsWith("hu-scale-")) continue;
    existingCounts.set(entry.category, (existingCounts.get(entry.category) ?? 0) + 1);
  }
  const groups = new Map<SupplierCategory, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.category) ?? [];
    group.push(candidate);
    groups.set(candidate.category, group);
  }
  const orderedCategories = [...groups.keys()].sort(
    (a, b) => (existingCounts.get(a) ?? 0) - (existingCounts.get(b) ?? 0) || a.localeCompare(b),
  );
  const out: Candidate[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const category of orderedCategories) {
      const next = groups.get(category)?.shift();
      if (!next) continue;
      out.push(next);
      added = true;
    }
  }
  return out;
}

const WEDDING_EVIDENCE: Partial<Record<SupplierCategory, RegExp>> = {
  bridal_boutique: /menyasszony|esküvői ruh|bridal|wedding dress/i,
  cake_dessert: /esküvői tort|menyasszonyi tort|lakodalmi tort|wedding cake/i,
  catering: /esküvő|lakodal|wedding/i,
  celebrant: /szertartásvezet|ceremónia|wedding celebrant/i,
  dance_lessons: /esküvői tánc|nyitótánc|wedding dance|first dance/i,
  dj: /esküvő|lakodal|wedding|partyzenekar/i,
  florist: /menyasszonyi csokor|esküvői virág|esküvői dekor|wedding flor|bridal bouquet/i,
  hair_makeup: /menyasszony|esküvői (?:haj|smink|frizura)|bridal (?:hair|makeup)/i,
  invitation_graphics: /esküvői meghív|wedding invitation|lakodalmi meghív/i,
  mc_celebrant: /ceremóniamester|vőfély|wedding mc|master of ceremonies/i,
  photography: /esküvő|wedding|menyasszony|bridal/i,
  transport: /esküvő|wedding/i,
  venue: /esküvő|lakodal|wedding/i,
  wedding_decor: /esküvő|lakodal|menyasszony|wedding|bridal/i,
  wedding_jewelry: /karikagyűrű|eljegyzési gyűrű|wedding ring|engagement ring/i,
  wedding_planner: /esküvőszervez|wedding plann/i,
};

const GENERAL_WEDDING_EVIDENCE = /esküvő|lakodal|menyasszony|vőlegény|wedding|bridal|bride/i;
const JUNK_IMAGE_RE =
  /logo|favicon|(?:^|[\/_-])(?:ico|icon|sprite|placeholder|spacer|avatar|badge|pixel|loader|spinner|watermark|flags?)(?:[\/_\-.]|$)|facebook[-_ ]?(?:logo|preview)|szechenyi|infoblokk|mastervisa|mastercard|(?:phone|email)[_-]|empty\.(?:jpe?g|png|webp)/i;
const PAGE_TIMEOUT_MS = 8_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

async function fetchOfficialPage(
  website: string,
): Promise<{ html: string; finalUrl: string } | null> {
  let current: URL;
  try {
    current = await assertSafeFetchUrl(website);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= 4; hop++) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "WeddlyResearchBot/1.0 (+https://weddly.hu)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = await assertSafeFetchUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) {
        return null;
      }
      const body = response.body;
      if (!body) return null;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let html = "";
      let size = 0;
      try {
        while (size < MAX_PAGE_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          html += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return { html, finalUrl: current.toString() };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function officialGallery(
  candidate: Candidate,
): Promise<{ gallery: string[]; relevance: boolean }> {
  const page = await fetchOfficialPage(candidate.website);
  if (!page) return { gallery: [], relevance: false };
  const evidence = WEDDING_EVIDENCE[candidate.category] ?? GENERAL_WEDDING_EVIDENCE;
  const relevance = evidence.test(page.html);
  if (!relevance) return { gallery: [], relevance: false };

  const preview = extractLinkPreview(page.html, page.finalUrl);
  const body = extractBodyImageCandidates(page.html, page.finalUrl);
  const candidates = [preview.image_url, ...body].filter((url): url is string => {
    if (!url) return false;
    try {
      const path = decodeURIComponent(new URL(url).pathname)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return !JUNK_IMAGE_RE.test(path);
    } catch {
      return false;
    }
  });
  const seen = new Set<string>();
  for (const imageUrl of candidates.slice(0, 8)) {
    if (seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    const image = await fetchRemoteImage(imageUrl);
    if (!image || !isAcceptableHero(image.width, image.height)) continue;
    if (image.width && image.height) {
      if (Math.min(image.width, image.height) < 300 || Math.max(image.width, image.height) < 500) {
        continue;
      }
    }
    return { gallery: [imageUrl], relevance: true };
  }
  return { gallery: [], relevance: true };
}

const baseline = DIRECTORY.filter(
  (entry) => entry.country === "HU" && !entry.id.startsWith("hu-scale-"),
);
const currentScaleCount = DIRECTORY.filter(
  (entry) => entry.country === "HU" && entry.id.startsWith("hu-scale-"),
).length;
// Never shrink an already-reviewed batch merely because another Hungarian
// source grew later. Re-runs remain stable while still filling any real gap to
// the product-wide minimum.
const needed = Math.max(currentScaleCount, TARGET_HUNGARY_TOTAL - baseline.length, 0);
if (needed === 0) {
  console.log(`Hungarian baseline already has ${baseline.length} records; no batch needed.`);
  process.exit(0);
}

const existingNames = new Set(baseline.map((entry) => normalise(entry.name)));
const existingWebsites = new Set(baseline.map((entry) => websiteKey(entry.website)));
const existingEmails = new Set(
  baseline
    .map((entry) => entry.contact_email?.toLowerCase())
    .filter((email): email is string => !!email),
);
const existingPhones = new Set(
  baseline
    .map((entry) => entry.contact_phone?.replace(/\D/g, ""))
    .filter((phone): phone is string => !!phone),
);
const seenNames = new Set<string>();
const seenWebsites = new Set<string>();
const seenEmails = new Set<string>();
const seenPhones = new Set<string>();
const discovery = await fetchDiscovery();
const candidates: Candidate[] = [];

for (const vendor of discovery) {
  const category = CATEGORY_MAP[vendor.category];
  const website = vendor.website ? officialSupplierWebsite(vendor.website) : null;
  const email = cleanEmail(vendor.email);
  const phone = cleanPhone(vendor.phone);
  const nameKey = normalise(vendor.name ?? "");
  const siteKey = website ? websiteKey(website) : "";
  const phoneKey = phone?.replace(/\D/g, "") ?? "";
  const city = vendor.city?.trim() ?? "";
  if (
    !category ||
    !website ||
    !email ||
    !phone ||
    !vendor.name?.trim() ||
    !city ||
    /^(?:fszt|földszint|emelet)$/i.test(city) ||
    /^\d/.test(city)
  ) {
    continue;
  }
  if (
    existingNames.has(nameKey) ||
    existingWebsites.has(siteKey) ||
    existingEmails.has(email) ||
    existingPhones.has(phoneKey) ||
    seenNames.has(nameKey) ||
    seenWebsites.has(siteKey) ||
    seenEmails.has(email) ||
    seenPhones.has(phoneKey)
  ) {
    continue;
  }
  seenNames.add(nameKey);
  seenWebsites.add(siteKey);
  seenEmails.add(email);
  seenPhones.add(phoneKey);
  const rating = vendor.rating == null ? null : Number(vendor.rating);
  candidates.push({
    discovery_id: vendor.id,
    discovery_profile: `${DISCOVERY_ORIGIN}/directory/${vendor.id}`,
    name: vendor.name.trim(),
    category,
    city,
    county: vendor.county?.trim() || city,
    website,
    contact_email: email,
    contact_phone: phone,
    place_id: vendor.place_id ?? null,
    rating: Number.isFinite(rating) ? rating : null,
    reviews: Number.isFinite(vendor.reviews) ? vendor.reviews : null,
  });
}

const queue = roundRobinByCategory(candidates);
const accepted: Accepted[] = [];
const rejected: Array<{ discovery_id: string; name: string; reason: string }> = [];
let cursor = 0;
let checked = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (accepted.length < needed) {
      const index = cursor++;
      const candidate = queue[index];
      if (!candidate) return;
      const result = await officialGallery(candidate);
      checked++;
      if (!result.relevance) {
        rejected.push({
          discovery_id: candidate.discovery_id,
          name: candidate.name,
          reason: "official_website_has_no_category_specific_wedding_evidence",
        });
      } else if (result.gallery.length === 0) {
        rejected.push({
          discovery_id: candidate.discovery_id,
          name: candidate.name,
          reason: "official_website_has_no_usable_image",
        });
      } else if (accepted.length < needed) {
        const ordinal = String(accepted.length + 1).padStart(3, "0");
        accepted.push({
          ...candidate,
          id: `hu-scale-${normalise(`${candidate.name}-${candidate.city}`) || `vendor-${ordinal}`}-${ordinal}`,
          gallery_urls: result.gallery,
        });
      }
      if (checked % 25 === 0) {
        console.log(`checked ${checked}/${queue.length}; accepted ${accepted.length}/${needed}`);
      }
    }
  }),
);

if (accepted.length < needed) {
  throw new Error(
    `Only ${accepted.length}/${needed} complete vendors had a usable first-party image after ${checked} checks. Increase HU_VENDOR_PAGES and retry.`,
  );
}

accepted.sort((a, b) => a.id.localeCompare(b.id));
const entries = accepted.map((vendor) => {
  const copy = CATEGORY_COPY[vendor.category];
  const region =
    vendor.county && vendor.county !== vendor.city
      ? `${vendor.city}, ${vendor.county}`
      : vendor.city;
  const blurbHu = `${vendor.name} ${region} térségében működő ${copy.hu}. A vállalkozás közvetlen telefonszámot, e-mail-címet és saját weboldalon elérhető képes bemutatkozást tesz közzé. ${copy.askHu}`;
  const blurbEn = `${vendor.name} is a ${copy.en} serving the ${region} area. The business publishes a direct phone number, an email address and an illustrated profile on its official website. ${copy.askEn}`;
  return `  {
    id: ${quote(vendor.id)},
    name: ${quote(vendor.name)},
    category: ${quote(vendor.category)},
    city: ${quote(vendor.city)},
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu: ${quote(blurbHu)},
    blurb_en: ${quote(blurbEn)},
    website: ${quote(vendor.website)},
    gallery_urls: ${quote(vendor.gallery_urls)},
    contact_email: ${quote(vendor.contact_email)},
    contact_phone: ${quote(vendor.contact_phone)},
    lat: null,
    lng: null,
    source: "curated",
    price_band: null,
  },`;
});

await Bun.write(
  OUTPUT,
  `// Generated from audited public Hungarian wedding-business discovery, August 2026.\n// Contact details come from public business profiles; every retained image comes from\n// the business's official website. Original three-sentence descriptions are generated\n// by backend/scripts/build_hungary_vendor_batch.ts. Source evidence is retained in\n// docs/hungary-vendor-research-2026-08-25.json.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const HUNGARY_SCALE_2026_08: RawDirectoryEntry[] = [\n${entries.join("\n")}\n];\n`,
);

const formatter = Bun.spawn(["bunx", "biome", "format", "--write", OUTPUT.pathname], {
  cwd: new URL("../..", import.meta.url).pathname,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await formatter.exited) !== 0) {
  throw new Error("Biome could not format the generated Hungary vendor batch");
}

await Bun.write(
  REPORT,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      discovery_source: `${DISCOVERY_ORIGIN}/directory`,
      official_site_policy:
        "Discovery only from the directory; retained gallery image is fetched and quality-checked from each business's official website.",
      privacy_note:
        "Only public business fields used by Weddly are retained. Discovery-site edit, approval, claim and account tokens are deliberately discarded.",
      baseline_hungarian_count: baseline.length,
      target_hungarian_count: TARGET_HUNGARY_TOTAL,
      accepted_count: accepted.length,
      checked_for_official_image: checked,
      records: accepted.map((vendor) => ({
        id: vendor.id,
        discovery_profile: vendor.discovery_profile,
        official_website: vendor.website,
        name: vendor.name,
        category: vendor.category,
        city: vendor.city,
        county: vendor.county,
        contact_email: vendor.contact_email,
        contact_phone: vendor.contact_phone,
        official_image_urls: vendor.gallery_urls,
        google_place_id: vendor.place_id,
        google_rating_at_research_time: vendor.rating,
        google_review_count_at_research_time: vendor.reviews,
      })),
      rejected_image_checks: rejected,
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      baseline_hungarian_count: baseline.length,
      accepted: accepted.length,
      final_hungarian_count: baseline.length + accepted.length,
      checked,
      output: OUTPUT.pathname,
      report: REPORT.pathname,
    },
    null,
    2,
  ),
);
