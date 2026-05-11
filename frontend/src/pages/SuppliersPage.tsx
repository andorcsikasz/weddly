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
  ArrowDown,
  ArrowUp,
  ChevronRight,
  LayoutGrid,
  List,
  Map as MapIcon,
  Disc3,
  Flower2,
  Lightbulb,
  Mail,
  MapPin,
  PartyPopper,
  Pencil,
  Phone,
  Scissors,
  Search,
  Shirt,
  Sparkles,
  Star,
  StickyNote,
  Users,
  UtensilsCrossed,
  Wallet,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { DiyEntryModal } from "../components/DiyEntryModal";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { Button } from "../components/ui";
import { coupleApi, coupleSupplierApi, supplierApi } from "../lib/endpoints";
import { formatHuf } from "../lib/format";
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
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  stationery: StickyNote,
  transport: Bus,
};

/** Diacritic-folded lower-case for case- and accent-insensitive matching. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
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
  const [targetGuestCount, setTargetGuestCount] = useState<number | null>(null);
  const [activeGroup, setActiveGroup] = useState<SupplierGroup | null>(null);
  const [activeCat, setActiveCat] = useState<SupplierCategory | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [diyOpen, setDiyOpen] = useState(false);
  const [diyEditing, setDiyEditing] = useState<CoupleSupplier | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => readSaved());

  // Filter state lives in URL params so back-button restores it.
  const query = params.get("q") ?? "";
  const cityFilter = params.get("city") ?? "";
  const showSavedOnly = params.get("saved") === "1";
  const sortMode: "top" | "alpha" = params.get("sort") === "alpha" ? "alpha" : "top";
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
  // Price ceiling: single 1..5 value meaning "show me up to band N". Reads as
  // a star-rating-style picker. Suppliers without a declared price band pass
  // through (otherwise the filter would hide community submissions that left
  // the field blank).
  const priceMax = (() => {
    const raw = params.get("price_max");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
  })();
  // Guest count: positive integer. Suppliers without a declared capacity
  // pass through (otherwise this filter would hide every photographer).
  const guestsFilter = (() => {
    const raw = params.get("guests");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  // Hover preview state for the price-band dots: when the user moves over dot
  // N, fill dots 1..N as a preview without persisting until they click.
  const [priceHover, setPriceHover] = useState<number | null>(null);

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
  function setSortMode(next: "top" | "alpha") {
    const p = new URLSearchParams(params);
    if (next === "alpha") p.set("sort", "alpha");
    else p.delete("sort");
    setParams(p, { replace: true });
  }
  function setViewMode(next: "grid" | "line" | "map") {
    const p = new URLSearchParams(params);
    if (next === "grid") p.delete("view");
    else p.set("view", next);
    setParams(p, { replace: true });
  }
  function setPriceCeiling(next: number | null) {
    const p = new URLSearchParams(params);
    if (next === null) p.delete("price_max");
    else p.set("price_max", String(next));
    setParams(p, { replace: true });
  }
  function setGuestsFilter(next: string) {
    const trimmed = next.trim();
    const p = new URLSearchParams(params);
    if (!trimmed) {
      p.delete("guests");
    } else {
      const n = Number(trimmed);
      if (Number.isInteger(n) && n > 0) p.set("guests", String(n));
      else p.delete("guests");
    }
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
      supplierApi
        .list()
        .then((r) => setItems(r.suppliers))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // Fetch the public directory, the couple's private DIY entries, and the
    // couple's wedding-day target guest count in parallel. The guest count
    // pre-fills the Vendégszám filter so it lines up with /app and /app/budget.
    Promise.all([supplierApi.list(), coupleSupplierApi.list(), coupleApi.current()])
      .then(([dir, mine, couple]) => {
        setItems(dir.suppliers);
        setCoupleSuppliers(mine.suppliers);
        setTargetGuestCount(couple.couple?.target_guest_count ?? null);
      })
      .catch(() => undefined);
  }, []);

  // Once we know the couple's target guest count, default the URL's `guests`
  // filter to it — but only if the user hasn't already touched the filter on
  // this navigation. Subsequent edits (including clearing) take precedence.
  // Intentionally narrow-deps: we want this to fire only when the target
  // count first arrives, not every time the URL params object changes.
  useEffect(() => {
    if (targetGuestCount === null || targetGuestCount <= 0) return;
    if (params.has("guests")) return;
    const p = new URLSearchParams(params);
    p.set("guests", String(targetGuestCount));
    setParams(p, { replace: true });
  }, [targetGuestCount, params, setParams]);

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
    if (priceMax !== null) {
      // Suppliers without a declared price band pass through — the filter
      // only narrows among declared ones, so community submissions with a
      // blank field stay visible.
      dir = dir.filter((s) => s.price_band === null || s.price_band <= priceMax);
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
        const hay = normalize(`${s.name} ${s.city} ${s.blurb_hu} ${s.blurb_en}`);
        return hay.includes(q);
      });
    }
    // Saved-only view is a directory feature; DIY entries are always "yours"
    // so they don't belong in the saved-list summary either way.
    let mine = showSavedOnly ? [] : coupleSuppliers;
    if (q) {
      mine = mine.filter((s) => normalize(`${s.name} ${s.notes ?? ""}`).includes(q));
    }
    return [...mine, ...dir];
  }, [items, coupleSuppliers, cityFilter, showSavedOnly, saved, priceMax, guestsFilter, query]);

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
    const sorted = [...out];
    if (sortMode === "alpha") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, locale === "hu" ? "hu" : "en"));
    } else {
      sorted.sort((a, b) => {
        const aSelf = a.source === "self" ? 1 : 0;
        const bSelf = b.source === "self" ? 1 : 0;
        if (aSelf !== bSelf) return bSelf - aSelf;
        if (a.source !== "self" && b.source !== "self") {
          if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
          if (a.source !== b.source) return a.source === "curated" ? -1 : 1;
        }
        return a.name.localeCompare(b.name, locale === "hu" ? "hu" : "en");
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

  const subCategories = activeGroup
    ? (SUPPLIER_GROUPS.find((g) => g.id === activeGroup)?.categories ?? [])
    : [];

  function pickGroup(id: SupplierGroup | null) {
    setActiveGroup(id);
    setActiveCat(null);
  }

  return (
    <AppShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>{t("suppliers.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("suppliers.sub")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label={t("suppliers.view_label")}
            className="inline-flex items-center rounded-full border border-paper-300 bg-paper-50 p-0.5 text-xs"
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
                    ? "inline-flex items-center gap-1 rounded-full bg-ink-700 px-2.5 py-1 text-paper-100"
                    : "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-600 hover:text-ink-900"
                }
              >
                <VIcon size={12} aria-hidden /> {t(`suppliers.${label}`)}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <input
            type="search"
            className="h-9 w-full rounded-full border border-paper-300 bg-paper-50 pl-9 pr-3 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none"
            placeholder={t("suppliers.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("suppliers.search_label")}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.city_label")}</span>
          <select
            className="h-9 min-w-[10rem] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-800 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none"
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
          className={
            showSavedOnly
              ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 text-sm font-medium text-paper-100"
              : "inline-flex h-9 items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-700 hover:border-ink-300"
          }
        >
          <Star size={14} className={showSavedOnly ? "fill-paper-100" : ""} aria-hidden />
          {t("suppliers.saved_filter", { n: saved.size })}
        </button>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.sort_label")}</span>
          <select
            className="h-9 min-w-[10rem] rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-800 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "top" | "alpha")}
            aria-label={t("suppliers.sort_label")}
          >
            <option value="top">{t("suppliers.sort_top")}</option>
            <option value="alpha">{t("suppliers.sort_alpha")}</option>
          </select>
        </label>
      </div>

      {/* Row 2: price ceiling (rating-style 5-dot picker) + guest-count number
          filter, grouped inside a softened container so they read as one
          control. Both narrow the list to suppliers whose declared value
          matches; suppliers with no declared value pass through so non-venue
          cards are not dropped. */}
      <div
        className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-paper-200 bg-paper-100/60 px-4 py-3"
        onMouseLeave={() => setPriceHover(null)}
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {t("suppliers.price_filter_label")}
          </span>
          <div className="inline-flex items-center gap-1.5" role="radiogroup">
            {[1, 2, 3, 4, 5].map((band) => {
              const target = priceHover ?? priceMax;
              const active = target !== null && target >= band;
              return (
                <button
                  key={band}
                  type="button"
                  role="radio"
                  aria-checked={priceMax === band}
                  aria-label={t("suppliers.price_filter_band_aria", { n: band })}
                  onClick={() => setPriceCeiling(priceMax === band ? null : band)}
                  onMouseEnter={() => setPriceHover(band)}
                  onFocus={() => setPriceHover(band)}
                  onBlur={() => setPriceHover(null)}
                  className={
                    active
                      ? "h-3.5 w-3.5 rounded-full bg-ink-700 ring-1 ring-ink-700 ring-offset-1 ring-offset-paper-100 transition"
                      : "h-3.5 w-3.5 rounded-full border border-ink-300 bg-paper-50 transition hover:border-ink-500"
                  }
                />
              );
            })}
          </div>
          {priceMax !== null && (
            <button
              type="button"
              onClick={() => setPriceCeiling(null)}
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline"
            >
              {t("suppliers.guests_filter_clear")}
            </button>
          )}
        </div>
        <div className="hidden h-5 w-px self-center bg-paper-300 sm:block" aria-hidden />
        <label className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {t("suppliers.guests_filter_label")}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="h-9 w-28 rounded-full border border-paper-300 bg-paper-50 px-3 text-sm text-ink-800 placeholder:text-ink-400 transition hover:border-ink-300 focus:border-ink-400 focus:outline-none"
            placeholder={t("suppliers.guests_filter_placeholder")}
            value={guestsFilter ?? ""}
            onChange={(e) => setGuestsFilter(e.target.value)}
            aria-label={t("suppliers.guests_filter_label")}
          />
          {guestsFilter !== null && (
            <button
              type="button"
              onClick={() => setGuestsFilter("")}
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline"
            >
              {t("suppliers.guests_filter_clear")}
            </button>
          )}
        </label>
      </div>

      {/* Step chain */}
      <div className="relative mb-3">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-stretch gap-2">
            <ChainStep
              active={activeGroup === null}
              onClick={() => pickGroup(null)}
              label={t("suppliers.filter_all")}
              count={filteredBeforeCategory.length}
              index={0}
              isAll
            />
            {SUPPLIER_GROUPS.map((g, i) => {
              const Icon = GROUP_ICON[g.id];
              return (
                <div key={g.id} className="flex items-stretch gap-2">
                  <ChevronRight size={16} className="self-center text-paper-400" aria-hidden />
                  <ChainStep
                    active={activeGroup === g.id}
                    onClick={() => pickGroup(g.id)}
                    label={t(`suppliers.group.${g.id}`)}
                    count={groupCounts.get(g.id) ?? 0}
                    icon={<Icon size={16} />}
                    index={i + 1}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Right-edge fade hints there's more to scroll. */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-paper-50 to-transparent"
          aria-hidden
        />
      </div>
      <p className="mb-5 text-xs text-ink-500">{t("suppliers.chain_help")}</p>

      {/* Sub-category pills (only when a group is selected). Each pill shows
          the count of suppliers in that category after the non-category
          filters, so couples can pre-scan where the inventory lives. */}
      {activeGroup && subCategories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            className={
              activeCat === null
                ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
            }
          >
            {t("suppliers.filter_all")}
            <span
              className={
                activeCat === null
                  ? "rounded-full bg-paper-100/20 px-1.5 text-[10px] font-medium tabular-nums"
                  : "text-[10px] font-medium tabular-nums text-ink-400"
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
                    ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
                }
              >
                <Icon size={13} />
                {t(`suppliers.cat.${c}`)}
                <span
                  className={
                    selected
                      ? "rounded-full bg-paper-100/20 px-1.5 text-[10px] font-medium tabular-nums"
                      : "text-[10px] font-medium tabular-nums text-ink-400"
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
          {/* "Csinálom magam" — pre-fills the modal with the active sub-
              category. Sits at the end of the pill row so its sage accent
              reads as the personal twin of the dark category pills. */}
          <button
            type="button"
            onClick={() => {
              setDiyEditing(null);
              setDiyOpen(true);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-sage-400 bg-sage-50 px-3 py-1 text-xs font-medium text-sage-700 transition hover:border-sage-600 hover:bg-sage-100"
          >
            <Pencil size={13} aria-hidden />
            {t("suppliers.diy_button_short")}
          </button>
        </div>
      )}

      {viewMode === "map" ? (
        <Suspense
          fallback={
            <div className="rounded-2xl border border-paper-300 bg-paper-50 p-8 text-center text-sm text-ink-500">
              {t("common.loading")}
            </div>
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
                    className={`relative flex items-center gap-3 rounded-2xl border border-sage-200 border-l-4 border-l-sage-500 bg-sage-50/60 px-4 py-3 transition hover:border-sage-300 hover:shadow-sm ${
                      isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                    }`}
                  >
                    <Avatar name={s.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                        <span className="hidden shrink-0 rounded-full border border-sage-300 bg-sage-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-700 sm:inline-flex">
                          {t("suppliers.diy_pill")}
                        </span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                        <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                          <Icon size={11} aria-hidden />
                          {t(`suppliers.cat.${s.category}`)}
                        </span>
                        {s.price_huf !== null && s.price_huf > 0 && (
                          <>
                            <span aria-hidden className="text-paper-400">
                              ·
                            </span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-sage-700">
                              <Wallet size={11} aria-hidden />
                              {formatHuf(s.price_huf, locale === "hu" ? "hu" : "en")}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openEdit}
                      aria-label={t("suppliers.diy_action_edit_aria")}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-sage-300 bg-sage-50 px-3 text-xs font-medium text-sage-700 transition hover:border-sage-500"
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
                  className={`card-hover relative flex h-full flex-col border-l-4 border-l-sage-500 !bg-sage-50/60 transition-shadow ${
                    isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={openEdit}
                    aria-label={t("suppliers.diy_action_edit_aria")}
                    className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-sage-600 transition hover:bg-sage-100 hover:text-sage-800"
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                  <div className="flex items-start gap-3 pr-8">
                    <Avatar name={s.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold">{s.name}</h3>
                        <span className="shrink-0 rounded-full border border-sage-300 bg-sage-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sage-700">
                          {t("suppliers.diy_pill")}
                        </span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                        <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                          <Icon size={12} aria-hidden />
                          {t(`suppliers.cat.${s.category}`)}
                        </span>
                        {s.price_huf !== null && s.price_huf > 0 && (
                          <>
                            <span aria-hidden className="text-paper-400">
                              ·
                            </span>
                            <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-sage-700">
                              <Wallet size={12} aria-hidden />
                              {formatHuf(s.price_huf, locale === "hu" ? "hu" : "en")}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  {s.notes && <p className="mt-3 line-clamp-3 text-sm text-ink-700">{s.notes}</p>}
                  <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                    <button
                      type="button"
                      onClick={openEdit}
                      className="inline-flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-700 transition hover:border-sage-500 hover:bg-sage-100"
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
                  className={`relative flex items-center gap-3 rounded-2xl border border-paper-200 bg-paper-50 px-4 py-3 transition hover:border-paper-300 hover:shadow-sm ${
                    isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                  }`}
                >
                  <Avatar name={s.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                      {s.source === "community" && (
                        <span className="hidden shrink-0 rounded-full border border-paper-300 bg-paper-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600 sm:inline-flex">
                          {t("suppliers.community_pill")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                        <Icon size={11} aria-hidden />
                        {t(`suppliers.cat.${s.category}`)}
                      </span>
                      <span aria-hidden className="text-paper-400">
                        ·
                      </span>
                      <span className="uppercase tracking-wide">{s.city}</span>
                      {s.price_band !== null && (
                        <>
                          <span aria-hidden className="text-paper-400">
                            ·
                          </span>
                          <span className="text-ink-600" title={t("suppliers.price_legend")}>
                            <PriceBandDots band={s.price_band} />
                          </span>
                        </>
                      )}
                      {(s.capacity_max ?? 0) > 0 && (
                        <>
                          <span aria-hidden className="text-paper-400">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink-600">
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
                    >
                      <span className="hidden md:inline">{t("suppliers.visit_website")}</span>
                      <span className="md:hidden">→</span>
                    </a>
                    {s.contact_phone && (
                      <a
                        href={`tel:${s.contact_phone}`}
                        className="btn-outline btn-sm"
                        aria-label={s.contact_phone}
                      >
                        <Phone size={14} aria-hidden />
                        <span className="hidden lg:inline">{s.contact_phone}</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleSaved(s.id)}
                      aria-label={isSaved ? t("suppliers.unsave_aria") : t("suppliers.save_aria")}
                      aria-pressed={isSaved}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-700"
                    >
                      <Star
                        size={15}
                        className={isSaved ? "fill-blush-500 text-blush-500" : ""}
                        aria-hidden
                      />
                    </button>
                    <VoteRow supplier={s} onVote={onVote} t={t} />
                  </div>
                </article>
              );
            }
            return (
              <article
                key={s.id}
                data-supplier-id={s.id}
                className={`card-hover relative flex h-full flex-col transition-shadow ${
                  isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                }`}
              >
                {/* Save star is pinned to the top-right corner so it reads as
                    a "favorite" affordance independent of the action row. */}
                <button
                  type="button"
                  onClick={() => toggleSaved(s.id)}
                  aria-label={isSaved ? t("suppliers.unsave_aria") : t("suppliers.save_aria")}
                  aria-pressed={isSaved}
                  className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-blush-700"
                >
                  <Star
                    size={15}
                    className={isSaved ? "fill-blush-500 text-blush-500" : ""}
                    aria-hidden
                  />
                </button>
                {/* Single-column body: avatar + name + meta line (with price
                    band and capacity inline so the meta strip stays one line),
                    address, blurb, then a bottom action row that places the
                    contact buttons on the left and the vote on the right
                    corner. The right padding on the name reserves space for
                    the pinned star above. */}
                <div className="flex items-start gap-3 pr-8">
                  <Avatar name={s.name} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{s.name}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                        <Icon size={12} aria-hidden />
                        {t(`suppliers.cat.${s.category}`)}
                      </span>
                      <span aria-hidden className="text-paper-400">
                        ·
                      </span>
                      <span className="uppercase tracking-wide">{s.city}</span>
                      {s.price_band !== null && (
                        <>
                          <span aria-hidden className="text-paper-400">
                            ·
                          </span>
                          <span
                            className="text-ink-600"
                            title={t("suppliers.price_legend")}
                            aria-label={t("suppliers.price_legend")}
                          >
                            <PriceBandDots band={s.price_band} />
                          </span>
                        </>
                      )}
                      {(s.capacity_max ?? 0) > 0 && (
                        <>
                          <span aria-hidden className="text-paper-400">
                            ·
                          </span>
                          <span
                            className="inline-flex items-center gap-1 whitespace-nowrap text-ink-600"
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
                      {s.source === "community" && (
                        <span className="inline-flex items-center rounded-full border border-paper-300 bg-paper-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                          {t("suppliers.community_pill")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {s.address && <p className="mt-2 line-clamp-1 text-xs text-ink-500">{s.address}</p>}
                <p className="mt-3 line-clamp-2 text-sm text-ink-700">
                  {locale === "hu" ? s.blurb_hu : s.blurb_en}
                </p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={s.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn-outline btn-sm"
                    >
                      {t("suppliers.visit_website")}
                    </a>
                    {s.contact_phone && (
                      <a href={`tel:${s.contact_phone}`} className="btn-outline btn-sm">
                        <Phone size={14} /> {s.contact_phone}
                      </a>
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
                  <div className="ml-auto flex items-center">
                    <VoteRow supplier={s} onVote={onVote} t={t} />
                  </div>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && items.length > 0 && (
            <p className="col-span-full py-8 text-center text-sm text-ink-500">
              {t("suppliers.empty_filtered")}
            </p>
          )}
        </div>
      )}

      <SubmitSupplierModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={(s) => {
          setItems((prev) => [s, ...prev]);
          setHighlightId(s.id);
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
        }}
        onDeleted={(id) => {
          setCoupleSuppliers((prev) => prev.filter((p) => p.id !== id));
        }}
      />
    </AppShell>
  );
}

function ChainStep({
  active,
  onClick,
  label,
  icon,
  index,
  isAll,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  index: number;
  isAll?: boolean;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-ink-700 bg-ink-700 text-paper-100"
          : "border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-300"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
          active ? "bg-paper-100/20 text-paper-100" : "bg-paper-200 text-ink-700"
        }`}
        aria-hidden
      >
        {isAll ? "·" : index}
      </span>
      {icon}
      <span className="font-medium">{label}</span>
      {count !== undefined && (
        <span
          className={`text-[10px] font-medium tabular-nums ${
            active ? "text-paper-100/80" : "text-ink-400"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-100 font-serif text-lg text-ink-700">
      {initial}
    </div>
  );
}

/** Five-dot price-band scale: ●○○○○ … ●●●●●. Cleaner than $$$ for HU. */
function PriceBandDots({ band }: { band: number }) {
  const total = 5;
  const filled = Math.max(0, Math.min(total, band));
  return (
    <span className="font-mono">
      {"●".repeat(filled)}
      {"○".repeat(Math.max(0, total - filled))}
    </span>
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
  return (
    <div className="inline-flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => handle(1)}
        aria-pressed={my === 1}
        aria-label={t("suppliers.vote_up_aria")}
        className={
          my === 1
            ? "inline-flex h-6 w-6 items-center justify-center rounded text-blush-700"
            : "inline-flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:text-blush-700"
        }
      >
        <ArrowUp size={14} aria-hidden />
      </button>
      <span
        className={`min-w-[1.25rem] text-center tabular-nums ${
          supplier.votes_score > 0
            ? "text-blush-700"
            : supplier.votes_score < 0
              ? "text-ink-400"
              : "text-ink-500"
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
            ? "inline-flex h-6 w-6 items-center justify-center rounded text-ink-700"
            : "inline-flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:text-ink-800"
        }
      >
        <ArrowDown size={14} aria-hidden />
      </button>
    </div>
  );
}
