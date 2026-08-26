#!/usr/bin/env bun

// Discover Hungarian wedding businesses from a public directory, then keep
// only complete, unique records with two to six usable images, including at
// least one first-party image from the official website. The discovery response
// is deliberately sanitised: its
// account-management tokens and internal fields never enter our report.
//
// Usage:
//   HU_VENDOR_PAGES=170 HU_VENDOR_CONCURRENCY=8 \
//     bun backend/scripts/build_hungary_vendor_batch.ts

// Output:
//   backend/src/domain/suppliers_data_hu_scale_2026_08.ts
//   docs/hungary-vendor-research-2026-08-25.json

// The generated descriptions are original factual summaries. They contain
// five sentences in both Hungarian and English, and do not copy profile text.

import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { DIRECTORY } from "../src/domain/suppliers_data";
import { isAcceptableHero, officialSupplierWebsite } from "../src/domain/listing_image_backfill";
import { extractBodyImageCandidates, extractLinkPreview } from "../src/lib/link_preview";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { assertSafeFetchUrl } from "../src/lib/ssrf";

const DISCOVERY_ORIGIN = "https://naszdal.hu";
const DISCOVERY_API = `${DISCOVERY_ORIGIN}/api/vendors`;
const OUTPUT = new URL("../src/domain/suppliers_data_hu_scale_2026_08.ts", import.meta.url);
const REPORT = new URL("../../docs/hungary-vendor-research-2026-08-25.json", import.meta.url);
const TARGET_PER_CATEGORY = 50;
const PAGE_COUNT = Math.max(1, Number(process.env.HU_VENDOR_PAGES ?? 170));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.HU_VENDOR_CONCURRENCY ?? 8)));
const DISCOVERY_ONLY = process.env.HU_VENDOR_DISCOVERY_ONLY === "1";
const ALLOW_SHORTFALL = process.env.HU_VENDOR_ALLOW_SHORTFALL === "1";
const MIN_GALLERY_IMAGES = 2;
const MAX_GALLERY_IMAGES = 6;
const MAX_IMAGE_CANDIDATES = 24;

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
  price_from?: string | number | null;
  price_to?: string | number | null;
  price_unit?: string | null;
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
  discovery_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  place_id: string | null;
  rating: number | null;
  reviews: number | null;
  price_from: number | null;
  price_to: number | null;
  price_unit: string | null;
}

