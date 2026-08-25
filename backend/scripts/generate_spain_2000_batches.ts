#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SupplierCategory } from "@shared/suppliers";
import { DIRECTORY } from "../src/domain/suppliers_data";

const [todoPath, bodaliaPath] = process.argv.slice(2);
if (!todoPath || !bodaliaPath) {
  console.error(
    "usage: bun backend/scripts/generate_spain_2000_batches.ts TODOENLACES.json BODALIA.json",
  );
  process.exit(2);
}

const TARGET = 2_000;
const BATCHES = 5;
const OUTPUT_DIR = join(import.meta.dir, "../src/domain");
const AUDIT_PATH = join(import.meta.dir, "../../docs/spain-vendor-research-2026-08-19.json");

interface Candidate {
  name: string;
  category_detail?: string;
  category_label?: string;
  source_category: string;
  source_url: string;
  website: string;
  contact_email: string;
  contact_phone: string;
  image_url?: string;
  gallery_urls?: string[];
  address: string;
  city: string;
  postal_code?: string;
  province?: string;
  country: string;
  description?: string;
  lat?: number | null;
  lng?: number | null;
}

interface Selected extends Candidate {
  provider_category: SupplierCategory;
  relevance_score: number;
  research_source: "Todoenlaces" | "Bodalia";
  final_address: string;
  final_gallery_urls: string[];
}

