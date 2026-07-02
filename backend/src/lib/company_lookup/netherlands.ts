// Netherlands: KVK Handelsregister Open Dataset Basis Bedrijfsgegevens.
// The only genuinely open (key-less, CC BY 4.0) KVK offering. Deliberately
// limited by design: lookup by KVK number only, BV/NV legal forms only, and
// anonymised, so no trade name and no full address (just a 2-digit postcode
// region). The richer Zoeken API needs a paid monthly KVK subscription, so
// it is out of scope for the free phase.
// Docs: https://developers.kvk.nl/nl/documentation/open-dataset-basis-bedrijfsgegevens-api
//
// Upstream allows roughly 1 query/minute; the client.ts TTL cache absorbs
// repeats and the route's rate-limit bucket keeps burst traffic off it.

import type { CompanyLookupResult } from "@shared/company_lookup";
import { lookupJson } from "./client";
import type { CompanyLookupProvider } from "./types";

const BASE_URL = "https://opendata.kvk.nl/api/v1/hvds/basisbedrijfsgegevens/kvknummer";
const SOURCE = "KVK Handelsregister Open Dataset";

interface NlActivity {
  sbiCode?: string;
  omschrijving?: string;
}

interface NlCompany {
  kvkNummer?: string;
  datumAanvang?: string;
  actief?: string;
  rechtsvormCode?: string;
  postcodeRegio?: string;
  activiteiten?: unknown;
}

/** "20210401" or "2021-04-01" to ISO; anything else passes through as-is. */
function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

function activityLine(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const parts = raw
    .map((a) => {
      if (typeof a === "string") return a;
      const act = a as NlActivity;
      if (!act?.sbiCode) return null;
      return act.omschrijving ? `${act.sbiCode} ${act.omschrijving}` : act.sbiCode;
    })
    .filter((s): s is string => !!s);
  return parts.length ? parts.join("; ") : null;
}

function toResult(c: NlCompany, kvk: string): CompanyLookupResult {
  return {
    id: kvk,
    country: "NL",
    source_name: SOURCE,
    // The open dataset is anonymised: no trade name, no street address.
    name: null,
    registry_number: c.kvkNummer ?? kvk,
    vat_number: null,
    legal_form: c.rechtsvormCode ?? null,
    address: null,
    city: null,
    postal_code: null,
    region: c.postcodeRegio ? `${c.postcodeRegio}xx` : null,
    status: c.actief === "J" ? "active" : c.actief === "N" ? "inactive" : "unknown",
    activity: activityLine(c.activiteiten),
    registration_date: toIsoDate(c.datumAanvang),
  };
}

async function getByKvk(kvk: string): Promise<CompanyLookupResult | null | "upstream_error"> {
  const answer = await lookupJson(`${BASE_URL}/${kvk}`);
  if (!answer) return "upstream_error";
  if (answer.status === 404) return null;
  if (answer.status !== 200 || !answer.body || typeof answer.body !== "object") {
    return "upstream_error";
  }
  return toResult(answer.body as NlCompany, kvk);
}

export const netherlandsProvider: CompanyLookupProvider = {
  countryCode: "NL",
  sourceName: SOURCE,
  isFree: true,
  searchKinds: ["registry_number"],
  async search(query: string): Promise<CompanyLookupResult[] | null> {
    const kvk = query.replace(/\D/g, "");
    // KVK numbers are exactly 8 digits; anything else is unsearchable in the
    // open dataset (no name search exists), so it is a clean "no results".
    if (kvk.length !== 8) return [];
    const r = await getByKvk(kvk);
    if (r === "upstream_error") return null;
    return r ? [r] : [];
  },
  async getCompany(id: string): Promise<CompanyLookupResult | null> {
    const kvk = id.replace(/\D/g, "");
    if (kvk.length !== 8) return null;
    const r = await getByKvk(kvk);
    return r === "upstream_error" ? null : r;
  },
};
