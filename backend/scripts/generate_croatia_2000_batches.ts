#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { DIRECTORY } from "../src/domain/suppliers_data";
import type { SupplierCategory } from "@shared/suppliers";

const [osmPath, mojaDjelatnostPath] = process.argv.slice(2);
if (!osmPath || !mojaDjelatnostPath) {
  console.error(
    "usage: bun backend/scripts/generate_croatia_2000_batches.ts OSM.json MOJA-DJELATNOST.json",
  );
  process.exit(2);
}

const TARGET_NEW_HR = 2_000;
const BATCH_COUNT = 5;
const OUTPUT_DIR = join(import.meta.dir, "../src/domain");
const RESEARCH_OUTPUT = join(import.meta.dir, "../../docs/croatia-vendor-research-2026-08-19.json");

interface ResearchRow {
  name: string;
  category: SupplierCategory;
  city: string;
  address: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  gallery_urls: string[];
  source_url: string;
  source?: string;
  accepted?: boolean;
  lat?: number | null;
  lng?: number | null;
}

interface GeneratedEntry {
  id: string;
  name: string;
  category: SupplierCategory;
  city: string;
  address: string;
  capacity_min: null;
  capacity_max: null;
  blurb_hu: string;
  blurb_en: string;
  website: string;
  gallery_urls: string[];
  contact_email: string;
  contact_phone: string;
  lat: number | null;
  lng: number | null;
  source: "curated";
  price_band: null;
}

