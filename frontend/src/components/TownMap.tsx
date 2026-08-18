// Interactive Leaflet map for TownMapModal: it opens framed around the towns
// it is handed, then behaves like a normal map — visitors can pan and zoom by
// mouse, touch or keyboard. Real OSM tiles (the same server SupplierMap.tsx
// already hits) rather than a hand-drawn country outline, so a new market added
// to the directory needs no new art: the towns it comes with just place
// themselves correctly.
//
// Lazy-imported from TownMapModal, matching the PinnedMap / SupplierMap
// pattern, so the ~150KB leaflet bundle only ships once the modal opens.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SupplierCategory } from "@shared/suppliers";
import { MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { categoryIcon } from "../lib/category_icons";
import { useT } from "../lib/i18n";

export interface PlacedTown {
  city: string;
  count: number;
  lat: number;
  lng: number;
}

// Hungary, same default SupplierMap.tsx opens on — only reached if `towns`
// somehow arrives empty, which the modal already guards against.
const FALLBACK_CENTER: [number, number] = [47.16, 19.51];
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [36, 36], maxZoom: 10 };

/** Frames the towns on mount (and if the active category changes while the
 *  modal is open). After that initial framing, the visitor owns the viewport. */
function FitToTowns({ towns }: { towns: PlacedTown[] }) {
  const map = useMap();
  useEffect(() => {
    if (towns.length === 0) return;
    if (towns.length === 1) {
      const only = towns[0];
      if (!only) return;
      map.setView([only.lat, only.lng], FIT_OPTIONS.maxZoom ?? 10);
      return;
    }
    const bounds = L.latLngBounds(towns.map((t) => [t.lat, t.lng] as [number, number]));
    map.fitBounds(bounds, FIT_OPTIONS);
    // Deliberately only re-runs if the SET of towns changes, not on every
    // render: `map` is stable and `towns` is a caller-owned array that this
    // modal never mutates in place.
  }, [map, towns]);
  return null;
}

export default function TownMap({
  towns,
  category,
  onSelect,
}: {
  towns: PlacedTown[];
  /** When the directory is filtered, every town marker represents suppliers
   *  in that category, so it uses the same glyph as their cards. */
  category: SupplierCategory | null;
  /** Fires with the town name; the caller (TownMapModal) applies the filter
   *  and closes the modal. */
  onSelect: (city: string) => void;
}) {
  return (
    <MapContainer
      center={FALLBACK_CENTER}
      zoom={7}
      dragging
      zoomControl
      scrollWheelZoom
      doubleClickZoom
      touchZoom
      boxZoom
      keyboard
      style={{ height: "100%", width: "100%" }}
    >
      <FitToTowns towns={towns} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {towns.map((t) => (
        <TownPin key={t.city} town={t} category={category} onSelect={onSelect} />
      ))}
    </MapContainer>
  );
}

/** One marker: a plain round badge, same footprint SupplierMap's pins use, so
 *  the two maps in the app read as one visual family. */
function TownPin({
  town,
  category,
  onSelect,
}: {
  town: PlacedTown;
  category: SupplierCategory | null;
  onSelect: (city: string) => void;
}) {
  const { t } = useT();
  const Glyph = category ? categoryIcon(category) : MapPin;
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "relative flex h-[30px] w-[30px] items-center justify-center";
    return el;
  });
  const icon = useMemo(
    () =>
      L.divIcon({
        html: host,
        className: "supplier-pin",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    [host],
  );

  return (
    <>
      {createPortal(
        <span className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-full border-2 border-paper-50 bg-ink-800 text-paper-50 shadow-sm transition-colors hover:bg-blush-600">
          <Glyph size={15} strokeWidth={2} aria-hidden />
        </span>,
        host,
      )}
      <Marker
        position={[town.lat, town.lng]}
        icon={icon}
        title={`${town.city} · ${t("vendorBrowse.results_count", { count: town.count })}`}
        eventHandlers={{ click: () => onSelect(town.city) }}
      />
    </>
  );
}
