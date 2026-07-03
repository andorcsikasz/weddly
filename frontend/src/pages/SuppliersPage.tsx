// Static suppliers directory. v1 = read-only outbound contact only.
//
// Layout: a step-by-step "chain" of supplier groups along the top — selecting
// a step reveals its sub-categories. The chain mirrors the real-world booking
// order (venue first, details last). Above the chain: free-text search + city
// filter (persisted in URL params so back-button works) plus a "saved" star on
// each card backed by localStorage.

import { countryName } from "@shared/country_list";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import type {
  DirectorySupplier,
  SupplierCategory,
  SupplierCountryCount,
  SupplierGroup,
} from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
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
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  LayoutGrid,
  List,
  Map as MapIcon,
  Disc3,
  ExternalLink,
  Flower2,
  Flag,
  Gem,
  Globe,
  Hand,
  Lightbulb,
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
  Shirt,
  Sparkles,
  Speaker,
  Star,
  Store,
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
import { ReportSupplierDialog } from "../components/ReportSupplierDialog";
import { SupplierCountryFilter } from "../components/SupplierCountryFilter";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { Button, Skeleton, useToast } from "../components/ui";
import {
  hydrateCostPlanningCount,
  readCostPlanningCount,
  subscribeCostPlanningCount,
} from "../lib/cost_planning";
import {
  budgetApi,
  coupleApi,
  coupleSupplierApi,
  placesApi,
  supplierApi,
  supplierCostApi,
} from "../lib/endpoints";
import type { BudgetLine, Currency } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { SupplierCompareDialog } from "../components/SupplierCompareDialog";
import { formatMoney } from "../lib/format";
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
import { useT } from "../lib/i18n";
import { lazyWithReload } from "../lib/lazy_reload";
import { useDocumentMeta } from "../lib/seo";

