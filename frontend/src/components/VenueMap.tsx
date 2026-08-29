// Small embedded venue map for the public wedding page's LOCATION band. Pinned
// to a single venue and intentionally inert (no scroll-zoom, no dragging) so it
// reads as a quiet "where" thumbnail rather than an interactive map.
// Lazy-imported by WeddingSiteView so the ~150KB leaflet bundle only ships to a
// real browser (and never executes under happy-dom in the test suite).
//
// Basemap: CARTO Voyager, a soft, warm raster style, a genuine step up from
// raw OSM tiles for a wedding page, free up to 5M tile requests/month against
// VITE_CARTO_API_KEY (baked at build time; an unset key still loads tiles, just
// with CARTO's "API key required" watermark). Its host (basemaps.cartocdn.com)
// is allowlisted in the img-src CSP directive (backend/src/server.ts). The
// per-style-pack CSS `filter` still layers on top, so the couple's chosen mood
// (sepia / grayscale / …) rides over the base.
//
// Marker: the Weddly dove pin (components/venuePin.ts), tinted with the couple's
// accent. `accent` is the per-theme pin colour (passed as `var(--wt-accent)` so
// it matches the palette). `filter` is the optional per-pack tile tint. `label`
// is the accessible name for the map region.

import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { venuePinIcon } from "./venuePin";

const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? "").trim();
const CARTO_TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${
  CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : ""
}`;

export default function VenueMap({
  lat,
  lng,
  accent,
  filter,
  label,
  square = false,
}: {
  lat: number;
  lng: number;
  accent: string;
  filter?: string;
  label?: string;
  /** Square instead of the 300px-tall strip. Used by the side-by-side venue
   *  layout, where a wide strip next to a short text column reads as a banner
   *  rather than a place. Height follows the column width via aspect-ratio, so
   *  the map keeps its shape at every breakpoint. */
  square?: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={square ? { aspectRatio: "1 / 1", filter } : { height: 300, filter }}
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={CARTO_TILE_URL}
          subdomains="abcd"
          detectRetina
        />
        <Marker
          position={[lat, lng]}
          icon={venuePinIcon(accent)}
          interactive={false}
          keyboard={false}
        />
      </MapContainer>
    </div>
  );
}
