// Interactive venue location picker for the "Add a venue" flow in the
// guest-page venue picker. Two ways to place the pin, both landing the same
// { address, city, lat, lng }:
//   1. Search the address (Photon typeahead, reused from AddressAutocomplete) —
//      picking a suggestion drops the pin and recenters the map.
//   2. Tap or drag the pin ON the map — the pin moves and a best-effort reverse
//      geocode fills the address/city line.
//
// Leaflet is ~150KB, so this whole module is lazy-imported by the parent (never
// executes under happy-dom in the test suite). Basemap is CARTO Voyager (see
// VenueMap.tsx for the VITE_CARTO_API_KEY note), the same soft raster the
// public VenueMap uses; the marker is the Weddly dove pin.
// Leaflet paints SVG/canvas, not Tailwind classes, so the accent is a literal
// (mirroring components/SupplierMap.tsx) rather than a token utility.

import "leaflet/dist/leaflet.css";
import type { LeafletMouseEvent, Marker as LeafletMarker } from "leaflet";
import { useCallback, useEffect, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { AddressSuggestion } from "@shared/geo";
import { geoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { venuePinIcon } from "./venuePin";

const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? "").trim();
const CARTO_TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${
  CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : ""
}`;

const PIN_ACCENT = "#bf4a30"; // blush-600 — matches the in-app map pin accent
// Fallback centre before anything is placed: Budapest.
const DEFAULT_CENTER: [number, number] = [47.4979, 19.0402];

export type VenueLocationValue = {
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
};

/** Turns a bare map click into a pin placement. Must live inside MapContainer. */
function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Recenters when a NEW coordinate arrives (address search) — map clicks are
 *  already inside the view, so it no-ops on those. */
function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const last = useRef<string>("");
  useEffect(() => {
    if (lat === null || lng === null) return;
    const key = `${lat},${lng}`;
    if (key === last.current) return;
    last.current = key;
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng, map]);
  return null;
}

export default function VenueLocationPicker({
  value,
  onChange,
}: {
  value: VenueLocationValue;
  onChange: (next: VenueLocationValue) => void;
}) {
  const { t } = useT();
  // Refs so the stable `place` callback reads the latest props without
  // re-subscribing the leaflet event handlers on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const place = useCallback((lat: number, lng: number) => {
    // Drop the pin immediately; refine the address in the background.
    onChangeRef.current({ ...valueRef.current, lat, lng });
    void geoApi
      .reverse(lat, lng)
      .then((r) => {
        if (!r.address && !r.city) return;
        const cur = valueRef.current;
        // Only apply if the pin is still where we dropped it (the user may have
        // moved on while the round-trip was in flight).
        if (cur.lat !== lat || cur.lng !== lng) return;
        onChangeRef.current({
          ...cur,
          address: r.address ?? cur.address,
          city: r.city ?? cur.city,
        });
      })
      .catch(() => {
        /* best-effort — keep whatever address the user already had */
      });
  }, []);

  function onPickAddress(s: AddressSuggestion) {
    onChange({
      address: s.address ?? s.label,
      city: s.city ?? value.city,
      lat: s.lat,
      lng: s.lng,
    });
  }

  const hasPin = value.lat !== null && value.lng !== null;
  const center: [number, number] = hasPin
    ? [value.lat as number, value.lng as number]
    : DEFAULT_CENTER;

  return (
    <div className="flex flex-col gap-2">
      {/* The instruction rides in the field it describes, rather than as a
          sentence under the map explaining what the map already affords. */}
      <AddressAutocomplete
        id="venue-address"
        label={t("venue_picker.address_label")}
        value={value.address}
        onChange={(v) => onChange({ ...value, address: v })}
        onPick={onPickAddress}
        placeholder={t("venue_picker.address_placeholder")}
        maxLength={300}
      />
      <div
        className="overflow-hidden rounded-2xl border border-paper-300 dark:border-umber-700"
        style={{ height: 260 }}
      >
        <MapContainer
          center={center}
          zoom={hasPin ? 15 : 12}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={CARTO_TILE_URL}
            subdomains="abcd"
            detectRetina
          />
          <ClickToPlace onPlace={place} />
          <Recenter lat={value.lat} lng={value.lng} />
          {hasPin && (
            <Marker
              position={[value.lat as number, value.lng as number]}
              icon={venuePinIcon(PIN_ACCENT)}
              draggable
              eventHandlers={{
                dragend(e) {
                  const p = (e.target as LeafletMarker).getLatLng();
                  place(p.lat, p.lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}