interface Accepted extends Omit<Candidate, "contact_email" | "contact_phone"> {
  id: string;
  gallery_urls: string[];
  contact_email: string;
  contact_phone: string;
  official_image_count: number;
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

const VISIBLE_CATEGORIES = new Set<SupplierCategory>(
  SUPPLIER_GROUPS.flatMap((group) => group.categories),
);

/** The discovery directory predates Weddly's more specific taxonomy. Split
 * its broad buckets only when the public business name supplies an explicit,
 * unambiguous signal; otherwise retain the source category. The official-site
 * wedding-evidence check still runs afterwards. */
function discoveryCategory(sourceCategory: string, name: string): SupplierCategory | null {
  const evidence = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const has = (pattern: RegExp) => pattern.test(evidence);

  if (sourceCategory === "Fotós & Videós") {
    if (has(/content creator|tartalom(?:keszit|gyart)|social media|reels?/)) {
      return "content_creator";
    }
    if (has(/video|film|cinema|motion|mozi|films?/)) return "videography";
    return "photography";
  }
  if (sourceCategory === "Zenekar / DJ") {
    return has(/(?:^|\W)dj(?:\W|$)|lemezlovas/) ? "dj" : "live_music";
  }
  if (sourceCategory === "Helyszín") {
    if (has(/hotel|szallas|szallo|panzio|vendeghaz|apartman|resort|udul/)) {
      return "accommodation";
    }
    return "venue";
  }
  if (sourceCategory === "Catering") {
    if (has(/food\s*truck|street\s*food|bufekocsi|mobil\s*(?:konyha|vendeglat)/)) {
      return "food_trucks";
    }
    if (has(/koktel|cocktail|ital(?:bar|szerviz)|pezsgo|borbar|bar\s*service/)) {
      return "bar_drinks";
    }
    return "catering";
  }
  if (sourceCategory === "Dekoráció") {
    if (has(/sator|pavilon/)) return "tent_pavilion";
    if (has(/fenytechn|vilagitas|light(?:ing)?/)) return "lighting";
    if (has(/kolcson|berbeadas|berles|rental|eszkoz/)) return "rental_equipment";
    if (has(/virag|florist/)) return "florist";
    return "wedding_decor";
  }
  if (sourceCategory === "Ruha & Divat") {
    if (has(/oltony|ferfi\s*(?:divat|ruha)|menswear|szabosag/)) return "suit_formal";
    if (has(/ekszer|gyuru|jewell?ery/)) return "wedding_jewelry";
    return "bridal_boutique";
  }
  if (sourceCategory === "Smink & Frizura") {
    return has(/korom|nail|manikur/) ? "nails" : "hair_makeup";
  }
  if (sourceCategory === "Egyéb") {
    if (has(/content creator|tartalom(?:keszit|gyart)|social media|reels?/)) {
      return "content_creator";
    }
    if (has(/selfie|szelfi|photo\s*booth|foto(?:box|fulke|automata)|magic\s*mirror/)) {
      return "photo_booth";
    }
    if (has(/sator|pavilon/)) return "tent_pavilion";
    if (has(/fenytechn|vilagitas|light(?:ing)?/)) return "lighting";
    if (has(/hangtechn|hangositas|rendezvenytechn|audio|szinpadtechn/)) return "sound_tech";
    if (has(/kolcson|berbeadas|berles|rental|eszkoz/)) return "rental_equipment";
    if (has(/koktel|cocktail|ital(?:bar|szerviz)|pezsgo|borbar/)) return "bar_drinks";
    if (has(/food\s*truck|street\s*food|bufekocsi/)) return "food_trucks";
    if (has(/video|film|cinema|motion/)) return "videography";
    if (has(/buvesz|tuzijatek|animator|show|musor|gyerekprogram/)) return "entertainment";
    if (has(/zenekar|band|elozene|muzsika/)) return "live_music";
    if (has(/hotel|szallas|szallo|panzio|vendeghaz|apartman/)) return "accommodation";
    if (has(/oltony|ferfi\s*(?:divat|ruha)|menswear|szabosag/)) return "suit_formal";
    if (has(/korom|nail|manikur/)) return "nails";
  }
  return CATEGORY_MAP[sourceCategory] ?? null;
}

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
    en: "provider of accommodation for wedding guests",
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
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
}

function cleanEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  if (/\.(?:png|jpe?g|webp|gif)$/i.test(email)) return null;
  if (/^(?:email|test|example|name|yourname)@/i.test(email)) return null;
  if (/@(?:yoursite|yourdomain|example|demolink)\./i.test(email)) return null;
  return email;
}

function cleanPhone(value: string | null): string | null {
  const phone = value?.replace(/\s+/g, " ").trim() ?? "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 11) return null;
  if (/(\d)\1{5,}|1234567|0{5,}/.test(digits)) return null;
  return phone;
}

function cleanPrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const price = typeof value === "number" ? value : Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function quote(value: unknown): string {
  return JSON.stringify(value);
}

