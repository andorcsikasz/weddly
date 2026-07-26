// Leaflet map view of the supplier directory. Lazy-imported from SuppliersPage
// so the ~150KB leaflet bundle only ships when the user opens the Map tab.
//
// Pins are placed at the venue's coordinates from `suppliers_data.ts`. Entries
// without coords (community submissions today) aren't shown on the map — the
// list view always has the full directory.

import type { DirectorySupplier } from "@shared/suppliers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { useT } from "../lib/i18n";
import { safeExternalHref } from "../lib/url";

// Brand-tinted vector dots instead of Leaflet's default PNG pins. Keeps the
// map quieter (no shadow, no anchor offset) and matches the rest of the
// directory's flat / paper-tinted look. Two states:
// - default:  ink-700 fill, paper-50 outline   (the quiet base look)
// - hover:    blush-600 fill, paper-50 outline (handled in CSS below)
const PIN_STYLE = {
  base: {
    radius: 7,
    fillColor: "#243150", // ink-700
    color: "#fbfaf5", // paper-50
    weight: 2,
    opacity: 1,
    fillOpacity: 1,
  },
  hover: {
    fillColor: "#bf4a30", // blush-600
  },
} as const;

const HUNGARY_CENTER: [number, number] = [47.16, 19.51];
// Generous edge padding so the outermost pins never sit on the border of the
// viewport, and a maxZoom cap so a tight cluster (or a single pin) doesn't
// land at street level where the rest of the country falls off-screen.
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [48, 48], maxZoom: 13 };

// Re-fits the map whenever the visible pin set changes. MapContainer's `bounds`
// prop is read once on construction, so without this child the map keeps the
// initial framing after the user tightens filters and stays zoomed out over a
// lot of irrelevant area.
function FitToPins({ pins }: { pins: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) {
      map.setView(HUNGARY_CENTER, 7);
      return;
    }
    if (pins.length === 1) {
      const only = pins[0];
      if (!only) return;
      map.setView([only.lat, only.lng], FIT_OPTIONS.maxZoom ?? 13);
      return;
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, FIT_OPTIONS);
  }, [map, pins]);
  return null;
}

export default function SupplierMap({ suppliers }: { suppliers: DirectorySupplier[] }) {
  const { t, locale } = useT();

  const pins = useMemo(
    () =>
      suppliers.filter(
        (s): s is DirectorySupplier & { lat: number; lng: number } =>
          typeof s.lat === "number" && typeof s.lng === "number",
      ),
    [suppliers],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-300 dark:border-umber-700 shadow-pop">
      <MapContainer
        center={HUNGARY_CENTER}
        zoom={7}
        scrollWheelZoom={false}
        style={{ height: "70vh", minHeight: "480px", width: "100%" }}
      >
        <FitToPins pins={pins} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            pathOptions={PIN_STYLE.base}
            radius={PIN_STYLE.base.radius}
            eventHandlers={{
              mouseover: (e) => e.target.setStyle({ fillColor: PIN_STYLE.hover.fillColor }),
              mouseout: (e) => e.target.setStyle({ fillColor: PIN_STYLE.base.fillColor }),
            }}
          >
            <Popup>
              <div className="space-y-1">
                <p className="font-semibold text-ink-900">{s.name}</p>
                <p className="text-xs text-ink-500">
                  {t(`suppliers.cat.${s.category}`)} · {s.city}
                </p>
                {s.address && <p className="text-xs text-ink-500">{s.address}</p>}
                <p className="pt-1 text-xs text-ink-700">
                  {locale === "hu" ? s.blurb_hu : s.blurb_en}
                </p>
                <a
                  href={safeExternalHref(s.website)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block pt-1 text-xs font-medium text-blush-700 hover:text-blush-800"
                >
                  {t("suppliers.visit_website")} →
                </a>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {suppliers.length > pins.length && (
        <p className="border-t border-paper-200 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-4 py-2 text-xs text-ink-500 dark:text-umber-300">
          {t("suppliers.map_missing_count", { n: suppliers.length - pins.length })}
        </p>
      )}
    </div>
  );
}
