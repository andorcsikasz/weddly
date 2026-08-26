// "Kulcsinfó" — a couple/organiser-facing quick-access card on the dashboard.
// Surfaces the two things people hunt for all through planning (not just on the
// day): the venue's map + phone, and one-tap dialling for booked suppliers.
//
// Deliberately a READ/aggregate surface with ZERO new data model, and read-only
// since 2026-08-01 (owner call): the pencil that opened an inline editor for the
// venue/coordinator/emergency fields is gone, so the card is purely glanceable.
// The venue is derived from what the couple already has — a picked directory
// venue (rich: address / phone / coords) or the free-text `venue_name` +
// `venue_city` fallback (name + an in-app geocoded map, no phone); the venue is
// SET on /app/guest-page, which is where the empty state points. Contacts reuse
// the same picks → suppliers merge that TimelinePage's "Kapcsolattartók" panel
// uses, so there is no second copy of the contact data. Everything is fetched
// from the existing /api/picks, /api/suppliers, /api/couple-suppliers endpoints.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { CouplePick } from "@shared/picks";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import type { Couple } from "@shared/types";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  MapPin,
  Phone,
  Plus,
  Siren,
  Store,
  UserRound,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { coupleSupplierApi, picksApi, supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { lazyWithReload } from "../lib/lazy_reload";
import { venueDetachedFromPick, venueVendorHref } from "../lib/venue_link";
import { Skeleton } from "./ui";

// Lazy so the OpenStreetMap embed bundle only loads when a couple opens the
// venue map. Reused verbatim from the supplier detail page so the in-app map
// reads identically here (no external Maps hand-off).
const SupplierMapModal = lazyWithReload(() => import("./SupplierMapModal"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Mirrors the category → icon map in TimelinePage's contact panel so the two
// surfaces read the same. Kept local (presentational constant) to keep this a
// surgical, self-contained addition.
import { CATEGORY_ICON } from "../lib/category_icons";

const MAX_CONTACTS = 4;
const STORAGE_KEY = "weddly.dashboard.keyinfo";

/** The collapse control. Open, it sits on the black cap and goes light-on-dark;
 *  collapsed, it sits on the card surface and keeps the usual ink treatment.
 *  Smaller when open, since that row's whole point is to be thin: a 24px target
 *  inside a 24px strip is what keeps the cap from growing back into a header.
 *  `transition-all` rather than `transition-colors` so the size step animates
 *  with the cap it sits on instead of snapping ahead of it. */
function headerIconClass(open: boolean): string {
  const base =
    "inline-flex shrink-0 items-center justify-center rounded-full transition-all duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100";
  return open
    ? `${base} h-6 w-6 text-paper-200 hover:bg-white/15 hover:text-white focus-visible:ring-paper-100`
    : `${base} h-8 w-8 text-ink-500 hover:bg-paper-100 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50`;
}

type VenueInfo = {
  name: string;
  /** Secondary line — street address if we have one, else the city/town. */
  detail: string | null;
  phone: string | null;
  /** In-app map modal inputs. Exact coordinates when a picked directory venue
   *  carries them; otherwise the modal geocodes `address` (falling back to the
   *  name) within `city`. */
  lat: number | null;
  lng: number | null;
  address: string | null;
  city: string;
  /** The directory vendor this row should link to (its detail page), or null
   *  to fall back to the vendors hub. Null when the venue is free-text OR when
   *  the couple renamed it away from a still-attached pick (see resolveVenue) —
   *  so a stale pick never lends its detail page to a differently-named venue. */
  linkedSupplierId: string | null;
};

type Contact = {
  key: string;
  id: string;
  name: string;
  category: SupplierCategory;
  phone: string | null;
  // Directory entries (curated + community) have a `/app/suppliers/:id` detail
  // page; DIY entries don't surface there, so their name stays non-clickable.
  linkable: boolean;
};

/** The venue + day-of contact fields the card reads off the couple, as a plain
 *  string form (empty string = unset). They are written elsewhere (the guest
 *  page editor / onboarding); this card only displays them. */
type VenueFields = {
  venue_name: string;
  venue_city: string;
  venue_address: string;
  venue_phone: string;
  coordinator_name: string;
  coordinator_phone: string;
  emergency_name: string;
  emergency_phone: string;
};

function pickFields(c: Couple): VenueFields {
  return {
    venue_name: c.venue_name ?? "",
    venue_city: c.venue_city ?? "",
    venue_address: c.venue_address ?? "",
    venue_phone: c.venue_phone ?? "",
    coordinator_name: c.coordinator_name ?? "",
    coordinator_phone: c.coordinator_phone ?? "",
    emergency_name: c.emergency_name ?? "",
    emergency_phone: c.emergency_phone ?? "",
  };
}

/** The picked directory venue (curated/community) behind the "venue" category
 *  pick, or undefined when the couple picked a DIY venue / nothing. */
function pickedVenueDir(
  venuePick: CouplePick | undefined,
  directoryById: Map<string, DirectorySupplier>,
): DirectorySupplier | undefined {
  return venuePick ? directoryById.get(venuePick.supplier_id) : undefined;
}

/** Merge the couple's manually-entered venue fields (highest priority, field by
 *  field) over the picked venue's derived details. Returns null when there's
 *  nothing to show a venue row for (card falls back to the set-venue CTA). The
 *  map query prefers a picked venue's exact coordinates, then a street address,
 *  then the name + city. */
function resolveVenue(
  f: VenueFields,
  venuePick: CouplePick | undefined,
  directoryById: Map<string, DirectorySupplier>,
  diyById: Map<string, CoupleSupplier>,
): VenueInfo | null {
  const picked = pickedVenueDir(venuePick, directoryById);
  const diy = venuePick && !picked ? diyById.get(venuePick.supplier_id) : undefined;

  // A manually-typed venue_name that differs from the still-attached directory
  // pick means the couple renamed / changed venues without re-picking. The old
  // vendor's phone, coordinates and detail page would then all point at the
  // wrong place, so we DETACH from the pick: the row behaves like a free-text
  // venue (typed values only, geocoded map, hub link). Name comparison is
  // diacritic-folded.
  const detachedFromPick = venueDetachedFromPick(f.venue_name, picked?.name);
  const effPicked = detachedFromPick ? undefined : picked;

  const name = f.venue_name || effPicked?.name || diy?.name || null;
  const address = f.venue_address || effPicked?.address || null;
  const city = f.venue_city || effPicked?.city || null;
  // The number rides on the PICK now, not on the catalogue row (see
  // `CouplePick.contact_phone`). Gated on `effPicked` so a couple who typed a
  // different venue name over their old pick doesn't keep dialling the old
  // vendor, which is the whole point of the detach above.
  const phone = f.venue_phone || (effPicked ? (venuePick?.contact_phone ?? null) : null) || null;

  if (!name && !address) return null;

  const primary = name ?? address ?? "";
  const secondary = name ? address || city : city;

  // Map modal inputs. When the couple typed their own address we trust it over
  // a picked pin (null coords → the modal geocodes the text). Otherwise a
  // picked directory venue's exact coordinates win; failing that we hand the
  // modal the best geocodable string (street address, or the name).
  const manualAddr = Boolean(f.venue_address);
  const lat = manualAddr ? null : (effPicked?.lat ?? null);
  const lng = manualAddr ? null : (effPicked?.lng ?? null);
  const mapAddress = f.venue_address || address || (lat === null ? name : null);
  return {
    name: primary,
    detail: secondary,
    phone,
    lat,
    lng,
    address: mapAddress,
    city: city ?? "",
    linkedSupplierId: effPicked?.id ?? null,
  };
}

export function KeyInfoCard({ couple }: { couple: Couple }) {
  const { t } = useT();

  const fields = useMemo(() => pickFields(couple), [couple]);
  // In-app venue map modal (replaces the old external Google Maps hand-off).
  const [mapOpen, setMapOpen] = useState(false);

  // Collapse state persists per browser so a couple who tucks it away keeps it
  // that way. Defaults to open (the panel is meant to be glanceable above fold).
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
  }, [open]);

  const [data, setData] = useState<{
    picks: CouplePick[];
    directory: DirectorySupplier[];
    diy: CoupleSupplier[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([picksApi.list(), supplierApi.list(), coupleSupplierApi.list()])
      .then(([p, d, m]) => {
        // Default every list so a thin/unexpected response can't make a later
        // `.find` / `for…of` throw during render.
        if (!cancelled) {
          setData({ picks: p.picks ?? [], directory: d.suppliers ?? [], diy: m.suppliers ?? [] });
        }
      })
      .catch(() => {
        // Degrade quietly: the card still shows the free-text venue + CTAs.
        if (!cancelled) setData({ picks: [], directory: [], diy: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const directoryById = useMemo(() => {
    const map = new Map<string, DirectorySupplier>();
    for (const s of data?.directory ?? []) map.set(s.id, s);
    return map;
  }, [data]);
  const diyById = useMemo(() => {
    const map = new Map<string, CoupleSupplier>();
    for (const s of data?.diy ?? []) map.set(s.id, s);
    return map;
  }, [data]);

  const venuePick = useMemo(() => data?.picks?.find((p) => p.category === "venue"), [data]);
  const venue = useMemo(
    () => resolveVenue(fields, venuePick, directoryById, diyById),
    [fields, venuePick, directoryById, diyById],
  );
  // The directory venue the row is EFFECTIVELY linked to — the pick, unless the
  // couple renamed the venue away from it (resolveVenue detaches a stale pick,
  // exposing that decision via `venue.linkedSupplierId`).
  const linkedDir = useMemo(
    () => (venue?.linkedSupplierId ? directoryById.get(venue.linkedSupplierId) : undefined),
    [venue?.linkedSupplierId, directoryById],
  );
  // Where the venue row links to: an effectively-linked directory venue opens
  // its own vendor card. Any other venue (DIY / free-text / detached) has no
  // card of its own to open, so it goes straight to the one place it CAN be
  // managed or removed — the guest-page venue picker — rather than the
  // generic vendors hub, which showed nothing about this venue and read as a
  // dead click.
  const venueLinkTo = linkedDir?.id
    ? venueVendorHref(linkedDir.id)
    : "/app/guest-page?edit=venue_manage";

  const hasCoordinator = Boolean(fields.coordinator_name || fields.coordinator_phone);
  const hasEmergency = Boolean(fields.emergency_name || fields.emergency_phone);

  // Contacts = every pick except the venue (it has its own row above). Resolve
  // each to a display name + phone; DIY picks resolve to name-only.
  const contacts = useMemo<Contact[]>(() => {
    if (!data) return [];
    const out: Contact[] = [];
    for (const p of data.picks ?? []) {
      if (p.category === "venue") continue;
      const dir = directoryById.get(p.supplier_id);
      if (dir) {
        out.push({
          key: p.supplier_id,
          id: dir.id,
          name: dir.name,
          category: dir.category,
          // Off the PICK, not off the catalogue row: `/api/suppliers` carries no
          // contact values any more, and the picks payload resolves the number
          // for the couple's own picks precisely so this row survives.
          phone: p.contact_phone ?? null,
          linkable: true,
        });
        continue;
      }
      const diy = diyById.get(p.supplier_id);
      if (diy) {
        out.push({
          key: p.supplier_id,
          id: diy.id,
          name: diy.name,
          category: diy.category,
          phone: null,
          linkable: false,
        });
      }
    }
    return out;
  }, [data, directoryById, diyById]);

  const shownContacts = contacts.slice(0, MAX_CONTACTS);

  return (
    <section className="card mb-6 p-0" data-tour-target="dashboard-keyinfo">
      {/* The header carries its own title ONLY while collapsed, where the strip
          is all there is to identify. Open, the venue row underneath says what
          this is far better than a label does, so the text gives way to a black
          cap holding one control.

          Black rather than the blush wash it used to wear: a pale tint across a
          full-width strip reads as an alert banner (the one thing on the
          dashboard that pink is supposed to mean), while black reads as chrome
          and lets the card's actual content carry the only colour on the card.
          It also freed the strip of its left accent marker, which existed to
          keep a wash legible and has nothing left to mark.

          The title is FADED rather than swapped in and out (it used to toggle
          `sr-only`), which is what lets the cap animate: the row keeps one
          layout in both states, so only the colour and the padding move and
          nothing jumps as the body slides. */}
      <header
        className={`flex items-center justify-between gap-2 transition-[background-color,padding] duration-300 ease-out ${
          open
            ? "rounded-t-2xl bg-ink-900 px-2 py-0 dark:bg-ink-950"
            : "rounded-t-2xl bg-transparent px-5 py-2.5"
        }`}
      >
        <h2
          aria-hidden={open}
          className={`flex items-center gap-2.5 font-grotesk text-base font-medium leading-tight tracking-tight text-ink-900 transition-opacity duration-200 ease-out dark:text-paper-50 ${
            open ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <span className="inline-block h-4 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          {t("dashboard.keyinfo_title")}
        </h2>
        {/* Collapse only. The all-vendors link lives at the BOTTOM of the vendor
            list now, as its own add-a-vendor row: two icons up here made the cap
            read as a toolbar, and the link belongs beside the vendors it
            opens. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("dashboard.keyinfo_title")}
          className={headerIconClass(open)}
        >
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-300 ease-out ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </header>

      {/* Collapse animation. The 1fr→0fr grid row is the only CSS-only way to
          transition to a CONTENT height (no measuring, no ResizeObserver), and
          `invisible` rides along so a collapsed body can't be tabbed into —
          visibility interpolates discretely and stays visible for the whole
          out-transition, so the slide is never cut short by it. */}
      <div
        className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out ${
          open ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-5 py-3">
            {loading ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="flex items-center gap-3">
                  <Skeleton variant="circle" width={36} />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton variant="block" width="45%" height={14} rounded="md" />
                    <Skeleton variant="block" width="65%" height={11} rounded="md" />
                  </div>
                </div>
                <Skeleton variant="block" width="100%" height={36} rounded="lg" />
              </div>
            ) : (
              <>
                {/* ── Venue ─────────────────────────────────────────────── */}
                {venue ? (
                  <div className="group relative -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-paper-100/70 dark:hover:bg-umber-800/40">
                    <Link
                      to={venueLinkTo}
                      aria-label={venue.name}
                      className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
                    />
                    <span className="pointer-events-none flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                        <MapPin size={16} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] uppercase leading-tight tracking-wider text-ink-500 dark:text-umber-300">
                          {t("dashboard.keyinfo_venue_label")}
                        </span>
                        <span className="block truncate text-sm font-semibold leading-tight text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300">
                          {venue.name}
                        </span>
                        {venue.detail && (
                          <span className="block truncate text-xs leading-tight text-ink-600 dark:text-umber-200">
                            {venue.detail}
                          </span>
                        )}
                      </span>
                    </span>
                    <div className="relative z-10 flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMapOpen(true)}
                        aria-label={t("dashboard.keyinfo_map")}
                        title={t("dashboard.keyinfo_map")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 text-ink-700 transition-colors hover:border-ink-400 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:border-umber-600 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
                      >
                        <MapPin size={15} aria-hidden="true" />
                      </button>
                      {venue.phone && (
                        <a
                          href={`tel:${venue.phone.replace(/\s+/g, "")}`}
                          title={venue.phone}
                          aria-label={`${t("dashboard.keyinfo_call")} ${venue.phone}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blush-600 text-white transition-colors hover:bg-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
                        >
                          <Phone size={15} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <Link
                    to="/app/guest-page"
                    className="flex items-center gap-3 rounded-2xl border border-dashed border-paper-300 px-4 py-2 text-sm text-ink-600 transition-colors hover:border-blush-300 hover:bg-paper-100/50 dark:border-umber-700 dark:text-umber-200 dark:hover:bg-umber-900/40"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-umber-200">
                      <MapPin size={16} aria-hidden="true" />
                    </span>
                    <span className="flex-1 font-medium text-ink-800 dark:text-paper-100">
                      {t("dashboard.keyinfo_no_venue")}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                )}

                {/* ── Day-of contacts (coordinator + emergency) ─────────── */}
                {(hasCoordinator || hasEmergency) && (
                  <div className="mt-3 space-y-1.5 border-t border-paper-200 pt-3 dark:border-umber-700">
                    {hasCoordinator && (
                      <PersonRow
                        Icon={UserRound}
                        label={t("dashboard.keyinfo_coordinator")}
                        name={fields.coordinator_name}
                        phone={fields.coordinator_phone}
                      />
                    )}
                    {hasEmergency && (
                      <PersonRow
                        Icon={Siren}
                        label={t("dashboard.keyinfo_emergency")}
                        name={fields.emergency_name}
                        phone={fields.emergency_phone}
                      />
                    )}
                  </div>
                )}

                {/* ── Suppliers ─────────────────────────────────────────── */}
                {/* The list always ends in the add-a-vendor row, which is also
                    the whole empty state: one row shape covers "you have four
                    vendors, add another" and "you have none yet", so the card
                    never has to swap layouts to say the same thing. */}
                <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-700">
                  <ul className="flex flex-col divide-y divide-paper-200 dark:divide-umber-700">
                    {shownContacts.map((c) => {
                      const Icon = CATEGORY_ICON[c.category] ?? Building2;
                      // Every vendor is clickable: directory vendors open their
                      // detail page; DIY vendors (no detail page) open the
                      // vendors hub where they're managed.
                      const to = c.linkable
                        ? `/app/suppliers/${encodeURIComponent(c.id)}`
                        : "/app/vendors";
                      return (
                        <li
                          key={c.key}
                          className="group relative -mx-1 flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-paper-100/70 dark:hover:bg-umber-800/40"
                        >
                          <Link
                            to={to}
                            aria-label={c.name}
                            className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
                          />
                          <span className="pointer-events-none inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                            <Icon size={14} aria-hidden="true" />
                          </span>
                          <span className="pointer-events-none min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium leading-tight text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300">
                              {c.name}
                            </span>
                            <span className="block truncate text-[11px] uppercase leading-tight tracking-wider text-ink-500 dark:text-umber-300">
                              {t(`suppliers.cat.${c.category}`)}
                            </span>
                          </span>
                          <ChevronRight
                            size={14}
                            aria-hidden="true"
                            className="pointer-events-none shrink-0 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-umber-500"
                          />
                          {c.phone ? (
                            <a
                              href={`tel:${c.phone.replace(/\s+/g, "")}`}
                              title={c.phone}
                              aria-label={`${t("dashboard.keyinfo_call")} ${c.phone}`}
                              className="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-800 transition-colors hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
                            >
                              <Phone size={14} aria-hidden="true" />
                            </a>
                          ) : (
                            <span
                              className="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100/60 text-ink-400 dark:bg-umber-700/40 dark:text-umber-300"
                              aria-label={t("suppliers.no_phone")}
                              title={t("suppliers.no_phone")}
                            >
                              <Phone size={14} aria-hidden="true" />
                            </span>
                          )}
                        </li>
                      );
                    })}
                    <li>
                      <AddVendorRow label={t("dashboard.keyinfo_add_suppliers")} />
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {mapOpen && venue && (
        <Suspense fallback={null}>
          <SupplierMapModal
            name={venue.name}
            lat={venue.lat}
            lng={venue.lng}
            address={venue.address}
            city={venue.city}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      )}
    </section>
  );
}

/** A person row (coordinator / emergency contact): icon, label, name, and a
 *  tel: call button when a number is set. Falls back to showing the number
 *  itself as the primary line when no name was entered. */
function PersonRow({
  Icon,
  label,
  name,
  phone,
}: {
  Icon: IconCmp;
  label: string;
  name: string;
  phone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-1 py-0.5">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
        <Icon size={14} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase leading-tight tracking-wider text-ink-500 dark:text-umber-300">
          {label}
        </p>
        <p className="truncate text-sm font-medium leading-tight text-ink-900 dark:text-paper-50">
          {name || phone}
        </p>
      </div>
      {phone && <CallPill phone={phone} />}
    </div>
  );
}

/** The last row of the vendor list: the vendors hub, wearing the same icon +
 *  name + trailing-control rhythm as the vendors above it so it reads as the
 *  next line rather than a button bolted underneath. Quiet by default (dashed
 *  ring, muted ink) because it is an invitation, not one of the couple's own
 *  bookings — the row wakes to full ink on hover. */
function AddVendorRow({ label }: { label: string }) {
  return (
    <Link
      to="/app/vendors"
      className="group -mx-1 flex items-center gap-3 rounded-lg px-1 py-1.5 transition-colors hover:bg-paper-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:hover:bg-umber-800/40 dark:focus-visible:ring-paper-100"
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-paper-300 text-ink-400 transition-colors group-hover:border-ink-900 group-hover:text-ink-900 dark:border-umber-600 dark:text-umber-300 dark:group-hover:border-paper-200 dark:group-hover:text-paper-100">
        <Store size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-ink-500 transition-colors group-hover:text-ink-900 dark:text-umber-300 dark:group-hover:text-paper-50">
        {label}
      </span>
      <Plus
        size={16}
        aria-hidden="true"
        className="shrink-0 text-ink-400 transition-colors group-hover:text-ink-900 dark:text-umber-300 dark:group-hover:text-paper-50"
      />
    </Link>
  );
}

/** Small tel: call button shared by day-of contact rows. */
function CallPill({ phone }: { phone: string }) {
  const { t } = useT();
  return (
    <a
      href={`tel:${phone.replace(/\s+/g, "")}`}
      title={phone}
      aria-label={`${t("dashboard.keyinfo_call")} ${phone}`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-800 transition-colors hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
    >
      <Phone size={14} aria-hidden="true" />
    </a>
  );
}
