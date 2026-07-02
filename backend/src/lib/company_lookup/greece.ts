// Greece: GEMI Open Data API (opendata-api.businessportal.gr), the official
// open-data channel of the General Commercial Registry. License ODC-BY-1.0.
// Free, but key-gated: the GEMI Authority issues a personal API key after a
// free registration at https://opendata.businessportal.gr/register/ so the
// provider only activates when GEMI_API_KEY is set (same "configured?" gate
// as Stripe / SerpApi). Searches by name, GEMI number (arGemi) or tax number
// (AFM, 9 digits).

import type { CompanyLookupResult } from "@shared/company_lookup";
import { lookupJson } from "./client";
import type { CompanyLookupProvider } from "./types";

const BASE_URL = "https://opendata-api.businessportal.gr/api/opendata/v1";
const SOURCE = "GEMI Open Data (businessportal.gr)";
const MAX_RESULTS = 8;

function apiKey(): string | null {
  const k = process.env.GEMI_API_KEY;
  if (!k || k.length === 0) return null;
  return k;
}

export function gemiConfigured(): boolean {
  return apiKey() !== null;
}

/** The swagger models several fields loosely (string, object with name/descr,
 *  or array of those); normalise them all to a plain string or null. */
function asText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asText(item);
      if (s) return s;
    }
    return null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asText(o.name ?? o.descr ?? o.description ?? o.nameEl ?? o.value);
  }
  return null;
}

function activityLine(raw: unknown): string | null {
  if (!Array.isArray(raw)) return asText(raw);
  const parts = raw
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        const code = asText(o.code ?? o.kad ?? o.activityCode);
        const label = asText(o.descr ?? o.description ?? o.name);
        if (code && label) return `${code} ${label}`;
        return code ?? label;
      }
      return null;
    })
    .filter((s): s is string => !!s);
  return parts.length ? parts.slice(0, 3).join("; ") : null;
}

interface GrCompany {
  arGemi?: unknown;
  afm?: unknown;
  coNameEl?: unknown;
  coNamesEn?: unknown;
  city?: unknown;
  street?: unknown;
  streetNumber?: unknown;
  zipCode?: unknown;
  legalType?: unknown;
  status?: unknown;
  isActive?: unknown;
  incorporationDate?: unknown;
  activities?: unknown;
}

function isActiveStatus(c: GrCompany): "active" | "inactive" | "unknown" {
  const flags = [c.isActive, (c.status as Record<string, unknown> | null)?.isActive];
  for (const f of flags) {
    if (f === true) return "active";
    if (f === false) return "inactive";
  }
  return asText(c.status) ? "unknown" : "unknown";
}

function toResult(c: GrCompany): CompanyLookupResult | null {
  const arGemi = asText(c.arGemi);
  if (!arGemi) return null;
  const street = asText(c.street);
  const streetNo = asText(c.streetNumber);
  const city = asText(c.city);
  const zip = asText(c.zipCode);
  const addressParts = [
    street && streetNo ? `${street} ${streetNo}` : street,
    zip && city ? `${zip} ${city}` : city,
  ].filter((s): s is string => !!s);
  const afm = asText(c.afm);
  return {
    id: arGemi,
    country: "GR",
    source_name: SOURCE,
    name: asText(c.coNameEl) ?? asText(c.coNamesEn),
    registry_number: arGemi,
    vat_number: afm ? `EL${afm}` : null,
    legal_form: asText(c.legalType),
    address: addressParts.length ? addressParts.join(", ") : null,
    city,
    postal_code: zip,
    region: null,
    status: isActiveStatus(c),
    activity: activityLine(c.activities),
    registration_date: asText(c.incorporationDate),
  };
}

function extractList(body: unknown): GrCompany[] | null {
  if (Array.isArray(body)) return body as GrCompany[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["companies", "content", "items", "data", "results"]) {
      if (Array.isArray(o[key])) return o[key] as GrCompany[];
    }
  }
  return null;
}

async function search(query: string): Promise<CompanyLookupResult[] | null> {
  const key = apiKey();
  if (!key) return null;
  const q = query.trim();
  if (q.length < 3) return [];
  const u = new URL(`${BASE_URL}/companies`);
  const digits = q.replace(/[\s.-]/g, "");
  if (/^\d{9}$/.test(digits)) {
    u.searchParams.set("afm", digits);
  } else if (/^\d{10,}$/.test(digits)) {
    u.searchParams.set("arGemi", digits);
  } else {
    u.searchParams.set("name", q);
  }
  u.searchParams.set("size", String(MAX_RESULTS));
  const answer = await lookupJson(u.toString(), { headers: { api_key: key } });
  if (!answer || answer.status !== 200) return null;
  const list = extractList(answer.body);
  if (!list) return null;
  return list
    .slice(0, MAX_RESULTS)
    .map(toResult)
    .filter((r): r is CompanyLookupResult => r !== null);
}

export const greeceProvider: CompanyLookupProvider = {
  countryCode: "GR",
  sourceName: SOURCE,
  isFree: true,
  searchKinds: ["name", "registry_number", "tax_number"],
  search,
  async getCompany(id: string): Promise<CompanyLookupResult | null> {
    const key = apiKey();
    if (!key) return null;
    const arGemi = id.replace(/\D/g, "");
    if (!arGemi) return null;
    const answer = await lookupJson(`${BASE_URL}/companies/${arGemi}`, {
      headers: { api_key: key },
    });
    if (!answer || answer.status !== 200 || !answer.body) return null;
    // The detail endpoint may return the company bare or wrapped in a list.
    const list = extractList(answer.body);
    const company = list ? list[0] : (answer.body as GrCompany);
    return company ? toResult(company) : null;
  },
};
