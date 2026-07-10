// Business lookup against the free official registry for the picked country.
// Fully country-agnostic: the backend availability endpoint says whether a
// source exists and which query kinds it resolves; countries without a free
// source render nothing and the surrounding manual fields stand alone.
// Picking a result hands the official record to the parent, which auto-fills
// the editable profile fields (auto-fill, never lock).

import { Building2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CompanyLookupAvailability, CompanyLookupResult } from "@shared/company_lookup";
import { companyLookupApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

type Props = {
  /** ISO 3166-1 alpha-2, or empty when the user hasn't picked a country. */
  country: string;
  onPick: (company: CompanyLookupResult) => void;
};

export function CompanyLookupBox({ country, onPick }: Props) {
  const { t } = useT();
  const [availability, setAvailability] = useState<CompanyLookupAvailability | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CompanyLookupResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  // Country can flip while an availability fetch is in flight; only the
  // latest request may commit state.
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setAvailability(null);
    setQuery("");
    setResults(null);
    setError(null);
    if (!/^[A-Z]{2}$/.test(country)) return;
    companyLookupApi
      .availability(country)
      .then((a) => {
        if (requestSeq.current === seq) setAvailability(a);
      })
      .catch(() => {});
  }, [country]);

  if (!availability?.available) return null;

  const kindsLine = availability.search_kinds.map((k) => t(`company_lookup.kind_${k}`)).join(" / ");

  /** Import EVERYTHING the registry publishes: some sources return trimmed
   *  search rows, so a pick first fetches the full official record and lets
   *  its non-null fields win over the row. If the detail fetch fails, the
   *  search row is still official data; fall back to it rather than block. */
  async function handlePick(r: CompanyLookupResult) {
    if (pickingId) return;
    setPickingId(r.id);
    try {
      const { company } = await companyLookupApi.getCompany(country, r.id);
      const merged: CompanyLookupResult = { ...r };
      for (const [key, val] of Object.entries(company)) {
        if (val != null) (merged as unknown as Record<string, unknown>)[key] = val;
      }
      // "unknown" is the detail endpoint saying nothing, not a downgrade.
      if (company.status === "unknown") merged.status = r.status;
      onPick(merged);
    } catch {
      onPick(r);
    } finally {
      setPickingId(null);
    }
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const r = await companyLookupApi.search(country, q);
      setResults(r.results);
    } catch {
      setError(t("company_lookup.error_upstream"));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-800/60">
      <div className="flex items-start gap-2.5">
        <Building2 size={17} className="mt-0.5 shrink-0 text-umber-500 dark:text-umber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-umber-900 dark:text-paper-50">
            {t("company_lookup.title")}
          </p>
          <p className="mt-0.5 text-xs text-umber-600 dark:text-umber-300">
            {t("company_lookup.subtitle", { kinds: kindsLine })}
          </p>
        </div>
      </div>

      {/* Not a <form>: this box is rendered INSIDE the vendor/planner
          registration <form>, and a nested form (or a submit button that
          bubbles to the outer form) makes "Keresés" submit/reload the whole
          page, wiping the wizard step + any held Google credential. A plain
          type="button" can never submit a form; Enter in the field searches
          via onKeyDown (with preventDefault so it doesn't submit the parent). */}
      <div className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSearch();
            }
          }}
          placeholder={kindsLine}
          aria-label={t("company_lookup.title")}
        />
        <button
          type="button"
          className="btn-outline shrink-0"
          disabled={searching || !query.trim()}
          onClick={() => void handleSearch()}
        >
          <Search size={15} aria-hidden="true" />
          {searching ? t("company_lookup.searching") : t("company_lookup.search_button")}
        </button>
      </div>

      <div aria-live="polite">
        {error && (
          <p className="mt-3 text-sm text-blush-700 dark:text-blush-300" role="alert">
            {error}
          </p>
        )}

        {results && results.length === 0 && (
          <p className="mt-3 text-sm text-umber-600 dark:text-umber-300">
            {t("company_lookup.no_results")}
          </p>
        )}

        {results && results.length > 0 && (
          <ul className="mt-3 divide-y divide-paper-200 rounded-lg border border-paper-200 bg-white dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800">
            {results.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {r.name ?? r.registry_number ?? r.id}
                  </p>
                  <p className="truncate text-xs text-umber-500 dark:text-umber-400">
                    {[
                      r.city ?? r.region,
                      r.registry_number ?? r.vat_number,
                      r.status === "active"
                        ? t("company_lookup.status_active")
                        : r.status === "inactive"
                          ? t("company_lookup.status_inactive")
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-outline shrink-0"
                  disabled={pickingId !== null}
                  onClick={() => void handlePick(r)}
                >
                  {pickingId === r.id
                    ? t("company_lookup.searching")
                    : t("company_lookup.use_button")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-umber-400 dark:text-umber-400">
        {t("company_lookup.manual_hint")}
        {" · "}
        {t("company_lookup.source_label", { source: availability.source_name ?? "" })}
      </p>
    </div>
  );
}
