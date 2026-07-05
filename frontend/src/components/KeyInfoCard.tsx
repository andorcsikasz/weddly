// "Kulcsinfó" — a couple/organiser-facing quick-access card on the dashboard.
// Surfaces the two things people hunt for all through planning (not just on the
// day): the venue's map + phone, and one-tap dialling for booked suppliers.
//
// Deliberately a READ/aggregate surface with ZERO new data model. The venue is
// derived from what the couple already has — a picked directory venue (rich:
// address / phone / coords) or the free-text `venue_name` + `venue_city`
// fallback (name + a Maps *search* link, no phone). Contacts reuse the same
// picks → suppliers merge that TimelinePage's "Kapcsolattartók" panel uses, so
// there is no second copy of the contact data. Everything is fetched from the
// existing /api/picks, /api/suppliers, /api/couple-suppliers endpoints.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { CouplePick } from "@shared/picks";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import type { Couple } from "@shared/types";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  ChefHat,
  ChevronDown,
  ChevronRight,
  Disc3,
  Flower2,
  Gem,
  Globe,
  Hand,
  Lightbulb,
  MapPin,
  PartyPopper,
  Phone,
  Pizza,
  Plus,
  Shirt,
  Sparkles,
  Speaker,
  StickyNote,
  Tent,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { coupleSupplierApi, picksApi, supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Skeleton } from "./ui";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Mirrors the category → icon map in TimelinePage's contact panel so the two
// surfaces read the same. Kept local (presentational constant) to keep this a
// surgical, self-contained addition.
const CATEGORY_ICON: Record<SupplierCategory, IconCmp> = {
  venue: Building2,
  accommodation: BedDouble,
  tent_pavilion: Tent,
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  pizza: Pizza,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  sound_tech: Speaker,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  nails: Hand,
  rings: Gem,
  stationery: StickyNote,
  wedding_website: Globe,
  transport: Bus,
  other: Sparkles,
};

const MAX_CONTACTS = 4;
const STORAGE_KEY = "weddly.dashboard.keyinfo";

/** Google Maps deep link from a free-text query (name/address + city) or exact
 *  coordinates. `?api=1` is the documented universal-link form; it opens the
 *  native Maps app on mobile and maps.google.com on desktop. */
function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

type VenueInfo = {
  name: string;
  /** Secondary line — street address if we have one, else the city/town. */
  detail: string | null;
  phone: string | null;
  mapQuery: string;
};

type Contact = {
  key: string;
  id: string;
  name: string;
  category: SupplierCategory;
  phone: string | null;
};

/** Resolve the couple's venue from the richest source available:
 *  1. a picked directory venue (address / phone / coords),
 *  2. a picked DIY venue (name only),
 *  3. the free-text `venue_name` + `venue_city`,
 *  4. nothing → null (card shows a CTA). */
function resolveVenue(
  couple: Couple,
  venuePick: CouplePick | undefined,
  directoryById: Map<string, DirectorySupplier>,
  diyById: Map<string, CoupleSupplier>,
): VenueInfo | null {
  if (venuePick) {
    const dir = directoryById.get(venuePick.supplier_id);
    if (dir) {
      const detail = dir.address ?? (dir.city || null);
      const mapQuery =
        dir.lat !== null && dir.lng !== null
          ? `${dir.lat},${dir.lng}`
          : [dir.address ?? dir.name, dir.city].filter(Boolean).join(", ");
      return { name: dir.name, detail, phone: dir.contact_phone, mapQuery };
    }
    const diy = diyById.get(venuePick.supplier_id);
    if (diy) {
      const detail = couple.venue_city || null;
      return {
        name: diy.name,
        detail,
        phone: null,
        mapQuery: [diy.name, couple.venue_city].filter(Boolean).join(", "),
      };
    }
  }
  if (couple.venue_name) {
    return {
      name: couple.venue_name,
      detail: couple.venue_city || null,
      phone: null,
      mapQuery: [couple.venue_name, couple.venue_city].filter(Boolean).join(", "),
    };
  }
  return null;
}

