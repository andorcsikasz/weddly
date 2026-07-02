import type { CompanyLookupResult, CompanySearchKind } from "@shared/company_lookup";

/** One free official registry source. Implementations live next to this file
 *  (france.ts, netherlands.ts, greece.ts, vies.ts) and are selected by the
 *  factory in index.ts. The route layer is the only consumer.
 *
 *  Return contract for search():
 *  - `null`  = upstream failure (network, 5xx). The route maps this to 502
 *    so the UI can suggest manual entry; never cached.
 *  - `[]`    = source answered, nothing matched (or the query shape is not
 *    searchable in this registry, e.g. a name query where only tax-number
 *    lookup exists).
 *  - `[...]` = matches, mapped 1:1 from official data. No enrichment. */
export interface CompanyLookupProvider {
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  /** Official source attribution shown in the UI. */
  sourceName: string;
  /** Always true in this registry; paid/licensed providers come later. */
  isFree: true;
  searchKinds: CompanySearchKind[];
  search(query: string): Promise<CompanyLookupResult[] | null>;
  getCompany(id: string): Promise<CompanyLookupResult | null>;
}
