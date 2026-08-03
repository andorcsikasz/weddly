// Leaflet map view of the supplier directory. Lazy-imported from SuppliersPage
// so the ~150KB leaflet bundle only ships when the user opens the Map tab.
//
// Two things the plain-dot version got wrong, both fixed here:
//
//   1. EVERY pin looked the same. The grid and list views already badge each
//      card with its category icon (CATEGORY_ICON), so the map reuses that same
//      map: a venue, a caterer and a DJ are now told apart at a glance without
//      opening a popup. The icon is portalled into the divIcon element rather
//      than rendered to an HTML string, so no react-dom/server ships in this
//      chunk and the glyph keeps its Tailwind classes.
//   2. Overlapping entries rendered as ONE dot with ONE popup, so the other
//      N-1 suppliers underneath were unreachable — worst where several share an
//      identical town-centre fallback coordinate (CITY_COORDS in
//      suppliers_data.ts), which stacked ~100 of them on one Budapest point.
//      Pins are now grouped per zoom level (PinLayer, no clustering plugin):
//      the marker carries a count badge, clicking a group that would separate
//      zooms into it, and a group that is one true coordinate opens a popup
//      listing everyone standing there.
//
// Entries with no coordinate at all still can't be drawn; the banner under the
// map says how many, and the list view always has the full directory.

import { pickListingBlurb } from "@shared/listing_language";
import type { DirectorySupplier } from "@shared/suppliers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowRight, Bookmark, BookmarkCheck, Heart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { categoryIcon } from "../lib/category_icons";
import { useT } from "../lib/i18n";
import type { SelectionMap } from "../lib/supplier_selection";
import { safeExternalHref } from "../lib/url";

type PlacedSupplier = DirectorySupplier & { lat: number; lng: number };

/** Save (heart) + pick (bookmark) wiring, threaded down from SuppliersPage so
 *  the map popup carries the same affordances as the grid/list cards. */
interface CardActions {
  saved: Set<string>;
  selection: SelectionMap;
  onToggleSave: (id: string) => void;
  onTogglePick: (s: DirectorySupplier) => void;
}

/** Suppliers close enough at the CURRENT zoom to share one marker. */
interface PinGroup {
  key: string;
  lat: number;
  lng: number;
  items: PlacedSupplier[];
}

const HUNGARY_CENTER: [number, number] = [47.16, 19.51];
// Generous edge padding so the outermost pins never sit on the border of the
// viewport, and a maxZoom cap so a tight cluster (or a single pin) doesn't
// land at street level where the rest of the country falls off-screen.
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [48, 48], maxZoom: 13 };

// Marker footprint in pixels. The grouping cell is sized so two markers in
// different cells can't cover each other at the current zoom.
const PIN_PX = 34;
// Web-mercator tiles are 256px wide at zoom 0, so one degree of longitude is
// `256 * 2^zoom / 360` pixels. Inverting that for a PIN_PX-wide cell gives the
// cell size in degrees; at country zoom that is tens of kilometres, at street
// zoom a few hundred metres.
function cellDegreesForZoom(zoom: number): number {
  return (PIN_PX * 360) / (256 * 2 ** zoom);
}

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

