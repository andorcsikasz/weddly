// Interactive Leaflet map for TownMapModal: it opens framed around the towns
// it is handed, then behaves like a normal map — visitors can pan and zoom by
// mouse, touch or keyboard. Real OSM tiles (the same server SupplierMap.tsx
// already hits) rather than a hand-drawn country outline, so a new market added
// to the directory needs no new art: the towns it comes with just place
// themselves correctly.
//
// Lazy-imported from TownMapModal, matching the PinnedMap / SupplierMap
// pattern, so the ~150KB leaflet bundle only ships once the modal opens.

import { countryName } from "@shared/country_list";
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

export interface PlacedCountry {
  code: string;
  count: number;
  lat: number;
  lng: number;
}

// Hungary, same default SupplierMap.tsx opens on — only reached if `towns`
// somehow arrives empty, which the modal already guards against.
const FALLBACK_CENTER: [number, number] = [47.16, 19.51];
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [36, 36], maxZoom: 10 };

/** Frames whatever pins are on screen — towns within a country, or one pin
 *  per country continent-wide — on mount and whenever the SET changes (a
 *  category filter narrowing it, or the modal drilling into a country).
 *  After that initial framing, the visitor owns the viewport. Generic over
 *  `{lat,lng}` so both TownPin and CountryPin arrays fit it as-is. */
function FitToPins({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      const only = points[0];
      if (!only) return;
      map.setView([only.lat, only.lng], FIT_OPTIONS.maxZoom ?? 10);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, FIT_OPTIONS);
    // Deliberately only re-runs if the SET changes, not on every render:
    // `map` is stable and `points` is a caller-owned array this modal never
    // mutates in place.
  }, [map, points]);
  return null;
}

type TownMapProps =
  | {
      mode?: "town";
      towns: PlacedTown[];
      /** When the directory is filtered, every town marker represents suppliers
       *  in that category, so it uses the same glyph as their cards. */
      category: SupplierCategory | null;
      /** Fires with the town name; the caller (TownMapModal) applies the filter
       *  and closes the modal. */
      onSelect: (city: string) => void;
    }
  | {
      mode: "country";
      countries: PlacedCountry[];
      /** Fires with the ISO code; the caller (TownMapModal) applies the
       *  country filter and drills the map into that country's towns instead
       *  of closing. */
      onSelect: (code: string) => void;
    };

export default function TownMap(props: TownMapProps) {
  const points = props.mode === "country" ? props.countries : props.towns;
  return (
    <MapContainer
      center={FALLBACK_CENTER}
      zoom={props.mode === "country" ? 4 : 7}
      dragging
      zoomControl
      scrollWheelZoom
      doubleClickZoom
      touchZoom
      boxZoom
      keyboard
      style={{ height: "100%", width: "100%" }}
    >
      <FitToPins points={points} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {props.mode === "country" ? (
        <ClusteredCountryPins countries={props.countries} onSelect={props.onSelect} />
      ) : (
        <ClusteredTownPins
          towns={props.towns}
          category={props.category}
          onSelect={props.onSelect}
        />
      )}
    </MapContainer>
  );
}

/** Groups points that land within `gridPx` of each other AT THE CURRENT ZOOM
 *  into one cluster, re-run on every 'zoomend' — the same idea
 *  leaflet.markercluster runs, hand-rolled because the app already carries
 *  its own map primitives and a few hundred points is cheap to re-bucket.
 *  Reached for once the directory had enough small towns close together
 *  (rural Hungary, four countries meeting near one border) that their pins
 *  piled into an unreadable stack of overlapping circles — a real visitor
 *  complaint, not a hypothetical. Panning does NOT re-cluster: `map.project`
 *  gives absolute pixel coordinates for a given zoom, independent of the
 *  current viewport, so a cluster's membership only changes when the zoom
 *  that defines its grid does. */
function useClusters<T extends { lat: number; lng: number }>(
  map: L.Map,
  points: T[],
  gridPx = 44,
): { key: string; lat: number; lng: number; items: T[] }[] {
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    function onZoom() {
      setZoom(map.getZoom());
    }
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
    };
  }, [map]);

  return useMemo(() => {
    const cells = new Map<string, { key: string; lat: number; lng: number; items: T[] }>();
    for (const p of points) {
      const px = map.project([p.lat, p.lng], zoom);
      const key = `${Math.floor(px.x / gridPx)}:${Math.floor(px.y / gridPx)}`;
      const existing = cells.get(key);
      if (existing) {
        // Running mean, so the cluster marker sits at the centroid of what it
        // is hiding rather than at whichever point happened to start the
        // bucket.
        const n = existing.items.length;
        existing.lat += (p.lat - existing.lat) / (n + 1);
        existing.lng += (p.lng - existing.lng) / (n + 1);
        existing.items.push(p);
      } else {
        cells.set(key, { key, lat: p.lat, lng: p.lng, items: [p] });
      }
    }
    return [...cells.values()];
  }, [points, zoom, map, gridPx]);
}