const CATEGORY_COPY: Record<SupplierCategory, { hu: string; en: string }> = {
  accommodation: {
    hu: "szálláshely esküvői vendégek elhelyezéséhez. A csoportos kapacitást, a minimum éjszakaszámot és a transzfer lehetőségét közvetlenül érdemes egyeztetni",
    en: "accommodation for wedding guests. Confirm group capacity, minimum stay and transfer options directly",
  },
  hair_makeup: {
    hu: "szépségápolási szolgáltató. A menyasszonyi haj és smink, a próba, valamint a helyszíni kiszállás elérhetőségét a választott dátumra kell megerősíteni",
    en: "a beauty provider. Confirm bridal hair and makeup, trials and on-location availability for the wedding date",
  },
  wedding_jewelry: {
    hu: "ékszerüzlet vagy műhely. A karikagyűrű-kínálatot, az egyedi méretezést és az elkészítési határidőt közvetlenül kell egyeztetni",
    en: "a jewellery shop or workshop. Ask directly about wedding rings, custom sizing and production lead time",
  },
  florist: {
    hu: "virágüzlet vagy virágkötő. Az esküvői csokor, a helyszíni dekoráció, a kiszállítás és a bontás részleteit ajánlatban kell rögzíteni",
    en: "a florist. Put the bridal bouquet, venue flowers, delivery and teardown scope into the quote",
  },
  photography: {
    hu: "fotós szolgáltató. Az esküvői csomagot, a rendelkezésre állási időt, az utazást és a képek átadási határidejét írásban kell megerősíteni",
    en: "a photography provider. Confirm the wedding package, coverage time, travel and delivery deadline in writing",
  },
  catering: {
    hu: "vendéglátó vagy catering szolgáltató. Az esküvői menüt, a személyzetet, az eszközöket, a kiszállást és a speciális étrendeket tételesen kell egyeztetni",
    en: "a catering provider. Itemise the wedding menu, staff, equipment, travel and special diets in the quote",
  },
  cake_dessert: {
    hu: "cukrászda vagy desszertkészítő. Az esküvői torta méretét, kóstolását, hűtését és kiszállítását közvetlenül kell egyeztetni",
    en: "a pastry or dessert provider. Confirm wedding-cake sizing, tasting, refrigeration and delivery directly",
  },
  transport: {
    hu: "személyszállító szolgáltató. Az esküvői transzfer útvonalát, férőhelyét, várakozási idejét és éjszakai díját előre kell rögzíteni",
    en: "a passenger-transport provider. Agree the wedding route, capacity, waiting time and late-night rate in advance",
  },
  rental_equipment: {
    hu: "rendezvényeszköz-kölcsönző. Az esküvői készletet, szállítást, építést, bontást és kauciót tételes ajánlatban kell kérni",
    en: "an event-equipment rental provider. Request an itemised wedding quote covering stock, delivery, setup, teardown and deposit",
  },
  bridal_boutique: {
    hu: "menyasszonyi és alkalmi ruhákkal foglalkozó üzlet. A próbaidőpontot, az átalakítást, a kölcsönzési feltételeket és az átvételt előre kell egyeztetni",
    en: "a bridal and occasion-wear shop. Confirm fitting appointments, alterations, rental terms and collection in advance",
  },
  suit_formal: {
    hu: "férfi alkalmi öltözéket kínáló üzlet. A méretre igazítást, a rendelési határidőt és az esküvő előtti átvételt közvetlenül kell egyeztetni",
    en: "a men's formalwear provider. Confirm alterations, order lead time and pre-wedding collection directly",
  },
  invitation_graphics: {
    hu: "meghívó- és papírtermék-készítő. A mintapéldányt, a nyomdai darabszámot, a személyre szabást és a szállítási határidőt írásban kell rögzíteni",
    en: "an invitation and paper-goods provider. Put the proof, print quantity, personalisation and delivery date in writing",
  },
  wedding_decor: {
    hu: "dekorációs szolgáltató. A látványtervet, a bérelt elemeket, a szállítást, az építést és a bontást egyetlen részletes ajánlatban kell kérni",
    en: "a decoration provider. Request one detailed quote covering the design, hired pieces, transport, setup and teardown",
  },
  wedding_planner: {
    hu: "esküvőszervező. A tervezési csomagot, a beszállítói felelősségeket és az esküvőnapi jelenlét óraszámát szerződésben kell rögzíteni",
    en: "a wedding planner. Define the planning package, supplier responsibilities and hours on site in the contract",
  },
  venue: {
    hu: "rendezvényhelyszín. Az esküvői férőhelyet, a kizárólagosságot, a zajkorlátot, a cateringet és az esőtervet közvetlenül kell ellenőrizni",
    en: "an event venue. Check wedding capacity, exclusivity, sound limits, catering and the wet-weather plan directly",
  },
  bar_drinks: {
    hu: "ital- vagy bárszolgáltató. Az esküvői itallapot, személyzetet, eszközöket és fogyasztási feltételeket tételesen kell egyeztetni",
    en: "a drinks or bar provider. Itemise the wedding drinks list, staff, equipment and consumption terms",
  },
  food_trucks: {
    hu: "mobil vendéglátó. A helyszíni beállást, áram- és vízigényt, adagkapacitást és kiszállási díjat előre kell egyeztetni",
    en: "a mobile food provider. Confirm access, power and water needs, serving capacity and travel fees in advance",
  },
  content_creator: {
    hu: "rendezvényes tartalomkészítő. A forgatási időt, a vertikális videók számát és az átadási határidőt írásban kell rögzíteni",
    en: "an event content creator. Put coverage time, vertical-video count and delivery timing in writing",
  },
  photo_booth: {
    hu: "fotóautomata-szolgáltató. A rendelkezésre állási időt, a kellékeket, a nyomatokat és a technikai igényeket előre kell egyeztetni",
    en: "a photo-booth provider. Confirm operating hours, props, prints and technical requirements in advance",
  },
  videography: {
    hu: "videós szolgáltató. A stáb létszámát, a filmek hosszát, az utazást és az átadási határidőt szerződésben kell rögzíteni",
    en: "a video provider. Define crew size, film lengths, travel and delivery deadline in the contract",
  },
  dj: {
    hu: "DJ-szolgáltató. A zenei egyeztetést, a hang- és fénytechnikát, valamint a műsorvezetői feladatokat előre kell tisztázni",
    en: "a DJ provider. Clarify music planning, sound and lighting, and any MC duties in advance",
  },
  live_music: {
    hu: "élőzenei szolgáltató. A felállást, a repertoárt, a játékidőt és a technikai igényeket szerződésben kell rögzíteni",
    en: "a live-music provider. Define the lineup, repertoire, playing time and technical rider in the contract",
  },
  entertainment: {
    hu: "rendezvényes szórakoztató szolgáltató. A műsor tartalmát, hosszát, technikai igényét és utazási díját előre kell egyeztetni",
    en: "an event-entertainment provider. Confirm the act, duration, technical needs and travel fee in advance",
  },
  mc_celebrant: {
    hu: "rendezvény- vagy ceremóniavezető. A forgatókönyvet, a nyelvet, a jelenléti időt és az utazást írásban kell rögzíteni",
    en: "an event host or MC. Put the running order, language, hours on site and travel in writing",
  },
  celebrant: {
    hu: "szimbolikus szertartásvezető. A személyes szöveget, a nyelvet, a próbát és a jogi szertartástól való elkülönítést előre kell egyeztetni",
    en: "a symbolic celebrant. Confirm the personal script, language, rehearsal and separation from the legal ceremony",
  },
  dance_lessons: {
    hu: "táncoktató. Az elsőtánc-koreográfiát, az óraszámot, a próbatermet és a zenei vágást közvetlenül kell egyeztetni",
    en: "a dance teacher. Confirm first-dance choreography, lesson count, studio and music edit directly",
  },
  sound_tech: {
    hu: "hangtechnikai szolgáltató. A rendszer méretét, a helyszíni bejárást, a személyzetet és a tartalék megoldást tételesen kell kérni",
    en: "a sound provider. Itemise system size, site visit, crew and backup arrangements",
  },
  lighting: {
    hu: "rendezvényvilágítási szolgáltató. A fénytervet, az áramigényt, az építést, az ügyeletet és a bontást tételesen kell egyeztetni",
    en: "an event-lighting provider. Itemise the lighting plan, power, setup, on-site technician and teardown",
  },
  tent_pavilion: {
    hu: "sátor- vagy pavilonszolgáltató. A méretet, padlózatot, időjárási terhelést, építést és bontást írásban kell rögzíteni",
    en: "a tent or pavilion provider. Confirm dimensions, flooring, weather rating, setup and teardown in writing",
  },
  nails: {
    hu: "körömápolási szolgáltató. A menyasszonyi időpontot, a próbadíszítést és a tartóssági igényeket közvetlenül kell egyeztetni",
    en: "a nail-care provider. Confirm the bridal appointment, trial design and durability requirements directly",
  },
  other: {
    hu: "esküvőhöz kapcsolódó szolgáltató. A pontos szolgáltatási kört, díjazást és rendelkezésre állást közvetlenül kell egyeztetni",
    en: "a wedding-adjacent provider. Confirm the exact scope, pricing and availability directly",
  },
};