async function fetchDiscovery(): Promise<DiscoveryVendor[]> {
  const pages = Array.from({ length: PAGE_COUNT }, (_, index) => index + 1);
  const out: DiscoveryVendor[] = [];
  for (let start = 0; start < pages.length; start += 12) {
    const part = pages.slice(start, start + 12);
    const results = await Promise.all(
      part.map(async (page) => {
        for (let attempt = 0; attempt < 6; attempt++) {
          const response = await fetch(`${DISCOVERY_API}?page=${page}`, {
            headers: { "User-Agent": "WeddlyResearchBot/1.0 (+https://weddly.hu)" },
          });
          if (response.ok) return (await response.json()) as DiscoveryPage;
          if ((response.status !== 429 && response.status < 500) || attempt === 5) {
            throw new Error(`discovery page ${page}: HTTP ${response.status}`);
          }
          const retryAfter = Number(response.headers.get("retry-after") ?? 0);
          await Bun.sleep(Math.max(retryAfter * 1_000, 1_000 * 2 ** attempt));
        }
        throw new Error(`discovery page ${page}: retry loop exhausted`);
      }),
    );
    out.push(...results.flatMap((result) => result.vendors));
    await Bun.sleep(150);
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
  accommodation: /esk[uü]v|lakodal|wedding|násznép|vend[eé]gek sz[aá]ll[aá]sa/i,
  bar_drinks: /esk[uü]v|lakodal|wedding|kokt[eé]l|italb[aá]r/i,
  bridal_boutique: /menyasszony|esküvői ruh|bridal|wedding dress/i,
  cake_dessert: /esküvői tort|menyasszonyi tort|lakodalmi tort|wedding cake/i,
  catering: /esküvő|lakodal|wedding/i,
  celebrant: /szertartásvezet|ceremónia|wedding celebrant/i,
  content_creator: /esk[uü]v|lakodal|wedding|bridal|menyasszony/i,
  dance_lessons: /esküvői tánc|nyitótánc|wedding dance|first dance/i,
  dj: /esküvő|lakodal|wedding|partyzenekar/i,
  entertainment: /esk[uü]v|lakodal|wedding|menyasszony/i,
  florist: /menyasszonyi csokor|esküvői virág|esküvői dekor|wedding flor|bridal bouquet/i,
  food_trucks: /esk[uü]v|lakodal|wedding/i,
  hair_makeup: /menyasszony|esküvői (?:haj|smink|frizura)|bridal (?:hair|makeup)/i,
  invitation_graphics: /esküvői meghív|wedding invitation|lakodalmi meghív/i,
  lighting: /esk[uü]v|lakodal|wedding|rendezv[eé]nyvil[aá]g[ií]t[aá]s/i,
  live_music: /esk[uü]v|lakodal|wedding|menyasszony/i,
  mc_celebrant: /ceremóniamester|vőfély|wedding mc|master of ceremonies/i,
  nails: /menyasszony|esk[uü]v|wedding|bridal/i,
  photo_booth: /esk[uü]v|lakodal|wedding|menyasszony/i,
  photography: /esküvő|wedding|menyasszony|bridal/i,
  rental_equipment: /esk[uü]v|lakodal|wedding|menyasszony/i,
  sound_tech: /esk[uü]v|lakodal|wedding|menyasszony/i,
  suit_formal: /v[őo]leg[eé]ny|esk[uü]v|wedding|groom/i,
  tent_pavilion: /esk[uü]v|lakodal|wedding|menyasszony/i,
  transport: /esküvő|wedding/i,
  venue: /esküvő|lakodal|wedding/i,
  videography: /esk[uü]v|lakodal|wedding|menyasszony|bridal/i,
  wedding_decor: /esküvő|lakodal|menyasszony|wedding|bridal/i,
  wedding_jewelry: /karikagyűrű|eljegyzési gyűrű|wedding ring|engagement ring/i,
  wedding_planner: /esküvőszervez|wedding plann/i,
};

const GENERAL_WEDDING_EVIDENCE = /esküvő|lakodal|menyasszony|vőlegény|wedding|bridal|bride/i;
const JUNK_IMAGE_RE =
  /logo|favicon|(?:^|[\/_-])(?:ico|icon|sprite|placeholder|spacer|avatar|badge|pixel|loader|spinner|watermark|flags?)(?:[\/_\-.]|$)|facebook[-_ ]?(?:logo|preview)|szechenyi|infoblokk|mastervisa|mastercard|(?:phone|email)[_-]|empty\.(?:jpe?g|png|webp)|header-shapes|rounded-squares|degree-stripes|two-circles|many-rounded|vision-header|store-(?:left|right)|flower-circle|demand_bg|plan-6|chatgpt\s+image/i;
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}

function firstPartyPageLinks(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const links: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    if (!match[1]) continue;
    try {
      const url = new URL(decodeHtmlEntities(match[1]), page);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.hostname.replace(/^www\./, "") !== page.hostname.replace(/^www\./, "")) continue;
      url.hash = "";
      const key = url.toString();
      if (seen.has(key) || key === page.toString()) continue;
      const evidence = `${url.pathname} ${match[2]}`;
      let score = 0;
      if (/kapcsolat|elerhet|contact|impressz|about/i.test(evidence)) score += 30;
      if (/eskuv|wedding|lakodal|bridal/i.test(evidence)) score += 20;
      if (/galer|portfolio|referenc|photo|foto|kepek/i.test(evidence)) score += 10;
      if (score > 0) {
        seen.add(key);
        links.push({ url: key, score });
      }
    } catch {
      // Broken and non-http links are not research sources.
    }
  }
  return links
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, 4)
    .map((entry) => entry.url);
}

