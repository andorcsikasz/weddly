#!/usr/bin/env node

// Turn the GA4-prioritised, first-party-enriched research report into a typed
// curated-directory batch. Only contact-complete rows with a production-grade
// verified hero image are emitted. The companion report retains provenance.

import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputTs, outputReport] = process.argv.slice(2);
if (!inputPath || !outputTs || !outputReport) {
  throw new Error("usage: build_ga4_europe_vendor_batch.mjs INPUT.json OUTPUT.ts REPORT.json");
}

const COUNTRY_NAMES = {
  IE: { hu: "Írországban", en: "Ireland", languages: ["en"] },
  NL: { hu: "Hollandiában", en: "the Netherlands", languages: ["nl", "en"] },
  GB: { hu: "az Egyesült Királyságban", en: "the United Kingdom", languages: ["en"] },
  DE: { hu: "Németországban", en: "Germany", languages: ["de", "en"] },
  SE: { hu: "Svédországban", en: "Sweden", languages: ["sv", "en"] },
  CH: { hu: "Svájcban", en: "Switzerland", languages: ["de", "fr", "it", "en"] },
  BE: { hu: "Belgiumban", en: "Belgium", languages: ["nl", "fr", "en"] },
  CZ: { hu: "Csehországban", en: "Czechia", languages: ["cs", "en"] },
  BG: { hu: "Bulgáriában", en: "Bulgaria", languages: ["bg", "en"] },
  CY: { hu: "Cipruson", en: "Cyprus", languages: ["el", "en"] },
  DK: { hu: "Dániában", en: "Denmark", languages: ["da", "en"] },
  NO: { hu: "Norvégiában", en: "Norway", languages: ["no", "en"] },
  LI: { hu: "Liechtensteinben", en: "Liechtenstein", languages: ["de", "en"] },
  LT: { hu: "Litvániában", en: "Lithuania", languages: ["lt", "en"] },
  MT: { hu: "Máltán", en: "Malta", languages: ["mt", "en"] },
  UA: { hu: "Ukrajnában", en: "Ukraine", languages: ["uk", "en"] },
};

function slug(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 62);
}

function normalizedWebsite(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
}

function validEmail(value) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value ?? "");
}

function validPhone(value) {
  if (!value || /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+\d{2,4})?\s*$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function styleFor(name) {
  const value = name.toLowerCase();
  if (/castle|château|chateau|kasteel|schloss|palace|palais|hrad|zámek|zamek/.test(value))
    return "castle";
  if (/manor|mansion|landgoed|gutshof|herrgård|herrgard/.test(value)) return "manor";
  if (/hotel|hostel|inn\b|gästehaus|gasthof/.test(value)) return "hotel";
  if (/resort|spa\b/.test(value)) return "resort";
  if (/restaurant|brasserie|bistro|café|cafe\b/.test(value)) return "restaurant";
  if (/park|garden|botanic|botanisk|natur/.test(value)) return "nature_park";
  if (/harbour|harbor|marina|beach|lake|strand|waterfront/.test(value)) return "waterfront";
  if (/estate|farm|barn|hof\b|domaine/.test(value)) return "estate";
  return "event_hall";
}

const rows = JSON.parse(await readFile(inputPath, "utf8"));
const seenWebsites = new Set();
const seenIds = new Set();
const accepted = [];
const rejected = [];

for (const row of rows) {
  const reasons = [];
  if (!row.accepted) reasons.push("website_enrichment_failed");
  if (!row.photo_quality_verified) reasons.push("photo_quality_failed");
  if (!COUNTRY_NAMES[row.country]) reasons.push("non_target_country");
  if (!row.address || !row.city) reasons.push("address_missing");
  if (!validEmail(row.contact_email)) reasons.push("email_invalid");
  if (!validPhone(row.contact_phone)) reasons.push("phone_invalid");
  if (!row.website) reasons.push("website_missing");
  const websiteKey = row.website ? normalizedWebsite(row.website) : "";
  if (websiteKey && seenWebsites.has(websiteKey)) reasons.push("duplicate_website");
  if (reasons.length) {
    rejected.push({ name: row.name, country: row.country, source_url: row.source_url, reasons });
    continue;
  }
  seenWebsites.add(websiteKey);
  const country = COUNTRY_NAMES[row.country];
  let id = `ga4eu26-${row.country.toLowerCase()}-${slug(row.name)}-${row.osm_id}`;
  while (seenIds.has(id)) id += "x";
  seenIds.add(id);
  accepted.push({
    id,
    name: row.name,
    category: "venue",
    city: row.city,
    address: row.address,
    capacity_min: null,
    capacity_max: null,
    blurb_hu: `${row.name} rendezvény- és esküvőhelyszín ${row.city.replace(/, [A-Z]{2}$/, "")} településen, ${country.hu}. A helyszín teljes címet, közvetlen e-mailes és telefonos elérhetőséget, valamint saját weboldalt és fotókat tesz közzé.`,
    blurb_en: `${row.name} is an event and wedding venue in ${row.city.replace(/, [A-Z]{2}$/, "")}, ${country.en}. The venue publishes its full address, direct email and phone contacts, official website, and its own photography.`,
    website: row.website,
    gallery_urls: row.gallery_urls.slice(0, 6),
    contact_email: row.contact_email.toLowerCase(),
    contact_phone: row.contact_phone.replace(/^00/, "+").replace(/\s+/g, " ").trim(),
    lat: row.lat,
    lng: row.lng,
    spoken_languages: country.languages,
    source: "curated",
    price_band: null,
    venue_style: styleFor(row.name),
  });
}

const source = `// GA4-prioritised European venue expansion, researched August 2026.\n// Every row has a full address, first-party contact details and quality-verified images.\n\nimport type { RawDirectoryEntry } from "./suppliers_data";\n\nexport const GA4_EUROPE_2026_08: RawDirectoryEntry[] = ${JSON.stringify(accepted, null, 2)};\n`;
await writeFile(outputTs, source, "utf8");

const byCountry = Object.fromEntries(
  Object.entries(Object.groupBy(accepted, (row) => row.city.slice(-2))).map(([code, values]) => [
    code,
    values.length,
  ]),
);
await writeFile(
  outputReport,
  `${JSON.stringify(
    {
      researched_at: new Date().toISOString(),
      ga4_period: { start: "2025-01-01", end: "2026-08-19", metric: "activeUsers" },
      discovery_source: "OpenStreetMap / Overpass API",
      contact_and_image_source: "each vendor's official website",
      imported: accepted.length,
      by_country: byCountry,
      rejected_count: rejected.length,
      rejected,
      provenance: rows
        .filter((row) => accepted.some((entry) => entry.id.endsWith(`-${row.osm_id}`)))
        .map((row) => ({
          name: row.name,
          country: row.country,
          osm_source_url: row.source_url,
          website: row.website,
          pages_checked: row.pages_checked,
          image_urls: row.gallery_urls,
          image_dimensions: { width: row.photo_width, height: row.photo_height },
        })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(
  JSON.stringify({ imported: accepted.length, by_country: byCountry, rejected: rejected.length }),
);
