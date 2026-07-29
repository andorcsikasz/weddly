// Map preview for the honeymoon destination. Renders a 60vw × 60vh popup
// with an OpenStreetMap embed iframe centred on the destination's lat/lng.
//
// We use an iframe (not react-leaflet) because the modal needs to render
// reliably across React 19 / Suspense / lazy combinations — Leaflet's
// canvas-sizing was prone to mounting in a half-grey state when the parent
// flexbox animated in. The iframe is fully self-contained and always paints.

import { ExternalLink, Loader2, MapPin, Plane, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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
                href={osmExternalUrl(coords, label)}
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
            <>
              <iframe
                key={`${coords.lat},${coords.lng}`}
                title={t("honeymoon.map_iframe_title", { label })}
                src={osmEmbedUrl(coords, label)}
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blush-500 shadow-lg">
                  <Plane size={20} className="text-white" aria-hidden="true" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Build OpenStreetMap's `/export/embed.html` URL with a small bbox around
 *  the marker. The bbox width is a heuristic: a tighter zoom for detailed
 *  addresses, wider for bare country / region names. */
function osmEmbedUrl(coords: Coords, label: string): string {
  const { lat, lng } = coords;
  const halfWidth = pickHalfWidth(label);
  // Aspect-correct half-height. We don't know the iframe's exact dimensions
  // here so we use the modal's roughly 1.5:1 (60vw × 60vh on a 16:9 display)
  // — close enough that the marker stays centred.
  const halfHeight = halfWidth * 0.75;
  const bbox = [lng - halfWidth, lat - halfHeight, lng + halfWidth, lat + halfHeight];
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    layer: "mapnik",
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

function osmExternalUrl(coords: Coords, _label: string): string {
  return `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=${pickZoomFor(_label)}/${coords.lat}/${coords.lng}`;
}

/** Half-bbox width in degrees. More commas in the label → more specific
 *  address → tighter view. Same heuristic spirit as our earlier
 *  Leaflet `pickZoom`, expressed in lng-degree spread. */
function pickHalfWidth(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 3) return 0.005; // street level
  if (commas >= 1) return 0.06; // city in a region
  return 4; // bare country / region name
}

function pickZoomFor(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 3) return 14;
  if (commas >= 1) return 10;
  return 6;
}