interface Entry {
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

const COPY: Record<SupplierCategory, { hu: string; en: string; askHu: string; askEn: string }> = {
  wedding_planner: {
    hu: "esküvőszervező",
    en: "wedding-planning",
    askHu: "A csomag tartalmát és az esküvőnapi jelenlétet közvetlenül egyeztessétek.",
    askEn: "Confirm the planning scope and wedding-day presence directly.",
  },
  venue: {
    hu: "rendezvényhelyszín",
    en: "event-venue",
    askHu: "A férőhelyet, cateringet, zajkorlátot és esőtervet közvetlenül ellenőrizzétek.",
    askEn: "Check capacity, catering, sound limits and the wet-weather plan directly.",
  },
  accommodation: {
    hu: "szálláshely",
    en: "accommodation",
    askHu: "A csoportos kapacitást, minimum éjszakaszámot és transzfert közvetlenül egyeztessétek.",
    askEn: "Confirm group capacity, minimum stay and transfer options directly.",
  },
  tent_pavilion: {
    hu: "sátor- és pavilonszolgáltató",
    en: "tent and pavilion",
    askHu: "A méretet, padlózatot, építést és bontást tételesen kérjétek.",
    askEn: "Request dimensions, flooring, setup and teardown in the quote.",
  },
  catering: {
    hu: "vendéglátó és catering szolgáltató",
    en: "catering",
    askHu: "A menüt, személyzetet, kiszállást és speciális étrendeket tételesen egyeztessétek.",
    askEn: "Itemise the menu, staff, travel and special diets in the quote.",
  },
  cake_dessert: {
    hu: "torta- és desszertszolgáltató",
    en: "cake and dessert",
    askHu: "A méretet, kóstolást, hűtést és kiszállítást közvetlenül egyeztessétek.",
    askEn: "Confirm sizing, tasting, refrigeration and delivery directly.",
  },
  bar_drinks: {
    hu: "ital- és bárszolgáltató",
    en: "drinks and bar",
    askHu: "Az itallapot, személyzetet és fogyasztási feltételeket tételesen egyeztessétek.",
    askEn: "Itemise the drinks list, staff and consumption terms.",
  },
  food_trucks: {
    hu: "mobil vendéglátó",
    en: "mobile-food",
    askHu: "A helyszíni beállást, technikai igényeket és adagkapacitást előre egyeztessétek.",
    askEn: "Confirm access, utilities and serving capacity in advance.",
  },
  wedding_decor: {
    hu: "dekorációs szolgáltató",
    en: "wedding-decoration",
    askHu: "A látványtervet, szállítást, építést és bontást részletes ajánlatban kérjétek.",
    askEn: "Request a detailed quote covering design, delivery, setup and teardown.",
  },
  florist: {
    hu: "virágkötő",
    en: "floral-design",
    askHu: "A csokrot, helyszíni dekorációt, kiszállítást és bontást ajánlatban rögzítsétek.",
    askEn: "Put bouquets, venue flowers, delivery and teardown into the quote.",
  },
  lighting: {
    hu: "rendezvényvilágítási szolgáltató",
    en: "event-lighting",
    askHu: "A fénytervet, áramigényt, ügyeletet és bontást tételesen egyeztessétek.",
    askEn: "Itemise the lighting plan, power, technician and teardown.",
  },
  rental_equipment: {
    hu: "rendezvényeszköz-kölcsönző",
    en: "event-equipment rental",
    askHu: "A készletet, szállítást, építést, bontást és kauciót tételesen kérjétek.",
    askEn: "Itemise stock, delivery, setup, teardown and deposit.",
  },
  photography: {
    hu: "fotós szolgáltató",
    en: "photography",
    askHu: "A csomagot, rendelkezésre állási időt és átadási határidőt írásban erősítsétek meg.",
    askEn: "Confirm coverage, package and delivery deadline in writing.",
  },
  videography: {
    hu: "videós szolgáltató",
    en: "videography",
    askHu: "A stáb létszámát, filmhosszt és átadási határidőt szerződésben rögzítsétek.",
    askEn: "Define crew size, film lengths and delivery deadline in the contract.",
  },
  content_creator: {
    hu: "rendezvényes tartalomkészítő",
    en: "event-content",
    askHu: "A forgatási időt, formátumokat és átadási határidőt írásban rögzítsétek.",
    askEn: "Put coverage, formats and delivery timing in writing.",
  },
  photo_booth: {
    hu: "fotóautomata-szolgáltató",
    en: "photo-booth",
    askHu: "Az üzemidőt, kellékeket, nyomatokat és technikai igényeket előre egyeztessétek.",
    askEn: "Confirm operating hours, props, prints and technical needs.",
  },
  dj: {
    hu: "DJ-szolgáltató",
    en: "DJ",
    askHu:
      "A zenei egyeztetést, hang- és fénytechnikát, valamint a műsorvezetést előre tisztázzátok.",
    askEn: "Clarify music planning, sound, lighting and MC duties.",
  },
  live_music: {
    hu: "élőzenei szolgáltató",
    en: "live-music",
    askHu: "A felállást, repertoárt, játékidőt és technikai igényeket szerződésben rögzítsétek.",
    askEn: "Define lineup, repertoire, playing time and technical rider.",
  },
  entertainment: {
    hu: "rendezvényes szórakoztató",
    en: "event-entertainment",
    askHu: "A műsort, időtartamot, technikai igényt és utazási díjat előre egyeztessétek.",
    askEn: "Confirm the act, duration, technical needs and travel fee.",
  },
  mc_celebrant: {
    hu: "ceremóniamester",
    en: "wedding-MC",
    askHu: "A forgatókönyvet, nyelvet és helyszíni óraszámot írásban rögzítsétek.",
    askEn: "Put the running order, language and hours on site in writing.",
  },
  celebrant: {
    hu: "szertartásvezető",
    en: "celebrant",
    askHu: "A személyes szöveget, nyelvet és próbát előre egyeztessétek.",
    askEn: "Confirm the personal script, language and rehearsal.",
  },
  dance_lessons: {
    hu: "táncoktató",
    en: "dance-lessons",
    askHu: "A koreográfiát, óraszámot, próbatermet és zenei vágást közvetlenül egyeztessétek.",
    askEn: "Confirm choreography, lesson count, studio and music edit.",
  },
  sound_tech: {
    hu: "hangtechnikai szolgáltató",
    en: "sound-production",
    askHu: "A rendszer méretét, személyzetet és tartalék megoldást tételesen kérjétek.",
    askEn: "Itemise system size, crew and backup arrangements.",
  },
  bridal_boutique: {
    hu: "menyasszonyi és alkalmi divatszolgáltató",
    en: "bridal and occasion-fashion",
    askHu: "A próbaidőpontot, átalakítást és átvételt előre egyeztessétek.",
    askEn: "Confirm fittings, alterations and collection in advance.",
  },
  suit_formal: {
    hu: "férfi alkalmi öltözék szolgáltató",
    en: "men's formalwear",
    askHu: "A méretre igazítást, rendelési határidőt és átvételt közvetlenül egyeztessétek.",
    askEn: "Confirm alterations, lead time and collection directly.",
  },
  hair_makeup: {
    hu: "haj- és szépségápolási szolgáltató",
    en: "hair and beauty",
    askHu: "A menyasszonyi próbát és helyszíni kiszállást a választott dátumra erősítsétek meg.",
    askEn: "Confirm bridal trials and on-location availability for the date.",
  },
  nails: {
    hu: "körömápolási szolgáltató",
    en: "nail-care",
    askHu: "A menyasszonyi időpontot, próbadíszítést és tartóssági igényeket egyeztessétek.",
    askEn: "Confirm the bridal appointment, trial design and durability needs.",
  },
  wedding_jewelry: {
    hu: "ékszerész és karikagyűrű-szolgáltató",
    en: "wedding-jewellery",
    askHu: "Az egyedi méretezést és elkészítési határidőt közvetlenül egyeztessétek.",
    askEn: "Ask directly about custom sizing and production lead time.",
  },
  invitation_graphics: {
    hu: "meghívó- és grafikai szolgáltató",
    en: "invitation and graphic-design",
    askHu: "A mintát, darabszámot, személyre szabást és határidőt írásban rögzítsétek.",
    askEn: "Put the proof, quantity, personalisation and deadline in writing.",
  },
  transport: {
    hu: "személyszállító szolgáltató",
    en: "passenger-transport",
    askHu: "Az útvonalat, férőhelyet, várakozási időt és éjszakai díjat előre rögzítsétek.",
    askEn: "Agree route, capacity, waiting time and late-night rate in advance.",
  },
  other: {
    hu: "esküvőhöz kapcsolódó szolgáltató",
    en: "wedding-adjacent",
    askHu: "A pontos szolgáltatási kört és rendelkezésre állást közvetlenül egyeztessétek.",
    askEn: "Confirm the exact scope and availability directly.",
  },
};

function clean(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value: string): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function webKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return norm(value);
  }
}

