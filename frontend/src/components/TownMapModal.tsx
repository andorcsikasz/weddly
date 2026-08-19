// "Explore by town" map for the public vendor browser, opened from a button
// beside the country/city filters. The filter row already offers the town-name
// list, so this modal gives the map all of its available space rather than
// repeating those names underneath it.
//
// Continent-wide (no country picked yet), one marker per TOWN is unreadable —
// hundreds of pins stack on top of each other over central Europe. So the
// modal opens on one pin per COUNTRY instead, and drills into that country's
// towns on click (see `drillCountry`), staying open rather than closing like
// a town pick does: picking a country is scoping the search, not finishing it.

import type { SupplierCategory } from "@shared/suppliers";
import { ChevronLeft, X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { categoryIcon } from "../lib/category_icons";
import { useT } from "../lib/i18n";
import type { PlacedCountry, PlacedTown } from "./TownMap";

const TownMap = lazy(() => import("./TownMap"));

export interface TownMapTown {
  city: string;
  count: number;
  lat: number | null;
  lng: number | null;
}

export interface TownMapCountryPin {
  code: string;
  count: number;
  lat: number | null;
  lng: number | null;
}

export default function TownMapModal({
  towns,
  countryPins,
  category,
  activeCountry,
  onSelectCity,
  onSelectCountry,
  onClose,
}: {
  towns: TownMapTown[];
  /** One entry per country, scoped the same way `towns` is. Only worth
   *  showing as its own view when there's more than one to pick between. */
  countryPins: TownMapCountryPin[];
  category: SupplierCategory | null;
  /** The country filter already applied on the page behind the modal, if
   *  any. Non-null skips straight to that country's towns, matching what the
   *  visitor already picked outside the map. */
  activeCountry: string | null;
  /** null clears the filter ("view all towns"). Either way the modal closes
   *  itself right after — this is a picker, not a panel to keep browsing in. */
  onSelectCity: (city: string | null) => void;
  /** Fires when a country pin is picked (or the visitor backs out to "all
   *  countries"). Unlike `onSelectCity`, this does NOT close the modal — the
   *  visitor is narrowing the map, not finishing with it. */
  onSelectCountry: (code: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Only rendered while `category` is set (see the header below); the "" arm
  // never reaches the screen, it just keeps categoryIcon's string param happy.
  const CategoryGlyph = categoryIcon(category ?? "");

  const placedCountries = useMemo(
    (): PlacedCountry[] =>
      countryPins
        .filter(
          (c): c is TownMapCountryPin & { lat: number; lng: number } =>
            c.lat != null && c.lng != null,
        )
        .map((c) => ({ code: c.code, count: c.count, lat: c.lat, lng: c.lng }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    [countryPins],
  );

  // The map's own drill state: which country it's showing towns for, distinct
  // from the page's `activeCountry` because clicking a pin has to feel
  // instant while the parent re-fetches that country's town facets in the
  // background. Starts wherever the page already was — a visitor who picked
  // a country outside the map skips straight to its towns.
  const [drillCountry, setDrillCountry] = useState<string | null>(activeCountry);
  const showingCountries = drillCountry == null && placedCountries.length > 1;

  const sorted = useMemo(
    () => [...towns].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
    [towns],
  );
  const placed = useMemo(
    (): PlacedTown[] =>
      sorted
        .filter(
          (c): c is TownMapTown & { lat: number; lng: number } => c.lat != null && c.lng != null,
        )
        .map((c) => ({ city: c.city, count: c.count, lat: c.lat, lng: c.lng })),
    [sorted],
  );

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function pick(city: string | null) {
    onSelectCity(city);
    onClose();
  }

  function pickCountry(code: string) {
    setDrillCountry(code);
    onSelectCountry(code);
  }

  function backToCountries() {
    setDrillCountry(null);
    onSelectCountry(null);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[min(680px,85vh)] w-[min(880px,92vw)] flex-col overflow-hidden rounded-2xl bg-paper-50 shadow-pop dark:bg-umber-800"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
          <div>
            <h2
              id={titleId}
              className="font-grotesk text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50"
            >
              {t("vendorBrowse.map_title")}
            </h2>
            {/* The pins already carry the category's own glyph; this line is
                what tells a visitor the WHOLE map is scoped to it, rather than
                leaving them to notice a repeated icon and guess. */}
            {category && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-ink-500 dark:text-umber-300">
                <CategoryGlyph size={13} aria-hidden />
                {t("vendorBrowse.map_category_note", { category: t(`suppliers.cat.${category}`) })}
              </p>
            )}
            {showingCountries ? (
              <p className="mt-1 text-[13px] font-medium text-ink-500 dark:text-umber-300">
                {t("vendorBrowse.map_countries_hint")}
              </p>
            ) : (
              placedCountries.length > 1 && (
                <button
                  type="button"
                  onClick={backToCountries}
                  className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink-500 underline-offset-4 transition hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
                >
                  <ChevronLeft size={14} aria-hidden />
                  {t("vendorBrowse.map_back_to_countries")}
                </button>
              )
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => pick(null)}
              className="whitespace-nowrap text-[13px] font-medium tracking-tight text-ink-500 underline-offset-4 transition hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
            >
              {t("vendorBrowse.map_view_all", { count: sorted.length })}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost btn-sm -mr-1 -mt-1"
              aria-label={t("a11y.close")}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 bg-paper-200 dark:bg-umber-700">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-umber-300">
                {t("common.loading")}
              </div>
            }
          >
            {showingCountries ? (
              <TownMap mode="country" countries={placedCountries} onSelect={pickCountry} />
            ) : (
              <TownMap towns={placed} category={category} onSelect={(city) => pick(city)} />
            )}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
