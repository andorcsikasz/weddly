// Leaflet map view of the supplier directory. Lazy-imported from SuppliersPage
// so the ~150KB leaflet bundle only ships when the user opens the Map tab.
//
// Pins are placed at the venue's coordinates from `suppliers_data.ts`. Entries
// without coords (community submissions today) aren't shown on the map — the
// list view always has the full directory.

import type { DirectorySupplier } from "@shared/suppliers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { useT } from "../lib/i18n";

// Leaflet's default marker icons ship as static assets that webpack/Vite
// won't resolve unless we point at the CDN copies. CDN-hosted PNGs are fine —
// they don't change across leaflet versions.
const DEFAULT_ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const HUNGARY_CENTER: [number, number] = [47.16, 19.51];

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

  // Fit zoom to the data when there's enough spread; otherwise centre on Hungary.
  const bounds = useMemo(() => {
    if (pins.length < 2) return null;
    return L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
  }, [pins]);

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-300 shadow-pop">
      <MapContainer
        center={HUNGARY_CENTER}
        zoom={7}
        bounds={bounds ?? undefined}
        boundsOptions={{ padding: [40, 40] }}
        scrollWheelZoom={false}
        style={{ height: "70vh", minHeight: "480px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={DEFAULT_ICON}>
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
                  href={s.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block pt-1 text-xs font-medium text-blush-700 hover:text-blush-800"
                >
                  {t("suppliers.visit_website")} →
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {suppliers.length > pins.length && (
        <p className="border-t border-paper-200 bg-paper-50 px-4 py-2 text-xs text-ink-500">
          {t("suppliers.map_missing_count", { n: suppliers.length - pins.length })}
        </p>
      )}
    </div>
  );
}
