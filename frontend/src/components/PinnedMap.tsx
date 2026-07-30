// A map centred on ONE point with ONE pin on it, for the "where is this?"
// modals (the honeymoon destination, a supplier's address).
//
// Both of those used to be an OpenStreetMap `/export/embed.html` iframe with our
// pin absolutely positioned at the container's centre. That is only true on the
// first paint: the bbox centre lands at the viewport centre, so the pin looks
// right until the visitor zooms or pans inside the iframe, at which point the
// map moves and the pin stays — pointing at whatever ocean happens to be under
// the middle of the dialog. A cross-origin iframe gives us no way to hear about
// that, which is why this is a real Leaflet map instead: the marker belongs to
// the map, so it is anchored to its coordinate at every zoom.
//
// Leaflet is already in the bundle for the directory map and the guest page, and
// the callers lazy-import their modal, so this ships nothing new to a visitor
// who never opens one.
//
// The pin is a React node portalled into the divIcon's host element (the same
// trick SupplierMap uses), so each caller keeps its own pin drawn in Tailwind
// tokens rather than an SVG string, and no react-dom/server ships here.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

/** Web-mercator's own extent: past ±85° there is no map to show. */
const WORLD = L.latLngBounds([-85, -180], [85, 180]);

export default function PinnedMap({
  lat,
  lng,
  zoom,
  label,
  pin,
  pinSize,
  pinAnchor,
}: {
  lat: number;
  lng: number;
  zoom: number;
  /** Accessible name for the map region — the place the pin is on. */
  label: string;
  /** The pin itself, drawn by the caller. */
  pin: ReactNode;
  /** Footprint of `pin` in CSS pixels, [width, height]. */
  pinSize: [number, number];
  /** Which point of the pin sits ON the coordinate: the centre of a round
   *  badge, the tip of a teardrop. */
  pinAnchor: [number, number];
}) {
  // A stable host per mount, handed to Leaflet as the divIcon body and filled by
  // the portal below. Leaflet moves the element into the marker pane with its
  // React-rendered children intact.
  const [host] = useState(() => document.createElement("div"));
  const icon = useMemo(
    () =>
      L.divIcon({
        html: host,
        // Overrides Leaflet's default `.leaflet-div-icon` white box + border,
        // which only applies when you supply no className of your own.
        className: "weddly-point-pin",
        iconSize: pinSize,
        iconAnchor: pinAnchor,
      }),
    // The size/anchor pair is a per-caller constant; re-deriving the icon on
    // every render would rebuild the marker's DOM.
    [host, pinSize[0], pinSize[1], pinAnchor[0], pinAnchor[1]],
  );

  return (
    <>
      {createPortal(pin, host)}
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        scrollWheelZoom
        // Keeps a drag from sliding the world off the dialog and filling it with
        // Leaflet's out-of-bounds grey, which reads as tiles that failed to load.
        maxBounds={WORLD}
        maxBoundsViscosity={1}
        style={{ height: "100%", width: "100%" }}
        aria-label={label}
      >
        <Sizer />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={icon} interactive={false} keyboard={false} />
      </MapContainer>
    </>
  );
}

/** Re-measures after mount. The callers mount this inside a dialog that gets its
 *  height from a flexbox, so Leaflet's first measurement can happen before the
 *  layout settles — which is what used to leave the canvas half-grey and was the
 *  original reason those modals reached for an iframe. */
function Sizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => cancelAnimationFrame(raf);
  }, [map]);
  return null;
}
