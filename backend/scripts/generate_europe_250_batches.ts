#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SupplierCategory, VenueStyle } from "@shared/suppliers";
import { DIRECTORY } from "../src/domain/suppliers_data";

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error(
    "usage: bun backend/scripts/generate_europe_250_batches.ts ENRICHED.json [ENRICHED.json ...]",
  );
  process.exit(2);
}

const TARGET = 250;
const COUNTRIES = {
  CZ: { en: "Czechia", hu: "Csehország", language: "cs" },
  DE: { en: "Germany", hu: "Németország", language: "de" },
  FR: { en: "France", hu: "Franciaország", language: "fr" },
  IT: { en: "Italy", hu: "Olaszország", language: "it" },
} as const;
type Country = keyof typeof COUNTRIES;

interface Candidate {
  accepted?: boolean;
  osm_type: string;
  osm_id: number | string;
  source_url: string;
  country: string;
  name: string;
  category: SupplierCategory;
  city: string | null;
  address: string | null;
  website: string;
  contact_email: string | null;
  contact_phone: string | null;
  gallery_urls?: string[];
  description?: string | null;
  pages_checked?: string[];
  wedding_evidence?: { page: string; term: string } | null;
  lat: number | null;
  lng: number | null;
  missing?: string[];
}

const CATEGORY_COPY: Record<SupplierCategory, { en: string; hu: string }> = {
  wedding_planner: { en: "wedding planner", hu: "esküvőszervező" },
  venue: { en: "wedding and event venue", hu: "esküvő- és rendezvényhelyszín" },
  accommodation: { en: "wedding accommodation provider", hu: "esküvői szálláshely" },
  tent_pavilion: { en: "tent and pavilion provider", hu: "sátor- és pavilonszolgáltató" },
  catering: { en: "wedding caterer", hu: "esküvői cateringszolgáltató" },
  cake_dessert: { en: "wedding cake and dessert provider", hu: "esküvőitorta-szolgáltató" },
  bar_drinks: { en: "wedding bar and drinks provider", hu: "esküvői bárszolgáltató" },
  food_trucks: { en: "wedding food-truck provider", hu: "esküvői food-truck szolgáltató" },
  wedding_decor: { en: "wedding decor provider", hu: "esküvődekorációs szolgáltató" },
  florist: { en: "wedding florist", hu: "esküvői virágkötő" },
  lighting: { en: "event-lighting provider", hu: "rendezvényvilágítási szolgáltató" },
  rental_equipment: { en: "event-equipment provider", hu: "rendezvényeszköz-szolgáltató" },
  photography: { en: "wedding photographer", hu: "esküvői fotós" },
  videography: { en: "wedding videographer", hu: "esküvői videós" },
  content_creator: { en: "wedding content creator", hu: "esküvői tartalomkészítő" },
  photo_booth: { en: "wedding photo-booth provider", hu: "esküvői fotóautomata-szolgáltató" },
  dj: { en: "wedding DJ", hu: "esküvői DJ" },
  live_music: { en: "wedding live-music provider", hu: "esküvői zeneszolgáltató" },
  entertainment: { en: "wedding entertainer", hu: "esküvői szórakoztató" },
  mc_celebrant: { en: "wedding MC", hu: "esküvői ceremóniamester" },
  celebrant: { en: "wedding celebrant", hu: "esküvői szertartásvezető" },
  dance_lessons: { en: "wedding dance instructor", hu: "esküvői táncoktató" },
  sound_tech: { en: "event sound provider", hu: "rendezvényhangosítási szolgáltató" },
  bridal_boutique: { en: "bridal boutique", hu: "menyasszonyiruha-szalon" },
  suit_formal: { en: "formalwear provider", hu: "alkalmiöltözet-szolgáltató" },
  hair_makeup: {
    en: "bridal hair and beauty provider",
    hu: "menyasszonyi haj- és szépségszolgáltató",
  },
  nails: { en: "bridal nail provider", hu: "menyasszonyi körömszolgáltató" },
  wedding_jewelry: { en: "wedding jeweller", hu: "esküvőiékszer-szolgáltató" },
  invitation_graphics: { en: "wedding stationery provider", hu: "esküvőimeghívó-szolgáltató" },
  transport: { en: "wedding transport provider", hu: "esküvői személyszállító" },
  other: { en: "wedding service provider", hu: "esküvői szolgáltató" },
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function validEmail(value: unknown): boolean {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(clean(value));
}

function validPhone(value: unknown): boolean {
  const phone = clean(value);
  if (/^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d{2,4})?\s*$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);
}

function websiteKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return clean(value).toLowerCase();
  }
}

function usableImageUrl(value: string): boolean {
  return (
    /^https?:\/\/\w/i.test(value) &&
    !/\.svg(?:[?#]|$)|logo|loghi?_|favicon|icon|sprite|placeholder|avatar|badge|payment|loader|preload|trustmark|schriftzug|\/close\./i.test(
      value,
    )
  );
}

function score(row: Candidate): number {
  return (
    (row.contact_email ? 6 : 0) +
    (row.contact_phone ? 6 : 0) +
    (row.address ? 4 : 0) +
    (row.city ? 3 : 0) +
    (row.lat != null && row.lng != null ? 3 : 0) +
    Math.min(row.gallery_urls?.filter(usableImageUrl).length ?? 0, 6) +
    (row.description ? 2 : 0) +
    (row.pages_checked?.length ?? 0)
  );
}

function venueStyle(name: string): VenueStyle {
  const value = name.toLowerCase();
  if (/castle|château|chateau|schloss|hrad|zámek|zamek|castello/.test(value)) return "castle";
  if (/manor|mansion|gutshof|villa|tenuta|domaine/.test(value)) return "manor";
  if (/hotel|gasthof|auberge|albergo/.test(value)) return "hotel";
  if (/resort|spa\b/.test(value)) return "resort";
  if (/restaurant|ristorante|brasserie|bistro/.test(value)) return "restaurant";
  if (/lake|lago|see\b|plage|beach|marina/.test(value)) return "waterfront";
  if (/estate|farm|barn|hof\b|maso|agriturismo/.test(value)) return "estate";
  return "event_hall";
}

const parsed = (
  await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(path, "utf8"))))
).flat() as Candidate[];
const baselineDirectory = DIRECTORY.filter((row) => !row.id.startsWith("eu26-"));
const existingWebsites = new Set(baselineDirectory.map((row) => websiteKey(row.website)));
const selectedWebsites = new Set<string>();
const report: Record<string, unknown> = {
  researched_at: new Date().toISOString(),
  target_per_country: TARGET,
  discovery_source: "OpenStreetMap extracts supplied by Geofabrik",
  verification_source: "each selected vendor's official website",
  license: "OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0",
  countries: {},
};

const legacyEnrichments = Object.fromEntries(
  parsed
    .filter(
      (row) =>
        row.osm_type === "curated" &&
        typeof row.osm_id === "string" &&
        row.gallery_urls?.some(usableImageUrl),
    )
    .map((row) => [
      row.osm_id,
      {
        website: row.website,
        contact_email: clean(row.contact_email).toLowerCase() || null,
        contact_phone: clean(row.contact_phone).replace(/^00/, "+") || null,
        gallery_urls: (row.gallery_urls ?? []).filter(usableImageUrl).slice(0, 6),
      },
    ]),
);
const legacyOutputPath = join(
  import.meta.dir,
  "../src/domain/suppliers_data_europe_legacy_enrichments_2026_08.ts",
);
const generatedPaths = [legacyOutputPath];
await writeFile(
  legacyOutputPath,
  `// First-party contact and image refresh for pre-scale French and Italian listings.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const EUROPE_LEGACY_ENRICHMENTS_2026_08: Record<string, Partial<RawDirectoryEntry>> = ${JSON.stringify(legacyEnrichments, null, 2)};\n`,
);
report.legacy_enrichments = {
  refreshed: Object.keys(legacyEnrichments).length,
  ids: Object.keys(legacyEnrichments),
};

