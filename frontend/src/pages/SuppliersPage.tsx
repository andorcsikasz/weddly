// Static suppliers directory. v1 = read-only outbound contact only.
//
// Layout: a step-by-step "chain" of supplier groups along the top — selecting
// a step reveals its sub-categories. The chain mirrors the real-world booking
// order (venue first, details last). Above the chain: free-text search + city
// filter (persisted in URL params so back-button works) plus a "saved" star on
// each card backed by localStorage.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { DirectorySupplier, SupplierCategory, SupplierGroup } from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  ChefHat,
  ArrowBigDown,
  ArrowBigUp,
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
  UserCheck,
  Users,
  UtensilsCrossed,
  Wallet,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DiyEntryModal } from "../components/DiyEntryModal";
import { ClaimListingModal } from "../components/ClaimListingModal";
import { ReportSupplierDialog } from "../components/ReportSupplierDialog";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { Button, Skeleton } from "../components/ui";
import {
  hydrateCostPlanningCount,
  readCostPlanningCount,
  subscribeCostPlanningCount,
  writeCostPlanningCount,
} from "../lib/cost_planning";
import {
  budgetApi,
  coupleApi,
  coupleSupplierApi,
  supplierApi,
  supplierCostApi,
} from "../lib/endpoints";
import type { BudgetLine, Currency } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { SupplierCompareDialog } from "../components/SupplierCompareDialog";
import { formatMoney } from "../lib/format";
import { metroKeysForCity } from "../lib/hu_metro_areas";
import {
  readSelection,
  type SelectionMap,
  setSelection,
  subscribeSelection,
  unselectById,
} from "../lib/supplier_selection";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

// Leaflet + react-leaflet add ~150 KB minified that no other page uses —
// lazy-loading keeps the initial /app bundle small for couples who never
// open the map tab.
const SupplierMap = lazy(() => import("../components/SupplierMap"));

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

const SAVED_LS_KEY = "weddly.suppliers.saved";

