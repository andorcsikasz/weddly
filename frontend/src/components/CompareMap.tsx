// The comparison's location map. Lazy-imported from SupplierCompareDialog so
// leaflet only ships when a couple actually clicks a city. Deliberately NOT
// the directory's SupplierMap: that one is a full-viewport browse surface with
// save/pick popups and per-zoom grouping, and none of that belongs inside a
// dialog answering one question, "where are these places relative to each
// other (and to our venue)?".
//
// Every compared supplier with a coordinate is a dot; the one the couple
// clicked is the solid black dot with its name beside it, the rest are grey
// until hovered. Pins are SVG CircleMarkers coloured by Tailwind classes, so
// the palette stays on the design tokens rather than leaflet's default blue.

import type { DirectorySupplier } from "@shared/suppliers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";

type Placed = DirectorySupplier & { lat: number; lng: number };

const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? "").trim();
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${
  CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : ""
}`;
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
// One pin alone must not land at street level, where the town it is in falls
// off the edge of a 260px-tall map.
const FIT_MAX_ZOOM = 12;

/** Frames every pin once, then glides to whichever one is selected without
 *  zooming, so switching between suppliers never throws away the overview. */
function Framing({ points, active }: { points: [number, number][]; active: Placed | null }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: FIT_MAX_ZOOM });
  }, [map, key]);
  // Glide to the newly selected pin at the current zoom: a visible move is what
  // tells the couple the map followed their click, and keeping the zoom keeps
  // the neighbours on screen.
  const activeKey = active ? `${active.id}` : "";
  const first = useRef(true);
  useEffect(() => {
    if (!active) return;
    // The opening frame is fitBounds' job; centring on top of it would undo it.
    if (first.current) {
      first.current = false;
      return;
    }
    map.panTo([active.lat, active.lng], { animate: true, duration: 0.5 });
  }, [map, activeKey]);
  return null;
}

export default function CompareMap({
  suppliers,
  activeId,
  onSelect,
  venue,
  venueLabel,
}: {
  suppliers: DirectorySupplier[];
  activeId: string;
  onSelect: (id: string) => void;
  venue: { lat: number | null; lng: number | null };
  venueLabel: string;
}) {
  const placed = useMemo(
    () => suppliers.filter((s): s is Placed => s.lat !== null && s.lng !== null),
    [suppliers],
  );
  const venuePoint: [number, number] | null =
    venue.lat !== null && venue.lng !== null ? [venue.lat, venue.lng] : null;
  const points = useMemo(() => {
    const out = placed.map((s) => [s.lat, s.lng] as [number, number]);
    if (venuePoint) out.push(venuePoint);
    return out;
  }, [placed, venuePoint]);
  const active = placed.find((s) => s.id === activeId) ?? null;
  // Draw the active pin LAST so it sits above any neighbour it overlaps.
  const ordered = [...placed.filter((s) => s.id !== activeId), ...(active ? [active] : [])];

  return (
    <MapContainer
      center={active ? [active.lat, active.lng] : [47.16, 19.51]}
      zoom={8}
      scrollWheelZoom={false}
      attributionControl
      className="h-full w-full"
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <Framing points={points} active={active} />
      {venuePoint && (
        <CircleMarker
          center={venuePoint}
          radius={8}
          pathOptions={{
            className: "fill-sage-600 stroke-white",
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            {venueLabel}
          </Tooltip>
        </CircleMarker>
      )}
      {ordered.map((s) => {
        const isActive = s.id === activeId;
        return (
          <CircleMarker
            // Remount on activation so the permanent tooltip toggles cleanly.
            key={`${s.id}-${isActive ? "on" : "off"}`}
            center={[s.lat, s.lng]}
            radius={isActive ? 9 : 6}
            pathOptions={{
              className: isActive
                ? "fill-ink-900 stroke-white cursor-pointer"
                : "fill-ink-300 stroke-white cursor-pointer",
              fillOpacity: 1,
              weight: isActive ? 3 : 2,
            }}
            eventHandlers={{ click: () => onSelect(s.id) }}
          >
            <Tooltip
              permanent={isActive}
              direction="right"
              offset={[isActive ? 10 : 7, 0]}
              className="!rounded-lg !border-0 !px-2 !py-1 !text-xs !font-semibold !shadow-soft"
            >
              {s.name}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
