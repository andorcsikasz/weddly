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
  ClipboardList,
  Disc3,
  Flower2,
  Gem,
  Globe,
  Hand,
  Lightbulb,
  MapPin,
  PartyPopper,
  Pencil,
  Phone,
  Pizza,
  Plus,
  Shirt,
  Siren,
  Sparkles,
  Speaker,
  PenTool,
  StickyNote,
  Tent,
  UserRound,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { coupleApi, coupleSupplierApi, picksApi, supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { lazyWithReload } from "../lib/lazy_reload";
import { setSelection } from "../lib/supplier_selection";
import { Dialog, Skeleton, useToast } from "./ui";

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

/** Diacritic-folded lower-case, for the venue autocomplete match. Mirrors the
 *  helper in BookedSupplierCard (the "Már foglaltam" flow) so typing folds the
 *  same way here. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
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

/** The couple-editable venue + day-of contact fields, as a plain string form
 *  (empty string = unset). Kept local so a save reflects immediately without
 *  threading state back through the dashboard. */
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
  // venue (typed values only, geocoded map, hub link). The couple can re-link
  // via the edit dialog's autocomplete. Name comparison is diacritic-folded.
  const detachedFromPick =
    Boolean(f.venue_name) && picked != null && fold(f.venue_name) !== fold(picked.name);
  const effPicked = detachedFromPick ? undefined : picked;

  const name = f.venue_name || effPicked?.name || diy?.name || null;
  const address = f.venue_address || effPicked?.address || null;
  const city = f.venue_city || effPicked?.city || null;
  const phone = f.venue_phone || effPicked?.contact_phone || null;

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
  const toast = useToast();

  // Local mirror of the couple-editable fields — a save reflects here without
  // threading state back up to the dashboard. Re-synced if the prop changes.
  const [fields, setFields] = useState<VenueFields>(() => pickFields(couple));
  useEffect(() => setFields(pickFields(couple)), [couple]);
  // Edit dialog draft — null when the dialog is closed.
  const [draft, setDraft] = useState<VenueFields | null>(null);
  const [saving, setSaving] = useState(false);
  // The venue directory vendor the couple picked from the edit dialog's
  // autocomplete, staged until Save so the pick and the field edits commit
  // together (a Cancel leaves everything untouched).
  const [pendingVenue, setPendingVenue] = useState<DirectorySupplier | null>(null);
  // In-app venue map modal (replaces the old external Google Maps hand-off).
  const [mapOpen, setMapOpen] = useState(false);

  function openDialog() {
    setDraft(fields);
    setPendingVenue(null);
  }
  function closeDialog() {
    setDraft(null);
    setPendingVenue(null);
  }

  // Stage a directory venue chosen from the autocomplete: fill the name and
  // clear the manual city/address/phone so the vendor's canonical details
  // (incl. map coordinates) drive the row once the pick is written on Save.
  function selectVenueSuggestion(s: DirectorySupplier) {
    setDraft((d) =>
      d ? { ...d, venue_name: s.name, venue_city: "", venue_address: "", venue_phone: "" } : d,
    );
    setPendingVenue(s);
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const resp = await coupleApi.update(draft);
      setFields(pickFields(resp.couple));
      if (pendingVenue) {
        // Write the "our venue" pick like the "Már foglaltam" flow does, then
        // reflect it in this card's own picks/directory cache so the venue row
        // updates without a refetch.
        const picked = pendingVenue;
        setSelection(couple.id, "venue", picked.id);
        setData((prev) => {
          if (!prev) return prev;
          const picks: CouplePick[] = [
            ...prev.picks.filter((p) => p.category !== "venue"),
            { category: "venue", supplier_id: picked.id, picked_by_user_id: null, picked_at: 0 },
          ];
          const directory = prev.directory.some((d) => d.id === picked.id)
            ? prev.directory
            : [...prev.directory, picked];
          return { ...prev, picks, directory };
        });
      }
      closeDialog();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

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
  // exposing that decision via `venue.linkedSupplierId`). Drives both the row
  // link and the edit-form placeholders, so neither surfaces a stale vendor.
  const linkedDir = useMemo(
    () => (venue?.linkedSupplierId ? directoryById.get(venue.linkedSupplierId) : undefined),
    [venue?.linkedSupplierId, directoryById],
  );
  // Where the venue row links to: an effectively-linked directory venue opens
  // its own vendor card; any other venue (DIY / free-text / detached) falls back
  // to the vendors hub. Mirrors the supplier-row behaviour.
  const venueLinkTo = linkedDir
    ? `/app/suppliers/${encodeURIComponent(linkedDir.id)}`
    : "/app/vendors";
  // Venue-category directory vendors, offered as autocomplete suggestions in
  // the edit dialog ("primarily suggest venue vendors").
  const venueOptions = useMemo(
    () => (data?.directory ?? []).filter((s) => s.category === "venue"),
    [data],
  );
  // Placeholders follow the pending selection while the dialog is open, so the
  // city/address/phone hints reflect the vendor the couple just picked. Falls
  // back to the effectively-linked pick (never a stale, detached one), so a
  // renamed venue shows empty fields to fill rather than a prior vendor's data.
  const placeholderVenue = pendingVenue ?? linkedDir;

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
          phone: dir.contact_phone,
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
      <header className="flex items-center justify-between gap-2 border-b border-paper-200 px-5 py-2.5 dark:border-umber-700">
        <h2 className="flex items-center gap-2.5 font-grotesk text-base text-ink-900 dark:text-paper-50">
          <span className="inline-block h-4 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          {t("dashboard.keyinfo_title")}
        </h2>
        {/* Edit lives on the venue row (with the map/call actions), not up here. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("dashboard.keyinfo_title")}
          className="-my-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
        >
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </header>

      {open && (
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
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to={venueLinkTo}
                    className="group flex min-w-0 items-start gap-3 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
                  >
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                      <MapPin size={16} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase leading-tight tracking-wider text-ink-500 dark:text-umber-300">
                        {t("dashboard.keyinfo_venue_label")}
                      </p>
                      <p className="truncate text-sm font-semibold leading-tight text-ink-900 transition-colors group-hover:text-blush-700 group-hover:underline dark:text-paper-50 dark:group-hover:text-blush-300">
                        {venue.name}
                      </p>
                      {venue.detail && (
                        <p className="truncate text-xs leading-tight text-ink-600 dark:text-umber-200">
                          {venue.detail}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMapOpen(true)}
                      aria-label={t("dashboard.keyinfo_map")}
                      title={t("dashboard.keyinfo_map")}
                      className="btn-outline btn-sm inline-flex min-h-[38px] items-center gap-1.5 sm:min-h-[34px]"
                    >
                      <MapPin size={15} aria-hidden="true" />
                      <span className="hidden sm:inline">{t("dashboard.keyinfo_map")}</span>
                    </button>
                    {venue.phone && (
                      <a
                        href={`tel:${venue.phone.replace(/\s+/g, "")}`}
                        title={venue.phone}
                        aria-label={`${t("dashboard.keyinfo_call")} ${venue.phone}`}
                        className="btn-primary btn-sm inline-flex min-h-[38px] items-center gap-1.5 sm:min-h-[34px]"
                      >
                        <Phone size={15} aria-hidden="true" />
                        <span className="hidden sm:inline">{t("dashboard.keyinfo_call")}</span>
                      </a>
                    )}
                    <EditButton label={t("dashboard.keyinfo_edit")} onClick={openDialog} />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    to="/app/guest-page"
                    className="flex flex-1 items-center gap-3 rounded-2xl border border-dashed border-paper-300 px-4 py-2 text-sm text-ink-600 transition-colors hover:border-blush-300 hover:bg-paper-100/50 dark:border-umber-700 dark:text-umber-200 dark:hover:bg-umber-900/40"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-500 dark:bg-umber-700 dark:text-umber-200">
                      <MapPin size={16} aria-hidden="true" />
                    </span>
                    <span className="flex-1 font-medium text-ink-800 dark:text-paper-100">
                      {t("dashboard.keyinfo_no_venue")}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                  <EditButton label={t("dashboard.keyinfo_edit")} onClick={openDialog} />
                </div>
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
              <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-700">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {t("dashboard.keyinfo_suppliers")}
                  </p>
                  {contacts.length > 0 && (
                    <Link
                      to="/app/vendors"
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
                      // Every vendor is clickable: directory vendors open their
                      // detail page; DIY vendors (no detail page) open the
                      // vendors hub where they're managed.
                      const to = c.linkable
                        ? `/app/suppliers/${encodeURIComponent(c.id)}`
                        : "/app/vendors";
                      return (
                        <li key={c.key} className="flex items-center gap-3 py-1.5">
                          <Link
                            to={to}
                            className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
                          >
                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-900 text-ink-900 dark:border-paper-200 dark:text-paper-100">
                              <Icon size={14} aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium leading-tight text-ink-900 transition-colors group-hover:text-blush-700 group-hover:underline dark:text-paper-50 dark:group-hover:text-blush-300">
                                {c.name}
                              </p>
                              <p className="truncate text-[11px] uppercase leading-tight tracking-wider text-ink-500 dark:text-umber-300">
                                {t(`suppliers.cat.${c.category}`)}
                              </p>
                            </div>
                          </Link>
                          {c.phone ? (
                            <a
                              href={`tel:${c.phone.replace(/\s+/g, "")}`}
                              title={c.phone}
                              aria-label={`${t("dashboard.keyinfo_call")} ${c.phone}`}
                              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-paper-100 px-3 text-xs font-medium text-ink-800 transition-colors hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 sm:min-h-[32px] dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
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

      {draft && (
        <Dialog
          open
          role="dialog"
          closeOnBackdrop
          size="sm"
          title={t("dashboard.keyinfo_edit_title")}
          onClose={() => (saving ? undefined : closeDialog())}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={closeDialog} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn-primary" onClick={saveDraft} disabled={saving}>
                {t("common.save")}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("dashboard.keyinfo_venue_label")}
              </legend>
              <VenueNameField
                label={t("dashboard.keyinfo_field_venue_name")}
                value={draft.venue_name}
                placeholder={placeholderVenue?.name ?? ""}
                options={venueOptions}
                currentId={pendingVenue?.id ?? venuePick?.supplier_id ?? null}
                onChange={(v) => setDraft({ ...draft, venue_name: v })}
                onSelect={selectVenueSuggestion}
              />
              <Field
                label={t("dashboard.keyinfo_field_venue_city")}
                value={draft.venue_city}
                placeholder={placeholderVenue?.city ?? ""}
                onChange={(v) => setDraft({ ...draft, venue_city: v })}
              />
              <Field
                label={t("dashboard.keyinfo_field_venue_address")}
                value={draft.venue_address}
                placeholder={placeholderVenue?.address ?? ""}
                onChange={(v) => setDraft({ ...draft, venue_address: v })}
              />
              <Field
                label={t("dashboard.keyinfo_field_venue_phone")}
                type="tel"
                value={draft.venue_phone}
                placeholder={placeholderVenue?.contact_phone ?? ""}
                onChange={(v) => setDraft({ ...draft, venue_phone: v })}
              />
            </fieldset>

            <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("dashboard.keyinfo_coordinator")}
              </legend>
              <Field
                label={t("dashboard.keyinfo_field_name")}
                value={draft.coordinator_name}
                onChange={(v) => setDraft({ ...draft, coordinator_name: v })}
              />
              <Field
                label={t("dashboard.keyinfo_field_phone")}
                type="tel"
                value={draft.coordinator_phone}
                onChange={(v) => setDraft({ ...draft, coordinator_phone: v })}
              />
            </fieldset>

            <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("dashboard.keyinfo_emergency")}
              </legend>
              <Field
                label={t("dashboard.keyinfo_field_name")}
                value={draft.emergency_name}
                onChange={(v) => setDraft({ ...draft, emergency_name: v })}
              />
              <Field
                label={t("dashboard.keyinfo_field_phone")}
                type="tel"
                value={draft.emergency_phone}
                onChange={(v) => setDraft({ ...draft, emergency_phone: v })}
              />
            </fieldset>
          </div>
        </Dialog>
      )}

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
    <div className="flex items-center gap-3">
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

/** Round icon button that opens the Kulcsinfó edit dialog. Sits on the venue
 *  row (with the map/call actions) so editing is inline with what it edits. */
function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 sm:h-8 sm:w-8 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
    >
      <Pencil size={16} aria-hidden="true" />
    </button>
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
      className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-paper-100 px-3 text-xs font-medium text-ink-800 transition-colors hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 sm:min-h-[32px] dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-700/80"
    >
      <Phone size={13} aria-hidden="true" />
      <span>{t("dashboard.keyinfo_call")}</span>
    </a>
  );
}

/** Labelled text input for the edit dialog. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "tel";
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      <input
        type={type}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Venue-name field for the edit dialog: a text input that "primarily suggests
 *  venue vendors" from the directory as the couple types. Picking a suggestion
 *  adopts it as the couple's venue (via `onSelect`); if the venue isn't listed,
 *  the couple just types it in, mirroring the "Már foglaltam" flow on the
 *  vendor page. */
function VenueNameField({
  label,
  value,
  placeholder,
  options,
  currentId,
  onChange,
  onSelect,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options: DirectorySupplier[];
  /** Supplier id of the already-picked / just-picked venue, for the "current" marker. */
  currentId: string | null;
  onChange: (v: string) => void;
  onSelect: (s: DirectorySupplier) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const queryNorm = useMemo(() => fold(value.trim()), [value]);
  const matches = useMemo<DirectorySupplier[]>(() => {
    if (!queryNorm) return [];
    return options.filter((s) => fold(`${s.name} ${s.city}`).includes(queryNorm)).slice(0, 6);
  }, [queryNorm, options]);

  return (
    <label className="relative block text-sm">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      <input
        type="text"
        autoComplete="off"
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay the close so a mousedown on a suggestion lands before the
        // dropdown unmounts.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches.length > 0) {
            e.preventDefault();
            onSelect(matches[0]!);
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && queryNorm && matches.length > 0 && (
        <div
          role="listbox"
          aria-label={t("dashboard.keyinfo_venue_suggestions")}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-paper-300 bg-white py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800"
        >
          {matches.map((s) => {
            const current = currentId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={current}
                // mousedown fires before the input's blur → click would race the
                // dropdown's unmount. mousedown wins cleanly.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-paper-100 dark:hover:bg-umber-700"
              >
                <span className="truncate font-medium text-ink-800 dark:text-paper-100">
                  {s.name}
                </span>
                <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                  {current ? t("dashboard.keyinfo_venue_current") : s.city}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </label>
  );
}