function readSaved(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function writeSaved(set: Set<string>) {
  try {
    localStorage.setItem(SAVED_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota / private mode
  }
}

export default function SuppliersPage() {
  const { t, locale } = useT();
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
  const [diyOpen, setDiyOpen] = useState(false);
  const [diyEditing, setDiyEditing] = useState<CoupleSupplier | null>(null);
  // Report dialog state. `reporting` holds the numeric id + name; null when closed.
  const [reporting, setReporting] = useState<{ id: number; name: string } | null>(null);
  // Claim dialog state. `claimTarget` holds the public listing id (curated
  // slug or `c{N}`) + name; null when closed. Surfaced to vendors who land
  // on the public directory and recognise their own business.
  const [claimTarget, setClaimTarget] = useState<{ id: string; name: string } | null>(null);
  const { user } = useAuth();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => readSaved());
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
  function toggleSavedFilter() {
    const p = new URLSearchParams(params);
    if (showSavedOnly) p.delete("saved");
    else p.set("saved", "1");
    setParams(p, { replace: true });
  }
  function togglePickedFilter() {
    const p = new URLSearchParams(params);
    if (showPickedOnly) p.delete("picked");
    else p.set("picked", "1");
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
  function setGuestsFilter(next: string) {
    const trimmed = next.trim();
    const p = new URLSearchParams(params);
    let parsed: number | null = null;
    if (!trimmed) {
      p.delete("guests");
    } else {
      const n = Number(trimmed);
      if (Number.isInteger(n) && n > 0) {
        p.set("guests", String(n));
        parsed = n;
      } else {
        p.delete("guests");
      }
    }
    setParams(p, { replace: true });
    // Mirror the value back to /app/budget's cost-planning slider so the
    // two surfaces stay in sync. Clearing the filter does NOT clear the
    // slider — the slider always has a working value, so we only push
    // positive integers across.
    if (coupleId !== null && parsed !== null) {
      writeCostPlanningCount(coupleId, parsed);
    }
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
      supplierApi
        .list()
        .then((r) => setItems(r.suppliers))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // Fetch the public directory, the couple's private DIY entries, and the
    // couple. The Vendégszám default prefers the live cost-planning slider
    // value from /app/budget (kept in localStorage) over the static
    // onboarding target, so the two pages stay in sync without round-trips.
    Promise.all([supplierApi.list(), coupleSupplierApi.list(), coupleApi.current()])
      .then(([dir, mine, couple]) => {
        setItems(dir.suppliers);
        setCoupleSuppliers(mine.suppliers);
        const id = couple.couple?.id ?? null;
        setCoupleId(id);
        setTargetGuestCount(couple.couple?.target_guest_count ?? null);
        if (couple.couple) setCurrency(couple.couple.currency ?? "HUF");
        // Seed the shared cost-planning cache from the couple we just
        // fetched so the Vendégszám filter and the /app/budget slider
        // start on the same value.
        if (couple.couple) hydrateCostPlanningCount(couple.couple);
        if (id !== null) setSelectionState(readSelection(id));
        // One-shot view ping per mount: tell the analytics ingest which
        // directory cards this session actually loaded. The admin directory
        // view aggregates these into total/30d/7d windows. We swallow errors
        // — the page renders fine even if the ingest is down.
        if (dir.suppliers.length > 0) {
          supplierApi
            .recordEvents(dir.suppliers.map((s) => ({ supplier_id: s.id, type: "view" })))
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
  }, []);

  // Cross-tab pick sync — partner B picks a venue in another tab, we
  // reflect it here without a refresh.
  useEffect(() => {
    if (coupleId === null) return;
    return subscribeSelection(coupleId, (next) => setSelectionState(next));
  }, [coupleId]);

  const togglePicked = useCallback(
    (supplier: DirectorySupplier | CoupleSupplier) => {
      if (coupleId === null) return;
      const cat = supplier.category;
      const isPicked = selection[cat] === supplier.id;
      const next = setSelection(coupleId, cat, isPicked ? null : supplier.id);
      setSelectionState(next);
    },
    [coupleId, selection],
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

  const toggleSaved = useCallback((id: string) => {
    setSaved((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeSaved(next);
      return next;
    });
  }, []);

  // Cities derived from the loaded list. Sorted alphabetically by locale rules.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) if (s.city) set.add(s.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale === "hu" ? "hu" : "en"));
  }, [items, locale]);

  // Items after all the non-category filters (city, saved, price, guests,
  // free-text). Used twice: as the base for the displayed list AND to compute
  // counts for the chain steps + sub-category pills — pills show "how many
  // would appear if I picked this", so they must ignore the active category.
  //
  // DIY entries are merged in here so the count badges include them too.
  // City / saved / price-band / capacity filters do not apply to DIY entries
  // (they don't have those fields); the free-text search hits name + notes.
  const filteredBeforeCategory = useMemo<(DirectorySupplier | CoupleSupplier)[]>(() => {
    let dir = items;
    if (cityFilter) dir = dir.filter((s) => s.city === cityFilter);
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
    const q = normalize(query.trim());
    if (q) {
      dir = dir.filter((s) => {
        // metroKeysForCity expands the haystack with HU metro tags
        // (e.g., Vasad → "budapest"), so typing "Budapest" surfaces the
        // whole Bp agglomeration the booking.com way. Returns "" for
        // cities outside the curated metro map — no false positives.
        const hay = normalize(
          `${s.name} ${s.city} ${s.blurb_hu} ${s.blurb_en} ${metroKeysForCity(s.city)}`,
        );
        return hay.includes(q);
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
    items,
    coupleSuppliers,
    cityFilter,
    showSavedOnly,
    saved,
    showPickedOnly,
    selection,
    priceBand,
    guestsFilter,
    query,
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
    if (sortMode === "alpha") {
      sorted.sort(collator);
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
  }, [filteredBeforeCategory, activeGroup, activeCat, sortMode, locale]);

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

  return (
    <>
      <header className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1>{t("suppliers.title")}</h1>
          {/* Subtitle hidden on mobile — the page already has 7 rows of
              chrome before the first supplier card, and the booking caveat
              ("booking arrives in v2") isn't actionable on first scroll. */}
          <p className="mt-1 hidden text-sm text-ink-500 sm:block dark:text-umber-300">
            {t("suppliers.sub")}
          </p>
        </div>
        {/* Controls stack under the title on mobile so the view-mode pills and
            "Drop your own" button don't compress the heading + sub-copy into a
            tall narrow column. `flex-wrap` lets the two control groups break
            independently on the narrowest viewports. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          <div
            role="group"
            aria-label={t("suppliers.view_label")}
            className="inline-flex items-center rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 p-0.5 text-xs"
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
          <Button
            variant="primary"
            size="sm"
            className="btn-lifted"
            onClick={() => setSubmitOpen(true)}
          >
            {t("suppliers.drop_your_own")}
          </Button>
        </div>
      </header>

      {/* Search + city filter + saved chip. Inputs share the soft pill
          look of the "Mentett" toggle so the row reads as one quiet
          control surface rather than competing heavyweight fields. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">{t("suppliers.search_label")}</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
            aria-hidden
          />
          <input
            type="search"
            className="h-9 w-full rounded-full border border-paper-300 bg-paper-50 pl-9 pr-3 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-umber-600"
            placeholder={t("suppliers.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("suppliers.search_label")}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.city_label")}</span>
          <select
            className="h-9 min-w-[10rem] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-800 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600 dark:focus:border-umber-600"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label={t("suppliers.city_label")}
          >
            <option value="">{t("suppliers.city_all")}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={toggleSavedFilter}
          aria-pressed={showSavedOnly}
          aria-label={t("suppliers.saved_filter", { n: saved.size })}
          title={t("suppliers.saved_filter", { n: saved.size })}
          className={
            showSavedOnly
              ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900 px-3 text-sm font-medium text-paper-100"
              : "inline-flex h-9 items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 text-sm text-ink-700 dark:text-paper-100 hover:border-ink-300 dark:hover:border-umber-600"
          }
        >
          <Star size={14} className={showSavedOnly ? "fill-paper-100" : ""} aria-hidden />
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
              ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-sage-600 bg-sage-600 px-3 text-sm font-medium text-paper-100 dark:border-sage-300 dark:bg-sage-300 dark:text-umber-900"
              : `inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition disabled:cursor-default ${
                  Object.keys(selection).length > 0
                    ? "border-sage-400 bg-sage-50 text-sage-700 hover:border-sage-500 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300"
                    : "border-paper-300 bg-paper-50 text-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300"
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
            className="h-9 min-w-[10rem] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-800 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600 dark:focus:border-umber-600"
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

      {/* Row 2: price-band picker (5 dollar-sign chips, one per exact 1..5) +
          guest-count number filter, grouped inside a softened container so
          they read as one control. Each chip represents one band —
          clicking the $$$$ chip filters to band-4 suppliers only, not
          "up to 4". Click the same chip to clear. Suppliers with no
          declared value pass through so non-venue cards are not dropped. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-paper-200 bg-paper-100/60 px-3 py-2 sm:gap-x-6 sm:gap-y-3 sm:px-4 sm:py-3 dark:border-umber-700 dark:bg-umber-700/40">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
            {t("suppliers.price_filter_label")}
          </span>
          <div className="inline-flex items-center gap-0.5 font-mono">
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
                      ? "inline-flex h-6 w-5 items-center justify-center text-sm font-semibold text-ink-700 transition hover:text-ink-900 dark:text-paper-50"
                      : "inline-flex h-6 w-5 items-center justify-center text-sm text-ink-300 transition hover:text-ink-500 dark:text-umber-500 dark:hover:text-umber-300"
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
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
            >
              {t("suppliers.guests_filter_clear")}
            </button>
          )}
        </div>
        <div
          className="hidden h-5 w-px self-center bg-paper-300 dark:bg-umber-700 sm:block"
          aria-hidden
        />
        <label className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
            {t("suppliers.guests_filter_label")}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="h-9 w-16 rounded-full border border-paper-300 bg-paper-50 px-2 text-center text-sm tabular-nums text-ink-800 placeholder:text-ink-400 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:placeholder:text-umber-300 dark:hover:border-umber-600 dark:focus:border-umber-600"
            placeholder={t("suppliers.guests_filter_placeholder")}
            value={guestsFilter ?? ""}
            onChange={(e) => setGuestsFilter(e.target.value)}
            aria-label={t("suppliers.guests_filter_label")}
          />
          {guestsFilter !== null && (
            <button
              type="button"
              onClick={() => setGuestsFilter("")}
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline dark:text-umber-300 dark:hover:text-paper-100"
            >
              {t("suppliers.guests_filter_clear")}
            </button>
          )}
        </label>
      </div>

      {/* Step chain. Sequence numbers dropped — the icons carry the meaning.
          Steps are packed tightly (gap-1) and separated by a thin forward
          arrow so the row reads as one process flow, not a sequence of
          buttons. Each step also carries a row of discreet bars (one per
          sub-category) that turn sage as the couple locks each pick in.
          The right-edge fade only shows when the row actually overflows —
          otherwise it leaves a phantom white slab next to the last step. */}
      <div className="relative mb-3">
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
      <p className="mb-5 hidden text-xs text-ink-500 sm:block dark:text-umber-300">
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
        <div className="mb-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-5 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            className={
              activeCat === null
                ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900 px-3 py-1 text-xs font-medium text-paper-100"
                : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 py-1 text-xs text-ink-700 dark:text-paper-100"
            }
          >
            {t("suppliers.filter_all")}
            <span
              className={
                activeCat === null
                  ? "rounded-full bg-paper-100/20 dark:bg-umber-900/30 px-1.5 text-[10px] font-medium tabular-nums"
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
                    ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900 px-3 py-1 text-xs font-medium text-paper-100"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 py-1 text-xs text-ink-700 dark:text-paper-100"
                }
              >
                <Icon size={13} />
                {t(`suppliers.cat.${c}`)}
                <span
                  className={
                    selected
                      ? "rounded-full bg-paper-100/20 dark:bg-umber-900/30 px-1.5 text-[10px] font-medium tabular-nums"
                      : "text-[10px] font-medium tabular-nums text-ink-400 dark:text-umber-300"
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
          {/* "Csinálom magam" — pre-fills the modal with the active sub-
              category. On sm+ it sits flush-right of the pill row via
              `ml-auto` so its sage accent reads as the personal twin of
              the dark category pills. On mobile the row is a horizontal
              scroller — `ml-auto` is meaningless there, so the button
              just rides as the last shrink-0 chip. shrink-0 keeps the
              full label visible at the end of the scroll. */}
          <button
            type="button"
            onClick={() => {
              setDiyEditing(null);
              setDiyOpen(true);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sage-400 bg-sage-50 px-3 py-1 text-xs font-medium text-sage-700 transition hover:border-sage-600 hover:bg-sage-100 sm:ml-auto dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60 dark:hover:bg-sage-400/20"
          >
            <Pencil size={13} aria-hidden />
            {t("suppliers.diy_button_short")}
          </button>
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
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              {
                key: "booking",
                href: "https://www.booking.com/",
                label: "Booking.com",
                blurb: t("suppliers.accommodation_external_booking_blurb"),
              },
              {
                key: "airbnb",
                href: "https://www.airbnb.com/",
                label: "Airbnb",
                blurb: t("suppliers.accommodation_external_airbnb_blurb"),
              },
              {
                key: "szallas_hu",
                href: "https://www.szallas.hu/",
                label: "Szállás.hu",
                blurb: t("suppliers.accommodation_external_szallas_hu_blurb"),
              },
            ].map((p) => (
              <li key={p.key}>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex h-full items-start gap-3 rounded-xl border border-paper-200 bg-white px-3 py-3 transition hover:border-sage-400 hover:shadow-sm dark:border-umber-700 dark:bg-umber-900 dark:hover:border-sage-400/60"
                >
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-600 transition group-hover:bg-sage-100 group-hover:text-sage-700 dark:bg-umber-800 dark:text-umber-200 dark:group-hover:bg-sage-400/20 dark:group-hover:text-sage-300">
                    <BedDouble size={13} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 group-hover:text-sage-700 dark:text-paper-100 dark:group-hover:text-sage-300">
                      {p.label}
                      <ExternalLink
                        size={12}
                        aria-hidden
                        className="text-ink-400 transition group-hover:text-sage-700 dark:text-umber-300 dark:group-hover:text-sage-300"
                      />
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500 dark:text-umber-300">
                      {p.blurb}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewMode === "map" ? (
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
      ) : (
        <div
          className={
            viewMode === "line" ? "flex flex-col gap-2" : "grid auto-rows-fr gap-3 md:grid-cols-2"
          }
        >
          {filtered.map((s) => {
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
                    className={`relative flex items-center gap-3 rounded-2xl border border-sage-200 border-l-4 border-l-sage-500 bg-sage-50/60 px-4 py-3 transition hover:border-sage-300 hover:shadow-sm dark:border-sage-400/40 dark:bg-sage-400/15 dark:hover:border-sage-400/60 ${
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
                  className={`card-hover !p-4 relative flex h-full flex-col border-l-4 border-l-sage-500 !bg-sage-50/60 dark:!bg-sage-400/15 transition-shadow ${
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
                      ? "border-sage-400 border-l-4 border-l-sage-500 bg-sage-50/70 dark:border-sage-400/40 dark:bg-sage-400/15"
                      : "border-paper-200 bg-paper-50 hover:border-paper-300 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
                  } ${isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""}`}
                >
                  <Avatar name={s.name} heroUrl={s.hero_image_url} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{s.name}</h3>
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
                      <span aria-hidden className="text-paper-400 dark:text-umber-300">
                        ·
                      </span>
                      <span className="uppercase tracking-wide">{s.city}</span>
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
                      aria-label={isPicked ? t("suppliers.unpick_aria") : t("suppliers.pick_aria")}
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
                className={`card-hover !p-4 relative flex h-full flex-col transition-shadow ${
                  isPicked
                    ? "border-sage-400 border-l-4 border-l-sage-500 !bg-sage-50/60 dark:border-sage-400/40 dark:!bg-sage-400/15"
                    : ""
                } ${isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""}`}
              >
                {/* Top-right corner: "save for later" toggles (pick + star).
                    Compare and report now live in the bottom action row so
                    every per-card action is visible at a glance. */}
                <div className="absolute right-3 top-3 inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => togglePicked(s)}
                    aria-label={isPicked ? t("suppliers.unpick_aria") : t("suppliers.pick_aria")}
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
                </div>
                {/* Single-column body: avatar + name + meta line (with price
                    band and capacity inline so the meta strip stays one line),
                    address, blurb, then a bottom action row that places the
                    contact buttons on the left and the vote on the right
                    corner. The right padding on the name reserves space for
                    the pinned-corner controls above. */}
                <div className="flex items-start gap-3 pr-16">
                  <Avatar name={s.name} heroUrl={s.hero_image_url} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{s.name}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
                      <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                        <Icon size={12} aria-hidden />
                        {t(`suppliers.cat.${s.category}`)}
                      </span>
                      <span aria-hidden className="text-paper-400 dark:text-umber-300">
                        ·
                      </span>
                      <span className="uppercase tracking-wide">{s.city}</span>
                      {s.price_band !== null && (
                        <>
                          <span aria-hidden className="text-paper-400 dark:text-umber-300">
                            ·
                          </span>
                          <span
                            className="text-ink-600 dark:text-umber-200"
                            title={t("suppliers.price_legend")}
                            aria-label={t("suppliers.price_legend")}
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
                          <span
                            className="inline-flex items-center gap-1 whitespace-nowrap text-ink-600 dark:text-umber-200"
                            aria-label={t("suppliers.capacity_label")}
                          >
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
                      {s.source === "community" && s.submitter_type === "self" && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-800 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300"
                          title={t("suppliers.self_pill_tooltip")}
                          aria-label={t("suppliers.self_pill_tooltip")}
                        >
                          <Store size={10} aria-hidden />
                          {t("suppliers.self_pill")}
                        </span>
                      )}
                      {s.source === "community" && s.submitter_type !== "self" && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-blush-200 bg-blush-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300"
                          title={t("suppliers.community_pill_tooltip")}
                          aria-label={t("suppliers.community_pill_tooltip")}
                        >
                          <Users size={10} aria-hidden />
                          {t("suppliers.community_pill")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {s.address && (
                  <p className="mt-2 line-clamp-1 text-xs text-ink-500 dark:text-umber-300">
                    {s.address}
                  </p>
                )}
                <p className="mt-2 line-clamp-2 text-sm text-ink-700 dark:text-paper-100">
                  {locale === "hu" ? s.blurb_hu : s.blurb_en}
                </p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={s.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-ghost btn-sm"
                      aria-label={t("suppliers.visit_website")}
                      title={t("suppliers.visit_website")}
                      onClick={() => trackSupplierClick(s.id, "website_click")}
                    >
                      <Globe size={14} aria-hidden />
                    </a>
                    {s.contact_phone && (
                      <PhoneReveal
                        phone={s.contact_phone}
                        onCall={() => trackSupplierClick(s.id, "phone_click")}
                      />
                    )}
                    {s.contact_email && (
                      <a
                        href={`mailto:${s.contact_email}`}
                        className="btn-ghost btn-sm"
                        aria-label={t("suppliers.contact_email")}
                      >
                        <Mail size={14} />
                      </a>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
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
                </div>
                {s.vendor_account_id === null && user?.role !== "vendor" && (
                  <button
                    type="button"
                    onClick={() => setClaimTarget({ id: s.id, name: s.name })}
                    className="mt-2 inline-flex items-center gap-1 self-start text-xs text-ink-500 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
                  >
                    <UserCheck size={12} aria-hidden />
                    {t("vendor_claim.button_label")}
                  </button>
                )}
              </article>
            );
          })}
          {filtered.length === 0 && items.length > 0 && (
            <p className="col-span-full py-8 text-center text-sm text-ink-500 dark:text-umber-300">
              {t("suppliers.empty_filtered")}
            </p>
          )}
        </div>
      )}

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
      <ClaimListingModal
        listingId={claimTarget?.id ?? null}
        listingName={claimTarget?.name ?? ""}
        onClose={() => setClaimTarget(null)}
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
      className={`group flex flex-col items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-ink-700 bg-ink-700 text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
          : allDone
            ? "border-sage-400 bg-sage-50 text-sage-800 hover:border-sage-500 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300 dark:hover:border-sage-400/60"
            : "border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-300 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {!isAll && icon}
        <span className="font-medium">{label}</span>
        {count !== undefined && (
          <span
            className={`text-[10px] font-medium tabular-nums ${
              active
                ? "text-paper-100/80 dark:text-umber-900/80"
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
          className="flex w-full items-center justify-center gap-[3px]"
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
              className={`h-[3px] w-3 rounded-full transition-colors ${
                bar.filled
                  ? "bg-sage-500"
                  : active
                    ? "bg-paper-100/30 dark:bg-umber-900/30"
                    : "bg-paper-300 dark:bg-umber-700"
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
function Avatar({ name, heroUrl }: { name: string; heroUrl?: string | null }) {
  const initial = name.charAt(0).toUpperCase();
  const base =
    "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-paper-300 bg-paper-100 font-serif text-lg text-ink-700 dark:border-umber-700 dark:bg-umber-700/60 dark:text-paper-100";
  if (heroUrl) {
    return (
      <div className={base}>
        <img src={heroUrl} alt={name} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }
  return <div className={base}>{initial}</div>;
}

/** Price-band scale: just N dollar signs ($ … $$$$$). No greyed
 *  remainder — the card reads cleaner without ghost glyphs. */
function PriceBandDots({ band }: { band: number }) {
  const filled = Math.max(0, Math.min(5, band));
  return <span className="font-mono">{"$".repeat(filled)}</span>;
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
