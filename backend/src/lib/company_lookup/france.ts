// France: API Recherche d'entreprises (recherche-entreprises.api.gouv.fr).
// Official DINUM service over INSEE SIRENE + INPI data. Fully open: no API
// key, no account, rate-limited upstream at ~7 req/s. One /search endpoint
// resolves company names, SIREN and SIRET alike.
// Docs: https://recherche-entreprises.api.gouv.fr/docs/

import type { CompanyLookupResult } from "@shared/company_lookup";
import { lookupJson } from "./client";
import type { CompanyLookupProvider } from "./types";

const BASE_URL = "https://recherche-entreprises.api.gouv.fr/search";
const SOURCE = "INSEE SIRENE (recherche-entreprises.api.gouv.fr)";
const MAX_RESULTS = 8;

// Most common INSEE legal-form (nature juridique) codes, mapped to their
// usual short labels. Unmapped codes leave legal_form null rather than
// exposing a bare numeric code in the profile.
const LEGAL_FORMS: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5498": "EURL",
  "5499": "SARL",
  "5599": "SA",
  "5710": "SAS",
  "5720": "SASU",
  "9220": "Association déclarée",
};

interface FrSiege {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
}

interface FrResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  nature_juridique?: string;
  etat_administratif?: string;
  activite_principale?: string;
  date_creation?: string;
  tva?: unknown;
  siege?: FrSiege;
}

function firstVat(tva: unknown): string | null {
  if (typeof tva === "string" && tva.length > 0) return tva;
  if (Array.isArray(tva)) {
    const v = tva.find((x): x is string => typeof x === "string" && x.length > 0);
    return v ?? null;
  }
  return null;
}

function toResult(r: FrResult): CompanyLookupResult | null {
  const siren = typeof r.siren === "string" ? r.siren : null;
  const name = r.nom_complet ?? r.nom_raison_sociale ?? null;
  if (!siren || !name) return null;
  return {
    id: siren,
    country: "FR",
    source_name: SOURCE,
    name,
    registry_number: siren,
    vat_number: firstVat(r.tva),
    legal_form: (r.nature_juridique && LEGAL_FORMS[r.nature_juridique]) || null,
    address: r.siege?.adresse ?? null,
    city: r.siege?.libelle_commune ?? null,
    postal_code: r.siege?.code_postal ?? null,
    region: null,
    status: r.etat_administratif === "A" ? "active" : r.etat_administratif ? "inactive" : "unknown",
    activity: r.activite_principale ?? null,
    registration_date: r.date_creation ?? null,
  };
}

async function search(query: string): Promise<CompanyLookupResult[] | null> {
  const q = query.trim();
  if (q.length < 3) return [];
  const u = new URL(BASE_URL);
  u.searchParams.set("q", q);
  u.searchParams.set("page", "1");
  u.searchParams.set("per_page", String(MAX_RESULTS));
  const answer = await lookupJson(u.toString());
  if (!answer || answer.status !== 200) return null;
  const body = answer.body as { results?: unknown } | null;
  if (!body || !Array.isArray(body.results)) return null;
  return (body.results as FrResult[])
    .map(toResult)
    .filter((r): r is CompanyLookupResult => r !== null);
}

export const franceProvider: CompanyLookupProvider = {
  countryCode: "FR",
  sourceName: SOURCE,
  isFree: true,
  searchKinds: ["name", "registry_number"],
  search,
  async getCompany(id: string): Promise<CompanyLookupResult | null> {
    const siren = id.replace(/\D/g, "");
    if (siren.length !== 9) return null;
    const results = await search(siren);
    return results?.find((r) => r.registry_number === siren) ?? null;
  },
};