function normalise(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("hr")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function websiteKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function emailFrom(value: string): string | null {
  for (const match of value.matchAll(
    /[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi,
  )) {
    const email = match[0].toLowerCase();
    if (!email.includes("..")) return email;
  }
  return null;
}

function relevant(row: ResearchRow): boolean {
  if (!row.name || !row.city || !row.address || !row.website) return false;
  if (!row.contact_email || !row.contact_phone || !row.gallery_urls?.length) return false;
  if (!emailFrom(row.contact_email)) return false;
  if (/^(?:\+|00)(?:386|387|381|382|39|43)\b/.test(row.contact_phone.replace(/\s/g, ""))) {
    return false;
  }
  if (row.category === "accommodation" && row.source_url.includes("moja-djelatnost.hr")) {
    const slug = decodeURI(new URL(row.source_url).pathname.split("/")[1] || "");
    return /smjestaj|apartman|hotel|hostel|pansion|(?:^|-)(?:villa|vila)(?:-|$)|kuca-za-odmor|kuce-za-odmor|iznajmljivanje-soba|odmaral|kampiranje|kamp-/i.test(
      slug,
    );
  }
  return true;
}

function toEntry(row: ResearchRow, ordinal: number): GeneratedEntry {
  const city = row.city.replace(/,\s*HR$/i, "").trim();
  const copy = CATEGORY_COPY[row.category] ?? CATEGORY_COPY.other;
  const idBase = normalise(`${row.name}-${city}`) || `croatia-vendor-${ordinal}`;
  const image =
    row.gallery_urls.find((value) => /\/Image\/IndexFile/i.test(value)) ??
    row.gallery_urls.find(
      (value) =>
        /moja-djelatnost\.hr/i.test(value) && !/-10\d\.jpg\.png\?type=Gallery/i.test(value),
    ) ??
    row.gallery_urls.find((value) => /moja-djelatnost\.hr/i.test(value)) ??
    row.gallery_urls.find((value) => !/-10\d\.jpg\.png\?type=Gallery/i.test(value)) ??
    row.gallery_urls[0];
  const email = emailFrom(row.contact_email);
  if (!email) throw new Error(`Invalid email survived filtering for ${row.name}`);
  return {
    id: `hr-scale-${idBase}-${ordinal}`,
    name: row.name.trim(),
    category: row.category,
    city: `${city}, HR`,
    address: row.address.trim(),
    capacity_min: null,
    capacity_max: null,
    blurb_hu: `${row.name} ${city} térségében működő ${copy.hu}.`,
    blurb_en: `${row.name} is ${copy.en} in the ${city} area.`,
    website: row.website,
    gallery_urls: [image],
    contact_email: email.toLowerCase(),
    contact_phone: row.contact_phone.trim(),
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    source: "curated",
    price_band: null,
  };
}

const osmAll = JSON.parse(await readFile(osmPath, "utf8")) as ResearchRow[];
const mojaAll = JSON.parse(await readFile(mojaDjelatnostPath, "utf8")) as ResearchRow[];
const existing = DIRECTORY.filter(
  (entry) => entry.country === "HR" && !entry.id.startsWith("hr-scale-"),
);
const needed = TARGET_NEW_HR;

const seenNameCity = new Set(
  existing.map(
    (entry) => `${normalise(entry.name)}\0${normalise(entry.city.replace(/,\s*HR$/, ""))}`,
  ),
);
const seenExactWebsite = new Set(
  existing.map((entry) => `${normalise(entry.name)}\0${websiteKey(entry.website)}`),
);
const seenContactAddress = new Set(
  existing.map(
    (entry) =>
      `${normalise(entry.contact_email)}\0${(entry.contact_phone || "").replace(/\D/g, "")}\0${normalise(entry.address)}`,
  ),
);

const candidates = [
  ...osmAll
    .filter((row) => row.accepted === true)
    .map((row) => ({ ...row, source: "official website + OSM" })),
  ...mojaAll,
].filter(relevant);

const byCategory = new Map<SupplierCategory, ResearchRow[]>();
for (const row of candidates) {
  const list = byCategory.get(row.category) ?? [];
  list.push(row);
  byCategory.set(row.category, list);
}
for (const list of byCategory.values()) {
  list.sort((a, b) => {
    const sourceRank =
      Number(b.source === "official website + OSM") - Number(a.source === "official website + OSM");
    return sourceRank || a.name.localeCompare(b.name, "hr");
  });
}

const categoryOrder = [...byCategory.keys()].sort((a, b) => {
  if (a === "accommodation") return 1;
  if (b === "accommodation") return -1;
  return a.localeCompare(b);
});
const selected: Array<{ row: ResearchRow; entry: GeneratedEntry }> = [];
let ordinal = 1;
while (selected.length < needed) {
  let progressed = false;
  for (const category of categoryOrder) {
    const list = byCategory.get(category);
    const row = list?.shift();
    if (!row) continue;
    progressed = true;
    const city = row.city.replace(/,\s*HR$/i, "");
    const nameCity = `${normalise(row.name)}\0${normalise(city)}`;
    const exactWebsite = `${normalise(row.name)}\0${websiteKey(row.website)}`;
    const contactAddress = `${normalise(row.contact_email)}\0${row.contact_phone.replace(/\D/g, "")}\0${normalise(row.address)}`;
    if (
      seenNameCity.has(nameCity) ||
      seenExactWebsite.has(exactWebsite) ||
      seenContactAddress.has(contactAddress)
    ) {
      continue;
    }
    seenNameCity.add(nameCity);
    seenExactWebsite.add(exactWebsite);
    seenContactAddress.add(contactAddress);
    const entry = toEntry(row, ordinal++);
    selected.push({ row, entry });
    if (selected.length >= needed) break;
  }
  if (!progressed) break;
}

if (selected.length !== needed) {
  throw new Error(
    `Only ${selected.length} unique complete candidates for ${needed} required slots`,
  );
}

const batchSize = Math.ceil(selected.length / BATCH_COUNT);
for (let index = 0; index < BATCH_COUNT; index += 1) {
  const rows = selected.slice(index * batchSize, (index + 1) * batchSize).map((item) => item.entry);
  const constName = `CROATIA_SCALE_2026_08_${index + 1}`;
  const target = join(OUTPUT_DIR, `suppliers_data_hr_scale_${index + 1}.ts`);
  const source = `// Generated by ${basename(import.meta.path)} from field-complete public Croatian business data.\n// Regenerate from the audit file rather than hand-editing this batch.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const ${constName}: RawDirectoryEntry[] = ${JSON.stringify(rows, null, 2)};\n`;
  await writeFile(target, source, "utf8");
}

await mkdir(dirname(RESEARCH_OUTPUT), { recursive: true });
await writeFile(
  RESEARCH_OUTPUT,
  `${JSON.stringify(
    {
      researched_at: new Date().toISOString(),
      target_added_count: TARGET_NEW_HR,
      existing_hr_count: existing.length,
      added_count: selected.length,
      final_hr_count: existing.length + selected.length,
      required_fields: [
        "website",
        "contact_email",
        "contact_phone",
        "address",
        "description",
        "image",
      ],
      records: selected.map(({ row, entry }) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        city: entry.city,
        address: entry.address,
        website: entry.website,
        contact_email: entry.contact_email,
        contact_phone: entry.contact_phone,
        image: entry.gallery_urls[0],
        source_url: row.source_url,
        source: row.source,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      existing_hr: existing.length,
      added: selected.length,
      final_hr: existing.length + selected.length,
      by_category: Object.fromEntries(
        [...new Set(selected.map((item) => item.entry.category))]
          .sort()
          .map((category) => [
            category,
            selected.filter((item) => item.entry.category === category).length,
          ]),
      ),
    },
    null,
    2,
  ),
);
