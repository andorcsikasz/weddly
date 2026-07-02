// Country-aware factory for the free company-lookup providers. The frontend
// never sees registry specifics: it asks GET /api/company-lookup/availability
// for a country and renders the generic lookup box (or manual entry) from the
// answer.
//
// Free phase coverage (docs/company_lookup.md has the per-country rationale):
//   FR  recherche-entreprises.api.gouv.fr  name + SIREN/SIRET, no key
//   NL  KVK open dataset                   KVK number only, no key
//   GR  GEMI Open Data API                 name/arGemi/AFM, free key (GEMI_API_KEY)
//   HU  EU VIES                            tax number only (no free registry API)
//   BE  EU VIES                            enterprise number only (CBE API is paid)
// Everything else: manual entry (no free official source worth shipping yet).

import type { CompanyLookupAvailability } from "@shared/company_lookup";
import { franceProvider } from "./france";
import { gemiConfigured, greeceProvider } from "./greece";
import { netherlandsProvider } from "./netherlands";
import type { CompanyLookupProvider } from "./types";
import { belgiumProvider, hungaryProvider } from "./vies";

export type { CompanyLookupProvider } from "./types";

/** The country's free provider, or null when only manual entry applies.
 *  Resolved per call because Greece depends on GEMI_API_KEY at runtime. */
export function getFreeProvider(countryCode: string): CompanyLookupProvider | null {
  switch (countryCode.toUpperCase()) {
    case "FR":
      return franceProvider;
    case "NL":
      return netherlandsProvider;
    case "HU":
      return hungaryProvider;
    case "BE":
      return belgiumProvider;
    case "GR":
      return gemiConfigured() ? greeceProvider : null;
    default:
      return null;
  }
}

export function lookupAvailability(countryCode: string): CompanyLookupAvailability {
  const country = countryCode.toUpperCase();
  const provider = getFreeProvider(country);
  if (!provider) {
    return { country, available: false, source_name: null, search_kinds: [] };
  }
  return {
    country,
    available: true,
    source_name: provider.sourceName,
    search_kinds: provider.searchKinds,
  };
}
