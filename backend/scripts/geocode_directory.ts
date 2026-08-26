// Fills per-entry map coordinates for the curated directory from each entry's
// own street address, and writes them into the GEOCODED_COORDS block of
// `domain/suppliers_data.ts`.
//
//   bun backend/scripts/geocode_directory.ts            # full run, writes the file
//   bun backend/scripts/geocode_directory.ts --dry      # report only
//   bun backend/scripts/geocode_directory.ts --limit 20 # first N candidates
//   bun backend/scripts/geocode_directory.ts --refresh  # re-query ids already generated
//
// Why it exists: the directory map only ever drew entries that VENUE_COORDS (a
// hand-kept table) covered, plus a town-centre fallback for the rest. That left
// ~175 entries with no coordinate at all (invisible on the map) and stacked
// every fallback entry of a town on one identical point: ~200 of them on the
// Budapest centroid alone, where a single marker hid all but one.
//
// Two candidate groups, both requiring a street address on the entry:
//   • no coordinate at all             → geocode so it appears on the map
//   • town-centroid coord, shared with → geocode so it stops sharing a pin
//     at least one other entry
// A hand-pinned VENUE_COORDS entry is NEVER touched: those were placed on
// purpose and win over anything generated here.
//
// Every hit is verified before it is kept (right country, plausibly near the
// town we expect). A rejected or missing hit simply keeps the old behaviour for
// that entry, so a bad geocode never silently moves a real business onto the
// wrong spot.
//
// Upstream is Photon (photon.komoot.io), the same public OSM geocoder the
// address autocomplete uses. No API key; the run is throttled to stay inside
// its fair-use limits, so a full pass takes several minutes.

import { readFileSync, writeFileSync } from "node:fs";
import { COUNTRIES } from "@shared/country_list";
import { CITY_COORDS, DIRECTORY, VENUE_COORDS } from "../src/domain/suppliers_data";
import { suggestAddresses } from "../src/lib/address_suggest";

const SOURCE_PATH = new URL("../src/domain/suppliers_data.ts", import.meta.url).pathname;
const BEGIN = "GEOCODED-COORDS-BEGIN */";
const END = "/* GEOCODED-COORDS-END";

/** Photon asks for fair use; one request per second with a little headroom. */
const THROTTLE_MS = 1_100;
/** A hit further than this from the town we expect is a same-named street
 *  somewhere else, not our venue. Generous because "city" on a curated entry is
 *  sometimes the nearest town rather than the exact settlement. */
