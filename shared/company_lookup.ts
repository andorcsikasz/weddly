// Company lookup & auto-fill contract, shared by the backend provider
// registry and the frontend lookup box. The frontend stays 100%
// country-agnostic: it renders whatever `search_kinds` the availability
// endpoint reports and never hard-codes registry names or formats.
//
// Compliance stance (see docs/company_lookup.md): providers wrap ONLY free,
// official registry APIs / open datasets. No scraping, no paid extracts, no
// data brokers. Countries without a free official source get manual entry.

/** What kind of query a provider can resolve. Drives the generic input
 *  placeholder/hint on the frontend, never country-specific copy. */
export type CompanySearchKind = "name" | "tax_number" | "registry_number";

/** Per-country availability, served by GET /api/company-lookup/availability.
 *  `available: false` means the UI shows manual entry only. */
export interface CompanyLookupAvailability {
  /** ISO 3166-1 alpha-2, uppercase (join key of shared/country_list.ts). */
  country: string;
  available: boolean;
  /** Human-readable official source, e.g. "INSEE SIRENE (recherche-entreprises.api.gouv.fr)".
   *  Null when unavailable. Shown as the data-source attribution line. */
  source_name: string | null;
  search_kinds: CompanySearchKind[];
}

/** One company as returned by an official source. Every field except `id`,
 *  `country` and `source_name` is nullable: providers map only what the
 *  registry actually returns and never invent or enrich missing data. */
export interface CompanyLookupResult {
  /** Provider-scoped stable identifier (SIREN, KVK number, GEMI number,
   *  VAT number). Opaque to the frontend. */
  id: string;
  country: string;
  source_name: string;
  name: string | null;
  /** Official registry number (SIREN, KVK, GEMI, BE enterprise number). */
  registry_number: string | null;
  vat_number: string | null;
  legal_form: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  /** Coarse region when the source exposes no city (NL open dataset
   *  publishes only a 2-digit postcode region). */
  region: string | null;
  status: "active" | "inactive" | "unknown";
  /** Main activity code (NAF / SBI / KAD) with label when available. */
  activity: string | null;
  /** ISO date (YYYY-MM-DD) when the source exposes it. */
  registration_date: string | null;
}
