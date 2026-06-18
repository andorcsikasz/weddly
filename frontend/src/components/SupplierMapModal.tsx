// Map preview for a supplier's location. Renders a 70vw × 70vh popup with an
// OpenStreetMap embed iframe centred on the supplier's coordinates, so couples
// can place the venue without leaving the detail page.
//
// We use an iframe (not react-leaflet) for the same reason HoneymoonMapModal
// does: the embed paints reliably across React 19 / Suspense / lazy combos,
// where Leaflet's canvas-sizing can mount in a half-grey state inside an
// animating flexbox. When the supplier already carries lat/lng we centre on
// those directly; otherwise we geocode the street address via
// /api/places/search as a fallback.

import { ExternalLink, Loader2, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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
  // Address label drives both the iframe title and the zoom heuristic.
  const label = address ? `${address}, ${city}` : city;
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
        const alreadyHasCity =
          address && city && address.toLowerCase().includes(city.toLowerCase());
        const query = address
          ? alreadyHasCity
            ? address
            : `${address}, ${city}`
          : city;
        const r = await placesApi.search(query);
        if (cancelled) return;
        const first = r.places[0];
        if (first && first.lat !== null && first.lng !== null) {
          setCoords({ lat: first.lat, lng: first.lng });
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
            <iframe
              key={`${coords.lat},${coords.lng}`}
              title={t("suppliers.detail.map.iframeTitle", { name })}
              src={osmEmbedUrl(coords, label)}
              loading="eager"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Build OpenStreetMap's `/export/embed.html` URL with a small bbox around the
 *  marker. A supplier address is street-level, so we use a tight half-width. */
function osmEmbedUrl(coords: Coords, label: string): string {
  const { lat, lng } = coords;
  const halfWidth = pickHalfWidth(label);
  // Aspect-correct half-height for the modal's roughly 1.5:1 (70vw × 70vh on a
  // 16:9 display) so the marker stays centred.
  const halfHeight = halfWidth * 0.75;
  const bbox = [lng - halfWidth, lat - halfHeight, lng + halfWidth, lat + halfHeight];
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    layer: "mapnik",
    marker: `${lat},${lng}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

function osmExternalUrl(coords: Coords, label: string): string {
  return `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=${pickZoomFor(label)}/${coords.lat}/${coords.lng}`;
}

/** Half-bbox width in degrees. A full street address (more commas) gets a
 *  tighter view; a bare city falls back to a wider neighbourhood frame. */
function pickHalfWidth(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 2) return 0.005; // street level
  if (commas >= 1) return 0.02; // address within a settlement
  return 0.06; // bare city / settlement
}

function pickZoomFor(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 2) return 16;
  if (commas >= 1) return 14;
  return 12;
}