const MAX_KM_FROM_TOWN = 40;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const refresh = args.includes("--refresh");
const townFallback = args.includes("--town-fallback");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number.parseInt(args[limitArg + 1] ?? "", 10) : Number.NaN;
const prefixArg = args.indexOf("--prefix");
const prefixes =
  prefixArg >= 0
    ? (args[prefixArg + 1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

const COUNTRY_NAME = new Map(COUNTRIES.map((c) => [c.code, c.en]));

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Curated cities carry a ", XX" country suffix outside Hungary; the geocoder
 *  wants the bare town name plus a spelled-out country. */
function bareCity(city: string): string {
  return city.replace(/,\s*[A-Z]{2}$/, "").trim();
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ── Candidate selection ────────────────────────────────────────────────────

const pointCounts = new Map<string, number>();
for (const s of DIRECTORY) {
  if (s.lat == null || s.lng == null) continue;
  const key = `${s.lat},${s.lng}`;
  pointCounts.set(key, (pointCounts.get(key) ?? 0) + 1);
}

const existing = readGenerated();

interface Candidate {
  id: string;
  name: string;
  city: string;
  address: string;
  country: string;
  /** "missing" = no coordinate, has an address to resolve; "stacked" = sharing
   *  a town-centre pin with others; "town" = no coordinate AND no address, so
   *  the town centre is the best we can honestly do. */
  reason: "missing" | "stacked" | "town";
}

/** True when the entry's `city` is the country itself rather than a town, e.g.
 *  "Croatia, HR" on a vendor who publishes no base town. The 40 km check below
 *  passes happily against a country centroid, so without this a nationwide
 *  business lands on a pin in the middle of a field and the map states a
 *  location the business never claimed. No pin beats a wrong one. */
function cityIsWholeCountry(city: string, code: string): boolean {
  const town = normalize(bareCity(city));
  return town === normalize(COUNTRY_NAME.get(code) ?? "") || town === normalize(code);
}

const candidates: Candidate[] = [];
for (const s of DIRECTORY) {
  if (!s.city) continue;
  if (VENUE_COORDS[s.id]) continue; // hand-pinned, leave alone
  if (!refresh && existing.has(s.id)) continue;
  if (!s.address && cityIsWholeCountry(s.city, s.country)) continue;
  const placed = s.lat != null && s.lng != null;
  const stacked = placed && (pointCounts.get(`${s.lat},${s.lng}`) ?? 0) > 1;
  // No address to work from: the town itself is the best honest answer, and
  // still beats being absent from the map. Only worth asking when the entry
  // has no coordinate at all: a town-level entry that already resolved
  // through CITY_COORDS would just get the same answer back.
  if (!placed) candidates.push({ ...pick(s), reason: s.address ? "missing" : "town" });
  else if (stacked && s.address) candidates.push({ ...pick(s), reason: "stacked" });
}

function pick(s: (typeof DIRECTORY)[number]) {
  return {
    id: s.id,
    name: s.name,
    city: s.city,
    address: s.address ?? "",
    country: s.country,
  };
}

const scopedCandidates =
  prefixes.length > 0
    ? candidates.filter((candidate) => prefixes.some((prefix) => candidate.id.startsWith(prefix)))
    : candidates;
const queue = Number.isFinite(limit) ? scopedCandidates.slice(0, limit) : scopedCandidates;
console.log(
  `[geocode] ${scopedCandidates.length} candidates (${scopedCandidates.filter((c) => c.reason === "missing").length} unplaced with an address, ${
    scopedCandidates.filter((c) => c.reason === "town").length
  } unplaced town-only, ${
    scopedCandidates.filter((c) => c.reason === "stacked").length
  } sharing a town-centre pin), running ${queue.length}${prefixes.length > 0 ? ` for ${prefixes.join(",")}` : ""}${dryRun ? " (dry run)" : ""}`,
);

// ── Run ────────────────────────────────────────────────────────────────────

const resolved = new Map<string, { lat: number; lng: number }>(existing);
const rejected: string[] = [];
const noHit: string[] = [];

for (const [i, c] of queue.entries()) {
  const country = COUNTRY_NAME.get(c.country) ?? c.country;
  const town = bareCity(c.city);
  const query = [c.reason === "town" ? null : c.address, town, country].filter(Boolean).join(", ");
  const hits = await suggestAddresses(query, "en");
  if (i % 25 === 0) console.log(`[geocode] ${i}/${queue.length}…`);
  await Bun.sleep(THROTTLE_MS);

  if (hits === null) {
    console.warn(`[geocode] upstream failure on ${c.id}, skipping`);
    noHit.push(c.id);
    continue;
  }
  const anchor = CITY_COORDS[c.city] ?? null;
  let hit = hits.find((h) => {
    if (h.lat == null || h.lng == null) return false;
    if (h.country && h.country !== c.country) return false;
    if (anchor) return haversineKm(anchor.lat, anchor.lng, h.lat, h.lng) <= MAX_KM_FROM_TOWN;
    // No town anchor to compare against: demand the geocoder agree on the town.
    // A postcode-level hit carries no `city`, so the label is the fallback
    // check: it always spells the settlement out.
    const where = normalize(h.city ?? h.label);
    return where.includes(normalize(town));
  });
  if ((!hit || hit.lat == null || hit.lng == null) && townFallback) {
    const townHits = await suggestAddresses(`${town}, ${country}`, "en");
    await Bun.sleep(THROTTLE_MS);
    hit = townHits?.find(
      (candidate) =>
        candidate.lat != null &&
        candidate.lng != null &&
        (!candidate.country || candidate.country === c.country),
    );
  }
  if (!hit || hit.lat == null || hit.lng == null) {
    (hits.length === 0 ? noHit : rejected).push(`${c.id} (${c.city}) ← ${query}`);
    continue;
  }
  resolved.set(c.id, { lat: round6(hit.lat), lng: round6(hit.lng) });
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const added = resolved.size - existing.size;
console.log(
  `[geocode] placed ${added} new entr${added === 1 ? "y" : "ies"} (${resolved.size} generated total), ${rejected.length} rejected as implausible, ${noHit.length} with no usable hit`,
);
if (rejected.length > 0) console.log(`[geocode] rejected:\n  ${rejected.join("\n  ")}`);
if (noHit.length > 0) console.log(`[geocode] no hit:\n  ${noHit.join("\n  ")}`);

if (dryRun) {
  console.log("[geocode] --dry, source file left untouched");
  process.exit(0);
}
writeGenerated(resolved);
console.log(`[geocode] wrote ${resolved.size} entries into suppliers_data.ts`);

// ── Generated-block IO ─────────────────────────────────────────────────────

function readGenerated(): Map<string, { lat: number; lng: number }> {
  const src = readFileSync(SOURCE_PATH, "utf8");
  const body = between(src);
  const out = new Map<string, { lat: number; lng: number }>();
  for (const m of body.matchAll(
    /"?([\w-]+)"?:\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+),?\s*\}/g,
  )) {
    const [, id, lat, lng] = m;
    if (id && lat && lng) out.set(id, { lat: Number(lat), lng: Number(lng) });
  }
  return out;
}

function between(src: string): string {
  const start = src.indexOf(BEGIN);
  const end = src.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("GEOCODED-COORDS markers not found in suppliers_data.ts");
  }
  return src.slice(start + BEGIN.length, end);
}

function writeGenerated(coords: Map<string, { lat: number; lng: number }>): void {
  const src = readFileSync(SOURCE_PATH, "utf8");
  const start = src.indexOf(BEGIN) + BEGIN.length;
  const end = src.indexOf(END);
  const lines = [...coords.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, c]) =>
        `  ${/^[A-Za-z_$][\w$]*$/.test(id) ? id : `"${id}"`}: ${`{ lat: ${c.lat}, lng: ${c.lng} }`},`,
    );
  const block = `\nconst GEOCODED_COORDS: Record<string, { lat: number; lng: number }> = {\n${lines.join("\n")}\n};\n`;
  writeFileSync(SOURCE_PATH, src.slice(0, start) + block + src.slice(end), "utf8");
}
