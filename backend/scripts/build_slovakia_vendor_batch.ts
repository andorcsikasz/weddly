// Convert the audited Slovak open-web research report into directory source.
// The report is produced by research_at_sk_directory.ts and already requires
// complete contact details plus three remotely fetchable profile images.

import { DIRECTORY } from "../src/domain/suppliers_data";

interface ResearchCandidate {
  source_profile: string;
  country: "SK";
  name: string;
  category: string;
  street: string;
  postal_code: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  gallery_urls: string[];
}

interface ResearchReport {
  candidates: ResearchCandidate[];
}

const INPUT = new URL("../../docs/vendor-research-at-sk-2000.json", import.meta.url);
const OUTPUT = new URL("../src/domain/suppliers_data_sk_open_web.ts", import.meta.url);
const OUTPUT_REPORT = new URL("../../docs/slovakia-vendor-import-2026-08-19.json", import.meta.url);

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

function quote(value: string): string {
  return JSON.stringify(value);
}

const existingNames = new Set(DIRECTORY.map((entry) => key(entry.name)));
const existingWebsites = new Set(DIRECTORY.map((entry) => websiteKey(entry.website)));
const report = (await Bun.file(INPUT).json()) as ResearchReport;
const accepted: ResearchCandidate[] = [];
const rejected: Array<{ source_profile: string; reason: string }> = [];
const seenNames = new Set<string>();
const seenWebsites = new Set<string>();

for (const candidate of report.candidates) {
  const name = key(candidate.name);
  const website = websiteKey(candidate.website);
  if (
    existingNames.has(name) ||
    existingWebsites.has(website) ||
    seenNames.has(name) ||
    seenWebsites.has(website)
  ) {
    rejected.push({ source_profile: candidate.source_profile, reason: "duplicate" });
    continue;
  }
  if (
    !candidate.name ||
    !candidate.street ||
    !candidate.postal_code ||
    !candidate.city ||
    !candidate.phone ||
    !candidate.email ||
    !candidate.website ||
    candidate.gallery_urls.length < 3
  ) {
    rejected.push({ source_profile: candidate.source_profile, reason: "incomplete" });
    continue;
  }
  seenNames.add(name);
  seenWebsites.add(website);
  accepted.push(candidate);
}

const entries = accepted.map((candidate, index) => {
  const slug = key(
    new URL(candidate.source_profile).pathname.split("/").filter(Boolean).at(-1) ?? candidate.name,
  );
  const id = `sk26-${slug || key(candidate.name)}-${String(index + 1).padStart(3, "0")}`;
  const blurbHu = `${candidate.name} esküvői szolgáltató ${candidate.city} településen. A vállalkozás teljes címet, közvetlen telefonos és e-mailes elérhetőséget, valamint online portfóliót tesz közzé.`;
  const blurbEn = `${candidate.name} is a wedding vendor based in ${candidate.city}. The business publishes a full address, direct phone and email contacts, and an online portfolio.`;
  return `  {
    id: ${quote(id)},
    name: ${quote(candidate.name)},
    category: ${quote(candidate.category)},
    city: ${quote(`${candidate.city}, SK`)},
    address: ${quote(`${candidate.street}, ${candidate.postal_code}`)},
    capacity_min: null,
    capacity_max: null,
    blurb_hu: ${quote(blurbHu)},
    blurb_en: ${quote(blurbEn)},
    website: ${quote(candidate.website)},
    gallery_urls: ${JSON.stringify(candidate.gallery_urls, null, 6).replace(/^/gm, "    ").trimStart()},
    contact_email: ${quote(candidate.email)},
    contact_phone: ${quote(candidate.phone)},
    lat: null,
    lng: null,
    source: "curated",
    price_band: null,
  },`;
});

await Bun.write(
  OUTPUT,
  `// Generated from audited public Slovak wedding-vendor profiles, August 2026.
// Exact profile and field sources are retained in docs/slovakia-vendor-import-2026-08-19.json.

import type { RawDirectoryEntry } from "./suppliers_data";

export const SLOVAKIA_OPEN_WEB_2026_08: RawDirectoryEntry[] = [
${entries.join("\n")}
];
`,
);

await Bun.write(
  OUTPUT_REPORT,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      records: accepted.map((candidate, index) => ({
        id: `sk26-${key(new URL(candidate.source_profile).pathname.split("/").filter(Boolean).at(-1) ?? candidate.name) || key(candidate.name)}-${String(index + 1).padStart(3, "0")}`,
        ...candidate,
      })),
      rejected,
    },
    null,
    2,
  )}\n`,
);

console.log(`[done] ${accepted.length} unique complete Slovak vendors`);
