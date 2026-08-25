#!/usr/bin/env node

// Discover wedding-adjacent businesses in European countries where GA4 shows
// demand but the Weddly directory has no suppliers yet. OpenStreetMap is only
// the discovery/address source; a follow-up first-party website crawl must
// verify contact details and imagery before any row is imported.

import { readFile, writeFile } from "node:fs/promises";

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("usage: discover_ga4_europe_vendors.mjs OUTPUT.json");
  process.exit(2);
}
const countryArg = process.argv.find((value) => value.startsWith("--countries="));
const requestedCountries = new Set(
  (countryArg?.slice("--countries=".length) ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);

const COUNTRIES = [
  { code: "IE", name: "Ireland", users: 120 },
  { code: "NL", name: "Netherlands", users: 105 },
  { code: "GB", name: "United Kingdom", users: 58 },
  { code: "DE", name: "Germany", users: 43 },
  { code: "SE", name: "Sweden", users: 21 },
  { code: "CH", name: "Switzerland", users: 6 },
  { code: "BE", name: "Belgium", users: 5 },
  { code: "CZ", name: "Czechia", users: 4 },
  { code: "BG", name: "Bulgaria", users: 2 },
  { code: "CY", name: "Cyprus", users: 2 },
  { code: "DK", name: "Denmark", users: 2 },
  { code: "NO", name: "Norway", users: 2 },
  { code: "LI", name: "Liechtenstein", users: 1 },
  { code: "LT", name: "Lithuania", users: 1 },
  { code: "MT", name: "Malta", users: 1 },
  { code: "UA", name: "Ukraine", users: 1 },
];

const CATEGORY_RULES = [
  ["amenity", "events_venue", "venue"],
  ["amenity", "conference_centre", "venue"],
];

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

function queryFor(countryCode) {
  const branches = [];
  for (const [key, value] of CATEGORY_RULES) {
    branches.push(`nwr["name"]["${key}"="${value}"](area.country);`);
  }
  return `[out:json][timeout:150];area["ISO3166-1"="${countryCode}"]->.country;(${branches.join("")});out center tags;`;
}

async function overpass(query) {
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const url = `${endpoint}?${new URLSearchParams({ data: query })}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "WeddlyResearchBot/1.0 (+https://www.tryweddly.com)",
        },
      });
      if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`);
      return { endpoint, payload: await response.json() };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("all Overpass endpoints failed");
}

function first(tags, ...keys) {
  for (const key of keys) {
    const value = tags[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function categoryFor(tags) {
  for (const [key, value, category] of CATEGORY_RULES) {
    if (tags[key] === value) return category;
  }
  return null;
}

function websiteFor(tags) {
  const raw = first(tags, "contact:website", "website");
  if (!raw) return null;
  const candidate = raw.split(/[;,\s]+/).find(Boolean);
  if (!candidate) return null;
  try {
    return new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`).href;
  } catch {
    return null;
  }
}

function addressFor(tags, countryName) {
  const full = first(tags, "addr:full");
  if (full) return full.includes(countryName) ? full : `${full}, ${countryName}`;
  const street = first(tags, "addr:street", "addr:place");
  const number = first(tags, "addr:housenumber");
  const locality = first(tags, "addr:city", "addr:town", "addr:village", "addr:suburb");
  const postcode = first(tags, "addr:postcode");
  if (!street || !locality) return null;
  return `${street}${number ? ` ${number}` : ""}, ${[postcode, locality].filter(Boolean).join(" ")}, ${countryName}`;
}

function coordinates(element) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: null, lng: null };
}

let existing = null;
try {
  existing = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  // A first run has no previous checkpoint to merge.
}
const selectedCountries = COUNTRIES.filter(
  (country) => requestedCountries.size === 0 || requestedCountries.has(country.code),
);
const selectedCodes = new Set(selectedCountries.map((country) => country.code));
const rows = (existing?.candidates ?? []).filter((row) => !selectedCodes.has(row.country));
const countryReports = (existing?.countries ?? []).filter(
  (country) => !selectedCodes.has(country.code),
);
const seen = new Set();
for (const row of rows) {
  seen.add(`${row.name.toLowerCase()}|${new URL(row.website).hostname.replace(/^www\./, "")}`);
}

async function save() {
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        researched_at: new Date().toISOString(),
        ga4_period: { start: "2025-01-01", end: "2026-08-19", metric: "activeUsers" },
        countries: countryReports,
        candidates: rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

for (const country of selectedCountries) {
  let response;
  try {
    response = await overpass(queryFor(country.code));
  } catch (error) {
    countryReports.push({ ...country, error: String(error) });
    await save();
    console.error(JSON.stringify(countryReports.at(-1)));
    continue;
  }
  const { endpoint, payload } = response;
  let withAddress = 0;
  for (const element of payload.elements ?? []) {
    const tags = element.tags ?? {};
    const website = websiteFor(tags);
    const address = addressFor(tags, country.name);
    const category = categoryFor(tags);
    const name = first(tags, "name");
    if (!name || !website || !address || !category) continue;
    withAddress += 1;
    const dedupe = `${name.toLowerCase()}|${new URL(website).hostname.replace(/^www\./, "")}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const coords = coordinates(element);
    rows.push({
      osm_type: element.type,
      osm_id: element.id,
      name,
      category,
      city: `${first(tags, "addr:city", "addr:town", "addr:village", "addr:suburb")}, ${country.code}`,
      address,
      website,
      contact_email: first(tags, "contact:email", "email"),
      contact_phone: first(tags, "contact:phone", "phone", "mobile"),
      image_hint: first(tags, "image", "wikimedia_commons"),
      source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      country: country.code,
      ga4_active_users: country.users,
      lat: coords.lat,
      lng: coords.lng,
    });
  }
  countryReports.push({
    ...country,
    osm_results: payload.elements?.length ?? 0,
    candidates_with_full_address: withAddress,
    overpass_endpoint: endpoint,
  });
  console.log(JSON.stringify(countryReports.at(-1)));
  await save();
}

await save();
console.log(JSON.stringify({ output: outputPath, candidates: rows.length }));