// Leaflet + react-leaflet add ~150 KB minified that no other page uses —
// lazy-loading keeps the initial /app bundle small for couples who never
// open the map tab.
const SupplierMap = lazyWithReload(() => import("../components/SupplierMap"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const GROUP_ICON: Record<SupplierGroup, IconCmp> = {
  venue_stay: MapPin,
  food_drink: UtensilsCrossed,
  atmosphere: Sparkles,
  experience: PartyPopper,
  style: Scissors,
  details: Mail,
};

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
};

/** Categories the cake & drinks calculator is relevant to. The tool estimates
 *  sweets, cake and drink quantities from the guest count, so it surfaces only
 *  when one of these food/drink categories is the active filter. */
const CALC_CATEGORIES = new Set<SupplierCategory>(["cake_dessert", "bar_drinks", "catering"]);

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
  const [submitOpen, setSubmitOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [diyOpen, setDiyOpen] = useState(false);
  const [diyEditing, setDiyEditing] = useState<CoupleSupplier | null>(null);
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
        .search(term, coupleCountry || undefined)
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
  }, [cityInput, query, coupleCountry, gazetteerReady]);
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
        // One-shot view ping per mount: tell the analytics ingest which
        // directory cards this session actually sees. Scope it to the country
        // that's initially shown (the URL param if present, else the couple's
        // own country) so a session isn't credited views for the whole EU when
        // it only ever looked at one country. We swallow errors — the page
        // renders fine even if the ingest is down.
        const initialCountry = params.get("country") ?? couple.couple?.country ?? "";
        const initialScope = initialCountry && initialCountry !== "all" ? initialCountry : null;
        const shown = initialScope
          ? dir.suppliers.filter((s) => s.country === initialScope)
          : dir.suppliers;
        if (shown.length > 0) {
          supplierApi
            .recordEvents(shown.map((s) => ({ supplier_id: s.id, type: "view" })))
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
    },
    [coupleId, selection, toast, t],
  );

  // Once we know the couple, default the URL's `guests` filter — preferring
  // the live cost-planning slider value over the static onboarding target.
  // Only fires when the URL doesn't already carry a value; subsequent edits
  // (including clearing) take precedence.
  useEffect(() => {
    if (coupleId === null) return;
    if (params.has("guests")) return;
    const stored = readCostPlanningCount(coupleId);
    const seed = stored ?? targetGuestCount;
    if (seed === null || seed <= 0) return;
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

  // Directory rows scoped to the picked country. Everything downstream — the
  // result list, the chain/sub-category counts, the city autocomplete, and the
  // search suggestions — reads from this so the country scope is applied once
  // and consistently across grid + map. "Mind"/All leaves the full set through.
  const scopedItems = useMemo(
    () => (countryScope ? items.filter((s) => s.country === countryScope) : items),
    [items, countryScope],
  );

  // Cities derived from the scoped list, so the town autocomplete only offers
  // cities that belong to the selected country (no "Budapest" while browsing
  // Romania). Sorted alphabetically by locale rules.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const s of scopedItems) if (s.city) set.add(s.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale === "hu" ? "hu" : "en"));
  }, [scopedItems, locale]);

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
    // so they don't belong in the saved-list summary either way.
    let mine = showSavedOnly ? [] : coupleSuppliers;
    if (showPickedOnly) {
      const pickedIds = new Set(Object.values(selection));
      mine = mine.filter((s) => pickedIds.has(s.id));
    }
    if (q) {
      mine = mine.filter((s) => normalize(`${s.name} ${s.notes ?? ""}`).includes(q));
    }
    return [...mine, ...dir];
  }, [
    scopedItems,
    coupleSuppliers,
    cityFilter,
    showSavedOnly,
    saved,
    showPickedOnly,
    selection,
    priceBand,
    guestsFilter,
    query,
    gazetteerReady,
    geoResolved,
  ]);

  const filtered = useMemo(() => {
    let out = filteredBeforeCategory;
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
          if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
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
          if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
          if (a.source !== b.source) return a.source === "curated" ? -1 : 1;
        }
        return collator(a, b);
      });
    }
    return sorted;
  }, [filteredBeforeCategory, activeGroup, activeCat, sortMode, locale, queryNorm]);

  // How many of `filtered` are laid out right now. Reset to the first page
  // whenever the filtered set changes (new search / category / sort) so we
  // never show a stale offset, then grow it a page at a time on "load more".
  const [visibleCount, setVisibleCount] = useState(SUPPLIERS_PAGE_SIZE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on result change
  useEffect(() => setVisibleCount(SUPPLIERS_PAGE_SIZE), [filtered]);
  const visibleSuppliers = filtered.slice(0, visibleCount);

  // Per-group counts for the top chain. "Mind" gets the total across all
  // groups. Each group step gets its own count.
  const groupCounts = useMemo(() => {
    const map = new Map<SupplierGroup, number>();
    for (const g of SUPPLIER_GROUPS) map.set(g.id, 0);
    for (const s of filteredBeforeCategory) {
      for (const g of SUPPLIER_GROUPS) {
        if (g.categories.includes(s.category)) {
          map.set(g.id, (map.get(g.id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [filteredBeforeCategory]);

  // Per-category counts for the sub-category pills (only meaningful when a
  // group is active). "Mind" within the sub-row gets the in-group total.
  const subCategoryCounts = useMemo(() => {
    const map = new Map<SupplierCategory, number>();
    if (!activeGroup) return map;
    const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
    if (!group) return map;
    const allowed = new Set(group.categories);
    for (const c of group.categories) map.set(c, 0);
    for (const s of filteredBeforeCategory) {
      if (allowed.has(s.category)) map.set(s.category, (map.get(s.category) ?? 0) + 1);
    }
    return map;
  }, [filteredBeforeCategory, activeGroup]);

  const inGroupTotal = useMemo(() => {
    if (!activeGroup) return filteredBeforeCategory.length;
    return [...subCategoryCounts.values()].reduce((a, b) => a + b, 0);
  }, [activeGroup, filteredBeforeCategory.length, subCategoryCounts]);

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
      <header className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-grotesk">{t("suppliers.title")}</h1>
          <InfoHint text={t("suppliers.sub")} />
        </div>
        {/* Controls stack under the title on mobile so the view-mode pills and
            "Drop your own" button don't compress the heading + sub-copy into a
            tall narrow column. `flex-wrap` lets the two control groups break
            independently on the narrowest viewports. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          <div
            role="group"
            aria-label={t("suppliers.view_label")}
            className="inline-flex items-center rounded-full border border-umber-600 dark:border-umber-700 dark:bg-umber-800 p-0.5 text-xs"
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
                className={
                  viewMode === mode
                    ? "inline-flex items-center gap-1 rounded-full bg-ink-700 dark:bg-paper-50 dark:text-umber-900 px-2.5 py-1 text-paper-100"
                    : "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-600 dark:text-umber-200 hover:text-ink-900 dark:hover:text-paper-50"
                }
              >
                <VIcon size={12} aria-hidden /> {t(`suppliers.${label}`)}
              </button>
            ))}
          </div>
          {/* "Tipp leadása" is a community contribution, not a primary
              action — using btn-primary made it visually compete with
              the view toggle next to it (taller, dark navy) when it's
              actually a secondary affordance. Now: dashed outline at
              the toggle's exact height, Plus icon to reinforce
              "add new" semantics, ink-toned not navy. */}
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-umber-600 px-3 text-xs font-medium text-ink-700 transition hover:border-umber-700 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
          >
            <Plus size={12} aria-hidden />
            {t("suppliers.drop_your_own")}
          </button>
        </div>
      </header>

      {/* Search + city filter + saved chip. Inputs share the soft pill
          look of the "Mentett" toggle so the row reads as one quiet
          control surface rather than competing heavyweight fields. */}
      <div data-tour-target="vendors-search" className="mb-3 flex flex-wrap items-center gap-2">
        <Combobox
          className="min-w-[14rem] flex-1"
          value={query}
          onChange={setQuery}
          onSelect={onSearchSuggestion}
          options={searchSuggestions}
          ariaLabel={t("suppliers.search_label")}
          placeholder={t("suppliers.search_placeholder")}
          leadingIcon={Search}
          onClear={() => setQuery("")}
          inputClassName="h-9 w-full rounded-full border border-umber-600 pl-9 pr-9 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-umber-700 focus:border-umber-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-umber-600"
        />
        <Combobox
          className="w-full sm:w-60"
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
            cityNearbyKm != null ? t("suppliers.nearby_plus_km", { km: cityNearbyKm }) : undefined
          }
          inputClassName="h-9 w-full rounded-full border border-umber-600 pl-9 pr-20 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-umber-700 focus:border-umber-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-umber-600"
        />
        <button
          type="button"
          onClick={toggleSavedFilter}
          disabled={saved.size === 0 && !showSavedOnly}
          aria-pressed={showSavedOnly}
          aria-label={t("suppliers.saved_filter", { n: saved.size })}
          title={t("suppliers.saved_filter", { n: saved.size })}
          className={
            showSavedOnly
              ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700 dark:border-paper-50 px-3 text-sm font-medium text-ink-900 dark:text-paper-50"
              : `inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition disabled:cursor-default ${
                  saved.size > 0
                    ? "border-umber-600 text-ink-700 hover:border-umber-700 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                    : "border-umber-600 text-ink-500 dark:border-umber-700 dark:text-umber-300"
                }`
          }
        >
          <Star size={14} className={showSavedOnly ? "fill-current" : ""} aria-hidden />
          <span className="tabular-nums">{saved.size}</span>
        </button>
        <button
          type="button"
          onClick={togglePickedFilter}
          disabled={Object.keys(selection).length === 0 && !showPickedOnly}
          aria-pressed={showPickedOnly}
          aria-label={t(
            showPickedOnly ? "suppliers.picked_filter_active" : "suppliers.picked_filter_idle",
            { n: Object.keys(selection).length },
          )}
          title={t(
            showPickedOnly ? "suppliers.picked_filter_active" : "suppliers.picked_filter_idle",
            { n: Object.keys(selection).length },
          )}
          className={
            showPickedOnly
              ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-sage-600 px-3 text-sm font-medium text-sage-700 dark:border-sage-300 dark:text-sage-300"
              : `inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition disabled:cursor-default ${
                  Object.keys(selection).length > 0
                    ? "border-sage-400 text-sage-700 hover:border-sage-500 dark:border-sage-400/40 dark:text-sage-300"
                    : "border-umber-600 text-ink-500 dark:border-umber-700 dark:text-umber-300"
                }`
          }
        >
          <BookmarkCheck
            size={14}
            className={showPickedOnly || Object.keys(selection).length > 0 ? "fill-sage-200" : ""}
            aria-hidden
          />
          <span className="tabular-nums">{Object.keys(selection).length}</span>
        </button>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.sort_label")}</span>
          <select
            className="h-9 min-w-[10rem] rounded-full border border-umber-600 px-3 text-sm text-ink-800 transition hover:border-umber-700 focus:border-umber-700 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600 dark:focus:border-umber-600"
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
        </label>
      </div>

      {/* Row 2: catalogue scope (country) + price-band picker + guest-count,
          grouped inside a softened container so they read as one control.
          Country leads (it's the broadest scope), then Árszint, then the
          user-context Vendégszám. Each price chip represents one band —
          clicking the $$$$ chip filters to band-4 suppliers only, not
          "up to 4". Click the same chip to clear. Suppliers with no
          declared value pass through so non-venue cards are not dropped.
          The row wraps on narrow screens so the extra country control never
          pushes the guest count off the edge. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-paper-200 bg-paper-100/60 px-3 py-1.5 sm:gap-x-5 sm:px-4 dark:border-umber-700 dark:bg-umber-700/40">
        <SupplierCountryFilter
          value={countrySelection}
          homeCountry={coupleCountry}
          countries={availableCountries}
          onChange={setCountryFilter}
        />
        <div
          className="hidden h-4 w-px self-center bg-paper-300 dark:bg-umber-700 sm:block"
          aria-hidden
        />
        <div className="flex flex-nowrap items-center gap-2 shrink-0 sm:gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
            {t("suppliers.price_filter_label")}
          </span>
          <div className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((band) => {
              const active = priceBand !== null && band <= priceBand;
              return (
                <button
                  key={band}
                  type="button"
                  aria-pressed={priceBand === band}
                  aria-label={t("suppliers.price_filter_band_aria", { n: band })}
                  onClick={() => setPriceBand(priceBand === band ? null : band)}
                  className={
                    active
                      ? "inline-flex h-6 w-4 items-center justify-center text-[11px] sm:w-5 font-semibold text-ink-700 transition hover:text-ink-900 dark:text-paper-50"
                      : "inline-flex h-6 w-4 items-center justify-center text-[11px] sm:w-5 text-ink-300 transition hover:text-ink-500 dark:text-umber-500 dark:hover:text-umber-300"
                  }
                >
                  $
                </button>
              );
            })}
          </div>
          {priceBand !== null && (
            <button
              type="button"
              onClick={() => setPriceBand(null)}
              className="hidden text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline sm:inline dark:text-umber-300 dark:hover:text-paper-100"
            >
              {t("suppliers.guests_filter_clear")}
            </button>
          )}
        </div>
        <div
          className="hidden h-4 w-px self-center bg-paper-300 dark:bg-umber-700 sm:block"
          aria-hidden
        />
        {/* Guest count is read-only here — it's owned by the cost-planning
            slider on /app/budget and mirrored in. Editing it inline would
            give couples two sources of truth for the same number, so the
            whole control (label + value + arrow) is a link that routes
            edits to the budget page. */}
        <Link
          to="/app/budget"
          title={t("suppliers.guests_filter_edit_in_budget")}
          aria-label={t("suppliers.guests_filter_edit_in_budget")}
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 transition hover:bg-paper-50 sm:gap-2 dark:hover:bg-umber-800"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 transition group-hover:text-ink-700 dark:text-umber-300 dark:group-hover:text-paper-100">
            {t("suppliers.guests_filter_label")}
          </span>
          <span className="min-w-[2ch] text-center text-[11px] font-semibold tabular-nums text-ink-800 dark:text-paper-100">
            {guestsFilter ?? "-"}
          </span>
          <ArrowUpRight
            size={13}
            aria-hidden
            className="text-ink-400 transition group-hover:text-ink-700 dark:text-umber-300 dark:group-hover:text-paper-100"
          />
        </Link>
      </div>

      {/* Step chain. Sequence numbers dropped — the icons carry the meaning.
          Steps are packed tightly (gap-1) and separated by a thin forward
          arrow so the row reads as one process flow, not a sequence of
          buttons. Each step also carries a row of discreet bars (one per
          sub-category) that turn sage as the couple locks each pick in.
          The right-edge fade only shows when the row actually overflows —
          otherwise it leaves a phantom white slab next to the last step. */}
      <div className="relative mb-2">
        {/* snap-x mandatory keeps each step centred under a flicked thumb on
            touch widths — without it the row drifts mid-icon and the user
            has to nudge it back. snap-start on each child anchors the
            alignment to the leading edge of the step group. */}
        <div ref={chainScrollRef} className="overflow-x-auto snap-x snap-mandatory pb-1">
          <div className="flex min-w-max items-stretch gap-1">
            {SUPPLIER_GROUPS.map((g, i) => {
              const Icon = GROUP_ICON[g.id];
              const progress = groupSelectionProgress.byGroup.get(g.id) ?? {
                done: 0,
                total: g.categories.length,
              };
              return (
                <div key={g.id} className="flex snap-start items-stretch gap-1">
                  {i > 0 && (
                    <span className="self-center text-paper-400 dark:text-umber-300" aria-hidden>
                      →
                    </span>
                  )}
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
      <p className="mb-3 hidden text-xs text-ink-500 sm:block dark:text-umber-300">
        {t("suppliers.chain_help")}
      </p>

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
                ? "inline-flex items-center gap-1.5 rounded-xl border border-transparent stationery-coffee px-3 py-1 text-xs font-medium text-paper-50"
                : "inline-flex items-center gap-1.5 rounded-xl border border-umber-600 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 py-1 text-xs text-ink-700 dark:text-paper-100"
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
                    ? "inline-flex items-center gap-1.5 rounded-xl border border-transparent stationery-coffee px-3 py-1 text-xs font-medium text-paper-50"
                    : "inline-flex items-center gap-1.5 rounded-xl border border-umber-600 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 py-1 text-xs text-ink-700 dark:text-paper-100"
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
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-700 bg-transparent px-3 py-1 text-xs font-medium text-ink-700 transition hover:border-ink-900 hover:text-ink-900 dark:border-ink-300 dark:bg-transparent dark:text-ink-100 dark:hover:border-ink-200 dark:hover:text-paper-50"
              >
                <Calculator size={13} aria-hidden />
                <span>{t("suppliers.calc.open")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDiyEditing(null);
                setDiyOpen(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-700 bg-transparent px-3 py-1 text-xs font-medium text-ink-700 transition hover:border-ink-900 hover:text-ink-900 dark:border-ink-300 dark:bg-transparent dark:text-ink-100 dark:hover:border-ink-200 dark:hover:text-paper-50"
            >
              <Pencil size={13} aria-hidden />
              <span className="lowercase">{t("suppliers.diy_button_short")}</span>
            </button>
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
              suppliers={filtered.filter((s): s is DirectorySupplier => s.source !== "self")}
            />
          </Suspense>
        </div>
      ) : (
        <>
          {/* "Már foglaltam" card. Only appears once the couple has narrowed
              down to a specific sub-category (activeGroup AND activeCat both
              set) — without that context the autocomplete + admin-queue
              category pinning have nothing to anchor to. Rendered above the
              grid (full-width either way) so the `auto-rows-fr` grid below
              keeps every directory card the same height without this taller
              form inflating the card rows. */}
          {activeGroup && activeCat && (
            <div className="mb-3">
              <BookedSupplierCard
                coupleId={coupleId}
                category={activeCat}
                categoryLabel={t(`suppliers.cat.${activeCat}`)}
                items={items}
                pickedId={selection[activeCat] ?? null}
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
            {visibleSuppliers.map((s) => {
              const Icon = CATEGORY_ICON[s.category];
              const isHighlighted = s.id === highlightId;
              const isSaved = s.source !== "self" && saved.has(s.id);
              const isPicked = selection[s.category] === s.id;
              const isCompared = compareIds.includes(s.id);
              const compareCapReached = compareIds.length >= COMPARE_MAX;
              if (s.source === "self") {
                const openEdit = () => {
                  setDiyEditing(s);
                  setDiyOpen(true);
                };
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
                                {formatMoney(s.price_huf, currency, locale === "hu" ? "hu" : "en")}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={openEdit}
                        aria-label={t("suppliers.diy_action_edit_aria")}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-3 text-xs font-medium text-sage-700 transition hover:border-sage-500 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60"
                      >
                        <Pencil size={12} aria-hidden />
                        <span className="hidden sm:inline">{t("suppliers.diy_modal_edit")}</span>
                      </button>
                    </article>
                  );
                }
                return (
                  <article
                    key={s.id}
                    data-supplier-id={s.id}
                    className={`card !p-4 relative flex h-full flex-col border-sage-400 !bg-sage-50/60 dark:border-sage-400/40 dark:!bg-sage-400/15 ${
                      isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={openEdit}
                      aria-label={t("suppliers.diy_action_edit_aria")}
                      className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-sage-600 transition hover:bg-sage-100 hover:text-sage-800 dark:text-sage-300 dark:hover:bg-sage-400/20 dark:hover:text-sage-200"
                    >
                      <Pencil size={14} aria-hidden />
                    </button>
                    <div className="flex items-start gap-3 pr-8">
                      {/* Same DIY supplier card as above (expanded layout) — no
                        listings join, monogram fallback only. */}
                      <Avatar name={s.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold">{s.name}</h3>
                          <span className="shrink-0 rounded-full border border-sage-300 bg-sage-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-700 dark:border-sage-400/40 dark:bg-sage-400/20 dark:text-sage-300">
                            {t("suppliers.diy_pill")}
                          </span>
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
                          <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                            <Icon size={12} aria-hidden />
                            {t(`suppliers.cat.${s.category}`)}
                          </span>
                          {s.price_huf !== null && s.price_huf > 0 && (
                            <>
                              <span aria-hidden className="text-paper-400 dark:text-umber-300">
                                ·
                              </span>
                              <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-sage-700 dark:text-sage-300">
                                <Wallet size={12} aria-hidden />
                                {formatMoney(s.price_huf, currency, locale === "hu" ? "hu" : "en")}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    {s.notes && (
                      <p className="mt-2 line-clamp-3 text-sm text-ink-700 dark:text-paper-100">
                        {s.notes}
                      </p>
                    )}
                    <div className="mt-auto flex items-center justify-end gap-2 pt-3">
                      <button
                        type="button"
                        onClick={openEdit}
                        className="inline-flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-700 transition hover:border-sage-500 hover:bg-sage-100 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60 dark:hover:bg-sage-400/20"
                      >
                        <Pencil size={13} aria-hidden />
                        {t("suppliers.diy_modal_edit")}
                      </button>
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
                        <DistanceHint queryNorm={queryNorm} city={s.city} lat={s.lat} lng={s.lng} />
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
                        {(s.capacity_max ?? 0) > 0 && (
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
                                : t("suppliers.capacity_max_only", { max: s.capacity_max ?? 0 })}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {/* Action cluster: contact CTAs collapse to icons on small
                      widths so the row never wraps. Star + vote pinned to the
                      far right. */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="btn-outline btn-sm"
                        aria-label={t("suppliers.visit_website")}
                        onClick={() => trackSupplierClick(s.id, "website_click")}
                      >
                        <span className="hidden md:inline">{t("suppliers.visit_website")}</span>
                        <span className="md:hidden">→</span>
                      </a>
                      {s.contact_phone && (
                        <PhoneReveal
                          phone={s.contact_phone}
                          onCall={() => trackSupplierClick(s.id, "phone_click")}
                          iconOnly
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
                    if (e.key === "Enter") navigate(`/app/suppliers/${encodeURIComponent(s.id)}`);
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
                      <img
                        src={s.hero_image_url}
                        alt=""
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
                    {/* Top-right: pick + save */}
                    <div
                      className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-xl bg-paper-50/85 px-1 py-1 backdrop-blur-sm dark:bg-umber-800/80"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                      className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-xl bg-paper-50/85 px-1 py-1 backdrop-blur-sm dark:bg-umber-800/80"
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
                      <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{s.name}</h3>
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
                      <DistanceHint queryNorm={queryNorm} city={s.city} lat={s.lat} lng={s.lng} />
                      {(s.capacity_max ?? 0) > 0 && (
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
            {filtered.length === 0 && items.length > 0 && (
              <div className="col-span-full flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm text-ink-500 dark:text-umber-300">
                  {countryScope
                    ? t("suppliers.empty_country", {
                        country: countryName(countryScope, locale),
                      })
                    : t("suppliers.empty_filtered")}
                </p>
                {/* When the emptiness is caused by the country scope, offer a
                    one-tap widen to "Mind"/All rather than leaving the couple
                    at a dead end (audit item 12). */}
                {countryScope && (
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
          </div>
          {filtered.length > visibleCount && (
            <div className="flex justify-center pt-3">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + SUPPLIERS_PAGE_SIZE)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-300 bg-paper-50 px-4 text-sm font-medium text-ink-700 transition hover:border-ink-500 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500 dark:hover:bg-umber-700"
              >
                {t("suppliers.load_more", { n: filtered.length - visibleCount })}
              </button>
            </div>
          )}
        </>
      )}

      {/* Outreach Inbox — the "shop → message" flow lives on the same
          page as the directory so couples can shortlist + reach out
          without leaving. Previously lived at /app/outreach; that URL
          now redirects here. */}
      <OutreachInbox />

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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center justify-center rounded-lg border px-2.5 pt-[5px] pb-2.5 text-sm transition-colors duration-300 ease-out ${
        active
          ? "border-transparent stationery-coffee text-paper-50"
          : allDone
            ? "border-sage-400 bg-sage-50 text-sage-800 hover:border-sage-500 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60"
            : "border-umber-600 bg-umber-100 text-ink-800 hover:border-umber-700 hover:bg-umber-200 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
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
                  ? "text-sage-700/80 dark:text-sage-300/80"
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
                  ? "bg-sage-500"
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
          ? "inline-flex h-7 w-7 items-center justify-center rounded-full bg-blush-100 text-blush-700 transition hover:bg-blush-200 dark:bg-blush-400/20 dark:text-blush-300 dark:hover:bg-blush-400/30"
          : disabled
            ? "inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-300 dark:text-umber-500"
            : "inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-blush-300"
      }
    >
      <Scale size={14} aria-hidden />
    </button>
  );
}

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
      <Star size={15} aria-hidden className={isSaved ? "fill-blush-500 text-blush-500" : ""} />
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
function PhoneReveal({
  phone,
  onCall,
  iconOnly,
}: {
  phone: string;
  onCall: () => void;
  /** List view's tight action cluster collapses the number even when revealed. */
  iconOnly?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!revealed) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setRevealed(true);
        }}
        className="btn-outline btn-sm"
        aria-label={phone}
        title={phone}
      >
        <Phone size={14} aria-hidden />
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

function VoteRow({
  supplier,
  onVote,
  t,
}: {
  supplier: DirectorySupplier;
  onVote: (id: string, value: -1 | 0 | 1) => void;
  t: (key: string) => string;
}) {
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
            ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/20 dark:text-blush-300"
            : "inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-200 hover:text-blush-700 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-blush-300"
        }
      >
        <ArrowBigUp size={16} aria-hidden />
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
            ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-paper-300 text-ink-800 dark:bg-umber-600 dark:text-paper-50"
            : "inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-600 transition hover:bg-paper-200 hover:text-ink-800 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-paper-50"
        }
      >
        <ArrowBigDown size={16} aria-hidden />
      </button>
    </div>
  );
}
