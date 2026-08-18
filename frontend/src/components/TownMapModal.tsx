// "Explore by town" map for the public vendor browser — the Uber Eats "Cities
// near me" pattern (a map with pins over a heading + "view all" link, a plain
// list of names underneath), opened from a button beside the country/city
// filters rather than sitting inline on the page. The filter row already
// answers "which town" for anyone willing to type or scroll a list; this is
// the scan-a-map alternative for anyone who isn't.
//
// See TownMap.tsx for why the map itself is a locked-down Leaflet view rather
// than a flat image.

import { X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";
import type { PlacedTown } from "./TownMap";

const TownMap = lazy(() => import("./TownMap"));

export interface TownMapTown {
  city: string;
  count: number;
  lat: number | null;
  lng: number | null;
}

export default function TownMapModal({
  towns,
  onSelectCity,
  onClose,
}: {
  towns: TownMapTown[];
  /** null clears the filter ("view all towns"). Either way the modal closes
   *  itself right after — this is a picker, not a panel to keep browsing in. */
  onSelectCity: (city: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
          <h2
            id={titleId}
            className="font-grotesk text-xl font-semibold tracking-tight text-ink-900 dark:text-paper-50"
          >
            {t("vendorBrowse.map_title")}
          </h2>
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

        <div className="h-64 shrink-0 bg-paper-200 sm:h-80 dark:bg-umber-700">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-umber-300">
                {t("common.loading")}
              </div>
            }
          >
            <TownMap towns={placed} onSelect={(city) => pick(city)} />
          </Suspense>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">
            {sorted.map((c) => (
              <button
                key={c.city}
                type="button"
                onClick={() => pick(c.city)}
                className="text-[13px] tracking-tight text-ink-600 underline-offset-4 transition hover:text-ink-900 hover:underline dark:text-umber-200 dark:hover:text-paper-50"
              >
                {c.city} <span className="text-ink-400 dark:text-umber-400">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