export default function SupplierMap({
  suppliers,
  saved,
  selection,
  onToggleSave,
  onTogglePick,
}: { suppliers: DirectorySupplier[] } & CardActions) {
  const { t } = useT();
  const actions: CardActions = { saved, selection, onToggleSave, onTogglePick };

  const placed = useMemo(
    () =>
      suppliers.filter(
        (s): s is PlacedSupplier => typeof s.lat === "number" && typeof s.lng === "number",
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
        <FitToPins pins={placed} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <PinLayer placed={placed} actions={actions} />
      </MapContainer>
      {suppliers.length > placed.length && (
        <p className="border-t border-paper-200 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-4 py-2 text-xs text-ink-500 dark:text-umber-300">
          {t("suppliers.map_missing_count", { n: suppliers.length - placed.length })}
        </p>
      )}
    </div>
  );
}

/** Groups the pins for the zoom the user is actually looking at, so a country
 *  view shows one marker per town instead of a hundred overlapping ones, and
 *  zooming in splits them apart again. Cheap enough to do in render: the whole
 *  directory is a few hundred points, and it saves pulling in a clustering
 *  plugin for the one screen that needs it. */
function PinLayer({ placed, actions }: { placed: PlacedSupplier[]; actions: CardActions }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const groups = useMemo(() => {
    const cell = cellDegreesForZoom(zoom);
    const byCell = new Map<string, PlacedSupplier[]>();
    for (const s of placed) {
      const key = `${Math.floor(s.lat / cell)}:${Math.floor(s.lng / cell)}`;
      const hit = byCell.get(key);
      if (hit) hit.push(s);
      else byCell.set(key, [s]);
    }
    return [...byCell.entries()].map(([key, items]): PinGroup => {
      // Sit the marker on the members' mean, so a town's pin lands among its
      // suppliers rather than on an arbitrary cell corner.
      const lat = items.reduce((a, s) => a + s.lat, 0) / items.length;
      const lng = items.reduce((a, s) => a + s.lng, 0) / items.length;
      return { key, lat, lng, items };
    });
  }, [placed, zoom]);

  const canZoomFurther = zoom < map.getMaxZoom();
  return (
    <>
      {groups.map((g) => (
        <SupplierPin
          key={g.key}
          group={g}
          actions={actions}
          // A group whose members sit on DIFFERENT coordinates splits apart if
          // the user zooms in, so clicking it zooms (the cluster convention)
          // instead of dumping a hundred names into a popup. A group that is
          // one true coordinate — the town-level entries that never separate,
          // however far you zoom — opens the list, because that list is the
          // only way to reach those suppliers from the map.
          expandable={canZoomFurther && new Set(g.items.map((s) => `${s.lat},${s.lng}`)).size > 1}
        />
      ))}
    </>
  );
}

/** One marker: the category glyph of what stands there, plus a count badge when
 *  several suppliers share the spot. */
function SupplierPin({
  group,
  expandable,
  actions,
}: { group: PinGroup; expandable: boolean; actions: CardActions }) {
  const { t } = useT();
  const map = useMap();
  const first = group.items[0];
  const count = group.items.length;

  // A stable host element per marker, handed to Leaflet as the divIcon body and
  // filled by the portal below. Leaflet moves the element into the marker pane
  // with its React-rendered children intact.
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "relative flex h-[30px] w-[30px] items-center justify-center";
    return el;
  });
  const icon = useMemo(
    () =>
      L.divIcon({
        html: host,
        // Overrides Leaflet's default `leaflet-div-icon` white box.
        className: "supplier-pin",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16],
      }),
    [host],
  );

  if (!first) return null;
  const Glyph = categoryIcon(
    // A mixed-category stack (a town centre with a florist and a DJ on it) has
    // no single true glyph, so it falls back to the neutral one.
    group.items.every((s) => s.category === first.category) ? first.category : "other",
  );
  const title = count > 1 ? t("suppliers.map_group_count", { n: count }) : first.name;

  return (
    <>
      {createPortal(
        <>
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-paper-50 bg-ink-700 text-paper-50 shadow-sm transition-colors hover:bg-blush-600">
            <Glyph size={14} strokeWidth={2} aria-hidden />
          </span>
          {count > 1 && (
            <span className="pointer-events-none absolute -right-1.5 -top-1.5 min-w-[17px] rounded-full border border-paper-50 bg-blush-600 px-1 text-center text-[10px] font-semibold leading-[15px] text-paper-50">
              {count}
            </span>
          )}
        </>,
        host,
      )}
      <Marker
        position={[group.lat, group.lng]}
        icon={icon}
        title={title}
        riseOnHover
        eventHandlers={
          expandable
            ? {
                click: () =>
                  map.fitBounds(
                    L.latLngBounds(group.items.map((s) => [s.lat, s.lng] as [number, number])),
                    { padding: [56, 56], maxZoom: 16 },
                  ),
              }
            : undefined
        }
      >
        {expandable ? null : (
          <Popup>
            {count === 1 ? (
              <SupplierPopupCard supplier={first} actions={actions} />
            ) : (
              <div className="max-h-64 w-60 overflow-y-auto pr-1">
                <p className="pb-1 text-xs font-semibold text-ink-900">
                  {t("suppliers.map_group_count", { n: count })}
                </p>
                <ul className="divide-y divide-paper-200">
                  {group.items.map((s) => (
                    <li key={s.id} className="py-2">
                      <SupplierPopupCard supplier={s} actions={actions} compact />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Popup>
        )}
      </Marker>
    </>
  );
}

/** Popup body for one supplier. `compact` drops the blurb so a stack of ten
 *  stays scannable. */
function SupplierPopupCard({
  supplier: s,
  actions,
  compact = false,
}: {
  supplier: PlacedSupplier;
  actions: CardActions;
  compact?: boolean;
}) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const isSaved = actions.saved.has(s.id);
  const isPicked = actions.selection[s.category] === s.id;
  const priceBand = typeof s.price_band === "number" ? s.price_band : 0;
  const openProfile = () => navigate(`/app/suppliers/${encodeURIComponent(s.id)}`);

  return (
    <div className={compact ? "w-full" : "w-64"}>
      {/* Title row: the name is the tap target for the vendor's Weddly page
          (the arrow hints it), with save (heart) + pick (bookmark) on the right. */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={openProfile}
          className="group -m-1 min-w-0 flex-1 rounded p-1 text-left"
        >
          <span className="flex items-center gap-1 font-semibold text-ink-900">
            <span className="truncate group-hover:underline">{s.name}</span>
            <ArrowRight
              size={13}
              aria-hidden
              className="shrink-0 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700"
            />
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => actions.onToggleSave(s.id)}
            aria-pressed={isSaved}
            aria-label={t(isSaved ? "suppliers.unsave_aria" : "suppliers.save_aria")}
            title={t(isSaved ? "suppliers.unsave_aria" : "suppliers.save_aria")}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-600"
          >
            <Heart
              size={15}
              aria-hidden
              className={isSaved ? "fill-blush-500 text-blush-500" : ""}
            />
          </button>
          <button
            type="button"
            onClick={() => actions.onTogglePick(s)}
            aria-pressed={isPicked}
            aria-label={t(isPicked ? "suppliers.unpick_aria" : "suppliers.pick_aria")}
            title={t(isPicked ? "suppliers.unpick_aria" : "suppliers.pick_aria")}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-sage-700"
          >
            {isPicked ? (
              <BookmarkCheck size={15} aria-hidden className="fill-sage-200 text-sage-700" />
            ) : (
              <Bookmark size={15} aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Meta: category · city · price band ($). Rating slots in here once the
          directory payload carries it. */}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
        <span>{t(`suppliers.cat.${s.category}`)}</span>
        <span aria-hidden className="text-paper-400">
          ·
        </span>
        <span>{s.city}</span>
        {priceBand > 0 && (
          <>
            <span aria-hidden className="text-paper-400">
              ·
            </span>
            <span className="font-mono text-ink-600" title={t("suppliers.price_legend")}>
              {"$".repeat(priceBand)}
            </span>
          </>
        )}
      </p>

      {!compact && s.address && <p className="mt-1 text-xs text-ink-400">{s.address}</p>}
      {!compact && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-700">
          {pickListingBlurb(s, locale)}
        </p>
      )}

      {s.website && (
        <a
          href={safeExternalHref(s.website)}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block text-xs font-medium text-ink-500 hover:text-ink-900"
        >
          {t("suppliers.visit_website")} ↗
        </a>
      )}
    </div>
  );
}
