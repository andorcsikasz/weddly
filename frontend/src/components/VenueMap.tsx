// Small embedded venue map for the public wedding page's LOCATION band. Mirrors
// SupplierMap's canonical Leaflet usage (MapContainer + OSM TileLayer +
// CircleMarker), but pinned to a single venue and intentionally inert (no
// scroll-zoom, no dragging) so it reads as a quiet "where" thumbnail rather than
// an interactive map. Lazy-imported by WeddingSiteView so the ~150KB leaflet
// bundle only ships to a real browser (and never executes under happy-dom in
// the test suite).
//
// `accent` is the per-theme pin colour (passed as `var(--wt-accent)` so the dot
// matches the couple's palette). `filter` is an optional per-style-pack CSS
// filter the consumer derives from the design ornament, tinting the tiles to
// match the pack's mood. `label` is the accessible name for the map region.

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";

export default function VenueMap({
  lat,
  lng,
  accent,
  filter,
  label,
}: {
  lat: number;
  lng: number;
  accent: string;
  filter?: string;
  label?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ height: 300, filter }}
      role="img"
      aria-label={label}
    >
      <MapContainer
        center={[lat, lng]}
        zoom={14}
        scrollWheelZoom={false}
        dragging={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[lat, lng]}
          radius={8}
          pathOptions={{
            fillColor: accent,
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
          }}
        />
      </MapContainer>
    </div>
  );
}