function pageEmail(html: string): string | null {
  const decoded = decodeHtmlEntities(html);
  const sources = [
    ...decoded.matchAll(/href\s*=\s*["']mailto:([^"'?&#]+)/gi),
    ...decoded.replace(/<[^>]+>/g, " ").matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g),
  ];
  for (const match of sources) {
    const value = cleanEmail(match[1] ?? match[0] ?? null);
    if (!value) continue;
    const [local = "", host = ""] = value.split("@");
    if (/no-?reply|donotreply|privacy|gdpr|adatvedelem|webmaster|sentry/i.test(local)) continue;
    if (/sentry|bugsnag|wixpress|example\.com/i.test(host)) continue;
    return value;
  }
  return null;
}

function pagePhone(html: string): string | null {
  const decoded = decodeHtmlEntities(html);
  for (const match of decoded.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) {
    const value = cleanPhone(match[1] ?? null);
    if (value) return value;
  }
  const text = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  for (const match of text.matchAll(/(?:\+?36|06)[\s()./-]*\d{1,2}(?:[\s()./-]*\d{2,4}){2,3}/g)) {
    const value = cleanPhone(match[0] ?? null);
    if (value) return value;
  }
  return null;
}

async function officialGallery(candidate: Candidate): Promise<{
  gallery: string[];
  official_image_count: number;
  relevance: boolean;
  contact_email: string | null;
  contact_phone: string | null;
}> {
  const home = await fetchOfficialPage(candidate.website);
  if (!home) {
    return {
      gallery: [],
      official_image_count: 0,
      relevance: false,
      contact_email: candidate.contact_email,
      contact_phone: candidate.contact_phone,
    };
  }
  const pages = [home];
  for (const link of firstPartyPageLinks(home.html, home.finalUrl).slice(0, 2)) {
    const page = await fetchOfficialPage(link);
    if (page) pages.push(page);
  }
  const evidence = WEDDING_EVIDENCE[candidate.category] ?? GENERAL_WEDDING_EVIDENCE;
  const relevance = pages.some((page) => evidence.test(page.html));
  const contactEmail =
    candidate.contact_email ?? pages.map((page) => pageEmail(page.html)).find(Boolean) ?? null;
  const contactPhone =
    candidate.contact_phone ?? pages.map((page) => pagePhone(page.html)).find(Boolean) ?? null;
  if (!relevance) {
    return {
      gallery: [],
      official_image_count: 0,
      relevance: false,
      contact_email: contactEmail,
      contact_phone: contactPhone,
    };
  }

  const officialImageCandidates = pages.flatMap((page) => {
    const preview = extractLinkPreview(page.html, page.finalUrl);
    return [preview.image_url, ...extractBodyImageCandidates(page.html, page.finalUrl)];
  });
  const candidates = [
    { url: candidate.discovery_photo_url, source: "discovery" as const },
    ...officialImageCandidates.map((url) => ({ url, source: "official" as const })),
  ].filter((item): item is { url: string; source: "official" | "discovery" } => {
    if (!item.url) return false;
    try {
      const path = decodeURIComponent(new URL(item.url).pathname)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return !JUNK_IMAGE_RE.test(path);
    } catch {
      return false;
    }
  });
  const seen = new Set<string>();
  const gallery: string[] = [];
  let officialImageCount = 0;
  for (const candidateImage of candidates.slice(0, MAX_IMAGE_CANDIDATES)) {
    const imageUrl = candidateImage.url;
    const imageKey = (() => {
      try {
        const url = new URL(imageUrl);
        url.hash = "";
        url.search = "";
        url.pathname = url.pathname.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "");
        url.pathname = url.pathname.replace(/\/\d{2,4}\/(?=[^/]+$)/, "/");
        return url.toString();
      } catch {
        return imageUrl;
      }
    })();
    if (seen.has(imageKey)) continue;
    seen.add(imageKey);
    const image = await fetchRemoteImage(imageUrl);
    if (!image || !isAcceptableHero(image.width, image.height)) continue;
    if (image.width && image.height) {
      if (Math.min(image.width, image.height) < 300 || Math.max(image.width, image.height) < 500) {
        continue;
      }
    }
    gallery.push(imageUrl);
    if (candidateImage.source === "official") officialImageCount++;
    if (gallery.length === MAX_GALLERY_IMAGES) break;
  }
  return {
    gallery,
    official_image_count: officialImageCount,
    relevance: true,
    contact_email: contactEmail,
    contact_phone: contactPhone,
  };
}

