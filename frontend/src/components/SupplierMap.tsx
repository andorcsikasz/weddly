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
// Entries with no coordinate at all still can't be drawn; the note at the foot
// of the map says how many, and the list view always has the full directory.
//
// Since 2026-09-29 it reads like Google Maps: the map fills the viewport and the
// page's own search bar + filter chips FLOAT over its top edge (SuppliersPage
// owns those; `topInset` tells the fit how much of the map they cover), zoom +
// "my location" sit bottom-right, the wheel zooms, single suppliers are
// teardrop pins with their name beside them once zoomed in, and a group is a
// round count bubble. Basemap is CARTO Voyager (Google-like, Latin labels),
// whose host is already in the CSP img-src. No satellite layer, by owner call.

import { pickListingBlurb } from "@shared/listing_language";
import type { DirectorySupplier } from "@shared/suppliers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowRight, Bookmark, BookmarkCheck, Heart, LocateFixed, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { categoryIcon } from "../lib/category_icons";
import { geoApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import type { SelectionMap } from "../lib/supplier_selection";
import { safeExternalHref } from "../lib/url";
import { Button, Dialog, useToast } from "./ui";

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
// A single pin (or a tight cluster) must not land at street level where the
// rest of the country falls off-screen.
const FIT_MAX_ZOOM = 13;
// Past this zoom a lone pin carries its name beside it, the way Google labels
// places once there is room. Below it the labels would pile into each other.
const LABEL_MIN_ZOOM = 11;

const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY ?? "").trim();
const CARTO_KEY_QS = CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : "";
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${CARTO_KEY_QS}`;
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Grouping cell in screen pixels. Wider than a marker on purpose: a bubble is
// up to 50px across, and cells sized to the pin left a country view as a wall
// of touching bubbles. At ~64px the map reads as a handful of towns, the way
// Google's clusters do, and zooming in still splits them apart.
const CLUSTER_PX = 64;
// Web-mercator tiles are 256px wide at zoom 0, so one degree of longitude is
// `256 * 2^zoom / 360` pixels. Inverting that for a CLUSTER_PX-wide cell gives
// the cell size in degrees; at country zoom that is tens of kilometres, at
// street zoom a few hundred metres.
function cellDegreesForZoom(zoom: number): number {
  return (CLUSTER_PX * 360) / (256 * 2 ** zoom);
}

// Re-fits the map whenever the visible pin set changes. MapContainer's `bounds`
// prop is read once on construction, so without this child the map keeps the
// initial framing after the user tightens filters and stays zoomed out over a
// lot of irrelevant area. The top padding clears the floating search chrome.
function FitToPins({ pins, topInset }: { pins: { lat: number; lng: number }[]; topInset: number }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) {
      map.setView(HUNGARY_CENTER, 7);
      return;
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, {
      paddingTopLeft: [48, topInset + 32],
      paddingBottomRight: [72, 48],
      maxZoom: FIT_MAX_ZOOM,
    });
  }, [map, pins, topInset]);
  return null;
}

export default function SupplierMap({
  suppliers,
  saved,
  selection,
  onToggleSave,
  onTogglePick,
  topInset = 0,
  className = "",
}: {
  suppliers: DirectorySupplier[];
  /** Pixels of the map's top edge covered by floating page chrome. */
  topInset?: number;
  className?: string;
} & CardActions) {
  const { t } = useT();
  const actions: CardActions = { saved, selection, onToggleSave, onTogglePick };

  const placed = useMemo(
    () =>
      suppliers.filter(
        (s): s is PlacedSupplier => typeof s.lat === "number" && typeof s.lng === "number",
      ),
    [suppliers],
  );
  const missing = suppliers.length - placed.length;

  return (
    <div
      className={`supplier-map relative overflow-hidden bg-paper-200 dark:bg-umber-800 ${className}`}
    >
      <MapContainer
        center={HUNGARY_CENTER}
        zoom={7}
        zoomControl={false}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <FitToPins pins={placed} topInset={topInset} />
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <PinLayer placed={placed} actions={actions} topInset={topInset} />
        <MapControls />
      </MapContainer>

      {missing > 0 && (
        <p className="pointer-events-none absolute bottom-6 left-1/2 z-[500] -translate-x-1/2 whitespace-nowrap rounded-full bg-paper-50/95 px-3 py-1 text-xs text-ink-600 shadow-soft dark:bg-umber-800/95 dark:text-umber-200">
          {t("suppliers.map_missing_count", { n: missing })}
        </p>
      )}
    </div>
  );
}

/** Zoom + "my location", bottom-right, drawn as Google's white rounded cards
 *  rather than Leaflet's square top-left bar. */
function MapControls() {
  const { t } = useT();
  const toast = useToast();
  const map = useMap();
  const [me, setMe] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);

  // Leaflet's own handlers would also receive the click and double-click-zoom
  // or drag the map, so the control panel swallows them at the DOM level.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!panel) return;
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
  }, [panel]);

  // The browser's own permission prompt is the only thing that can grant
  // location, and it appears with no context the moment getCurrentPosition
  // runs. So a first tap explains first ("ask"), and a blocked permission,
  // which the browser will never prompt for again, gets instructions instead
  // of a vague failure toast ("denied").
  const [prompt, setPrompt] = useState<"ask" | "denied" | null>(null);

  const requestPosition = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setMe(here);
        map.flyTo(here, Math.max(map.getZoom(), 11));
        // Usage analytics: best-effort, and never allowed to disturb the map.
        geoApi.mapLocate(here[0], here[1]).catch(() => {});
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) setPrompt("denied");
        else toast.error(t("suppliers.map_locate_failed"));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const locate = async () => {
    if (!("geolocation" in navigator)) {
      toast.error(t("suppliers.map_locate_failed"));
      return;
    }
    // Safari before 16 has no Permissions API; treat it as "not yet asked",
    // which costs at most one extra explanation.
    let state: PermissionState | "unknown" = "unknown";
    try {
      state = (await navigator.permissions?.query({ name: "geolocation" }))?.state ?? "unknown";
    } catch {
      state = "unknown";
    }
    if (state === "granted") requestPosition();
    else if (state === "denied") setPrompt("denied");
    else setPrompt("ask");
  };

  const btn =
    "grid h-10 w-10 place-items-center text-ink-700 transition hover:bg-paper-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500";
  return (
    <>
      {me && (
        <>
          <CircleMarker
            center={me}
            radius={18}
            pathOptions={{ stroke: false, fillColor: "#4285f4", fillOpacity: 0.15 }}
            interactive={false}
          />
          <CircleMarker
            center={me}
            radius={7}
            pathOptions={{ color: "#ffffff", weight: 2.5, fillColor: "#4285f4", fillOpacity: 1 }}
            interactive={false}
          />
        </>
      )}
      <Dialog
        open={prompt === "ask"}
        role="dialog"
        closeOnBackdrop
        onClose={() => setPrompt(null)}
        title={t("suppliers.map_locate_ask_title")}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              {t("suppliers.map_locate_ask_later")}
            </Button>
            <Button
              onClick={() => {
                setPrompt(null);
                requestPosition();
              }}
            >
              {t("suppliers.map_locate_ask_continue")}
            </Button>
          </div>
        }
      >
        <div className="flex gap-3">
          <LocateFixed
            size={22}
            strokeWidth={1.5}
            aria-hidden
            className="mt-0.5 shrink-0 text-ink-600 dark:text-umber-200"
          />
          <div className="space-y-2">
            <p>{t("suppliers.map_locate_ask_body")}</p>
            <p className="text-xs text-ink-500 dark:text-umber-300">
              {t("suppliers.map_locate_ask_privacy")}
            </p>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={prompt === "denied"}
        role="dialog"
        closeOnBackdrop
        onClose={() => setPrompt(null)}
        title={t("suppliers.map_locate_denied_title")}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setPrompt(null)}>{t("suppliers.map_locate_denied_ok")}</Button>
          </div>
        }
      >
        <p>{t("suppliers.map_locate_denied_body")}</p>
      </Dialog>
      <div
        ref={setPanel}
        className="leaflet-bottom leaflet-right !bottom-7 !right-3 flex flex-col items-end gap-2 sm:!right-4"
        style={{ pointerEvents: "auto" }}
      >
        <button
          type="button"
          onClick={locate}
          aria-label={t("suppliers.map_locate")}
          title={t("suppliers.map_locate")}
          className={`${btn} rounded-full bg-paper-50 shadow-pop ${locating ? "animate-pulse" : ""} ${me ? "text-verified" : ""}`}
        >
          <LocateFixed size={18} aria-hidden />
        </button>
        <div className="flex flex-col overflow-hidden rounded-xl bg-paper-50 shadow-pop">
          <button
            type="button"
            onClick={() => map.zoomIn()}
            aria-label={t("suppliers.map_zoom_in")}
            title={t("suppliers.map_zoom_in")}
            className={btn}
          >
            <Plus size={18} aria-hidden />
          </button>
          <span className="mx-2 h-px bg-paper-200" aria-hidden />
          <button
            type="button"
            onClick={() => map.zoomOut()}
            aria-label={t("suppliers.map_zoom_out")}
            title={t("suppliers.map_zoom_out")}
            className={btn}
          >
            <Minus size={18} aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
}

/** Groups the pins for the zoom the user is actually looking at, so a country
 *  view shows one marker per town instead of a hundred overlapping ones, and
 *  zooming in splits them apart again. Cheap enough to do in render: the whole
 *  directory is a few hundred points, and it saves pulling in a clustering
 *  plugin for the one screen that needs it. */
function PinLayer({
  placed,
  actions,
  topInset,
}: { placed: PlacedSupplier[]; actions: CardActions; topInset: number }) {
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
          showLabel={zoom >= LABEL_MIN_ZOOM}
          topInset={topInset}
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

/** One marker. A lone supplier is a Google-style teardrop carrying its
 *  category glyph (sage once picked, blush once saved) and, zoomed in, its
 *  name; a group is a round bubble with the count in it, growing with size. */
function SupplierPin({
  group,
  expandable,
  showLabel,
  topInset,
  actions,
}: {
  group: PinGroup;
  expandable: boolean;
  showLabel: boolean;
  topInset: number;
  actions: CardActions;
}) {
  const { t } = useT();
  const map = useMap();
  const first = group.items[0];
  const count = group.items.length;
  const isGroup = count > 1;
  const bubble = count >= 100 ? 50 : count >= 20 ? 44 : count >= 5 ? 38 : 34;

  // A stable host element per marker, handed to Leaflet as the divIcon body and
  // filled by the portal below. Leaflet moves the element into the marker pane
  // with its React-rendered children intact.
  const [host] = useState(() => document.createElement("div"));
  const icon = useMemo(() => {
    host.className = "relative";
    return L.divIcon({
      html: host,
      // Overrides Leaflet's default `leaflet-div-icon` white box.
      className: "supplier-pin",
      ...(isGroup
        ? {
            iconSize: [bubble, bubble],
            iconAnchor: [bubble / 2, bubble / 2],
            popupAnchor: [0, -bubble / 2],
          }
        : // The teardrop's tip sits ~34px below the top of its 30x38 box.
          { iconSize: [30, 38], iconAnchor: [15, 34], popupAnchor: [0, -34] }),
    });
  }, [host, isGroup, bubble]);

  if (!first) return null;
  const title = isGroup ? t("suppliers.map_group_count", { n: count }) : first.name;
  const Glyph = categoryIcon(first.category);
  const tone =
    actions.selection[first.category] === first.id
      ? "bg-sage-600"
      : actions.saved.has(first.id)
        ? "bg-blush-600"
        : "bg-ink-800";

  return (
    <>
      {createPortal(
        isGroup ? (
          <span
            style={{ width: bubble, height: bubble }}
            className="flex items-center justify-center rounded-full border-[3px] border-paper-50 bg-ink-800 text-[13px] font-semibold tabular-nums text-paper-50 shadow-[0_2px_6px_rgba(16,24,48,0.35)] ring-4 ring-ink-800/20 transition-transform hover:scale-110"
          >
            {count > 999 ? "999+" : count}
          </span>
        ) : (
          <>
            <span
              className={`absolute left-px top-0 flex h-7 w-7 rotate-45 items-center justify-center rounded-full rounded-br-none border-2 border-paper-50 ${tone} text-paper-50 shadow-[0_2px_5px_rgba(16,24,48,0.35)] transition-transform hover:scale-110`}
            >
              <Glyph size={13} strokeWidth={2.25} aria-hidden className="-rotate-45" />
            </span>
            {showLabel && (
              <span className="supplier-pin-label absolute left-[33px] top-[5px] max-w-[11rem] truncate text-xs font-semibold text-ink-900">
                {first.name}
              </span>
            )}
          </>
        ),
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
                    { padding: [72, 72], maxZoom: 16 },
                  ),
              }
            : undefined
        }
      >
        {expandable ? null : (
          <Popup
            className="supplier-popup"
            minWidth={isGroup ? 256 : 272}
            maxWidth={288}
            // Pan the card clear of the search chrome floating over the top.
            autoPanPaddingTopLeft={[16, topInset + 16]}
            autoPanPaddingBottomRight={[72, 24]}
          >
            {count === 1 ? (
              <SupplierPopupCard supplier={first} actions={actions} />
            ) : (
              <div className="max-h-72 w-64 overflow-y-auto px-3 py-2">
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
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="w-full">
      {/* Google's place card leads with a photo; ours does when the listing
          has one, and the name doubles as the way into the profile. */}
      {!compact && s.hero_image_url && !imgFailed && (
        <button
          type="button"
          onClick={openProfile}
          tabIndex={-1}
          aria-hidden
          className="block h-32 w-full overflow-hidden bg-paper-200"
        >
          <img
            src={s.hero_image_url}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        </button>
      )}
      <div className={compact ? "" : "px-3.5 pb-3 pt-2.5"}>
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
    </div>
  );
}