export function KeyInfoCard({ couple }: { couple: Couple }) {
  const { t } = useT();

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
        if (!cancelled) setData({ picks: p.picks, directory: d.suppliers, diy: m.suppliers });
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

  const venuePick = useMemo(() => data?.picks.find((p) => p.category === "venue"), [data]);
  const venue = useMemo(
    () => resolveVenue(couple, venuePick, directoryById, diyById),
    [couple, venuePick, directoryById, diyById],
  );

  // Contacts = every pick except the venue (it has its own row above). Resolve
  // each to a display name + phone; DIY picks resolve to name-only.
  const contacts = useMemo<Contact[]>(() => {
    if (!data) return [];
    const out: Contact[] = [];
    for (const p of data.picks) {
      if (p.category === "venue") continue;
      const dir = directoryById.get(p.supplier_id);
      if (dir) {
        out.push({
          key: p.supplier_id,
          id: dir.id,
          name: dir.name,
          category: dir.category,
          phone: dir.contact_phone,
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
        });
      }
    }
    return out;
  }, [data, directoryById, diyById]);

  const shownContacts = contacts.slice(0, MAX_CONTACTS);

  return (
    <section className="card mb-8 p-0" data-tour-target="dashboard-keyinfo">
      <header className="flex items-center justify-between gap-2 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="flex items-center gap-2.5 font-grotesk text-lg text-ink-900 dark:text-paper-50">
          <span className="inline-block h-5 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          {t("dashboard.keyinfo_title")}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("dashboard.keyinfo_title")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
        >
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </header>

      {open && (
        <div className="px-5 py-4">
          {loading ? (
            <div className="space-y-4" aria-hidden="true">
              <div className="flex items-center gap-3">
                <Skeleton variant="circle" width={40} />
                <div className="flex-1 space-y-1.5">
                  <Skeleton variant="block" width="45%" height={14} rounded="md" />
                  <Skeleton variant="block" width="65%" height={11} rounded="md" />
                </div>
              </div>
              <Skeleton variant="block" width="100%" height={44} rounded="lg" />
            </div>
          ) : (
            <>
              {/* ── Venue ─────────────────────────────────────────────── */}
              {venue ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-800 ring-1 ring-paper-300 dark:bg-umber-700 dark:text-paper-100 dark:ring-umber-700">
                      <MapPin size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                        {t("dashboard.keyinfo_venue_label")}
                      </p>
                      <p className="truncate text-sm font-semibold text-ink-900 dark:text-paper-50">
                        {venue.name}
                      </p>
                      {venue.detail && (
                        <p className="truncate text-xs text-ink-600 dark:text-umber-200">
                          {venue.detail}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={mapsUrl(venue.mapQuery)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-outline btn-sm inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-[38px]"
                    >
                      <MapPin size={15} aria-hidden="true" />
                      <span>{t("dashboard.keyinfo_map")}</span>
                    </a>
                    {venue.phone && (
                      <a
                        href={`tel:${venue.phone.replace(/\s+/g, "")}`}
                        className="btn-primary btn-sm inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-[38px]"
                      >
                        <Phone size={15} aria-hidden="true" />
                        <span>{t("dashboard.keyinfo_call")}</span>
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <Link
                  to="/app/guest-page"
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-paper-300 px-4 py-3 text-sm text-ink-600 transition-colors hover:border-blush-300 hover:bg-paper-100/50 dark:border-umber-700 dark:text-umber-200 dark:hover:bg-umber-900/40"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-umber-200">
                    <MapPin size={18} aria-hidden="true" />
                  </span>
                  <span className="flex-1 font-medium text-ink-800 dark:text-paper-100">
                    {t("dashboard.keyinfo_no_venue")}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              )}

              {/* ── Suppliers ─────────────────────────────────────────── */}
              <div className="mt-4 border-t border-paper-200 pt-4 dark:border-umber-700">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {t("dashboard.keyinfo_suppliers")}
                  </p>
                  {contacts.length > 0 && (
                    <Link
                      to="/app/timeline"
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 transition-colors hover:text-blush-700 dark:text-umber-200 dark:hover:text-blush-300"
                    >
                      <span>{t("dashboard.keyinfo_all_suppliers")}</span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </Link>
                  )}
                </div>

                {shownContacts.length === 0 ? (
                  <Link
                    to="/app/vendors"
                    className="inline-flex items-center gap-1.5 rounded-full bg-paper-100 px-3.5 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-paper-200 dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>{t("dashboard.keyinfo_add_suppliers")}</span>
                  </Link>
                ) : (
                  <ul className="flex flex-col divide-y divide-paper-200 dark:divide-umber-700">
                    {shownContacts.map((c) => {
                      const Icon = CATEGORY_ICON[c.category] ?? Building2;
                      return (
                        <li key={c.key} className="flex items-center gap-3 py-2">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-800 ring-1 ring-paper-300 dark:bg-umber-700 dark:text-paper-100 dark:ring-umber-700">
                            <Icon size={15} aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                              {c.name}
                            </p>
                            <p className="truncate text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                              {t(`suppliers.cat.${c.category}`)}
                            </p>
                          </div>
                          {c.phone ? (
                            <a
                              href={`tel:${c.phone.replace(/\s+/g, "")}`}
                              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-paper-100 px-3 text-xs font-medium text-ink-800 transition-colors hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 sm:min-h-[36px] dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
                            >
                              <Phone size={13} aria-hidden="true" />
                              <span>{t("dashboard.keyinfo_call")}</span>
                            </a>
                          ) : (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-100/60 px-2.5 py-1 text-xs text-ink-400 dark:bg-umber-700/40 dark:text-umber-300"
                              aria-label={t("suppliers.no_phone")}
                              title={t("suppliers.no_phone")}
                            >
                              <Phone size={13} aria-hidden="true" />
                              <span>-</span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