interface PreviousResearchReport {
  records?: Array<{ discovery_id?: string; discovery_profile?: string; id?: string }>;
}

const previousReportFile = Bun.file(REPORT);
const previousReport: PreviousResearchReport = (await previousReportFile.exists())
  ? await previousReportFile.json()
  : {};
const previousIdByDiscoveryId = new Map(
  (previousReport.records ?? []).flatMap((record) => {
    const discoveryId =
      record.discovery_id ?? record.discovery_profile?.split("/").filter(Boolean).at(-1);
    return discoveryId && record.id ? [[discoveryId, record.id] as const] : [];
  }),
);

const baseline = DIRECTORY.filter(
  (entry) => entry.country === "HU" && !entry.id.startsWith("hu-scale-"),
);
const currentScale = DIRECTORY.filter(
  (entry) => entry.country === "HU" && entry.id.startsWith("hu-scale-"),
);
const countByCategory = (entries: Array<{ category: SupplierCategory }>) => {
  const counts = new Map<SupplierCategory, number>();
  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return counts;
};
const baselineByCategory = countByCategory(baseline);
const currentScaleByCategory = countByCategory(currentScale);
const targetScaleByCategory = new Map<SupplierCategory, number>();
for (const category of VISIBLE_CATEGORIES) {
  targetScaleByCategory.set(
    category,
    Math.max(
      currentScaleByCategory.get(category) ?? 0,
      TARGET_PER_CATEGORY - (baselineByCategory.get(category) ?? 0),
      0,
    ),
  );
}
// Preserve already-reviewed hidden legacy rows too; the new work only fills
// visible product categories.
for (const [category, count] of currentScaleByCategory) {
  targetScaleByCategory.set(category, Math.max(targetScaleByCategory.get(category) ?? 0, count));
}
const needed = [...targetScaleByCategory.values()].reduce((sum, count) => sum + count, 0);
if (needed === 0) {
  console.log(`Every Hungarian category already has ${TARGET_PER_CATEGORY} records.`);
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
  const category = discoveryCategory(vendor.category, vendor.name ?? "");
  const website = vendor.website ? officialSupplierWebsite(vendor.website) : null;
  const discoveryPhotoUrl = vendor.photo_url
    ? new URL(vendor.photo_url, DISCOVERY_ORIGIN).toString()
    : null;
  const email = cleanEmail(vendor.email);
  const phone = cleanPhone(vendor.phone);
  const nameKey = normalise(vendor.name ?? "");
  const siteKey = website ? websiteKey(website) : "";
  const phoneKey = phone?.replace(/\D/g, "") ?? "";
  const city = vendor.city?.trim() ?? "";
  if (
    !category ||
    !website ||
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
    (email !== null && existingEmails.has(email)) ||
    (phone !== null && existingPhones.has(phoneKey)) ||
    seenNames.has(nameKey) ||
    seenWebsites.has(siteKey) ||
    (email !== null && seenEmails.has(email)) ||
    (phone !== null && seenPhones.has(phoneKey))
  ) {
    continue;
  }
  seenNames.add(nameKey);
  seenWebsites.add(siteKey);
  if (email) seenEmails.add(email);
  if (phoneKey) seenPhones.add(phoneKey);
  const rating = vendor.rating == null ? null : Number(vendor.rating);
  candidates.push({
    discovery_id: vendor.id,
    discovery_profile: `${DISCOVERY_ORIGIN}/directory/${vendor.id}`,
    name: vendor.name.trim(),
    category,
    city,
    county: vendor.county?.trim() || city,
    website,
    discovery_photo_url: discoveryPhotoUrl,
    contact_email: email,
    contact_phone: phone,
    place_id: vendor.place_id ?? null,
    rating: Number.isFinite(rating) ? rating : null,
    reviews: Number.isFinite(vendor.reviews) ? vendor.reviews : null,
    price_from: cleanPrice(vendor.price_from),
    price_to: cleanPrice(vendor.price_to),
    price_unit: vendor.price_unit?.trim() || null,
  });
}