for (const country of Object.keys(COUNTRIES) as Country[]) {
  const existing = baselineDirectory.filter((row) => row.country === country).length;
  const needed = Math.max(0, TARGET - existing);
  const countryRows = parsed
    .filter((row) => row.country === country && row.accepted)
    .filter((row) => row.gallery_urls?.some(usableImageUrl))
    .filter((row) => validEmail(row.contact_email) && validPhone(row.contact_phone))
    .filter((row) => !existingWebsites.has(websiteKey(row.website)))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const selected: Candidate[] = [];
  for (const row of countryRows) {
    const key = websiteKey(row.website);
    if (selectedWebsites.has(key)) continue;
    selectedWebsites.add(key);
    selected.push(row);
    if (selected.length >= needed) break;
  }
  if (selected.length < needed) {
    throw new Error(
      `${country}: only ${selected.length} accepted new rows for ${needed} missing slots`,
    );
  }

  const metadata = COUNTRIES[country];
  const entries = selected.map((row) => {
    const rawCity = clean(row.city);
    const city = rawCity.endsWith(`, ${country}`) ? rawCity : `${rawCity}, ${country}`;
    const place = rawCity.replace(/, [A-Z]{2}$/, "") || metadata.en;
    const kind = CATEGORY_COPY[row.category] ?? CATEGORY_COPY.other;
    const contacts = [row.contact_email && "email", row.contact_phone && "phone"].filter(Boolean);
    const contactEn =
      contacts.length === 2
        ? "direct email and phone contacts"
        : contacts[0] === "email"
          ? "a direct email contact"
          : "a direct phone contact";
    const contactHu =
      contacts.length === 2
        ? "közvetlen e-mailes és telefonos elérhetőséget"
        : contacts[0] === "email"
          ? "közvetlen e-mailes elérhetőséget"
          : "közvetlen telefonos elérhetőséget";
    return {
      id: `eu26-${country.toLowerCase()}-${slug(row.name)}-${row.osm_id}`,
      name: clean(row.name),
      category: row.category,
      city,
      address: clean(row.address) || null,
      capacity_min: null,
      capacity_max: null,
      blurb_hu: `${clean(row.name)} ${kind.hu} ${place} térségében, ${metadata.hu} területén. A hivatalos weboldal esküvői szolgáltatást mutat be, és ${contactHu}, helyadatokat, valamint ellenőrzött saját képeket tesz közzé. Az aktuális csomagokat, árakat és elérhetőséget közvetlenül a szolgáltatóval érdemes egyeztetni.`,
      blurb_en: `${clean(row.name)} is a ${kind.en} serving ${place}, ${metadata.en}. Its official website contains wedding-specific information and publishes ${contactEn}, location details, and verified first-party imagery. Confirm current packages, pricing, and availability directly with the provider.`,
      website: row.website,
      gallery_urls: (row.gallery_urls ?? []).filter(usableImageUrl).slice(0, 6),
      contact_email: clean(row.contact_email).toLowerCase() || null,
      contact_phone: clean(row.contact_phone).replace(/^00/, "+") || null,
      lat: row.lat,
      lng: row.lng,
      spoken_languages: [metadata.language, "en"],
      source: "curated" as const,
      price_band: null,
      ...(row.category === "venue" ? { venue_style: venueStyle(row.name) } : {}),
    };
  });

  const outputPath = join(
    import.meta.dir,
    `../src/domain/suppliers_data_${country.toLowerCase()}_2026_08.ts`,
  );
  const exportName = `${country}_OPEN_WEB_2026_08`;
  generatedPaths.push(outputPath);
  await writeFile(
    outputPath,
    `// Open-web wedding-vendor expansion, researched August 2026.\n// OSM supplies discovery/location; every accepted row was verified on its official website.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const ${exportName}: RawDirectoryEntry[] = ${JSON.stringify(entries, null, 2)};\n`,
  );
  (report.countries as Record<string, unknown>)[country] = {
    existing,
    added: entries.length,
    total: existing + entries.length,
    available_accepted_candidates: countryRows.length,
    completeness: {
      email: entries.filter((row) => row.contact_email).length,
      phone: entries.filter((row) => row.contact_phone).length,
      full_address: entries.filter((row) => row.address).length,
      coordinates: entries.filter((row) => row.lat != null && row.lng != null).length,
      pictures: entries.filter((row) => row.gallery_urls.length).length,
      total_pictures: entries.reduce((sum, row) => sum + row.gallery_urls.length, 0),
    },
    provenance: selected.map((row) => ({
      id: `eu26-${country.toLowerCase()}-${slug(row.name)}-${row.osm_id}`,
      name: row.name,
      category: row.category,
      osm_source_url: row.source_url,
      official_website: row.website,
      pages_checked: row.pages_checked,
      wedding_evidence: row.wedding_evidence,
      image_urls: row.gallery_urls,
      score: score(row),
    })),
  };
}

const formatted = Bun.spawnSync({
  cmd: ["bunx", "biome", "format", "--write", ...generatedPaths],
  cwd: join(import.meta.dir, "../.."),
  stdout: "inherit",
  stderr: "inherit",
});
if (formatted.exitCode !== 0) {
  throw new Error(`Biome could not format generated batches (exit ${formatted.exitCode})`);
}

await writeFile(
  join(import.meta.dir, "../../docs/europe-vendor-research-2026-08-26.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(report.countries as Record<string, { added: number; total: number }>).map(
        ([country, value]) => [country, { added: value.added, total: value.total }],
      ),
    ),
  ),
);