function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("34") && digits.length === 11 ? digits.slice(2) : digits;
}

function formatPhone(value: string): string {
  const digits = phoneKey(value);
  if (digits.length === 9)
    return `+34 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return clean(value);
}

function complete(row: Candidate): boolean {
  return Boolean(
    clean(row.name) &&
      /^https?:\/\//i.test(clean(row.website)) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(row.contact_email)) &&
      phoneKey(clean(row.contact_phone)).length >= 9 &&
      clean(row.address) &&
      clean(row.city) &&
      clean(row.country).toUpperCase() === "ES" &&
      (clean(row.image_url) || row.gallery_urls?.some((url) => /^https?:\/\//i.test(url))),
  );
}

const BASE_SCORE: Record<string, number> = {
  alimentacion: 82,
  alojamiento: 100,
  "automocion-y-transporte": 18,
  belleza: 92,
  "comercio-y-tiendas": 42,
  "educacion-y-formacion": 12,
  "hosteleria-y-restauracion": 96,
  "moda-y-complementos": 88,
  "ocio-y-cultura": 72,
  "publicidad-y-marketing": 64,
  "servicios-empresariales-y-consultoria": 18,
  "servicios-para-el-hogar": 12,
  "servicios-profesionales": 8,
  "turismo-activo": 68,
};
const POSITIVE: [RegExp, number][] = [
  [/boda|novi[ao]s?|nupcial|wedding|ceremonia/, 120],
  [/evento|banquete|celebraci[oó]n|fiesta|recinto|sal[oó]n/, 85],
  [/fot[oó]graf|v[ií]deo|audiovisual|dron|film|fotomat[oó]n/, 80],
  [/flor|decor|interior|mobiliario|carpa|iluminaci[oó]n/, 75],
  [
    /catering|pasteler|reposter|panader|tarta|gourmet|comida|restaurante|cafeter|bar|vino|bodega|coctel|cervecer/,
    70,
  ],
  [
    /hotel|hostal|alojamiento|apartamento tur[ií]stico|casa rural|posada|albergue|resort|mas[ií]a|finca/,
    70,
  ],
  [/peluquer|maquill|belleza|est[eé]tica|manicura|pedicura|u[nñ]as|estilista|cosm[eé]tic/, 65],
  [/joyer|reloj|vestido|ropa|moda|traje|sastrer|zapater|lencer[ií]a|calzado/, 60],
  [
    /m[uú]sica|orquesta|\bdj\b|discoteca|espect[aá]culo|teatro|animaci[oó]n|baile|danza|artes esc[eé]nicas/,
    70,
  ],
  [
    /taxi|limusin|autob[uú]s|autocar|alquiler de (coches|veh[ií]culos|furgonetas)|transporte de viajeros|ch[oó]fer/,
    80,
  ],
  [
    /imprenta|impresi[oó]n|papeler|diseñ|branding|publicidad|regalo|artesan|serigraf|rotulaci[oó]n|packaging|confiter|bordad|textil|tapicer|copister|gr[aá]fic|candle|vela/,
    55,
  ],
  [/agencia de viajes|excursi[oó]n|turismo/, 45],
];
const NEGATIVE: [RegExp, number][] = [
  [
    /abogad|asesor[ií]a|jur[ií]dic|gestor[ií]a|fiscal|contable|notar[ií]|procurador|seguro|auditor|financier/,
    -220,
  ],
  [
    /construcci[oó]n|reforma|fontaner|electric|cerrajer|caldera|plaga|persiana|saneamiento|climatizaci[oó]n/,
    -180,
  ],
  [
    /taller de coche|taller mec[aá]nico|chapa y pintura|neum[aá]tico|desguace|repuesto|autoescuela|concesionario/,
    -180,
  ],
  [
    /mascota|veterin|canin|guarder[ií]a|educaci[oó]n infantil|academia de (ingl[eé]s|idiomas|oposiciones|refuerzo)|colegio/,
    -170,
  ],
  [
    /industrial|ingenier|maquinaria|laboratorio|software|inform[aá]tic|tecnolog[ií]a|energ[ií]a|qu[ií]mic|metalurgia/,
    -160,
  ],
  [
    /dental|dentista|fisioter|oste[oó]pat|farmacia|nutricion|salud|m[eé]dic|psic[oó]log|terapeuta/,
    -150,
  ],
  [
    /inmobiliaria|mudanza|almacenamiento|limpieza|coworking|recursos humanos|importaci[oó]n|exportaci[oó]n|log[ií]stica/,
    -140,
  ],
];

function relevance(row: Candidate): number {
  const source = row.source_category.split(",")[0];
  const haystack = `${row.name} ${row.category_detail || ""} ${row.website}`.toLowerCase();
  let score = BASE_SCORE[source] || 0;
  for (const [pattern, points] of POSITIVE) if (pattern.test(haystack)) score += points;
  for (const [pattern, points] of NEGATIVE) if (pattern.test(haystack)) score += points;
  return score;
}

function classify(row: Candidate): SupplierCategory {
  const text =
    `${row.name} ${row.category_detail || ""} ${row.category_label || ""} ${row.source_category}`.toLowerCase();
  if (/fotomat[oó]n|photo.?booth|cabina de fotos/.test(text)) return "photo_booth";
  if (/vide[oó]graf|video production|producci[oó]n de videos|film/.test(text)) return "videography";
  if (/fot[oó]graf|photographer|estudio de fotograf/.test(text)) return "photography";
  if (/wedding planner|organizador de bodas|organizaci[oó]n de bodas/.test(text))
    return "wedding_planner";
  if (/ceremoniante|oficiante|celebrant/.test(text)) return "celebrant";
  if (/maestro de ceremonia|ceremonia.?master|\bmc\b/.test(text)) return "mc_celebrant";
  if (/\bdj\b|discoteca m[oó]vil|discom[oó]vil/.test(text)) return "dj";
  if (/orquesta|grupo musical|m[uú]sica en vivo|live music|cantante|solista|flamenco/.test(text))
    return "live_music";
  if (/sonido|audio|equipo de sonido/.test(text)) return "sound_tech";
  if (/iluminaci[oó]n|lighting/.test(text)) return "lighting";
  if (/baile|danza|dance/.test(text)) return "dance_lessons";
  if (/entretenimiento|animaci[oó]n|espect[aá]culo|fiesta|entertainment/.test(text))
    return "entertainment";
  if (/flor|florist/.test(text)) return "florist";
  if (/carpa|pabell[oó]n|toldo/.test(text)) return "tent_pavilion";
  if (/alquiler|mobiliario|muebles|equipamiento|rental/.test(text)) return "rental_equipment";
  if (/decor|interior|regalo|artesan|cer[aá]mica|jardin/.test(text)) return "wedding_decor";
  if (/pasteler|reposter|panader|confiter|tarta|bakery|helader/.test(text)) return "cake_dessert";
  if (/food.?truck|churrer|comida para llevar/.test(text)) return "food_trucks";
  if (/vino|bodega|bar|cervecer|coctel|bebida/.test(text)) return "bar_drinks";
  if (/catering|comida|alimentaci[oó]n|gourmet/.test(text)) return "catering";
  if (/restaurante|cafeter[ií]a|eventvenue|recinto|sal[oó]n de bodas|banquete/.test(text))
    return "venue";
  if (
    /hotel|hostal|alojamiento|apartamento tur[ií]stico|casa rural|posada|albergue|resort/.test(text)
  )
    return "accommodation";
  if (/joyer|reloj|alianza/.test(text)) return "wedding_jewelry";
  if (/manicura|pedicura|u[nñ]as|nail/.test(text)) return "nails";
  if (/peluquer|maquill|belleza|est[eé]tica|cosm[eé]tic|stylist/.test(text)) return "hair_makeup";
  if (/traje|sastre|formalwear|ropa de hombre/.test(text)) return "suit_formal";
  if (
    /novia|nupcial|vestido|ropa|moda|clothing|zapater|lencer[ií]a|calzado|bordad|textil/.test(text)
  )
    return "bridal_boutique";
  if (
    /imprenta|impresi[oó]n|papeler|invitaci[oó]n|diseñ|branding|serigraf|rotulaci[oó]n|packaging|copister|gr[aá]fic/.test(
      text,
    )
  )
    return "invitation_graphics";
  if (
    /taxi|transporte|limusin|autob[uú]s|autocar|alquiler de (coches|veh[ií]culos|furgonetas)|ch[oó]fer/.test(
      text,
    )
  )
    return "transport";
  if (/publicidad|marketing|contenido|content|agencia seo|redes sociales/.test(text))
    return "content_creator";
  if (/organizaci[oó]n de eventos/.test(text)) return "wedding_planner";
  const source = row.source_category;
  if (source.includes("alojamiento")) return "accommodation";
  if (source.includes("belleza")) return "hair_makeup";
  if (source.includes("hosteleria")) return "venue";
  if (source.includes("alimentacion")) return "catering";
  if (source.includes("moda")) return "bridal_boutique";
  if (source.includes("automocion")) return "transport";
  if (source.includes("publicidad")) return "content_creator";
  if (source.includes("ocio")) return "entertainment";
  if (source.includes("comercio")) return "wedding_decor";
  if (source.includes("educacion")) return "dance_lessons";
  return "rental_equipment";
}

function fullAddress(row: Candidate): string {
  const address = clean(row.address);
  const pieces = [address];
  for (const value of [row.postal_code, row.city, row.province, "España"]) {
    const part = clean(value);
    if (part && !pieces.join(", ").toLowerCase().includes(part.toLowerCase())) pieces.push(part);
  }
  return pieces.join(", ");
}

function hash(value: string): string {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0).toString(36);
}

const todo = JSON.parse(await readFile(todoPath, "utf8")) as { rows: Candidate[] };
const bodalia = JSON.parse(await readFile(bodaliaPath, "utf8")) as { rows: Candidate[] };

const existingDirectory = DIRECTORY.filter((row) => !row.id.startsWith("es-scale-"));
const usedNames = new Set(
  existingDirectory.map(
    (row) => `${norm(row.name)}|${norm(row.city.replace(/,\s*[A-Z]{2}$/, ""))}`,
  ),
);
const usedWebsites = new Set(existingDirectory.map((row) => webKey(row.website)).filter(Boolean));
const usedEmails = new Set(
  existingDirectory.map((row) => clean(row.contact_email).toLowerCase()).filter(Boolean),
);
const usedPhones = new Set(
  existingDirectory
    .map((row) => phoneKey(clean(row.contact_phone)))
    .filter((value) => value.length >= 8),
);

function accept(row: Selected): boolean {
  const name = `${norm(row.name)}|${norm(row.city)}`;
  const website = webKey(row.website);
  const email = clean(row.contact_email).toLowerCase();
  const phone = phoneKey(row.contact_phone);
  if (
    usedNames.has(name) ||
    usedWebsites.has(website) ||
    usedEmails.has(email) ||
    usedPhones.has(phone)
  )
    return false;
  usedNames.add(name);
  usedWebsites.add(website);
  usedEmails.add(email);
  usedPhones.add(phone);
  return true;
}

const bodaliaRows: Selected[] = bodalia.rows
  .map((row) => ({
    ...row,
    city: clean(row.city) || clean(row.province),
    address: clean(row.address) || [clean(row.province), "España"].filter(Boolean).join(", "),
  }))
  .filter(complete)
  .map((row) => ({
    ...row,
    provider_category: classify(row),
    relevance_score: 1_000,
    research_source: "Bodalia",
    final_address: fullAddress(row),
    final_gallery_urls: [
      ...new Set(row.gallery_urls!.filter((url) => /^https?:\/\//i.test(url))),
    ].slice(0, 6),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));
const todoRows: Selected[] = todo.rows
  .filter(complete)
  .map((row) => ({
    ...row,
    provider_category: classify(row),
    relevance_score: relevance(row),
    research_source: "Todoenlaces",
    final_address: fullAddress(row),
    final_gallery_urls: [
      row.image_url!.includes("/BarRicardo-1-150x150.jpg")
        ? "https://barricardo.com/wp-content/uploads/2023/12/3-e1703756439756.png"
        : row.image_url!,
    ],
  }))
  .filter((row) => row.relevance_score >= 0)
  .sort((a, b) => b.relevance_score - a.relevance_score || a.name.localeCompare(b.name, "es"));

const selected: Selected[] = [];
for (const row of [...bodaliaRows, ...todoRows]) {
  if (selected.length === TARGET) break;
  if (accept(row)) selected.push(row);
}
if (selected.length !== TARGET)
  throw new Error(`Only ${selected.length}/${TARGET} unique complete Spanish vendors available`);

const ids = new Set<string>();
const entries: Entry[] = selected.map((row, index) => {
  const city = clean(row.city);
  const baseId = `es-scale-${norm(`${row.name}-${city}`).slice(0, 52)}-${hash(row.source_url)}`;
  if (ids.has(baseId)) throw new Error(`duplicate generated id: ${baseId}`);
  ids.add(baseId);
  const copy = COPY[row.provider_category];
  return {
    id: baseId,
    name: clean(row.name),
    category: row.provider_category,
    city: `${city}, ES`,
    address: row.final_address,
    capacity_min: null,
    capacity_max: null,
    blurb_hu: `${clean(row.name)} ${city} térségében működő spanyolországi ${copy.hu}. ${copy.askHu}`,
    blurb_en: `${clean(row.name)} is a Spain-based ${copy.en} provider serving the ${city} area. ${copy.askEn}`,
    website: clean(row.website),
    gallery_urls: row.final_gallery_urls,
    contact_email: clean(row.contact_email).toLowerCase(),
    contact_phone: formatPhone(row.contact_phone),
    lat: Number.isFinite(row.lat) ? row.lat! : null,
    lng: Number.isFinite(row.lng) ? row.lng! : null,
    source: "curated",
    price_band: null,
  };
});

await mkdir(OUTPUT_DIR, { recursive: true });
for (let batch = 0; batch < BATCHES; batch += 1) {
  const rows = entries.slice(batch * (TARGET / BATCHES), (batch + 1) * (TARGET / BATCHES));
  const exportName = `SPAIN_SCALE_2026_08_${batch + 1}`;
  const contents = `// Generated by generate_spain_2000_batches.ts from contact-complete public Spanish business data.\n// Regenerate from the research audit rather than hand-editing this batch.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const ${exportName}: RawDirectoryEntry[] = ${JSON.stringify(rows, null, 2)};\n`;
  await writeFile(join(OUTPUT_DIR, `suppliers_data_es_scale_${batch + 1}.ts`), contents);
}