const candidateCounts = countByCategory(candidates);
console.log(
  JSON.stringify(
    {
      discovered: discovery.length,
      eligible_unique_candidates: candidates.length,
      targets: Object.fromEntries(
        [...targetScaleByCategory].map(([category, target]) => [
          category,
          {
            baseline: baselineByCategory.get(category) ?? 0,
            existing_scale: currentScaleByCategory.get(category) ?? 0,
            target_scale: target,
            candidates: candidateCounts.get(category) ?? 0,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
if (DISCOVERY_ONLY) process.exit(0);

const queue = roundRobinByCategory(candidates);
const accepted: Accepted[] = [];
const acceptedByCategory = new Map<SupplierCategory, number>();
const rejected: Array<{ discovery_id: string; name: string; reason: string }> = [];
let cursor = 0;
let checked = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (accepted.length < needed) {
      const index = cursor++;
      const candidate = queue[index];
      if (!candidate) return;
      if (
        (acceptedByCategory.get(candidate.category) ?? 0) >=
        (targetScaleByCategory.get(candidate.category) ?? 0)
      ) {
        continue;
      }
      const result = await officialGallery(candidate);
      checked++;
      if (!result.relevance) {
        rejected.push({
          discovery_id: candidate.discovery_id,
          name: candidate.name,
          reason: "official_website_has_no_category_specific_wedding_evidence",
        });
      } else if (!result.contact_email || !result.contact_phone) {
        rejected.push({
          discovery_id: candidate.discovery_id,
          name: candidate.name,
          reason: "official_sources_do_not_publish_both_email_and_phone",
        });
      } else if (result.official_image_count < 1 || result.gallery.length < MIN_GALLERY_IMAGES) {
        rejected.push({
          discovery_id: candidate.discovery_id,
          name: candidate.name,
          reason: "sources_have_fewer_than_two_usable_images_or_no_first_party_image",
        });
      } else if (
        accepted.length < needed &&
        (acceptedByCategory.get(candidate.category) ?? 0) <
          (targetScaleByCategory.get(candidate.category) ?? 0)
      ) {
        const stableSuffix = candidate.discovery_id.replace(/-/g, "").slice(0, 8);
        accepted.push({
          ...candidate,
          id:
            previousIdByDiscoveryId.get(candidate.discovery_id) ??
            `hu-scale-${normalise(`${candidate.name}-${candidate.city}`) || "vendor"}-${stableSuffix}`,
          gallery_urls: result.gallery,
          contact_email: result.contact_email,
          contact_phone: result.contact_phone,
          official_image_count: result.official_image_count,
        });
        acceptedByCategory.set(
          candidate.category,
          (acceptedByCategory.get(candidate.category) ?? 0) + 1,
        );
      }
      if (checked % 25 === 0) {
        console.log(`checked ${checked}/${queue.length}; accepted ${accepted.length}/${needed}`);
      }
    }
  }),
);

const shortages = [...targetScaleByCategory]
  .map(([category, target]) => ({
    category,
    target,
    accepted: acceptedByCategory.get(category) ?? 0,
    missing: Math.max(0, target - (acceptedByCategory.get(category) ?? 0)),
  }))
  .filter((row) => row.missing > 0);
if (accepted.length < needed && !ALLOW_SHORTFALL) {
  throw new Error(
    `Only ${accepted.length}/${needed} complete vendors had ${MIN_GALLERY_IMAGES}-${MAX_GALLERY_IMAGES} usable images, including a first-party image, after ${checked} checks. Shortages: ${JSON.stringify(shortages)}`,
  );
}
if (shortages.length > 0) {
  console.warn(`Writing a partial source batch; remaining shortages: ${JSON.stringify(shortages)}`);
}

accepted.sort((a, b) => a.id.localeCompare(b.id));
const entries = accepted.map((vendor) => {
  const copy = CATEGORY_COPY[vendor.category];
  // Dots inside legal abbreviations and stylised brand names are not sentence
  // boundaries; omit only those dots from the prose copy so the 4–6 sentence
  // contract remains mechanically verifiable. The actual listing name is kept.
  const proseName = vendor.name.replace(/\.(?=\s|$)/g, "");
  const region =
    vendor.county && vendor.county !== vendor.city
      ? `${vendor.city}, ${vendor.county}`
      : vendor.city;
  const priceRange =
    vendor.price_from !== null && vendor.price_to !== null
      ? `${vendor.price_from.toLocaleString("hu-HU")}–${vendor.price_to.toLocaleString("hu-HU")}`
      : vendor.price_from !== null
        ? `${vendor.price_from.toLocaleString("hu-HU")}-tól`
        : vendor.price_to !== null
          ? `${vendor.price_to.toLocaleString("hu-HU")}-ig`
          : null;
  const priceHu = priceRange
    ? `A nyilvánosan feltüntetett ár ${priceRange}${vendor.price_unit ? ` ${vendor.price_unit}` : ""}; ezt a választott dátumra közvetlenül kell megerősíteni.`
    : "A nyilvános források nem közölnek ellenőrzött árat, ezért aktuális ajánlatot közvetlenül kell kérni.";
  const priceEn = priceRange
    ? `The publicly listed price is ${priceRange}${vendor.price_unit ? ` ${vendor.price_unit}` : ""}; couples should confirm it directly for their date.`
    : "The public sources do not state a verified price, so couples should request a current quote directly.";
  const blurbHu = `${proseName} ${copy.hu}. A szolgáltató megadott működési helye ${region}. A vállalkozás közvetlen telefonszámot, e-mail-címet és saját weboldalon elérhető képes bemutatkozást tesz közzé. ${priceHu} ${copy.askHu}`;
  const blurbEn = `${proseName} is a ${copy.en}. The supplier's listed operating location is ${region}. The business publishes a direct phone number, an email address and an illustrated profile on its official website. ${priceEn} ${copy.askEn}`;
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
  `// Generated from audited public Hungarian wedding-business discovery, August 2026.\n// Contact details come from public profiles and official sites. Every gallery has at\n// least one first-party image; additional images may come from the public discovery\n// profile. Original five-sentence descriptions are generated by the audited builder.\n// Source evidence is retained in docs/hungary-vendor-research-2026-08-25.json.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const HUNGARY_SCALE_2026_08: RawDirectoryEntry[] = [\n${entries.join("\n")}\n];\n`,
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
      official_site_policy: `Discovery records are accepted only with ${MIN_GALLERY_IMAGES}-${MAX_GALLERY_IMAGES} quality-checked images, including at least one image fetched from the business's official website. Additional images may come from its public discovery profile.`,
      privacy_note:
        "Only public business fields used by Weddly are retained. Discovery-site edit, approval, claim and account tokens are deliberately discarded.",
      baseline_hungarian_count: baseline.length,
      target_per_visible_category: TARGET_PER_CATEGORY,
      target_scale_by_category: Object.fromEntries(targetScaleByCategory),
      accepted_by_category: Object.fromEntries(acceptedByCategory),
      remaining_shortages: shortages,
      accepted_count: accepted.length,
      checked_for_official_image: checked,
      records: accepted.map((vendor) => ({
        id: vendor.id,
        discovery_id: vendor.discovery_id,
        discovery_profile: vendor.discovery_profile,
        official_website: vendor.website,
        discovery_photo_url: vendor.discovery_photo_url,
        name: vendor.name,
        category: vendor.category,
        city: vendor.city,
        county: vendor.county,
        contact_email: vendor.contact_email,
        contact_phone: vendor.contact_phone,
        gallery_image_urls: vendor.gallery_urls,
        official_image_count: vendor.official_image_count,
        google_place_id: vendor.place_id,
        google_rating_at_research_time: vendor.rating,
        google_review_count_at_research_time: vendor.reviews,
        published_price_from: vendor.price_from,
        published_price_to: vendor.price_to,
        published_price_unit: vendor.price_unit,
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
