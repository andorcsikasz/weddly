// Lazy-loaded map preview for the honeymoon destination. Lives in its own
// file so the ~150KB Leaflet bundle only ships when the user actually opens
// the popup. On mount we geocode the destination text against Nominatim
// (via our /api/places/search proxy) and centre a small map there.

import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { placesApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const PIN_STYLE = {
  radius: 9,
  fillColor: "#bf4a30", // blush-600
  color: "#fbfaf5", // paper-50
  weight: 2,
  opacity: 1,
  fillOpacity: 0.95,
} as const;

interface Coords {
  lat: number;
  lng: number;
}

interface HoneymoonMapModalProps {
  destination: string;
  onClose: () => void;
}

export default function HoneymoonMapModal({ destination, onClose }: HoneymoonMapModalProps) {
  const { t } = useT();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [label, setLabel] = useState<string>(destination);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");

  // Geocode the destination via /api/places/search on mount. Use the first
  // hit — Nominatim already ranks by relevance/importance.
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const r = await placesApi.search(destination);
        if (cancelled) return;
        const first = r.places[0];
        if (first && first.lat !== null && first.lng !== null) {
          setCoords({ lat: first.lat, lng: first.lng });
          // Prefer the primary headline as the map's marker title; the input
          // text may be a partial typo. Fall back to the original if missing.
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
  }, [destination]);

  // ESC closes; manage scroll-lock + inert the rest of the body — same
  // pattern as components/ui/Dialog.tsx so background content stays out of
  // VoiceOver / Tab order while the modal is open.
  useEffect(() => {
    const triggerEl = (document.activeElement as HTMLElement) ?? null;
    document.body.style.overflow = "hidden";
    const toggled: HTMLElement[] = [];
    const container = containerRef.current;
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (container && child.contains(container)) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      toggled.push(child);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = "";
      for (const el of toggled) el.removeAttribute("inert");
      document.removeEventListener("keydown", onKey);
      queueMicrotask(() => triggerEl?.focus?.());
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[60vh] w-[60vw] min-h-[400px] min-w-[320px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-paper-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              {t("honeymoon.tile_destination")}
            </p>
            <h2 id={titleId} className="mt-0.5 truncate font-serif text-lg text-ink-900">
              {label}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-sm -mr-1"
            aria-label={t("a11y.close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="relative flex-1">
          {state === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-ink-500">
              <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
              {t("common.loading")}
            </div>
          )}
          {state === "not_found" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-500">
              <MapPin size={20} className="text-ink-400" aria-hidden="true" />
              <p>{t("honeymoon.map_not_found")}</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500">
              {t("honeymoon.map_error")}
            </div>
          )}
          {state === "ready" && coords && (
            <MapContainer
              center={[coords.lat, coords.lng]}
              zoom={pickZoom(label)}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <CircleMarker center={[coords.lat, coords.lng]} pathOptions={PIN_STYLE}>
                <Popup>
                  <p className="font-semibold text-ink-900">{label}</p>
                </Popup>
              </CircleMarker>
              <FitToBounds lat={coords.lat} lng={coords.lng} />
            </MapContainer>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Centre + zoom on mount. Without this the map renders with the initial
 *  zoom but doesn't auto-fit if the lat/lng changes between mounts. */
function FitToBounds({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: false });
    // Force a redraw — Leaflet sometimes mis-sizes the canvas when the
    // container animates in (modal flex layout).
    queueMicrotask(() => map.invalidateSize());
  }, [map, lat, lng]);
  return null;
}

/** Heuristic zoom level — city-name-ish labels zoom in tight, country / region
 *  hits stay wider. Cheap proxy: comma count in the picked label. */
function pickZoom(label: string): number {
  const commas = (label.match(/,/g) ?? []).length;
  if (commas >= 3) return 14; // detailed address → street level
  if (commas >= 1) return 10; // city in a region
  return 6; // bare country / region name
}
