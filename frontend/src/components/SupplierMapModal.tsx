// Map preview for a supplier's location. Renders a 70vw × 70vh popup centred on
// the supplier's coordinates, so couples can place the venue without leaving the
// detail page. When the supplier already carries lat/lng we centre on those
// directly; otherwise we geocode the street address via /api/places/search as a
// fallback.
//
// The map used to be an OpenStreetMap embed iframe with our pin absolutely
// positioned at the container's centre, which only pointed at the venue until
// someone zoomed. PinnedMap draws a real Leaflet marker instead; its header
// carries the reasoning.

import { ExternalLink, Loader2, MapPin, X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const PinnedMap = lazy(() => import("./PinnedMap"));

// A teardrop, so the coordinate is under its TIP rather than its middle.
const PIN_SIZE: [number, number] = [30, 42];
const PIN_ANCHOR: [number, number] = [15, 42];

interface Coords {
  lat: number;
  lng: number;
}

interface SupplierMapModalProps {
  name: string;
  /** Stored WGS-84 coordinates, when the listing has them. */
  lat: number | null;
  lng: number | null;
  /** Full street address, e.g. "2211 Vasad, Monori út 100." */
  address: string | null;
  city: string;
  onClose: () => void;
}

export default function SupplierMapModal({
  name,
  lat,
  lng,
  address,
  city,
  onClose,
}: SupplierMapModalProps) {
  const { t } = useT();
  const titleId = useId();
  const [coords, setCoords] = useState<Coords | null>(
    typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
  );
  // Address label drives both the iframe title and the zoom heuristic. City may
  // be empty for a free-text venue (e.g. the dashboard Kulcsinfó map), so fall
  // back to whichever part we have rather than emit a dangling comma.
  const label = address && city ? `${address}, ${city}` : address || city;
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">(
    typeof lat === "number" && typeof lng === "number" ? "ready" : "loading",
  );

  // Hold onClose in a ref so the ESC listener doesn't re-bind on every parent
  // render (the parent passes a fresh arrow each render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Geocode the address only when we have no stored coordinates.
  useEffect(() => {
    if (typeof lat === "number" && typeof lng === "number") return;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        // The `city` carries a trailing country code for international entries
        // (e.g. "Venice, IT"). Use that as a country bias, and append only the
        // settlement NAME to the query — appending the raw ", IT" produced an
        // ungeocodable "…, Italy, Venice, IT" and the pin failed.
        const cc = city.match(/,\s*([A-Za-z]{2})\s*$/)?.[1]?.toLowerCase();
        const cityName = city.replace(/,\s*[A-Za-z]{2}\s*$/, "").trim();
        const alreadyHasCity =
          !!cityName && !!address && address.toLowerCase().includes(cityName.toLowerCase());
        // Try the most specific query first, then fall back to the settlement
        // alone (which always geocodes for a real town). A fussy full street
        // address can miss in Nominatim, so we degrade to pin somewhere
        // relevant rather than show "couldn't pin".
        const queries: string[] = [];
        if (address)
          queries.push(!cityName || alreadyHasCity ? address : `${address}, ${cityName}`);
        if (cityName) queries.push(cityName);
        if (queries.length === 0) queries.push(city);

        let hit: Coords | null = null;
        for (const query of queries) {
          // No `lang` here on purpose: this call is used for its coordinates
          // only, and re-geocoding on a locale flip would spend a Nominatim
          // call to move the pin nowhere.
          const r = await placesApi.search(query, { country: cc });
          if (cancelled) return;
          const first = r.places[0];
          if (first && first.lat !== null && first.lng !== null) {
            hit = { lat: first.lat, lng: first.lng };
            break;
          }
        }
        if (hit) {
          setCoords(hit);
          setState("ready");
        } else {
          setState("not_found");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, address, city]);

  // ESC closes; scroll-lock the page behind. Empty deps — listener mounts /
  // unmounts with the modal, onCloseRef keeps the callback current.
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
        className="relative flex h-[70vh] min-h-[400px] w-[70vw] min-w-[320px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop dark:bg-umber-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-paper-200 px-4 py-3 dark:border-umber-700">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {label}
            </p>
            <h2
              id={titleId}
              className="mt-0.5 truncate font-grotesk text-lg text-ink-900 dark:text-paper-50"
            >
              {name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {state === "ready" && coords && (
              <a
                href={osmExternalUrl(coords, label)}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-ghost btn-sm"
                aria-label={t("suppliers.detail.map.openExternal")}
                title={t("suppliers.detail.map.openExternal")}
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost btn-sm -mr-1"
              aria-label={t("a11y.close")}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="relative flex-1 bg-paper-100 dark:bg-umber-700/60">
          {state === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-umber-300">
              <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
              {t("common.loading")}
            </div>
          )}
          {state === "not_found" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-500 dark:text-umber-300">
              <MapPin size={20} className="text-ink-400 dark:text-umber-300" aria-hidden="true" />
              <p>{t("suppliers.detail.map.notFound")}</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500 dark:text-umber-300">
              {t("suppliers.detail.map.error")}
            </div>
          )}
          {state === "ready" && coords && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-ink-500 dark:text-umber-300">
                  <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
                  {t("common.loading")}
                </div>
              }
            >
              <PinnedMap
                key={`${coords.lat},${coords.lng}`}
                lat={coords.lat}
                lng={coords.lng}
                zoom={pickZoomFor(label)}
                label={t("suppliers.detail.map.iframeTitle", { name })}
                pinSize={PIN_SIZE}
                pinAnchor={PIN_ANCHOR}
                pin={
                  /* Our own pin rather than Leaflet's default blue one, in the
                     celebrate red the rest of the directory marks a place with. */
                  <svg
                    width="30"
                    height="42"
                    viewBox="0 0 24 34"
                    fill="none"
                    className="text-celebrate drop-shadow-md"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 0C5.4 0 0 5.4 0 12c0 9 12 22 12 22s12-13 12-22C24 5.4 18.6 0 12 0z"
                      fill="currentColor"
                    />
                    <circle cx="12" cy="12" r="4.5" className="fill-white" />
                  </svg>
                }
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function osmExternalUrl(coords: Coords, label: string): string {
  return `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=${pickZoomFor(label)}/${coords.lat}/${coords.lng}`;
}

/** Opening zoom. A full street address (more commas) opens tighter; a bare city
 *  opens on the settlement. */
function pickZoomFor(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 2) return 16;
  if (commas >= 1) return 14;
  return 12;
}