const auditRows = selected.map((row, index) => ({
  id: entries[index].id,
  name: entries[index].name,
  category: entries[index].category,
  city: entries[index].city,
  address: entries[index].address,
  website: entries[index].website,
  contact_email: entries[index].contact_email,
  contact_phone: entries[index].contact_phone,
  gallery_urls: entries[index].gallery_urls,
  source_url: row.source_url,
  research_source: row.research_source,
  source_category: row.source_category,
  source_description: clean(row.description) || null,
  relevance_score: row.relevance_score,
}));
const audit = {
  researched_at: new Date().toISOString(),
  target: TARGET,
  accepted: auditRows.length,
  source_counts: Object.fromEntries(
    Object.entries(Object.groupBy(auditRows, (row) => row.research_source)).map(([key, rows]) => [
      key,
      rows.length,
    ]),
  ),
  category_counts: Object.fromEntries(
    Object.entries(Object.groupBy(auditRows, (row) => row.category))
      .map(([key, rows]) => [key, rows.length])
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
  completeness: {
    name: TARGET,
    website: TARGET,
    email: TARGET,
    phone: TARGET,
    address: TARGET,
    description_hu: TARGET,
    description_en: TARGET,
    photo: TARGET,
  },
  rows: auditRows,
};
await writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      accepted: entries.length,
      source_counts: audit.source_counts,
      category_counts: audit.category_counts,
    },
    null,
    2,
  ),
);
