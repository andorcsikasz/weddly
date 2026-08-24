// Static suppliers directory. v1 = read-only outbound contact only.
//
// Layout: a step-by-step "chain" of supplier groups along the top — selecting
// a step reveals its sub-categories. The chain mirrors the real-world booking
// order (venue first, details last). Above the chain: free-text search + city
// filter (persisted in URL params so back-button works) plus a "saved" star on
// each card backed by localStorage.

import { countryName } from "@shared/country_list";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import {
  NOT_NEEDED_PICK,
  SELF_ORGANIZED_PICK,
  countRealPicks,
  isSentinelPick,
} from "@shared/picks";
import type {
  DirectorySupplier,
  SupplierCategory,
  SupplierCountryCount,
  SupplierGroup,
} from "@shared/suppliers";
import {
  SUPPLIER_GROUPS,
  VOTE_MIN_REVIEWS,
  collapseSettledCategories,
  isOutOfCountryScope,
  partitionByCountryScope,
  pickIdentityOf,
  showsCapacity,
} from "@shared/suppliers";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Calculator,
  Camera,
  ChefHat,
  ArrowBigDown,
  ArrowBigUp,
  ArrowUpRight,
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  LayoutGrid,
  List,
  Map as MapIcon,
  Disc3,
  ExternalLink,
  Eye,
  EyeOff,
  Flower2,
  Flag,
  Gem,
  Globe,
  Hand,
  Heart,
  Lightbulb,
  Loader2,
  Mail,
  MapPin,
  PartyPopper,
  Pencil,
  Phone,
  Pizza,
  Plus,
  Scale,
  Scissors,
  Search,
  SlidersHorizontal,
  Shirt,
  Sparkles,
  Speaker,
  Store,
  PenTool,
  StickyNote,
  Tent,
  Users,
  UtensilsCrossed,
  Wallet,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BookedSupplierCard } from "../components/BookedSupplierCard";
import { CakeDrinksCalculator } from "../components/CakeDrinksCalculator";
import { InfoHint } from "../components/InfoHint";
import { DiyEntryModal } from "../components/DiyEntryModal";
import { OutreachInbox } from "../components/OutreachInbox";
import { PlannerCard } from "../components/PlannerDirectoryRail";
import { ReportSupplierDialog } from "../components/ReportSupplierDialog";
import { SupplierCountryFilter } from "../components/SupplierCountryFilter";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { Button, Dialog, Skeleton, SmartImage, useToast } from "../components/ui";
import {
  hydrateCostPlanningCount,
  readCostPlanningCount,
  subscribeCostPlanningCount,
} from "../lib/cost_planning";
import {
  budgetApi,
  coupleApi,
  couplePlannerApi,
  coupleSupplierApi,
  placesApi,
  supplierApi,
  supplierCostApi,
} from "../lib/endpoints";
import { ApiError } from "../lib/api";
import type { BudgetLine, Currency, PlannerDirectoryEntry } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { SupplierCompareDialog } from "../components/SupplierCompareDialog";
import { formatMoney } from "../lib/format";
import { safeExternalHref } from "../lib/url";
import {
  distanceContextForQuery,
  distanceKmForQuery,
  metroKeysForCity,
  metroKeysForQuery,
  NEARBY_RADIUS_KM,
  nearbyTownLabel,
  registerTown,
  registerTowns,
  searchTowns,
} from "../lib/hu_metro_areas";
import { Combobox, type ComboOption } from "../components/Combobox";
import {
  readSelection,
  type SelectionMap,
  setSelection,
  subscribeSelection,
  unselectById,
} from "../lib/supplier_selection";
import {
  readSaved as readSavedStore,
  setSaved as setSavedStore,
  subscribeSaved,
} from "../lib/supplier_saved";
import { useAuth } from "../lib/auth";
import { fireConfetti } from "../lib/confetti";
import { useT } from "../lib/i18n";
import { lazyWithReload } from "../lib/lazy_reload";
import { useDocumentMeta } from "../lib/seo";