function ClusteredTownPins({
  towns,
  category,
  onSelect,
}: {
  towns: PlacedTown[];
  category: SupplierCategory | null;
  onSelect: (city: string) => void;
}) {
  const map = useMap();
  const groups = useClusters(map, towns);
  return (
    <>
      {groups.map((g) => {
        const only = g.items.length === 1 ? g.items[0] : undefined;
        return only ? (
          <TownPin key={g.key} town={only} category={category} onSelect={onSelect} />
        ) : (
          <ClusterPin
            key={g.key}
            lat={g.lat}
            lng={g.lng}
            size={g.items.length}
            onClick={() => map.setView([g.lat, g.lng], Math.min(map.getZoom() + 3, 15))}
          />
        );
      })}
    </>
  );
}

function ClusteredCountryPins({
  countries,
  onSelect,
}: {
  countries: PlacedCountry[];
  onSelect: (code: string) => void;
}) {
  const map = useMap();
  const groups = useClusters(map, countries);
  return (
    <>
      {groups.map((g) => {
        const only = g.items.length === 1 ? g.items[0] : undefined;
        return only ? (
          <CountryPin key={g.key} country={only} onSelect={onSelect} />
        ) : (
          <ClusterPin
            key={g.key}
            lat={g.lat}
            lng={g.lng}
            size={g.items.length}
            onClick={() => map.setView([g.lat, g.lng], Math.min(map.getZoom() + 2, 7))}
          />
        );
      })}
    </>
  );
}

/** A cluster's own marker: the same round-badge family as TownPin/CountryPin,
 *  a size up, labelled with how many pins it is hiding rather than a glyph —
 *  there is no one icon for "several of these". Clicking zooms the map in on
 *  the cluster's centroid rather than picking anything, since a cluster does
 *  not correspond to one town or country to select. */
function ClusterPin({
  lat,
  lng,
  size,
  onClick,
}: {
  lat: number;
  lng: number;
  size: number;
  onClick: () => void;
}) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "relative flex h-[40px] w-[40px] items-center justify-center";
    return el;
  });
  const icon = useMemo(
    () =>
      L.divIcon({
        html: host,
        className: "supplier-pin",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    [host],
  );

  return (
    <>
      {createPortal(
        <span className="grid h-[40px] w-[40px] cursor-pointer place-items-center rounded-full border-2 border-paper-50 bg-ink-800 text-[13px] font-bold tabular-nums text-paper-50 shadow-sm transition-colors hover:bg-blush-600">
          {size}
        </span>,
        host,
      )}
      <Marker position={[lat, lng]} icon={icon} eventHandlers={{ click: onClick }} />
    </>
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

/** One country, collapsing every town inside it into a single marker so the
 *  continent-wide view stays readable. Same round-badge family as TownPin,
 *  a size up and labelled with the ISO code rather than a category glyph —
 *  there is no one glyph for "this whole country's directory". */
function CountryPin({
  country,
  onSelect,
}: {
  country: PlacedCountry;
  onSelect: (code: string) => void;
}) {
  const { t, locale } = useT();
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "relative flex h-[38px] w-[38px] items-center justify-center";
    return el;
  });
  const icon = useMemo(
    () =>
      L.divIcon({
        html: host,
        className: "supplier-pin",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    [host],
  );
  const label = countryName(country.code, locale === "hu" ? "hu" : "en");

  return (
    <>
      {createPortal(
        <span className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-full border-2 border-paper-50 bg-ink-800 text-[11px] font-bold tracking-wide text-paper-50 shadow-sm transition-colors hover:bg-blush-600">
          {country.code}
        </span>,
        host,
      )}
      <Marker
        position={[country.lat, country.lng]}
        icon={icon}
        title={`${label} · ${t("vendorBrowse.results_count", { count: country.count })}`}
        eventHandlers={{ click: () => onSelect(country.code) }}
      />
    </>
  );
}
