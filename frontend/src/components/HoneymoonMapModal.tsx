// Map preview for the honeymoon destination. Renders a 60vw × 60vh popup with a
// map centred on the destination's lat/lng and the plane pin standing on it.
//
// It used to be an OpenStreetMap embed iframe with that pin absolutely
// positioned at the container's centre, which came loose the moment anyone
// zoomed: the map moved, the pin didn't. PinnedMap draws a real Leaflet marker
// instead, and its header carries the rest of the reasoning.

import { ExternalLink, Loader2, MapPin, Plane, X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// Lazy even though this modal is itself lazy-imported, so leaflet only loads for
// a destination that actually geocoded.
const PinnedMap = lazy(() => import("./PinnedMap"));

// The pin is a round badge, so the coordinate sits at its centre.
const PIN_SIZE: [number, number] = [40, 40];
const PIN_ANCHOR: [number, number] = [20, 20];

interface Coords {
  lat: number;
  lng: number;
}

interface HoneymoonMapModalProps {
  destination: string;
  onClose: () => void;
}

export default function HoneymoonMapModal({ destination, onClose }: HoneymoonMapModalProps) {
  const { t, locale } = useT();
  const titleId = useId();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [label, setLabel] = useState<string>(destination);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");

  // Hold onClose in a ref so the ESC listener doesn't need to re-bind on
  // every parent render (the parent passes a fresh arrow each render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Geocode the destination via /api/places/search on mount.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const r = await placesApi.search(destination, { lang: locale });
        if (cancelled) return;
        const first = r.places[0];
        if (first && first.lat !== null && first.lng !== null) {
          setCoords({ lat: first.lat, lng: first.lng });
          setLabel(first.primary || destination);
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
  }, [destination, locale]);

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
        className="relative flex h-[60vh] min-h-[400px] w-[60vw] min-w-[320px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop dark:bg-umber-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-paper-200 px-4 py-3 dark:border-umber-700">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("honeymoon.tile_destination")}
            </p>
            <h2
              id={titleId}
              className="mt-0.5 truncate font-grotesk text-lg text-ink-900 dark:text-paper-50"
            >
              {label}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {state === "ready" && coords && (
              <a
                href={osmExternalUrl(coords, destination)}
                target="_blank"
                rel="noreferrer noopener"
                className="btn-ghost btn-sm"
                aria-label={t("honeymoon.map_open_external")}
                title={t("honeymoon.map_open_external")}
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
              <p>{t("honeymoon.map_not_found")}</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500 dark:text-umber-300">
              {t("honeymoon.map_error")}
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
                zoom={pickZoomFor(destination)}
                label={t("honeymoon.map_iframe_title", { label })}
                pinSize={PIN_SIZE}
                pinAnchor={PIN_ANCHOR}
                pin={
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blush-500 shadow-lg ring-2 ring-white/80">
                    <Plane size={20} className="text-white" aria-hidden="true" />
                  </span>
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

function osmExternalUrl(coords: Coords, destination: string): string {
  return `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=${pickZoomFor(destination)}/${coords.lat}/${coords.lng}`;
}

/** Opening zoom. More commas → a more specific address → a tighter view; a bare
 *  country or island name opens wide. Measured on the SAVED DESTINATION, not on
 *  the geocoder's `primary` label: that label is one word ("Róma") almost
 *  always, so reading it meant a couple who pinned a particular church still
 *  opened at country zoom. The visitor takes it from there, and the pin now
 *  follows them. */
function pickZoomFor(destination: string): number {
  const commas = (destination.match(/,/g) ?? []).length;
  if (commas >= 3) return 14;
  if (commas >= 1) return 10;
  return 6;
}