// Leaflet + react-leaflet add ~150 KB minified that no other page uses —
// lazy-loading keeps the initial /app bundle small for couples who never
// open the map tab.
const SupplierMap = lazyWithReload(() => import("../components/SupplierMap"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

import { CATEGORY_ICON, GROUP_ICON } from "../lib/category_icons";

/** Categories the cake & drinks calculator is relevant to. The tool estimates
 *  sweets, cake and drink quantities from the guest count, so it surfaces only
 *  when one of these food/drink categories is the active filter. */
const CALC_CATEGORIES = new Set<SupplierCategory>(["cake_dessert", "bar_drinks", "catering"]);

/** The sub-category row's right-hand action chips ("már foglaltam", "csinálom
 *  magam", "nem kell", plus the calculator). One shared shape so the three ways
 *  of settling a category read as peers on a single line, instead of a chip, a
 *  chip and a full-width card. Same geometry as the category pills to their
 *  left — only the fill differs. */
const ACTION_CHIP =
  "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-medium transition";
const ACTION_CHIP_IDLE =
  "border-ink-700 bg-transparent text-ink-700 hover:border-ink-900 hover:text-ink-900 dark:border-ink-300 dark:bg-transparent dark:text-ink-100 dark:hover:border-ink-200 dark:hover:text-paper-50";
/** Filter-is-on chip, mirroring the selected category pill. */
const ACTION_CHIP_ON = "border-transparent stationery-coffee text-paper-50";
/** "The panel below is open" chip. Deliberately NOT a fill: in this row a
 *  filled chip states something about the CATEGORY (sage for "we don't need
 *  this", coffee for "a filter is on"), and "a form is open underneath" is
 *  neither. Both fills used to read as one on-state, so opening the
 *  already-booked form looked like a second, contradictory status sitting on a
 *  sub-category already marked "nincs rá szükségem". The rotating chevron says
 *  disclosure, which is what this actually is. */
const ACTION_CHIP_OPEN =
  "border-ink-900 bg-paper-200 text-ink-900 dark:border-paper-200 dark:bg-umber-700 dark:text-paper-50";
/** "Handled" chip — a solid dark-green fill with white text once the couple
 *  ticks the sub-category as not needed, so the on-state reads a clear step
 *  above the outlined idle chips (the check inherits the white currentColor). */
const ACTION_CHIP_SAGE =
  "border-transparent bg-sage-600 text-paper-50 hover:bg-sage-700 dark:bg-sage-600 dark:text-paper-50 dark:hover:bg-sage-700";

/** Flat category list + its parent-group index, derived once from the group
 *  table — powers the search typeahead's category suggestions and lets a
 *  picked category jump straight to the right chain step. */
const ALL_CATEGORIES: SupplierCategory[] = SUPPLIER_GROUPS.flatMap((g) => g.categories);
const CATEGORY_GROUP: Record<SupplierCategory, SupplierGroup> = (() => {
  const m = {} as Record<SupplierCategory, SupplierGroup>;
  for (const g of SUPPLIER_GROUPS) for (const c of g.categories) m[c] = g.id;
  return m;
})();

/** Diacritic-folded lower-case for case- and accent-insensitive matching. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Fire-and-forget click ping for the admin directory analytics. Errors are
 *  swallowed — the navigation must not be blocked if the ingest is down. */
function trackSupplierClick(supplierId: string, type: "website_click" | "phone_click"): void {
  supplierApi.recordEvents([{ supplier_id: supplierId, type }]).catch(() => undefined);
}

// Progressive render: only the first page of filtered suppliers is laid out
// up front; the rest expands in via a "load more" button. Keeps the initial
// paint cheap on broad filters (the directory can run to hundreds of cards).
const SUPPLIERS_PAGE_SIZE = 50;

// How many verified-but-out-of-country vendors may sit under the results as a
// labelled tail. Six is enough to say "these businesses are on Weddly" without
// the foreign set ever being what the page is about: at any higher number a
// country Weddly hasn't filled yet reads as a directory of somewhere else.
const OUT_OF_COUNTRY_MAX = 6;

// Sentinel "pick" ids (SELF_ORGANIZED_PICK = "organising it ourselves",
// NOT_NEEDED_PICK = "we don't need this category") live in @shared/picks so the
// Timeline contact panel can exclude them too. Both match no real listing, so
// they resolve a category's planning step (its runner segment turns green +
// counts as done) without highlighting any card. The picks backend accepts any
// non-empty string id, which is what lets these ride the same storage.

/** True when a selection change to `cat` just completed its whole chain group
 *  (every category in the group now picked) that wasn't complete before — the
 *  "a tab is ready" moment that fires the confetti. */
function groupJustCompleted(
  cat: SupplierCategory,
  prev: SelectionMap,
  next: SelectionMap,
): boolean {
  const group = SUPPLIER_GROUPS.find((g) => g.categories.includes(cat));
  if (!group) return false;
  const wasDone = group.categories.every((c) => Boolean(prev[c]));
  const isDone = group.categories.every((c) => Boolean(next[c]));
  return !wasDone && isDone;
}

/** True when a selection change resolves EVERY supplier category (picked or
 *  marked not-needed) that wasn't fully resolved before — the "everything's
 *  sorted" moment that earns the bigger celebration. */
function chainJustCompleted(prev: SelectionMap, next: SelectionMap): boolean {
  const all = SUPPLIER_GROUPS.flatMap((g) => g.categories);
  const wasDone = all.every((c) => Boolean(prev[c]));
  const isDone = all.every((c) => Boolean(next[c]));
  return !wasDone && isDone;
}

/** Bigger, staggered confetti for the whole-chain-complete moment — three
 *  bursts across the top instead of the single per-step pop. Inherits
 *  fireConfetti's reduced-motion + SSR guards. */
function celebrateChainComplete(): void {
  if (typeof window === "undefined") return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  fireConfetti({ x: w * 0.5, y: h * 0.28 });
  window.setTimeout(() => fireConfetti({ x: w * 0.24, y: h * 0.32 }), 140);
  window.setTimeout(() => fireConfetti({ x: w * 0.76, y: h * 0.32 }), 260);
}

/** Fire the right celebration for a completing selection change: the bigger
 *  burst when the whole chain just finished, else the single pop when just
 *  this group finished. No-op when nothing newly completed. */
function celebrateSelection(cat: SupplierCategory, prev: SelectionMap, next: SelectionMap): void {
  if (chainJustCompleted(prev, next)) celebrateChainComplete();
  else if (groupJustCompleted(cat, prev, next)) fireConfetti();
}

/** Every filter row's label. One constant so the four rows can't drift apart:
 *  they only line up if they are typographically identical, not merely
 *  similar. */
const FILTER_ROW_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300";

export default function SuppliersPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  useDocumentMeta("seo.suppliers_title", "seo.suppliers_description");
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [coupleSuppliers, setCoupleSuppliers] = useState<CoupleSupplier[]>([]);
  const [coupleId, setCoupleId] = useState<number | null>(null);
  /** Currency comes from /api/couples/current. Falls back to HUF when the
   *  couple is still loading so the price chips render through the empty
   *  state cleanly. */
  const [currency, setCurrency] = useState<Currency>("HUF");
  const [targetGuestCount, setTargetGuestCount] = useState<number | null>(null);
  // The couple's wedding day, and the listings known to be taken on whichever
  // day the date filter is pointing at.
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<ReadonlySet<string>>(() => new Set());
  // Wedding-venue pin (couple.location_lat/lng). Feeds the comparison dialog's
  // distance row — null until the couple sets a venue in onboarding/settings.
  const [coupleLocation, setCoupleLocation] = useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });
  // ISO alpha-2 country the wedding is in — biases the geocoder fallback so a
  // HU couple typing an ambiguous town gets the Hungarian match, not a foreign
  // namesake. Empty until the couple loads.
  const [coupleCountry, setCoupleCountry] = useState("");
  // The set of countries the curated catalogue covers (with counts), from the
  // list response. Feeds the country picker's option list. The full catalogue
  // is fetched once and the country filter is applied client-side (like price /
  // city / guests), so switching country is instant and shareable via the URL.
  const [availableCountries, setAvailableCountries] = useState<SupplierCountryCount[]>([]);
  // The full HU settlement gazetteer is lazy-loaded (it's ~100 KB of data that
  // no other page needs). `gazetteerReady` flips once it's registered so the
  // town-resolving memos recompute and pick up every settlement. `geoResolved`
  // bumps whenever a Nominatim geocoder hit registers a new town, forcing the
  // same recompute so freshly-resolved places surface in the results + options.
  const [gazetteerReady, setGazetteerReady] = useState(false);
  const [geoResolved, setGeoResolved] = useState(0);
  // Couple-side context for the comparison dialog. We pre-load both so
  // opening the dialog doesn't trigger a network round-trip — the payloads
  // are small (a few rows each) and they also feed other parts of the page.
  const [supplierCosts, setSupplierCosts] = useState<CoupleSupplierCost[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  // Per-category "this is our pick" selection. Keys are SupplierCategory,
  // values are supplier IDs (curated slug, "c{N}" community id, or DIY hex).
  // One pick per category — choosing a new card replaces the prior pick.
  const [selection, setSelectionState] = useState<SelectionMap>({});
  const [activeGroup, setActiveGroup] = useState<SupplierGroup | null>(null);
  const [activeCat, setActiveCat] = useState<SupplierCategory | null>(null);
  // Registered planner ACCOUNTS (a consent/invite flow, distinct from the
  // outbound-contact directory). They surface as a slim strip atop the real
  // `wedding_planner` category (the curated planner listings live in the grid).
  const [planners, setPlanners] = useState<PlannerDirectoryEntry[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);
  // Country + price + guest count, behind one chip. See the dialog below.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [diyOpen, setDiyOpen] = useState(false);
  const [diyEditing, setDiyEditing] = useState<CoupleSupplier | null>(null);
  // "Már foglaltam" is a peer of "csinálom magam" / "nem kell" in the category
  // row's action group, so its disclosure lives here rather than inside the
  // card — the chip is the affordance, the card is just the body it reveals.
  const [bookedOpen, setBookedOpen] = useState(false);
  // The form is scoped to one sub-category, so moving to another collapses it.
  useEffect(() => setBookedOpen(false), [activeCat]);
  // Temporarily lift the settled-category collapse (see `collapseSettled`) so a
  // couple who wants to change their mind can see the rest of the trade again.
  // It's a peek at one part of the directory, not a preference, so it resets
  // when they move to another category.
  const [showSettledSiblings, setShowSettledSiblings] = useState(false);
  useEffect(() => setShowSettledSiblings(false), [activeCat, activeGroup]);
  // Report dialog state. `reporting` holds the numeric id + name; null when closed.
  const [reporting, setReporting] = useState<{ id: number; name: string } | null>(null);
  const { user } = useAuth();
  const toast = useToast();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Couple shortlist ("saved" star). Server-side + shared between partners via
  // the supplier_saved store; starts empty and hydrates once we know the couple.
  const [saved, setSavedState] = useState<Set<string>>(new Set());
  // Step-chain overflow detection. We render the right-edge fade only when
  // the row actually overflows so the gradient doesn't leave a phantom
  // white slab on wide screens where every group already fits.
  const chainScrollRef = useRef<HTMLDivElement | null>(null);
  const [chainOverflows, setChainOverflows] = useState(false);
  useEffect(() => {
    const el = chainScrollRef.current;
    if (!el) return;
    const measure = () => setChainOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Filter state lives in URL params so back-button restores it.
  const query = params.get("q") ?? "";
  // Pre-normalized form used both by the free-text filter and by the
  // per-card distance badge (avoids re-folding per supplier).
  const queryNorm = useMemo(() => normalize(query.trim()), [query]);
  const cityFilter = params.get("city") ?? "";
  const showSavedOnly = params.get("saved") === "1";
  const showPickedOnly = params.get("picked") === "1";
  // Verified-only: keep just registered vendors (source === "claimed", the
  // blue-badge listings). Drops curated/community entries and DIY rows.
  const showVerifiedOnly = params.get("verified") === "1";
  const sortMode: "top" | "alpha" | "price_asc" | "price_desc" = (() => {
    const v = params.get("sort");
    if (v === "alpha" || v === "price_asc" || v === "price_desc") return v;
    return "top";
  })();
  // viewMode controls how the result set is presented:
  //   "grid" → 2-column cards (default)
  //   "line" → single-column compact rows
  //   "map"  → lazy-loaded Leaflet map
  // Legacy `?view=list` URLs are coerced to "grid" so old bookmarks still work.
  const viewMode: "grid" | "line" | "map" = (() => {
    const v = params.get("view");
    if (v === "map") return "map";
    if (v === "line") return "line";
    return "grid";
  })();
  // Price band: single exact 1..5 match. Five simple dots in a row; clicking
  // dot N shows suppliers whose declared band equals N (not "up to N"). Click
  // the same dot again to clear. Suppliers without a declared price band pass
  // through so community submissions with a blank field stay visible.
  const priceBand = (() => {
    const raw = params.get("price");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
  })();
  // Comparison set: 1–4 supplier ids the couple ticked for side-by-side
  // comparison. Lives in URL (`?compare=id1,id2,id3`) so back-button and
  // bookmarks keep the set; cap at 4 so columns stay readable inside the
  // dialog.
  const COMPARE_MAX = 4;
  const compareIds = useMemo<string[]>(() => {
    const raw = params.get("compare");
    if (!raw) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw.split(",")) {
      const trimmed = id.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
        if (out.length >= COMPARE_MAX) break;
      }
    }
    return out;
  }, [params]);
  const [compareOpen, setCompareOpen] = useState(false);
  // Guest count: positive integer. Suppliers without a declared capacity
  // pass through (otherwise this filter would hide every photographer).
  const guestsFilter = (() => {
    const raw = params.get("guests");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();

  // The date the couple is shopping FOR. Defaults to the wedding day, because
  // that is the question behind every supplier search, and stays editable
  // because the second question is usually a different day: the welcome dinner,
  // a shortlisted alternative date, an engagement shoot. `?date=` only appears
  // in the URL once it differs from the wedding day, same rule as `?country=`,
  // so the resting state keeps a clean URL.
  const dateFilter = params.get("date") ?? weddingDate;
  const dateIsWedding = weddingDate !== null && dateFilter === weddingDate;
  function setDateFilter(next: string | null) {
    const p = new URLSearchParams(params);
    if (!next || next === weddingDate) p.delete("date");
    else p.set("date", next);
    setParams(p, { replace: true });
  }

  // Country scope lives in the URL (`?country=`) so it survives refresh and is
  // shareable, just like city / guests / view. Absent → the couple's own
  // country (localised default); an ISO code scopes to it; "all" drops the
  // scope. The couple's country is the "home" state, so selecting it clears the
  // param to keep the URL tidy.
  const countryParam = params.get("country");
  const countrySelection = countryParam ?? (coupleCountry || "all");
  const countryScope = countrySelection === "all" ? null : countrySelection;
  function setCountryFilter(next: string) {
    const home = coupleCountry || "all";
    const p = new URLSearchParams(params);
    if (next === home) p.delete("country");
    else p.set("country", next);
    setParams(p, { replace: true });
  }

  // Who is taken on the chosen day. Refetched when the day changes; the
  // catalogue itself is never refetched, which is the whole reason this is a
  // separate endpoint. A failure clears the set rather than keeping a stale one:
  // hiding a supplier because of an answer we no longer trust is the worse error.
  useEffect(() => {
    if (!dateFilter) {
      setUnavailableIds(new Set());
      return;
    }
    let cancelled = false;
    supplierApi
      .unavailableOn(dateFilter)
      .then((r) => {
        if (!cancelled) setUnavailableIds(new Set(r.supplier_ids));
      })
      .catch(() => {
        if (!cancelled) setUnavailableIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [dateFilter]);

  function setQuery(next: string) {
    const p = new URLSearchParams(params);
    if (next.trim()) p.set("q", next);
    else p.delete("q");
    setParams(p, { replace: true });
  }
  function setCityFilter(next: string) {
    const p = new URLSearchParams(params);
    if (next) p.set("city", next);
    else p.delete("city");
    setParams(p, { replace: true });
  }
  // Editable text mirror of the committed `cityFilter` (which lives in the
  // URL). Free typing updates only this; the filter commits on select/clear.
  // Re-syncs whenever the URL value changes (back-button, deep link).
  const [cityInput, setCityInput] = useState(cityFilter);
  useEffect(() => {
    setCityInput(cityFilter);
  }, [cityFilter]);

  // Lazy-load the full Hungarian settlement gazetteer on mount and register it
  // so ANY typed town (e.g. "Zebegény") resolves to a coordinate for the
  // radius / nearest-first proximity match — not just the ~200 curated towns.
  // Kept out of the initial bundle via dynamic import; it's ~100 KB of data.
  useEffect(() => {
    let alive = true;
    import("../lib/hu_gazetteer")
      .then((m) => {
        registerTowns(m.HU_GAZETTEER);
        if (alive) setGazetteerReady(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Geocoder fallback: when the typed town / query resolves to no local
  // coordinate (not curated, not in the gazetteer — a foreign or very obscure
  // place), ask the existing Nominatim-backed /api/places/search to forward-
  // geocode it, then register the hit so the synchronous proximity path picks
  // it up. Debounced, and only fires once the gazetteer has loaded so we don't
  // hit the network for towns the offline data already covers.
  useEffect(() => {
    if (!gazetteerReady) return;
    const term = (cityInput.trim() || query.trim()).trim();
    if (term.length < 3) return;
    // Already placeable locally (curated town, gazetteer settlement, anchor
    // prefix) — no need to spend a Nominatim call.
    if (nearbyTownLabel(normalize(term))) return;
    // The offline typeahead still has candidates for this fragment (a partial
    // HU town the user is mid-typing) — let them pick one instead of burning a
    // geocoder call. Only a term with ZERO offline matches (a foreign / very
    // obscure place) falls through to Nominatim.
    if (searchTowns(term, 1).length > 0) return;
    let alive = true;
    const tid = window.setTimeout(() => {
      placesApi
        .search(term, { country: coupleCountry || undefined, lang: locale })
        .then(({ places }) => {
          if (!alive) return;
          const hit = places.find((p) => p.lat != null && p.lng != null);
          if (!hit || hit.lat == null || hit.lng == null) return;
          registerTown(hit.locality ?? hit.primary, hit.lat, hit.lng, term);
          setGeoResolved((n) => n + 1);
        })
        .catch(() => undefined);
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(tid);
    };
  }, [cityInput, query, coupleCountry, gazetteerReady, locale]);
  // Drop every "narrowing" filter (search text, city, category chain, price,
  // guests) plus the sibling shortlist toggle. The saved / picked chips are
  // meant to surface the user's full marked set in one tap, so any leftover
  // filter would be a confusing subtractor — they can re-apply filters after.
  function clearNarrowingFilters(p: URLSearchParams) {
    p.delete("q");
    p.delete("city");
    p.delete("price");
    p.delete("guests");
    setActiveGroup(null);
    setActiveCat(null);
  }
  function toggleSavedFilter() {
    const p = new URLSearchParams(params);
    if (showSavedOnly) {
      p.delete("saved");
    } else {
      p.set("saved", "1");
      p.delete("picked");
      clearNarrowingFilters(p);
    }
    setParams(p, { replace: true });
  }
  function togglePickedFilter() {
    const p = new URLSearchParams(params);
    if (showPickedOnly) {
      p.delete("picked");
    } else {
      p.set("picked", "1");
      p.delete("saved");
      clearNarrowingFilters(p);
    }
    setParams(p, { replace: true });
  }
  function toggleVerifiedFilter() {
    const p = new URLSearchParams(params);
    if (showVerifiedOnly) p.delete("verified");
    else p.set("verified", "1");
    setParams(p, { replace: true });
  }
  function toggleCompare(id: string) {
    const p = new URLSearchParams(params);
    const current = compareIds;
    let next: string[];
    if (current.includes(id)) {
      next = current.filter((c) => c !== id);
    } else if (current.length >= COMPARE_MAX) {
      // Silently no-op past the cap — the per-card toggle is disabled there,
      // but defensive guard keeps the URL well-formed.
      return;
    } else {
      next = [...current, id];
    }
    if (next.length === 0) p.delete("compare");
    else p.set("compare", next.join(","));
    setParams(p, { replace: true });
  }
  function clearCompare() {
    const p = new URLSearchParams(params);
    p.delete("compare");
    setParams(p, { replace: true });
    setCompareOpen(false);
  }
  function setSortMode(next: "top" | "alpha" | "price_asc" | "price_desc") {
    const p = new URLSearchParams(params);
    if (next === "top") p.delete("sort");
    else p.set("sort", next);
    setParams(p, { replace: true });
  }
  function setViewMode(next: "grid" | "line" | "map") {
    const p = new URLSearchParams(params);
    if (next === "grid") p.delete("view");
    else p.set("view", next);
    setParams(p, { replace: true });
  }
  function setPriceBand(next: number | null) {
    const p = new URLSearchParams(params);
    p.delete("price_max"); // legacy param — keep URL clean if it was set
    if (next === null) p.delete("price");
    else p.set("price", String(next));
    setParams(p, { replace: true });
  }

  // What the "Szűrők" chip counts: the scoping filters that live inside its
  // dialog. Guest count is deliberately not counted — the couple didn't set it
  // here, it's mirrored from the budget page. Country only counts when it is
  // NOT the couple's own country, which is the resting state.
  const scopeFilterCount =
    (countrySelection !== (coupleCountry || "all") ? 1 : 0) +
    (priceBand !== null ? 1 : 0) +
    // Same rule as country: the resting state (the wedding day) isn't a filter
    // the couple set, so it doesn't earn a number on the chip.
    (dateFilter !== null && !dateIsWedding ? 1 : 0);
  function clearScopeFilters() {
    const p = new URLSearchParams(params);
    p.delete("country");
    p.delete("price");
    p.delete("price_max");
    p.delete("date");
    setParams(p, { replace: true });
  }

  // Optimistic vote: flip the card immediately, roll back if the server says no.
  const onVote = useCallback(async (supplierId: string, nextVote: -1 | 0 | 1) => {
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== supplierId) return s;
        const delta = nextVote - s.user_vote;
        return { ...s, user_vote: nextVote, votes_score: s.votes_score + delta };
      }),
    );
    try {
      const r = await supplierApi.vote(supplierId, nextVote);
      setItems((prev) =>
        prev.map((s) =>
          s.id === supplierId ? { ...s, votes_score: r.votes_score, user_vote: r.user_vote } : s,
        ),
      );
    } catch {
      // Reload from server on failure so we don't carry stale optimistic state.
      // Full catalogue (`country=all`) to match the client-side scoping model.
      supplierApi
        .list(undefined, "all")
        .then((r) => setItems(r.suppliers))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // Fetch the FULL catalogue (`country=all`) once and scope by country on the
    // client, so switching the country picker is instant, keeps the chain
    // counts + map in sync, and is shareable via `?country=`. The Vendégszám
    // default prefers the live cost-planning slider value from /app/budget
    // (kept in localStorage) over the static onboarding target, so the two
    // pages stay in sync without round-trips.
    Promise.all([supplierApi.list(undefined, "all"), coupleSupplierApi.list(), coupleApi.current()])
      .then(([dir, mine, couple]) => {
        setItems(dir.suppliers);
        setAvailableCountries(dir.countries);
        setCoupleSuppliers(mine.suppliers);
        const id = couple.couple?.id ?? null;
        setCoupleId(id);
        setTargetGuestCount(couple.couple?.target_guest_count ?? null);
        setWeddingDate(couple.couple?.wedding_date ?? null);
        if (couple.couple) {
          setCurrency(couple.couple.currency ?? "HUF");
          setCoupleCountry(couple.couple.country ?? "");
          setCoupleLocation({
            lat: couple.couple.location_lat,
            lng: couple.couple.location_lng,
          });
        }
        // Seed the shared cost-planning cache from the couple we just
        // fetched so the Vendégszám filter and the /app/budget slider
        // start on the same value.
        if (couple.couple) hydrateCostPlanningCount(couple.couple);
        if (id !== null) {
          setSelectionState(readSelection(id));
          setSavedState(readSavedStore(id));
        }
        // One-shot IMPRESSION ping per mount: tell the analytics ingest which
        // directory cards this session actually sees. Scope it to the country
        // that's initially shown (the URL param if present, else the couple's
        // own country) so a session isn't credited views for the whole EU when
        // it only ever looked at one country. We swallow errors — the page
        // renders fine even if the ingest is down.
        //
        // NOT a `view`: this fires for every card in the country pool, so as a
        // view it made "views" mean "catalogue page-loads", identical for every
        // supplier in the country. Profile opens are pinged from the detail
        // pages instead, which is what the vendor's own stats quote.
        const initialCountry = params.get("country") ?? couple.couple?.country ?? "";
        const initialScope = initialCountry && initialCountry !== "all" ? initialCountry : null;
        // Impressions follow what is DRAWN, so this is the in-scope half only.
        // An out-of-country verified vendor stopped being a card the moment it
        // stopped being a result (see `partitionByCountryScope` below), and
        // crediting it anyway would quote a Budapest florist impressions off an
        // Italian couple's page it never appeared on. The most that vendor can
        // reach here is a line in the capped tail, which is not a card. Same
        // predicate as the grid, which is what keeps the two from drifting
        // apart the way they did before.
        const shown = dir.suppliers.filter((s) => !isOutOfCountryScope(s, initialScope));
        if (shown.length > 0) {
          supplierApi
            .recordEvents(shown.map((s) => ({ supplier_id: s.id, type: "impression" })))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    // Per-supplier quotes + category budgets feed the comparison dialog.
    // Fire in parallel with the main load; either failing is fine — the
    // dialog gracefully falls back to "no quote" / "no budget" cells.
    supplierCostApi
      .list()
      .then((r) => setSupplierCosts(r.costs))
      .catch(() => undefined);
    budgetApi
      .listLines()
      .then((r) => setBudgetLines(r.lines))
      .catch(() => undefined);
    // params is read once at mount to pick the initial view-ping scope; we
    // deliberately don't re-run the whole bootstrap when the URL changes.
  }, []);

  // Wedding-planner directory. Feeds the "Esküvőszervező" chain step + its grid.
  // A failed load just leaves the step hidden (planners stays empty), matching
  // the previous rail's silent-degrade behaviour.
  useEffect(() => {
    let cancelled = false;
    couplePlannerApi
      .directory()
      .then((r) => {
        if (!cancelled) setPlanners(r.planners);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlannerChanged = useCallback(
    (id: number, status: PlannerDirectoryEntry["link_status"]) => {
      setPlanners((prev) =>
        prev.map((p) => (p.planner_user_id === id ? { ...p, link_status: status } : p)),
      );
    },
    [],
  );

  // Cross-tab pick sync — partner B picks a venue in another tab, we
  // reflect it here without a refresh.
  useEffect(() => {
    if (coupleId === null) return;
    return subscribeSelection(coupleId, (next) => setSelectionState(next));
  }, [coupleId]);

  // Cross-tab shortlist sync — partner B saves a photographer elsewhere, the
  // star + saved filter count reflect it here without a refresh.
  useEffect(() => {
    if (coupleId === null) return;
    return subscribeSaved(coupleId, (next) => setSavedState(next));
  }, [coupleId]);

  const togglePicked = useCallback(
    (supplier: DirectorySupplier | CoupleSupplier) => {
      if (coupleId === null) {
        toast.info(t("suppliers.save_no_couple"));
        return;
      }
      const cat = supplier.category;
      const isPicked = selection[cat] === supplier.id;
      const next = setSelection(coupleId, cat, isPicked ? null : supplier.id);
      setSelectionState(next);
      if (!isPicked) celebrateSelection(cat, selection, next);
    },
    [coupleId, selection, toast, t],
  );

  // Adopt a directory listing instead of minting a private "Saját" copy of it.
  // Offered wherever the couple types a vendor name that is already on Weddly
  // (the DIY modal's twin notice, and the repair action on an existing
  // duplicate card). The listing becomes their pick for its category, so they
  // get its photos, address and reviews rather than a bare name.
  const adoptDirectorySupplier = useCallback(
    (supplier: DirectorySupplier) => {
      if (coupleId === null) {
        toast.info(t("suppliers.save_no_couple"));
        return;
      }
      const next = setSelection(coupleId, supplier.category, supplier.id);
      setSelectionState(next);
      setHighlightId(supplier.id);
      celebrateSelection(supplier.category, selection, next);
      toast.success(t("suppliers.twin.adopted_toast", { name: supplier.name }));
    },
    [coupleId, selection, toast, t],
  );

  // The repair action for a duplicate that already exists: a private row the
  // couple created before anything checked the directory, standing beside the
  // real listing for the same business. One click binds the row to the listing
  // and moves the pick there, so the card becomes the listing's — with its
  // photo, address and reviews. Nothing is deleted: the row keeps the couple's
  // notes, price and payment schedule, it just stops being its own business.
  const repairDuplicate = useCallback(
    async (entry: CoupleSupplier) => {
      const match = entry.directory_match;
      if (!match || coupleId === null) return;
      try {
        const r = await coupleSupplierApi.adopt(entry.id);
        setCoupleSuppliers((prev) => prev.map((p) => (p.id === entry.id ? r.supplier : p)));
        // The server already moved the pick row; this mirrors it into local +
        // cross-tab state so the listing's card flips without a refetch.
        setSelectionState(setSelection(coupleId, match.category, r.listing_id));
        setHighlightId(r.listing_id);
        toast.success(t("suppliers.twin.adopted_toast", { name: match.name }));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
      }
    },
    [coupleId, toast, t],
  );

  // Listings the couple's own rows are bound to. A bound row is NOT drawn as a
  // second card — the listing's card represents it (and carries its edit
  // pencil), which is the whole point of the binding. Keyed by listing id.
  const boundByListingId = useMemo(() => {
    const m = new Map<string, CoupleSupplier>();
    for (const s of coupleSuppliers) {
      if (s.listing_id) m.set(s.listing_id, s);
    }
    return m;
  }, [coupleSuppliers]);

  // "Magam szervezem" — the couple decides to organize the wedding themselves
  // instead of hiring a planner. Recorded as a sentinel pick on the
  // wedding_planner category so it persists server-side + cross-partner and
  // greens the planning step via the normal pick progress machinery. Toggling
  // it off clears the pick.
  const selfOrganized = selection.wedding_planner === SELF_ORGANIZED_PICK;
  const toggleSelfOrganize = useCallback(() => {
    if (coupleId === null) {
      toast.info(t("suppliers.save_no_couple"));
      return;
    }
    const turningOn = !selfOrganized;
    const next = setSelection(coupleId, "wedding_planner", turningOn ? SELF_ORGANIZED_PICK : null);
    setSelectionState(next);
    if (turningOn) {
      // Fire the confetti, then immediately close the "Szervezés & koordináció"
      // tab so the step turns sage in the chain right away.
      celebrateSelection("wedding_planner", selection, next);
      setActiveGroup(null);
      setActiveCat(null);
    }
  }, [coupleId, selfOrganized, selection, toast, t]);

  // "Nincs rá szükségem" — the couple marks the active sub-category as one they
  // don't need (no lighting, no transport, ...). Recorded as the NOT_NEEDED_PICK
  // sentinel on that category so it persists cross-partner and greens the runner
  // segment via the same pick machinery. Only offered when the category has no
  // real booking yet (a real pick already resolves it); toggling off clears it.
  const activeCatPick = activeCat ? (selection[activeCat] ?? null) : null;
  const activeCatNotNeeded = activeCatPick === NOT_NEEDED_PICK;
  const activeCatHasRealPick = activeCatPick !== null && activeCatPick !== NOT_NEEDED_PICK;
  const toggleNotNeeded = useCallback(() => {
    if (coupleId === null) {
      toast.info(t("suppliers.save_no_couple"));
      return;
    }
    if (!activeCat) return;
    const turningOn = !activeCatNotNeeded;
    const next = setSelection(coupleId, activeCat, turningOn ? NOT_NEEDED_PICK : null);
    setSelectionState(next);
    // Celebrate when this flips the whole group (or the whole chain) green.
    if (turningOn) celebrateSelection(activeCat, selection, next);
  }, [coupleId, activeCat, activeCatNotNeeded, selection, toast, t]);

  // Once we know the couple, default the URL's `guests` filter — preferring
  // the live cost-planning slider value over the static onboarding target.
  // Only fires when the URL doesn't already carry a value; subsequent edits
  // (including clearing) take precedence.
  //
  // `seededGuests` is what makes that last clause true. Without it the effect
  // has no memory of having seeded, so it re-ran on the very next render after
  // any deliberate clear and put the value straight back. The one caller
  // that clears `guests` is `clearNarrowingFilters`, i.e. the picked / saved
  // chips. So the toggle whose whole job is "show my full marked set in one
  // tap" landed on `?picked=1&guests=95`, and a couple whose chosen venue is
  // sized for 80 tapped a chip reading "(1)" and got an empty grid. Every other
  // narrowing param stays cleared because nothing re-seeds them; this one had a
  // seeder and no latch. Reported 2026-08-05.
  const seededGuests = useRef(false);
  useEffect(() => {
    if (coupleId === null) return;
    if (seededGuests.current) return;
    if (params.has("guests")) {
      seededGuests.current = true;
      return;
    }
    const stored = readCostPlanningCount(coupleId);
    const seed = stored ?? targetGuestCount;
    if (seed === null || seed <= 0) return;
    seededGuests.current = true;
    const p = new URLSearchParams(params);
    p.set("guests", String(seed));
    setParams(p, { replace: true });
  }, [coupleId, targetGuestCount, params, setParams]);

  // Listen for cross-tab cost-planning slider changes (e.g. partner B
  // dragged the slider on /app/budget in another tab). Reflect into the URL
  // so the active filter follows along without a manual refresh.
  useEffect(() => {
    if (coupleId === null) return;
    return subscribeCostPlanningCount(coupleId, (next) => {
      const p = new URLSearchParams(params);
      if (next === null || next <= 0) p.delete("guests");
      else p.set("guests", String(next));
      setParams(p, { replace: true });
    });
  }, [coupleId, params, setParams]);

  // Scroll the freshly-submitted card into view + drop the highlight after a
  // beat. Without this, a submitter sees the modal close and may not notice
  // their entry landed at the top of the list.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.querySelector<HTMLElement>(`[data-supplier-id="${highlightId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const tid = window.setTimeout(() => setHighlightId(null), 2500);
    return () => window.clearTimeout(tid);
  }, [highlightId]);

  const toggleSaved = useCallback(
    (id: string) => {
      if (coupleId === null) {
        toast.info(t("suppliers.save_no_couple"));
        return;
      }
      setSavedState(setSavedStore(coupleId, id, !saved.has(id)));
    },
    [coupleId, saved, toast, t],
  );

  // True for a card that is only in the payload because it is verified — the
  // country being browsed is not its own. DIY entries carry no country and are
  // never out of scope. Every caller below drops these from what it counts,
  // draws or lists; the labelled tail at the bottom of the grid is the one
  // place they are shown, and it reads them off the other half of the split.
  const isOutOfScope = useCallback(
    (s: { source: string; country?: string }) => isOutOfCountryScope(s, countryScope),
    [countryScope],
  );

  // Directory rows scoped to the picked country. Everything downstream — the
  // result list, the chain/sub-category counts, the city autocomplete, and the
  // search suggestions — reads from this so the country scope is applied once
  // and consistently across grid + map. "Mind"/All leaves the full set through.
  //
  // Verified vendors are exempt from the DROP: a registered vendor is a
  // business that is actually ON Weddly, and the API deliberately leaves
  // claimed listings un-scoped for exactly that reason. Filtering them away
  // here undid that — a verified Austrian venue existed in the payload and was
  // thrown out by the client before it could ever render. What the exemption
  // buys them is a place in the labelled tail under the grid, not a place among
  // the results: see `partitionByCountryScope` below for why sorting them last
  // was never enough.
  const scopedItems = useMemo(
    () =>
      countryScope
        ? items.filter((s) => s.country === countryScope || s.source === "claimed")
        : items,
    [items, countryScope],
  );

  // Cities derived from the scoped list, so the town autocomplete only offers
  // cities that belong to the selected country (no "Budapest" while browsing
  // Romania). The out-of-country verified cards are excluded here too: "Antibes,
  // FR" has no business in a Hungarian couple's town picker, and offering a town
  // whose vendors aren't results would filter the grid down to nothing.
  // Sorted alphabetically by locale rules.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const s of scopedItems) if (s.city && !isOutOfScope(s)) set.add(s.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale === "hu" ? "hu" : "en"));
  }, [scopedItems, locale, isOutOfScope]);

  // Google-style suggestions for the free-text bar: a short mixed list of
  // matching towns, categories, and supplier names. Selecting a row routes to
  // the right action (fill the query, jump to a card, or apply a category).
  const searchSuggestions = useMemo<ComboOption[]>(() => {
    const raw = query.trim();
    const qn = normalize(raw);
    if (qn.length < 2) return [];
    const out: ComboOption[] = [];

    // Towns: real supplier cities first, then dictionary towns nearby.
    const citySeen = new Set<string>();
    for (const c of cities) {
      if (out.filter((o) => o.id.startsWith("city:")).length >= 3) break;
      if (normalize(c).includes(qn)) {
        citySeen.add(normalize(c));
        out.push({ id: `city:${c}`, label: c, icon: MapPin, hint: t("suppliers.suggest_city") });
      }
    }
    for (const town of searchTowns(raw, 8)) {
      if (out.filter((o) => o.id.startsWith("city:")).length >= 3) break;
      if (!citySeen.has(normalize(town))) {
        citySeen.add(normalize(town));
        out.push({
          id: `city:${town}`,
          label: town,
          icon: MapPin,
          hint: t("suppliers.suggest_city"),
        });
      }
    }

    // Categories (localized labels).
    let catCount = 0;
    for (const c of ALL_CATEGORIES) {
      if (catCount >= 2) break;
      const label = t(`suppliers.cat.${c}`);
      if (normalize(label).includes(qn)) {
        out.push({
          id: `cat:${c}`,
          label,
          icon: CATEGORY_ICON[c],
          hint: t("suppliers.suggest_category"),
        });
        catCount++;
      }
    }

    // Supplier names.
    let supCount = 0;
    for (const s of scopedItems) {
      if (supCount >= 3) break;
      if (normalize(s.name).includes(qn)) {
        out.push({
          id: `sup:${s.id}`,
          label: s.name,
          icon: Store,
          hint: s.city ?? t("suppliers.suggest_supplier"),
        });
        supCount++;
      }
    }

    return out.slice(0, 7);
  }, [query, cities, scopedItems, t, gazetteerReady, geoResolved]);

  // Town suggestions for the city filter: supplier cities first, then the
  // wider dictionary so couples can pick a settlement with no listing of its
  // own (and get the radius fallback).
  const cityOptions = useMemo<ComboOption[]>(() => {
    const raw = cityInput.trim();
    const qn = normalize(raw);
    if (qn.length < 1) return [];
    const seen = new Set<string>();
    const out: ComboOption[] = [];
    for (const c of cities) {
      if (out.length >= 7) break;
      if (normalize(c).includes(qn)) {
        seen.add(normalize(c));
        out.push({ id: c, label: c, icon: MapPin });
      }
    }
    for (const town of searchTowns(raw, 12)) {
      if (out.length >= 7) break;
      if (!seen.has(normalize(town))) {
        seen.add(normalize(town));
        out.push({ id: town, label: town, icon: MapPin });
      }
    }
    return out;
  }, [cityInput, cities, gazetteerReady, geoResolved]);

  // When the committed town has no supplier of its own, the distance (rounded
  // up to 5 km) to the nearest in-radius result — shown as a "+N km" suffix.
  const cityNearbyKm = useMemo<number | null>(() => {
    if (!cityFilter) return null;
    if (scopedItems.some((s) => s.city === cityFilter)) return null;
    const qn = normalize(cityFilter);
    let min = Number.POSITIVE_INFINITY;
    for (const s of scopedItems) {
      const km = distanceKmForQuery(qn, s.city, { lat: s.lat, lng: s.lng });
      if (km != null && km <= NEARBY_RADIUS_KM && km < min) min = km;
    }
    if (!Number.isFinite(min)) return null;
    return Math.max(5, Math.ceil(min / 5) * 5);
  }, [cityFilter, scopedItems, gazetteerReady, geoResolved]);

  // Items after all the non-category filters (city, saved, price, guests,
  // free-text). Used twice: as the base for the displayed list AND to compute
  // counts for the chain steps + sub-category pills — pills show "how many
  // would appear if I picked this", so they must ignore the active category.
  //
  // DIY entries are merged in here so the count badges include them too.
  // City / saved / price-band / capacity filters do not apply to DIY entries
  // (they don't have those fields); the free-text search hits name + notes.
  const filteredBeforeCategory = useMemo<(DirectorySupplier | CoupleSupplier)[]>(() => {
    let dir = scopedItems;
    if (cityFilter) {
      // Exact-town match is the common case. When the typed settlement has no
      // supplier of its own but is a known town, widen to a radius match so
      // the user still sees the nearest options (the field shows "+N km").
      const exact = dir.filter((s) => s.city === cityFilter);
      if (exact.length > 0) {
        dir = exact;
      } else {
        const qn = normalize(cityFilter);
        dir = dir.filter((s) => {
          const km = distanceKmForQuery(qn, s.city, { lat: s.lat, lng: s.lng });
          return km != null && km <= NEARBY_RADIUS_KM;
        });
      }
    }
    if (showSavedOnly) dir = dir.filter((s) => saved.has(s.id));
    if (showVerifiedOnly) dir = dir.filter((s) => s.source === "claimed");
    if (showPickedOnly) {
      const pickedIds = new Set(Object.values(selection));
      dir = dir.filter((s) => pickedIds.has(s.id));
    }
    if (priceBand !== null) {
      // Exact-match: only suppliers whose declared band equals the picked
      // value. Suppliers without a declared price band pass through so
      // community submissions with a blank field stay visible.
      dir = dir.filter((s) => s.price_band === null || s.price_band === priceBand);
    }
    if (guestsFilter !== null) {
      dir = dir.filter((s) => {
        const max = s.capacity_max ?? 0;
        if (max === 0) return true;
        const min = s.capacity_min ?? 0;
        return guestsFilter >= min && guestsFilter <= max;
      });
    }
    // Date: subtractive only. `unavailableIds` holds the listings with a real
    // reason on file for being taken that day; everyone else is unknown, not
    // free, and stays in the list. An empty set (nothing loaded yet, or a
    // catalogue of unclaimed entries) therefore hides nothing.
    if (unavailableIds.size > 0) {
      dir = dir.filter((s) => !unavailableIds.has(s.id));
    }
    const q = queryNorm;
    if (q) {
      // Bidirectional metro expansion: the query may EITHER be the
      // anchor name itself (e.g. "Budapest" → group key "budapest")
      // OR a non-anchor town inside a group (e.g. "Zsámbék" → still
      // group key "budapest"). Both should pull up the whole metro.
      // `metroKeysForQuery` returns the matching group key(s) — empty
      // when the query isn't a known town. Haystacks already include
      // `metroKeysForCity(s.city)` for the supplier-side direction.
      const expandedKeys = metroKeysForQuery(q);
      dir = dir.filter((s) => {
        const hay = normalize(
          `${s.name} ${s.city} ${s.blurb_hu} ${s.blurb_en} ${metroKeysForCity(s.city)}`,
        );
        if (hay.includes(q)) return true;
        for (const k of expandedKeys) {
          if (hay.includes(k)) return true;
        }
        // Radius proximity: when the query is a known town, include any
        // supplier within NEARBY_RADIUS_KM by actual crow-flies distance —
        // no longer gated by metro-group membership, so a venue one group
        // over but genuinely close still surfaces.
        const km = distanceKmForQuery(q, s.city, { lat: s.lat, lng: s.lng });
        if (km != null && km <= NEARBY_RADIUS_KM) return true;
        return false;
      });
    }
    // Saved-only view is a directory feature; DIY entries are always "yours"
    // so they don't belong in the saved-list summary either way. Verified-only
    // is registered vendors only, so DIY rows are likewise excluded.
    let mine = showSavedOnly || showVerifiedOnly ? [] : coupleSuppliers;
    // One business, one card. A row bound to a listing we actually loaded is
    // represented BY that listing's card (which carries its edit pencil), so
    // drawing it here as well would put the duplicate back. A bound row whose
    // listing isn't in the payload — still pending moderation, or scoped out by
    // country — keeps its own card, otherwise the couple's own vendor would
    // vanish from their own list.
    const loadedIds = new Set(items.map((it) => it.id));
    mine = mine.filter((s) => !(s.listing_id && loadedIds.has(s.listing_id)));
    if (showPickedOnly) {
      const pickedIds = new Set(Object.values(selection));
      // A bound row's pick points at its LISTING, not at the row id.
      mine = mine.filter((s) => pickedIds.has(s.listing_id ?? s.id));
    }
    if (q) {
      mine = mine.filter((s) => normalize(`${s.name} ${s.notes ?? ""}`).includes(q));
    }
    return [...mine, ...dir];
  }, [
    scopedItems,
    items,
    coupleSuppliers,
    cityFilter,
    showSavedOnly,
    showVerifiedOnly,
    saved,
    showPickedOnly,
    selection,
    priceBand,
    guestsFilter,
    unavailableIds,
    query,
    gazetteerReady,
    geoResolved,
  ]);

  // Once a category is settled, the rest of that trade is noise: a couple who
  // has booked their venue does not need 289 more venues under it. So a settled
  // category shows the card they settled it with and nothing else — whether
  // that is a directory listing they picked, a vendor they added themselves, or
  // a "csinálom magam" entry. A category the couple has RULED OUT ("nincs rá
  // szükségem" / "magam szervezem") shows nothing at all, and `settledEmptyNote`
  // below is the line of copy that owes the couple an explanation for it.
  //
  // The collapse stands down for the filters that ARE a request for a list:
  // free-text search, the shortlist, verified-only and picked-only all mean the
  // couple asked to see a set, and answering with one card would be ignoring
  // them. `showSettledSiblings` is the couple lifting it by hand.
  const collapseSettled =
    !showSettledSiblings && !queryNorm && !showSavedOnly && !showVerifiedOnly && !showPickedOnly;

  const shownBeforeCategory = useMemo(() => {
    if (!collapseSettled) return filteredBeforeCategory;
    // Collapsed against the IN-SCOPE half only, and the out-of-country tail is
    // passed through untouched. A pick that is itself out of the browsed
    // country is not a result here — `partitionByCountryScope` sends it to the
    // tail below the grid — so letting it settle a category would empty the
    // grid and leave the couple's own choice in the "these exist, elsewhere"
    // footnote as the only thing on the page.
    const inScope = filteredBeforeCategory.filter((s) => !isOutOfScope(s));
    const kept = new Set(collapseSettledCategories(inScope, selection));
    return filteredBeforeCategory.filter((s) => isOutOfScope(s) || kept.has(s));
  }, [filteredBeforeCategory, selection, collapseSettled, isOutOfScope]);

  /** The active category / group scope, as a predicate. Shared by the grid and
   *  by the hidden-count below so the number offered always describes exactly
   *  what is on screen. */
  const inCategoryScope = useCallback(
    (s: { category: SupplierCategory }) => {
      if (activeCat) return s.category === activeCat;
      if (!activeGroup) return true;
      const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
      return group ? group.categories.includes(s.category) : true;
    },
    [activeCat, activeGroup],
  );

  // How many cards the collapse holds back in the part of the directory on
  // screen. Computed off the UNCOLLAPSED set whether or not the collapse is
  // currently in force, because the same affordance has to offer the way back.
  const settledHiddenCount = useMemo(() => {
    if (queryNorm || showSavedOnly || showVerifiedOnly || showPickedOnly) return 0;
    const scoped = filteredBeforeCategory.filter((s) => inCategoryScope(s) && !isOutOfScope(s));
    return scoped.length - collapseSettledCategories(scoped, selection).length;
  }, [
    filteredBeforeCategory,
    selection,
    inCategoryScope,
    isOutOfScope,
    queryNorm,
    showSavedOnly,
    showVerifiedOnly,
    showPickedOnly,
  ]);

  const filtered = useMemo(() => {
    let out = shownBeforeCategory;
    if (activeCat) out = out.filter((s) => s.category === activeCat);
    else if (activeGroup) {
      const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
      const cats = new Set(group?.categories ?? []);
      out = out.filter((s) => cats.has(s.category));
    }
    // Stable sort. Top mode: DIY entries first (they're the couple's own
    // plan), then directory cards ranked by net votes with curated-first
    // tie-break. Alpha mode ignores everything but the locale-aware name.
    // Price modes sort by declared price_band; suppliers with no declared
    // band sink to the bottom so the ranked area stays meaningful.
    const sorted = [...out];
    const collator = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, locale === "hu" ? "hu" : "en");
    // Nothing here sorts by country scope any more: `partitionByCountryScope`
    // below takes the out-of-country verified cards out of the result set
    // altogether, and it preserves order, so whatever these comparators decide
    // survives inside each half. A tie-break that sank them was the old fix,
    // and it did nothing in the case that mattered: a tail with no results
    // above it is just the list.
    //
    // When the free-text query is a known town, "top" (the default sort)
    // becomes nearest-first — a distance badge without reordering buries
    // the closest venue behind high-vote far ones. An explicit price/alpha
    // pick still wins; this only redefines the default.
    const proximityTown = nearbyTownLabel(queryNorm);
    if (sortMode === "alpha") {
      sorted.sort(collator);
    } else if (sortMode === "top" && proximityTown) {
      sorted.sort((a, b) => {
        const aSelf = a.source === "self" ? 1 : 0;
        const bSelf = b.source === "self" ? 1 : 0;
        if (aSelf !== bSelf) return bSelf - aSelf;
        if (a.source !== "self" && b.source !== "self") {
          const ad = distanceKmForQuery(queryNorm, a.city, { lat: a.lat, lng: a.lng });
          const bd = distanceKmForQuery(queryNorm, b.city, { lat: b.lat, lng: b.lng });
          // Suppliers we can place on the map lead; among them, nearest
          // first; ties (and the unplaceable tail of name/blurb matches)
          // fall back to votes then name, so recall is preserved.
          const aHas = ad != null ? 1 : 0;
          const bHas = bd != null ? 1 : 0;
          if (aHas !== bHas) return bHas - aHas;
          if (ad != null && bd != null && ad !== bd) return ad - bd;
          // Verified leads here too, but UNDER distance: this mode exists
          // because the couple named a town, and burying the nearest venue
          // behind a verified one two counties over answers a question they
          // didn't ask.
          const aClaimedNear = a.source === "claimed" ? 1 : 0;
          const bClaimedNear = b.source === "claimed" ? 1 : 0;
          if (aClaimedNear !== bClaimedNear) return bClaimedNear - aClaimedNear;
          if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
          // Equal net votes: the photographed vendor leads the imageless one.
          const aImg = a.hero_image_url ? 1 : 0;
          const bImg = b.hero_image_url ? 1 : 0;
          if (aImg !== bImg) return bImg - aImg;
          if (a.source !== b.source) return a.source === "curated" ? -1 : 1;
        }
        return collator(a, b);
      });
    } else if (sortMode === "price_asc" || sortMode === "price_desc") {
      const dir = sortMode === "price_asc" ? 1 : -1;
      const bandOf = (s: (typeof sorted)[number]): number | null =>
        "price_band" in s ? (s.price_band ?? null) : null;
      sorted.sort((a, b) => {
        const ab = bandOf(a);
        const bb = bandOf(b);
        const aHas = ab != null ? 1 : 0;
        const bHas = bb != null ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        if (ab != null && bb != null && ab !== bb) return (ab - bb) * dir;
        return collator(a, b);
      });
    } else {
      sorted.sort((a, b) => {
        const aSelf = a.source === "self" ? 1 : 0;
        const bSelf = b.source === "self" ? 1 : 0;
        if (aSelf !== bSelf) return bSelf - aSelf;
        if (a.source !== "self" && b.source !== "self") {
          // Verified accounts lead the directory. A claimed card is a business
          // that is actually ON Weddly: the details are maintained by the owner,
          // the enquiry goes into their inbox and gets answered in-app. An
          // unclaimed curated card is a phone number we typed in. Votes can't
          // express that — almost nothing has any — so it has to be its own
          // tier rather than a tie-break, the same order the public
          // /vendors/browse teaser already uses.
          const aClaimed = a.source === "claimed" ? 1 : 0;
          const bClaimed = b.source === "claimed" ? 1 : 0;
          if (aClaimed !== bClaimed) return bClaimed - aClaimed;
          if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
          // Equal net votes: a real uploaded hero photo makes the card far more
          // clickable, so the photographed vendor leads the imageless one.
          const aImg = a.hero_image_url ? 1 : 0;
          const bImg = b.hero_image_url ? 1 : 0;
          if (aImg !== bImg) return bImg - aImg;
          if (a.source !== b.source) return a.source === "curated" ? -1 : 1;
        }
        return collator(a, b);
      });
    }
    return sorted;
  }, [shownBeforeCategory, activeGroup, activeCat, sortMode, locale, queryNorm]);

  // Planners honour only the free-text search (name / business / city / bio) —
  // the venue-oriented country / price / guest filters don't apply to a service
  // that works nationwide. Drives both the chain step's count and its grid.
  const filteredPlanners = useMemo<PlannerDirectoryEntry[]>(() => {
    const q = queryNorm;
    if (!q) return planners;
    return planners.filter((p) =>
      normalize(`${p.business_name} ${p.full_name} ${p.city ?? ""} ${p.bio ?? ""}`).includes(q),
    );
  }, [planners, queryNorm]);

  // The planner ACCOUNTS strip is a second list of the one trade "magam
  // szervezem" rules out, and it lives outside `items`, so the collapse below
  // cannot reach it. Left standing it would answer a decision the couple just
  // made with six more planners, which is the exact noise the collapse exists
  // to remove. The self-organize tile itself always stays: it is the way back.
  const plannersRuledOut = collapseSettled && selfOrganized;
  const shownPlanners = plannersRuledOut ? [] : filteredPlanners;
  // ...and they count toward the "show the rest" offer, or its number would
  // describe less than what reappears when the couple takes it.
  const plannersHiddenCount = useMemo(() => {
    if (!selfOrganized) return 0;
    if (queryNorm || showSavedOnly || showVerifiedOnly || showPickedOnly) return 0;
    return inCategoryScope({ category: "wedding_planner" }) ? filteredPlanners.length : 0;
  }, [
    selfOrganized,
    filteredPlanners,
    inCategoryScope,
    queryNorm,
    showSavedOnly,
    showVerifiedOnly,
    showPickedOnly,
  ]);

  /** The couple ruled this sub-category out, so the grid under it is empty ON
   *  PURPOSE. Without this line the empty state below blames a filter, or the
   *  country scope, for a decision the couple made themselves. */
  const settledEmptyNote =
    collapseSettled && activeCat && isSentinelPick(activeCatPick ?? "")
      ? t(
          activeCatPick === SELF_ORGANIZED_PICK
            ? "suppliers.empty_self_organized"
            : "suppliers.empty_not_needed",
          { category: t(`suppliers.cat.${activeCat}`) },
        )
      : null;

  // An out-of-country verified vendor is NOT a result for the country being
  // browsed, so the two are counted, paged and labelled separately. A couple
  // planning in Italy told us the list "actually shows vendors in Hungary": the
  // verified exemption below `scopedItems` let every registered HU vendor ride
  // along, and in a category where Italy has nothing they weren't sorted last,
  // they were the entire list. Sinking them was never enough — a tail with
  // nothing above it is just the list. So they leave the result set, and come
  // back under their own heading, capped.
  const { inScope: filteredInScope, outOfScope: filteredOutOfScope } = useMemo(
    () => partitionByCountryScope(filtered, countryScope),
    [filtered, countryScope],
  );

  // How many of `filteredInScope` are laid out right now. Reset to the first
  // page whenever the filtered set changes (new search / category / sort) so we
  // never show a stale offset, then grow it a page at a time on "load more".
  const [visibleCount, setVisibleCount] = useState(SUPPLIERS_PAGE_SIZE);
  useEffect(() => setVisibleCount(SUPPLIERS_PAGE_SIZE), [filtered]);
  // The grid is in-country results only. The tail never pages and never gets a
  // card: it is a "these exist, elsewhere" note, and a couple who wants to
  // browse another country has the country picker for that.
  const visibleSuppliers = filteredInScope.slice(0, visibleCount);
  const outOfScopeTail = filteredOutOfScope.slice(0, OUT_OF_COUNTRY_MAX);

  // What the chain + pill counts are allowed to count: results in the country
  // being browsed. A chip reading "Fotós 24" that opens onto 24 Hungarian
  // photographers is a promise the page can't keep for an Italian wedding.
  // Counted off the COLLAPSED set: a pill reading "Esküvői helyszín 289" that
  // opens onto the one venue the couple booked is the same broken promise as
  // counting out-of-country vendors, from the other direction.
  const countableBeforeCategory = useMemo(
    () => shownBeforeCategory.filter((s) => !isOutOfScope(s)),
    [shownBeforeCategory, isOutOfScope],
  );

  // Per-group counts for the top chain. "Mind" gets the total across all
  // groups. Each group step gets its own count.
  const groupCounts = useMemo(() => {
    const map = new Map<SupplierGroup, number>();
    for (const g of SUPPLIER_GROUPS) map.set(g.id, 0);
    for (const s of countableBeforeCategory) {
      for (const g of SUPPLIER_GROUPS) {
        if (g.categories.includes(s.category)) {
          map.set(g.id, (map.get(g.id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [countableBeforeCategory]);

  // Per-category counts for the sub-category pills (only meaningful when a
  // group is active). "Mind" within the sub-row gets the in-group total.
  const subCategoryCounts = useMemo(() => {
    const map = new Map<SupplierCategory, number>();
    if (!activeGroup) return map;
    const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
    if (!group) return map;
    const allowed = new Set(group.categories);
    for (const c of group.categories) map.set(c, 0);
    for (const s of countableBeforeCategory) {
      if (allowed.has(s.category)) map.set(s.category, (map.get(s.category) ?? 0) + 1);
    }
    return map;
  }, [countableBeforeCategory, activeGroup]);

  const inGroupTotal = useMemo(() => {
    if (!activeGroup) return countableBeforeCategory.length;
    return [...subCategoryCounts.values()].reduce((a, b) => a + b, 0);
  }, [activeGroup, countableBeforeCategory.length, subCategoryCounts]);

  // Per-group "how many sub-categories are locked in" — drives the discreet
  // progress bars under each chain step. The "Mind" tile sums across all
  // groups (denominator = all categories in the directory).
  const groupSelectionProgress = useMemo(() => {
    const map = new Map<SupplierGroup, { done: number; total: number }>();
    let allDone = 0;
    let allTotal = 0;
    for (const g of SUPPLIER_GROUPS) {
      let done = 0;
      for (const c of g.categories) {
        if (selection[c]) done++;
      }
      map.set(g.id, { done, total: g.categories.length });
      allDone += done;
      allTotal += g.categories.length;
    }
    return { byGroup: map, all: { done: allDone, total: allTotal } };
  }, [selection]);

  // The "választottak" (picked) filter badge counts chosen vendors only — a
  // "nem kell" mark resolves its category but is not a pick, so it's excluded.
  const pickedCount = useMemo(() => countRealPicks(selection), [selection]);

  /** A marker chip is on, the couple HAS marked something, and the grid under
   *  it is still empty: every card they marked was taken by one of the other
   *  filters. Its own note, because the country line below reads as "Weddly has
   *  nobody here" over a set the couple built themselves and can see the count
   *  of two centimetres above: the one empty state a couple cannot possibly
   *  attribute, and the one where the widen button on offer ("show all
   *  countries") is not the lever that would bring their cards back. */
  const markerEmptyKind: "picked" | "saved" | null = showPickedOnly
    ? "picked"
    : showSavedOnly
      ? "saved"
      : null;
  /** ...and the marked set is empty, so there is nothing for the other filters
   *  to be hiding. Reachable without a stale URL: un-pick your last card while
   *  the filter is on and the chip stays (it is `aria-pressed`, it has to), so
   *  the grid below it has to say which of the two emptinesses this is. */
  const markerEmptyIsUnmarked =
    markerEmptyKind === "picked"
      ? pickedCount === 0
      : markerEmptyKind === "saved" && saved.size === 0;
  /** Put the marked set back on screen: drop everything that narrows WHICH
   *  vendors are eligible and keep the marker itself. Same set the chip clears
   *  on the way in, plus the scoping filters, since by this point we know the
   *  couple's cards are somewhere the current scope isn't. */
  function showEveryMarked() {
    const p = new URLSearchParams(params);
    clearNarrowingFilters(p);
    p.delete("price_max");
    p.delete("date");
    p.delete("verified");
    // "all", not delete: an absent param means the couple's OWN country, which
    // is a scope, and a vendor they marked abroad would stay hidden by it.
    p.set("country", "all");
    setParams(p, { replace: true });
  }

  const subCategories = activeGroup
    ? (SUPPLIER_GROUPS.find((g) => g.id === activeGroup)?.categories ?? [])
    : [];

  function pickGroup(id: SupplierGroup | null) {
    setActiveGroup(id);
    setActiveCat(null);
  }

  // Jump straight to a single category from a card's avatar icon: open the
  // group that owns it and pin the sub-category, so the grid shows every
  // supplier in that trade.
  function filterByCategory(cat: SupplierCategory) {
    const group = SUPPLIER_GROUPS.find((g) => g.categories.includes(cat));
    setActiveGroup(group ? group.id : null);
    setActiveCat(cat);
  }

  // Route a picked search suggestion to the right action: a supplier jumps to
  // its card, a category pins the chain filter, a town fills the query (the
  // existing metro/radius search takes it from there).
  function onSearchSuggestion(option: ComboOption) {
    const [kind, ...rest] = option.id.split(":");
    const payload = rest.join(":");
    if (kind === "sup") {
      navigate(`/app/suppliers/${encodeURIComponent(payload)}`);
    } else if (kind === "cat") {
      filterByCategory(payload as SupplierCategory);
      setQuery("");
    } else {
      setQuery(payload);
    }
  }

  return (
    <>
      {/* Single-column shell. Wedding planners used to sit in a right-hand rail
          here; they now live inline as a dedicated "Esküvőszervező" step in the
          supplier chain, so the directory owns the full page width. */}
      <div>
        <div className="min-w-0">
          {/* Chrome, rebuilt 2026-07-27 to read like a marketplace app rather
              than a control panel. It used to be four stacked bands: title +
              actions, five fields, a boxed row of ORSZÁG/ÁRSZINT/VENDÉGSZÁM/
              HITELESÍTETT, then the chain. That is a lot of apparatus to scroll
              past before the first supplier. Now: a search surface, one line of
              chips, the chain. Nothing was dropped — country, price and guest
              count moved into the "Szűrők" dialog, which carries a count badge
              so a filter can never be on without being visible. */}
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="font-grotesk">{t("suppliers.title")}</h1>
              <InfoHint text={t("suppliers.sub")} />
            </div>
            <div className="flex items-center gap-2">
              {/* Icon-only view switch: three glyphs, one filled. The words
                  ride in the tooltip + aria-label — at three modes the icons
                  are unambiguous and the labels were the widest thing in the
                  row. */}
              <div
                role="group"
                aria-label={t("suppliers.view_label")}
                className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 p-1 dark:border-umber-700 dark:bg-umber-800"
              >
                {(
                  [
                    { mode: "grid", icon: LayoutGrid, label: "view_grid" },
                    { mode: "line", icon: List, label: "view_line" },
                    { mode: "map", icon: MapIcon, label: "view_map" },
                  ] as const
                ).map(({ mode, icon: VIcon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    aria-pressed={viewMode === mode}
                    aria-label={t(`suppliers.${label}`)}
                    title={t(`suppliers.${label}`)}
                    className={
                      viewMode === mode
                        ? "inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                        : "inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-200 hover:text-ink-900 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-paper-50"
                    }
                  >
                    <VIcon size={15} aria-hidden />
                  </button>
                ))}
              </div>
              {/* The label hides on a phone, so the accessible name has to be
                  carried explicitly — otherwise it degrades to a bare "+". */}
              <button
                type="button"
                onClick={() => setSubmitOpen(true)}
                aria-label={t("suppliers.drop_your_own")}
                title={t("suppliers.drop_your_own")}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3.5 text-sm font-medium text-ink-800 transition hover:border-ink-900 hover:text-ink-900 sm:px-4 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200 dark:hover:text-paper-50"
              >
                <Plus size={15} aria-hidden />
                <span className="hidden sm:inline">{t("suppliers.drop_your_own")}</span>
              </button>
            </div>
          </header>

          {/* The search surface. Two fields, both tall enough to be the thing
              you reach for first: what you're after, and where. */}
          <div
            data-tour-target="vendors-search"
            className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <Combobox
              className="min-w-0 flex-1"
              value={query}
              onChange={setQuery}
              onSelect={onSearchSuggestion}
              options={searchSuggestions}
              ariaLabel={t("suppliers.search_label")}
              placeholder={t("suppliers.search_placeholder")}
              leadingIcon={Search}
              onClear={() => setQuery("")}
              inputClassName="h-12 w-full rounded-full border border-paper-300 bg-white pl-10 pr-9 text-[15px] text-ink-900 shadow-soft transition placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-900 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-paper-200"
            />
            <Combobox
              className="w-full sm:w-64"
              value={cityInput}
              onChange={(v) => {
                setCityInput(v);
                if (v.trim() === "") setCityFilter("");
              }}
              onSelect={(opt) => {
                setCityFilter(opt.id);
                setCityInput(opt.label);
              }}
              options={cityOptions}
              ariaLabel={t("suppliers.city_label")}
              placeholder={t("suppliers.city_all")}
              leadingIcon={MapPin}
              onClear={() => {
                setCityFilter("");
                setCityInput("");
              }}
              suffix={
                cityNearbyKm != null
                  ? t("suppliers.nearby_plus_km", { km: cityNearbyKm })
                  : undefined
              }
              inputClassName="h-12 w-full rounded-full border border-paper-300 bg-white pl-10 pr-20 text-[15px] text-ink-900 shadow-soft transition placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-900 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-paper-200"
            />
          </div>

          {/* One line of chips. Everything here is one tap from a decision:
              the three the couple flips constantly stay out, the scoping
              controls live behind the first chip. Scrolls sideways on a phone
              rather than wrapping into a second and third row. */}
          <div className="mb-3 -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              className={
                scopeFilterCount > 0
                  ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ink-900 bg-ink-900 px-3.5 text-sm font-medium text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                  : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-paper-300 px-3.5 text-sm font-medium text-ink-800 transition hover:border-ink-900 dark:border-umber-700 dark:text-paper-100 dark:hover:border-paper-200"
              }
            >
              <SlidersHorizontal size={14} aria-hidden />
              {t("suppliers.filters_button")}
              {scopeFilterCount > 0 && <span className="tabular-nums">{scopeFilterCount}</span>}
            </button>
            {/* A "0 saved" chip is a control that can't do anything — it used
                to sit here greyed out, teaching nobody. It appears the moment
                there is something to filter to. */}
            {(saved.size > 0 || showSavedOnly) && (
              <button
                type="button"
                onClick={toggleSavedFilter}
                aria-pressed={showSavedOnly}
                aria-label={t("suppliers.saved_filter", { n: saved.size })}
                title={t("suppliers.saved_filter", { n: saved.size })}
                className={
                  showSavedOnly
                    ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ink-900 bg-ink-900 px-3.5 text-sm font-medium text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-paper-300 px-3.5 text-sm text-ink-800 transition hover:border-ink-900 dark:border-umber-700 dark:text-paper-100 dark:hover:border-paper-200"
                }
              >
                <Heart size={14} className={showSavedOnly ? "fill-current" : ""} aria-hidden />
                <span className="tabular-nums">{saved.size}</span>
              </button>
            )}
            {(pickedCount > 0 || showPickedOnly) && (
              <button
                type="button"
                onClick={togglePickedFilter}
                aria-pressed={showPickedOnly}
                aria-label={t(
                  showPickedOnly
                    ? "suppliers.picked_filter_active"
                    : "suppliers.picked_filter_idle",
                  { n: pickedCount },
                )}
                title={t(
                  showPickedOnly
                    ? "suppliers.picked_filter_active"
                    : "suppliers.picked_filter_idle",
                  { n: pickedCount },
                )}
                className={
                  showPickedOnly
                    ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ink-900 bg-ink-900 px-3.5 text-sm font-medium text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-paper-300 px-3.5 text-sm text-ink-800 transition hover:border-ink-900 dark:border-umber-700 dark:text-paper-100 dark:hover:border-paper-200"
                }
              >
                <BookmarkCheck size={14} aria-hidden />
                <span className="tabular-nums">{pickedCount}</span>
              </button>
            )}
            <button
              type="button"
              onClick={toggleVerifiedFilter}
              aria-pressed={showVerifiedOnly}
              title={t("suppliers.verified_filter")}
              // Active state takes the `verified` azure rather than the ink of
              // the other chips: this filter is the badge, so it turns the
              // badge's own colour on. The token reads on light paper and dark
              // umber alike, so there is no dark-mode flip here.
              className={
                showVerifiedOnly
                  ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-verified bg-verified px-3.5 text-sm font-medium text-white"
                  : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-paper-300 px-3.5 text-sm text-ink-800 transition hover:border-ink-900 dark:border-umber-700 dark:text-paper-100 dark:hover:border-paper-200"
              }
            >
              <BadgeCheck
                size={14}
                aria-hidden
                className={showVerifiedOnly ? "" : "text-verified"}
              />
              {t("suppliers.verified_filter")}
            </button>
            {/* Sort stays a native select so it keeps the platform picker on a
                phone; only the box around it is ours. */}
            <div className="relative shrink-0">
              <select
                className="h-9 appearance-none rounded-full border border-paper-300 bg-transparent pl-3.5 pr-8 text-sm text-ink-800 transition hover:border-ink-900 focus:border-ink-900 focus:outline-none dark:border-umber-700 dark:text-paper-100 dark:hover:border-paper-200"
                value={sortMode}
                onChange={(e) =>
                  setSortMode(e.target.value as "top" | "alpha" | "price_asc" | "price_desc")
                }
                aria-label={t("suppliers.sort_label")}
              >
                <option value="top">{t("suppliers.sort_top")}</option>
                <option value="price_asc">{t("suppliers.sort_price_asc")}</option>
                <option value="price_desc">{t("suppliers.sort_price_desc")}</option>
                <option value="alpha">{t("suppliers.sort_alpha")}</option>
              </select>
              <ChevronDown
                size={14}
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 dark:text-umber-200"
              />
            </div>
          </div>

          {/* Step chain. Sequence numbers dropped — the icons carry the meaning,
          and the left-to-right order carries the sequence. The little "→"
          between the steps went with the 2026-07-27 pass: nine arrows are
          nine pieces of punctuation to read past, and the row already reads
          as an order. Each step keeps its row of discreet bars (one per
          sub-category) that turn sage as the couple locks each pick in.
          The right-edge fade only shows when the row actually overflows —
          otherwise it leaves a phantom white slab next to the last step. */}
          <div className="relative mb-2">
            {/* snap-x mandatory keeps each step centred under a flicked thumb on
            touch widths — without it the row drifts mid-icon and the user
            has to nudge it back. snap-start on each child anchors the
            alignment to the leading edge of the step group. */}
            <div ref={chainScrollRef} className="overflow-x-auto snap-x snap-mandatory pb-1">
              <div className="flex min-w-max items-stretch gap-2">
                {SUPPLIER_GROUPS.map((g) => {
                  const Icon = GROUP_ICON[g.id];
                  const progress = groupSelectionProgress.byGroup.get(g.id) ?? {
                    done: 0,
                    total: g.categories.length,
                  };
                  return (
                    <div key={g.id} className="flex snap-start items-stretch">
                      <ChainStep
                        active={activeGroup === g.id}
                        // Re-click on the active group clears the filter — the
                        // "Mind" tile is gone so this toggle is the only way back.
                        onClick={() => pickGroup(activeGroup === g.id ? null : g.id)}
                        label={t(`suppliers.group.${g.id}`)}
                        count={groupCounts.get(g.id) ?? 0}
                        icon={<Icon size={16} />}
                        progress={progress}
                        t={t}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Right-edge fade — only when the row overflows. */}
            {chainOverflows && (
              <div
                className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-paper-50 dark:from-umber-900 to-transparent"
                aria-hidden
              />
            )}
          </div>

          {/* Sub-category pills (only when a group is selected). Each pill shows
          the count of suppliers in that category after the non-category
          filters, so couples can pre-scan where the inventory lives.
          On mobile the row becomes a horizontal snap-scroller — wrapping
          to a second/third line was the "ticketek szétcsúsztak" complaint
          from the May 2026 mobile audit (compact, predictable horizontal
          motion beats a chaotic two-line wrap at thumb width). */}
          {activeGroup && subCategories.length > 0 && (
            <div className="mb-2 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-3 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <button
                type="button"
                onClick={() => setActiveCat(null)}
                className={
                  activeCat === null
                    ? "inline-flex items-center gap-1.5 rounded-full border border-transparent stationery-coffee px-3.5 py-1.5 text-xs font-medium text-paper-50"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3.5 py-1.5 text-xs text-ink-700 transition hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200"
                }
              >
                <span className="lowercase">{t("suppliers.filter_all")}</span>
                <span
                  className={
                    activeCat === null
                      ? "rounded-full bg-paper-100/20 px-1.5 text-[10px] font-medium tabular-nums"
                      : "text-[10px] font-medium tabular-nums text-ink-400 dark:text-umber-300"
                  }
                >
                  {inGroupTotal}
                </span>
              </button>
              {subCategories.map((c) => {
                const Icon = CATEGORY_ICON[c];
                const selected = activeCat === c;
                const count = subCategoryCounts.get(c) ?? 0;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveCat(c)}
                    className={
                      selected
                        ? "inline-flex items-center gap-1.5 rounded-full border border-transparent stationery-coffee px-3.5 py-1.5 text-xs font-medium text-paper-50"
                        : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3.5 py-1.5 text-xs text-ink-700 transition hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200"
                    }
                  >
                    <Icon size={13} />
                    <span className="lowercase">{t(`suppliers.cat.${c}`)}</span>
                    <span
                      className={
                        selected
                          ? "rounded-full bg-paper-100/20 px-1.5 text-[10px] font-medium tabular-nums"
                          : "text-[10px] font-medium tabular-nums text-ink-400 dark:text-umber-300"
                      }
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
              {/* Right-floating action group: the cake & drinks calculator (only
              for the food/drink categories it estimates) sits just left of
              "Csinálom magam". On sm+ the pair sits flush-right of the pill
              row via `ml-auto`; on mobile the row is a horizontal scroller so
              they ride as the last shrink-0 chips. */}
              <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                {activeCat && CALC_CATEGORIES.has(activeCat) && (
                  <button
                    type="button"
                    onClick={() => setCalcOpen(true)}
                    aria-label={t("suppliers.calc.open_aria")}
                    title={t("suppliers.calc.open_aria")}
                    className={`${ACTION_CHIP} ${ACTION_CHIP_IDLE}`}
                  >
                    <Calculator size={13} aria-hidden />
                    <span className="lowercase">{t("suppliers.calc.open")}</span>
                  </button>
                )}
                {/* "Már foglaltam" — same weight as its two neighbours: the
                    couple is choosing between three ways to settle a category
                    (booked it elsewhere / doing it ourselves / don't need it),
                    so all three are one row of peer chips. This one OPENS A
                    FORM rather than recording anything, so it takes the
                    disclosure treatment (see ACTION_CHIP_OPEN) and never the
                    settled fill its neighbour uses. Naming the vendor in the
                    form is what settles the category, and that goes through the
                    same one-pick-per-category storage, so it replaces a "nincs
                    rá szükségem" mark rather than standing beside it. */}
                {activeCat && (
                  <button
                    type="button"
                    onClick={() => setBookedOpen((v) => !v)}
                    aria-expanded={bookedOpen}
                    aria-controls="booked-supplier-panel"
                    title={t("suppliers.bookedCard.title")}
                    className={`${ACTION_CHIP} ${bookedOpen ? ACTION_CHIP_OPEN : ACTION_CHIP_IDLE}`}
                  >
                    <Bookmark size={13} aria-hidden />
                    <span className="lowercase">{t("suppliers.bookedCard.title")}</span>
                    <ChevronDown
                      size={12}
                      aria-hidden
                      className={`transition-transform ${bookedOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
                {/* No "csinálom magam" DIY entry for planners — self-organizing
                    means NOT hiring a planner, so the honest control is the
                    "Magam szervezem" done-toggle rendered in the results area
                    below, not a DIY vendor row. */}
                {activeGroup !== "planning_rentals" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDiyEditing(null);
                      setDiyOpen(true);
                    }}
                    className={`${ACTION_CHIP} ${ACTION_CHIP_IDLE}`}
                  >
                    <Pencil size={13} aria-hidden />
                    <span className="lowercase">{t("suppliers.diy_button_short")}</span>
                  </button>
                )}
                {/* "Nincs rá szükségem" — tick to mark the active sub-category as
                    one this couple doesn't need, greening its runner segment.
                    Only for a concrete sub-category (not the "all" tab, not the
                    planning step which has its own self-organize toggle) and only
                    while there's no real booking to overwrite. */}
                {activeGroup !== "planning_rentals" && activeCat && !activeCatHasRealPick && (
                  <button
                    type="button"
                    onClick={toggleNotNeeded}
                    aria-pressed={activeCatNotNeeded}
                    title={t("suppliers.not_needed_aria", {
                      category: t(`suppliers.cat.${activeCat}`),
                    })}
                    className={`${ACTION_CHIP} ${
                      activeCatNotNeeded ? ACTION_CHIP_SAGE : ACTION_CHIP_IDLE
                    }`}
                  >
                    {/* The checkbox square made this read a level below its
                        neighbours; the chip's own fill carries the on-state
                        now, with aria-pressed doing the semantic work. */}
                    <Check size={13} strokeWidth={activeCatNotNeeded ? 3 : 2} aria-hidden />
                    <span className="lowercase">{t("suppliers.not_needed_toggle")}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {activeCat === "accommodation" && (
            <section
              aria-labelledby="accommodation-external-heading"
              className="mb-4 rounded-2xl border border-paper-200 bg-paper-50 p-4 sm:p-5 dark:border-umber-700 dark:bg-umber-800"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-700 dark:bg-sage-400/15 dark:text-sage-300">
                  <BedDouble size={16} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3
                    id="accommodation-external-heading"
                    className="text-sm font-semibold text-ink-900 dark:text-paper-100"
                  >
                    {t("suppliers.accommodation_external_title")}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
                    {t("suppliers.accommodation_external_subtitle")}
                  </p>
                </div>
              </div>
              {/* Brand-coloured partner tiles — full bleed brand colour, white
              wordmark, external-link icon top-right. The previous treatment
              (generic bed icon + grey outline) read as "more of the same
              Weddly UI"; couples scan recognisable brands faster when the
              card USES the brand. Brand colours go via Tailwind arbitrary
              value (`bg-[#003580]`) — they're external-company-owned and
              shouldn't pollute the design tokens. */}
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    key: "booking",
                    href: "https://www.booking.com/",
                    wordmark: (
                      <span className="text-xl font-bold tracking-tight text-white">
                        Booking
                        <span className="text-[#febb02]">.</span>
                        com
                      </span>
                    ),
                    bgClass: "bg-[#003580] hover:bg-[#002a66]",
                  },
                  {
                    key: "airbnb",
                    href: "https://www.airbnb.com/",
                    wordmark: (
                      <span className="text-xl font-bold lowercase tracking-tight text-white">
                        airbnb
                      </span>
                    ),
                    bgClass: "bg-[#FF5A5F] hover:bg-[#e64a4f]",
                  },
                  {
                    key: "szallas_hu",
                    href: "https://www.szallas.hu/",
                    wordmark: (
                      <span className="text-xl font-bold tracking-tight text-white">
                        Szállás
                        <span className="opacity-70">.hu</span>
                      </span>
                    ),
                    bgClass: "bg-[#0e7c66] hover:bg-[#0a5e4e]",
                  },
                ].map((p) => (
                  <li key={p.key}>
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={`group relative flex h-full items-center justify-between rounded-xl px-5 py-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${p.bgClass}`}
                    >
                      {p.wordmark}
                      <ExternalLink
                        size={16}
                        aria-hidden
                        className="absolute right-3 top-3 text-white/70 transition group-hover:text-white"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Booking.com-style nearby banner — appears when the typed town
          isn't an anchor but resolves to a known metro (e.g. "Zsámbék"
          → Budapest area). Neutral paper/ink palette instead of the
          old blush variant: blush is the codebase's error colour
          (ToastProvider, FieldError, AlertCircle pills) and the banner
          was reading as a warning rather than a hint. */}
          {(() => {
            const townLabel = nearbyTownLabel(queryNorm);
            if (!townLabel) return null;
            return (
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-800/60 dark:text-umber-200">
                <MapPin size={12} aria-hidden className="text-ink-400 dark:text-umber-300" />
                <span>
                  {t("suppliers.nearby_banner", { town: townLabel, radius: NEARBY_RADIUS_KM })}
                </span>
              </p>
            );
          })()}

          {/* Registered planner ACCOUNTS strip — surfaced atop the
              wedding_planner category. These are Weddly planner users reachable
              via the consent flow (invite → accept → linked), distinct from the
              curated planner listings that render in the grid below. Search
              filters both (filteredPlanners honours the query). The
              "Magam szervezem" self-organize tile leads the grid. */}
          {activeGroup === "planning_rentals" && viewMode !== "map" && (
            <section aria-label={t("planner_directory.title")} className="mb-5">
              {shownPlanners.length > 0 && (
                <p className="mb-3 text-sm text-ink-500 dark:text-umber-300">
                  {t("planner_directory.subtitle")}
                </p>
              )}
              <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                {/* "Magam szervezem" — the self-organize done-toggle, now the
                    leading card in the planner grid (was a checkbox row above).
                    Toggling on records the sentinel pick, greens the
                    "Szervezés & koordináció" step, clears the planner cards
                    beside it, and fires confetti. This tile is the one thing
                    that never clears: it is the way back. */}
                <button
                  type="button"
                  onClick={toggleSelfOrganize}
                  aria-pressed={selfOrganized}
                  className={`card group flex h-full flex-col justify-center !p-4 text-left transition ${
                    selfOrganized
                      ? "ring-2 ring-ink-900 dark:ring-paper-50"
                      : "hover:border-ink-300 dark:hover:border-umber-600"
                  }`}
                >
                  {/* Uber-style checkbox: black-fill + white check when chosen,
                      thin square outline when not. Always mounted (goes
                      transparent when unchecked) so the box never resizes. */}
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        selfOrganized
                          ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                          : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink-300 text-transparent transition group-hover:border-ink-500 dark:border-umber-500 dark:group-hover:border-umber-300"
                      }
                      aria-hidden
                    >
                      <Check size={20} strokeWidth={3} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink-900 dark:text-paper-50">
                        {t("suppliers.self_organize_label")}
                      </span>
                      <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-umber-300">
                        {t("suppliers.self_organize_hint")}
                      </p>
                    </div>
                  </div>
                </button>
                {shownPlanners.map((p) => (
                  <PlannerCard
                    key={p.planner_user_id}
                    planner={p}
                    onChanged={handlePlannerChanged}
                  />
                ))}
              </div>
            </section>
          )}

          {/* The way out of the settled-category collapse. Without it a couple
          who books a venue and then wants to change their mind is looking at a
          one-card directory with nothing to explain it, and a couple who ruled
          a sub-category out is looking at an empty one. Rendered above the grid
          and the map, since both are collapsed, and its count covers the planner
          strip above it, which "magam szervezem" empties the same way. */}
          {settledHiddenCount + plannersHiddenCount > 0 && (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowSettledSiblings((v) => !v)}
                aria-pressed={showSettledSiblings}
                className={`${ACTION_CHIP} ${showSettledSiblings ? ACTION_CHIP_ON : ACTION_CHIP_IDLE}`}
              >
                {showSettledSiblings ? (
                  <EyeOff size={13} aria-hidden />
                ) : (
                  <Eye size={13} aria-hidden />
                )}
                <span className="lowercase">
                  {showSettledSiblings
                    ? t("suppliers.settled_collapse")
                    : t("suppliers.settled_show_all", {
                        n: settledHiddenCount + plannersHiddenCount,
                      })}
                </span>
              </button>
            </div>
          )}

          {viewMode === "map" ? (
            // Same tour target as the grid/list container so the feature tour's
            // "vendors-list" steps still have something to spotlight in map view —
            // otherwise steps 2-3 find no element and the card drifts to center
            // with no highlight (the "compass not fully functional" report).
            <div data-tour-target="vendors-list">
              <Suspense
                fallback={
                  <Skeleton
                    variant="block"
                    rounded="2xl"
                    className="w-full"
                    style={{ height: "70vh", minHeight: "480px" }}
                    aria-label={t("common.loading")}
                  />
                }
              >
                <SupplierMap
                  // The map draws the in-country half only, off the same split
                  // as the grid. A map has no "further down the list" to sink
                  // an out-of-country pin into, and one pin in Antibes would
                  // zoom a Hungarian couple's map out to half of Europe to fit
                  // it. DIY rows have no coordinates worth pinning either.
                  suppliers={filteredInScope.filter(
                    (s): s is DirectorySupplier => s.source !== "self",
                  )}
                  saved={saved}
                  selection={selection}
                  onToggleSave={toggleSaved}
                  onTogglePick={togglePicked}
                />
              </Suspense>
            </div>
          ) : (
            <>
              {/* "Már foglaltam" form. Revealed by the peer chip in the
              sub-category row, so it only exists once the couple has narrowed
              down to a specific sub-category (activeGroup AND activeCat both
              set) — without that context the autocomplete + admin-queue
              category pinning have nothing to anchor to. Rendered above the
              grid (full-width either way) so the `auto-rows-fr` grid below
              keeps every directory card the same height without this taller
              form inflating the card rows. */}
              {activeGroup && activeCat && bookedOpen && (
                <div className="mb-3">
                  <BookedSupplierCard
                    coupleId={coupleId}
                    category={activeCat}
                    categoryLabel={t(`suppliers.cat.${activeCat}`)}
                    items={items}
                    pickedId={selection[activeCat] ?? null}
                    onClose={() => setBookedOpen(false)}
                    onPickExisting={(supplier) => {
                      // Mirror the new pick into local state so the matching
                      // directory card flips to its "isPicked" treatment without
                      // waiting for the cross-tab subscriber to re-emit.
                      setSelectionState((cur) => ({ ...cur, [supplier.category]: supplier.id }));
                    }}
                  />
                </div>
              )}
              <div
                data-tour-target="vendors-list"
                className={
                  viewMode === "line"
                    ? "flex flex-col gap-2"
                    : "grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3"
                }
              >
                {/* The country has nothing to offer under the current filters.
                    Said BEFORE the cards, because the out-of-country tail below
                    is otherwise read as the answer to "vendors in Italy". */}
                {filteredInScope.length === 0 && items.length > 0 && (
                  <div className="col-span-full flex flex-col items-center gap-2 py-8 text-center">
                    <p className="text-sm text-ink-500 dark:text-umber-300">
                      {settledEmptyNote ??
                        (markerEmptyKind
                          ? t(
                              markerEmptyKind === "picked"
                                ? markerEmptyIsUnmarked
                                  ? "suppliers.empty_picked_none"
                                  : "suppliers.empty_picked_hidden"
                                : markerEmptyIsUnmarked
                                  ? "suppliers.empty_saved_none"
                                  : "suppliers.empty_saved_hidden",
                            )
                          : countryScope
                            ? t("suppliers.empty_country", {
                                country: countryName(countryScope, locale),
                              })
                            : t("suppliers.empty_filtered"))}
                    </p>
                    {/* The marked set is somewhere the current filters aren't,
                    so the lever is those filters, not the country alone. With
                    nothing marked there is no set to widen TO, and the chip
                    above is already the way out, so the button stays off. */}
                    {markerEmptyKind && !markerEmptyIsUnmarked && !settledEmptyNote && (
                      <button
                        type="button"
                        onClick={showEveryMarked}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-50 px-3 text-xs font-medium text-ink-700 transition hover:border-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                      >
                        <SlidersHorizontal size={13} aria-hidden />
                        {t(
                          markerEmptyKind === "picked"
                            ? "suppliers.empty_picked_show_all"
                            : "suppliers.empty_saved_show_all",
                        )}
                      </button>
                    )}
                    {/* When the emptiness is caused by the country scope, offer a
                    one-tap widen to "Mind"/All rather than leaving the couple
                    at a dead end (audit item 12). The couple's own "we don't
                    need this" is not a dead end and gets no widen button: the
                    way back is the "show the rest" chip above, or unticking the
                    mark in the row of chips they ticked it in. */}
                    {countryScope && !settledEmptyNote && !markerEmptyKind && (
                      <button
                        type="button"
                        onClick={() => setCountryFilter("all")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-50 px-3 text-xs font-medium text-ink-700 transition hover:border-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                      >
                        <Globe size={13} aria-hidden />
                        {t("suppliers.empty_country_show_all")}
                      </button>
                    )}
                  </div>
                )}
                {visibleSuppliers.map((s) => {
                  const Icon = CATEGORY_ICON[s.category];
                  const isHighlighted = s.id === highlightId;
                  const isSaved = s.source !== "self" && saved.has(s.id);
                  // A bound private row holds its pick under the LISTING's id, so
                  // ask about that when there is one.
                  const isPicked = selection[s.category] === pickIdentityOf(s);
                  const isCompared = compareIds.includes(s.id);
                  const compareCapReached = compareIds.length >= COMPARE_MAX;
                  if (s.source === "self") {
                    const openEdit = () => {
                      setDiyEditing(s);
                      setDiyOpen(true);
                    };
                    // The row turned out to name a business Weddly lists. Offered
                    // right on the card, because a duplicate that already exists
                    // is the one case the create-time check can never catch.
                    const match = s.directory_match;
                    if (viewMode === "line") {
                      return (
                        <article
                          key={s.id}
                          data-supplier-id={s.id}
                          className={`relative flex items-center gap-3 rounded-2xl border border-sage-300 bg-sage-50/60 px-4 py-3 transition hover:border-sage-400 hover:shadow-sm dark:border-sage-400/40 dark:bg-sage-400/15 dark:hover:border-sage-400/60 ${
                            isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                          }`}
                        >
                          {/* DIY supplier card — couple-saved row from
                        `couple_suppliers`, no `listings` join. The hero-image
                        upload is vendor-only (P2.D), so the monogram fallback
                        stays for this view. */}
                          <Avatar name={s.name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                              <span className="hidden shrink-0 rounded-full border border-sage-300 bg-sage-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-700 dark:border-sage-400/40 dark:bg-sage-400/20 dark:text-sage-300 sm:inline-flex">
                                {t("suppliers.diy_pill")}
                              </span>
                            </div>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500 dark:text-umber-300">
                              <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                                <Icon size={11} aria-hidden />
                                {t(`suppliers.cat.${s.category}`)}
                              </span>
                              {s.price_huf !== null && s.price_huf > 0 && (
                                <>
                                  <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                    ·
                                  </span>
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-sage-700 dark:text-sage-300">
                                    <Wallet size={11} aria-hidden />
                                    {formatMoney(
                                      s.price_huf,
                                      currency,
                                      locale === "hu" ? "hu" : "en",
                                    )}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          {match && (
                            <button
                              type="button"
                              onClick={() => repairDuplicate(s)}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-blush-300 bg-blush-50 px-3 text-xs font-medium text-blush-700 transition hover:border-blush-500 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300"
                            >
                              <Sparkles size={12} aria-hidden />
                              {t("suppliers.twin.use")}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={openEdit}
                            aria-label={t("suppliers.diy_action_edit_aria")}
                            className="inline-flex h-7 items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-3 text-xs font-medium text-sage-700 transition hover:border-sage-500 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60"
                          >
                            <Pencil size={12} aria-hidden />
                            <span className="hidden sm:inline">
                              {t("suppliers.diy_modal_edit")}
                            </span>
                          </button>
                        </article>
                      );
                    }
                    return (
                      // The couple's own entry wears the SAME card as a listing:
                      // hero block on top, name + price on one line, one tight
                      // meta line under it. It used to be a short sage panel with
                      // a monogram, which beside a full directory card read as a
                      // broken or lesser thing rather than as their own vendor.
                      // The sage body tint and the "Yours" pill are the only marks
                      // of difference left, and the pill is the one that speaks.
                      <article
                        key={s.id}
                        data-supplier-id={s.id}
                        className={`card !p-0 relative flex h-full flex-col overflow-hidden ${
                          isPicked ? "border-2 border-sage-500 dark:border-sage-400/60" : ""
                        } ${isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""}`}
                      >
                        <div className="relative h-40 w-full shrink-0 bg-paper-200 dark:bg-umber-700">
                          {/* The couple can't upload a photo for their own row
                          (hero images are a vendor's to set), so this is always
                          the category badge — the same placeholder a listing
                          without a photo shows, not a lesser one. */}
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-paper-50 text-ink-400 shadow-sm dark:bg-umber-800 dark:text-umber-300">
                              <Icon size={24} aria-hidden />
                            </span>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-300">
                              {t(`suppliers.cat.${s.category}`)}
                            </span>
                          </div>
                          <div className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-xl bg-paper-50/95 px-1 py-1 backdrop-blur-sm dark:bg-umber-800/90">
                            <button
                              type="button"
                              onClick={openEdit}
                              aria-label={t("suppliers.diy_action_edit_aria")}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-200 hover:text-sage-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-sage-300"
                            >
                              <Pencil size={13} aria-hidden />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-1 flex-col bg-sage-50/60 px-4 pb-3 pt-2.5 dark:bg-sage-400/15">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <h3 className="min-w-0 truncate text-base font-semibold">{s.name}</h3>
                              <span className="shrink-0 rounded-full border border-sage-300 bg-sage-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-700 dark:border-sage-400/40 dark:bg-sage-400/20 dark:text-sage-300">
                                {t("suppliers.diy_pill")}
                              </span>
                            </div>
                            {s.price_huf !== null && s.price_huf > 0 && (
                              <span className="shrink-0 whitespace-nowrap text-xs font-medium text-sage-700 dark:text-sage-300">
                                {formatMoney(s.price_huf, currency, locale === "hu" ? "hu" : "en")}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 flex min-w-0 items-center gap-x-1.5 truncate text-xs text-ink-500 dark:text-umber-300">
                            <Icon size={12} className="shrink-0" aria-hidden />
                            <span className="uppercase tracking-wide">
                              {t(`suppliers.cat.${s.category}`)}
                            </span>
                            {s.city && (
                              <>
                                <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                  ·
                                </span>
                                <span className="uppercase tracking-wide">{s.city}</span>
                              </>
                            )}
                          </p>
                          {s.notes && (
                            <p className="mt-1.5 line-clamp-2 text-xs text-ink-700 dark:text-paper-100">
                              {s.notes}
                            </p>
                          )}
                          {match && (
                            <button
                              type="button"
                              onClick={() => repairDuplicate(s)}
                              className="mt-auto flex w-full items-center gap-2 rounded-xl border border-blush-300 bg-blush-50 px-3 py-2 text-left text-xs text-blush-800 transition hover:border-blush-500 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-200"
                            >
                              <Sparkles size={13} className="shrink-0" aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold">
                                  {t("suppliers.twin.title")}
                                </span>
                                <span className="block truncate">{t("suppliers.twin.body")}</span>
                              </span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  }
                  if (viewMode === "line") {
                    return (
                      <article
                        key={s.id}
                        data-supplier-id={s.id}
                        className={`relative flex items-center gap-3 rounded-2xl border px-4 py-3 transition hover:shadow-sm ${
                          isPicked
                            ? "border-sage-400 bg-sage-50/70 dark:border-sage-400/40 dark:bg-sage-400/15"
                            : "border-paper-200 bg-paper-50 hover:border-paper-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
                        } ${isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""}`}
                      >
                        <Avatar
                          name={s.name}
                          heroUrl={s.hero_image_url}
                          category={s.category}
                          onClick={() => filterByCategory(s.category)}
                          ariaLabel={t("suppliers.show_all_in_category", {
                            category: t(`suppliers.cat.${s.category}`),
                          })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {user?.is_admin ? (
                              <Link
                                to={`/app/suppliers/${encodeURIComponent(s.id)}`}
                                className="truncate text-sm font-semibold hover:underline"
                              >
                                {s.name}
                              </Link>
                            ) : (
                              <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                            )}
                            {s.source === "claimed" && (
                              <VerifiedBadge complete={s.listing_complete} />
                            )}
                            {s.source === "community" && s.submitter_type === "self" && (
                              <span
                                className="hidden shrink-0 items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-800 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 sm:inline-flex"
                                title={t("suppliers.self_pill_tooltip")}
                                aria-label={t("suppliers.self_pill_tooltip")}
                              >
                                <Store size={10} aria-hidden />
                                {t("suppliers.self_pill")}
                              </span>
                            )}
                            {s.source === "community" && s.submitter_type !== "self" && (
                              <span
                                className="hidden shrink-0 items-center gap-1 rounded-full border border-blush-200 bg-blush-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300 sm:inline-flex"
                                title={t("suppliers.community_pill_tooltip")}
                                aria-label={t("suppliers.community_pill_tooltip")}
                              >
                                <Users size={10} aria-hidden />
                                {t("suppliers.community_pill")}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500 dark:text-umber-300">
                            <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                              <Icon size={11} aria-hidden />
                              {t(`suppliers.cat.${s.category}`)}
                            </span>
                            {s.venue_style && (
                              <>
                                <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                  ·
                                </span>
                                <span className="uppercase tracking-wide text-ink-600 dark:text-umber-200">
                                  {t(`suppliers.venue_style.${s.venue_style}`)}
                                </span>
                              </>
                            )}
                            <span aria-hidden className="text-paper-400 dark:text-umber-300">
                              ·
                            </span>
                            <span className="uppercase tracking-wide">{s.city}</span>
                            <DistanceHint
                              queryNorm={queryNorm}
                              city={s.city}
                              lat={s.lat}
                              lng={s.lng}
                            />
                            {s.price_band !== null && (
                              <>
                                <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                  ·
                                </span>
                                <span
                                  className="text-ink-600 dark:text-umber-200"
                                  title={t("suppliers.price_legend")}
                                >
                                  <PriceBandDots band={s.price_band} />
                                </span>
                              </>
                            )}
                            {showsCapacity(s) && (
                              <>
                                <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                  ·
                                </span>
                                <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink-600 dark:text-umber-200">
                                  <Users size={11} aria-hidden />
                                  {s.capacity_min && s.capacity_max
                                    ? t("suppliers.capacity_range", {
                                        min: s.capacity_min,
                                        max: s.capacity_max,
                                      })
                                    : t("suppliers.capacity_max_only", {
                                        max: s.capacity_max ?? 0,
                                      })}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        {/* Action cluster: contact CTAs collapse to icons on small
                      widths so the row never wraps. Heart + vote pinned to the
                      far right. */}
                        <div className="flex shrink-0 items-center gap-1.5">
                          <a
                            href={safeExternalHref(s.website)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="btn-outline btn-sm"
                            aria-label={t("suppliers.visit_website")}
                            onClick={() => trackSupplierClick(s.id, "website_click")}
                          >
                            <span className="hidden md:inline">{t("suppliers.visit_website")}</span>
                            <span className="md:hidden">→</span>
                          </a>
                          {s.has_contact_phone && (
                            <PhoneReveal
                              supplierId={s.id}
                              onCall={() => trackSupplierClick(s.id, "phone_click")}
                              iconOnly
                              known={s.contact_phone || s.contact_phone_alt || null}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => togglePicked(s)}
                            aria-label={
                              isPicked ? t("suppliers.unpick_aria") : t("suppliers.pick_aria")
                            }
                            aria-pressed={isPicked}
                            title={t("suppliers.pick_aria")}
                            className={
                              isPicked
                                ? "inline-flex h-9 w-9 items-center justify-center rounded-full text-sage-700 transition hover:bg-sage-100 sm:h-7 sm:w-7 dark:text-sage-300 dark:hover:bg-sage-400/20"
                                : "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-sage-700 sm:h-7 sm:w-7 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-sage-300"
                            }
                          >
                            {isPicked ? (
                              <BookmarkCheck size={15} className="fill-sage-200" aria-hidden />
                            ) : (
                              <Bookmark size={15} aria-hidden />
                            )}
                          </button>
                          <SaveToggle isSaved={isSaved} onToggle={() => toggleSaved(s.id)} t={t} />
                          <CompareToggle
                            supplierId={s.id}
                            isCompared={isCompared}
                            capReached={compareCapReached}
                            onToggle={() => toggleCompare(s.id)}
                            t={t}
                          />
                          <ReportButton
                            onReport={() =>
                              setReporting({
                                id: s.id.startsWith("c") ? Number(s.id.slice(1)) : 0,
                                name: s.name,
                              })
                            }
                            t={t}
                          />
                          <VoteRow supplier={s} onVote={onVote} t={t} />
                        </div>
                      </article>
                    );
                  }
                  return (
                    <article
                      key={s.id}
                      data-supplier-id={s.id}
                      onClick={() => navigate(`/app/suppliers/${encodeURIComponent(s.id)}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          navigate(`/app/suppliers/${encodeURIComponent(s.id)}`);
                      }}
                      tabIndex={0}
                      className={`card !p-0 relative flex h-full flex-col cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-1 ${
                        isPicked ? "border-2 border-sage-500 dark:border-sage-400/60" : ""
                      } ${isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""}`}
                    >
                      {/* Hero image — the card's focal point. Pick + save float
                      top-right; the contact actions float bottom-left so they
                      live ON the card rather than in a separate text footer. */}
                      <div className="relative h-40 w-full shrink-0 bg-paper-200 dark:bg-umber-700">
                        {s.hero_image_url ? (
                          <SmartImage
                            src={s.hero_image_url}
                            alt=""
                            wrapperClassName="h-full w-full"
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          // No hero image: a deliberate-looking category badge, not
                          // a bare glyph (a lone faint icon reads as a broken image).
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-paper-50 text-ink-400 shadow-sm dark:bg-umber-800 dark:text-umber-300">
                              <Icon size={24} aria-hidden />
                            </span>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-300">
                              {t(`suppliers.cat.${s.category}`)}
                            </span>
                          </div>
                        )}
                        {/* Top-right: pick + save, and the couple's own pencil when
                        one of their rows is bound to this listing — that row holds
                        their price, notes and payment schedule, and this card is
                        now the only place it appears. */}
                        <div
                          className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-xl bg-paper-50/95 px-1 py-1 backdrop-blur-sm dark:bg-umber-800/90"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(() => {
                            const bound = boundByListingId.get(s.id);
                            if (!bound) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setDiyEditing(bound);
                                  setDiyOpen(true);
                                }}
                                aria-label={t("suppliers.diy_action_edit_aria")}
                                title={t("suppliers.diy_modal_edit")}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-sage-700 transition hover:bg-sage-100 dark:text-sage-300 dark:hover:bg-sage-400/20"
                              >
                                <Pencil size={13} aria-hidden />
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={() => togglePicked(s)}
                            aria-label={
                              isPicked ? t("suppliers.unpick_aria") : t("suppliers.pick_aria")
                            }
                            aria-pressed={isPicked}
                            title={t("suppliers.pick_aria")}
                            className={
                              isPicked
                                ? "inline-flex h-6 w-6 items-center justify-center rounded-full text-sage-700 transition hover:bg-sage-100 dark:text-sage-300 dark:hover:bg-sage-400/20"
                                : "inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-200 hover:text-sage-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-sage-300"
                            }
                          >
                            {isPicked ? (
                              <BookmarkCheck size={13} className="fill-sage-200" aria-hidden />
                            ) : (
                              <Bookmark size={13} aria-hidden />
                            )}
                          </button>
                          <SaveToggle isSaved={isSaved} onToggle={() => toggleSaved(s.id)} t={t} />
                        </div>
                        {/* Bottom-right: compare + community vote, also on the card */}
                        <div
                          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-xl bg-paper-50/95 px-1 py-1 backdrop-blur-sm dark:bg-umber-800/90"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CompareToggle
                            supplierId={s.id}
                            isCompared={isCompared}
                            capReached={compareCapReached}
                            onToggle={() => toggleCompare(s.id)}
                            t={t}
                          />
                          <VoteRow supplier={s} onVote={onVote} t={t} />
                        </div>
                      </div>
                      {/* Card body — name + price on one line and a single tight
                      meta line. No address/blurb/action row (all moved onto the
                      hero image above) so the body stays minimal. */}
                      <div
                        className={`flex flex-1 flex-col px-4 pb-3 pt-2.5 ${isPicked ? "bg-sage-50/60 dark:bg-sage-400/15" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <h3 className="min-w-0 truncate text-base font-semibold">{s.name}</h3>
                            {s.source === "claimed" && (
                              <VerifiedBadge complete={s.listing_complete} />
                            )}
                          </div>
                          {s.price_band !== null && (
                            <span
                              className="shrink-0 text-ink-600 dark:text-umber-200"
                              title={t("suppliers.price_legend")}
                              aria-label={t("suppliers.price_legend")}
                            >
                              <PriceBandDots band={s.price_band} />
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 flex min-w-0 items-center gap-x-1.5 truncate text-xs text-ink-500 dark:text-umber-300">
                          <Icon size={12} className="shrink-0" aria-hidden />
                          <span className="uppercase tracking-wide">
                            {t(`suppliers.cat.${s.category}`)}
                          </span>
                          <span aria-hidden className="text-paper-400 dark:text-umber-300">
                            ·
                          </span>
                          <span className="uppercase tracking-wide">{s.city}</span>
                          <DistanceHint
                            queryNorm={queryNorm}
                            city={s.city}
                            lat={s.lat}
                            lng={s.lng}
                          />
                          {showsCapacity(s) && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-ink-600 dark:text-umber-200"
                              aria-label={t("suppliers.capacity_label")}
                            >
                              <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                ·
                              </span>
                              <Users size={11} aria-hidden />
                              {s.capacity_min && s.capacity_max
                                ? t("suppliers.capacity_range", {
                                    min: s.capacity_min,
                                    max: s.capacity_max,
                                  })
                                : t("suppliers.capacity_max_only", { max: s.capacity_max ?? 0 })}
                            </span>
                          )}
                        </p>
                      </div>
                      {/* end card body */}
                    </article>
                  );
                })}
              </div>
              {filteredInScope.length > visibleCount && (
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + SUPPLIERS_PAGE_SIZE)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-50 px-4 text-sm font-medium text-ink-700 transition hover:border-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                  >
                    {t("suppliers.load_more", { n: filteredInScope.length - visibleCount })}
                  </button>
                </div>
              )}
              {/* Verified vendors who are on Weddly but work somewhere else.
                  Deliberately NOT cards: a card is what the page offers for the
                  wedding being planned, and these are not that. A compact,
                  labelled list keeps a registered business findable (the reason
                  the country scope exempts them at all) without letting a
                  Budapest florist answer "show me vendors in Italy". */}
              {countryScope && outOfScopeTail.length > 0 && (
                <section
                  aria-labelledby="out-of-country-heading"
                  className="mt-6 border-t border-paper-200 pt-4 dark:border-umber-700"
                >
                  <h3
                    id="out-of-country-heading"
                    className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
                  >
                    {t("suppliers.out_of_country_heading", {
                      country: countryName(countryScope, locale),
                    })}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-umber-300">
                    {t("suppliers.out_of_country_note")}
                  </p>
                  <ul className="mt-2 flex flex-col">
                    {outOfScopeTail.map((s) => (
                      <li key={s.id}>
                        <Link
                          to={`/app/suppliers/${encodeURIComponent(s.id)}`}
                          className="flex items-baseline gap-2 rounded-lg px-1 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50 dark:text-umber-100 dark:hover:bg-umber-800/60"
                        >
                          <span className="truncate font-medium">{s.name}</span>
                          <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                            {[t(`suppliers.cat.${s.category}`), s.city].filter(Boolean).join(" · ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {filteredOutOfScope.length > outOfScopeTail.length && (
                    <button
                      type="button"
                      onClick={() => setCountryFilter("all")}
                      className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-50 px-3 text-xs font-medium text-ink-700 transition hover:border-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
                    >
                      <Globe size={13} aria-hidden />
                      {t("suppliers.out_of_country_show_all", {
                        n: filteredOutOfScope.length - outOfScopeTail.length,
                      })}
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Outreach Inbox — the "shop → message" flow lives on the same
          page as the directory so couples can shortlist + reach out
          without leaving. The same component is the Megkeresések tab of
          /app/messages, which is where the rail points; /app/outreach
          redirects there. */}
      <OutreachInbox />

      {/* The scoping filters that used to sit in a boxed row above the chain.
          They belong together (all three narrow WHICH catalogue you're
          looking at, not which trade), they're set once and rarely touched,
          and out on the page they cost a whole band of chrome. The chip that
          opens this carries the count, so a live filter is never hidden. */}
      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        role="dialog"
        closeOnBackdrop
        title={t("suppliers.filters_button")}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={clearScopeFilters}
              disabled={scopeFilterCount === 0}
              className="text-sm text-ink-600 underline-offset-2 transition hover:text-ink-900 hover:underline disabled:text-ink-300 disabled:no-underline dark:text-umber-200 dark:hover:text-paper-50 dark:disabled:text-umber-500"
            >
              {t("suppliers.filters_clear")}
            </button>
            <Button onClick={() => setFiltersOpen(false)}>{t("suppliers.filters_apply")}</Button>
          </div>
        }
      >
        {/* One list, four rows, ONE pair of edges. Every row is
            label-left / control-right inside the same box, separated by
            hairlines and nothing else: no row carries a border or padding of
            its own, which is what used to make the country picker float mid-row
            and the guest card sit inset from the two rows above it. The controls
            therefore all end on the same right edge, and the labels all start on
            the same left one. */}
        <div className="-my-1 divide-y divide-paper-200 dark:divide-umber-700">
          <div className="flex min-h-[3.25rem] items-center justify-between gap-3">
            <span className={FILTER_ROW_LABEL}>{t("suppliers.country_filter_label")}</span>
            {/* The row owns the label, so the picker drops its own. */}
            <SupplierCountryFilter
              value={countrySelection}
              homeCountry={coupleCountry}
              countries={availableCountries}
              onChange={setCountryFilter}
              hideLabel
            />
          </div>

          <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span className={FILTER_ROW_LABEL}>{t("suppliers.price_filter_label")}</span>
            {/* Each chip is ONE band, not a ceiling: tapping $$$ shows band-3
                suppliers. Tap the same chip again to clear. */}
            <div className="inline-flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((band) => (
                <button
                  key={band}
                  type="button"
                  aria-pressed={priceBand === band}
                  aria-label={t("suppliers.price_filter_band_aria", { n: band })}
                  onClick={() => setPriceBand(priceBand === band ? null : band)}
                  className={
                    priceBand === band
                      ? "inline-flex h-8 items-center justify-center rounded-full border border-ink-900 bg-ink-900 px-3 text-sm font-medium text-paper-50 dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
                      : "inline-flex h-8 items-center justify-center rounded-full border border-paper-300 px-3 text-sm text-ink-600 transition hover:border-ink-900 hover:text-ink-900 dark:border-umber-700 dark:text-umber-200 dark:hover:border-paper-200 dark:hover:text-paper-50"
                  }
                >
                  {"$".repeat(band)}
                </button>
              ))}
            </div>
          </div>

          {/* The day being shopped for. Seeded with the wedding date because
              that is the question behind the whole directory, and editable
              because the second question is usually a different day. It only
              ever REMOVES suppliers with a real reason on file for being taken
              (a whole-day block, or a weekday they don't work) — an unclaimed
              entry has no calendar here, and "we don't know" must not read as
              "booked". */}
          <div className="flex min-h-[3.25rem] items-center justify-between gap-3">
            <span className={FILTER_ROW_LABEL}>{t("suppliers.date_filter_label")}</span>
            <span className="inline-flex items-center gap-1.5">
              {/* The marker for "this is not your wedding day", and the way
                  back. A dot rather than a sentence: the row is already
                  labelled, and the tooltip carries the words. */}
              {dateFilter && !dateIsWedding && weddingDate && (
                <button
                  type="button"
                  onClick={() => setDateFilter(null)}
                  title={t("suppliers.date_filter_not_wedding")}
                  aria-label={t("suppliers.date_filter_not_wedding")}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-blush-500 transition hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-950"
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                </button>
              )}
              <input
                type="date"
                value={dateFilter ?? ""}
                onChange={(e) => setDateFilter(e.target.value || null)}
                aria-label={t("suppliers.date_filter_label")}
                // pl-only: the row's right edge is the alignment line every control
                // shares, and the native date input already reserves its own
                // padding around the calendar indicator.
                // `dark:[color-scheme:dark]` rather than the `.input` class: this
                // field has no box by design, and index.css scopes the
                // color-scheme rule to `.input`. Without it the native calendar
                // glyph paints black on dark umber and disappears.
                className="rounded-lg bg-transparent py-0.5 pl-1 text-sm font-semibold tabular-nums text-ink-900 outline-none transition focus-visible:ring-2 focus-visible:ring-ink-900 dark:text-paper-50 dark:[color-scheme:dark] dark:focus-visible:ring-paper-200"
              />
            </span>
          </div>

          {/* Guest count is owned by the cost-planning slider on /app/budget and
              only mirrored here — two edit surfaces for one number is how they
              drift apart. So the whole row is a link that routes the edit. */}
          <Link
            to="/app/budget"
            className="group flex min-h-[3.25rem] items-center justify-between gap-3"
          >
            <span className={FILTER_ROW_LABEL}>{t("suppliers.guests_filter_label")}</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
              {guestsFilter ?? "-"}
              <ArrowUpRight
                size={14}
                aria-hidden
                className="text-ink-400 transition group-hover:text-ink-900 dark:text-umber-300 dark:group-hover:text-paper-50"
              />
            </span>
          </Link>
        </div>
      </Dialog>

      <SubmitSupplierModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={() => {
          // New submissions land as 'pending' and aren't returned by the
          // public list until the contact_email is verified. Skip the
          // optimistic insert and let the modal's "check your inbox" toast
          // do the talking.
        }}
      />
      <ReportSupplierDialog
        supplierId={reporting?.id ?? null}
        supplierName={reporting?.name ?? ""}
        onClose={() => setReporting(null)}
        onReported={({ autoHidden }) => {
          // When the report flips the listing to status='hidden', it disappears
          // from /api/suppliers — drop it from local state so the grid updates
          // without a refetch.
          if (autoHidden && reporting) {
            const targetId = `c${reporting.id}`;
            setItems((prev) => prev.filter((it) => it.id !== targetId));
          }
        }}
      />
      <DiyEntryModal
        open={diyOpen}
        editing={diyEditing}
        currency={currency}
        defaultCategory={activeCat ?? null}
        // The unfiltered directory, deliberately not `filtered` — a venue the
        // couple already booked is a twin whether or not it survives the city
        // chip and price band they happen to have set.
        directory={items}
        onUseExisting={adoptDirectorySupplier}
        onClose={() => {
          setDiyOpen(false);
          setDiyEditing(null);
        }}
        onSaved={(s) => {
          setCoupleSuppliers((prev) => {
            const idx = prev.findIndex((p) => p.id === s.id);
            if (idx === -1) return [s, ...prev];
            const next = [...prev];
            next[idx] = s;
            return next;
          });
          setHighlightId(s.id);
          // DIY entries auto-claim the selection slot for their category —
          // recording a "mum is cooking" entry means catering is locked in.
          if (coupleId !== null) {
            setSelectionState(setSelection(coupleId, s.category, s.id));
          }
        }}
        onDeleted={(id) => {
          setCoupleSuppliers((prev) => prev.filter((p) => p.id !== id));
          // Free up the slot if this DIY entry was the chosen one for its
          // category — otherwise the chain step would stay green forever.
          if (coupleId !== null) {
            setSelectionState(unselectById(coupleId, id));
          }
        }}
      />
      <CakeDrinksCalculator
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        currency={currency}
        defaultGuests={guestsFilter ?? targetGuestCount}
      />
      {compareIds.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 lg:bottom-6"
          aria-live="polite"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-paper-300 bg-paper-50/95 px-2 py-2 shadow-lg backdrop-blur dark:border-umber-700 dark:bg-umber-800/95">
            <span className="inline-flex items-center gap-1.5 pl-2 text-sm font-medium text-ink-700 dark:text-paper-100">
              <Scale size={14} aria-hidden />
              {t("suppliers.compare.floating_label", { n: compareIds.length })}
            </span>
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={compareIds.length < 2}
              title={compareIds.length < 2 ? t("suppliers.compare.floating_min_hint") : undefined}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-ink-700 px-3 text-xs font-medium text-paper-100 transition hover:bg-ink-900 disabled:cursor-not-allowed disabled:bg-ink-300 dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100 dark:disabled:bg-umber-600 dark:disabled:text-umber-400"
            >
              {t("suppliers.compare.floating_open")}
            </button>
            <button
              type="button"
              onClick={clearCompare}
              aria-label={t("suppliers.compare.floating_clear")}
              title={t("suppliers.compare.floating_clear")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <SupplierCompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        compareIds={compareIds}
        items={items}
        supplierCosts={supplierCosts}
        budgetLines={budgetLines}
        targetGuestCount={targetGuestCount}
        coupleCityFilter={cityFilter}
        coupleLocation={coupleLocation}
        currency={currency}
        locale={locale}
        onRemove={toggleCompare}
        t={t}
      />
    </>
  );
}

function ChainStep({
  active,
  onClick,
  label,
  icon,
  isAll,
  count,
  progress,
  t,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  isAll?: boolean;
  count?: number;
  /** "How many sub-categories are locked in" / "out of how many". Drives the
   *  thin bars under the label — sage once a pick lands, full-tile sage tint
   *  when every sub-cat is done. */
  progress?: { done: number; total: number };
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const allDone = progress !== undefined && progress.done > 0 && progress.done >= progress.total;
  // Every step keeps its label, its count and its width, whatever state it is
  // in. A resolved step used to shrink to an icon-only pill when it was not the
  // active one, which cost twice: the pill was an unlabelled button (the name
  // only existed in a tooltip a touch user never sees), and because the
  // condition read `!active`, CLICKING a step re-laid out the whole row: the
  // step you left shrank, the step you opened grew, and every step to the right
  // of them slid under the cursor. A second click then landed on a different
  // category from the one it was aimed at, which is a hazard on a row whose
  // whole job is deciding what the couple is looking at. "Done" is already said
  // by the sage fill and the full row of progress bars; it does not also need
  // to be said by taking the name away.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center justify-center rounded-full border px-3.5 pt-[5px] pb-2.5 text-sm transition-colors duration-300 ease-out ${
        active
          ? "border-transparent stationery-coffee text-paper-50"
          : allDone
            ? "border-sage-600 bg-sage-600 text-white hover:border-sage-700 hover:bg-sage-700 dark:border-sage-600 dark:bg-sage-600 dark:text-white dark:hover:border-sage-700 dark:hover:bg-sage-700"
            : "border-paper-300 bg-paper-50 text-ink-800 hover:border-ink-900 hover:text-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200"
      }`}
    >
      {/* Explicit h-4 row + leading-none on every child forces all three
          elements (icon, label, count) to share the same 16px box so
          they vertical-center identically regardless of intrinsic font
          metrics. Count uses the same text-xs as the label so number
          and text baselines align — text-[11px] was 1px shorter and
          drifted up. */}
      <span className="flex h-5 items-center justify-center gap-1.5">
        {!isAll && (
          <span className="flex h-5 items-center leading-none" aria-hidden>
            {icon}
          </span>
        )}
        <span className="flex h-5 items-center font-medium lowercase leading-none transition-colors duration-300 ease-out">
          {label}
        </span>
        {count !== undefined && (
          <span
            className={`flex h-5 items-center font-medium tabular-nums leading-none transition-colors duration-300 ease-out ${
              active
                ? "text-paper-50/70"
                : allDone
                  ? "text-white/75"
                  : "text-ink-400 dark:text-umber-300"
            }`}
          >
            {count}
          </span>
        )}
      </span>
      {progress !== undefined && progress.total > 0 && (
        <span
          className="absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-[3px]"
          aria-label={t("suppliers.chain_progress_aria", {
            done: progress.done,
            total: progress.total,
          })}
        >
          {Array.from({ length: progress.total }, (_, i) => ({
            id: `bar-${i}`,
            filled: i < progress.done,
          })).map((bar) => (
            <span
              key={bar.id}
              className={`h-[3px] w-3 rounded-full transition-colors duration-300 ease-out ${
                bar.filled
                  ? allDone
                    ? "bg-white/85"
                    : "bg-sage-500"
                  : active
                    ? "bg-paper-100/30 dark:bg-umber-900/30"
                    : "bg-umber-400/60 dark:bg-umber-700"
              }`}
              aria-hidden
            />
          ))}
        </span>
      )}
    </button>
  );
}

/** Round avatar slot on the supplier card. Renders the vendor's uploaded
 *  hero image when one exists (P2.D image upload), falling back to a
 *  monogram on unclaimed / curated rows the vendor hasn't filled. The slot
 *  size matches the listing card's leading column on every viewport so the
 *  layout doesn't shift between cards with and without an uploaded image. */
function Avatar({
  name,
  heroUrl,
  category,
  onClick,
  ariaLabel,
}: {
  name: string;
  heroUrl?: string | null;
  /** When set (and no hero image), the slot shows the category icon instead of
   *  the name monogram, so curated rows read by trade at a glance. */
  category?: SupplierCategory;
  /** When set, the slot becomes a button — clicking it filters the directory
   *  to this supplier's category. Stops propagation so it doesn't trigger any
   *  card-level handler. */
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const base =
    "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-paper-300 font-grotesk text-lg text-ink-700 dark:border-umber-700 dark:text-paper-100";
  const Icon = category ? CATEGORY_ICON[category] : null;
  const inner = heroUrl ? (
    <img src={heroUrl} alt={name} className="h-full w-full object-cover" loading="lazy" />
  ) : Icon ? (
    <Icon size={18} aria-hidden />
  ) : (
    name.charAt(0).toUpperCase()
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={`${base} cursor-pointer transition-colors hover:border-ink-400 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-1 dark:hover:border-umber-500 dark:hover:text-paper-50`}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/** Price-band scale: just N dollar signs ($ … $$$$$). No greyed
 *  remainder — the card reads cleaner without ghost glyphs. */
function PriceBandDots({ band }: { band: number }) {
  const filled = Math.max(0, Math.min(5, band));
  return <span className="font-mono">{"$".repeat(filled)}</span>;
}

/** Small "~45 km" hint that slots into the supplier card's meta row
 *  next to the city, with a `·` separator so it reads as another meta
 *  token (category · city · ~45 km · price · capacity) rather than an
 *  emphasised badge. Haversine distance from the typed query town
 *  (Pázmánd, Budapest, Zsámbék — anything in the metro dictionary) to
 *  the supplier's town. Renders nothing when:
 *  - no query typed,
 *  - the query / supplier city isn't in the dictionary,
 *  - the two cities live in different metro groups (cross-metro km is
 *    misleading and reads as a system bug),
 *  - distance rounds below 5 km ("same town" from a couple's pov).
 *  Title attribute carries the full "query → supplier: ~N km" detail
 *  for hover / a11y. */
function DistanceHint({
  queryNorm,
  city,
  lat,
  lng,
}: {
  queryNorm: string;
  city: string | null | undefined;
  lat?: number | null;
  lng?: number | null;
}) {
  const ctx = distanceContextForQuery(queryNorm, city, { lat: lat ?? null, lng: lng ?? null });
  if (!ctx) return null;
  return (
    <>
      <span aria-hidden className="text-paper-400 dark:text-umber-300">
        ·
      </span>
      <span
        className="whitespace-nowrap normal-case tracking-normal text-ink-500 dark:text-umber-300"
        title={`${ctx.fromLabel} → ${city}: ~${ctx.km} km`}
      >
        ~{ctx.km} km
      </span>
    </>
  );
}

/** Per-card toggle that adds / removes a supplier from the side-by-side
 *  comparison set. Disabled (but still keyboard-focusable) when the cap is
 *  reached and the card isn't already in the set. */
function CompareToggle({
  supplierId,
  isCompared,
  capReached,
  onToggle,
  t,
}: {
  supplierId: string;
  isCompared: boolean;
  capReached: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  const disabled = !isCompared && capReached;
  const label = isCompared ? t("suppliers.compare.remove_aria") : t("suppliers.compare.add_aria");
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={isCompared}
      aria-label={label}
      title={label}
      data-supplier-id={supplierId}
      className={
        isCompared
          ? "inline-flex h-7 w-7 items-center justify-center rounded-full border border-ink-900 text-ink-900 transition hover:bg-ink-900/5 dark:border-paper-200 dark:text-paper-100 dark:hover:bg-paper-100/10"
          : disabled
            ? "inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-300 dark:text-umber-500"
            : "inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-blush-300"
      }
    >
      <Scale size={14} aria-hidden />
    </button>
  );
}

/** The shortlist affordance, and deliberately a HEART rather than the bookmark
 *  next to it. The two mean different things and the icons have to say so:
 *  hearting is cheap and plural (as many per category as you like, recalled
 *  later from the toolbar chip), while the bookmark is `PUT /api/picks/:category`
 *  — one per category, "this is our photographer", a real commitment. A star
 *  read as a rating and blurred the line; the heart is the universal "keep this
 *  for later" and pairs with the blush it was already tinted. */
function SaveToggle({
  isSaved,
  onToggle,
  t,
}: {
  isSaved: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  const label = isSaved ? t("suppliers.unsave_aria") : t("suppliers.save_aria");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSaved}
      aria-label={label}
      title={label}
      className={
        isSaved
          ? "inline-flex h-9 w-9 items-center justify-center rounded-full text-blush-700 transition hover:bg-blush-50 sm:h-7 sm:w-7 dark:text-blush-300 dark:hover:bg-blush-400/15"
          : "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-700 sm:h-7 sm:w-7 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-blush-300"
      }
    >
      <Heart size={15} aria-hidden className={isSaved ? "fill-blush-500 text-blush-500" : ""} />
    </button>
  );
}

/** Placeholder slot for a contact action the supplier hasn't supplied (no
 *  website / phone / email). Keeps every card's action row the same width so
 *  the grid reads as a tidy column instead of a ragged one. The icon is
 *  greyed, inert, and explains itself on hover. */
function DisabledActionIcon({
  icon: Icon,
  label,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  label: string;
}) {
  return (
    <span
      className="inline-flex h-7 w-7 cursor-default items-center justify-center rounded-full text-ink-300 dark:text-umber-600"
      title={label}
      aria-label={label}
    >
      <Icon size={14} aria-hidden />
    </span>
  );
}

function ReportButton({ onReport, t }: { onReport: () => void; t: (key: string) => string }) {
  const label = t("suppliers.report.aria_label");
  return (
    <button
      type="button"
      onClick={onReport}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-700 sm:h-7 sm:w-7 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
    >
      <Flag size={14} aria-hidden />
    </button>
  );
}

/** Phone CTA that hides the digits behind a click. First tap reveals the
 *  number alongside the icon and arms the tel: href; the next tap dials.
 *  Two-step pattern keeps the card scannable without burying the contact. */
/** Click to get a vendor's number, then click again to dial it.
 *
 *  The number is NOT in the catalogue response any more, and this component is
 *  why that costs nothing in the UI: the card knows a phone exists
 *  (`has_contact_phone`) and asks for the digits only when someone means to
 *  call. Before, the whole directory arrived with every number attached and
 *  this component merely declined to draw them — the value sat in the JSON, and
 *  in this button's own `title`, for anyone who opened devtools.
 *
 *  A failed fetch (offline, or the per-user quota spent) leaves the button in
 *  its unrevealed state with an error tooltip rather than pretending to have a
 *  number: a dead `tel:` link is worse than a button that says try again.
 *
 *  `known` is the way OUT of the two-step: the catalogue does carry the number
 *  for a vendor this couple has corresponded with (both sides wrote), and making
 *  someone press "show number" for a vendor they have been mailing for a week is
 *  a lock on an open door. Given one, this renders the dial link straight away
 *  and never calls the endpoint. */
function PhoneReveal({
  supplierId,
  onCall,
  iconOnly,
  known,
}: {
  supplierId: string;
  onCall: () => void;
  /** List view's tight action cluster collapses the number even when revealed. */
  iconOnly?: boolean;
  known?: string | null;
}) {
  const { t } = useT();
  const [fetched, setFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Derived rather than seeded into state: the catalogue can land after this
  // mounts, and an initial-value-only `useState(known)` would keep showing the
  // button for a vendor whose number has since arrived.
  const phone = known ?? fetched;

  async function reveal() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const r = await supplierApi.contact(supplierId);
      const value = r.contact_phone || r.contact_phone_alt;
      if (value) setFetched(value);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (phone === null) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void reveal();
        }}
        disabled={loading}
        className="btn-outline btn-sm"
        aria-label={t(failed ? "suppliers.phone_failed" : "suppliers.phone_reveal")}
        title={t(failed ? "suppliers.phone_failed" : "suppliers.phone_reveal")}
      >
        {loading ? (
          <Loader2 size={14} aria-hidden className="animate-spin" />
        ) : (
          <Phone size={14} aria-hidden />
        )}
      </button>
    );
  }
  return (
    <a href={`tel:${phone}`} className="btn-outline btn-sm" aria-label={phone} onClick={onCall}>
      <Phone size={14} aria-hidden />
      {!iconOnly && <span>{phone}</span>}
      {iconOnly && <span className="hidden lg:inline">{phone}</span>}
    </a>
  );
}

export function VoteRow({
  supplier,
  onVote,
  t,
}: {
  supplier: DirectorySupplier;
  onVote: (id: string, value: -1 | 0 | 1) => void;
  t: (key: string) => string;
}) {
  // A card with a handful of votes and no reviews reads as a verdict on a
  // business nobody has actually reviewed. Hidden below the threshold rather
  // than disabled, since a greyed-out control still invites a tap.
  if (supplier.reviews_count < VOTE_MIN_REVIEWS) return null;
  const my = supplier.user_vote;
  // Tap-again-to-clear: if the user already cast this vote, the next tap
  // sends 0 (removes the vote); otherwise the new direction wins.
  const handle = (dir: 1 | -1) => {
    const next: -1 | 0 | 1 = my === dir ? 0 : dir;
    onVote(supplier.id, next);
  };
  // Wrap the up/score/down trio in a soft pill so it reads as one clickable
  // widget — important on score = 0 entries where the arrows otherwise
  // floated as bare icons next to a plain digit.
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-1 py-0.5 text-sm">
      <button
        type="button"
        onClick={() => handle(1)}
        aria-pressed={my === 1}
        aria-label={t("suppliers.vote_up_aria")}
        className={
          my === 1
            ? "inline-flex h-6 w-6 items-center justify-center rounded-full text-vote-up"
            : "inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-200 hover:text-vote-up dark:text-umber-200 dark:hover:bg-umber-700"
        }
      >
        <ArrowBigUp size={16} aria-hidden className={my === 1 ? "fill-current" : undefined} />
      </button>
      <span
        className={`min-w-[1.25rem] text-center tabular-nums ${
          supplier.votes_score > 0
            ? "text-blush-700 dark:text-blush-300"
            : supplier.votes_score < 0
              ? "text-ink-400 dark:text-umber-300"
              : "text-ink-600 dark:text-umber-200"
        }`}
      >
        {supplier.votes_score}
      </span>
      <button
        type="button"
        onClick={() => handle(-1)}
        aria-pressed={my === -1}
        aria-label={t("suppliers.vote_down_aria")}
        className={
          my === -1
            ? "inline-flex h-6 w-6 items-center justify-center rounded-full text-vote-down"
            : "inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-200 hover:text-vote-down dark:text-umber-200 dark:hover:bg-umber-700"
        }
      >
        <ArrowBigDown size={16} aria-hidden className={my === -1 ? "fill-current" : undefined} />
      </button>
    </div>
  );
}
